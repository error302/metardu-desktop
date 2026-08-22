## 2025-02-23 - [Rust Sidecar CI Fixes]
**Issue:** `gdal` bindings failing to compile in CI across platforms. `libdbus-sys` failing on Ubuntu.
**Learning:** `libdbus-1-dev` and `pkg-config` are required on Ubuntu/Linux runners for `btleplug` which depends on `dbus`. The Rust `gdal` crate `0.17` is incompatible with `libgdal` `3.13.1` (which homebrew installs). Bumping `gdal` to `0.18` fixed Mac compilation. Added choco install for `gdal` on Windows.
**Prevention:** Always ensure system C-dependencies match what `cargo build` expects, particularly for `gdal-sys` and `libdbus-sys`.
