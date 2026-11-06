# TASK: Establish an evidence-backed international product and release plan for METARDU Desktop

## Task ID
international-desktop-product-plan

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADR: `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] Geoid safety brief: `metardu-v2/docs/agent-briefs/geoid-and-datum-panel-safety.md`
- [x] Recent worklog entries covering geodesy, geoid safety, and DJI WPML export/import
- [x] No regulatory source is required; this is a country-agnostic product plan, not a statutory renderer task.

## Required audit before writing
- `upload/METARDU-DESKTOP-MASTER-PLAN.md` — check whether the controlling plan exists. It is absent in this checkout.
- `metardu-v2/docs/invariants.md` — retain sidecar authority, fail-closed height data, sandbox, source-document, worklog, and verification requirements.
- `metardu-v2/packages/engine/src/geodesy/geoid.ts` — identify the current interpolation and byte-verification boundary.
- `metardu-v2/docs/agent-briefs/geoid-and-datum-panel-safety.md` — preserve the release conditions for authoritative grids.
- `metardu-v2/packages/engine/src/flight-planning/` — distinguish the committed DJI exporter contract from desktop UI/device readiness.
- `worklog.md` — retain recent evidence and unresolved environment limitations.

## Hard constraints
- Keep geodetic transforms, adjustment, COGO, and raster math in the Rust sidecar.
- Never infer the project CRS, datum, geoid, projection, coordinate epoch, units, or universal legal accuracy standard.
- Keep offline computation structural; never silently download reference data.
- A global geoid is not a substitute for a local legal vertical datum.
- Do not claim a statutory document is valid without current primary source material and professional review.
- Preserve the existing sandbox and do not widen IPC capabilities in this documentation task.
- Treat `INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` as product direction, not a replacement for the absent owner-controlled master plan.

## Acceptance criteria
- [x] The plan defines the product promise, international architecture, surveyor UI, evidence model, data/package rules, interoperability, rollout sequence, release gates, and current verified priorities.
- [x] EGM96 is described as legacy compatibility data, and its official interpolation/sample distinction is recorded without claiming local-datum suitability.
- [x] Unknowns and legal/release gates are explicit; no blanket survey-grade or global statutory claim is introduced.
- [x] `git diff --cached --check` — exit 0 with no whitespace diagnostics on the scoped files.
- [x] Review the final scoped diff; the pre-existing staged deletion and all other unrelated working-tree changes are excluded from this task commit.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a dated entry to `worklog.md` with the exact verification output, changed files, and next product gate. Do not overwrite prior entries.

## Out of scope
- Implementing a geoid grid loader or interpolation routine.
- Claiming any new jurisdiction or survey workflow is field-ready.
- Editing the absent controlling master plan, regulatory forms, or renderer behavior.
