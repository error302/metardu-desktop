# TASK: Make LAS/LAZ record inspection cancellable and observable

## Task ID
desktop-pointcloud-cancellable-inspection

## Context read before implementation
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0008-pointcloud-source-store.md`
- [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
- [x] `metardu-v2/docs/decisions/0007-community-extension-ecosystem.md`
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] `worklog.md` latest point-cloud entries
- [x] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent; no claim that it was read

## Required audit before code
- `metardu-v2/packages/metardu-sidecar/src/main.rs` and `dispatcher.rs` — request lifecycle and background task support.
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — bounded record batch loop and result contract.
- `metardu-v2/packages/electron-integration/src/index.ts` — request timeout behavior.
- `metardu-v2/apps/desktop/src/main/index.ts` — project scoping, source hash checks, and report persistence.
- `metardu-v2/apps/desktop/src/preload/index.ts` — existing narrow bridge and method allowlist.
- `metardu-v2/apps/desktop/src/renderer/views/PointCloudView.tsx` and `src/shared/point-cloud.ts` — existing scan UI and types.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — point-cloud validation and chunk-access gates.

## Hard constraints
- The Rust sidecar remains the point-record decoding authority. Do not move LAS/LAZ decoding into TypeScript or the renderer.
- Electron main resolves only a source ID attached to a project and keeps filesystem paths and storage keys private.
- Verify the retained source hash before scanning and again before persisting a completed report. A cancelled, failed, stale-project, or hash-mismatched job must not save a report.
- Do not mutate the retained source or expose point arrays to the renderer.
- New job controls use dedicated, typed IPC handlers. Do not widen the renderer's generic sidecar method allowlist.
- Cancellation is cooperative and checked between bounded point batches; the UI must say the current batch may finish before cancellation takes effect.
- One active record scan at a time; completed job state is bounded and expires. Invalid, stale, or foreign job IDs fail closed.
- This task adds progress/cancellation to inspection only. It does not claim a host-managed point-stream API, point classification, full LAS/LAZ conformance, or survey-grade output.

## Acceptance criteria
- Start, status, and cancel operations are available through source-ID/project-scoped main-process handlers.
- Progress reports decoded versus source-header-declared point count without transferring point arrays or paths.
- Cancellation stops between batches and never persists partial inspection evidence.
- Completion rechecks the source digest, confirms the originating project remains active, and persists exactly one digest-bound inspection report.
- Rust job lifecycle/cancellation tests and Desktop controller tests cover success, cancellation, failure, and invalid job/source scope. The controller suite uses the production route binder, SQLite, and managed object store with a controlled sidecar double; it does not launch Electron or cover the renderer UI.
- Desktop typecheck/build and focused Rust/Desktop tests pass. Electron runtime and UI behavior are claimed only if the harness exercises those paths.
- Update the product plan and append verbatim verification evidence and remaining limits to `worklog.md`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Point-cloud chunk delivery to community modules or ABI v2.
- Any classification algorithm, DTM/DSM, contours, or professional point-cloud deliverable.
- Full validation of pointwise LAZ, waveform payloads, special EVLRs, all padding, or producer interoperability.
- CRS, units, epoch, or vertical-reference interpretation.
