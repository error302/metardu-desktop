# TASK: Define a safe community extension architecture for METARDU Desktop

## Task ID
desktop-community-extension-architecture

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADRs relevant to this task:
  - [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
  - [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
  - [x] `metardu-v2/docs/decisions/0005-integration-export-workflow-family.md`
- [x] Regulatory source documents: none required; this task defines architecture, not a statutory renderer.
- [x] Recent worklog entries on the international desktop product plan and topographic TIN sidecar.

## Required audit before writing
- `upload/METARDU-DESKTOP-MASTER-PLAN.md` — check controlling scope. This file is absent in the current checkout; do not invent its contents or alter the locked Rust/Electron architecture.
- `metardu-v2/docs/invariants.md` — preserve sidecar math authority, sandbox, offline, statutory-source, project-evidence, and worklog rules.
- `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md` — preserve the curated bridge and deliberate IPC additions.
- `metardu-v2/docs/decisions/0005-integration-export-workflow-family.md` — retain survey-compute-first focus while superseding its blanket rejection of a hosted community plugin ecosystem.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — align with one surveyor workspace and verified jurisdictions.
- `worklog.md` — preserve append-only history and the latest sidecar evidence.

## Hard constraints
- Keep geodetic transforms, adjustment, COGO, and raster math in the Rust sidecar.
- Preserve Electron renderer sandboxing and the typed, curated preload bridge; plugins never receive direct IPC, Node, database, process, or unrestricted filesystem access.
- Keep the app local-first and offline-capable; plugin catalog access is optional.
- Never let a plugin mark its own result checked, approved, survey-grade, or statutory.
- Preserve original observations, project history, CRS/units/datum/epoch context, and reproducible package/version provenance.
- Do not claim a runtime or plugin manager exists until implemented and verified.
- Do not add a ninth survey type or general-purpose GIS/CAD editing.

## Acceptance criteria
- [x] ADR-0007 defines extension classes, versioned ABI direction, host capabilities, offline install, project provenance, trust labels, and rollout gates.
- [x] ADR-0007 explicitly reconciles the user's product direction with ADR-0005 and preserves ADR-0001 and ADR-0003.
- [x] This task brief records the missing controlling master plan and the limits of this documentation step.
- [x] The international product plan references the extension direction without claiming implementation or worldwide statutory readiness.
- [x] `git diff --check` passes on only the task's scoped files.
- [x] Unrelated staged deletion and untracked user files remain untouched.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a dated entry to root `worklog.md` including the exact documentation verification output, changed files, and next implementation gate. Do not overwrite prior entries.

## Out of scope
- Implementing the component runtime, plugin manager, SDK packages, catalog, installer, or extension UI.
- Enabling third-party code execution in the renderer or main process.
- Adding or certifying country-specific statutory workflows or reference systems.
- Claiming that arbitrary community tools are survey-grade or legally accepted.
