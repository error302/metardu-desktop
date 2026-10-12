# TASK: Remove fabricated desktop license and account authorization

## Task ID
desktop-license-honesty

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADR: `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] Regulatory source docs: none required; this task is country-agnostic and does not create statutory outputs.
- [x] Most recent worklog entries covering desktop safety and international product direction.

## Required audit before writing code
- `metardu-v2/packages/ui-components/src/services/license-service.ts` — identify generated credentials, local persistence, and lease behavior.
- `metardu-v2/apps/desktop/src/renderer/views/LicensingView.tsx` — identify claims made to the user and credentials collected.
- `metardu-v2/packages/ui-components/src/panels/AppShell.tsx` — identify global license-status labels.
- `metardu-v2/packages/ui-components/src/index.ts` — identify exported license-service APIs.
- `metardu-v2/apps/desktop/src/tests/` and workspace package scripts — choose the narrow verification path.

## Hard constraints
- Do not fabricate authentication, signed tokens, machine identity, seat counts, or offline leases.
- Do not collect, persist, or send account passwords or API tokens from this build.
- Do not change which survey workflows are available or invent pricing policy; no entitlement issuer is configured here.
- Keep the renderer sandboxed; do not add IPC or network capability.
- Preserve the Rust sidecar as the sole authority for geodetic calculations.

## Acceptance criteria
- A missing or previously saved local license never produces an authenticated state.
- Sign-in and lease refresh fail clearly until a real verification service is connected.
- The interface says authorization is not configured and does not display fabricated premium, token, seat, or lease claims.
- The interface does not claim that this status panel gates tools; current functionality remains determined by implemented modules and data gates.
- Focused license-service tests and the desktop main/preload TypeScript check pass.
- The renderer-wide TypeScript check is run and its result is recorded; any diagnostics outside the changed license files remain explicit product blockers.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

On completion, append a dated entry to `worklog.md` with verification output, changed files, and the next product decision.

## Out of scope
- Selecting subscription, perpetual-license, or free-local-access policy.
- Connecting to or implementing a production account/licensing server.
- Changing workflow access, pricing, cryptographic key management, or secure device storage.
- Any geodesy, statutory renderer, or IPC work.
