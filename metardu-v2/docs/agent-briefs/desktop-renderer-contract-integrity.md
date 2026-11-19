# TASK: Restore strict renderer type safety against live domain contracts

## Task ID
desktop-renderer-contract-integrity

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] ADR: `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] Regulatory source docs: none required; do not create or claim any statutory output.
- [x] Most recent worklog entries covering international product direction and renderer safety.

## Required audit before writing code
- `metardu-v2/tsconfig.renderer-check.json` — confirm the exact renderer and UI-component files compiled.
- `metardu-v2/packages/engine/src/` — read the authoritative domain result and input types used by affected views.
- `metardu-v2/apps/desktop/src/preload/index.ts` and `renderer/preload.d.ts` — use the actual sandbox bridge contract.
- Every renderer file named by the current type-check diagnostics — distinguish actual API mismatches from display-only errors.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — preserve project CRS, uncertainty, offline, and evidence requirements.

## Hard constraints
- Fix underlying data-contract mismatches; do not silence errors with `any`, double casts, or widened types.
- Rust sidecar remains authoritative for geodetic transforms, adjustment, COGO, and raster math.
- Do not present synthetic coordinates, tolerances, licensing, signing, portal submission, or instrument data as verified results.
- Do not add IPC capability or weaken the preload sandbox.
- Do not claim a jurisdiction workflow is supported without its source documents and professional review.

## Acceptance criteria
- `npx tsc --noEmit -p tsconfig.renderer-check.json` exits 0 for the complete renderer and UI-component graph.
- Affected views consume the actual engine, context, and preload shapes; unsupported operations remain visibly unavailable.
- No fake success state or hard-coded precision is emitted to make the UI appear complete.
- Desktop unit tests pass and `git diff --check` reports no whitespace errors.
- Append exact verification output, changed paths, and remaining field-validation gates to `worklog.md`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append a dated entry to `worklog.md`; do not overwrite prior evidence.

## Out of scope
- Implementing new sidecar algorithms or changing the Rust/TypeScript architecture.
- Adding a new jurisdiction, statutory renderer, portal integration, license issuer, or cryptographic key store.
- Packaging, signing, publishing, or claiming field readiness.
