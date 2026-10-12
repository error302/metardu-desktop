# TASK: Make the LULC workspace honest about jurisdiction, coordinates, classification, and imagery

## Task ID
desktop-lulc-data-integrity

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] Regulatory source docs: none required; keep this workflow thematic and non-statutory.
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] Most recent worklog entries covering renderer safety and international direction.
- [ ] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is referenced by `AGENT.md` but absent from this checkout (confirmed with `rg --files`).

## Required audit before writing code
- `metardu-v2/apps/desktop/src/renderer/views/LULCView.tsx` — remove fake defaults and unsupported calculations.
- `metardu-v2/apps/desktop/src/renderer/SurveyStateContext.tsx` — confirm save/auto-export behavior.
- `metardu-v2/apps/desktop/src/renderer/countries.ts` — use only explicit jurisdiction context.
- `metardu-v2/apps/desktop/src/renderer/map-geometry.ts` — confirm unrecognized LULC draft geometry does not create a plan export.
- `metardu-v2/packages/metardu-sidecar/` — confirm there is no currently exposed sidecar polygon-area/raster API for this view.

## Hard constraints
- Rust sidecar owns survey-grade geodetic and raster computation. Do not add renderer-side area, CRS, or imagery inference.
- Never silently select a country, CRS, coordinate units, official class scheme, or synthetic geometry.
- Preserve imported coordinate values and label them unverified until their source reference is actually resolved.
- Keep LULC tags explicitly thematic and non-statutory; do not claim regulatory acceptance.
- Keep the renderer sandbox and preload boundary unchanged.

## Acceptance criteria
- [x] No Kenya sample geometry, default jurisdiction, guessed CRS, fabricated raster metadata, keyword/size classifier, or invented confidence survives in the LULC workspace.
- [x] Raw geometry can be previewed and saved/exported as an explicitly unverified draft without area or plan claims.
- [x] Empty and unsupported states explain what evidence or sidecar capability is missing.
- [x] Renderer type-check and relevant desktop verification are recorded verbatim in `worklog.md`; no result is claimed without terminal evidence.
- [x] `git diff --check` is clean.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a dated entry to `worklog.md` with changed paths, exact verification output, and remaining raster/CRS/field-validation gates.

## Out of scope
- Implementing a GeoTIFF parser, raster classifier, sidecar area algorithm, or coordinate-operation pipeline.
- Adding a jurisdiction-specific classification scheme or statutory renderer.
- Changing shared Web/Desktop subscription or entitlement behavior.
