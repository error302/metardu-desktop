# TASK: Inspect and persist record-level LAS/LAZ source evidence

## Task ID
point-cloud-record-inspection

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADRs relevant to this task:
  - [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
  - [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
  - [x] `metardu-v2/docs/decisions/0007-community-extension-ecosystem.md`
  - [x] `metardu-v2/docs/decisions/0008-pointcloud-source-store.md`
  - [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
- [x] Regulatory source: none required; this task reports source-record evidence and is country-agnostic.
- [x] Most recent worklog entries covering point-cloud header inspection and project-linked source storage.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — bounded header parser, LAS/LAZ fixtures, file-path validation.
- `metardu-v2/packages/metardu-sidecar/Cargo.toml` — pinned LAS/LAZ reader and compression support.
- `metardu-v2/apps/desktop/src/main/point-cloud-store.ts` — managed object key resolution and full-file SHA-256 verification.
- `metardu-v2/apps/desktop/src/main/database.ts` — schema migrations and project-linked source records.
- `metardu-v2/apps/desktop/src/main/index.ts` — active-project source scoping and main-owned file paths.
- `metardu-v2/apps/desktop/src/preload/index.ts` and `src/renderer/preload.d.ts` — renderer capability allowlist and types.
- `metardu-v2/apps/desktop/src/renderer/views/PointCloudView.tsx` — source evidence and explicit capability disclosures.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — point-record and classification gates.
- `worklog.md` — latest recorded test/build limitations.

## Hard constraints
- Electron main resolves source IDs only within the active project. Renderer and extension code receive no absolute path, storage key, SQL access, or arbitrary filesystem operation.
- Verify the stored source SHA-256 before and after scanning. Never return or persist scan findings if either verification fails.
- Stream LAS/LAZ point records in bounded reusable batches. Never materialize the full cloud or send its points through JSON IPC.
- Preserve the original object; scan is read-only. Keep integers larger than JavaScript's exact range as decimal strings.
- Report coordinates only after LAS scale/offset decoding; do not infer CRS, axis order, units, epoch, vertical datum, or survey accuracy.
- Record the exact source SHA-256, reader version, declared and decoded counts, and warnings. Report numeric source class codes only; do not claim lookup-table interpretation or a newly computed classification.
- Do not generate a classifier result, DTM, contour, or professional deliverable in this slice.
- A new main-process read capability and schema change require ADR-0009 and a forward-only SQLite migration.

## Acceptance criteria
- [ ] LAS and LAZ point records can be decoded in bounded batches; the source remains byte-identical.
- [ ] Persist a project-linked record-inspection report containing declared/decoded point counts, class counts, return counts compared with header counts, finite decoded coordinate bounds, invalid return/coordinate counts, reader version, source hash, and warnings.
- [ ] A header/record count mismatch, malformed/truncated data, hash mismatch, or unrecognized return inconsistency is visibly reported and is never described as a clean scan.
- [ ] The Point Cloud UI can run and reopen the report for a source attached to the active project. It explains that counts/classes come from source records and are not a classifier or CRS validation.
- [ ] SQLite v3 migrates transactionally to v4 without changing project/source rows; inspection history remains bound to the source digest.
- [ ] Focused Rust, Desktop database/storage, TypeScript, Desktop build, and renderer build checks pass and are appended verbatim to `worklog.md`.
- [ ] `scripts/electron-smoke.sh` is checked; if absent, no GUI IPC runtime proof is claimed.
- [ ] Full default GDAL build/test and broader Rust test failures are recorded without attributing unrelated failures to this feature.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append one dated entry to `worklog.md` describing record decoding, the v3-to-v4 report migration, source-integrity gates, verification outputs, and limits.

## Out of scope
- Automated point classification, editing point classes, or creating a DTM, DSM, contours, or other derived deliverable.
- CRS interpretation or transformation, coordinate-unit inference, or local jurisdiction behavior.
- Cancellable chunk access for community extensions, portable project bundles, or source garbage collection.
- Electron smoke claims when no smoke harness exists.
