# TASK: Correct Kenya UTM definitions against EPSG records

## Task ID
kenya-epsg-crs-correction

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0004-kenya-as-reference-country.md`
- [x] No statutory drawing layout changes; this is CRS catalog data.
- [x] Recent `worklog.md` entries.

## Required audit before writing code
- `packages/country-config/src/countries/kenya.ts` — EPSG identifiers, names, axes, ellipsoid and zone parameters.
- `packages/country-config/src/tests/kenya.test.ts` — current assertions that encode the questionable values.
- `packages/engine/src/geodesy/crs-database.ts` — legacy Kenya registry duplicates.
- `packages/engine/src/gnss/index.ts` and `packages/engine/src/flight-planning/gnss.ts` — duplicated Arc 1960 / WGS 84 helpers and round-trip claims.
- `packages/metardu-sidecar/src/geodesy/{mod.rs,projection.rs}` and `compute_handlers.rs` — ellipsoid lookup and known-answer projection tests.
- `tests/golden-fixtures/kenya/projection__utm37s-forward-inverse.json` — source CRS, expected values and stated precision.

## Hard constraints
- Sidecar Rust remains the sole owner of projection math.
- EPSG identifiers and CRS parameters must match an identified registry entry; never assign an EPSG code to an illustrative/custom CRS.
- Do not enable Arc 1960-to-WGS84 output through EPSG operation 1122 as survey-grade. EPSG's published operation has metre-level accuracy; leave cross-datum output blocked until a locally appropriate, verified operation is available.
- Arc 1960 ↔ WGS 84 TypeScript helpers must fail closed while the Rust sidecar has no locally validated survey-grade operation; do not label the EPSG:1122 reverse or round-trip as surveyed truth.
- Do not claim Nairobi Cassini support without verified origin, false offsets, CRS identity, area of use, and an independent fixture.
- Preserve unrelated working-tree changes and append to, never overwrite, `worklog.md`.

## Acceptance criteria
- [x] Kenya's supported UTM zones 36S, 37S, 36N and 37N use their correct EPSG codes and parameters.
- [x] Arc 1960 uses the ellipsoid recorded for EPSG:21036/21037 (Clarke 1880 (RGS)), and Rust lookup accepts the exact configured name.
- [x] No fabricated Cassini EPSG entry or unsupported Cassini-to-UTM identity transform is exposed.
- [x] Forward projection fixtures for Nairobi and Mombasa agree with an independent EPSG:4210-to-21037 reference within the declared projection tolerance.
- [x] Duplicated Arc 1960 ↔ WGS 84 helpers fail closed; their fixture records EPSG:1122 direction and accuracy without calling a reversible calculation survey-grade.
- [x] Focused Rust, country-config and CRS-database checks pass; remaining environment failures are reported without claiming full verification.
- [x] Append evidence and the limitation on cross-datum transformations to `worklog.md`.

## Out of scope
- Implementing a general datum-operation engine or enabling Arc 1960-to-WGS84 export.
- Building the international operation catalogue or bundling authoritative datum and geoid grids. The renderer panel is handled in a follow-up and now reports unavailable operations without synthetic accuracy claims.
- Reconstructing historical Kenya Cassini CRSs without authoritative local control documentation.
- Auditing every other country's CRS profile in this task.
