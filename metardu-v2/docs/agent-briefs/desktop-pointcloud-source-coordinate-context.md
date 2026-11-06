# TASK: Record explicit coordinate context for each point-cloud source

## Task ID
desktop-pointcloud-source-coordinate-context

## Context read before implementation
- [x] `AGENT.md` and `metardu-v2/docs/invariants.md`
- [x] ADR-0007 community extension ecosystem
- [x] ADR-0013 host-managed point-cloud chunks
- [x] ADR-0016 project coordinate declarations
- [x] ADR-0017 active project coordinate status
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] Latest point-cloud worklog entries
- [x] `upload/METARDU-DESKTOP-MASTER-PLAN.md` remains absent; do not reconstruct it
- [x] No regulatory source is required; this task records source metadata only

## Scope
Add a source-specific coordinate declaration for each retained LAS/LAZ dataset:
an optional user-entered horizontal CRS label, horizontal coordinate unit,
optional decimal-year coordinate epoch, and optional named vertical reference
with unit. Persist the declaration locally and show it beside that source.

## Hard constraints
- A source declaration is always `user_declared_unverified`.
- Never derive or prefill the declaration from the project context, country,
  LAS CRS records, WKT text, coordinate magnitudes, or another source.
- Never parse the label as an authoritative CRS, transform coordinates, or
  unlock a classifier or survey deliverable in this task.
- Existing sources remain undeclared. Malformed stored declarations remain
  intact and are surfaced as invalid until the user replaces or clears them.
- Updates accept only an opaque source ID attached to the active project; file
  paths and storage keys never cross IPC.
- Source coordinate context remains local to this Desktop source record. Do
  not claim project sync or portable-bundle support.
- Store only the current source declaration in this slice; source-context
  revision history is a separate provenance gate.
- Keep renderer sandboxing and the curated preload bridge; add only the typed
  source-context operation required by this UI.
- Preserve all unrelated staged and untracked work. Stage only task paths.

## Acceptance criteria
- A surveyor can declare, edit, or clear a source's CRS label, units, epoch,
  and vertical reference without changing source bytes or project-level context.
- The Point Cloud view labels the declaration unverified and distinguishes a
  missing or invalid declaration from a valid saved declaration.
- SQLite schema migration preserves existing point-cloud source records and
  leaves prior rows undeclared.
- Schema and database tests cover valid/invalid values, persistence, clearing,
  and rejecting a source that is not linked to the active project.
- Desktop typecheck and renderer build pass; focused IPC and database tests
  pass. Record exact command output and evidence limits in `worklog.md`.
- Update the international product plan and an ADR with the delivered scope
  and the remaining processing and provenance gates.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing
> behavior is correct, stop and state the uncertainty explicitly. Do not
> fabricate test results, completion percentages, or file contents. A partial,
> honest report is acceptable; a fabricated complete one is not.

## Out of scope
- CRS authority lookup, coordinate operation selection, coordinate conversion,
  unit consistency checks, or vertical-datum validation.
- Classifier execution, point-cloud editing/writing, DTM/DSM, contours, or
  volume calculation.
- Project backup/restore, web sync, community plug-in data access, or legal
  acceptance claims.
