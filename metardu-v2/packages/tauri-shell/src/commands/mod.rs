//! Tauri command handlers — direct function calls (no IPC protocol needed).
//!
//! Each function here is a `#[tauri::command]` that the renderer can call
//! directly via `invoke('command_name', { ...params })`.
//!
//! This is the key advantage of Tauri over Electron+sidecar:
//!   - Electron: renderer → IPC → main process → stdin/stdout → sidecar → function
//!   - Tauri:    renderer → invoke → function (direct call, no serialization overhead)
//!
//! The command bodies are thin wrappers around the same module functions
//! that the sidecar uses. The business logic is identical.

use serde::{Deserialize, Serialize};
use tauri::State;

// Re-use the parameter and result types from the sidecar modules
use crate::gdal::{ContourParams, ContourResult};
use crate::mavsdk::{
    DroneConnectionParams, DroneTelemetry, MissionUploadParams, MissionUploadResult,
    get_drone_link,
};
use crate::odm::{OdmProcessParams, OdmProcessResult};
use crate::ml::{MlExtractParams, MlExtractResult, FeatureType};

// ─── Built-in commands ─────────────────────────────────────────────

#[derive(Serialize)]
pub struct PingResult {
    pub pong: bool,
    pub ts: u64,
}

#[tauri::command]
pub async fn ping() -> Result<PingResult, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(PingResult { pong: true, ts })
}

#[derive(Serialize)]
pub struct VersionResult {
    pub name: String,
    pub version: String,
    pub rust_version: String,
}

#[tauri::command]
pub async fn version() -> Result<VersionResult, String> {
    Ok(VersionResult {
        name: "metardu-tauri".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_version: "1.x".to_string(),
    })
}

#[tauri::command]
pub async fn list_methods() -> Result<Vec<String>, String> {
    Ok(vec![
        "ping".to_string(),
        "version".to_string(),
        "list_methods".to_string(),
        "gdal_contour".to_string(),
        "mavlink_connect".to_string(),
        "mavlink_disconnect".to_string(),
        "mavlink_get_telemetry".to_string(),
        "mavlink_upload_mission".to_string(),
        "mavlink_start_mission".to_string(),
        "mavlink_rtl".to_string(),
        "mavlink_arm".to_string(),
        "mavlink_disarm".to_string(),
        "odm_process".to_string(),
        "ml_extract_buildings".to_string(),
        "ml_extract_roads".to_string(),
        "ml_extract_changes".to_string(),
    ])
}

// ─── GDAL commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn gdal_contour(params: ContourParams) -> Result<ContourResult, String> {
    crate::gdal::generate_contours(params)
        .map_err(|e| e.to_string())
}

// ─── MAVLink commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn mavlink_connect(params: DroneConnectionParams) -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.connect(params)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "connected": true }))
}

#[tauri::command]
pub async fn mavlink_disconnect() -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.disconnect()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "connected": false }))
}

#[tauri::command]
pub async fn mavlink_get_telemetry() -> Result<DroneTelemetry, String> {
    let link = get_drone_link();
    link.get_telemetry()
        .ok_or_else(|| "No telemetry available".to_string())
}

#[tauri::command]
pub async fn mavlink_upload_mission(params: MissionUploadParams) -> Result<MissionUploadResult, String> {
    let link = get_drone_link();
    link.upload_mission(params)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mavlink_start_mission() -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.start_mission()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "started": true }))
}

#[tauri::command]
pub async fn mavlink_rtl() -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.return_to_launch()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "rtl": true }))
}

#[tauri::command]
pub async fn mavlink_arm() -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.arm()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "armed": true }))
}

#[tauri::command]
pub async fn mavlink_disarm() -> Result<serde_json::Value, String> {
    let link = get_drone_link();
    link.disarm()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "armed": false }))
}

// ─── ODM commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn odm_process(params: OdmProcessParams) -> Result<OdmProcessResult, String> {
    crate::odm::process_photos(params)
        .await
        .map_err(|e| e.to_string())
}

// ─── ML commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ml_extract_buildings(
    orthophoto_path: String,
    model_path: Option<String>,
    confidence_threshold: Option<f64>,
) -> Result<MlExtractResult, String> {
    let params = MlExtractParams {
        orthophoto_path,
        feature_type: FeatureType::Buildings,
        model_path,
        confidence_threshold: confidence_threshold.unwrap_or(0.5),
        previous_orthophoto_path: None,
        tile_size: 512,
        tile_overlap: 64,
        min_area_m2: 10.0,
        max_area_m2: 10_000.0,
    };
    crate::ml::extract_features(params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ml_extract_roads(
    orthophoto_path: String,
    model_path: Option<String>,
    confidence_threshold: Option<f64>,
) -> Result<MlExtractResult, String> {
    let params = MlExtractParams {
        orthophoto_path,
        feature_type: FeatureType::Roads,
        model_path,
        confidence_threshold: confidence_threshold.unwrap_or(0.5),
        previous_orthophoto_path: None,
        tile_size: 512,
        tile_overlap: 64,
        min_area_m2: 10.0,
        max_area_m2: 10_000.0,
    };
    crate::ml::extract_features(params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ml_extract_changes(
    orthophoto_path: String,
    previous_orthophoto_path: String,
    model_path: Option<String>,
    confidence_threshold: Option<f64>,
) -> Result<MlExtractResult, String> {
    let params = MlExtractParams {
        orthophoto_path,
        feature_type: FeatureType::Changes,
        model_path,
        confidence_threshold: confidence_threshold.unwrap_or(0.5),
        previous_orthophoto_path: Some(previous_orthophoto_path),
        tile_size: 512,
        tile_overlap: 64,
        min_area_m2: 10.0,
        max_area_m2: 10_000.0,
    };
    crate::ml::extract_features(params)
        .await
        .map_err(|e| e.to_string())
}
