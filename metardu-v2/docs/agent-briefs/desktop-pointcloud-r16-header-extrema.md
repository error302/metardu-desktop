# TASK: Compare decoded LAS point extrema with R16 header bounds

## Task ID
desktop-pointcloud-r16-header-extrema

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADRs relevant to this task:
  - [x] `metardu-v2/docs/decisions/0009-pointcloud-record-inspection.md`
  - [x] `metardu-v2/docs/decisions/0011-las-version-support-gate.md`
  - [x] `metardu-v2/docs/decisions/0014-las-classification-interpretation.md`
- [x] Regulatory source: none required; this task checks country-agnostic LAS file metadata and creates no statutory output.
- [x] Most recent point-cloud worklog entries.
- [x] `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent; do not claim to have read it.

## Required audit before writing code
- `metardu-v2/packages/metardu-sidecar/src/import/point_cloud.rs` — current decoded extrema and header-containment checks.
- `metardu-v2/apps/desktop/src/shared/point-cloud.ts` — persisted record-inspection report shape and older report compatibility.
- `metardu-v2/apps/desktop/src/renderer/views/PointCloudView.tsx` — current record-inspection evidence display.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — current LAS/LAZ validation gate and R16 source.
- `metardu-v2/docs/STATUS-AND-REMAINING.md` — remove the stale claim that Desktop already classifies LiDAR.

## Hard constraints
- Rust remains the LAS/LAZ decoding authority; TypeScript only displays the new report field.
- Do not alter, normalize, or rewrite the imported LAS/LAZ source.
- Compare declared coordinate extrema to decoded coordinates after LAS scale and offset only. Do not interpret CRS, units, epoch, or vertical reference.
- Use only a small floating-point representation tolerance. It must not be described as a positional accuracy tolerance.
- An incomplete declared point range, non-finite point, or non-finite header bound makes the comparison inconclusive, not a pass.
- Existing persisted reports may not contain the new optional field; keep them readable.
- Preserve unrelated staged and untracked work. Stage only task-owned paths.

## Acceptance criteria
- Report whether all decoded LAS header min/max XYZ values match the scanned point extrema within a documented binary64 representation tolerance.
- For a zero-point file, only six zero-valued header extrema count as a match; do not derive extrema from empty values.
- Keep the existing containment result and its warning while applying a consistent representation tolerance.
- Add fixtures for an exact match, a stale but enclosing header extent, an inconclusive comparison, and zero-point bounds.
- Display the new status in the Point Cloud view with a clear note that it checks file consistency, not survey accuracy.
- Correct the historical status page's unsupported claim that LiDAR classification and DTM/DSM generation are complete.
- Update the international product plan and add an ADR with the narrow boundary and remaining LAS/LAZ conformance gaps.
- Run the focused Rust tests, required repository tests/builds that apply, TypeScript checks, renderer build, and `git diff --check`; record exact output in `worklog.md`.
- Commit only task-owned files to the configured Desktop repository branch and verify the commit locally; push when the configured remote is reachable.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Complete LAS/LAZ Revision 16 conformance, waveform packet parsing, LASzip special-EVLR validation, or producer certification.
- Any coordinate transformation, accuracy certification, classification algorithm, LAS/LAZ writer, DTM/DSM, or contour generation.
- A claim that source data is fit for survey delivery.
