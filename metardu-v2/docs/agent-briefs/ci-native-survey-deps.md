# TASK: Restore native geospatial dependency setup across CI build matrices

## Task ID
ci-native-survey-deps

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADR: `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] ADR: `metardu-v2/docs/decisions/0005-integration-export-workflow-family.md`
- [x] Regulatory sources: none required; this task changes country-agnostic CI dependencies only.
- [x] Recent worklog entries, including the GDAL Windows build failure and CRS safety addendum.

## Required audit before writing code
- `.github/workflows/ci.yml` — Rust and TypeScript build matrix dependency steps.
- `.github/workflows/release.yml` — all release jobs that compile the Rust sidecar.
- `metardu-v2/packages/metardu-sidecar/Cargo.toml` and `gdal-sys` build diagnostics — native library requirements.

## Hard constraints
- Do not change survey math, CRS selection, country rules, or renderer behavior.
- Preserve Rust as the owner of geodetic and raster computation.
- Preserve offline-first behavior; add build-runner packages only.
- Pin third-party GitHub Actions to immutable revisions.
- Do not add secrets or credentials to the repository.

## Acceptance criteria (independently verifiable)

### Build
- [ ] GitHub Actions Rust sidecar matrix builds and tests on Ubuntu, Windows, and macOS.
- [ ] GitHub Actions TypeScript matrix builds all three Node versions.
- [ ] Release Linux/macOS sidecar build dependency lists include DBus development libraries.
- [ ] macOS CI and release install LLVM and set `LIBCLANG_PATH` from `brew --prefix llvm`.
- [ ] GDAL 3.13 builds use the published GeoRust 0.19.0 crate with a documented local vendor patch matching the merged upstream compatibility changes, until a published release includes them.
- [ ] Windows CI locates the installed `gdal_i.lib`, GDAL headers, and version macros; sets `GDAL_LIB_DIR`, `GDAL_INCLUDE_DIR`, and `GDAL_VERSION`; and executes Cargo inside the OSGeo4W environment.
- [ ] GCP export resolves the display name for the configured `primarySRID`, so multi-zone countries cannot emit a different zone label; existing Node-matrix coverage passes.

### Tests
- [ ] Existing CI package and sidecar test jobs pass; no new product tests are introduced.
- [ ] Existing Electron sidecar ping integration test passes with the single-reader stdin loop.
- [ ] Workflow YAML parses and `git diff --check` passes; no new product tests are introduced.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a `worklog.md` entry with exact local validation output and the GitHub Actions result for this PR. Identify any matrix cells that remain pending or fail.

## Out of scope
- Repairing release packaging architecture or Windows cross-compilation.
- Changing CRS selection, numeric transforms, the CRS database, or the survey UI. GCP export only labels the primary SRID it already selects.
- Merging this PR or the separate CRS PR.
