# TASK: Replace the capped topographic draft triangulator with Rust sidecar Delaunay

## Task ID
robust-topographic-tin-sidecar

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] `metardu-v2/docs/decisions/0003-contextbridge-allowlist.md`
- [x] `metardu-v2/docs/decisions/0006-topographic-delaunay-sidecar.md`
- [x] Recent `worklog.md` entries and the international product plan.
- [x] No statutory renderer or jurisdictional rule is changed.

## Required audit before code
- `metardu-v2/packages/engine/src/workflows/topographic.ts` — remove production brute-force triangulation and preserve downstream draft semantics.
- `metardu-v2/packages/metardu-sidecar/src/dispatcher.rs` and `src/main.rs` — register and test the math handler.
- `metardu-v2/apps/desktop/src/preload/index.ts` and `src/renderer/views/TopographicView.tsx` — allow only the new method and consume its output.
- `metardu-v2/packages/ipc-schemas/src/namespaces/` — validate finite input shape and the point resource limit.
- Existing topographic tests and exporters — migrate fixtures to explicit TIN input without implementing a second production triangulator.

## Hard constraints
- All Delaunay triangulation remains in Rust, per A1 and ADR-0006.
- Preserve each input coordinate and point record exactly; never round, collapse, or select between duplicate survey points.
- Reject duplicate horizontal positions, non-finite coordinates, fewer than three points, collinear-only sets, and over-limit payloads with actionable errors.
- The operation is planar and does not verify CRS, units, vertical reference, accuracy, or legal status.
- Keep the output a computed draft with unknown residual/tolerance where no evidence exists.
- Add only `topographic.build_tin` to the preload allowlist; do not expose generic IPC, file, shell, or network access.
- Preserve unrelated staged and untracked user files.

## Acceptance criteria
- Spade-backed deterministic triangulation has no O(n^4) TypeScript production fallback and supports the documented 100,000-point safety ceiling.
- Rust tests cover 3-point and regular-grid known counts, cocircular repeatability, near-collinear geometry, invalid inputs, duplicate rejection, and 10,000 points.
- The UI calls the sidecar, maps returned triangle indices onto original records, reports sidecar validation failures, and preserves draft context/evidence labels.
- The workflow blocks contour work above a documented complexity budget instead of freezing on extreme point/level combinations.
- Focused Rust, engine, IPC schema, and desktop tests/builds are run; exact outputs and any environmental blockers are appended to `worklog.md`.
- Changes are committed and pushed only to `https://github.com/error302/metardu-desktop.git`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- CRS operations, horizontal or vertical datum transformations, geoid grids, or coordinate epoch handling.
- Least-squares adjustment, residuals, uncertainty, or a claim that this draft is survey-grade.
- Country-specific tolerance, statutory approvals, CAD legal forms, and point-cloud/DSM meshing.
- Reworking the contour extraction algorithm beyond an explicit computational-work guard.
