# TASK: Run one explicitly selected community WebAssembly tool in Desktop

## Task ID
desktop-community-plugin-runtime-v1

## Context the agent must read first
- [x] `AGENT.md` and `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-*.md`, `0003-*.md`, `0005-*.md`, and `0007-community-extension-ecosystem.md`
- [x] Latest worklog entries
- [x] Country-agnostic prototype; no statutory output or jurisdiction pack
- Controlling master plan `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent in this checkout; do not reconstruct it.

## Required audit before writing code
- `metardu-v2/apps/desktop/src/preload/index.ts` — renderer capability boundary and allowlist
- `metardu-v2/apps/desktop/src/main/index.ts` — sidecar and dialog ownership
- `metardu-v2/packages/ipc-schemas/src/namespaces/cogo.ts` — untrusted payload validation pattern
- `metardu-v2/packages/metardu-sidecar/src/dispatcher.rs` — sidecar method registration
- `metardu-v2/packages/ui-components/src/panels/AppShell.tsx` — navigation contract

## Hard constraints
- The Rust sidecar remains authoritative for numerically sensitive computation.
- Renderer code has no Node, filesystem, network, process, database, or direct IPC access.
- The extension has no WASI or host imports. Only user-selected JSON is passed in; no project files are exposed.
- Outputs remain Community / Draft and cannot claim accuracy, approval, or jurisdictional acceptance.
- No new survey type, CRS assumption, country pack, or statutory renderer is introduced.

## Acceptance criteria
- A user can explicitly select a local `.wasm`, enter a claimed reverse-domain ID/version and JSON input, run it, and see its bounded output and host-computed hashes/trust label.
- Main process rechecks input; selected module bytes are bounded, held in memory only, and expire.
- Rust runtime has fixed size, memory, table, and fuel bounds; rejects imports and malformed ABI/output.
- Focused Rust tests, IPC schema tests, and Desktop TypeScript build/typecheck provide reproducible evidence.
- Worklog records exact outputs; only scoped task files are committed and pushed to `error302/metardu-desktop`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement
Append a task entry to `worklog.md` with verification output, artifacts, and next gates.

## Out of scope
- Installing or persisting `.mdplug` packages, catalog/signatures, plugin SDK or publishing tools.
- Project snapshot, project-store writes, instrument/network/filesystem capabilities, or plugin UI contributions.
- Claiming the runtime makes every survey workflow or jurisdiction available in this build.
