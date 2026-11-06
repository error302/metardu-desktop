# TASK: Route COGO through the Rust sidecar and preserve draft evidence

## Task ID
desktop-cogo-sidecar-draft-integrity

## Scope
Repair the existing COGO vertical slice so it uses the Rust sidecar for all geometric calculations, rejects blank or invalid numeric input, and cannot turn unreferenced geometry into a statutory auto-export. Keep the operations useful as local planar draft geometry while project CRS and ground-area evidence remain unset.

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [x] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [x] `worklog.md` latest surveying-integrity entries
- [x] `metardu-v2/apps/desktop/src/renderer/views/COGOView.tsx`
- [x] `metardu-v2/packages/metardu-sidecar/src/cogo/` and `compute_handlers.rs`
- [x] `metardu-v2/apps/desktop/src/preload/index.ts` and `main/index.ts`
- [x] `metardu-v2/apps/desktop/src/renderer/SurveyStateContext.tsx` and `useProjectStore.ts`
- [x] `metardu-v2/apps/desktop/src/renderer/cross-import-bus.ts` and its COGO consumers
- [x] `metardu-v2/packages/ipc-schemas/src/`
- Regulatory source: none required; this task removes the direct statutory handoff and does not create a jurisdiction-specific document.

## Audit findings
- The renderer currently performs COGO trigonometry, line intersection, perimeter, and shoelace area itself even though Rust COGO handlers already exist.
- Inputs begin with Kenya-looking coordinates; blank numeric edits are coerced to zero; the selected country does not affect these planar formulas.
- Project saves inject fixed uncertainty values and `adjusted: true` without observations or an adjustment.
- `setSurveyOutput` triggers automatic statutory plan export, and COGO offers a direct Form 4 handoff despite having no project CRS or statutory evidence.

## Hard constraints
- All COGO math runs in Rust sidecar code, not in renderer or TypeScript engine code.
- Validate method parameters in preload with Zod and validate numeric/geometry inputs again in Rust.
- Start numeric fields blank; a blank or malformed value must never become zero.
- Treat calculations as unverified local planar geometry in metres and decimal bearings clockwise from the positive northing axis. Do not infer project CRS, grid-to-ground correction, coordinate epoch, uncertainty, jurisdiction acceptance, or statutory area.
- Persist COGO only as an explicitly unverified project draft through a project-store-only save path that does not call statutory auto-export.
- Remove fixed/fabricated uncertainty and the direct statutory plan handoff. Keep renderer sandboxing and the existing main-process allowlist architecture.
- Preserve existing files and unrelated working-tree changes.

## Acceptance criteria
- [x] Radiation, bearing intersection, distance intersection, midpoint offset, area, perimeter, and edge bearings use Rust sidecar operations.
- [x] Rust rejects invalid/degenerate geometry and returns explicit planar area/perimeter results; tests include known answers and invalid cases.
- [x] COGO numeric fields start empty and report input errors without replacing blanks with zero.
- [x] The screen and saved project output identify COGO results as `draft_unverified`, with null/unspecified coordinate-reference evidence and no uncertainty values.
- [x] Saving a COGO draft persists it without updating export-ready survey state or triggering statutory auto-export.
- [x] No COGO control claims Form 4 generation; CAD and Traverse handoffs label COGO coordinates as unverified draft input.
- [x] Preload method and COGO parameter validation reject malformed calls; IPC schema tests cover valid and invalid cases.
- [x] Rust COGO tests, IPC schema tests, desktop tests, both Desktop TypeScript checks, the sidecar RPC smoke, and `git diff --check` are recorded in the top-level `worklog.md`.

## Verification limitation

The COGO Playwright browser smoke was attempted, but this machine has no installed Playwright Chromium executable. The existing sidecar RPC smoke was expanded instead and exercises five valid COGO operations, invalid input rejection, plus ping/echo/version/method-list behavior through one live sidecar process. This verifies the Rust IPC protocol but not the rendered Electron UI. The default GDAL-enabled Rust release build is also blocked on this Windows machine because `gdal_i.lib` is not installed; the COGO-enabled no-default-features release build succeeds.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Implementing least-squares adjustment, coordinate reference system operations, grid-to-ground corrections, or survey uncertainty propagation in the COGO view.
- Claiming that a COGO draft is checked, ground area, cadastral, regulator-accepted, or ready for legal delivery.
- Rewriting project synchronization or shared Web subscription authentication.
