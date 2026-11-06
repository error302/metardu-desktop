# TASK: Add a project-scoped, cancellable LAS/LAZ chunk reader for trusted host processing

## Task ID
desktop-pointcloud-host-managed-chunks

## Context read before implementation
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0007-community-extension-ecosystem.md`
- [x] `metardu-v2/docs/decisions/0008-pointcloud-source-store.md`
- [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
- [x] `metardu-v2/docs/decisions/0010-pointcloud-cancellable-inspection.md`
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] `worklog.md` latest point-cloud entries
- [x] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent; no claim that it was read
- [x] Regulatory sources: none required; this task is country-agnostic and produces no statutory output.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — bounded reader, supported LAS/LAZ formats, and cancellation behavior.
- `metardu-v2/packages/metardu-sidecar/src/dispatcher.rs` — private sidecar method registration.
- `metardu-v2/packages/metardu-sidecar/src/plugins.rs` and ADR-0007 — ABI v1 boundary and why point arrays cannot enter its preview input.
- `metardu-v2/apps/desktop/src/main/point-cloud-inspection.ts` — project/source scope, job retention, and IPC conventions.
- `metardu-v2/apps/desktop/src/main/point-cloud-store.ts` — managed paths and source size/hash verification.
- `metardu-v2/apps/desktop/src/main/database.ts` — active project and stored source records.
- `metardu-v2/apps/desktop/src/main/index.ts` and `src/preload/index.ts` — main-process ownership and renderer allowlist.
- `metardu-v2/apps/desktop/src/tests/point-cloud-inspection-controller.test.ts` — real store/test harness patterns.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — current point-cloud gates and limits.

## Hard constraints
- Rust remains the LAS/LAZ decoding authority; no file parsing or geodetic interpretation is added to renderer code.
- The main process accepts only a source ID attached to the active project and resolves the private content-addressed object path itself.
- Verify the retained object's size/hash before stream start and after valid EOF. Changed project/source, decoding failure, count mismatch, cancellation, or digest mismatch must fail closed; no partial result can be treated as complete.
- Chunks are bounded, sequential, and cancellable. No full cloud, storage key, or filesystem path crosses preload or renderer IPC.
- Do not widen the renderer allowlist or ABI v1 plugin preview. This slice exposes a trusted main-process host API only.
- Report the exact supported point dimensions. Omitted Extra Bytes, waveform payloads, flags, CRS, units, epoch, and vertical reference must not be inferred or silently described as available.
- Keep the retained source immutable. Do not add classification, a point-cloud writer, DTM, contours, or survey-grade claims.
- Preserve all unrelated staged and untracked work; stage task paths explicitly.

## Acceptance criteria
- The sidecar streams at most 2,048 points per request from one persistent reader and includes source-order indices plus the documented core/optional dimensions.
- The stream states its coordinate interpretation and omitted dimensions; non-finite coordinates remain explicitly invalid instead of becoming invented zeros.
- Rust tests prove LAS and compressed LAZ chunk contents, scale/offset application, index continuity, bounded chunks, EOF/count mismatch behavior, cancellation, invalid IDs, one active stream, and source bytes unchanged.
- The main-process controller verifies active project/source scope and the managed object digest before and after streaming, owns all paths, and provides no renderer IPC method.
- Desktop tests cover scope, pre/post tampering, active-project change, cancellation, sidecar loss, and terminal cleanup using SQLite and a controlled sidecar.
- Run the focused Rust suite with `--no-default-features --features instrument`, focused Desktop controller tests, Desktop `npx tsc --noEmit`, and the renderer build. Record the default GDAL-enabled build status accurately.
- Append exact verification output and remaining limits to `worklog.md`; update the product plan and ADR with the actual delivered boundary.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- ABI v2, invoking or installing community plugins, and classifier algorithms.
- Writing/persisting derived LAS/LAZ, point-format round trips, or preserving omitted dimensions in outputs.
- Full LAS/LAZ conformance, LAS 1.5, COPC, waveform decoding, or third-party producer certification.
- CRS/units/epoch/vertical-reference interpretation, terrain surfaces, contours, volume outputs, or statutory deliverables.
