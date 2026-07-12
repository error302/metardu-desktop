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

### Quick Start (Topographic Survey)

1. Import GNSS points (CSV or RINEX)
2. Run GIS QA Report (CRS + Topology + Metadata + Provenance checks)
3. Generate TIN (breakline-aware constrained Delaunay)
4. Generate contours (0.5m interval, index contours every 5th)
5. Export DXF with SoK layer registry (61 layers)
6. Export LandXML 1.2 / GeoJSON / Shapefile

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
