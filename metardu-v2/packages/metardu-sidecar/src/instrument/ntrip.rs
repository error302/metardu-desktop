//! NTRIP v2 client for RTK correction streaming.
//!
//! Connects to a Networked Transport of RTCM via Internet Protocol (NTRIP)
//! caster to receive real-time GNSS correction data. The corrections can
//! optionally be forwarded to a connected instrument via serial port.
//!
//! NTRIP protocol (EBU-SN001 Rev 12.0):
//!   1. GET /<mountpoint> HTTP/1.1
//!   2. Ntrip-Version: Ntrip/2.0
//!   3. Authorization: Basic <base64(user:pass)>
//!   4. (Optional) NMEA position header for virtual reference stations
//!   5. Response: 200 OK → stream of RTCM3 binary data
//!
//! References:
//!   - NTRIP v2: https://www.eurocontrol.int/sites/default/files/2024-05/ebu-sn001-12.0.pdf
//!   - RTCM 10410.1 (RTCM v3.3): https://www.rtcm.org/standard-10410-1-1
//!   - bkg-ntrip: https://github.com/BKG-cddis/bkg-ntrip

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tracing::{info, warn, debug, error};

use super::serial::InstrumentRecord;

/// RTCM message parsed from the NTRIP stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RTCMMessage {
    /// RTCM message type (e.g., 1001, 1004, 1005, 1006, 1077, 1087, 1097, 1127, etc.)
    pub message_type: u16,
    /// Reference station ID (from message 1005/1006).
    pub station_id: Option<u32>,
    /// GPS reference station position (from message 1005/1006).
    pub station_position: Option<StationPosition>,
    /// Raw RTCM bytes for forwarding to instrument.
    pub raw_bytes: Vec<u8>,
    /// Timestamp when received.
    pub received_at_ms: u64,
}

/// GPS reference station position from RTCM 1005/1006.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationPosition {
    pub x: f64,  // ECEF X (meters)
    pub y: f64,  // ECEF Y (meters)
    pub z: f64,  // ECEF Z (meters)
}

/// Open an NTRIP stream to a caster and return parsed RTCM messages.
pub async fn open_ntrip_stream(
    caster_url: &str,
    mountpoint: &str,
    username: Option<&str>,
    password: Option<&str>,
    nmea_position: Option<&str>,
) -> Result<(tokio::task::JoinHandle<()>, mpsc::Receiver<InstrumentRecord>)> {
    let (tx, rx) = mpsc::channel::<InstrumentRecord>(256);

    // Build the HTTP request URL
    let url = if caster_url.ends_with('/') {
        format!("{}{}", caster_url, mountpoint)
    } else {
        format!("{}/{}", caster_url, mountpoint)
    };

    // Build HTTP headers
    let mut headers = vec![
        "User-Agent: MetaRDU-Desktop/0.5.0".to_string(),
        "Ntrip-Version: Ntrip/2.0".to_string(),
    ];

    // Basic auth
    if let (Some(user), Some(pass)) = (username, password) {
        let credentials = format!("{}:{}", user, pass);
        let encoded = base64_encode(&credentials);
        headers.push(format!("Authorization: Basic {}", encoded));
    }

    // NMEA position for VRS
    if let Some(pos) = nmea_position {
        headers.push(format!("Nmea: {}", pos));
    }

    let caster_url_owned = caster_url.to_string();
    let mountpoint_owned = mountpoint.to_string();

    let bg_task = tokio::spawn(async move {
        info!(caster = %caster_url_owned, mountpoint = %mountpoint_owned, "connecting NTRIP caster");

        // Parse caster URL to get host and port
        let url_parsed = url::Url::parse(&url)
            .or_else(|_| url::Url::parse(&format!("http://{}", url)));

        let host;
        let port;
        let path;

        match url_parsed {
            Ok(u) => {
                host = u.host_str().unwrap_or("localhost").to_string();
                port = u.port_or_known_default().unwrap_or(2101);
                path = u.path().to_string();
            }
            Err(_) => {
                host = caster_url_owned.trim_start_matches("http://").trim_start_matches("https://")
                    .split(':').next().unwrap_or("localhost").to_string();
                port = 2101;
                path = format!("/{}", mountpoint_owned);
            }
        }

        // Connect via TCP
        let addr = format!("{}:{}", host, port);
        match tokio::net::TcpStream::connect(&addr).await {
            Ok(stream) => {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                info!(addr = %addr, "NTRIP TCP connected");

                let mut stream = stream;

                // Send HTTP request
                let request = format!(
                    "GET {} HTTP/1.1\r\nHost: {}\r\n{}\r\n\r\n",
                    path,
                    host,
                    headers.join("\r\n"),
                );

                if let Err(e) = stream.write_all(request.as_bytes()).await {
                    error!(error = %e, "Failed to send NTRIP request");
                    return;
                }

                // Read HTTP response headers
                let mut reader = BufReader::new(stream);
                let mut status_line = String::new();
                reader.read_line(&mut status_line).await.ok();

                let status = status_line.trim();
                info!(status = %status, "NTRIP response");

                if !status.contains("200") {
                    error!(status = %status, "NTRIP caster rejected connection");
                    return;
                }

                // Skip remaining headers
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).await.ok();
                    if header.trim().is_empty() {
                        break;
                    }
                }

                info!("NTRIP stream established, reading RTCM data");

                // Read the binary RTCM stream
                let mut msg_count: u64 = 0;
                let mut buffer = Vec::new();

                loop {
                    let mut byte = [0u8; 1];
                    match reader.read_exact(&mut byte).await {
                        Ok(_) => {
                            buffer.push(byte[0]);

                            // RTCM3 frames: preamble 0xD3, then 6-bit reserved (should be 0),
                            // then 10-bit length, then payload, then 24-bit CRC.
                            if buffer.len() >= 3 && buffer[0] == 0xD3 {
                                let length = ((buffer[1] as usize) << 8) | (buffer[2] as usize);
                                let frame_len = 3 + length + 3; // header + payload + CRC

                                if buffer.len() >= frame_len {
                                    // Extract the complete frame
                                    let frame: Vec<u8> = buffer.drain(..frame_len).collect();
                                    msg_count += 1;

                                    // Parse message type from the first 12 bits of payload
                                    let msg_type = if frame.len() > 5 {
                                        ((frame[3] as u16) << 4) | ((frame[4] as u16) >> 4)
                                    } else {
                                        0
                                    };

                                    let now_ms = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as u64;

                                    let data = serde_json::json!({
                                        "message_type": msg_type,
                                        "frame_length": frame.len(),
                                        "hex_preview": frame.iter()
                                            .take(20)
                                            .map(|b| format!("{:02X}", b))
                                            .collect::<Vec<_>>()
                                            .join(" "),
                                    });

                                    let record = InstrumentRecord {
                                        record_type: "rtcm3".to_string(),
                                        data,
                                        raw: String::new(), // binary, no text
                                        received_at_ms: now_ms,
                                    };

                                    if tx.send(record).await.is_err() {
                                        info!("receiver dropped, stopping NTRIP reader");
                                        return;
                                    }
                                }
                            } else if !buffer.is_empty() && buffer[0] != 0xD3 {
                                // Not an RTCM preamble, skip
                                buffer.clear();
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "NTRIP stream read error (connection may have dropped)");
                            break;
                        }
                    }
                }

                info!(messages = msg_count, "NTRIP stream ended");
            }
            Err(e) => {
                error!(error = %e, addr = %addr, "Failed to connect to NTRIP caster");
            }
        }
    });

    Ok((bg_task, rx))
}

/// Simple base64 encoder (avoids pulling in the `base64` crate for this one use).
fn base64_encode(input: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut result = String::new();

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode("admin:password"), "YWRtaW46cGFzc3dvcmQ=");
        assert_eq!(base64_encode("a"), "YQ==");
        assert_eq!(base64_encode("abc"), "YWJj");
    }
}
