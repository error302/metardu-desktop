# TASK: Connect Delivery QA feature requirements to topographic point codes

## Task ID

topographic-feature-code-evidence-v1

## Context

The previous delivery-readiness slice persisted project-defined feature requirements and manual QA evidence. The current topographic workflow retains TIN vertices, point IDs, and optional project-local feature codes in `activeProject.output` when `sourceView` is `TopographicView`. Use this real saved output as limited presence evidence; do not infer universal code meanings.

## Requirements

- Add optional, bounded, case-insensitively unique source-code mappings to project feature requirements.
- Provide a pure engine summary that validates the retained unadjusted topographic output and counts vertices by point code under the existing topographic point limit.
- Recompute evidence from active project output; do not persist counts in delivery-review metadata.
- Block a required mapped feature when the current evidence is unavailable/invalid or none of its mapped codes are present.
- Keep manual review and evidence references independent. A matching code must not mark a feature reviewed or imply geometric completeness.
- Show project code counts in Delivery QA with an explicit limitation statement.
- Preserve optional, allowed, reasoned not-applicable behavior and country-neutral feature codes.

## Verification

- Focused engine tests cover case-insensitive counts, malformed/missing data, absent/matching mapped codes, unavailable evidence, and allowed not-applicable records.
- Focused IPC schema tests cover bounded mappings and case-insensitive duplicates.
- Engine, schema, Desktop, and renderer typechecks/builds pass; no statutory or field claim is made.

## Limits and next gate

This check proves only point-code presence in the retained topographic draft. It does not inspect feature geometry, line order, curve sampling, breaklines, sampling density, spatial gaps, CRS applicability, residuals, accuracy, or independent field truth. Do not label a point-code match as complete feature QA. The controlling `upload/METARDU-DESKTOP-MASTER-PLAN.md` was not present in this checkout during this task; the task remains within the existing Topographic survey type and does not build a statutory renderer.
