# TASK: Show version-aware meanings for existing LAS classification codes

## Task ID
desktop-las14-class-interpretation

## Context read before implementation
- [x] `AGENT.md`
- [x] `docs/invariants.md`
- [x] `docs/decisions/0007-community-extension-ecosystem.md`
- [x] `docs/decisions/0013-pointcloud-host-managed-chunks.md`
- [x] `docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] Latest point-cloud entries in `worklog.md`
- [x] Regulatory sources: none required; the task interprets LAS metadata and produces no statutory output.

## Required audit before writing code
- `packages/metardu-sidecar/src/import/point_cloud.rs` — record scan, point-format family, VLR access, warnings, and fixture patterns.
- `apps/desktop/src/shared/point-cloud.ts` — persisted renderer-safe inspection shape and backwards-compatible report fields.
- `apps/desktop/src/renderer/views/PointCloudView.tsx` — existing numeric class display and evidence wording.
- `docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — existing limitation and LAS/LAZ workflow gates.
- ASPRS LAS 1.4 classification tables and R16 release change summary — version/format-specific names and changes.

## Hard constraints
- Keep every original numeric class code and count visible; never rewrite source points.
- Interpret base names only for LAS 1.4 and select legacy versus modern meanings from the point data record format.
- Preserve source-provided lookup descriptions separately from standard meanings; malformed or duplicate lookup metadata is ignored with a warning.
- Leave codes requiring a domain profile unresolved. A label does not prove the points were classified correctly.
- Do not add a classifier, derived point-cloud writer, CRS/units inference, or professional-delivery claim.
- Preserve unrelated staged and untracked work; stage only this task's allowlisted files.

## Acceptance criteria
- LAS 1.4 point formats 0-5 and 6-10 use their respective base class tables, including the different meaning of code 12.
- LAS versions outside 1.4 keep raw numeric meanings unless a valid source lookup description is separately shown.
- A Classification Lookup VLR is used only when it has 256 unique class numbers, the expected fixed-size payload, and printable ASCII descriptions.
- Domain-profile codes and source descriptions remain clearly unvalidated; older saved reports render through a numeric fallback.
- Rust tests cover standard, reserved, profile-dependent, user-defined, legacy/modern version-sensitive, malformed lookup, and duplicate lookup cases.
- Desktop typecheck, focused Rust tests, Desktop tests, renderer build, and `git diff --check` pass. Append verbatim terminal evidence and remaining limitations to `worklog.md`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Running a new point-cloud classification algorithm.
- Validating LAS domain profiles or classification correctness.
- Writing derived LAS/LAZ, surfaces, contours, or statutory deliverables.
- Claiming whole-file conformance, third-party producer compatibility, or field validation.
