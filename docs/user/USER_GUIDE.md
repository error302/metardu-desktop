# METARDU Desktop — User Guide

## Getting Started

### Installation

1. Download the installer for your platform:
   - **Windows**: `metardu-desktop-setup.exe` (MSIX + NSIS)
   - **macOS**: `metardu-desktop.dmg` (notarized)
   - **Linux**: `metardu-desktop.deb` or `.AppImage`

2. Run the installer and follow the prompts.

3. On first launch, METARDU Desktop will:
   - Generate an RSA-2048 keypair for signing surveyor certificates
   - Create a default project at `~/Documents/metardu/`
   - Display the walking skeleton map view

### Quick Start (Cadastral Survey)

1. **Create a project**: File → New Project → enter name, county, CRS
2. **Import field data**: Click "Import CSV" → select your field data file
3. **Compute traverse**: Traverse → Compute → Bowditch adjustment
4. **Check blunders**: Traverse → Detect Blunders (Baarda + data snooping)
5. **Create parcel**: Parcel → Create from Traverse
6. **Generate deed plan**: Deed Plan → Auto-Layout → A1/A2/A3/A4
7. **Seal certificate**: Deed Plan → Seal with Surveyor Certificate
8. **Export NLIMS**: Submission → Export NLIMS JSON
9. **Generate workbook**: Submission → Generate Statutory Workbook
10. **Generate survey report**: Submission → Generate Survey Report (consolidated 5-page PDF: Cover + Form J + Beacons + Areas + Surveyor's Certificate, RSA-2048 sealed)

### Quick Start (Topographic Survey)

1. Import GNSS points (CSV or RINEX)
2. Run GIS QA Report (CRS + Topology + Metadata + Provenance checks)
3. Generate TIN (breakline-aware constrained Delaunay)
4. Generate contours (0.5m interval, index contours every 5th)
5. Export DXF with SoK layer registry (61 layers)
6. Export LandXML 1.2 / GeoJSON / Shapefile
7. Run QA Gate before submission (10 check categories: Completeness, Precision, Blunder, Topology, Coordinate, Bearing/Distance, Area, Beacon, Title Block, NLIMS)

### Quick Start (Engineering Survey)

1. Design horizontal curve (radius, deflection angle, chainage IP)
2. Compute superelevation (design speed, max superelevation)
3. Design vertical curve (grade in/out, length, VIP)
4. Run leveling (rise and fall, 10√K mm closure)
5. Generate staking table
6. Export machine control (LandXML + DXF + Trimble + Leica + Topcon)

## Total Station Connection (OV2)

1. Connect total station via USB-Serial adapter
2. Tools → Total Station → Connect → select port + baud rate
3. Set station setup (station coordinates, backsight, instrument height)
4. Click "Measure" to take a shot — coordinates computed in real time
5. Face-left / face-right pairs auto-averaged

Supported instruments: Topcon, Leica, Sokkia, Trimble, Pentax, South

## GNSS RTK Connection (OV9)

1. Tools → GNSS → NTRIP Connect
2. Enter NTRIP caster host, port, mountpoint, credentials
3. Connect rover via serial (NMEA stream)
4. Real-time position with fix quality indicator
5. RINEX recording for post-processing

## Multi-Window Workspace (OV6)

- Window → Open → select window type (map, traverse, 3D, profile, deed plan, audit)
- Window → Preset → Field / Office / Review
- Each window remembers position and size across sessions
- Selection is synchronized across all open windows

## 3D Parcel Visualization (OV5)

- View → 3D View → extrude parcels with building heights
- Tools → Subsurface Rights → define mineral/easement volumes
- Tools → Airspace Rights → define height restrictions
- Tools → Cross-Section → draw a line, see the profile

## Title Chain Tracking (OV7)

- Parcel → Title Chain → enter parcel number
- Local cache shows all known history
- Configure ArdhiSasa API for online lookup (needs internet)
- Conflict detection: duplicate titles, area mismatches

## Smart Deed Plan Auto-Layout (OV8)

- Deed Plan → Auto-Layout
- Auto-rotation: longest edge horizontal
- Auto-scale: largest standard scale that fits
- Auto-dimensioning: bearings/distances perpendicular to each edge
- Pure constraint solver — no AI

## Survey Report Generator (Statutory Report Package)

The Survey Report Generator produces a single consolidated PDF containing the
full suite of statutory documents required for Survey of Kenya examination.
No plan leaves METARDU Desktop without the surveyor's RSA-2048 digital seal.

- Submission → Generate Survey Report
- Output: A4 portrait, multi-page PDF (typically 5 pages, expands with traverse length)
- Sealed with RSA-2048 (SHA-256 hash signed with surveyor's private key)

### Pages

1. **Cover Sheet** — Project name, parcel number, LR number, surveyor name +
   license + firm, county, locality, survey date, projection, datum, plan index.
2. **Form J — Traverse Computation Sheet** — Traverse abstract per Reg 17:
   station, observed bearing, distance, ΔE, ΔN, adjusted E/N.
   Includes closure summary, precision class, and Reg 97 compliance check.
3. **Schedule of Beacons** — All beacons with number, type, coordinates
   (3 decimal places), elevation, and description.
4. **Schedule of Areas** — Parent parcel area, subdivisions with percentage,
   reconciliation (parent = sum of children + balance), delta check.
5. **Surveyor's Certificate** — Per Reg 3(2): certificate text, surveyor
   name + license + firm, signature line, RSA-2048 digital seal block
   (algorithm, signed timestamp, document hash, key fingerprint, public key,
   base64 signature).

### Verification

Anyone with the surveyor's public key can verify the seal:

```bash
# Extract the document hash (PDF bytes excluding the appended certificate page)
sha256sum survey-report.pdf  # this is the hash that was signed

# Verify with OpenSSL
echo "<base64-signature>" | base64 -d > sig.bin
openssl dgst -sha256 -verify surveyor_public.pem -signature sig.bin survey-report-pre-certificate.pdf
```

## QA Gate (Pre-Submission Validation)

- Submission → Run QA Gate
- No plan leaves METARDU Desktop without passing this gate.
- 10 check categories:
  1. Completeness — parcel number, LR number, minimum points
  2. Precision — traverse precision vs Reg 97 standard
  3. Blunder — Baarda global test + reliability rating
  4. Topology — self-intersection + duplicate point check
  5. Coordinate — CRS declared, precision format
  6. Bearing/Distance — range validation (0–360°, >0 m)
  7. Area — reconciliation (parent = sum of children for mutations)
  8. Beacon — all beacons have type assigned
  9. Title Block — surveyor name+license (Reg 3(2)), date, county, projection, datum
  10. NLIMS — required fields present for ArdhiSasa submission
- Overall result: PASS (submit) / CONDITIONAL (submit with notes) / FAIL (cannot submit)

## Statutory Forms

In addition to the consolidated Survey Report, METARDU Desktop generates
three specialized statutory forms for specific survey types. All are sealed
with RSA-2048.

### Form P — Mutation Form (Reg 38)

Used for subdivision, amalgamation, or boundary adjustment of registered
land. Submitted to the Director of Surveys for approval.

- Submission → Generate Form P
- Pages: Cover + Application details, New Parcels Schedule (with reconciliation),
  Beacons Affected (extinguished + new), Director of Surveys approval block,
  Surveyor's Certificate (RSA-2048 sealed).
- Per Survey Act Cap 299, Survey Regulations 1994 Reg 38.
- Includes area reconciliation: parent area = sum of children + balance.
- Director of Surveys approval block: Date Received, Examined By, Approval
  Status (☐ APPROVED / ☐ APPROVED WITH CONDITIONS / ☐ REJECTED), Date of
  Decision, Reference Number, Conditions, Signature.

### Surveyor's Report (Topographical)

Narrative report describing the survey methodology, equipment, control
network, accuracy achieved, and deliverables for a topographical survey.

- Submission → Generate Topo Report
- Pages: Cover + Project Description, Survey Methodology + Equipment + Field
  Crew, Control Network + Detail Points + Accuracy, Deliverables + Surveyor's
  Certificate (RSA-2048 sealed).
- Per Survey of Kenya Practice Notes 2020.
- Includes: control establishment narrative, detail survey methodology,
  equipment table (instrument, serial number, calibration date), field crew
  table, control stations table with accuracy achieved, detail points
  breakdown by category, horizontal/vertical RMSE, contour interval, DEM
  resolution, deliverables list.

### Cross-Section Sheets (Engineering)

Tabular cross-sections at each chainage along an alignment, showing
existing ground, design level, cut/fill depths, areas, and cumulative
volumes. Used for earthworks verification and payment certification.

- Submission → Generate Cross-Section Sheets
- Pages: Cover + Earthworks Summary, Cross-Section Tables (4 sections per
  page), Surveyor's Certificate (RSA-2048 sealed).
- Per Road Design Manual RDM 1.1 (2025), Section 6.
- Each cross-section shows: chainage, cut/fill depth at centerline, cut area,
  fill area, table of offsets (±15m, ±10m, ±5m, 0) with existing level,
  design level, cut/fill depth, and status (CUT/FILL).
- Earthworks summary: total cut volume, total fill volume, net volume
  (borrow/spoil), average cut depth, average fill height, haul distance.
- Color-coded: CUT (red), FILL (blue), BORROW/SPOIL (navy).

### RINEX Observation Log (Topographical Supplementary)

GNSS observation session log for static post-processing. Per Survey of
Kenya GNSS Practice Notes.

- Submission → Generate RINEX Log
- Pages: Cover + Project Info + CORS Stations, then one page per session,
  Surveyor's Certificate (RSA-2048 sealed).
- Each session records: station info (marker, approx coords), receiver
  info (make, model, serial, firmware), antenna info (make, model, serial,
  height, measurement method), session info (start/end UTC, duration,
  interval, satellites observed, ephemeris source, operator), weather
  (temperature, pressure, humidity, conditions), notes.
- Validation warnings emitted for sessions < 30 min, < 4 satellites, or
  invalid antenna heights.

### Leveling Book (Engineering Supplementary)

Rise and fall method leveling book with automatic page check and run
closure. Per RDM 1.1 Section 5.

- Submission → Generate Leveling Book
- Pages: Cover + Equipment + Closure Summary, one page per leveling page
  (with readings table + page check), Surveyor's Certificate (RSA-2048 sealed).
- Each leveling page records: starting BM (name + elevation), closing BM,
  readings table (station, BS, IS, FS, rise, fall, RL, distance, remarks),
  page check (Sum BS, Sum FS, Sum Rise, Sum Fall, BS-FS, Rise-Fall,
  Last RL - First RL — must agree to ±0.001 m).
- Run closure: misclosure vs allowable (10*sqrt(K) mm where K = distance in km).
- Page check enforced: must PASS before leaving the field.

## Workflow Dashboard

Six production-grade workflows, each tuned to a specific surveyor type.
All enforce the principle: NO ERRORS PROPAGATE. Every step validates
inputs and outputs before proceeding.

Access via the **All Workflows** tab.

### 1. Cadastral Survey Workflow
Perfect, error-free, no propagation. 13 steps:
1. Import Field Data (CSV/RINEX/total station)
2. Verify Control Network (against SoK control registry, ±10mm)
3. Compute Traverse (Bowditch/Transit/LSA; Reg 97 1:5000 minimum)
4. Blunder Detection (Baarda χ² + data snooping w-test)
5. COGO Recovery (bearing/distance intersection, ±20mm tolerance)
6. Create Parcel (simple polygon validation)
7. Compute Area (Gauss/Green's theorem; for mutation: parent = sum + balance, ±0.01 m²)
8. QA Gate (10-category pre-submission validation)
9. Form J (Traverse Abstract per Reg 17)
10. Deed Plan (Auto-Layout)
11. Mutation Form (if applicable — Form P per Reg 38)
12. NLIMS/ArdhiSasa Export (JSON schema validation)
13. Survey Report (RSA-2048 sealed)

### 2. Leveling Workflow (Large Project)
For massive level runs. 10 steps:
1. Bench Mark Schedule (TBM at 1km intervals)
2. Equipment Calibration Check (two-peg test, staff calibration)
3. Field Leveling (page by page, rise and fall, equal FS/BS)
4. Page Check (per page — must pass ±0.001 m before leaving field)
5. Run Closure (10*sqrt(K) mm allowable)
6. Adjust Reduced Levels (proportional to distance)
7. Second-Order Correction (curvature/refraction for sights > 50m)
8. Leveling Book PDF (RDM 1.1 Section 5)
9. Cross-Sections (if engineering)
10. Archive + Seal (RSA-2048)

### 3. KeNHA Road Engineering Workflow
For survey engineers at KeNHA. 11 steps:
1. Import Road Design (LandXML alignment + profile + template)
2. Establish Control (GNSS static, 500m intervals, ±5mm + 1ppm)
3. Alignment Design (curves per design speed, superelevation per RDM 1.1)
4. Curve Setting Out (chainage + offset table)
5. Staking Table (10m tangents, 5m curves)
6. Cross-Section Survey (20m spacing, 50m flat terrain)
7. Earthworks Computation (prismoidal method, < 5% error)
8. Mass-Haul Diagram (freehaul vs overhaul economic analysis)
9. Machine Control Export (7 formats: LandXML, DXF, Trimble, Leica, Topcon, generic, stakeout)
10. As-Built Survey (±20mm H, ±10mm V tolerance)
11. Engineering Report (RSA-2048 sealed)

### 4. Construction Setting-Out Workflow
For construction surveyors. 10 steps:
1. Import Design Coordinates (DXF/CSV from architect/engineer)
2. Establish Site Control (minimum 3 points, 1:10000 precision, daily check)
3. Total Station Setup (free station or known station; residuals < 5mm)
4. Compute Stakeout Coordinates (bearing + distance from station)
5. Field Setting Out (peg tolerance ±5mm H, ±2mm V)
6. Real-Time Deviation Check (deviation < ±10mm or as per spec)
7. Re-Stake if Out of Tolerance (log original + corrected position)
8. As-Built Record (final positions documented)
9. Conformance Report (pass/fail per structural element)
10. Archive + Seal (RSA-2048)

### 5. Dam Construction Workflow
For survey engineers building dams. 10 steps:
1. Foundation Survey (1 point per 5m², breaklines along features)
2. Dam Axis Control (1st-order GNSS, verified against national control)
3. Grid Staking (10m × 10m typical, ±5mm tolerance)
4. Base Volume Computation (DTM differencing, prismoidal, ±0.5% closure)
5. Stage-Wise Construction Checking (per lift, volume variance < 2%)
6. Spillway Alignment (per hydraulic design, ±10mm vertical)
7. Embankment Cross-Sections (20m intervals along dam axis)
8. As-Built vs Design (volume difference < 1% of total)
9. GNSS Observation Log (RINEX log for all static GNSS sessions)
10. Dam Survey Report (RSA-2048 sealed)

### 6. Combined Survey Workflow
For multi-discipline projects. 7 steps:
1. Topographical Module (per SoK Practice Notes 2020)
2. Cadastral Module (per Cap 299 + Survey Reg 1994)
3. Engineering Module (per RDM 1.1 2025)
4. GNSS Module (per SoK GNSS Practice Notes)
5. Leveling Module (closure 10*sqrt(K) mm)
6. Merge Deliverables (cross-module consistency check)
7. Combined Survey Report (RSA-2048 sealed)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New Project |
| Ctrl+O | Open Project |
| Ctrl+I | Import CSV |
| Ctrl+S | Save |
| Ctrl+T | Compute Traverse |
| Ctrl+B | Detect Blunders |
| Ctrl+D | Generate Deed Plan |
| Ctrl+Shift+S | Seal Certificate |
| Ctrl+E | Export |
| Ctrl+Shift+E | Export NLIMS |
| Ctrl+R | Generate Survey Report |
| Ctrl+Shift+M | Generate Form P (Mutation) |
| Ctrl+Shift+T | Generate Topo Surveyor's Report |
| Ctrl+Shift+X | Generate Cross-Section Sheets |
| Ctrl+Shift+G | Run QA Gate |
| F1 | Help |
| F11 | Fullscreen |
| Ctrl+Shift+P | Command Palette |

## Offline Operation

METARDU Desktop works fully offline. The only features that need internet:
- ArdhiSasa title chain lookup (OV7) — falls back to local cache
- NTRIP corrections (OV9) — RINEX recording still works for post-processing
- Auto-update — checks on launch, skips silently if offline

## Data Storage

- Project files: `*.metardu` (SQLite database, single file)
- Deed plans: `deed-plans/` directory
- NLIMS exports: `nlims-exports/` directory
- Workbooks: `workbooks/` directory
- Machine control: `machine-control/` directory
- Surveyor keys: `~/AppData/metardu-desktop/surveyor_keys/` (RSA private key)
- Title chain cache: `~/AppData/metardu-desktop/title-chain-cache.json`
- Window states: `~/AppData/metardu-desktop/window-states.json`

## Troubleshooting

### Total station won't connect
- Check USB-Serial adapter is recognized (Tools → Total Station → List Ports)
- Try different baud rates (9600 is default, some instruments use 115200)
- Ensure no other software is using the serial port

### Traverse doesn't close
- Run Tools → Detect Blunders to identify the bad leg
- Check for face-left/face-right averaging errors
- Verify backsight bearing is correct

### Deed plan PDF is blank
- Ensure parcel points have valid coordinates
- Check that the paper size is correct for the parcel dimensions
- Try a smaller scale (1:1000 instead of 1:500)

### NTRIP won't connect
- Verify internet connection
- Check NTRIP credentials
- Try fetching the source table first (Tools → GNSS → Source Table)
