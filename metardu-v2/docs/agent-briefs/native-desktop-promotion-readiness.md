# Native desktop promotional workflow readiness

Scope: restore the real native startup path before recording the desktop-in-development promotion. Preserve existing dirty/staged source, desktop projects and web production. Use an isolated synthetic Electron profile and actual UI interaction for captures.

Observed red evidence on 4 November 2026: Electron 33.4.11 exposes Node-API 9; installed better-sqlite3 13.0.3 builds for Node-API 10. An in-memory native probe exits -36861 at Database construction while host Node succeeds. Native launch reaches database initialization but produces no application window. The current sidecar resolver also walks three ancestors from apps/desktop/dist/main, resolving apps/packages instead of the workspace packages directory.

Implementation allowlist: Electron version and matching lockfile, sidecar location helper/wiring/test, native smoke/compatibility checks, and append-only worklog evidence. Do not include pre-existing portable-bundle edits or the staged frontend deletion in a scoped commit.

Acceptance: coherent pinned Electron runtime; in-memory native SQLite query succeeds; actual sidecar ping and application UI launch; source types/tests/build evidence; one real synthetic workflow through actual exported files with independent inspection; no desktop/web sync claim without a verified pairing flow. Never fabricate survey measurements, missing references, approvals or statutory results. Native and field/receiving-system evidence remain distinct.

The AGENT.md-referenced upload/METARDU-DESKTOP-MASTER-PLAN.md is absent in this checkout. Current invariants, architecture ADR0001 and INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md govern this bounded repair; no architecture or statutory renderer change is proposed.

## Workflow defects exposed by the native run

Scope extension authorized by the request to fix defects encountered in the real demonstration: source-preserving topographic DXF and computed-draft PDF, retained point display, responsive canvas and display-only contour label placement. No statutory certification layout is invented. The computed draft bypasses the statutory report cover, uses its retained CRS/height declaration and an explicitly unknown survey date, excludes certification and refuses the parcel-booklet path. Existing non-draft statutory paths retain their own gates.

Additional owned paths: engine documents/dxf-output.ts, documents/contour-label-layout.ts, index.ts, integration/dxf-export.ts and its tests, workflows/topographic.ts; Desktop main/draft-topographic-map.ts and map-export.ts; renderer/map-geometry.ts, map-svg.ts, views/TopographicView.tsx, views/ExportPanel.tsx, declared-topographic-export.ts and focused tests; report-pdf/src/index.ts; UI-components SurveyCanvas.tsx, theme CSS and local workspace dependency metadata. Existing index.ts contains unrelated portable-bundle edits: any eventual commit must stage task-owned hunks only.

Native evidence: real 42-point synthetic computation, 60 triangles and 80 contour segments; independent ezdxf check of the actual saved DXF found exact 42 XYZ, seven quarter-metre contour levels, zero audit errors/repairs and metre units. First actual PDF rendered successfully but visual review found repeated EPSG text and a legend masking a grid label. Those presentation defects are being corrected and must receive a fresh native export/render before final media acceptance.

The original synthetic project subsequently contained a newer sectional result. It was preserved; the separate SYNTHETIC - Native topographic deliverables QA project was created through native UI instead. All data in this dedicated profile is synthetic; no production project/account/billing change occurred.

Native startup required Electron45/Node-API10 compatibility, corrected sidecar lookup and bundled IIFE preload while retaining sandbox/context isolation. The remote font request was removed, and the reproduced passive wheel-listener warning was corrected with a non-passive native SVG wheel listener. Source guards and browser/native/file/field evidence remain distinct.

Known remaining gates: actual final PDF render and metadata acceptance, broader Desktop dependency audit/packaging/signing, blank native basemap/zero-size diagnostic, Desktop-Web authenticated pairing and real roundtrip, receiving CAD, calibrated print, physical field/professional acceptance. Desktop is in development; no claim of working automatic pairing or released desktop software is authorized by these tests.


## Follow-up native map layout - 5 November 2026

The observed zero-size basemap target used a percentage height inside a flex child with only min-height. Add MapView.tsx to the owned scope: pin the map target to its positioned viewport using absolute inset zero. Existing ResizeObserver/updateSize and Rust-only CRS transformation remain unchanged. Verify a fresh renderer build and actual native map before treating this diagnostic as resolved.

Final native DXF/PDF parser and visual acceptance is recorded in the 5 November worklog entry. The PDF is raster, not vector. The map layout builds, but native basemap acceptance remains open due to a Computer Use target/capture mismatch. Final publication approval is pending; no X post was published.


## Native GIS follow-up verified - 5 November 2026

Computer Use target selection recovered via the window's exposed Raise action. Reloading the existing isolated synthetic Desktop profile verified the inset viewport fix. Further tracing found that MapView extracted/projected topographic geometry but only rendered cadastral boundaries/beacons, leaving the old reprojection text when no feature was drawn. The production CSP also blocked the configured Esri/OpenTopoMap image origins.

Owned follow-up paths: renderer/topographic-overlay.ts, views/MapView.tsx, map-geometry.ts, tests/topographic-overlay.test.ts, map-geometry.test.ts, preload-bundle.test.ts and vite.config.ts. The overlay renders only existing Rust-projected coordinates and retained contour vertices; no geodesy or terrain fallback was added. Missing projected vertices cannot create a bridged contour. Original TIN point IDs are retained. Survey Points and Contours have separate visible controls. CSP permits only the configured HTTPS imagery origins while keeping script, connection, object and isolation restrictions.

Actual native UI verified 42 source-ID points and 80 retained contour segments, independent point-only and contour-only displays, then restored both layers. Esri supplies a no-imagery placeholder at this synthetic location/zoom; this is not accepted satellite coverage. OpenStreetMap loads, and OpenTopoMap remains selectable. Provider coverage, physical print and field accuracy remain separate. Desktop renderer types/build pass; Desktop suite: 39 passed files, 1 skipped; 358 passed tests, 7 pre-existing skips. The prior default-GDAL, packaging/security, missing smoke-script/master-plan and Desktop-Web pairing gates remain open.

A 25-second 1080 x 1350 walkthrough assembled from the four actual native captures/export was visually reviewed across all five scenes. It is an actual-capture slideshow, not a continuous recording. The user challenged the earlier X text rather than approving it. Revised caption/video remain unpublished. Automatic review rejected uploading the specific new video until explicit media approval; a single upload-and-publication request is pending. Do not publish the old draft or treat local rendered previews as a public post.
