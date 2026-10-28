# TASK: Make topographic drafts project-referenced and fail closed on missing evidence

## Task ID
global-topographic-draft-integrity

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
- [x] No regulatory source is required; this task creates no statutory renderer.
- [x] Recent entries in the root `worklog.md`.
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`.

## Required audit before writing code
- `metardu-v2/packages/engine/src/workflows/topographic.ts` — input assumptions, TIN limit, QC fields.
- `metardu-v2/apps/desktop/src/renderer/views/TopographicView.tsx` — defaults, CSV parsing, project usage.
- `metardu-v2/apps/desktop/src/renderer/SurveyStateContext.tsx` — draft persistence vs auto-export.
- Topographic exporter metadata and existing workflow tests — downstream output contracts.

## Hard constraints
- Do not assume a country, CRS, height datum, surveyor identity, or regulatory tolerance.
- A neutral project may run only when it has an explicitly selected project CRS and the user declares the input units/reference context.
- Preserve unknown or unadjusted evidence as unknown; do not substitute zero for a missing residual or tolerance.
- Keep existing statutory outputs and their country configuration contracts intact.
- Do not move or duplicate geodetic computation. This task does not widen the IPC allowlist.
- A topographic draft is not a statutory or adjustment-approved deliverable.

## Acceptance criteria
- [x] Topographic UI starts with no synthetic points or Kenya default.
- [x] CSV numeric parsing rejects blanks, malformed values, non-finite numbers, and invalid row widths.
- [x] Workflow validates survey points and rejects unsupported input sizes instead of returning an empty TIN.
- [x] No jurisdictional tolerance and no computed residual are represented as `null` and rendered as not established/not computed.
- [x] Output persists as a computed draft without triggering statutory auto-export.
- [x] A project CRS and user-declared vertical reference are retained with the output as unverified metadata.
- [x] Focused engine/desktop tests and TypeScript builds pass; exact output is appended to `worklog.md`.
- [x] Changes are committed and pushed only to `https://github.com/error302/metardu-desktop.git`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a worklog entry with changed files, verbatim verification output,
remaining limits, and the next global-readiness milestone.

## Out of scope
- Robust scalable Delaunay/TIN implementation (the current engine limit is documented as a blocker).
- Vertical datum conversion, height-grid support, coordinate transformation, or epoch-aware CRS operations.
- Country statutory plan approval or certification.
- General project schema redesign beyond preserving the topographic draft's declared context.
