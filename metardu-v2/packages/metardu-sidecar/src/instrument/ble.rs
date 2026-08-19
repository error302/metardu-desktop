//! Bluetooth Low Energy connection for modern GNSS receivers.
//!
//! This module is a placeholder for future btleplug integration. The full
//! BLE implementation requires platform-specific permissions and driver
//! support that varies significantly between Linux, macOS, and Windows.
//!
//! For now, BLE connections are reported as "not supported" with a helpful
//! error message directing users to use serial or NTRIP connections instead.
//!
//! Future implementation will use:
//!   - btleplug for cross-platform BLE scanning and connection
//!   - Nordic UART Service (NUS) for NMEA data streaming
//!   - Platform-specific BLE adapter enumeration
//!
//! References:
//!   - btleplug: https://github.com/danielrangelrojas/btleplug
//!   - Nordic UART Service: https://developer.nordicsemi.com/ble_nrf_connect_sdk/doc/latest/nrf/libraries/bluetooth/services/nus.html

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn};

use super::serial::InstrumentRecord;

/// BLE device info from a scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleDeviceInfo {
    pub name: String,
    pub address: String,
    pub rssi: i16,
    pub is_connectable: bool,
    pub service_uuids: Vec<String>,
}

/// Scan for nearby BLE devices.
///
/// On Linux, this requires `bluetoothd` to be running and the user to be
/// in the `bluetooth` group. On macOS, it uses CoreBluetooth. On Windows,
/// it uses the Windows BLE API.
pub async fn scan_ble_devices() -> Result<Vec<BleDeviceInfo>> {
    // TODO: Implement with btleplug when platform-specific BLE support
    // is tested and verified. For now, return an empty list with a warning.
    warn!("BLE scanning not yet implemented — use serial or NTRIP connections");
    Ok(Vec::new())
}

/// Open a BLE connection to a GNSS receiver and return a stream of NMEA records.
///
/// This is a stub that returns an error. The full implementation will:
///   1. Connect to the BLE device via btleplug
///   2. Discover the NMEA service/characteristic
///   3. Subscribe to notifications
///   4. Parse incoming NMEA sentences
///   5. Send parsed records through the channel
pub async fn open_ble_stream(
    _device_name: &str,
    _device_address: Option<&str>,
    _service_uuid: Option<&str>,
    _characteristic_uuid: Option<&str>,
) -> Result<(tokio::task::JoinHandle<()>, mpsc::Receiver<InstrumentRecord>)> {
    let (_tx, rx) = mpsc::channel::<InstrumentRecord>(1);

    // Return a task that immediately exits
    let bg_task = tokio::spawn(async {
        warn!("BLE streaming not yet implemented — use serial or NTRIP connections");
    });

    Err(anyhow::anyhow!(
        "Bluetooth LE connections are not yet implemented. \
         Use serial (USB-adapter) or NTRIP (CORS caster) connections instead. \
         BLE support will be added in a future release."
    ))
}
