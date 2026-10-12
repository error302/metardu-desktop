# TASK: Produce explicit, spec-shaped DJI WPML mission packages

## Task ID
flight-planning-dji-wpml-export

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADRs:
  - [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
  - [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
  - [x] `metardu-v2/docs/decisions/0005-integration-export-workflow-family.md`
- [x] Regulatory source docs: none required; this is a device mission package, not a statutory document.
- [x] Recent worklog entries read.
- [ ] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is referenced by `AGENT.md` but is absent from the checkout; its contents were not inferred.

## Required audit before writing code
- `metardu-v2/packages/engine/src/flight-planning/export/dji-kmz.ts` — inspect existing serialization, vertical references, validation, and ZIP handling.
- `metardu-v2/packages/engine/src/flight-planning/import/index.ts` — ensure import reads the emitted executable route and preserves height reference.
- `metardu-v2/packages/engine/src/geodesy/geoid.ts` — preserve explicit local-grid and fail-closed height rules.
- `metardu-v2/packages/engine/src/flight-planning/tests/export.test.ts` and `tests/import.test.ts` — cover package structure, evidence refusal, and round trips.

## Hard constraints
- Rust remains the authority for geodetic transformations; this change accepts explicit WGS84 heights and an explicit geoid grid and does not add a second transform implementation.
- Offline-first behavior: no hidden network fetch or guessed vertical datum. EGM96 conversion requires a caller-supplied metadata-bearing grid.
- The test grid is synthetic and validation-only. It is not evidence of an authoritative installed EGM96 model, and checksum metadata is not proof that grid bytes were verified.
- No new IPC channel, filesystem privilege, survey type, or statutory renderer is added.
- Do not claim that desktop users can export missions through the UI; current UI wiring is outside this task.

## Acceptance criteria

### Build and type checks
- [x] `npm run build --workspace @metardu/engine-flight-planning` — exit 0.
- [x] `npm run lint --workspace @metardu/engine-flight-planning` — exit 0, no TypeScript diagnostics.
- [x] `npx tsc --noEmit` in `apps/desktop/` — exit 0, no diagnostics.
- [ ] `cargo build --release` and `cargo test --release` — attempted; both stop in `gdal-sys` because Windows GDAL import library `gdal_i.lib` is absent from `GDAL_LIB_DIR`/`GDAL_HOME`.

### Tests
- [x] Focused mission tests: 50 passed across export/import files.
- [x] Full engine suite: 862 passed across 45 files.
- [x] E2E suite: 23 passed, 5 skipped.
- [x] Golden numeric fixture suite was not changed.

### Product boundaries
- [x] DJI KMZ contains `wpmz/template.kml` and `wpmz/waylines.wpml`, with explicit aircraft/payload identity, EGM96 template heights, WGS84 execution heights, and operational height/speed settings.
- [x] Export refuses missing ellipsoid heights, grid metadata/coverage, or mission profile data.
- [x] ArduPilot, Litchi, senseFly, and generic KML exports refuse explicitly referenced imported heights when they lack a validated vertical conversion.
- [x] `git diff --check` — no whitespace errors; existing CRLF normalization notices were emitted for unrelated dirty files.
- [ ] The current flight-planning screen still lacks user-defined survey-area and DJI export workflows; no authoritative EGM96 model package or byte-verifying loader is installed. These remain product release gates.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append verification evidence and product limitations to `worklog.md`; never overwrite it.

## Out of scope
- Integrating a mission editor/export screen or selecting a survey polygon.
- Installing and byte-verifying an authoritative EGM96 grid package.
- Validating DJI execution on physical aircraft or certifying aircraft-specific safety limits.
- Global CRS catalog expansion, statutory country documents, or regulatory approval.
