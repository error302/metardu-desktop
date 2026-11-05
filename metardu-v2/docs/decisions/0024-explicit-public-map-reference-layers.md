# ADR-0024: Explicit public map reference layers

**Status:** Accepted
**Date:** 2026-11-06

## Context

Some national and regional land agencies publish public geospatial services. Their licences, refresh schedules, coordinate systems, geometry quality, coverage, and legal meaning differ. Public access does not establish that a dataset is a surveyed boundary or title record. METARDU must also remain usable offline, preserve the Rust sidecar as the authority for survey computations, and keep renderer network access constrained.

## Decision

- Add public services only through a curated, in-code source catalogue that records the custodian, jurisdiction, service, attribution/licence, freshness statement, and use limits. Do not accept arbitrary service URLs in the renderer.
- A remote source is hidden by default and starts requesting data only after an explicit user selection. The production content security policy has a finite image-origin list that includes PDOK alongside the existing basemaps; it does not allow a generic HTTPS source. Renderer `connect-src` remains self-only and no new filesystem, network, or shell IPC is introduced.
- The first adapter is the Netherlands Kadaster/PDOK WMS cadastral-boundary layer. Its map is a visual reference only. It is not project-persisted, used by survey calculations, or included in plan exports.
- Show the provider, attribution, coverage, freshness statement, source URL, and use limits beside the control. Label the layer as online and reference-only.
- Keep coordinate transformations, survey evidence, legal boundary reconstruction, downloadable/offline references, and project provenance out of this visual adapter. They require their own reviewed source metadata, evidence model, and verification.

## Consequences

- A surveyor can inspect one public cadastral reference layer inside the map workspace when connected to the internet.
- The map service receives the requested viewport and layer parameters when enabled. It receives no project observations through this integration.
- A failed network request leaves local survey geometry and computations unchanged; the UI reports service errors.
- Additional jurisdictions require individually reviewed catalogue entries and provider-specific use limits. This does not yet provide a global service browser or local data package workflow.

## Verification

- Unit tests verify the curated source metadata, hidden-by-default state, WMS parameters, attribution, and no-computation/no-export/no-project-storage declarations.
- A renderer build must confirm that the compiled production CSP allows only the PDOK image origin and retains its existing non-wildcard policy.
- Local service access was unavailable during implementation; a real WMS response and native Electron layer display remain separate runtime verification gates.
