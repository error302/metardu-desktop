# TASK: Add an explicit, visual-only public cadastral reference layer

## Task ID
public-map-reference-layer-v1

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0024-explicit-public-map-reference-layers.md`
- [x] Country-agnostic public data task; no statutory renderer or national survey form is added.
- [x] Most recent worklog entries reviewed.

## Audited files
- `metardu-v2/apps/desktop/src/renderer/views/MapView.tsx` — OpenLayers base and project geometry layers; public layer must remain separate from project feature sources.
- `metardu-v2/apps/desktop/src/renderer/map-reference-sources.ts` — curated provider metadata and WMS layer factory.
- `metardu-v2/vite.config.ts` — renderer CSP; permit only the selected provider image origin.
- `metardu-v2/apps/desktop/src/main/index.ts` — verify no new privileged network IPC is introduced.
- `metardu-v2/apps/desktop/src/tests/map-reference-sources.test.ts` — source metadata, opt-in state, and request contract.
- Kadaster and PDOK primary source pages, recorded in the product plan.

## Hard constraints
- Rust remains the authority for survey computations and geodetic transformations.
- Keep the Electron renderer sandbox, context isolation, web security, and typed preload boundary intact.
- Keep all compute paths offline capable. This map-only view request is explicit and optional; no silent network fetch or cache is added by METARDU.
- Never present public cadastral imagery as a measured boundary, survey control, legal title, or ownership result.
- Do not stage or commit concurrent map/topographic work; preserve unrelated staged and untracked state.

## Acceptance criteria
- [x] The PDOK layer is hidden by default and loads only after a visible opt-in control is selected.
- [x] Provider, coverage, attribution/licence, freshness, online requirement, and reference-only limits are visible before activation.
- [x] The WMS endpoint is fixed in the curated source record; users cannot enter an arbitrary URL, and no new network IPC is exposed. The renderer CSP retains a finite origin list without generic HTTPS access or broader `connect-src` permission.
- [x] The remote layer is separate from survey features, persisted project content, and plan exports.
- [x] Unit tests cover the source metadata and hidden WMS layer contract.
- [x] Renderer type check and build pass; the built CSP includes PDOK in a finite list of named map image hosts, with no generic HTTPS or wildcard source and `connect-src 'self'`.
- [ ] Real WMS response and native Electron display are recorded when network and Electron runtime are available.

## Worklog requirement

Append verification output, source and limitation notes, and next steps to `worklog.md`.

## Out of scope
- Feature queries, parcel selection, downloads, project persistence, offline pinning, or any survey calculation input.
- A generic arbitrary WMS/WFS/OGC API browser or additional country providers.
- Legal boundary reconstruction, title search, ownership data, or jurisdiction-specific statutory output.
