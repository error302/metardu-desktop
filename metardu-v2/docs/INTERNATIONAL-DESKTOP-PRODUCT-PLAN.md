# METARDU Desktop — International Product Plan

**Status:** Product direction and release gates; not a claim of survey-grade readiness
**Prepared:** 12 October 2026
**Scope:** The offline-first Electron desktop application

## Product promise

METARDU Desktop should let a practicing surveyor take a project from source observations and existing control, through checked computation and design, to reviewable deliverables without a dependable internet connection. It should be useful across jurisdictions because its global computation core is separated from country-specific reference systems, standards, and legal forms.

“Unlimited capabilities” should describe access to the product’s supported desktop workflows, not unlimited accuracy or universal legal acceptance. A workflow is enabled for a location only when its coordinate operation, reference data, computation, and output rules have evidence for that use. When evidence is absent, METARDU must say what is missing and keep the dependent result unavailable.

The market promise is **one surveyor’s workspace, many verified jurisdictions**. It is not one global cadastral form, one assumed datum, or one accuracy claim.

## Product model

| Layer | Global responsibility | Jurisdiction or project responsibility |
|---|---|---|
| Project and observation model | Preserve original observations, source files, timestamps, units, instrument metadata, and audit history | Project CRS, coordinate epoch, vertical reference, local identifiers, and mandated attributes |
| Computation | Deterministic adjustment, COGO, projections, coordinate operations, raster processing, and explicit uncertainty | Select only operations and reference datasets valid for the project’s area, epoch, and required accuracy |
| Workflow | Control → observe/import → validate → compute → design/set out → verify → deliver | Country terminology, local procedures, signed conventions, forms, and statutory checks |
| Deliverables | Interoperable data with explicit CRS, units, provenance, and quality status | A legal or regulator-specific layout only when its current primary source and review evidence are recorded |
| Desktop operation | Local-first storage, backup, package verification, recovery, and computation with no network | Optional, explicit updates to a pinned country or reference-data package |

Global availability means the core understands declared coordinate systems and evidence. It does not mean that every country pack ships with the app or that a global geoid replaces a national vertical datum.

## Community extension ecosystem

METARDU Desktop should support a QGIS-like community ecosystem for survey work: instrument and file adapters, specialist analysis tools, project templates, local code sets, reference-data packs, report add-ons, and visualization overlays. Extensions broaden the workflows that a surveyor can complete inside the standalone desktop workspace while the core remains survey-compute-first and interoperates with GIS and CAD tools.

The extension API must be versioned, capability-scoped, and project-aware. Community code must not run with direct Electron, filesystem, network, or database privileges. It must consume explicitly selected project data and return derived artifacts with the plugin identity, exact version and digest, declared method, coordinate context, inputs, warnings, and output provenance recorded. Community output remains visibly unreviewed or draft until METARDU's own review evidence qualifies the specific method and use.

Packages and their dependencies must be installable and pinned for offline work. Catalog browsing and updates may use the network, but survey computation must not depend on the catalog. Country and legal packs require source provenance and jurisdiction-specific review; installing a community pack alone does not make it an official or accepted survey convention.

The architecture decision and rollout gates are recorded in `docs/decisions/0007-community-extension-ecosystem.md`. The runtime, developer SDK, installer, and catalog are future implementation work; this product plan does not claim they exist today.

## Shared METARDU account and subscription

Every active paid METARDU Web plan (Pro, Team, Firm, or Enterprise) includes Desktop access for the same entitled account. No separate Desktop subscription, add-on, or checkout is required. Team and firm Desktop access follows the same Web account and seat assignments. The Web server remains the source of truth for account identity, subscription status, and seat eligibility. Desktop must not infer payment from a plan name, user-entered tier, cached local preference, or a successful Web sign-in alone.

The current desktop tree has no working account-verification integration. The companion Web checkout has server-side subscription records and a `GET /api/subscription` route, but that route authenticates through the Web app's browser session and currently returns a `free`/`active` payload for unauthenticated requests and server errors. It is not a safe Desktop entitlement contract. Before integration, the Web service must expose an authenticated desktop-capable account flow and an explicit, versioned entitlement response. Authentication failures, subscription-service failures, and unknown states must remain failures; they must never look like a verified free or paid entitlement.

The Desktop client must use a first-party account flow that supports the same Web account providers without collecting a password in the renderer. Its server-issued session or lease must be scoped to the Desktop client, revocable, and stored through the operating system's protected credential storage. Entitlement checks must use the shared server-side subscription record; every active paid Web plan includes Desktop, while account and seat eligibility remain server-owned. Do not hard-code the Web plan-to-feature matrix into the renderer.

Because Desktop is offline-first, the Web and Desktop services must define one compatible offline entitlement policy before release: credential format, expiry, renewal, revocation behavior, and the user-visible state when the subscription server cannot be reached. No offline lease or grace period is configured in this build. Subscription status is separate from survey evidence: a paid account cannot make an unsupported coordinate operation, computation, field connection, or statutory document verified.

## Surveyor experience

### First project

Project creation should ask for the intended survey type from the existing eight types, country or jurisdiction (optional for non-statutory work), project units, horizontal CRS, vertical reference, coordinate epoch when relevant, and required deliverable. It must not choose Kenya, WGS 84, a geoid, or a legal accuracy standard silently. If a file supplies CRS metadata, show what was read and ask the surveyor to confirm mismatches or missing context.

The project header should keep the active horizontal CRS, vertical reference, units, epoch, and verification state visible. A project can contain mixed source datasets only when each dataset retains its own reference and an explicit supported operation connects it to the project context.

### Workbench

Use a desktop workbench built for long sessions and dense survey data:

- A project navigator for control, observations, traverses, surfaces, designs, documents, and audit events.
- A central canvas that can show a map, fieldbook, coordinate table, adjustment, CAD drawing, profile, or surface as appropriate to the task.
- A results and evidence panel that shows the operation, inputs, residuals, uncertainty, data package versions, warnings, and next action for the selected result.
- A persistent status strip for autosave state, active units/reference systems, offline state, and unresolved project checks.
- Keyboard-first tables, undoable edits, clear focus states, accessible labels, configurable precision, high-DPI layouts, and multi-monitor support.

The map is a workspace aid, not proof that coordinates are right. Every numeric deliverable must remain inspectable as a table with source and quality information.

### Quality states

Give values and deliverables explicit states such as **Imported**, **Unverified**, **Computed**, **Checked**, **Draft**, **Blocked**, and **Approved by user**. These states must describe evidence in the project, not imply that METARDU has legal authority. Never show a fabricated sample result, default-zero elevation, blank-to-zero conversion, invented control, or unsupported accuracy value in a real project.

## Technical contracts

### Coordinates and operations

Represent a coordinate context with at least:

- Source and target CRS identifiers and full definitions where needed.
- Axis order, angular and linear units, and coordinate epoch or observation epoch where applicable.
- The selected operation chain, area of use, stated accuracy, authority/source, and validity period.
- Required transformation grids with model/version, coverage, checksum, licence, and interpolation method.
- The original input and output coordinate plus a traceable record of the operation used.

An operation selector must reject area-of-use, epoch, grid, or accuracy mismatches. Never pick a transformation because it is the only available one. Do not equate a WGS 84 label with an epoch-free, centimetre-level coordinate. Preserve unknown reference context and fail closed when the requested output needs it.

Rust in `packages/metardu-sidecar/` remains the authority for geodetic transforms, adjustment, COGO, and raster math. TypeScript may orchestrate workflows, validate payload structure, and present results; it must not become a second implementation of survey math. Renderer code remains sandboxed and calls only typed, allowlisted preload operations.

### Vertical reference data

Treat height conversion as a named transformation, not a generic “elevation” field. Keep ellipsoidal height, geoid undulation, orthometric height, local vertical datum, tide system, and units explicit. A package loader must hash the actual bytes before parsing, validate the declared grid axes, dimensions, values, nodata, and coverage, and pin the package version/hash into the project and exports. Missing, corrupt, out-of-coverage, or incompatible data blocks the conversion; it never triggers a download or fallback.

The current EGM96 archive is useful for reproducing DJI-compatible height references, but NGA identifies EGM96 as a legacy model and recommends EGM2008. The NGA archive’s published `INTPT.F` uses a 4-by-4 spline window; a local comparison of its six supplied sample points with bilinear interpolation differed by about 3–56 mm. Therefore the current TypeScript bilinear routine is not interchangeable with NGA’s reference interpolation for those samples. METARDU must implement and verify the selected interpolation method in the sidecar, preserve the method in provenance, and keep local vertical-datum claims separate from global geoid-model output. Before bundling or redistributing NGA files, record their applicable licence and redistribution terms from an authoritative source.

Reference sources:

- [NGA EGM data and downloads](https://earth-info.nga.mil/index.php?action=w_egm-main&dir=w_egm) — publishes the EGM96 15-minute and EGM2008 2.5-minute interpolation-grid packages.
- [NGA WGS 84 and EGM overview](https://earth-info.nga.mil/?action=wgs84&dir=wgs84) — identifies EGM96 as legacy and recommends the latest NGA model, currently EGM2008.
- [NASA/TP-1998-206861, Section 11](https://cddis.nasa.gov/926/egm96/doc/S11.HTML) — describes the EGM96 geoid undulation relative to the WGS 84 ellipsoid and the interpolation precision target.

### Project evidence and storage

The project record should retain immutable imported originals, normalized observations, processing configuration, operator identity, software version, reference-data versions, computation results, warnings, overrides, approvals, and exported files. An override must record who made it, when, why, and which result it affects. Local backups must be versioned and restorable; migrations need a backup/rollback strategy. Sync, if later offered, is an explicit transport for project packages and must not become the authority for numerical computation.

### Interoperability

Importers should identify format, units, CRS metadata, vertical reference, and unsupported fields before committing data to a project. Preserve source attributes and report lossy conversions. Exporters must emit CRS and height semantics in formats that support them, plus a sidecar manifest when they do not. Every export should reopen through the corresponding importer and compare points, attributes, units, coordinate context, and provenance.

Instrument support should be incremental and evidence-based: start with real files and documented protocols, then add live connections. Keep raw observations beside parsed data. Test each receiver/total-station family with representative files or hardware before presenting it as supported. Do not substitute mock telemetry for a successful field connection.

## International launch strategy

1. **Make the global kernel trustworthy.** Close unsupported-operation and height-model gaps; make reference context explicit throughout the project and export chain.
2. **Prove the computation core.** Build independent known-answer fixtures for adjustment, COGO, projection, and height conversions, including invalid-input, boundary, and out-of-coverage cases. Use practicing surveyors to review methods and tolerances.
3. **Select one launch jurisdiction with a design partner.** Choose it based on a real surveyor/customer and access to authoritative control, current primary rules, sample data, and professional review. Do not infer the next country from code coverage or market size alone.
4. **Deliver one complete workflow there.** Import raw observations, preserve provenance, validate inputs, compute with uncertainty, review results, produce the documented output, reopen it, and recover the project from backup.
5. **Repeat for a second jurisdiction.** The second pack is the proof that country assumptions were isolated correctly. Do not call the product international merely because a country list contains many entries.
6. **Package and support the desktop product.** Ship signed Windows, macOS, and Linux builds where the dependency matrix supports them; provide offline installation, data-package updates, migration/backup guidance, diagnostics, crash recovery, and a clear support channel. Verify each installer on a clean machine and real supported hardware.

The repository’s `AGENT.md` describes an implementation order, but the referenced `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent from this checkout. Treat this file as product direction; reconcile it with the owner’s controlling plan before changing the established build sequence or regulatory commitments.

## Release gates and measurable evidence

Do not market a workflow as survey-grade until all gates below pass for the specific jurisdiction and scope:

1. **Numerical authority:** independent reference values, documented operation and error model, testable units/epochs, and no duplicate TypeScript math.
2. **Geospatial coverage:** valid area of use and required grids are present, byte-verified, correctly versioned, and tested at interior, edge, dateline, and polar cases as applicable.
3. **Survey workflow:** raw-to-delivery use cases pass known-answer and malformed-input cases; residuals and uncertainty remain visible; a practising surveyor reviews the method and output.
4. **Document authority:** statutory content has current primary-source documents, clause/page traceability, representative examples, and jurisdictional professional review. Without those, output remains clearly marked draft.
5. **Interoperability:** imports retain evidence; exports round-trip without silent loss; common CAD/GIS/survey packages are exercised with real customer files.
6. **Desktop reliability:** clean-install, offline operation, upgrades, rollback, backup/restore, large-project performance, signing, crash recovery, and security checks pass on the claimed operating systems.
7. **Field validation:** supported instrument and GNSS workflows are tested with real equipment and survey data in the intended operating conditions.
8. **Commercial validation:** a small paid pilot demonstrates that surveyors can complete the workflow, inspect its evidence, and trust the review boundary. Feature counts and a successful build are not market proof.

Set numerical thresholds from the relevant method, reference dataset, and customer requirements. Never publish a single universal accuracy figure for all METARDU projects.

## Current evidence-backed priorities

1. Restore or explicitly replace the missing controlling desktop master plan with owner-reviewed, versioned product requirements.
2. Add a byte-verifying, licence-aware vertical-grid package format and sidecar interpolation, starting with a pinned EGM96 compatibility package only after its distribution terms are resolved. Preserve the official interpolation semantics and do not present EGM96 as a local national height datum.
3. Build a user-driven drone survey-area editor and export workflow only after height evidence, aircraft profiles, and device validation are available; the current engine export correction alone does not establish desktop field readiness.
4. Establish a global coordinate-operation catalogue with area, epoch, accuracy, and grid prerequisites, and remove any renderer-only coordinate computation or misleading preview.
5. Complete one customer-selected country workflow end to end, then validate the architecture with a second country.
6. Close desktop packaging, installation, update, recovery, and cross-platform verification before broad launch claims.

## Definition of success

A surveyor in a supported jurisdiction can install METARDU offline, create a project with explicit reference context, import real observations without losing source evidence, compute a checked result with method and uncertainty, review warnings and overrides, create a jurisdiction-appropriate draft or approved deliverable, reopen it in relevant tools, and restore the project from backup. A surveyor in an unsupported jurisdiction can still use explicitly global tools, see the precise unsupported step, and export neutral data without METARDU inventing a local convention.
