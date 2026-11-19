# TASK: Persist explicit, unverified project coordinate declarations

## Task ID
desktop-project-coordinate-declarations

## User outcome
Let surveyors working anywhere record the horizontal unit, coordinate epoch, and vertical reference they intend for a project, while preserving missing or uncertain reference evidence honestly.

## Context
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — global project-context and fail-closed requirements.
- `metardu-v2/docs/invariants.md` — CRS, provenance, legacy-data, and verification boundaries.
- ADR-0003, ADR-0004, ADR-0007, and ADR-0016.
- `AGENT.md` and the latest entries in the root `worklog.md`.

## Hard constraints
- Saved context is always marked `user_declared_unverified`.
- Never infer units, epoch, or vertical reference from country, EPSG code, coordinate values, or a file name.
- Keep legacy projects unrecorded. Invalid imported declarations stay identifiable and must not be silently normalized or erased by unrelated edits.
- Metadata edits never transform coordinates, select an operation, validate a datum, or make a CRS-sensitive workflow pass.
- Do not claim remote sync persistence based on a Desktop wire-mapping test.
- Preserve unrelated staged and untracked changes; only commit the allowlisted Desktop task paths.

## Acceptance criteria
- [x] Versioned schema and SQLite migration persist valid project context while preserving legacy rows as undeclared.
- [x] Create, edit, clear, restart, local undo/redo, and Desktop sync mapping preserve exact evidence state.
- [x] Malformed imported context is surfaced and retained through unrelated updates.
- [x] Projects UI provides explicit fields and states that declarations are unverified and do not transform or validate data.
- [x] Focused schema/database/store/sync/undo tests, Desktop TypeScript build, renderer build, and `git diff --check` pass; exact output is appended to the root `worklog.md`.

## Out of scope
- A global EPSG catalogue or CRS/unit consistency engine.
- Coordinate transformations, vertical grid conversion, or source-dataset-specific contexts.
- LiDAR classification, derived point-cloud writing, or plug-in execution.
- Proof of Web sync persistence, field accuracy, or statutory acceptance.
