# TASK: Report the enclosing point-data block boundary for pointwise LAZ

## Task ID
pointwise-laz-block-boundary

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant decisions:
  - [x] `metardu-v2/docs/decisions/0011-fail-closed-las-laz-version-support.md`
  - [x] `metardu-v2/docs/decisions/0012-bound-las-laz-vlr-sequence.md`
  - [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
- [x] Regulatory sources: none; this format-structure slice is country-agnostic.
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] Recent point-cloud entries in root `worklog.md`.
- [x] OGC LAZ 1.4 Community Standard clauses 6.5, 7.1, 9.5, and 11.2.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — pointwise and chunked LAZ layout branches, EVLR boundaries, fixtures.
- `metardu-v2/apps/desktop/src/shared/point-cloud.ts` — persisted file-structure contract.
- `metardu-v2/apps/desktop/src/renderer/views/PointCloudView.tsx` — current extent display.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — current point-cloud scope and limits.
- `worklog.md` — existing build and verification limits.

## Hard constraints
- Keep the source file read-only and preserve source hashes and existing project-scoped IPC boundaries.
- Do not infer an exact arithmetic-stream end from point count or decoder read position. LAZ arithmetic streams have no end marker.
- Distinguish the enclosing block boundary (first ordinary EVLR or EOF) from the exact stream end, which remains unknown for pointwise LAZ.
- If LASzip special-EVLR references are not the reserved `(-1, -1)` pair, leave the pointwise block boundary unresolved and retain an incomplete status.
- Do not infer CRS, units, epoch, vertical datum, classification correctness, or accuracy.
- Preserve unrelated staged and untracked work; stage only task-owned paths.

## Acceptance criteria
- [x] A pointwise LAZ report exposes its enclosing data-region end and byte count when ordinary EVLR references are absent and a valid ordinary EVLR sequence or EOF supplies the boundary.
- [x] `pointDataEndByte` remains null for pointwise LAZ; the UI labels the new field as a region/block boundary and explains that an exact stream end is not marked.
- [x] A non-default LASzip special-EVLR reference remains incomplete and does not receive a guessed boundary.
- [x] A fixture derived from a single valid chunk decodes the declared points as compressor type 1 and covers both EOF and first-EVLR boundaries.
- [x] Focused Rust tests, release sidecar build/tests without unavailable native GDAL, Desktop TypeScript/tests, and renderer build are run; actual output and any environment limitation are appended verbatim to `worklog.md`.
- [x] The change is committed and pushed only to `https://github.com/error302/metardu-desktop.git` after verifying the exact staged paths.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Detecting an exact pointwise arithmetic-stream end or separating in-block padding from trailing bytes.
- Interpreting LASzip special EVLRs, waveform payloads, or VLR schemas.
- Point classification, chunk streaming to plugins, CRS interpretation, or professional deliverable generation.
- Claiming full LAS/LAZ conformance or producer interoperability.
