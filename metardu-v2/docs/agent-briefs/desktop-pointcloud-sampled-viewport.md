# TASK: Add a bounded, source-verified point-cloud viewport

## Task ID
desktop-pointcloud-sampled-viewport

## User outcome
Let a surveyor visually inspect existing LAS/LAZ point classes from an active Desktop project without sending a full cloud or source path to the renderer.

## Hard constraints

- Accept only an opaque point-cloud source ID linked to the active project. The main process resolves the managed object.
- Use the existing bounded LAS/LAZ chunk stream and require its full source hash checks before and after a complete declared-point scan.
- Publish no sample after cancellation, source detachment, project change, count mismatch, sidecar failure, or integrity failure.
- Select points deterministically using a systematic source-index stride and cap the delivered sample at 25,000 finite XYZ records. Report the stride, counts, and method; call out possible spatial-order bias.
- Render only coordinates and class values actually read from the source. METARDU colors are a display key; do not alter class values or imply classifier validation.
- Preserve unresolved CRS, units, coordinate epoch, and vertical reference. Show local axes only; the viewport is not for measurement or a survey deliverable.
- Keep output in memory, bounded by the sample cap, with expiry and cancellation. Do not add file writing, persistent derived artifacts, or classifications.
- Preserve unrelated staged and untracked user work; stage only task-owned paths.

## Acceptance criteria

- Main/preload IPC exposes start, progress/status, and cancel by validated source/job IDs only.
- The UI supports bounded class-color filtering, rotate/zoom, keyboard controls, source and sample evidence, and clear non-measurement limitations.
- Every job reads the full declared source range and publishes only after validated stream completion and final SHA-256 check.
- Focused tests cover sample stride/cap, count/index failure, cancellation discard, and IPC schema limits.
- Desktop typecheck, relevant tests, renderer build, formatting, and `git diff --check` pass.

## Out of scope

- Running a classifier, creating a terrain surface, exporting a derived cloud, or validating a source class scheme.
- COPC indexing, spatial queries, LAS/LAZ conformance beyond existing checks, CRS transformation, or field performance claims.
