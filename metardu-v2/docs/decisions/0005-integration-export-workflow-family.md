# ADR-0005: Integration & Export workflow family — survey-grade source of truth, not a GIS tool

**Status:** Accepted (23 Jul 2026 — first task brief verified, tests green)
**Date:** 23 Jul 2026
**Supersedes:** None
**Superseded by:** None

## Context

The master plan (`upload/METARDU-DESKTOP-MASTER-PLAN.md`) defines metardu-desktop
as a survey-compute-first product: Rust sidecar owns geodetic math, TypeScript
engine orchestrates workflows and assembles statutory documents, Electron hosts
the UI. The five workflow families locked in Section 6 are Topographic,
Cadastral, Engineering, Construction Setting-Out, and Sectional Properties.

A growth question has surfaced: **can metardu-desktop also serve the GIS analyst,
CAD technician, and remote spatial-data-editor roles** that the marketing copy
on metardu.duckdns.org references? Concretely — should metardu-desktop become a
GIS tool, or integrate with existing GIS tools?

The wrong answer is "become a GIS tool." QGIS is 20+ years and hundreds of
contributors of cartography, topology tools, attribute tables, raster styling,
and a plugin ecosystem. Building QGIS-class functionality inside metardu-desktop
would (a) force an architecture pivot away from survey-compute-first,
(b) reproduce the exact scope-drift failure pattern Section 0 of the master
plan was written to prevent, and (c) lose, because no team catches QGIS by
feature parity.

The right answer is: **metardu-desktop is the survey-grade source of truth that
feeds QGIS, AutoCAD, Pix4D/Metashape, and OSM.** That position is stronger than
"yet another GIS tool" and is reachable in weeks, not years. It also stays
inside the existing architectural invariants — no new compute paths, no new
privileged operations, no scope-drift into interactive map editing.

## Decision

Add a sixth workflow family to master plan Section 6: **Integration & Export**
(`packages/engine/src/integration/`). Its scope is strictly bounded:

### In scope

The Integration & Export family emits open, well-documented exchange formats
that downstream tools already consume. It does NOT implement interactive
editing, cartographic styling, or attribute-table workflows — those belong to
the downstream tool (QGIS, AutoCAD, etc.).

Initial deliverables (ordered by leverage × cost):

| # | Deliverable | Serves | Effort | Status |
|---|---|---|---|---|
| 1 | **GeoJSON export** with EPSG-correct CRS metadata + per-feature uncertainty attribution from the adjustment engine | GIS Analyst | Small | First task brief (see below) |
| 2 | **GeoPackage export** (OGC standard, single-file spatial DB) — same attribution as GeoJSON, plus layer-per-survey-type | GIS Analyst | Small | After #1 |
| 3 | **PyQGIS helper script generator** — emits a `.py` the analyst runs in QGIS that loads metardu-desktop's adjusted layers and applies country-correct symbology | GIS Analyst (the differentiator) | Medium | After #2 |
| 4 | **Auto-generated QGIS project file (.qgz/.qgs)** that pre-loads the survey layers with sensible styles | GIS Analyst | Medium | After #3 |
| 5 | **GCP file export** (Pix4D, Metashape, Agisoft CSV format) for drone photogrammetry tie-in | Spatial Data Editor (drone side) | Small | Parallel track |
| 6 | **OSM changeset XML export** for surveyed features that belong in basemaps (new roads, building footprints from topo surveys) | Spatial Data Editor | Medium — niche | Later |
| 7 | **CAD companion DXF** (already partially built in `packages/engine/src/documents/dxf-output.ts`) — extend to emit per-country statutory layer conventions for AutoCAD/Carlson/Civil 3D import | CAD Technician | Medium | Extend existing |

### Out of scope (explicit — these are NOT metardu-desktop's job)

- Interactive vector editing (use QGIS)
- Cartographic rendering pipeline (use QGIS / Mapbox Studio)
- Raster styling and band math (use QGIS / GRASS)
- Attribute-table editing UI (use QGIS / a spreadsheet)
- Topology rule enforcement on imported data (use QGIS topology checker)
- Basemap tile serving (use the existing OpenLayers MapView for preview only;
  tile serving belongs to a tile server, not a survey desktop app)
- Network-based nav-database editing (Here/TomTom/Google basemap editing APIs
  are a different product category — not adjacent, not feasible)

## Architectural placement

```
packages/engine/src/
├── integration/                   NEW — this ADR
│   ├── geojson-export.ts          Task brief #1
│   ├── geopackage-export.ts       Task brief #2 (future)
│   ├── pyqgis-script-generator.ts Task brief #3 (future)
│   ├── qgis-project-generator.ts  Task brief #4 (future)
│   ├── gcp-export.ts              Task brief #5 (future)
│   ├── osm-changeset-export.ts    Task brief #6 (future)
│   └── index.ts
├── documents/
│   └── dxf-output.ts              EXISTING — extended by task brief #7
└── workflows/
    └── ...                        unchanged — workflows produce the survey output
                                      that integration/ consumes
```

### Hard invariants this family must obey (restated from `docs/invariants.md`)

- **A1 (sidecar owns the math).** Integration modules do NOT recompute
  coordinates. They consume the survey output (adjusted coordinates with
  covariance, areas, residuals) and serialize it. If you find yourself writing
  `Math.sin` for projection math in `integration/`, stop and move it to the
  sidecar.
- **A2 (SRID comes from country config).** Every exported GeoJSON / GeoPackage
  feature MUST carry a CRS declaration sourced from `packages/country-config/`.
  A literal SRID number in `integration/` is a failing review.
- **A6 (forbidden dependencies).** GeoJSON export uses built-in JSON serializer.
  GeoPackage originally targeted `@ngageoint/geopackage` per this ADR; that
  library has a known incompatibility with modern `better-sqlite3` (named-
  parameter binding API drift). Per master plan Section 0's "if a cited
  invariant conflicts with this task, STOP and report the conflict" principle,
  Brief 03 documents the fallback in its module header: a direct GeoPackage
  writer using `better-sqlite3` (already a common Electron dep, MIT, native
  bindings, well-maintained). The GeoPackage spec for vector-only data is
  small enough that a direct writer is cleaner than the NGA library's heavy
  abstraction. PyQGIS script generation uses string templates only,
  no QGIS dependency. QGS project file generation uses XML templating, no QGIS
  dependency.
- **C1 (every statutory number traces to an adjusted value).** Exported
  coordinates carry their propagated uncertainty (semi-major axis, semi-minor
  axis, orientation of the error ellipse) as a per-feature property. This is
  not optional — it is the entire differentiator.
- **C2 (rounding only at display time).** Exported coordinates use full float64
  precision. Rounding to country-specific precision happens inside the
  downstream statutory document renderer, NOT in the integration exporter.

### Schema contract (the part that makes this a real abstraction)

Every integration exporter implements one shared interface:

```typescript
// packages/engine/src/integration/types.ts

import type { SurveyOutput } from "../workflows/index.js";

export interface IntegrationExporter<
  TInput extends SurveyOutput = SurveyOutput,
  TOptions extends IntegrationOptions = IntegrationOptions,
  TOutput extends IntegrationOutput = IntegrationOutput,
> {
  /** Format identifier — "geojson", "geopackage", "pyqgis-script", ... */
  readonly format: string;
  /** IANA / OGC MIME type for the produced artifact */
  readonly mimeType: string;
  /** File extension without leading dot */
  readonly fileExtension: string;
  /** Human-readable one-liner for the export menu */
  readonly description: string;
  /** Validate input before serializing — refuse to export if a statutory
   *  number is missing its uncertainty trace */
  validate(input: TInput, options: TOptions): ValidationResult;
  /** Serialize to bytes */
  export(input: TInput, options: TOptions): Promise<TOutput>;
}

export interface IntegrationOptions {
  /** Country config — source of SRID, precision convention, layer naming */
  countryCode: string;
  /** Whether to include the full covariance per feature (default: true).
   *  Downstream GIS tools that don't understand covariance can opt out,
   *  but the default is "ship the uncertainty." */
  includeUncertainty?: boolean;
  /** Project metadata — embedded in the export for traceability */
  projectMetadata?: {
    projectName: string;
    surveyorName: string;
    licenseNumber: string;
    surveyDate: string;
    softwareVersion: string;
    adjustmentRunId: string;
  };
}

export interface IntegrationOutput {
  format: string;
  bytes: Uint8Array;
  /** Number of features written */
  featureCount: number;
  /** List of warnings (not errors) — e.g. "feature X has no uncertainty
   *  because it predates the adjustment engine; exported without." */
  warnings: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
```

This interface is the contract that lets a sixth, seventh, eighth exporter
be added without touching workflow code, country-config code, or the UI —
the export menu iterates over the registered exporters.

## Rationale

- **Stays inside architectural invariants.** No new privileged operations,
  no new compute paths, no scope-drift. Every exporter is a pure serializer
  that consumes the existing survey output.
- **Differentiator is real.** "Survey-grade coordinates with propagated
  uncertainty, exported to your GIS/CAD/photogrammetry tool" is a defensible
  claim. "Yet another GIS tool" is not.
- **Reuses existing work.** `dxf-output.ts` already ships with country-correct
  layer conventions; task brief #7 extends it rather than rebuilding. The
  country-config package already exists for 5 countries; exporters read SRID
  and precision from it.
- **Unlocks three marketing claims truthfully.** See "Marketing claims"
  section below.

## Alternatives considered

- **Build a QGIS plugin instead of an exporter.** Rejected: a QGIS plugin
  runs inside QGIS and inherits its compute model — we'd lose the Rust sidecar's
  geodetic correctness guarantees and end up duplicating math in Python. The
  exporter approach keeps metardu-desktop as the source of truth and QGIS as
  the downstream consumer.
- **Embed QGIS via qgis-python in Electron.** Rejected: massive dependency,
  architecture pivot, offline-hostile (QGIS distributions are gigabytes).
  Violates invariant A5.
- **Add a cartographic rendering pipeline to metardu-desktop's UI.** Rejected:
  the existing SurveyCanvas (SVG) + OpenLayers MapView (preview) is enough for
  surveyor self-check. Production cartography is the GIS analyst's job.
- **Build a separate "metardu-gis" product.** Rejected: fragments engineering
  resources, duplicates the country-config and adjustment code, and produces
  two products neither of which is mature. Integration & Export keeps it
  under one roof.

## Consequences

### Positive

- **Marketing claims become truthful.** See below.
- **Customer base widens** without scope-drift. Surveyors keep using
  metardu-desktop as before; GIS analysts receive the output; CAD technicians
  receive DXF; drone operators receive GCP files.
- **No new compute paths.** Sidecar math is unchanged. Engine orchestration is
  unchanged. Electron shell is unchanged. Only `packages/engine/src/integration/`
  is new code, and it is pure serialization.
- **Future country expansion is unaffected.** Adding a sixth country still
  means "implement `country-config/<country>.ts`" — the integration exporters
  read SRID and precision from it automatically.

### Negative (acknowledged)

- **One more workflow family to maintain.** The Integration & Export family
  adds ~6 modules and ~50 tests over the course of its build-out. This is
  acceptable given the customer-base argument.
- **Format drift risk.** GeoJSON, GeoPackage, QGS, and OSM XML are all
  versioned standards; we must pin and test against specific versions. The
  first task brief addresses this with pinned fixture files.
- **Marketing must be precise.** The marketing copy must NOT claim
  metardu-desktop "is a GIS tool." It claims metardu-desktop "feeds your GIS
  tool with survey-grade data." This ADR's Marketing Claims section is the
  canonical reference for what sales copy may and may not say.

## Marketing claims (canonical — sales copy must align with this)

### What we CAN truthfully claim

> "metardu-desktop produces survey-clean, projection-correct GeoJSON and
> GeoPackage exports with propagated uncertainty per feature. Your GIS work
> starts from ground truth, not from cleanup."

> "metardu-desktop generates a PyQGIS loader script — open the .qgs file in
> QGIS and your adjusted survey layers load with country-correct symbology.
> No more manual layer setup, no more projection mistakes."

> "metardu-desktop converts raw field data from Leica, Sokkia, and Trimble
> instruments into statutory-grade DXF with country-correct layer names and
> title blocks. Import into AutoCAD, Carlson, or Civil 3D and your drafting
> starts from a survey-correct base."

> "metardu-desktop generates drone flight plans and GCP files in Pix4D,
> Metashape, and Agisoft format — your photogrammetry pipeline starts from
> survey-grade control."

### What we CANNOT claim (and the marketing copy must be corrected if it does)

- "metardu-desktop is a GIS tool." — No. It feeds GIS tools.
- "metardu-desktop replaces QGIS." — No.
- "metardu-desktop replaces AutoCAD for general drafting." — No. It feeds
  AutoCAD with survey-correct DXF.
- "metardu-desktop updates Here/TomTom/Google nav databases." — No. OSM
  changeset export is for the open basemap community, not commercial nav
  databases — those are a different product category.

### Role-to-claim mapping (the table from the planning conversation)

| Role | Defensible claim | Not defensible |
|---|---|---|
| GIS Data Analyst / Developer | Produces survey-clean, projection-correct GeoJSON/GeoPackage + PyQGIS loader script. GIS work starts from ground truth, not cleanup. | "Replaces QGIS." Don't. |
| CAD Technician / Draftsman | Converts raw field data (Leica/Sokkia/Trimble) into statutory-grade DXF with country-correct layer names and title blocks. | "Replaces AutoCAD for general drafting." Don't. |
| Remote Spatial Data Editor | Generates drone flight plans, GCP files for photogrammetry (Pix4D/Metashape/Agisoft), and OSM changesets for surveyed basemap features. | "Updates Here/TomTom nav databases." Don't. |

## Verification

- [x] `packages/engine/src/integration/` exists with `index.ts` re-exporting
  the `IntegrationExporter` interface and the `geoJsonExporter`.
- [x] First exporter (`geojson-export.ts`) implements the
  `IntegrationExporter` interface, reads SRID from `country-config`, includes
  per-feature uncertainty, and ships with golden fixtures.
- [x] All existing tests still pass (no regressions) — 537/537 engine tests.
- [x] New tests in `packages/engine/src/integration/tests/` cover: happy path,
  missing-uncertainty handling, CRS metadata correctness, round-trip via
  `JSON.parse` of the produced bytes, precision preservation, UTF-8
  round-trip, includeUncertainty default vs explicit false, degenerate
  adjusted-but-no-ellipse case, plus 3 fixture-loading tests.
- [x] Two GeoJSON golden fixtures committed:
  - `packages/engine/src/integration/tests/fixtures/kenya-cadastral-4-beacon.json`
    — 4-beacon Kenya cadastral survey, SRID 21037, with propagated 95%
    confidence ellipses on B3 and B4.
  - `packages/engine/src/integration/tests/fixtures/uk-cadastral-general-boundaries.json`
    — UK general-boundaries case, OSGB36 (SRID 27700), all beacons
    adjusted=false with `reason: "fixed-control"`.
- [x] **Brief 02** — GeoJSON exporter extended to consume topographic +
  engineering workflow outputs. `SurveyOutput` generalized to a union;
  `detectSurveyType()` discriminator routes to per-type feature builders.
  14 new tests, 2 new fixtures (kenya-topographic-5x5-grid.json,
  kenya-engineering-cut-fill.json).
- [x] **Brief 03** — GeoPackage exporter (`geopackage-export.ts`) shipped.
  Direct writer using `better-sqlite3` (ADR-0005 dependency-revised per the
  ADR's own "STOP and report the conflict" principle — `@ngageoint/geopackage`
  has a known incompatibility with modern `better-sqlite3` named-parameter
  binding API). Multi-layer pattern: `beacons` + `parcel` (cadastral);
  `topo_points` + `contours` + `spot_heights` (topographic);
  `section_centerlines` + `cross_section_profiles` (engineering). Project
  metadata embedded in `gpkg_metadata`. 15 new tests, 2 new fixtures
  (kenya-cadastral.gpkg, kenya-topographic.gpkg).
- [x] **Brief 04** — PyQGIS helper script generator (`pyqgis-script-generator.ts`)
  shipped. Emits a `.py` script the GIS analyst runs inside QGIS to load
  metardu-desktop's GeoPackage with country-correct symbology (Kenya cadastral:
  red beacon crosses + yellow parcel fill; UK general-boundaries: blue dashed
  lines; topographic: brown contours + green spot heights; engineering:
  orange centerlines + magenta-flagged cross-section profiles that are
  explicitly NOT map features). Per ADR-0005: pure string templates, no QGIS
  dependency in the engine. 16 new tests including `python3 -m py_compile`
  syntax validation of the golden fixtures. 2 new fixtures
  (kenya-cadastral.py, kenya-topographic.py).
- [x] **Brief 06** — GCP file exporter (`gcp-export.ts`) shipped. Emits CSVs
  in Pix4D / Metashape / Agisoft format for drone photogrammetry tie-in.
  Architectural change: relaxed `IntegrationExporter<TInput extends SurveyOutput>`
  constraint to `IntegrationExporter<TInput>` (no constraint) per master plan
  Section 0's "STOP and report the conflict" principle — GCPs are a list of
  3D control points, not a workflow output, so they need a different input
  type (`GcpInput`). The 3 existing exporters retain type safety via explicit
  `TInput = SurveyOutput` declaration. `INTEGRATION_EXPORTERS` is now
  heterogeneous (`IntegrationExporter<any, any, any>[]`); the export menu UI
  dispatches on the `format` field. Per-GCP accuracy propagated to
  Metashape/Agisoft's accuracy_xy/accuracy_z columns from `uncertainty.semiMajor`
  (XY) and 1.5× that (Z, RTK vertical is typically 1.5× worse than horizontal).
  Pix4D has no accuracy column — uncertainty is on a separate `#`-comment line
  below each GCP row (not trailing on the same row, to avoid breaking Pix4D's
  CSV parser with commas in the comment). 21 new tests + 3 golden fixtures
  (kenya-gcp-pix4d.csv, kenya-gcp-metashape.csv, kenya-gcp-agisoft.csv).
- [x] Prerequisite: `CadastralWorkflowOutput` extended with an `uncertainty`
  field carrying per-beacon error ellipses (semi-major, semi-minor,
  orientation, confidence level) — sourced from the existing normal matrix's
  inverse, `covariance = σ₀² × N⁻¹`.
- [ ] Marketing copy on metardu.duckdns.org updated to align with the
  "Marketing claims" section above. (Out of scope for the engineering task —
  flagged for Mohammed.)

## References

- Master plan: `upload/METARDU-DESKTOP-MASTER-PLAN.md` Sections 2, 5, 6, 7
- Invariants: `metardu-v2/docs/invariants.md` A1, A2, A6, C1, C2
- Existing DXF exporter (the pattern to follow): `metardu-v2/packages/engine/src/documents/dxf-output.ts`
- Existing country-config: `metardu-v2/packages/country-config/src/countries/{kenya,australia,united-kingdom,south-africa,united-arab-emirates}.ts`
- GeoJSON spec: RFC 7946
- GeoPackage spec: OGC 12-128r14
- PyQGIS: https://docs.qgis.org/3.34/en/docs/pyqgis_developer_cookbook/
- OSM changeset XML: https://wiki.openstreetmap.org/wiki/Osmapi#Editing
