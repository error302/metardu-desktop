//! MetaRDU Desktop v2.0 — Tauri 2.x shell.
//!
//! This is the Phase 3 migration target. It replaces the Electron shell with
//! a Tauri 2.x shell that is ~10x smaller (target: <15 MB vs ~150 MB).
//!
//! Key architectural difference from the Electron + sidecar approach:
//!   - In Electron (Phase 1-2): the sidecar is a separate Rust process,
//!     communicating via length-prefixed JSON over stdin/stdout.
//!   - In Tauri (Phase 3): the Rust code is compiled directly into the main
//!     binary. No IPC protocol needed — Tauri commands call Rust functions
//!     directly. This is faster and simpler.
//!
//! The sidecar modules (gdal, mavsdk, odm, ml) are re-used verbatim —
//! only the transport layer changes (from stdin/stdout to Tauri commands).

// Re-use the sidecar modules
pub mod gdal;
pub mod mavsdk;
pub mod odm;
pub mod ml;

// Tauri command handlers (one per sidecar method)
pub mod commands;

use tauri::Manager;

/// Initialize tracing (logs to stderr).
fn init_tracing() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .with_target(false)
        .init();
}

/// The Tauri app entry point.
///
/// This function is called by the `tauri::generate_handler!` macro in main.rs.
/// It:
///   1. Initializes tracing
///   2. Registers all v2.0 Tauri commands
///   3. Starts the Tauri app loop
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!("MetaRDU Desktop v2.0 starting (Tauri shell)");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tracing::info!("Tauri app setup complete");
            tracing::info!("Registered commands: ping, version, list_methods, gdal_contour, mavlink_*, odm_process, ml_extract_*");

            // In Tauri, there's no sidecar process to start — the Rust code
            // is compiled into the binary. The MockDroneLink is initialized
            // lazily on first use via OnceLock.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Built-in
            commands::ping,
            commands::version,
            commands::list_methods,
            // GDAL
            commands::gdal_contour,
            // MAVLink
            commands::mavlink_connect,
            commands::mavlink_disconnect,
            commands::mavlink_get_telemetry,
            commands::mavlink_upload_mission,
            commands::mavlink_start_mission,
            commands::mavlink_rtl,
            commands::mavlink_arm,
            commands::mavlink_disarm,
            // ODM
            commands::odm_process,
            // ML
            commands::ml_extract_buildings,
            commands::ml_extract_roads,
            commands::ml_extract_changes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
