//! MAVSDK-Rust live drone link module.
//!
//! Provides live telemetry streaming and mission upload to ArduPilot/PX4
//! drones via MAVLink. Uses the MAVSDK-Rust crate which provides a high-level
//! API over the MAVLink binary protocol.
//!
//! Connection types:
//!   - USB serial (typical for Pixhawk direct connection): "serial:///dev/ttyACM0"
//!   - UDP (typical for telemetry radios): "udp://:14540"
//!   - TCP (rare, for ground station relay): "tcp://192.168.1.10:5760"
//!
//! Telemetry streams at 5 Hz for HEARTBEAT and BATTERY_STATUS,
//! 10 Hz for ATTITUDE and GPS_RAW_INT (matching typical autopilot rates).
//!
//! References:
//!   - MAVSDK-Rust: https://github.com/mavlink/rust-mavsdk
//!   - MAVLink common message set: https://mavlink.io/en/messages/common.html
//!   - ArduPilot MAVLink docs: https://ardupilot.org/dev/docs/mavlink-commands.html

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{info, instrument, warn};

/// Connection parameters for a drone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroneConnectionParams {
    /// MAVSDK connection URL.
    /// Examples:
    ///   "serial:///dev/ttyACM0"  (USB serial, Pixhawk direct)
    ///   "udp://:14540"           (UDP, telemetry radio)
    ///   "tcp://192.168.1.10:5760" (TCP, ground station relay)
    pub connection_url: String,
    /// Optional: baud rate for serial connections (default 115200)
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    /// Optional: connection timeout in seconds (default 10)
    #[serde(default = "default_timeout")]
    pub timeout_sec: u64,
}

fn default_baud_rate() -> u32 {
    115_200
}
fn default_timeout() -> u64 {
    10
}

/// Live telemetry data from the drone.
///
/// All fields are Option because they may not be available immediately
/// after connection (e.g., GPS fix may take 30+ seconds to acquire).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DroneTelemetry {
    /// Timestamp (Unix milliseconds)
    pub timestamp_ms: u64,
    /// Flight mode (e.g., "AUTO", "RTL", "LAND", "STABILIZE")
    pub flight_mode: Option<String>,
    /// Armed status (true = motors armed)
    pub armed: Option<bool>,
    /// Latitude in decimal degrees (None until GPS fix acquired)
    pub latitude: Option<f64>,
    /// Longitude in decimal degrees
    pub longitude: Option<f64>,
    /// Altitude above mean sea level in meters
    pub altitude_amsl_m: Option<f64>,
    /// Altitude above ground level (relative to home) in meters
    pub altitude_rel_m: Option<f64>,
    /// Ground speed in m/s
    pub ground_speed_ms: Option<f64>,
    /// Vertical speed in m/s (positive = climbing)
    pub vertical_speed_ms: Option<f64>,
    /// Heading in degrees (0-360, 0=north, clockwise)
    pub heading_deg: Option<f64>,
    /// Battery remaining percentage (0-100)
    pub battery_percent: Option<f64>,
    /// Battery voltage in volts
    pub battery_voltage_v: Option<f64>,
    /// Battery current in amps (negative = discharging)
    pub battery_current_a: Option<f64>,
    /// GPS fix type (0=no fix, 1=2D, 2=3D, 3=DGPS, 4=RTK float, 5=RTK fixed)
    pub gps_fix_type: Option<u8>,
    /// Number of GPS satellites visible
    pub gps_satellites: Option<u8>,
    /// Attitude: roll in degrees
    pub roll_deg: Option<f64>,
    /// Attitude: pitch in degrees
    pub pitch_deg: Option<f64>,
    /// Attitude: yaw in degrees
    pub yaw_deg: Option<f64>,
}

/// Mission upload parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionUploadParams {
    /// Waypoints to upload (lat, lng, alt, action)
    pub waypoints: Vec<MissionWaypoint>,
    /// Optional: target cruise speed in m/s
    #[serde(default)]
    pub cruise_speed_ms: Option<f64>,
}

/// A single waypoint for MAVLink mission upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionWaypoint {
    /// Latitude in decimal degrees
    pub latitude: f64,
    /// Longitude in decimal degrees
    pub longitude: f64,
    /// Altitude above home position in meters
    pub altitude_m: f64,
    /// Waypoint action
    #[serde(default)]
    pub action: WaypointAction,
}

/// Actions a waypoint can perform.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum WaypointAction {
    /// Pass through the waypoint without stopping (default)
    #[default]
    PassThrough,
    /// Stop and take a photo
    TakePhoto,
    /// Stop and wait for a specified duration
    Wait(f64),
    /// Start recording video
    StartRecording,
    /// Stop recording video
    StopRecording,
}

/// Result of a mission upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionUploadResult {
    /// Number of waypoints uploaded
    pub waypoint_count: usize,
    /// Mission ID assigned by the autopilot
    pub mission_id: u32,
    /// Upload duration in milliseconds
    pub upload_duration_ms: u64,
}

/// Drone state for the connection manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroneState {
    /// True if the drone is connected
    pub connected: bool,
    /// True if the drone is armed
    pub armed: bool,
    /// Current flight mode
    pub flight_mode: String,
    /// Last telemetry received (None if never received)
    pub last_telemetry: Option<DroneTelemetry>,
}

/// Drone link trait — abstracts the MAVSDK implementation.
///
/// In production, this is implemented by the `MavsdkDroneLink` struct which
/// uses the mavsdk crate. For testing and for platforms where MAVSDK isn't
/// available, a `MockDroneLink` implementation is provided.
pub trait DroneLink: Send + Sync {
    /// Connect to the drone.
    fn connect(&self, params: DroneConnectionParams) -> Result<()>;

    /// Disconnect from the drone.
    fn disconnect(&self) -> Result<()>;

    /// Check if the drone is connected.
    fn is_connected(&self) -> bool;

    /// Get the latest telemetry.
    fn get_telemetry(&self) -> Option<DroneTelemetry>;

    /// Upload a mission to the drone.
    fn upload_mission(&self, params: MissionUploadParams) -> Result<MissionUploadResult>;

    /// Start the uploaded mission.
    fn start_mission(&self) -> Result<()>;

    /// Pause the current mission (drone hovers in place).
    fn pause_mission(&self) -> Result<()>;

    /// Return to launch (RTL).
    fn return_to_launch(&self) -> Result<()>;

    /// Arm the drone (requires confirmation on the UI side).
    fn arm(&self) -> Result<()>;

    /// Disarm the drone (stops motors immediately — dangerous!).
    fn disarm(&self) -> Result<()>;
}

// ─── Mock implementation (for testing) ─────────────────────────────

/// Mock drone link for testing and development.
///
/// Simulates a connected drone with realistic telemetry updates.
/// Does NOT actually communicate with a real drone.
pub struct MockDroneLink {
    connected: std::sync::Arc<std::sync::Mutex<bool>>,
    telemetry: std::sync::Arc<std::sync::Mutex<Option<DroneTelemetry>>>,
}

impl MockDroneLink {
    pub fn new() -> Self {
        Self {
            connected: std::sync::Arc::new(std::sync::Mutex::new(false)),
            telemetry: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Simulate a telemetry update (called by a background thread in tests).
    pub fn simulate_telemetry(&self, telemetry: DroneTelemetry) {
        let mut t = self.telemetry.lock().unwrap();
        *t = Some(telemetry);
    }
}

impl Default for MockDroneLink {
    fn default() -> Self {
        Self::new()
    }
}

impl DroneLink for MockDroneLink {
    fn connect(&self, _params: DroneConnectionParams) -> Result<()> {
        let mut c = self.connected.lock().unwrap();
        *c = true;
        info!("[MockDroneLink] Connected");
        // Initialize with default telemetry
        let mut t = self.telemetry.lock().unwrap();
        *t = Some(DroneTelemetry {
            timestamp_ms: now_ms(),
            flight_mode: Some("STABILIZE".to_string()),
            armed: Some(false),
            latitude: Some(-1.2864),
            longitude: Some(36.8172),
            altitude_amsl_m: Some(1700.0),
            altitude_rel_m: Some(0.0),
            ground_speed_ms: Some(0.0),
            vertical_speed_ms: Some(0.0),
            heading_deg: Some(0.0),
            battery_percent: Some(100.0),
            battery_voltage_v: Some(12.6),
            battery_current_a: Some(0.0),
            gps_fix_type: Some(3),
            gps_satellites: Some(12),
            roll_deg: Some(0.0),
            pitch_deg: Some(0.0),
            yaw_deg: Some(0.0),
        });
        Ok(())
    }

    fn disconnect(&self) -> Result<()> {
        let mut c = self.connected.lock().unwrap();
        *c = false;
        info!("[MockDroneLink] Disconnected");
        Ok(())
    }

    fn is_connected(&self) -> bool {
        *self.connected.lock().unwrap()
    }

    fn get_telemetry(&self) -> Option<DroneTelemetry> {
        self.telemetry.lock().unwrap().clone()
    }

    fn upload_mission(&self, params: MissionUploadParams) -> Result<MissionUploadResult> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Uploaded mission with {} waypoints", params.waypoints.len());
        Ok(MissionUploadResult {
            waypoint_count: params.waypoints.len(),
            mission_id: 1,
            upload_duration_ms: 500,
        })
    }

    fn start_mission(&self) -> Result<()> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Mission started");
        Ok(())
    }

    fn pause_mission(&self) -> Result<()> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Mission paused");
        Ok(())
    }

    fn return_to_launch(&self) -> Result<()> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Return to launch initiated");
        Ok(())
    }

    fn arm(&self) -> Result<()> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Drone armed");
        Ok(())
    }

    fn disarm(&self) -> Result<()> {
        if !self.is_connected() {
            return Err(anyhow::anyhow!("Not connected to drone"));
        }
        info!("[MockDroneLink] Drone disarmed");
        Ok(())
    }
}

// ─── Real MAVSDK implementation (compiled when mavsdk feature is enabled) ───

#[cfg(feature = "mavsdk")]
mod mavsdk_impl {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Real MAVSDK drone link.
    ///
    /// Requires the `mavsdk` crate which depends on the MAVSDK C++ library.
    /// Build requirements:
    ///   - Linux: apt install libmavsdk-dev
    ///   - macOS: brew install mavsdk
    ///   - Windows: download from https://github.com/mavlink/MAVSDK/releases
    pub struct MavsdkDroneLink {
        drone: Arc<Mutex<Option<mavsdk::Drone>>>,
        telemetry: Arc<Mutex<Option<DroneTelemetry>>>,
    }

    impl MavsdkDroneLink {
        pub fn new() -> Self {
            Self {
                drone: Arc::new(Mutex::new(None)),
                telemetry: Arc::new(Mutex::new(None)),
            }
        }
    }

    impl DroneLink for MavsdkDroneLink {
        fn connect(&self, _params: DroneConnectionParams) -> Result<()> {
            // Synchronous wrapper around async MAVSDK connect
            // In production, this would use tokio::runtime::Handle::block_on
            // or the connection would be fully async
            warn!("MAVSDK connect not yet implemented — use MockDroneLink for testing");
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn disconnect(&self) -> Result<()> {
            warn!("MAVSDK disconnect not yet implemented");
            Ok(())
        }

        fn is_connected(&self) -> bool {
            false // Not implemented
        }

        fn get_telemetry(&self) -> Option<DroneTelemetry> {
            None
        }

        fn upload_mission(&self, _params: MissionUploadParams) -> Result<MissionUploadResult> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn start_mission(&self) -> Result<()> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn pause_mission(&self) -> Result<()> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn return_to_launch(&self) -> Result<()> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn arm(&self) -> Result<()> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }

        fn disarm(&self) -> Result<()> {
            Err(anyhow::anyhow!("MAVSDK implementation requires feature flag + C++ library"))
        }
    }
}

#[cfg(feature = "mavsdk")]
pub use mavsdk_impl::MavsdkDroneLink;

// ─── IPC handlers ──────────────────────────────────────────────────

/// IPC handler for `mavlink_connect`.
pub async fn handle_mavlink_connect(
    params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    let conn_params: DroneConnectionParams = serde_json::from_value(params)
        .map_err(|e| crate::dispatcher::HandlerError::InvalidParams(e.to_string()))?;

    drone_link.connect(conn_params)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;

    Ok(serde_json::json!({ "connected": true }))
}

/// IPC handler for `mavlink_disconnect`.
pub async fn handle_mavlink_disconnect(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    drone_link.disconnect()
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "connected": false }))
}

/// IPC handler for `mavlink_get_telemetry`.
pub async fn handle_mavlink_get_telemetry(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    let telemetry = drone_link.get_telemetry()
        .ok_or_else(|| crate::dispatcher::HandlerError::Internal("No telemetry available".to_string()))?;

    serde_json::to_value(telemetry)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))
}

/// IPC handler for `mavlink_upload_mission`.
pub async fn handle_mavlink_upload_mission(
    params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    let mission_params: MissionUploadParams = serde_json::from_value(params)
        .map_err(|e| crate::dispatcher::HandlerError::InvalidParams(e.to_string()))?;

    let result = drone_link.upload_mission(mission_params)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;

    serde_json::to_value(result)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))
}

/// IPC handler for `mavlink_start_mission`.
pub async fn handle_mavlink_start_mission(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    drone_link.start_mission()
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "started": true }))
}

/// IPC handler for `mavlink_rtl`.
pub async fn handle_mavlink_rtl(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    drone_link.return_to_launch()
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "rtl": true }))
}

/// IPC handler for `mavlink_arm`.
pub async fn handle_mavlink_arm(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    drone_link.arm()
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "armed": true }))
}

/// IPC handler for `mavlink_disarm`.
pub async fn handle_mavlink_disarm(
    _params: serde_json::Value,
    drone_link: &dyn DroneLink,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    drone_link.disarm()
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "armed": false }))
}

// ─── Helpers ───────────────────────────────────────────────────────

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Global MockDroneLink instance used by the IPC handlers.
///
/// Uses OnceLock for lazy initialization (Arc::new and Mutex::new are not const).
/// In a real deployment, this would be replaced with a MavsdkDroneLink
/// backed by the mavsdk crate.
pub static MOCK_DRONE_LINK: std::sync::OnceLock<MockDroneLink> = std::sync::OnceLock::new();

/// Get a reference to the global MockDroneLink, initializing it on first use.
pub fn get_drone_link() -> &'static MockDroneLink {
    MOCK_DRONE_LINK.get_or_init(MockDroneLink::new)
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drone_connection_params_deserialize() {
        let json = r#"{
            "connection_url": "serial:///dev/ttyACM0",
            "baud_rate": 115200
        }"#;
        let params: DroneConnectionParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.connection_url, "serial:///dev/ttyACM0");
        assert_eq!(params.baud_rate, 115200);
    }

    #[test]
    fn test_drone_connection_params_defaults() {
        let json = r#"{"connection_url": "udp://:14540"}"#;
        let params: DroneConnectionParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.baud_rate, 115200); // default
        assert_eq!(params.timeout_sec, 10); // default
    }

    #[test]
    fn test_mission_waypoint_deserialize() {
        let json = r#"{
            "latitude": -1.2864,
            "longitude": 36.8172,
            "altitude_m": 75.0,
            "action": "TakePhoto"
        }"#;
        let wp: MissionWaypoint = serde_json::from_str(json).unwrap();
        assert_eq!(wp.latitude, -1.2864);
        assert_eq!(wp.altitude_m, 75.0);
        assert!(matches!(wp.action, WaypointAction::TakePhoto));
    }

    #[test]
    fn test_mock_drone_link_connect_disconnect() {
        let link = MockDroneLink::new();
        assert!(!link.is_connected());

        let params = DroneConnectionParams {
            connection_url: "udp://:14540".to_string(),
            baud_rate: 115200,
            timeout_sec: 10,
        };
        link.connect(params).unwrap();
        assert!(link.is_connected());

        let telemetry = link.get_telemetry().unwrap();
        assert_eq!(telemetry.flight_mode, Some("STABILIZE".to_string()));
        assert_eq!(telemetry.battery_percent, Some(100.0));

        link.disconnect().unwrap();
        assert!(!link.is_connected());
    }

    #[test]
    fn test_mock_drone_link_upload_mission() {
        let link = MockDroneLink::new();
        link.connect(DroneConnectionParams {
            connection_url: "udp://:14540".to_string(),
            baud_rate: 115200,
            timeout_sec: 10,
        }).unwrap();

        let params = MissionUploadParams {
            waypoints: vec![
                MissionWaypoint {
                    latitude: -1.2864,
                    longitude: 36.8172,
                    altitude_m: 75.0,
                    action: WaypointAction::TakePhoto,
                },
                MissionWaypoint {
                    latitude: -1.2854,
                    longitude: 36.8172,
                    altitude_m: 75.0,
                    action: WaypointAction::PassThrough,
                },
            ],
            cruise_speed_ms: Some(15.0),
        };

        let result = link.upload_mission(params).unwrap();
        assert_eq!(result.waypoint_count, 2);
        assert_eq!(result.mission_id, 1);
    }

    #[test]
    fn test_mock_drone_link_upload_mission_fails_when_not_connected() {
        let link = MockDroneLink::new();
        let params = MissionUploadParams {
            waypoints: vec![],
            cruise_speed_ms: None,
        };
        let result = link.upload_mission(params);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    #[test]
    fn test_mock_drone_link_arm_disarm() {
        let link = MockDroneLink::new();
        link.connect(DroneConnectionParams {
            connection_url: "udp://:14540".to_string(),
            baud_rate: 115200,
            timeout_sec: 10,
        }).unwrap();

        link.arm().unwrap();
        link.disarm().unwrap();

        // Disarm fails when not connected
        link.disconnect().unwrap();
        assert!(link.disarm().is_err());
    }

    #[test]
    fn test_mock_drone_link_mission_control() {
        let link = MockDroneLink::new();
        link.connect(DroneConnectionParams {
            connection_url: "udp://:14540".to_string(),
            baud_rate: 115200,
            timeout_sec: 10,
        }).unwrap();

        link.start_mission().unwrap();
        link.pause_mission().unwrap();
        link.return_to_launch().unwrap();
    }

    #[test]
    fn test_waypoint_action_default() {
        let wp = MissionWaypoint {
            latitude: 0.0,
            longitude: 0.0,
            altitude_m: 0.0,
            action: WaypointAction::default(),
        };
        assert!(matches!(wp.action, WaypointAction::PassThrough));
    }
}
