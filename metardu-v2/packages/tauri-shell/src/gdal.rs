//! GDAL module — re-exports from the sidecar.
//!
//! In the Tauri build, the sidecar modules are compiled directly into the
//! binary. This file re-exports the public API so the command handlers
//! can use it.

pub use metardu_sidecar_lib::gdal::*;
