# TASK: Remove unsupported claims from the deliverables and registry workspace

## Task ID
desktop-capability-claims-honesty

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] Regulatory sources: none required; this task changes availability copy and removes fabricated registry records, not statutory output layouts.
- [x] Recent worklog entries covering renderer integrity and shared subscription direction.

## Required audit before writing code
- `metardu-v2/packages/ui-components/src/panels/AppShell.tsx` — navigation labels and workflow-stage tooltip claims.
- `metardu-v2/apps/desktop/src/renderer/views/RegistryArchiveView.tsx` — identify whether displayed records and search behavior have an authoritative data source.
- `metardu-v2/apps/desktop/src/renderer/views/DeedPlanView.tsx` — ensure the document workspace does not claim unavailable signing or regulator acceptance.
- `metardu-v2/apps/desktop/src/renderer/views/LandPortalSubmissionView.tsx` and `SigningPanel.tsx` — preserve their explicit unavailable states.

## Hard constraints
- Do not present synthetic parcel records, title status, area, surveyor identity, or mutation genealogy as registry facts.
- Do not claim that signing, registry search, portal submission, or legal acceptance is available unless the source, integration, and verification exist.
- Preserve existing project data and the Rust sidecar as the sole authority for numerical survey operations.
- Keep the renderer sandbox and preload boundary unchanged.

## Acceptance criteria
- Registry archive view shows no invented records or inert search control; it explains the missing authoritative registry data/connection.
- Workflow-stage labels and tooltips describe available workspaces and their evidence limits without unsupported module counts, certified outputs, portal upload, or signing claims.
- The document workspace does not claim that it signs or submits documents.
- Add a regression test proving the registry view contains no fabricated parcel record and the stage copy does not restore the unsupported claims.
- Desktop and renderer TypeScript checks, Desktop tests, and `git diff --check` pass; append terminal evidence and changed paths to `worklog.md`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement
Append a dated entry to `worklog.md`; do not overwrite prior evidence.

## Out of scope
- Connecting to a national land registry or adding a statutory submission workflow.
- Changing statutory document geometry, CRS operations, or acceptance rules.
- Adding country support or claiming that any additional jurisdiction is release-ready.
