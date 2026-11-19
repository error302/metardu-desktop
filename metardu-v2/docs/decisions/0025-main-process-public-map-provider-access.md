# ADR-0025: Main-process access for curated public map providers

**Status:** Accepted
**Date:** 2026-11-06

## Context

ADR-0024 piloted a public cadastral overlay by loading provider images directly in the renderer. That conflicts with the desktop hard invariant that the main process owns network access. A second-country source, LINZ NZ Primary Parcels, also requires a user-owned LDS API key. Renderer URL construction or persistent renderer storage would expose that secret and would make arbitrary network access easier to introduce accidentally.

## Decision

- All requests to curated public map providers run in the Electron main process through Electron's network stack. Renderer CSP does not allow cadastral provider image origins. OpenLayers receives bounded images through blob URLs or receives bounded, sanitized feature collections over the preload bridge.
- IPC exposes only fixed provider operations. Inputs are Zod-validated in both preload and main; they contain bounded map extents and image dimensions, never a URL, hostname, HTTP method, arbitrary layer name, or caller-supplied query string. Main constructs the PDOK and LINZ endpoints and pins the LINZ dataset to layer 50772.
- Provider IPC accepts requests only from the main frame of the METARDU Desktop window. Redirects are rejected. Requests have timeouts and response-size limits; image MIME/signature and returned LINZ polygon geometry are checked. Responses are reduced to the visual geometry required by the map, with LINZ attributes removed.
- Each public layer remains opt-in and hidden by default. Public reference responses are not persisted in the project, used in survey calculations, or included in exports. LINZ requests are restricted to the visible New Zealand map extent and at most 1,000 primary parcels per response.
- A user may save their own LINZ LDS API key. It is encrypted with Electron's asynchronous `safeStorage` API in the app's user-data directory. No read-secret IPC method exists; renderer receives only configured/storage-available flags. On Linux, METARDU refuses to store or use the key unless a recognized OS secret-store backend is selected. If OS-backed encryption is unavailable, key save and LINZ requests fail closed. The key is not put in project data, renderer persistence, logs, or community extensions.
- The PDOK renderer-origin permission and direct image-loading approach in ADR-0024 are superseded by this decision. Other ADR-0024 limits and provider metadata requirements remain in force.

## Consequences

- Public map data now follows the main-only network invariant and the user's LINZ credential remains outside renderer reads and project artifacts.
- LINZ primary parcels are still incomplete without non-primary parcels. The provider's published nominal accuracy varies from 0.1–1 m in urban areas to 1–100 m in rural areas. The UI must keep those facts and the reference-only limit visible.
- The current integration is a bounded online visual pilot, not a global catalogue, authoritative legal workflow, download/cache package, offline reference dataset, or verified provider-runtime claim.
- Electron safeStorage protections vary by OS. In particular, Windows DPAPI protects against other OS users but not other apps running as the same user; deployments must not describe it as protection from same-user malware.

## Verification

- Unit tests exercise fixed provider URLs, no arbitrary URL inputs, secure-storage fail-closed behavior, encrypted key persistence, response validation, and source-layer display limits.
- A renderer typecheck/build and focused desktop tests are required. Live LINZ access requires a user-owned key and remains a separate external-service check; no key is embedded in source or test fixtures used for real requests.
