# TASK: Fail closed on unsupported WGS84 reprojection

## Task ID
crs-reprojection-fail-closed

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADR: `metardu-v2/docs/decisions/0005-integration-export-workflow-family.md`
- [x] This task is country-agnostic; no statutory document output is changed.
- [x] Recent entries in `worklog.md`

## Scope
Make WGS84 export and map-overlay reprojection all-or-nothing. A country
fallback, missing sidecar, unsupported projection, or failed point transform
must never produce coordinates labelled EPSG:4326. Reprojection through the
current inverse-projection handlers is allowed only when the configured source
datum is WGS 84; other datums require a complete, explicitly supported datum
operation before conversion.

## Hard constraints
- Rust sidecar remains the only owner of coordinate math.
- Never guess a country, CRS, projection zone, or datum operation.
- Preserve the native-CRS export path and its CRS declaration.
- Do not introduce a new IPC capability or widen the preload allowlist.

## Acceptance criteria
- [ ] Offline sidecar, non-WGS84 datum, unknown SRID, or unsupported projection cannot create a WGS84 export.
- [ ] GeoJSON rejects a failed coordinate transform instead of mixing projected and geographic coordinates.
- [ ] Map overlays and projected-coordinate search show a visible error instead of applying a TypeScript fallback.
- [ ] Existing supported WGS84 projected-coordinate conversion and native-CRS export behavior remain covered by focused tests/build checks.
- [ ] Append evidence and remaining limitations to `worklog.md`.

## Out of scope
- Implementing complete datum transformations or bundling regional shift grids.
- Claiming that every country or CRS can be transformed to WGS84.
- Reformatting or committing unrelated pre-existing working-tree changes.
