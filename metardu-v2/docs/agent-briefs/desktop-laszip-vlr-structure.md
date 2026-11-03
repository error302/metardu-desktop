# TASK: Validate LASzip VLR structure before LAZ record inspection

## Task ID
desktop-laszip-vlr-structure

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADRs:
  - [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
  - [x] `metardu-v2/docs/decisions/0011-las-version-support-gate.md`
  - [x] `metardu-v2/docs/decisions/0012-pointcloud-vlr-sequence-bounds.md`
  - [x] `metardu-v2/docs/decisions/0020-pointcloud-r16-header-extrema.md`
- [x] Most recent worklog entries (last 3+)
- [x] Applicable format reference: OGC LAZ 1.4 Community Standard; this task does not claim LAS 1.4 R16 full conformance.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — inspect LASzip VLR lookup, compressed point format handling, existing special-EVLR boundary behavior, and fixture helpers.
- `metardu-v2/packages/metardu-sidecar/Cargo.toml` — confirm pinned LAS/LAZ reader versions.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — preserve the broader LAS/LAZ conformance gate and current unsupported-feature disclosures.

## Hard constraints
- Keep file reading and format decisions in the Rust sidecar; do not duplicate format math in TypeScript.
- Keep the source read-only and retain hash-bound inspection behavior.
- Use bounded lengths and checked arithmetic before allocating or interpreting records.
- Do not infer CRS, units, epoch, vertical reference, classification correctness, or survey accuracy.
- Non-default LASzip special-EVLR references stay explicitly incomplete; do not guess their layout.
- Do not claim full LAS 1.4 R16, LAZ, or producer interoperability conformance from this slice.
- Preserve unrelated staged and untracked work. Commit only task-owned paths.

## Acceptance criteria

### Build and tests
- [x] `cargo build --release --no-default-features --features instrument` in `metardu-v2/` succeeds for the GDAL-free feature set; the exact command and result are recorded in `worklog.md`.
- [x] `cargo test --release --no-default-features --features instrument` passes the full sidecar suite; the exact result is recorded in `worklog.md`.
- [x] No shared IPC/UI contract changed; the existing Desktop point-cloud tests and TypeScript builds were not needed for this sidecar-only change.
- [x] `git diff --check` succeeds.

### Format-specific behavior
- [x] A compressed source has exactly one LASzip VLR before its records are inspected.
- [x] Truncated LASzip fixed fields, truncated item records, mismatched item-count/record-data lengths, and point-size mismatches fail closed before LAZ boundary reporting.
- [x] Valid pointwise and chunked LAZ fixtures retain their current bounded/incomplete semantics.
- [x] Non-default special-EVLR references remain incomplete and are not treated as validated extents.

### Documentation and delivery
- [x] Update the international product plan with the exact validation gained and remaining LAS/LAZ gaps.
- [x] Correct the stale extension statement about the implemented local `.mdplug` installer/runner.
- [x] Append actual verification output and evidence limits to the root `worklog.md`.
- [ ] Commit task-owned files only and push to `https://github.com/error302/metardu-desktop.git` on the current Desktop branch; verify remote tip.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- LAS 1.5 reader support.
- Full LAS 1.4 R16, LAZ, waveform-payload, VLR-semantic, padding, or producer-interoperability conformance.
- Classification, derived-cloud writing, community plugin point-cloud capabilities, CRS interpretation, or survey-grade claims.
