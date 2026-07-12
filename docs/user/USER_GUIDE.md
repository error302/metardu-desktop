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
