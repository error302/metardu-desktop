# TASK: Preserve absent NMEA GGA/GSA measurements without zero defaults

## Task ID
desktop-nmea-absent-observation-semantics

## User outcome
When a GNSS receiver omits a GGA/GSA field, METARDU retains that field as unavailable; it does not report an invented coordinate, height, unit, fix, satellite count, or DOP value.

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] `metardu-v2/docs/decisions/0018-nmea-absent-observation-semantics.md`
- [x] Latest root `worklog.md` entries
- [x] `metardu-v2/packages/metardu-sidecar/src/instrument/nmea.rs`
- [x] `metardu-v2/packages/engine/src/gnss/index.ts`
- [x] `metardu-v2/packages/engine/src/flight-planning/gnss.ts`

The `AGENT.md` reference to `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent in this checkout. This task does not change build order or regulatory commitments; it implements the existing plan's requirement to preserve raw instrument observations and avoid unsupported values.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/instrument/nmea.rs` — inspect NMEA dispatch, GGA/GSA data structs, parsers, coordinate helpers, and tests.
- `metardu-v2/packages/engine/src/gnss/index.ts` and `metardu-v2/packages/engine/src/flight-planning/gnss.ts` — inspect duplicated public parser types, GGA/GSA parsers, quality calculations, and downstream consumers.
- Their corresponding `tests/gnss.test.ts` files — inspect current fixtures and quality expectations.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — preserve raw field provenance and explicit quality boundaries.

## Hard constraints
- Empty numeric fields map to `null`/`None`, while the literal numeric value `0` remains a valid measured value.
- Never default absent GGA altitude or geoid units to `M`.
- Reject malformed non-empty numeric fields instead of parsing prefixes or replacing them with zero.
- Preserve the original raw NMEA sentence for accepted messages; retain rejected GGA/GSA lines as raw-only `nmea_rejected` serial records, and leave typed checksum acceptance unchanged.
- Do not infer CRS, horizontal datum, coordinate epoch, local height datum, or transformed height from a GGA sentence.
- Keep GGA altitude and geoid separation separate; do not compute an ellipsoidal or local-datum height.
- Keep the renderer sandboxed and do not add IPC or filesystem capabilities.
- Preserve the pre-existing staged deletion and unrelated untracked work. Commit only task-owned paths.

## Acceptance criteria
- [x] Rust GGA/GSA and both TypeScript parser copies expose missing measurements as nullable and preserve explicit zeros.
- [x] Missing units remain null; present units remain exactly as received.
- [x] Malformed non-empty numbers and invalid/out-of-range GGA coordinates are rejected.
- [x] Missing fix/DOP inputs remain explicitly unavailable in quality metrics; an explicit fix-quality `0` remains `no_fix`.
- [x] Rust and TypeScript tests cover valid, empty, zero, malformed, partial-coordinate, and range-boundary cases.
- [x] Serial tests confirm rejected GGA/GSA fields remain inspectable as raw records without parsed coordinates or quality metrics.
- [ ] Default `cargo test` in `packages/metardu-sidecar/` passes; currently blocked before test compilation because this Windows environment lacks `gdal_i.lib`.
- [x] `cargo build --release --no-default-features --features instrument` and both debug/release `cargo test --no-default-features --features instrument` suites pass.
- [x] Engine GNSS tests and both package `npx tsc --noEmit` checks pass.
- [ ] Exact verification output and delivery SHA are appended to the root `worklog.md`.
- [ ] `git diff --check` passes; only task-owned paths are committed and pushed to the configured METARDU Desktop branch.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- NMEA RMC/GLL and non-NMEA instrument parser defaults.
- Coordinate transformation, geoid interpolation, or local vertical-datum validation.
- Receiver-family interoperability or field-validation claims.
- Point-cloud classification and community plug-in distribution.
