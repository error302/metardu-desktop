# TASK: Import LAS/LAZ sources into a durable active-project source store

## Task ID
desktop-pointcloud-project-source-store

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADRs:
  - [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
  - [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
  - [x] `metardu-v2/docs/decisions/0007-community-extension-ecosystem.md`
  - [x] `metardu-v2/docs/decisions/0008-pointcloud-source-store.md`
- [x] Regulatory source: none required; this is a country-agnostic file-storage task, not a statutory renderer.
- [x] Most recent worklog entries, including the 29 October 2026 point-cloud inspector entry.
- [x] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent in this checkout; do not treat it as inspected evidence.

## Required audit before writing code
- `metardu-v2/apps/desktop/src/main/database.ts` — schema versioning and project CRUD.
- `metardu-v2/apps/desktop/src/main/projects.ts` — database initialization and active-project lifecycle.
- `metardu-v2/apps/desktop/src/main/index.ts` — main-process IPC registration, sidecar call, file picker.
- `metardu-v2/apps/desktop/src/preload/index.ts` — narrow contextBridge API.
- `metardu-v2/apps/desktop/src/renderer/views/PointCloudView.tsx` — current header-inspection screen.
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — bounded source-header parser.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — current point-cloud gates.
- `worklog.md` — previous evidence and uncompleted gates.

## Hard constraints
- Electron main owns file selection, hashing, copying, and database writes. The renderer and plugins never receive a source path or arbitrary filesystem capability.
- Preserve the user-selected original; create a separate app-managed copy through streaming I/O and record the exact copied-byte SHA-256.
- A source is attached only to an existing active project. A neutral project remains neutral; do not infer jurisdiction, CRS, units, epoch, or vertical reference from a file header.
- Existing SQLite project data must survive the forward-only schema migration. Project deletion must not automatically delete source blobs.
- The stored source is read-only by product API. Never overwrite an existing content-addressed object; verify a pre-existing object before deduplication.
- Offline operation is required. No catalog, account, or network service is involved.
- The new file-capable IPC boundary is covered by ADR-0008; expose only typed import/list actions through the preload bridge.
- Classification, full point-record validation, source cleanup, project backup/export, and plugin access are outside this slice.

## Acceptance criteria
- [x] The native-pick import route stages the selected LAS/LAZ file with constant-memory streaming and SHA-256, inspects the staging copy, then publishes a verified content-addressed copy. Storage/hash unit tests pass; Electron IPC runtime remains unverified because this checkout has no smoke harness.
- [x] Invalid header inspection exits before publication or database insertion; staging cleanup runs in `finally`. The selected original is only read.
- [x] SQLite schema v2 migrates to v3 transactionally without changing existing project rows; source records retain project association, basename, storage key, exact hash, byte length, detected format, header metadata, and import time.
- [x] Source listing uses the active project and renderer-visible records contain no absolute path or storage key. Listing after a real restart has not been exercised in Electron.
- [x] Identical content in a project reuses a verified object and source record; the storage and database tests cover deduplication and project deletion detaches metadata without deleting the blob.
- [x] Source blobs are not automatically deleted when project records are deleted; cleanup remains a separate future, reviewable operation.
- [x] Focused storage/hash/migration tests, Desktop and renderer builds, TypeScript checks, `git diff --check`, and focused Rust header tests pass; results and broader-suite limitations are recorded in `worklog.md`.
- [x] `scripts/electron-smoke.sh` was checked and is absent in this checkout; no IPC runtime smoke evidence is claimed.
- [x] Full-file re-verification accepts only a source ID attached to the active project and reports the recorded and actual digest/size without exposing storage paths.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append one dated entry to `worklog.md` describing the artifact store, project-link schema migration, verification commands and actual output, runtime limits, and next point-record/classification gates.

## Out of scope
- Reading or classifying point records.
- Generating a DTM, contours, or any professional deliverable.
- CRS inference, transformation, or local jurisdiction behavior.
- Plugin reads, source deletion/garbage collection, cross-device sync, backup bundles, or account changes.
