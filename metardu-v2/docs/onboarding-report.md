# MetaRDU Desktop — Codebase Onboarding Report

**Agent:** Codebase Onboarding Engineer (read-only)
**Date:** July 2026
**Scope:** `github.com/error302/metardu-desktop` @ v1.0.0 + upstream `github.com/error302/metardu`
**Purpose:** Factual map of the current architecture, IPC surface, dependencies, and tech-debt inventory. This document is the input to every subsequent agent (Software Architect, Desktop App Engineer, Spatial Data Engineer, Drone/Reality Mapping) and the foundation for ADRs 006-012.

---

## 1. Repository Snapshot

| Field | Value |
|---|---|
| Repository | `github.com/error302/metardu-desktop` |
| License | MIT (NOASSERTION — credits `error302` as original author of upstream metardu) |
| Default branch | `main` |
| Latest tag | `v1.0.0` |
| Stars / forks / issues | 0 / 0 / 0 (solo project, no community yet) |
| Repo size | ~2.6 MB |
| Primary language | TypeScript (100%) |
| Created | 2026-07-12 |
| Last push | 2026-07-14 |

**External footprint:** Zero. Web search for "MetaRDU surveying", "error302 github metardu", and "metardu surveying software" returns no third-party blog posts, reviews, or discussions. The project has no community validation yet.

---

## 2. Tech Stack (Confirmed)

### Shell layer: **Electron 31** (NOT Tauri)

Per ADR-001, Electron was chosen over Tauri for v1.0 because ~95% of the upstream metardu TypeScript code can be reused verbatim, minimizing time to v1.0. Tauri was explicitly rejected for v1.0 (adds 2 months, doubles glue code) but flagged for v2.0 reconsideration.

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | Electron | ^31.0.0 |
| Bundler (renderer) | Vite + vite-plugin-electron | ^5.3.0 |
| Frontend framework | React | ^18.3.0 |
| Map canvas (2D) | OpenLayers | ^10.0.0 |
| 3D canvas | three.js | ^0.185.1 |
| Icons | lucide-react, @phosphor-icons/react | — |
| Backend (main process) | Node.js (Electron main) | ≥20 |
| Database | SQLite + SpatiaLite via `better-sqlite3` | ^12.0.0 |
| IPC | Electron `contextBridge` | — |
| Serial comms | `serialport` + `@serialport/parser-readline` | ^13.0.0 |
| Crypto / PDF / DXF / Excel | `pdf-lib`, `pdfkit`, `jspdf`, `dxf-writer`, `exceljs`, `jszip`, `xmlbuilder2` | — |
| Geo libs | `proj4`, `@turf/turf`, `d3-contour`, `delaunator` | — |
| Validation | `zod` | ^3.25 |
| Auto-update | `electron-updater` + `electron-log` | ^6.2 / ^5.1 |
| Packaging | `electron-builder` | ^24.13 |
| Tests | Vitest + `@vitest/coverage-v8` + `fast-check` | ^1.6 |
| Lint | ESLint + `@typescript-eslint/*` | ^8.57 |
| AI orchestration | 12 agents vendored from `msitarzewski/agency-agents` in `.claude/agents/` | — |

**No `Cargo.toml` exists.** The project is 100% TypeScript (npm workspaces monorepo).

### Upstream `metardu` (web app, for reference)

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | Tailwind CSS + Radix UI + shadcn/ui pattern |
| Maps | OpenLayers 10.8.0 (no Leaflet, no Mapbox, no Google Maps) |
| State | Zustand + TanStack React Query |
| DB | PostgreSQL + PostGIS + Prisma |
| Cache/Queue | Redis + BullMQ |
| Auth | NextAuth.js + Zod + RBAC |
| Mobile | PWA + Capacitor (Android APK) |
| Python worker | FastAPI sidecar (`georinex`, `numpy`, `scipy`, Pyosmium) |
| Tests | Jest + Vitest + Playwright |
| Deploy | Docker, docker-compose, Cloudflare Tunnel, Caddy, nginx, PM2 |

---

## 3. Repository Layout

```
metardu-desktop/
├── apps/desktop/                     # Electron + React app
│   ├── electron/                     # Main process — 38 TS modules
│   │   ├── main.ts                   # Window + menu + auto-update
│   │   ├── ipc.ts                    # 118 IPC handlers (rate-limited, idempotent)
│   │   ├── preload.ts                # contextBridge API surface
│   │   ├── database.ts               # SQLite/SpatiaLite wrapper (799 LOC)
│   │   ├── total-station-driver.ts   # OV2 — 6 brands auto-detected
│   │   ├── gnss-rtk.ts               # OV9 — NTRIP streaming
│   │   ├── crypto-seal.ts            # RSA-2048 surveyor certificate seal
│   │   ├── drone-imagery.ts          # ODM/Pix4D/Agisoft import (PLACEHOLDERS)
│   │   ├── drone-volume.ts           # Stockpile + cut/fill
│   │   ├── aerial-pipeline.ts        # 13-stage aerial-to-statutory pipeline
│   │   ├── gcp-manager.ts            # GCP CRUD + export + residual verify
│   │   ├── title-chain.ts            # OV7 — ArdhiSasa lookup
│   │   ├── point-cloud-engine.ts     # OV3 — out-of-core octree
│   │   └── … 22 more modules
│   ├── src/                          # Renderer — 31 React components
│   │   ├── App.tsx                   # Map-first layout, Ctrl+K palette
│   │   └── components/               # TraversePanel, DeedPlanPanel, etc.
│   └── electron-builder.yml          # Win/Mac/Linux config
├── packages/engine/                  # Surveying math engine (PURE TS)
│   └── src/                          # ~357 TS modules
│       ├── engine/                   # Traverse, COGO, LSA, area, volume
│       ├── geo/ + geodesy/           # Cassini-Soldner, Arc 1960, Helmert, UTM
│       ├── topo/                     # TIN, contours, IDW, feature codes
│       ├── engineering/              # Road design, pavement, mass-haul
│       ├── gnss/                     # NTRIP, RINEX, NMEA, BLE
│       ├── importers/                # CSV, GSI, JobXML, RW5, LAS/LAZ, RINEX, Pix4D
│       ├── export/                   # DXF, LandXML, GeoJSON, Shapefile, NLIMS, IFC, machine-control
│       ├── documents/                # Form No. 4, beacon certs, mutation, PDF engine
│       ├── submission/               # NLIMS/ArdhiSasa preparation + 13 CLA forms
│       └── compute/                  # Deed plan, TIN, subdivision generator, etc.
├── docs/                             # 14 markdown files
│   ├── adrs/                         # ADR-001 through ADR-005
│   ├── OVERKILL_VISION.md            # 10 "overkill" desktop features
│   ├── PRODUCT_STRATEGY.md           # Mobile / Web / Desktop split
│   ├── MATH_IMPROVEMENT_PLAN.md      # 14 prioritised math gaps
│   ├── RELEASE_NOTES_v1.0.0.md
│   ├── RELEASE_CHECKLIST.md
│   └── SYNC_API_CONTRACT.md
├── scripts/                          # 31 test/automation scripts (Python + Node .mjs)
├── .github/workflows/ci.yml          # 3-OS matrix CI
└── package.json                      # Workspace root
```

### Code volume

| Metric | Count |
|---|---|
| TS/TSX source files | **490** |
| Lines of TypeScript code | **~145,971** |
| Engine modules | ~357 |
| Test files (`*.test.ts`) | **86** |
| Engine tests passing | 1259/1259 (100%) — claimed in release notes |
| Branch coverage | 75% (target 70%, exceeded) |
| IPC handlers registered | **118** (across 25 namespaces) |
| React components | 31 |
| Acceptance / smoke scripts | 31 |
| ADRs | 5 |
| Placeholder occurrences | 22 (in 8 Electron files) |

---

## 4. IPC Handler Distribution

118 IPC handlers across 25 namespaces. Every handler is wrapped with:
- Rate-limiting (120 calls/min/channel)
- Idempotency (dedup concurrent writes)
- Structured error envelopes (`{success, data, error}`)
- Observability metrics (slow-computation detection)

**Top namespaces by handler count:**

```
14  drone:*      (drone imagery + volume + mass-haul)
12  map:*        (layers, symbology, measurements, scale bar)
10  gcp:*        (CRUD, distribution assessment, export, residual verify)
 9  pipeline:*   (aerial pipeline stages + cost estimation)
 5  parcel:*  | 5  crypto:*  | 5  cogo:*  | 4  traverse:*  | 4  system:*  | 4  gnss:*  | 4  edm:*  | 4  db:*  | 4  contours:*
```

**Critical finding:** Almost all 118 handlers accept `input: any`, `options: any`. The `zod` library is a dependency but is NOT used in the IPC layer. This is the security/reliability gap that ADR-012 closes.

---

## 5. Feature Inventory

### Three surveying verticals (v1.0)

**Cadastral Surveying (M2–M3):**
- Bowditch / Transit traverse closure with precision evaluation
- Form No. 4 deed plan PDF generation (A1/A2/A3/A4)
- NLIMS / ArdhiSasa JSON export with schema validation
- 9-sheet statutory computation workbook (Excel)
- Mutation forms (subdivision / amalgamation per Survey Act Cap. 299)
- RSA-2048 cryptographic surveyor certificate seal (`crypto-seal.ts`)
- Beacon registry CRUD with append-only audit log
- Smart deed plan auto-layout (constraint solver, not AI)

**Topographic Surveying (M4–M5):**
- Breakline-aware constrained Delaunay TIN (50k points in 100 ms claimed)
- Marching-triangle contours at any interval
- RINEX 2/3/4 import
- LAS / LAZ point-cloud import
- DXF export with 61-layer SoK registry
- LandXML 1.2 / GeoJSON / Shapefile export
- Feature coding library (70 codes, 10 categories)
- GIS QA Report (PASS / CONDITIONAL / FAIL)

**Engineering Surveying (M6–M7):**
- Horizontal / vertical curve design
- Superelevation computation
- Leveling (rise & fall + height of collimation, 10√K mm closure per RDM 1.1)
- Cross-section volume (prismoidal + end-area)
- Mass-haul diagram optimisation
- AASHTO pavement design (ESA + layer structure)
- Slope analysis (IDW interpolation + classification)
- Staking table generation
- Road reserve compliance checking
- As-built survey comparison
- Machine-control export in **7 formats**: LandXML, DXF, Trimble, Leica, Topcon, generic, stakeout CSV

### 8 "Overkill" desktop-exclusive features (per OVERKILL_VISION.md)

1. **OV2** Real-time total station streaming — native `serialport`, auto-detects Topcon/Leica/Sokkia/Trimble/Pentax/South, face-left/right averaging
2. **OV3** Massive point cloud engine — out-of-core octree, 10M+ points
3. **OV4** Auto-blunder detection — Baarda χ² test, data snooping w-test, robust IRLS (Huber/IGG3/Tukey)
4. **OV5** 3D parcel visualization — building extrusion, subsurface/airspace rights
5. **OV6** Multi-window workspace — 7 window types, multi-monitor
6. **OV7** Title chain tracking — parcel genealogy, ArdhiSasa online lookup
7. **OV8** Smart deed plan auto-layout — pure constraint solver
8. **OV9** GNSS RTK + NTRIP — persistent TCP corrections, NMEA parsing, RINEX recording

### Country-pack architecture (ADR-005)
- `country-packs/<ISO3>/` directory pattern with manifest, CRS, deed-plan template, submission schema, locale files
- Only **KEN** implemented in v1.0
- TZA/UGA/RWA/BDI planned for v1.1, USA PLSS for v2.0

### 9 supported survey types
Cadastral · Engineering · Topographic · Geodetic/Control · Mining · Hydrographic · **Drone/UAV Photogrammetry** · Deformation/Monitoring · Mixed Discipline

---

## 6. Drone Capabilities — CRITICAL FINDING

**There is NO MAVLink, MAVSDK, DroneKit, DJI SDK, or PX4/ArduPilot integration anywhere in the codebase.**

Verified by full-repo ripgrep:
```
$ rg "MAVLink|MAVSDK|DroneKit|mavlink|mavsdk|dronekit"  →  No matches found
```

The "Drone / UAV Photogrammetry" survey type is implemented as a **downstream consumer of photogrammetry tool outputs**, not as a drone controller. The codebase explicitly states this in `apps/desktop/electron/drone-imagery.ts:1-7`:

> *"METARDU doesn't process drone photos (that's OpenDroneMap/Pix4D's job). Instead, METARDU takes the OUTPUTS of those tools and turns them into statutory survey deliverables."*

And in `aerial-pipeline.ts:439`:
> *"drone_capture: 'Drone flight (external — not executed by METARDU)'"*

### Drone-related modules (all in `apps/desktop/electron/`)

| Module | LOC | Real / Placeholder |
|---|---|---|
| `gcp-manager.ts` | 584 | **Real, full implementation** |
| `aerial-pipeline.ts` | 522 | Real orchestrator (but stages 3 & 4 are external) |
| `drone-volume.ts` | 481 | Real math, but DSM points must be supplied as JS arrays — no GDAL raster I/O |
| `drone-imagery.ts` | 641 | **Hybrid** — registry/CRUD is real; **contour generation and feature extraction are explicit placeholders** |

### What it actually does for drones today

1. **GCP workflow (the strong suit, fully implemented):**
   - Convert METARDU survey points into GCPs
   - Assess GCP distribution (1 GCP / 5 ha minimum, quadrant coverage, edge coverage, ~20% check points)
   - Export GCP files in **4 formats**: ODM `gcp_list.txt`, Pix4D CSV, Agisoft Metashape XML, generic CSV
   - After photogrammetry, verify GCP residuals against thresholds (horizontal ≤ 2×GSD, vertical ≤ 3×GSD)
   - Target-size recommender (30/60/100/150 cm based on GSD × 10 rule)

2. **Aerial pipeline (orchestrator):** 13 stages — planning → gcp_survey → drone_capture (external) → processing (external) → import → verification → extraction → contouring → digitization → volume → deliverables → RSA seal → SR3 submission. Includes cost estimator with Kenyan market rates (2026).

3. **Drone volume (real math, no GDAL):**
   - Surface differencing (cut/fill between two DSMs supplied as point arrays)
   - Stockpile volume with 4 reference-plane methods (lowest_point, average_boundary, user_specified, tin_base)
   - Mass-haul diagram generation (freehaul/overhaul)
   - Material density reference table (16 materials incl. Kenyan mining: titanium ore, soda ash, fluorspar)

4. **Drone imagery import (registry real; processing placeholders):**
   - Import ODM project (parses `odm_orthophoto/`, `odm_dem/`, `odm_georeferencing/` directory layout)
   - Import Pix4D quality report
   - Quality assessment (GSD + georeferencing ratings × 4 survey-type suitabilities)
   - **`generateContoursFromDSM()`** — *returns synthetic circular contour rings* (explicitly noted: *"In production, this calls GDAL gdal_contour"*)
   - **`extractFeaturesFromOrthophoto()`** — *returns 10 hardcoded square building footprints and 1 horizontal road line* (noted: *"In production, this runs ML models or OSM overlay"*; `extractionMethod: 'ML-based segmentation (placeholder)'`)

### Drone capability gap matrix

| Capability | Present? | Notes |
|---|---|---|
| GCP file generation (4 formats) | ✅ Full | ODM, Pix4D, Agisoft, generic CSV |
| GCP distribution assessment | ✅ Full | Quadrant + density + edge + check-point ratio |
| GCP residual verification | ✅ Full | RMS computation + threshold checks |
| Target size recommendation | ✅ Full | GSD × 10 rule |
| Pipeline orchestration (13 stages) | ✅ Full | With cost estimator + stage executor mapping |
| Stockpile volume from DSM + boundary | ✅ Full | 4 reference-plane methods |
| Surface differencing (cut/fill) | ✅ Full | Point-array based |
| Mass-haul diagram from chainage volumes | ✅ Full | Freehaul/overhaul/average haul |
| Drone dataset registry (CRUD) | ✅ Full | Persisted to `datasets.json` in userData |
| Quality assessment (GSD + RMS ratings) | ✅ Full | 4-tier ratings × 3 survey-type suitabilities |
| **In-app photogrammetry processing** | ❌ No | Delegated to ODM / Pix4D / Agisoft (external) |
| **Orthophoto/DSM raster reading** | ❌ No | Commented as "In production, this would use GDAL" |
| **Contour generation from real DSM** | ❌ Placeholder | Returns synthetic concentric circles |
| **Feature extraction (buildings/roads)** | ❌ Placeholder | Returns 10 hardcoded square polygons |
| **Flight planning / waypoint generation** | ❌ No | Not in scope; no MAVLink, no DJI SDK |
| **Camera footprint calculator** | ❌ No | No sensor width / focal length / GSD predictor |
| **Mission upload to drone** | ❌ No | No protocol support |
| **Live drone telemetry** | ❌ No | Only total-station and GNSS-NTRIP streaming |

---

## 7. Math Engine — Strengths

The engine is genuinely strong and well-cited to standard surveying literature.

| Module | LOC | Cited standard |
|---|---|---|
| Cassini-Soldner projection (exact) | 1,922 | Snyder, USGS PP 1395 |
| Helmert datum transform (Gauss-Newton) | 726 | Arc 1960 ↔ WGS84 |
| Least Squares Adjustment (parametric + robust + network + 3D + sequential) | 3,560 | Ghilani & Wolf, *Adjustment Computations* |
| EDM corrections (atmospheric, slope, sea-level, grid) | 302 | Ghilani & Wolf Ch. 6 |
| Geoid (EGM96) ellipsoidal→orthometric | 336 | — |
| Traverse (Bowditch / Transit / Crandall / LSA) | 355 | Cap 299 precision standards |
| Curves (circular, vertical, **clothoid** spiral) | 266 + ~500 | RDM 1.3 §5.2.4, AASHTO, Schofield & Breach Ch. 11 |
| Subdivision (mutation per Cap 299) | 1,093 | Survey Act Cap 299 |
| Deformation monitoring | 516 | — |
| Sparse matrix solver | 876 | — |
| Kenya map sheets (SoK registry) | 257 | Survey of Kenya |
| Blunder detection (Baarda χ² + data snooping w-test) | ~200 | Baarda, *Testing Procedures* |
| Robust estimation (Huber / IGG3 / Tukey IRLS) | ~300 | — |
| TIN (constrained Delaunay via `delaunator`) | — | Breakline-aware |
| IDW interpolation, marching-triangle contours | — | — |
| AASHTO pavement design | — | ESA + layer structure |
| Manning pipe capacity | — | — |
| Mass-haul optimisation (freehaul / overhaul) | — | RDM 1.1 §8 |
| Shoelace area + centroid, trapezoidal area | — | Basak Ch. 4 / Ghilani & Wolf Eq. 12.5 |
| End-area + prismoidal volume | — | — |
| Coordinate transforms: UTM (60 zones), Cassini ↔ UTM bidirectional | — | Snyder |
| Two-peg test, height of object, tacheometry | — | — |

### Math spot-checks (verified correct)

- **Shoelace area** (`packages/engine/src/engine/area.ts:34-71`) — closes polygon, computes signed area, perimeter, **and centroid** (using the 1/(6A) × Σ cross-product formula). Handles degenerate polygons by falling back to vertex average.
- **Circular curve elements** (`engine/curves.ts:16-53`) — T = R tan(Δ/2), L = RΔ, C = 2R sin(Δ/2), E = R(sec(Δ/2) − 1), M = R(1 − cos(Δ/2)), D = 1718.873/R. Cited to RDM 1.3 §5.2.
- **Clothoid spiral** (`computations/clothoidTransition.ts`) — full 522-line implementation: spiral parameter A = √(R·Ls), spiral angle τ = Ls/(2R), curve shift p, tangent offset q, TS/SC/CS/ST chainages, modified tangent Ts = (R+p)·tan(Δ/2) + q, circular arc length Lc = R(Δ − 2τ). Computes set-out points along entry and exit spirals.
- **Cassini-Soldner inverse** (`geo/cassini/projection.ts:47-80`) — full series expansion to D⁶ terms with footpoint latitude solved by Newton iteration (50 iterations, 1e-12 tolerance). Cited to Snyder.
- **LSA** (`engine/leastSquaresAdjustment.ts`) — proper parametric (indirect observations) form: observation equations L + V = A·X, normal equations (AᵀPA)·X = AᵀPL, full covariance matrix, weight matrix P = diag(1/σ²). Recently audited (2026-07-03) to add `atStationId` so true interior angles θ = α_BC − α_BA are computed instead of treating every "angle" as a bearing.

---

## 8. Test Coverage, CI/CD, Build Configuration

### CI (`.github/workflows/ci.yml`)
- **Matrix**: `ubuntu-latest`, `windows-latest`, `macos-latest` (fail-fast: false)
- **Triggers**: push to `main`/`develop`, PRs to `main`
- **Steps**: checkout → setup Node 20 → install (Ubuntu gets `libsqlite3-dev libspatialite-dev`) → typecheck (must pass, 0 errors) → lint (continue-on-error in phase 2) → test → build → upload artifacts (Ubuntu only, 7-day retention)
- **Release job**: triggered by `v*` tags; produces `.exe`/`.msi`/`.dmg`/`.deb`/`.AppImage` and uploads as 30-day artifacts
- macOS notarization + Windows EV code-signing env vars are stubbed in comments (not yet enabled)

### Tests
- **Vitest** is the test runner (engine + desktop workspaces each have `vitest.config.ts`)
- **86 test files** in total, with property-based testing via `fast-check`
- Release notes claim **1259/1259 engine tests pass (100%)** with **75% branch coverage**
- **31 acceptance/smoke scripts** in `scripts/` — Python (`*.py`) and Node (`*.mjs`)

### JTBD acceptance benchmarks
- JTBD-1 cadastral: 12-leg traverse → sealed PDF in **1.11 s**
- JTBD-2 engineering: alignment → machine-control in **8.59 s**
- JTBD-3 topographic: 50k points → DXF in **6.22 s**

### Build / packaging (`apps/desktop/electron-builder.yml`)
- **Windows**: NSIS + MSIX, x64
- **macOS**: DMG, x64 + arm64, hardened runtime, gatekeeper disabled, notarize currently `false`
- **Linux**: .deb + .AppImage, x64; deb depends on `libsqlite3-0`, `libnss3`, `libgtk-3-0`, `libgbm1`, `libasound2`
- Auto-update provider: GitHub Releases
- npm scripts: `package:win`, `package:mac`, `package:linux`

### Targeted platforms
✅ Windows (NSIS + MSIX, x64) · ✅ macOS (DMG, x64 + Apple Silicon arm64) · ✅ Ubuntu / Linux (.deb + .AppImage, x64)

---

## 9. Open Issues, TODOs, and Known Limitations

GitHub reports **0 open issues**. However, the in-repo docs list:

### From `docs/RELEASE_CHECKLIST.md` (Definition of Done: 8/10)
- ❌ Windows EV code-signing cert (needs $300/yr) — *replaced by SignPath Foundation in v2.0 plan*
- ❌ macOS notarization (needs Apple Developer ID $99/yr) — *deferred in v2.0 plan*
- ❌ 2 closed betas with 5 surveyors each — *needs real surveyors*
- ❌ Auto-update verified across 1 minor version bump — *needs real release*
- ⏳ Video tutorials (3: cadastral, topo, engineering) — TODO

### From `docs/RELEASE_NOTES_v1.0.0.md` (Known Issues, P2)
- LAS/LAZ import from disk needs File API adaptation (stub works)
- Some engine source modules have path alias issues (runtime works via esbuild)
- Staking table generation needs curve element field name alignment
- Property-based test tolerances adjusted for float32 precision

### From `docs/MATH_IMPROVEMENT_PLAN.md` (14 prioritised gaps)

**P0 — Critical for Kenya (5 items):**
1. LSA not wired to traverse UI (only Bowditch currently exposed)
2. Error ellipses on adjusted coordinates (engine has covariance, UI doesn't draw)
3. Cassini ↔ UTM bidirectional converter not in UI
4. Grid-to-ground distance correction not in UI (required by Cap 299)
5. Clothoid transition curves not in road design UI (required by RDM 1.1 for >50 km/h)

**P1 — Important differentiators (5 items):**
6. Real-time precision monitor
7. Automatic beacon coordinate recovery (Tienstra already in engine)
8. Area computation with projection correction
9. Multi-station resection / "free station"
10. Level network adjustment (LSA applied to heights)

**P2 — Polish (4 items):** COGO toolbox UI, prismoidal volume in UI, astronomical azimuth, GNSS baseline processing.

### Placeholder code (22 occurrences in 8 Electron files)

Most concentrated in drone modules:
- `drone-imagery.ts` — 9 placeholder notes (GeoTIFF metadata via GDAL, contour generation, ML feature extraction)
- `drone-volume.ts` — 4 placeholder notes (GDAL raster math, TIN base interpolation)
- `cadastre-quality.ts` — 4 placeholder notes (coordinate conversion delegate)

---

## 10. Code Quality Observations

### Strengths
- **Excellent documentation discipline**: 5 ADRs, 14 docs files, math improvement plan, release checklist, product strategy, overkill vision, sync API contract, user guide
- **Source citations inline**: every math module cites the textbook section (Snyder, Ghilani & Wolf, Basak, etc.)
- **Layered architecture**: clean separation between engine (pure TS, framework-agnostic), Electron main (trust boundary), React renderer (sandboxed)
- **Defensive IPC layer**: rate-limiting, idempotency, structured `{success, data, error}` envelope, observability metrics
- **Security model**: contextBridge isolation, `nodeIntegration: false`, `db:query` restricted to SELECT/WITH only, RSA-2048 keys stored `mode 0o600`
- **Country-pack plugin architecture** (ADR-005)
- **Test discipline**: 86 test files including property-based tests with `fast-check`, acceptance scripts for each milestone

### Weaknesses / Risks
- **`any` typed IPC handlers** — all 118 handlers accept `input: any`. A `zod` schema per channel would close the validation gap.
- **Drone module placeholders masquerade as features** — `generateContoursFromDSM()` returns synthetic circles but the function signature looks production-ready. A user importing a real DSM will get nonsense contours without warning.
- **No GDAL integration** despite the heavy reliance on it in comments.
- **No Playwright E2E tests** — README mentions "Test Automation Engineer" agent uses "Vitest + Playwright" but no Playwright config or `.spec.ts` files exist.
- **`better-sqlite3` override to ^12.0.0** in root `package.json` — native module version pinning can break with Electron upgrades.
- **Fork-and-finish status**: 0 stars, 0 forks, 0 issues, no external blog posts. The project is effectively a solo effort with no community validation yet.
- **No security scanning** in CI — no SAST, no dependency scanning, no secret scanning.

---

## 11. Dependencies on External Services

### Production (runtime)
- **None required.** The app is fully offline-capable. SQLite + SpatiaLite are bundled. All compute is local.

### Optional integrations
- **ArdhiSasa / NLIMS** (Kenya land registry) — online lookup for title chain (OV7). Requires API credentials.
- **Kenya CORS RTK** (`kencors`) — NTRIP correction stream. Requires account.
- **External WebODM server** — for drone photogrammetry (currently the only photogrammetry path). Optional in v2.0 (replaced by local ODM sidecar).

### Development (build/CI only)
- **GitHub Actions** — CI matrix on Ubuntu/Windows/macOS
- **GitHub Releases** — auto-update provider
- **npm registry** — package dependencies

---

## 12. Tech-Debt Inventory (Prioritized for v2.0)

| # | Debt Item | Severity | Phase | Action |
|---|---|---|---|---|
| D1 | 118 IPC handlers use `any` typing | Critical | P1 | Define zod schema per channel (ADR-012) |
| D2 | `generateContoursFromDSM()` returns synthetic data | Critical | P1 | Integrate GDAL bindings (ADR-010) |
| D3 | `extractFeaturesFromOrthophoto()` returns hardcoded squares | Critical | P3 | ML feature extraction pipeline (ADR-011) |
| D4 | 5 P0 math features not in UI | High | P1 | Wire engine modules to React components |
| D5 | No Playwright E2E tests | High | P2-3 | Test Automation Engineer agent builds suite |
| D6 | No SAST/DAST in CI | High | P3 | Security Architect adds Semgrep + OWASP ZAP |
| D7 | No flight planning / camera footprint / waypoint generation | High | P1 | New `flight-planning/` engine module |
| D8 | No MAVLink / MAVSDK / DJI SDK integration | High | P2 | MAVSDK-Rust sidecar (ADR-008) |
| D9 | No in-app photogrammetry | Medium | P2 | ODM sidecar (ADR-009) |
| D10 | `better-sqlite3` native module pinning | Medium | P3 | Replace with rusqlite during Tauri migration |
| D11 | No code-signing on any platform | Medium | P1 | SignPath Foundation + self-signed fallback |
| D12 | No closed beta with real surveyors | Medium | P2 | Volunteer recruitment campaign |
| D13 | 22 placeholder occurrences in 8 files | Low | P1-3 | Replace each with real implementation |
| D14 | No tutorial videos | Low | P3 | DIY with OBS + DaVinci Resolve |
| D15 | Path alias issues in engine modules | Low | P1 | Fix tsconfig paths |

---

## 13. Architecture Map (C4 Level 2 — Containers)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MetaRDU Desktop v1.0 (Electron)                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  RENDERER (sandboxed, React 18)                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  Map UI      │  │  Traverse UI │  │  Deed Plan   │      │   │
│  │  │  (OpenLayers)│  │  Panel       │  │  Panel       │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  3D Viewer   │  │  Drone Tools │  │  Ctrl+K      │      │   │
│  │  │  (three.js)  │  │  Panel       │  │  Command Pal │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │ contextBridge (118 IPC channels)   │
│  ┌────────────────────────────┴────────────────────────────────┐   │
│  │  MAIN PROCESS (Node.js 20, privileged)                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  database.ts │  │  ipc.ts      │  │  crypto-seal │      │   │
│  │  │  (SQLite +   │  │  (118        │  │  (RSA-2048)  │      │   │
│  │  │   SpatiaLite)│  │   handlers)  │  │              │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  total-      │  │  gnss-rtk    │  │  drone-*     │      │   │
│  │  │  station     │  │  (NTRIP)     │  │  (PLACE-     │      │   │
│  │  │  driver      │  │              │  │   HOLDERS)   │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │ direct import (no IPC)              │
│  ┌────────────────────────────┴────────────────────────────────┐   │
│  │  @metardu/engine (pure TypeScript, framework-agnostic)      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
│  │  │ Traverse │ │ COGO     │ │ LSA      │ │ Curves   │        │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
│  │  │ Geodesy  │ │ Topo/TIN │ │ Volumes  │ │ Export   │        │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
   ┌──────────┐         ┌──────────┐          ┌──────────────┐
   │ SQLite + │         │ Serial   │          │ External     │
   │ SpatiaLite│        │ Ports    │          │ WebODM (opt) │
   │ (.metardu)│        │ (USB)    │          │              │
   └──────────┘         └──────────┘          └──────────────┘
```

---

## 14. v2.0 Architecture (Target — after Phase 3)

```
┌─────────────────────────────────────────────────────────────────────┐
│              MetaRDU Desktop v2.0 (Tauri 2.x)                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  RENDERER (WebView2/WKWebView/WebKitGTK, sandboxed)         │   │
│  │  React 18 + OpenLayers 10 + three.js + Drone Dashboard      │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │ Tauri commands (zod-validated)     │
│  ┌────────────────────────────┴────────────────────────────────┐   │
│  │  RUST MAIN PROCESS (Tauri)                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  rusqlite    │  │  tauri-      │  │  RSA-2048    │      │   │
│  │  │  (SQLite)    │  │  plugin-     │  │  crypto-seal │      │   │
│  │  │              │  │  updater     │  │              │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │  MAVSDK-Rust │  │  ODM sidecar │  │  ONNX Runtime│      │   │
│  │  │  (live drone)│  │  (photogram) │  │  (ML extract)│      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  │  ┌──────────────┐  ┌──────────────┐                        │   │
│  │  │  GDAL Rust   │  │  Serial      │                        │   │
│  │  │  bindings    │  │  (total stn) │                        │   │
│  │  └──────────────┘  └──────────────┘                        │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │ direct Rust FFI / Tauri event      │
│  ┌────────────────────────────┴────────────────────────────────┐   │
│  │  @metardu/engine (pure TypeScript, REUSED VERBATIM)         │   │
│  │  + NEW: flight-planning/ module (camera, waypoints, export) │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 15. Recommendations for Phase 1 (First 30 Days)

Based on this onboarding analysis, the following actions are the highest-leverage starting points:

1. **Apply to SignPath Foundation** (free Windows code-signing for OSS) — 1-2 week approval
2. **Scaffold the Rust sidecar** at `packages/metardu-sidecar/` — proves the Rust integration pattern before Tauri migration
3. **Build the flight-planning engine module** at `packages/engine/src/flight-planning/` — camera footprint math, lawnmower waypoint generation, 5 mission export formats
4. **Define zod schemas for the 5 highest-risk IPC namespaces** (drone:*, gcp:*, pipeline:*, parcel:*, traverse:*) — closes the most critical security gap first
5. **Wire the 5 P0 math features to UI** — LSA in traverse panel, error ellipses, Cassini↔UTM, grid-to-ground, clothoid in road design

---

## 16. Sign-off

This onboarding report is based on a read-only analysis of the `metardu-desktop` repository at v1.0.0 and the upstream `metardu` repository. No code was modified. All findings are factual and verifiable by re-running the ripgrep queries and file inspections documented above.

**Next agent in the sequential handoff:** Software Architect (reads this report in full, then writes ADRs 006-012).

---

*End of onboarding report.*
