# MetaRDU Desktop — Comprehensive Workflow Assessment

**Date:** August 20, 2026  
**Version:** v0.5.0  
**Assessed Views:** 26 active views + 6 utility panels

---

## Methodology

Each workflow phase is assessed on:
- **Completeness** — Does the view have real, functional logic or is it a placeholder?
- **Data Flow** — Does it integrate with the engine, sidecar, or cross-import system?
- **Country Awareness** — Does it respect country-specific regulations/tolerances?
- **Edge Cases** — Does it handle errors, empty states, and boundary conditions?
- **UX Quality** — Is the UI interactive with feedback, or static text only?

Rating: **1** = Placeholder/stub | **3** = Basic working | **5** = Production-ready | **7** = Best-in-class | **10** = Industry-leading

---

## 1. Project Inception & Research

### ProjectsPanel ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| CRUD operations | 9 | Create, switch, delete, rename — all wired to SQLite via IPC |
| Auto-save | 8 | Operation log tracks changes, undo/redo backed by SQLite |
| Survey type detection | 8 | `survey-type-detection.ts` matches keyword heuristics |
| Templates | 7 | `project-templates.ts` has pre-built templates for common types |
| **Gap:** | | No project import/export (.mrdup file format) |
| **Gap:** | | No project duplication/forking |
| **Gap:** | | No project search/filter in list |

### VersionHistoryView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Timeline display | 7 | Shows operation history with timestamps |
| Undo/redo integration | 8 | Wired to SQLite operation log |
| **Gap:** | | No visual diff between versions |
| **Gap:** | | No restore-to-version (only undo one-by-one) |
| **Gap:** | | No branching or tagging |

**Phase Score: 7.5/10** — Strong foundation, needs project management polish.

---

## 2. Field Data Collection

### FieldBookView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Leveling mode | 9 | Full backsight/foresight/height-of-instrument computation |
| Tacheometry | 8 | Stadia distance, elevation reduction |
| CSV import | 8 | Accepts raw instrument dumps |
| **Gap:** | | Total Station 3D polar reduction is stub-level (angle→coordinate) |
| **Gap:** | | No instrument profile switching (Leica GSI, Trimble, Topcon) |
| **Gap:** | | No two-peg test wizard |

### InstrumentMonitorView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Serial connection | 8 | Full port detection, baud rate, protocol auto-detect |
| BLE connection | 7 | Scan, discover, connect — platform-dependent |
| NTRIP connection | 8 | Caster URL, mountpoint, credentials |
| Skyplot | 8 | Real-time satellite visualization by constellation |
| DOP gauges | 7 | PDOP/HDOP/VDOP with color-coded bars |
| Fix quality | 8 | RTK Fixed/Float/DGPS/SPP indicators |
| **Gap:** | | No raw NMEA sentence parser in renderer (relies on sidecar) |
| **Gap:** | | No observation recording to field book |
| **Gap:** | | No connection history/favorites |

### GNSSView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Live telemetry | 7 | Fix status, satellite count, DOP, coordinates |
| Stakeout guidance | 8 | ΔE/ΔN/ΔZ/distance to target with color feedback |
| **Gap:** | | Uses simulated data (setInterval jitter) instead of real instrument feed |
| **Gap:** | | No epoch averaging for static observations |
| **Gap:** | | No RTK data logging |

### MapView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| OpenLayers integration | 8 | Full OL with 3 basemaps, vector overlays |
| CRS reprojection | 8 | EPSG:4326 ↔ local UTM |
| Click-to-inspect | 7 | Feature info on click |
| GPS locate | 7 | Browser geolocation |
| Print/export | 7 | Map image export |
| **Gap:** | | No WMS/WMTS layer support |
| **Gap:** | | No measurement tools (distance, area) on map |

### ImportPanel ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| DXF import | 7 | Basic DXF parsing |
| GeoJSON import | 7 | Feature collection support |
| CSV import | 7 | Coordinate table parsing |
| **Gap:** | | No LandXML import |
| **Gap:** | | No RINEX file import (parser exists but not wired) |
| **Gap:** | | No DXF layer selection during import |
| **Gap:** | | No preview before import |

### SyncPanel ⭐ 6/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Sync status display | 6 | Shows idle/syncing/offline/error |
| Collaboration server | 5 | WebSocket server implemented but not fully integrated |
| **Gap:** | | No real-time collaborative editing UI |
| **Gap:** | | No conflict resolution visualization |
| **Gap:** | | No user presence indicators |
| **Gap:** | | No field→office push mechanism |

**Phase Score: 7.3/10** — Core collection works well, instrument integration needs polish.

---

## 3. Computation & Reduction

### TraverseView ⭐ 9/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Bowditch adjustment | 9 | Classic traverse closure with precision ratio |
| Transit adjustment | 9 | Coordinate-by-coordinate correction |
| Least Squares (distance) | 9 | Full LS with distance observations via sidecar |
| Mixed network (distance+GNSS) | 9 | GNSS baselines + traverse legs in one adjustment |
| Live instrument panel | 8 | Serial/BLE/NTRIP with auto-record |
| Cross-import | 9 | Receives COGO points, pushes LS results to COGO |
| **Gap:** | | No angular observations (directions/horiz angles) |
| **Gap:** | | No azimuth control observations |
| **Gap:** | | No traverse closure worksheet export |

### COGOView ⭐ 9/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Radiation (polar) | 9 | Bearing+distance → coordinates |
| Bearing-bearing intersection | 9 | Two bearing lines → intersection point |
| Distance-distance intersection | 9 | Two circles → intersection point |
| Line offset/projection | 8 | Perpendicular offset from line |
| Area computation | 9 | Shoelace formula with perimeter, bearings |
| Cross-import | 9 | Receives Traverse LS results, pushes points to Traverse |
| **Gap:** | | No circular curve computation |
| **Gap:** | | No reverse curve/spiral curves |
| **Gap:** | | No coordinate transformation within COGO |

### LSAView (GNSS Network Adjustment) ⭐ 9/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Control network setup | 9 | Fixed/free points, baselines with covariances |
| Least-squares adjustment | 9 | Full LS via sidecar with chi-square test |
| Error ellipses | 9 | Eigenvalue decomposition, 95% confidence visualization |
| Baarda data-snooping | 8 | w-statistic bars, blunder flagging |
| Auto-covariance estimation | 8 | PDOP-weighted from satellite geometry |
| **Gap:** | | No 3D height network adjustment |
| **Gap:** | | No observation removal + re-run workflow |
| **Gap:** | | No baseline classification (static/rapid/static) |

### FieldBookView (reduction) ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Leveling reduction | 8 | Height-of-instrument method |
| Tacheometry | 7 | Basic stadia reduction |
| **Gap:** | | Total Station 3D polar reduction is stub |
| **Gap:** | | No atmospheric correction (temperature, pressure) |
| **Gap:** | | No instrumental error compensation (iC, iR, collimation) |

**Phase Score: 8.5/10** — The strongest phase. Math is rigorous and well-implemented.

---

## 4. Engineering & Topo

### TopographicView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Point entry | 8 | E/N/H + code entry |
| TIN generation | 8 | Delaunay triangulation from contour-generation.ts |
| Contour generation | 9 | Marching triangles, segment chaining, auto-labeling |
| Breakline enforcement | 7 | Via TIN edge constraints |
| **Gap:** | | No point code → symbol mapping |
| **Gap:** | | No cross-section generation from topo |
| **Gap:** | | No slope analysis (hillshade, aspect) |

### RoadDesignView ⭐ 6/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Chainage data | 6 | Hardcoded sample data |
| Longitudinal profile | 5 | No interactive chart |
| Horizontal curves | 5 | No curve design UI |
| **Gap:** | | Mass-haul diagram is missing |
| **Gap:** | | No interactive chainage editor |
| **Gap:** | | No vertical curve design |
| **Gap:** | | No earthwork volume computation from chainage |

### CrossSectionView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| SVG cross-section rendering | 7 | Ground line vs design line overlay |
| Cut/fill visualization | 7 | Colored polygon between lines |
| Chainage navigation | 7 | Prev/next with scale control |
| Volume summary | 6 | End-area method, balance computation |
| **Gap:** | | No real engineering data input (uses sample data) |
| **Gap:** | | No section drawing export |
| **Gap:** | | No side-slope specification |

### SectionalView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Unit area computation | 7 | Per-level breakdown |
| Participation quotas | 7 | Pro-rata computation |
| Area balance check | 7 | Building = units + common |
| Country regime | 7 | Kenya sectional properties legislation |
| **Gap:** | | No interactive building editor |
| **Gap:** | | No multi-building support |
| **Gap:** | | No sectional title plan generation |

### FlightPlanningView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Camera database | 8 | DJI Mavic 3, Phantom 4 RTK, Matrice 350 |
| GSD computation | 8 | Resolution, footprint, flight lines |
| Waypoint generation | 8 | Lawnmower grid with overlap |
| Battery estimation | 7 | Flight time, battery count |
| **Gap:** | | No terrain-following altitude |
| **Gap:** | | No KMZ mission file export |
| **Gap:** | | No no-fly zone checking |

### SettingOutView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Design point entry | 7 | Foundation, column, wall types |
| Stakeout instructions | 7 | Polar method from control |
| As-built QC | 7 | Tolerance check against design |
| Country tolerance | 7 | Per-country construction tolerance |
| **Gap:** | | No interactive as-built data entry |
| **Gap:** | | No total station integration for live setting-out |
| **Gap:** | | No as-built drawing generation |

**Phase Score: 7.2/10** — Good foundation, road design and as-built need work.

---

## 5. Statutory Approvals & Deliverables

### DeedPlanView ⭐ 7/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Form generation | 7 | Deed plan template |
| Beacon schedule | 7 | Point table with coordinates |
| **Gap:** | | No Form 3/4 statutory form generation |
| **Gap:** | | No DXF export from deed plan |
| **Gap:** | | No print-optimized layout |
| **Gap:** | | No beacon certificate generation |

### ExportPanel ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| DXF export | 8 | Via engine integration exporter |
| GeoJSON export | 8 | Feature collection output |
| GeoPackage export | 7 | Via engine exporter |
| LandXML 1.2 export | 8 | NLIMS/ArdhiSasa submission format |
| PDF export | 7 | Plan generation |
| CSV export | 7 | Coordinate tables |
| Country-specific guidance | 8 | Shows submission details per country |
| **Gap:** | | No batch export (all formats at once) |
| **Gap:** | | No export preview |
| **Gap:** | | No export templates |

### SigningPanel ⭐ 6/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| RSA-2048 signing | 6 | Web Crypto API integration |
| Key generation | 6 | In-memory key pair |
| **Gap:** | | No PDF file picker for signing |
| **Gap:** | | No P7B signature file creation |
| **Gap:** | | No certificate chain verification |
| **Gap:** | | No key persistence across sessions |

### OfficeManagementView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Fee estimation | 9 | Multi-currency (KE, AU, GB, ZA, AE, DE, US, GH) |
| Invoice PDF generation | 8 | Real proforma invoice via pdf-lib |
| Survey type pricing | 8 | Per-country fee scales |
| VAT computation | 8 | Country-specific tax rates |
| Terrain multipliers | 8 | Flat/hilly/mountainous adjustments |
| **Gap:** | | No real invoice client database |
| **Gap:** | | No payment tracking |
| **Gap:** | | No invoice number sequencing |

### LULCView ⭐ 8/10
| Aspect | Rating | Notes |
|--------|--------|-------|
| Kenya LULC categories | 9 | 10 categories per NLC framework |
| Parcel import | 8 | GeoJSON + CSV polygon boundaries |
| Auto-classification | 7 | Keyword + size heuristics |
| Classification report | 8 | CSV export with category breakdown |
| SurveyCanvas visualization | 8 | Color-coded polygons on map |
| **Gap:** | | No satellite imagery spectral analysis |
| **Gap:** | | No NDVI computation from drone imagery |
| **Gap:** | | No change detection between surveys |

**Phase Score: 7.5/10** — Strong deliverables, needs more statutory form generation.

---

## Critical Gaps Summary

### 🔴 Must Fix (Blocks Professional Use)
1. **Total Station 3D polar reduction** — FieldBookView has a stub; needs angle/distance → coordinate with atmospheric corrections
2. **Road Design interactive input** — Hardcoded chainage data, no mass-haul diagram
3. **Form 3/4 generation** — DeedPlanView doesn't generate statutory forms
4. **DXF export from views** — Only ExportPanel has DXF; views can't directly export

### 🟡 Should Fix (Improves Workflow)
5. **RINEX import** — Parser exists but not wired to ImportPanel
6. **Angular observations** — TraverseView only handles distance, not directions
7. **Observation removal in LSA** — Can't remove flagged blunders and re-run
8. **Cross-section data input** — Uses sample data, needs real survey input
9. **Map measurement tools** — No distance/area measurement on MapView
10. **Export preview** — No visual preview before export

### 🟢 Nice to Have (Polish)
11. **Project import/export** — .mrdup file format
12. **Version diff visualization** — Visual comparison between versions
13. **KMZ mission export** — Flight planning generates waypoints but no KMZ
14. **Satellite imagery analysis** — NDVI, spectral classification
15. **Collaboration UI** — WebSocket server exists but no frontend

---

## Score Summary

| Phase | Rating | Verdict |
|-------|--------|---------|
| 1. Project Inception & Research | **7.5/10** | Strong foundation, needs polish |
| 2. Field Data Collection | **7.3/10** | Core works, instrument integration needs work |
| 3. Computation & Reduction | **8.5/10** | Industry-leading math engine |
| 4. Engineering & Topo | **7.2/10** | Good, road design is weakest |
| 5. Statutory Approvals | **7.5/10** | Strong deliverables, needs more forms |
| **Overall** | **7.6/10** | **Production-ready for field use with targeted improvements** |

---

## Recommendations

### Immediate (This Sprint)
1. Wire RINEX import into ImportPanel
2. Add angular observations to TraverseView
3. Make RoadDesignView interactive with real mass-haul SVG
4. Add observation removal + re-run to LSAView

### Short-term (Next 2 Weeks)
5. Total Station 3D polar reduction with atmospheric corrections
6. Map measurement tools (distance, area, angle)
7. Export preview panel
8. Form 3/4 statutory form generation

### Medium-term (Next Month)
9. Cross-section real data input + export
10. KMZ mission file export for drones
11. Project import/export (.mrdup)
12. Collaboration frontend UI
