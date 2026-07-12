# METARDU Desktop — Math Improvement Plan for Kenya

## Current Math Audit

| Module | LOC | Status | Kenya-Specific? |
|--------|-----|--------|-----------------|
| Cassini-Soldner projection | 1,922 | ✅ Full (exact formulas) | ✅ Kenya's official grid |
| Helmert datum transform | 726 | ✅ Rigorous (Gauss-Newton) | ✅ Arc 1960 ↔ WGS84 |
| Least Squares Adjustment | 3,560 | ✅ Parametric + robust + network | ⚠️ Not wired to traverse UI |
| EDM corrections | 302 | ✅ Atmospheric (temp + pressure) | ✅ |
| Geoid (EGM96) | 336 | ✅ Ellipsoidal → orthometric | ✅ |
| Traverse (Bowditch/Transit) | 355 | ✅ | ✅ Cap 299 precision standards |
| Curves (horizontal/vertical) | 266 | ✅ | ⚠️ No clothoid in UI |
| Clothoid/spiral | ~500 | ✅ In computations/ | ⚠️ Not wired to curve UI |
| Subdivision | 1,093 | ✅ | ✅ Mutation per Cap 299 |
| Deformation monitoring | 516 | ✅ | ✅ |
| Sparse matrix solver | 876 | ✅ | ✅ |
| Kenya map sheets | 257 | ✅ | ✅ SoK registry |
| Blunder detection (OV4) | ~200 | ✅ Baarda + data snooping | ✅ |
| Robust estimation | ~300 | ✅ Huber/IGG3/Tukey IRLS | ✅ |

## What's Missing or Needs Improvement

### P0 — Critical for Kenya (Surveyors Will Switch For These)

#### 1. Wire LSA to Traverse UI
**Problem:** The engine has 3,560 LOC of least squares adjustment (parametric,
robust, network, 3D, sequential) — but the traverse UI only uses Bowditch.
Professional surveyors expect LSA, not just Bowditch.

**Fix:** Add a "Adjustment Method" dropdown in the traverse UI:
- Bowditch (compass rule) — current default, for quick checks
- Transit rule — for distance-dominant traverses
- Crandall's rule — for angle-dominant traverses
- Least Squares (parametric) — the gold standard
- Least Squares (robust IRLS) — auto-downweights bad observations

**Impact:** This is THE feature that makes surveyors switch from AutoCAD.
Bowditch is a 19th-century method. LSA with error ellipses is what
professionals demand.

#### 2. Error Ellipses on Adjusted Coordinates
**Problem:** Bowditch gives you a precision ratio (1:5000) but no spatial
information about WHERE the error is. LSA gives you a full covariance matrix
→ you can draw confidence ellipses showing the error distribution.

**Fix:** After LSA, compute 95% confidence ellipses for each adjusted point.
Display them on the map as semi-transparent ellipses. Include in the
statutory workbook (Sheet 9: QA Summary).

**Kenya relevance:** Survey Regulations 1994 Reg 97 requires precision
reporting. Error ellipses give a MUCH richer picture than a single ratio.

#### 3. Cassini-Soldner ↔ UTM Bidirectional Transform
**Problem:** Kenya uses BOTH Cassini-Soldner (for cadastral) and UTM
(for topographic/engineering). Surveyors constantly convert between them.
The engine has both but the UI doesn't expose a simple converter.

**Fix:** Add a "Coordinate Converter" tool:
- Input: Easting, Northing, source CRS (Cassini-Soldner sheet OR UTM zone)
- Output: Easting, Northing, target CRS
- Batch mode: convert an entire traverse from Cassini to UTM
- Show the grid convergence and scale factor at the converted point

**Kenya relevance:** Every Kenyan surveyor does this conversion daily.
Making it instant + accurate = massive time savings.

#### 4. Grid-to-Ground Distance Correction
**Problem:** Distances measured on the ground ≠ distances on the grid.
The scale factor at the central meridian is 1.000, but it increases away
from the central meridian. For cadastral work at 1:5000, this matters.

**Fix:** Add grid-to-ground correction:
- Input: grid distance + coordinates of the line
- Compute: scale factor at mid-point of the line
- Output: ground distance = grid distance / scale factor
- Also: sea-level correction (reduce to ellipsoid)

**Kenya relevance:** Survey Regulations 1994 requires ground distances
on deed plans. Currently surveyors compute this by hand or in Excel.

#### 5. Clothoid Transition Curves in Road Design UI
**Problem:** The engine HAS clothoid computation (computations/clothoidTransition.ts)
but the road design UI (M6) only offers simple circular curves. Kenya's
RDM 1.1 requires transition curves on Class A and Class B roads.

**Fix:** Add transition curve option to the horizontal curve designer:
- Simple circular (current)
- Circular with clothoid transitions (both ends)
- Fully transitional (clothoid → circular → clothoid)
- Display: TS, SC, CS, ST chainages + setting-out table

**Kenya relevance:** RDM 1.1 Volume 2, Chapter 3 mandates transitions
on all roads with design speed > 50 km/h. No Kenyan surveying software
does this well.

### P1 — Important (Differentiators)

#### 6. Real-Time Precision Monitor
**Problem:** Surveyors find out about precision problems AFTER the traverse
closes. By then they've left the field.

**Fix:** Show real-time precision estimate as each shot is added:
- After 3+ legs: estimate misclosure from the running traverse
- After 50% of legs: give a preliminary precision ratio
- Color-code: green (>1:5000), yellow (1:3000-1:5000), red (<1:3000)
- Alert: "Precision is trending below 1:5000 — consider checking leg 4"

**Kenya relevance:** Saves a return trip to the field. Huge cost savings.

#### 7. Automatic Beacon Coordinate Recovery
**Problem:** When a surveyor finds a disturbed beacon, they need to
recover its original coordinates from neighboring beacons. Currently
done manually with a calculator.

**Fix:** "Recover Beacon" tool:
- Select 3+ known beacons around the disturbed one
- Measure distances/angles to the disturbed beacon
- Compute coordinates by resection (Tienstra method — already in engine)
- Compare with recorded coordinates
- Flag if movement exceeds threshold (e.g., 50mm)

**Kenya relevance:** Beacon disturbance is the #1 field problem in Kenya.
Every surveyor deals with it weekly.

#### 8. Area Computation with Projection Correction
**Problem:** The Shoelace formula gives area on the flat projection plane.
But the real ground area is different (scale factor correction). For large
parcels (>10 ha), the difference matters.

**Fix:** Three area computation modes:
- Grid area (Shoelace on Cassini-Soldner grid)
- Ground area (grid area / mean scale factor²)
- Ellipsoidal area (area on the Arc 1960 ellipsoid)
- Show all three in the area table on the deed plan

**Kenya relevance:** Survey Regulations 1994 requires ground area on
deed plans. Current practice: surveyors compute the correction in Excel.

#### 9. Multi-Station Resection (Free Station)
**Problem:** Surveyors often can't set up on a known point — they set up
in the middle of the site and measure to 2+ known points. This is called
"free station" or "resection." The engine has Tienstra resection but
it's not in the UI.

**Fix:** "Free Station" tool:
- Input: 2+ known points with coordinates
- Measure: distances and angles to each known point
- Compute: station coordinates + orientation
- Quality check: redundancy number, error ellipse at station
- Auto-setup: computed coordinates become the station setup for
  subsequent total station measurements

**Kenya relevance:** Every construction site uses free station.
Every topographic survey uses free station. This is essential.

#### 10. Level Network Adjustment
**Problem:** The engine has leveling (rise and fall) but not level
NETWORK adjustment. When a surveyor runs a level loop between 3+ known
benchmarks, they need least squares adjustment of the height differences.

**Fix:** Level network adjustment:
- Input: level loop with multiple segments + known BMs
- Method: least squares (parametric)
- Output: adjusted RLs + error estimates + misclosure check
- Support: 2D level networks (not just single loops)

**Kenya relevance:** Engineering surveys require level networks.
Kenya's benchmark network is sparse — surveyors often tie to 2-3 BMs.

### P2 — Nice to Have (Polish)

#### 11. Coordinate Geometry (COGO) Toolbox
**Problem:** Surveyors need quick COGO calculations:
- Bearing/distance from two points
- Intersection of two bearings
- Intersection of bearing + distance
- Offset point from a line
- Area subdivision (split a parcel by area)

The engine has these (cogo.ts) but they're not in a dedicated UI.

**Fix:** A COGO calculator panel with:
- All standard COGO operations
- Visual preview on the map
- Results can be saved as new points

#### 12. Volume Computation by Cross-Sections
**Problem:** Earthwork volume computation currently uses the average
end-area method. The prismoidal formula is more accurate for curved
surfaces.

**Fix:** Add prismoidal volume computation:
- Three-point prismoidal formula
- Curvature correction for road alignments
- Mass-haul diagram with freehaul/overhaul optimization
- Export to Excel for contractor billing

#### 13. Astronomical Azimuth Determination
**Problem:** For remote areas without known control points, surveyors
determine azimuth by sun/star observations. No Kenyan software does this.

**Fix:** Solar observation reduction:
- Input: sun/star observation (time, altitude, horizontal angle)
- Compute: true azimuth to the reference object
- Apply: Laplace correction (if needed for high precision)
- Output: true bearing + estimated accuracy

**Kenya relevance:** Still used in northern Kenya (Marsabit, Turkana)
where control networks are sparse.

#### 14. GNSS Baseline Processing
**Problem:** The engine has RINEX parsing but not baseline processing.
For post-processed GNSS, surveyors need to compute baselines between
base and rover.

**Fix:** Double-difference baseline processing:
- Input: two RINEX files (base + rover)
- Compute: baseline vector (ΔX, ΔY, ΔZ) + covariance matrix
- Method: double-difference carrier-phase solution
- Output: adjusted baseline + precision estimate

**Kenya relevance:** Kenya CORS network is expanding. More surveyors
are doing PPK (post-processed kinematic) rather than RTK.

## Priority Order

| Priority | Feature | Why First | Effort |
|----------|---------|-----------|--------|
| **P0** | LSA in traverse UI | THE professional feature. No LSA = not serious software. | Medium — engine has it, just wire UI |
| **P0** | Error ellipses | Visual proof of precision. Surveyors love this. | Small — compute from covariance matrix |
| **P0** | Cassini ↔ UTM converter | Daily pain point. Every surveyor needs this. | Small — engine has both projections |
| **P0** | Grid-to-ground correction | Required by Cap 299 for deed plans. | Small — scale factor formula |
| **P0** | Clothoid in road UI | Required by RDM 1.1. Engine has it, wire UI. | Medium — add transition curve option |
| P1 | Real-time precision | Saves return trips. Huge ROI. | Medium — incremental precision estimate |
| P1 | Beacon recovery | #1 field problem in Kenya. | Small — Tienstra already in engine |
| P1 | Projection-corrected area | Required for large parcels. | Small — scale factor² correction |
| P1 | Free station (resection) | Every construction site. | Medium — Tienstra + error ellipse |
| P1 | Level network adjustment | Engineering surveys need this. | Medium — LSA applied to heights |
| P2 | COGO toolbox | Quality of life. | Medium — UI for existing engine functions |
| P2 | Prismoidal volume | More accurate earthworks. | Small — formula change |
| P2 | Astronomical azimuth | Remote area surveys. | Large — ephemeris computation |
| P2 | GNSS baseline processing | PPK growing in Kenya. | Large — carrier-phase processing |
