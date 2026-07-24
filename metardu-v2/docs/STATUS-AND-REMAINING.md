# MetaRDU Desktop — Complete Status & Remaining Work

**Date:** 24 Jul 2026
**Total commits:** 75+
**Total tests:** 657 engine tests + 91 sidecar tests = 748 passing

---

## What's DONE (verified, tested, on GitHub)

### Core Architecture (Phases 0-7)
- ✅ Rust sidecar (32 IPC methods, 91 tests)
- ✅ TypeScript engine (657 tests)
- ✅ Country config for 5 countries (100 tests)
- ✅ Electron shell (branded, sandboxed, code-split, packaged)
- ✅ AGENT.md + invariants + 8 ADRs + golden fixtures
- ✅ Production packaging config (electron-builder, 3-platform CI)
- ✅ lucide-react SVG icons (no emojis)
- ✅ Vite code-splitting (initial load ~248KB)
- ✅ JetBrains Mono + Inter typography (Cursor/Linear pattern)

### Geodesy + COGO + Adjustment
- ✅ ECEF ↔ geodetic (Zhu 1993, verified against pyproj)
- ✅ Helmert 7-param (Position Vector + Coordinate Frame)
- ✅ Transverse Mercator (Snyder series, verified against pyproj)
- ✅ UTM forward/inverse
- ✅ COGO: traverse (Bowditch + Transit), intersections, areas
- ✅ Least-squares adjustment (distances, full covariance, Baarda)
- ✅ Property-based tests (fast-check, 8 tests)

### Workflows (8 total)
- ✅ Cadastral (Form 3 PDF + DXF, Gauss-Newton trilateration, per-beacon uncertainty)
- ✅ Topographic (TIN, contours, spot heights, mean slope)
- ✅ Engineering (cross-sections, cut/fill volumes, end-area method)
- ✅ Construction Setting-Out (stakeout + as-built QC)
- ✅ Sectional Properties (units, participation quotas, area balance)
- ✅ Drone processing (GSD, ASPRS classification, overlap, report)
- ✅ Surface comparison (cut/fill, stockpile, construction progress)
- ✅ UK Measured Survey (RICS-compliant PDF renderer)
- ✅ LiDAR point cloud classification (PMF, DTM/DSM)
- ✅ Corridor design + GPR utility mapping + multi-user collaboration + interactive map canvas

### Country Configs (5 countries)
- ✅ Kenya (Arc 1960/UTM 37S, ISK, Form 3/4, Sectional Properties Act 2020)
- ✅ Australia NSW (GDA2020/MGA 56, SSSI/CSPS, Strata Schemes)
- ✅ United Kingdom (OSGB36/ETRS89, RICS, general boundaries rule)
- ✅ South Africa (Hartebeesthoek94/Lo27, SAGC/PLATO, SG Diagram)
- ✅ UAE Dubai (WGS84/UTM 40N, DLD/DM, JOP Declaration)

### Integration & Export (ADR-0005 — COMPLETE 7/7)
- ✅ GeoJSON exporter (CRS metadata + per-feature uncertainty, all 10 survey types)
- ✅ GeoPackage exporter (OGC 12-128r14, multi-layer, WKB geometry, all 10 types)
- ✅ PyQGIS helper script generator (country-correct symbology, Python syntax-validated)
- ✅ QGIS project file (.qgs) generator (embedded styles, QGIS 3.34 LTR)
- ✅ GCP file exporter (Pix4D, Metashape, Agisoft CSV formats)
- ✅ OSM changeset XML exporter (source attribution, WGS84 auto-conversion)
- ✅ DXF exporter (country-correct layer naming: Kenya + UK + generic fallback)
- ✅ Sidecar lat/lon conversion bridge (projectToWgs84 callback, all 5 spatial exporters)
- ✅ All 10 survey types handled by all 5 SurveyOutput-consuming exporters
- ✅ outputWgs84 option for GeoJSON/GeoPackage/QGS (auto-reproject to EPSG:4326)

### Output Formats
- ✅ PDF (Form 3 Kenya, UK Measured Survey)
- ✅ DXF (country-correct layer names, all 10 survey types)
- ✅ GeoJSON (RFC 7946, all 10 survey types, CRS + uncertainty)
- ✅ GeoPackage (OGC 12-128r14, multi-layer, all 10 survey types)
- ✅ PyQGIS script (.py, country-correct symbology)
- ✅ QGIS project (.qgs, QGIS 3.34 LTR)
- ✅ GCP CSV (Pix4D, Metashape, Agisoft)
- ✅ OSM XML (.osm, JOSM-compatible)
- ✅ SVG SurveyCanvas (TIN, contours, boundaries, beacons, pan/zoom)
- ✅ OpenLayers MapView (satellite/street/topo basemaps)

### Instrument Import (THE killer gap — CLOSED)
- ✅ Leica GSI8/GSI16 parser
- ✅ Sokkia SDR parser
- ✅ Trimble DC/JOB parser
- ✅ RINEX 3.04 header parser
- ✅ Auto-detection (extension + content)

### Integration
- ✅ Sync client (REST API, queue-based, conflict resolution)
- ✅ Digital signature (PKI, Web Crypto API, seal text)
- ✅ Input validation (NaN, collinear, degenerate, 43 tests)
- ✅ Edge-case tests (43 tests)

### CI
- ✅ 3-OS sidecar matrix (Linux, Windows, macOS)
- ✅ Windows smoke test (sidecar binary actually runs + responds to ping)
- ✅ Node 20/22/24 engine test matrix
- ✅ E2e protocol test (ping, echo, version, list_methods, error handling)
- ✅ Demo script verification

### Regulatory Documents Filed (20 files)
- ✅ Kenya: Survey Act Cap 299, Gazette 1994, Electronic Cadastre Regs 2020,
  Survey Submission Standards SRVY2025-1, Form LRA-27, Annex 6, Siriba paper,
  working diagrams, DWG sample, land survey handbook
- ✅ Bahrain: Cadastral Survey Standards Manual 2024
- ✅ Reference: RICS measured surveys, accuracy standards, road surveying,
  geometric design

---

## What's REMAINING (prioritized)

### 🔴 Critical (blocks real-world use)

1. **Real-world testing**
   - No surveyor has ever used this app
   - Need a beta tester to take it into the field

### 🟡 Important (improves marketability)

2. **Electron packaging for distribution**
   - electron-builder config exists but needs real-world testing
   - Windows installer (.exe) + macOS (.dmg) + Linux (.AppImage)
   - Sidecar binary must be bundled in the app resources

3. **UI wiring for Integration & Export**
   - 7 exporters are built but not yet accessible from the Electron UI
   - Need an "Export → GeoJSON / GeoPackage / PyQGIS / QGS / GCP / OSM / DXF" menu
   - The INTEGRATION_EXPORTERS registry is ready — UI just needs to iterate over it

4. **Marketing copy alignment**
   - ADR-0005 defines canonical marketing claims
   - metardu.duckdns.org copy needs to align with the ADR's "can/cannot claim" table

### 🟢 Nice-to-have

5. **Sidecar warnings cleanup** (39 pre-existing warnings)
6. **Performance optimization** for large LiDAR point clouds
7. **Additional country configs** (Australia states beyond NSW, UAE emirates beyond Dubai)
