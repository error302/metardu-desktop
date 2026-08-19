//! Serial port connection for surveying instruments.
//!
//! Supports:
//!   - USB-serial adapters (FTDI, Prolific PL2303, CH340)
//!   - Native serial ports (rare on modern hardware)
//!   - Auto-detection of instrument protocol (Leica GSI, Sokkia SDR, Trimble SDR, NMEA)
//!   - Configurable baud rate (9600 to 460800)
//!
//! The connection spawns a background tokio task that reads bytes from the
//! serial port, buffers them, and parses NMEA sentences (for GNSS receivers)
//! or instrument-specific records (for total stations). Each parsed record
//! is sent through a `tokio::sync::mpsc` channel to the calling code.
//!
//! References:
//!   - Leica GSI: https://leica-geosystems.com/products/total-stations
//!   - Sokkia SDR: SDR Mapping Systems Reference Manual
//!   - Trimble SDR: Trimble Survey Reference Manual

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::{info, warn, debug, error};

use super::nmea::{parse_nmea, NmeaSentence, NmeaData};

/// Instrument record parsed from serial data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstrumentRecord {
    /// Record type identifier.
    pub record_type: String,
    /// Parsed data as JSON-serializable value.
    pub data: serde_json::Value,
    /// Raw line from the instrument.
    pub raw: String,
    /// UTC timestamp when the record was received.
    pub received_at_ms: u64,
}

/// A serial port info for listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub display_name: String,
    pub is_usb: bool,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}

/// Detect protocol from the first few lines of serial data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectedProtocol {
    Nmea,
    LeicaGsi,
    SokkiaSdr,
    TrimbleSdr,
    Unknown,
}

/// List available serial ports on the system.
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>> {
    let mut ports = Vec::new();

    // Enumerate via tokio_serial's re-export of the serialport crate.
    match tokio_serial::available_ports() {
        Ok(port_list) => {
            for port in port_list {
                let info = match &port.port_type {
                    tokio_serial::SerialPortType::UsbPort(usb) => {
                        SerialPortInfo {
                            port_name: port.port_name.clone(),
                            display_name: format!(
                                "{} {} ({})",
                                usb.manufacturer.as_deref().unwrap_or("USB"),
                                usb.product.as_deref().unwrap_or("Device"),
                                port.port_name,
                            ),
                            is_usb: true,
                            manufacturer: usb.manufacturer.clone(),
                            product: usb.product.clone(),
                            serial_number: usb.serial_number.clone(),
                        }
                    }
                    _ => SerialPortInfo {
                        port_name: port.port_name.clone(),
                        display_name: port.port_name.clone(),
                        is_usb: false,
                        manufacturer: None,
                        product: None,
                        serial_number: None,
                    },
                };
                ports.push(info);
            }
        }
        Err(e) => {
            warn!(error = %e, "serial port enumeration failed, falling back to path scan");
            // Fallback: list common Linux serial port paths
            for i in 0..20 {
                let paths = [
                    format!("/dev/ttyUSB{}", i),
                    format!("/dev/ttyACM{}", i),
                    format!("/dev/ttyS{}", i),
                ];
                for path in &paths {
                    if std::path::Path::new(path).exists() {
                        ports.push(SerialPortInfo {
                            port_name: path.clone(),
                            display_name: path.clone(),
                            is_usb: path.contains("USB") || path.contains("ACM"),
                            manufacturer: None,
                            product: None,
                            serial_number: None,
                        });
                    }
                }
            }
            // Windows COM ports
            #[cfg(target_os = "windows")]
            for i in 1..=256 {
                let path = format!("COM{}", i);
                ports.push(SerialPortInfo {
                    port_name: path.clone(),
                    display_name: path.clone(),
                    is_usb: true,
                    manufacturer: None,
                    product: None,
                    serial_number: None,
                });
            }
        }
    }

    Ok(ports)
}

/// Open a serial port and return a channel receiver that yields parsed instrument records.
///
/// The background task reads lines from the serial port and parses them as:
///   - NMEA sentences (for GNSS receivers)
///   - Leica GSI records (for total stations)
///   - Sokkia SDR records
///   - Trimble SDR records
///
/// If `protocol` is "auto", the first 5 lines are examined to detect the protocol.
pub async fn open_serial_stream(
    port_name: &str,
    baud_rate: u32,
    protocol: &str,
    _data_bits: u8,
    _stop_bits: u8,
    _parity: &str,
) -> Result<(tokio::task::JoinHandle<()>, mpsc::Receiver<InstrumentRecord>)> {
    let (tx, rx) = mpsc::channel::<InstrumentRecord>(256);

    // Convert to owned strings for the spawned task
    let port_name_owned = port_name.to_string();

    // Open the serial port using tokio_serial's async API.
    let builder = tokio_serial::new(port_name, baud_rate)
        .timeout(std::time::Duration::from_millis(100));

    let async_port = tokio_serial::SerialStream::open(&builder)
        .context(format!("Failed to open serial port {} at {} baud", port_name, baud_rate))?;

    info!(port = port_name, baud = baud_rate, "serial port opened");

    let protocol_pref = protocol.to_string();
    let port_name_for_task = port_name_owned;

    // Spawn the background reader task
    let bg_task = tokio::spawn(async move {
        let reader = BufReader::new(async_port);
        let mut lines = reader.lines();
        let mut detected_protocol: Option<DetectedProtocol> = None;
        let mut line_count: u64 = 0;

        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }

            line_count += 1;
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            // Auto-detect protocol from first few lines
            if detected_protocol.is_none() && protocol_pref == "auto" {
                    detected_protocol = Some(detect_protocol(&line));
                    if let Some(ref proto) = detected_protocol {
                        info!(port = port_name_for_task, protocol = ?proto, "auto-detected instrument protocol");
                    }
                }

            let effective_protocol = detected_protocol.as_ref().unwrap_or(&DetectedProtocol::Nmea);

            let record = match effective_protocol {
                DetectedProtocol::Nmea => {
                    if let Some(sentence) = parse_nmea(&line) {
                        Some(InstrumentRecord {
                            record_type: "nmea".to_string(),
                            data: serde_json::to_value(&sentence).unwrap_or_default(),
                            raw: line,
                            received_at_ms: now_ms,
                        })
                    } else {
                        None // Invalid NMEA line, skip
                    }
                }
                DetectedProtocol::LeicaGsi => {
                    if let Some(record) = parse_gsi_record(&line) {
                        Some(record)
                    } else {
                        None
                    }
                }
                DetectedProtocol::SokkiaSdr => {
                    if let Some(record) = parse_sdr_record(&line) {
                        Some(record)
                    } else {
                        None
                    }
                }
                DetectedProtocol::TrimbleSdr => {
                    if let Some(record) = parse_trimble_sdr_record(&line) {
                        Some(record)
                    } else {
                        None
                    }
                }
                DetectedProtocol::Unknown => {
                    // Pass through as raw
                    Some(InstrumentRecord {
                        record_type: "raw".to_string(),
                        data: serde_json::json!({ "line": line }),
                        raw: line,
                        received_at_ms: now_ms,
                    })
                }
            };

            if let Some(record) = record {
                if tx.send(record).await.is_err() {
                    info!("receiver dropped, stopping serial reader");
                    break;
                }
            }
        }

        info!(port = port_name_for_task, lines = line_count, "serial stream ended");
    });

    Ok((bg_task, rx))
}

/// Detect protocol from a single line of serial data.
fn detect_protocol(line: &str) -> DetectedProtocol {
    if line.starts_with('$') && line.len() > 5 {
        // $GPXXX, $GLXXX, $GAXXX, $GNXXX → NMEA
        let tag = &line[1..4];
        if tag.starts_with('G') || tag.starts_with('P') {
            return DetectedProtocol::Nmea;
        }
    }
    if line.starts_with("11") || line.starts_with("12") || line.starts_with("17") || line.starts_with("21") {
        // Leica GSI: records start with 2-digit record type (11=horizontal, 12=vertical, etc.)
        if line.len() > 20 && line.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '+' || c == '.') {
            return DetectedProtocol::LeicaGsi;
        }
    }
    if line.starts_with('%') || line.starts_with('#') {
        // SDR header or Trimble header
        if line.contains("SDR") || line.contains("SDR33") {
            return DetectedProtocol::SokkiaSdr;
        }
        if line.contains("Trimble") || line.contains("JOB") {
            return DetectedProtocol::TrimbleSdr;
        }
    }
    DetectedProtocol::Unknown
}

// ─── Leica GSI Parser ────────────────────────────────────────────

/// Parse a Leica GSI-16 or GSI-32 record line.
///
/// GSI format: `TT` + (WwDd...)* where:
///   TT = record type (11=horizontal angle, 12=vertical angle, 14=distance, etc.)
///   W = word type (2 chars), w = word length, D = data fields
///
/// Example: `11 11 +00000000.0000  22 +00000000.0000  81.0000`
fn parse_gsi_record(line: &str) -> Option<InstrumentRecord> {
    let trimmed = line.trim();
    if trimmed.len() < 4 {
        return None;
    }

    // Extract record type (first 2 digits)
    let record_type_str = &trimmed[..2];
    let record_type: u8 = record_type_str.parse().ok()?;

    // Parse the remaining fields
    let rest = trimmed[2..].trim();
    let fields: Vec<&str> = rest.split_whitespace().collect();

    let mut data = serde_json::Map::new();
    data.insert("record_type_code".to_string(), serde_json::Value::String(record_type_str.to_string()));

    // GSI records: after the 2-digit record type, the fields are
    // pairs of (word_type_code, value). E.g.:
    //   11 11 +00000045.1234  22 +00000000.0000
    // The first field is the word type code, the second is the value.
    match record_type {
        11 => {
            // Horizontal angle
            data.insert("type".to_string(), serde_json::Value::String("horizontal_angle".to_string()));
            // fields[0] = word type code ("11"), fields[1] = value
            if let Some(val) = fields.get(1) {
                let clean = val.trim_start_matches('+').trim_start_matches('-');
                if let Ok(angle) = clean.parse::<f64>() {
                    data.insert("horizontal_angle_deg".to_string(), serde_json::Value::from(angle));
                }
            }
        }
        12 => {
            // Vertical angle
            data.insert("type".to_string(), serde_json::Value::String("vertical_angle".to_string()));
            if let Some(val) = fields.get(1) {
                let clean = val.trim_start_matches('+').trim_start_matches('-');
                if let Ok(angle) = clean.parse::<f64>() {
                    data.insert("vertical_angle_deg".to_string(), serde_json::Value::from(angle));
                }
            }
        }
        14 => {
            // Slope distance
            data.insert("type".to_string(), serde_json::Value::String("slope_distance".to_string()));
            if let Some(val) = fields.get(1) {
                let clean = val.trim_start_matches('+').trim_start_matches('-');
                if let Ok(dist) = clean.parse::<f64>() {
                    data.insert("slope_distance_m".to_string(), serde_json::Value::from(dist));
                }
            }
        }
        17 => {
            // Point ID (target)
            data.insert("type".to_string(), serde_json::Value::String("point_id".to_string()));
            if let Some(id) = fields.get(1) {
                data.insert("point_id".to_string(), serde_json::Value::String(id.trim().to_string()));
            }
        }
        18 => {
            // Instrument height / reflector height
            data.insert("type".to_string(), serde_json::Value::String("height".to_string()));
            if let Some(val) = fields.get(1) {
                let clean = val.trim_start_matches('+').trim_start_matches('-');
                if let Ok(h) = clean.parse::<f64>() {
                    data.insert("height_m".to_string(), serde_json::Value::from(h));
                }
            }
        }
        _ => {
            data.insert("type".to_string(), serde_json::Value::String("unknown".to_string()));
        }
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Some(InstrumentRecord {
        record_type: format!("gsi_{:02}", record_type),
        data: serde_json::Value::Object(data),
        raw: line.to_string(),
        received_at_ms: now_ms,
    })
}

// ─── Sokkia SDR Parser ───────────────────────────────────────────

/// Parse a Sokkia SDR (Standard Data Record) line.
///
/// SDR format: fixed-width columns, record type in first column.
///   `%SDR33` header, then observation records.
fn parse_sdr_record(line: &str) -> Option<InstrumentRecord> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // SDR records are fixed-width. We do a basic parse.
    let record_type = if trimmed.starts_with('%') {
        "sdr_header".to_string()
    } else if trimmed.len() > 5 {
        let code = trimmed[..5].trim().to_string();
        format!("sdr_{}", code)
    } else {
        "sdr_raw".to_string()
    };

    Some(InstrumentRecord {
        record_type,
        data: serde_json::json!({ "fields": trimmed.split_whitespace().collect::<Vec<_>>() }),
        raw: line.to_string(),
        received_at_ms: now_ms,
    })
}

// ─── Trimble SDR Parser ──────────────────────────────────────────

/// Parse a Trimble SDR (Survey Data Record) or DC (Data Collector) line.
fn parse_trimble_sdr_record(line: &str) -> Option<InstrumentRecord> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let record_type = if trimmed.starts_with('#') || trimmed.starts_with('%') {
        "trimble_header".to_string()
    } else {
        "trimble_record".to_string()
    };

    Some(InstrumentRecord {
        record_type,
        data: serde_json::json!({ "fields": trimmed.split_whitespace().collect::<Vec<_>>() }),
        raw: line.to_string(),
        received_at_ms: now_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_nmea() {
        assert_eq!(detect_protocol("$GPGGA,061530.00,..."), DetectedProtocol::Nmea);
        assert_eq!(detect_protocol("$GNGGA,061530.00,..."), DetectedProtocol::Nmea);
    }

    #[test]
    fn test_detect_leica_gsi() {
        assert_eq!(
            detect_protocol("11 11 +00000000.0000  22 +00000000.0000"),
            DetectedProtocol::LeicaGsi
        );
    }

    #[test]
    fn test_parse_gsi_horizontal_angle() {
        let record = parse_gsi_record("11 11 +00000045.1234  22 +00000000.0000").unwrap();
        assert_eq!(record.record_type, "gsi_11");
        let data = record.data.as_object().unwrap();
        assert_eq!(data["type"], "horizontal_angle");
        let angle = data["horizontal_angle_deg"].as_f64().unwrap();
        assert!((angle - 45.1234).abs() < 0.001);
    }

    #[test]
    fn test_parse_gsi_slope_distance() {
        let record = parse_gsi_record("14 14 +000012.3456").unwrap();
        assert_eq!(record.record_type, "gsi_14");
        let data = record.data.as_object().unwrap();
        assert_eq!(data["type"], "slope_distance");
    }

    #[test]
    fn test_list_ports_doesnt_crash() {
        // Should return empty list or actual ports, but not panic
        let _ports = list_serial_ports();
    }
}
