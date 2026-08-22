## 2025-02-23 - [Rust Sidecar CI Fixes]
**Issue:** `gdal` bindings failing to compile in CI across platforms. `libdbus-sys` failing on Ubuntu.
**Learning:** `libdbus-1-dev` and `pkg-config` are required on Ubuntu/Linux runners for `btleplug` which depends on `dbus`. The Rust `gdal` crate `0.17` is incompatible with `libgdal` `3.13.1` (which homebrew installs). Bumping `gdal` to `0.18` fixed Mac compilation. Added choco install for `gdal` on Windows.
**Prevention:** Always ensure system C-dependencies match what `cargo build` expects, particularly for `gdal-sys` and `libdbus-sys`.
## 2025-02-23 - [Rust Sidecar CI Fixes Part 2]
**Issue:** More GDAL bindings failing on CI for mac/Windows, and typescript linting errors on export integrations breaking the tests.
**Learning:** Fixing one CI issue sometimes bubbles up others. We resolved multiple typings in the TypeScript exports and the `gdal-sys` version matching for the Rust Sidecar.
**Prevention:** Ensure types match when updating TS configs and be aware that C-libraries like GDAL require strict version parity between what is installed via apt/brew/choco and what is declared in `Cargo.toml`.
## 2025-02-23 - [TypeScript CI fixes]
**Issue:** Build failing on CI due to numerous typescript errors across test suites, main Electron entry files, and UI components.
**Learning:** Fixing one TS error can expose others. The `surveyOutput` type was updated to require explicit `any` casting in `apps/desktop/src/main/index.ts`. Test suites for `instrument-import` were accessing missing interface keys due to missing types.
**Prevention:** Verify all test and build outputs via workspace commands before submitting code, to prevent downstream integration issues.
