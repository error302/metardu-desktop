//! Instrument connection module — live serial, Bluetooth LE, and NTRIP streaming.
//!
//! Provides real-time instrument connection for surveying equipment:
//!   - **Serial**: Total stations (Leica GSI, Sokkia SDR) and GNSS receivers
//!     via USB-serial adapters. Uses `tokio-serial` for async I/O.
//!   - **Bluetooth LE**: Modern GNSS receivers (Leica GS18, Trimble R12i)
//!     via `btleplug`. Streams NMEA observations.
//!   - **NTRIP**: Connects to a CORS caster for RTK corrections. The
//!     corrections are forwarded to the connected instrument via serial.
//!
//! All background streams push parsed observations as `Notification` structs
//! through the broadcast channel, which the main loop forwards to the
//! Electron main process. The renderer receives them via IPC events.
//!
//! References:
//!   - NMEA 0183 Standard: https://www.nmea.org/content/STANDARDS/NMEA_0183_Standard
//!   - Leica GSI: Leica Geo Office documentation
//!   - NTRIP v2: EBU-SN001 Rev 12.0
//!   - btleplug: https://github.com/danielrangelrojas/btleplug

pub mod nmea;
pub mod serial;
pub mod ble;
pub mod ntrip;
pub mod baseline_covariance;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn, error};

use crate::dispatcher::HandlerError;
use crate::protocol::Notification;
use crate::NotificationSender;

/// Unique connection identifier.
pub type ConnectionId = String;

/// Instrument connection type.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionType {
    Serial,
    Bluetooth,
    Ntrip,
}

/// Status of an instrument connection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Streaming,
    Disconnected,
    Error { message: String },
}

/// A single instrument connection record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectionInfo {
    pub id: ConnectionId,
    pub connection_type: ConnectionType,
    pub port: String,
    pub status: ConnectionStatus,
    pub instrument_name: Option<String>,
    pub protocol: Option<String>,
    pub data_rate_hz: Option<f64>,
    pub observation_count: u64,
    pub connected_at: Option<String>,
    pub last_observation_at: Option<String>,
}

/// Active connection state — held behind Arc<Mutex<>> so the main process
/// and background threads can access it concurrently.
struct ActiveConnection {
    info: ConnectionInfo,
    /// Handle to the background task. Dropping this cancels the stream.
    abort_handle: tokio::task::JoinHandle<()>,
}

/// Global connection registry — keyed by connection ID.
lazy_static::lazy_static! {
    static ref CONNECTIONS: Arc<Mutex<HashMap<ConnectionId, ActiveConnection>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// Connection request parameters (serial).
#[derive(Debug, serde::Deserialize)]
pub struct SerialConnectParams {
    /// Serial port path (e.g., "/dev/ttyUSB0", "COM3").
    pub port: String,
    /// Baud rate (default 115200 for most instruments).
    #[serde(default = "default_baud")]
    pub baud_rate: u32,
    /// Instrument protocol auto-detection or manual override.
    /// "auto" | "gsi" | "sdr" | "nmea" | "trimble_sdr".
    #[serde(default = "default_protocol")]
    pub protocol: String,
    /// Instrument name for display (auto-detected if omitted).
    pub instrument_name: Option<String>,
    /// Data bits (default 8).
    #[serde(default = "default_data_bits")]
    pub data_bits: u8,
    /// Stop bits (default 1).
    #[serde(default = "default_stop_bits")]
    pub stop_bits: u8,
    /// Parity (default "none").
    #[serde(default = "default_parity")]
    pub parity: String,
}

fn default_baud() -> u32 { 115_200 }
fn default_protocol() -> String { "auto".to_string() }
fn default_data_bits() -> u8 { 8 }
fn default_stop_bits() -> u8 { 1 }
fn default_parity() -> String { "none".to_string() }

/// Connection request parameters (Bluetooth LE).
#[derive(Debug, serde::Deserialize)]
pub struct BleConnectParams {
    /// BLE device name filter (partial match). If empty, scans for all BLE devices.
    #[serde(default)]
    pub device_name: String,
    /// BLE device address (MAC or UUID) for direct connection.
    pub device_address: Option<String>,
    /// Service UUID to subscribe to for NMEA data.
    /// Defaults to the standard GNSS NMEA service (0000180a-...).
    pub service_uuid: Option<String>,
    /// Characteristic UUID for NMEA data notifications.
    pub characteristic_uuid: Option<String>,
    /// Instrument name for display.
    pub instrument_name: Option<String>,
}

/// Connection request parameters (NTRIP).
#[derive(Debug, serde::Deserialize)]
pub struct NtripConnectParams {
    /// NTRIP caster URL (e.g., "http://caster.example.com:2101").
    pub caster_url: String,
    /// Mountpoint name (e.g., "RTCM3").
    pub mountpoint: String,
    /// Username for authentication.
    pub username: Option<String>,
    /// Password for authentication.
    pub password: Option<String>,
    /// NMEA position string for differential corrections (lat,lon in DDMM.MMMMM format).
    /// If not provided, some casters return the nearest mountpoint.
    pub nmea_position: Option<String>,
    /// Forward corrections to this serial port (e.g., the instrument's data port).
    pub forward_to_port: Option<String>,
    /// Baud rate for the forward port.
    #[serde(default = "default_baud")]
    pub forward_baud_rate: u32,
}

// ─── IPC Handlers ─────────────────────────────────────────────────

/// `instrument.list_ports` — enumerate available serial ports.
pub async fn handle_list_ports(_params: serde_json::Value) -> Result<serde_json::Value, HandlerError> {
    let ports = serial::list_serial_ports()
        .map_err(|e| HandlerError::Internal(e.to_string()))?;

    Ok(serde_json::json!({
        "ports": ports,
    }))
}

/// `instrument.list_ble_devices` — scan for nearby BLE devices.
pub async fn handle_list_ble_devices(_params: serde_json::Value) -> Result<serde_json::Value, HandlerError> {
    let devices = ble::scan_ble_devices()
        .await
        .map_err(|e| HandlerError::Internal(e.to_string()))?;

    Ok(serde_json::json!({
        "devices": devices,
    }))
}

/// `instrument.connect` — open a serial port and start streaming.
pub async fn handle_connect(
    params: serde_json::Value,
    notif_tx: NotificationSender,
) -> Result<serde_json::Value, HandlerError> {
    let conn_type = params.get("connection_type")
        .and_then(|v| v.as_str())
        .unwrap_or("serial");

    match conn_type {
        "serial" => {
            let p: SerialConnectParams = serde_json::from_value(params.clone())
                .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;

            let conn_id = uuid::Uuid::new_v4().to_string();
            info!(port = %p.port, baud = p.baud_rate, conn_id = %conn_id, "opening serial connection");

            let (abort_handle, mut rx) = serial::open_serial_stream(
                &p.port, p.baud_rate, &p.protocol, p.data_bits, p.stop_bits, &p.parity,
            ).await
                .map_err(|e| HandlerError::Internal(format!("Failed to open {}: {}", p.port, e)))?;

            let conn_id_clone = conn_id.clone();
            let notif_tx_clone = notif_tx.clone();
            let instrument_name = p.instrument_name.clone().unwrap_or_else(|| p.port.clone());
            let protocol = p.protocol.clone();

            // Background task: read from the serial stream and push notifications.
            let bg_task = tokio::spawn(async move {
                let mut obs_count: u64 = 0;
                while let Some(obs) = rx.recv().await {
                    obs_count += 1;
                    let notif = Notification::new(
                        "instrument.observation",
                        serde_json::json!({
                            "connection_id": conn_id_clone,
                            "observation": obs,
                            "observation_count": obs_count,
                        }),
                    );
                    if notif_tx_clone.send(notif).is_err() {
                        info!("notification receiver dropped, stopping stream");
                        break;
                    }
                }
                info!(conn_id = %conn_id_clone, observations = obs_count, "serial stream ended");
            });

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), ActiveConnection {
                info: ConnectionInfo {
                    id: conn_id.clone(),
                    connection_type: ConnectionType::Serial,
                    port: p.port,
                    status: ConnectionStatus::Streaming,
                    instrument_name: Some(instrument_name),
                    protocol: Some(protocol),
                    data_rate_hz: None,
                    observation_count: 0,
                    connected_at: Some(chrono_now()),
                    last_observation_at: None,
                },
                abort_handle: bg_task,
            });

            Ok(serde_json::json!({
                "connection_id": conn_id,
                "status": "streaming",
            }))
        }
        "bluetooth" => {
            let p: BleConnectParams = serde_json::from_value(params.clone())
                .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;

            let conn_id = uuid::Uuid::new_v4().to_string();
            info!(device_name = %p.device_name, conn_id = %conn_id, "connecting BLE device");

            let (abort_handle, mut rx) = ble::open_ble_stream(
                &p.device_name,
                p.device_address.as_deref(),
                p.service_uuid.as_deref(),
                p.characteristic_uuid.as_deref(),
            ).await
                .map_err(|e| HandlerError::Internal(format!("BLE connect failed: {}", e)))?;

            let conn_id_clone = conn_id.clone();
            let notif_tx_clone = notif_tx.clone();
            let instrument_name = p.instrument_name.unwrap_or_else(|| p.device_name.clone());

            let bg_task = tokio::spawn(async move {
                let mut obs_count: u64 = 0;
                while let Some(obs) = rx.recv().await {
                    obs_count += 1;
                    let notif = Notification::new(
                        "instrument.observation",
                        serde_json::json!({
                            "connection_id": conn_id_clone,
                            "observation": obs,
                            "observation_count": obs_count,
                        }),
                    );
                    if notif_tx_clone.send(notif).is_err() {
                        break;
                    }
                }
            });

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), ActiveConnection {
                info: ConnectionInfo {
                    id: conn_id.clone(),
                    connection_type: ConnectionType::Bluetooth,
                    port: format!("ble:{}", p.device_name),
                    status: ConnectionStatus::Streaming,
                    instrument_name: Some(instrument_name),
                    protocol: Some("nmea".to_string()),
                    data_rate_hz: None,
                    observation_count: 0,
                    connected_at: Some(chrono_now()),
                    last_observation_at: None,
                },
                abort_handle: bg_task,
            });

            Ok(serde_json::json!({
                "connection_id": conn_id,
                "status": "streaming",
            }))
        }
        "ntrip" => {
            let p: NtripConnectParams = serde_json::from_value(params.clone())
                .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;

            let conn_id = uuid::Uuid::new_v4().to_string();
            info!(caster = %p.caster_url, mountpoint = %p.mountpoint, conn_id = %conn_id, "connecting NTRIP caster");

            let (abort_handle, mut rx) = ntrip::open_ntrip_stream(
                &p.caster_url,
                &p.mountpoint,
                p.username.as_deref(),
                p.password.as_deref(),
                p.nmea_position.as_deref(),
            ).await
                .map_err(|e| HandlerError::Internal(format!("NTRIP connect failed: {}", e)))?;

            let conn_id_clone = conn_id.clone();
            let notif_tx_clone = notif_tx.clone();
            let mountpoint = p.mountpoint.clone();

            let bg_task = tokio::spawn(async move {
                let mut msg_count: u64 = 0;
                while let Some(msg) = rx.recv().await {
                    msg_count += 1;
                    let notif = Notification::new(
                        "instrument.observation",
                        serde_json::json!({
                            "connection_id": conn_id_clone,
                            "observation": msg,
                            "observation_count": msg_count,
                        }),
                    );
                    if notif_tx_clone.send(notif).is_err() {
                        break;
                    }
                }
            });

            let mut conns = CONNECTIONS.lock().await;
            conns.insert(conn_id.clone(), ActiveConnection {
                info: ConnectionInfo {
                    id: conn_id.clone(),
                    connection_type: ConnectionType::Ntrip,
                    port: format!("ntrip:{}@{}", p.mountpoint, p.caster_url),
                    status: ConnectionStatus::Streaming,
                    instrument_name: Some(format!("NTRIP:{}", p.mountpoint)),
                    protocol: Some("rtcm3".to_string()),
                    data_rate_hz: None,
                    observation_count: 0,
                    connected_at: Some(chrono_now()),
                    last_observation_at: None,
                },
                abort_handle: bg_task,
            });

            Ok(serde_json::json!({
                "connection_id": conn_id,
                "status": "streaming",
            }))
        }
        other => Err(HandlerError::InvalidParams(
            format!("Unknown connection_type: '{}'. Supported: serial, bluetooth, ntrip", other)
        )),
    }
}

/// `instrument.disconnect` — close a connection and clean up.
pub async fn handle_disconnect(params: serde_json::Value) -> Result<serde_json::Value, HandlerError> {
    let conn_id = params.get("connection_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| HandlerError::InvalidParams("Missing 'connection_id'".to_string()))?;

    let mut conns = CONNECTIONS.lock().await;
    match conns.remove(conn_id) {
        Some(active) => {
            active.abort_handle.abort();
            info!(conn_id = %conn_id, "disconnected instrument");
            Ok(serde_json::json!({
                "disconnected": true,
                "connection_id": conn_id,
            }))
        }
        None => Err(HandlerError::InvalidParams(
            format!("No connection with id '{}'", conn_id)
        )),
    }
}

/// `instrument.status` — return status of all active connections.
pub async fn handle_status(_params: serde_json::Value) -> Result<serde_json::Value, HandlerError> {
    let conns = CONNECTIONS.lock().await;
    let connections: Vec<ConnectionInfo> = conns.values().map(|c| c.info.clone()).collect();
    Ok(serde_json::json!({
        "connections": connections,
        "count": connections.len(),
    }))
}

/// `instrument.scan_ports` — quick serial port scan without opening.
pub async fn handle_scan_ports(_params: serde_json::Value) -> Result<serde_json::Value, HandlerError> {
    let ports = serial::list_serial_ports()
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "ports": ports }))
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = t.as_secs();
    // Simple UTC timestamp without pulling in chrono crate.
    // Format: 2026-01-01T12:00:00Z
    // We compute from Unix epoch. For simplicity, use the raw millis.
    format!("{}ms", t.as_millis())
}
