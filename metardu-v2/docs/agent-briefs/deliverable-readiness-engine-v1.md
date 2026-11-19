# TASK: Add a country-neutral deliverable completeness gate

## Task ID
deliverable-readiness-engine-v1

## Context the agent must read first
- [x] `AGENT.md`
- [x] `docs/invariants.md`
- [x] ADRs relevant to this task: none; this module does not add computation, IPC, or provider access.
- [x] Regulatory source docs: none; profiles are project/client-defined and this task renders no statutory document.
- [x] Recent worklog entries: portable project backup, native topographic promotion, GIS points/contours, and international public map references.

## Required audit before writing code
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — read the deliverable-first production workflow and quality states.
- `metardu-v2/packages/engine/src/workflows/index.ts` — inspect workflow exports and package surface.
- `metardu-v2/packages/engine/src/index.ts` — inspect the public engine API before adding exports.
- `metardu-v2/packages/engine/src/workflows/topographic.ts` — confirm this gate does not replace or overstate the topographic computation evidence.

## Hard constraints
- Profiles are supplied by the practice or client; do not invent countrywide feature codes, accuracy tolerances, statutory formats, or universal capture-density thresholds.
- This is checklist orchestration only. Keep geodetic and survey computation in the Rust sidecar.
- Missing reference context and required QA evidence must remain visible and block a complete package state.
- The strongest successful state is `ready-for-surveyor-review`; the evaluator must never imply approval, legal sufficiency, or survey accuracy.
- Declared output hashes are syntax-checked only. Do not claim that this module reads files or verifies their bytes.
- Preserve existing staged, unstaged, and untracked user work. Stage only the task-owned files and the isolated appended worklog entry.

## Acceptance criteria
- A typed, reusable engine function evaluates project-defined references, feature reviews, QA checks, and included outputs.
- Missing required evidence blocks readiness; allowed, reasoned exceptions and warnings remain visible for surveyor review.
- Unknown and duplicate review records fail clearly instead of being dropped.
- The public engine package re-exports the API.
- Focused unit tests and the engine TypeScript build pass; verbatim output is appended to `worklog.md`.
- No renderer, IPC, sidecar, statutory layout, or native delivery UI changes are included in this slice.

## Anti-hallucination clause (verbatim)

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Next integration step
Add project-persisted profiles and review evidence, then expose the evaluator through a delivery QA view and final-package manifest. The UI must preserve the distinction between a draft package, a blocked package, a package requiring surveyor review, and a package that a named professional has approved.
