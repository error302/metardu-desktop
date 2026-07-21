# MetaRDU Desktop — Complete Status & Remaining Work

**Date:** 20 Jul 2026
**Total commits:** 59
**Total tests:** 736 passing across 7 suites

---

## What's DONE (verified, tested, on GitHub)

### Core Architecture (Phases 0-7)
- ✅ Rust sidecar (32 IPC methods, 91 tests)
- ✅ TypeScript engine (489 tests)
- ✅ Country config for 5 countries (100 tests)
- ✅ Electron shell (branded, sandboxed, code-split, packaged)
- ✅ AGENT.md + invariants + 4 ADRs + golden fixtures
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
- ✅ Cadastral (Form 3 PDF + DXF, Gauss-Newton trilateration)
- ✅ Topographic (TIN, contours, spot heights, mean slope)
- ✅ Engineering (cross-sections, cut/fill volumes, end-area method)
- ✅ Construction Setting-Out (stakeout + as-built QC)
- ✅ Sectional Properties (units, participation quotas, area balance)
- ✅ Drone processing (GSD, ASPRS classification, overlap, report)
- ✅ Surface comparison (cut/fill, stockpile, construction progress)
- ✅ UK Measured Survey (RICS-compliant PDF renderer)

### Country Configs (5 countries)
- ✅ Kenya (Arc 1960/UTM 37S, ISK, Form 3/4, Sectional Properties Act 2020)
- ✅ Australia NSW (GDA2020/MGA 56, SSSI/CSPS, Strata Schemes)
- ✅ United Kingdom (OSGB36/ETRS89, RICS, general boundaries rule)
- ✅ South Africa (Hartebeesthoek94/Lo27, SAGC/PLATO, SG Diagram)
- ✅ UAE Dubai (WGS84/UTM 40N, DLD/DM, JOP Declaration)

### Output Formats
- ✅ PDF (Form 3 Kenya, UK Measured Survey)
- ✅ DXF (4 generators: Form 3, topo, engineering, sectional)
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

1. **LiDAR point cloud classification** (Post 3 — building this now)
   - DSM → DTM ground extraction
   - Vegetation/building classification
   - Needs Rust sidecar for performance (millions of points)

2. **Windows sidecar cross-compilation**
   - The .exe installer ships a Linux binary
   - Need to cross-compile Rust + GDAL for Windows
   - CI workflow is configured but untested

3. **Real-world testing**
   - No surveyor has ever used this app
   - Need a beta tester to take it into the field

### 🟡 Important (improves marketability)

4. **Corridor/alignment design module**
   - Civil 3D corridor equivalent
   - Horizontal + vertical alignment design
   - Template-based cross-section generation
   - We have cross-section EXTRACTION but not DESIGN

5. **GPR/utility mapping module**
   - For the UK utility surveying market
   - Import GPR data, overlay on orthophoto
   - Generate utility survey plan

6. **Field data collection mode**
   - Live connection to Total Station / GNSS
   - Real-time coordinate display
   - This is metardu-access's job (the mobile app) but the desktop
     app should at least support live NMEA streaming

### 🟢 Nice to have (polish)

7. **AI plan checker**
   - Automated compliance checking of generated plans
   - metardu web has /ai-plan-checker

8. **Ardhisasa integration** (Kenya)
   - Electronic cadastre submission via NLIS API

9. **Multi-user collaboration**
   - Team project sharing via the sync client

10. **Map canvas enhancements**
    - Draw + annotate on the map
    - Measure distances/areas interactively
    - Print to PDF from the map view

---

## Summary

**Done:** 8 workflows, 5 countries, 4 instrument importers, 2 PDF renderers,
4 DXF generators, sync, digital signature, surface comparison, stockpile
volumes, construction progress, SVG canvas, OpenLayers map, 736 tests.

**Remaining critical:** LiDAR classification (building now), Windows build,
real-world testing.

**Remaining important:** Corridor design, GPR module, field mode.

The app is now at the point where a UK surveyor with Trimble equipment
can: import field data → compute traverses → adjust coordinates →
compare surfaces → compute volumes → generate RICS-compliant plans →
digitally sign → sync with the web app. That's a complete office workflow.
