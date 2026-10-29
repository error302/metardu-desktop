# TASK: Bound declared LAS/LAZ VLR sequences before header decoding

## Task ID
desktop-pointcloud-vlr-sequence-bounds

## Context read before implementation
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADRs: `0007`, `0008`, `0009`, `0010`, `0011`
- [x] Country-specific regulatory source: none; this is a country-agnostic LAS/LAZ byte-boundary check.
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] Latest point-cloud entries in `worklog.md`

## Required audit before code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — header preflight order, VLR/EVLR decoding, file-structure report, and generated LAS/LAZ fixtures.
- `metardu-v2/packages/metardu-sidecar/Cargo.toml` — pinned `las-rs` and LAZ reader versions and resource limits.
- `metardu-v2/docs/decisions/0011-las-version-support-gate.md` — accepted LAS/LAZ version boundary.
- `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md` — read-only inspection and CRS/evidence limits.

## Hard constraints
- Rust remains the LAS/LAZ parser and the sole point-record decoding authority.
- Preflight stays bounded by the existing count and metadata byte limits; no full metadata or point cloud is loaded into memory.
- Reject VLR headers or payloads crossing the declared point-data offset or file size before `las-rs` parses them.
- Report gap bytes without assuming they are valid padding or assigning them a record type.
- Do not mutate source bytes, infer CRS/units/epoch/vertical datum, classify points, or create a survey deliverable.
- This task does not establish full LAS 1.4 Revision 16 conformance. OGC LAZ 1.4 R1 references LAS 1.4 R15.

## Acceptance criteria
- [ ] Declared VLR count and each 54-byte header/payload extent are walked with checked offsets and fail closed on an overrun.
- [ ] The record structure report includes VLR count, sequence start/end, interstitial byte count, and whether all interstitial bytes are zero.
- [ ] The Point Cloud inspection panel shows those VLR boundaries and labels any pre-point gap as unclassified without calling it valid padding.
- [ ] Fixtures prove malformed payload rejection and that zero/nonzero gaps remain unclassified while declared points decode unchanged.
- [ ] Focused Rust tests, sidecar release build, and release test suite pass; append verbatim output to `worklog.md`.
- [ ] `git diff --check` passes; no renderer or IPC API changes are made.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- LASzip special EVLR layouts, pointwise LAZ compressed-data end, waveform packet validation, COPC hierarchy/index support, and complete LAS/LAZ producer conformance.
- Point-cloud chunk streaming, plugin API changes, classification, DTM/DSM generation, and portable project bundles.
- CRS, units, epoch, vertical reference, or statutory interpretation.
