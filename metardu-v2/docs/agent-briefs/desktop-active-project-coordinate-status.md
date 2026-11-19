# TASK: Show active project coordinate context in the persistent shell

## Task ID
desktop-active-project-coordinate-status

## User outcome
Keep the active project's recorded CRS code, horizontal units, coordinate epoch, vertical reference, and context evidence state visible across Desktop workflows.

## Context
- `AGENT.md` and `metardu-v2/docs/invariants.md` — renderer boundary, geospatial provenance, and worklog rules.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — global coordinate context and quality states.
- ADR-0003, ADR-0016, and ADR-0017.
- Latest root `worklog.md` entries for project coordinate declarations and point-cloud preview.
- `metardu-v2/packages/ui-components/src/panels/AppShell.tsx` — current project/status-bar data flow.

## Hard constraints
- Display only project values that are actually stored. Never infer a CRS, unit, epoch, vertical reference, or verification state from jurisdiction, EPSG code, coordinates, or a file name.
- A user-declared context remains visibly unverified. A CRS code is not proof of a valid definition or coordinate operation.
- Distinguish absent context from invalid stored context; do not fill either with defaults.
- Do not change coordinates, add an IPC capability, or unblock any CRS-sensitive computation.
- Preserve the existing staged deletion and unrelated untracked work; commit only task-owned paths.

## Acceptance criteria
- [x] The persistent shell shows the active project's CRS code, horizontal unit, epoch, vertical reference, and evidence state on every workflow.
- [x] Missing and invalid states are explicit; no country or EPSG inference appears in displayed values.
- [x] A pure summary helper has tests for missing, invalid, legacy, and user-declared contexts.
- [x] Desktop typecheck, full Desktop tests, renderer build, and `git diff --check` pass; exact output is appended to the root `worklog.md`.

## Out of scope
- Coordinate transformation or CRS-definition verification.
- Dataset-specific coordinate context or use of these declarations by algorithms.
- Changes to subscription, sync, project storage, or the plug-in runtime.
- Claims of Electron runtime, field, statutory, or survey-accuracy validation.
