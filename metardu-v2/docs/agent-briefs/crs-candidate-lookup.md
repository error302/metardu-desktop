# TASK: Replace automatic CRS guessing with explicit surveyor selection

## Task ID
crs-candidate-lookup

## Context the agent must read first
- [x] AGENT.md
- [x] metardu-v2/docs/invariants.md
- [x] metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md
- [x] metardu-v2/docs/agent-briefs/crs-reprojection-fail-closed.md
- [x] Most recent geodesy and flight-planning worklog entries
- [x] No regulatory source is required; this task changes country-agnostic CRS discovery semantics only.

## Required audit before writing
- metardu-v2/packages/engine/src/geodesy/crs-database.ts: inspect location ranking, duplicated EPSG entries, and country-list wording.
- metardu-v2/packages/engine/src/geodesy/tests/crs-database.test.ts: find assertions coupled to automatic selection.
- metardu-v2/packages/engine/src/surveying/tests/critical-modules.test.ts: find location-driven selection assertions.
- metardu-v2/packages/engine/src/index.ts: confirm the API is exported by the engine package.

## Hard constraints
- A geographic location may produce discovery candidates, never an inferred project CRS.
- The operator must select a jurisdiction before candidate lookup.
- Bounding-box overlap is not proof of CRS area-of-use validity, a transformation operation, accuracy, or statutory acceptance.
- EPSG lookups must not resolve conflicting duplicate metadata by iteration order.
- Do not implement geodetic math in TypeScript.
- Do not add jurisdictions, regulatory rules, or accuracy claims in this task.
- Preserve offline operation and existing renderer sandbox boundaries.

## Acceptance criteria
- [x] Replace ranking-based findCrsForLocation with a plural candidate API requiring explicit jurisdiction and returning every local bounding-box match.
- [x] Rename the country-list API so it identifies catalog metadata, not supported survey jurisdictions.
- [x] Return all duplicate EPSG catalog records and make single-record lookup fail closed when the records conflict.
- [x] Validate geographic input ranges and preserve multiple candidates at shared projection-zone boundaries.
- [x] Update focused engine tests to prove explicit jurisdiction selection, conflict visibility, and no country-support claim.
- [x] Engine typecheck and full engine test suite pass.
- [x] Scoped diff review and worklog contain exact verification output.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement
Append a dated entry to worklog.md with exact command output, changed files, verification scope, and next product gate.

## Out of scope
- Authenticating or replacing the underlying CRS catalog metadata.
- Selecting, computing, or enabling any coordinate operation.
- Claiming country-level workflow or statutory support.
- Changing renderer, IPC, sidecar, or project-storage behavior.
