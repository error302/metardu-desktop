//! Re-exports the platform-appropriate GDAL Rust bindings.
#[cfg(not(windows))]
pub use gdal_unix::*;

#[cfg(windows)]
pub use gdal_windows::*;