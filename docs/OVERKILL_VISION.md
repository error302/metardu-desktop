# METARDU Desktop — The Overkill Vision

## Why Desktop Can Beat Web

The web browser is a sandbox. Desktop is not. Every limitation that
held metardu-web back is a feature we can exploit on desktop:

| Constraint | Web (metardu v1.0.1) | Desktop (METARDU Desktop) |
|-----------|----------------------|--------------------------|
| Memory | ~500MB tab limit, crashes at 500k points | 64GB+ RAM, 10M+ points |
| Serial port | Web Serial API (Chrome only, flaky) | Native `serialport` (all OSes, rock-solid) |
| GPU | WebGL (limited, no compute shaders) | Native GPU (compute shaders, CUDA, Metal) |
| Crypto | Web Crypto (limited key storage) | Hardware HSM, smart cards, TPM |
| Offline | Service Worker (complex, brittle) | Inherent — no network needed |
| Filesystem | File API (user must pick every file) | Full filesystem access |
| Print | Browser print (A4 only, no A0) | Native print (A0 plotters, HP DesignJet) |
| Multi-window | Tabs only | Multiple windows across monitors |
| Background | Tab suspension kills long jobs | Native background processes |
| Latency | HTTP round-trip for every operation | Zero — everything is local |

## The 10 Overkill Features

### 1. Real-Time Total Station Streaming (OV2)
**Web limitation:** Web Serial API requires Chrome, disconnects on tab switch,
buffer overflows at high baud rates.

**Desktop overkill:**
- Native `serialport` library (rock-solid USB-Serial, RS-232, Bluetooth Serial)
- Persistent background connection — never disconnects
- Live map update as shots are taken (sub-100ms latency)
- Auto-detection of instrument type (Topcon, Leica, Sokkia, Trimble, Pentax, South)
- Face-left / face-right averaging with automatic mean calculation
- Real-time coordinate computation as each shot is measured
- Audible/visual blunder alerts (if a shot deviates >3σ from expected)
- Offline-first: all data stays local until the surveyor syncs

### 2. Massive Point Cloud Engine (OV3)
**Web limitation:** Browser tab crashes at ~500k points. Loaders.gl
struggles with LAS files > 100MB.

**Desktop overkill:**
- Out-of-core octree rendering — handles 10M+ points smoothly at 60fps
- Level-of-detail (LOD) — far view shows sampled points, zoom in for full detail
- GPU-accelerated point classification (ground/vegetation/building/road)
- Point cloud differencing (compare two scans for deformation/volume change)
- Breakline auto-detection from point cloud analysis
- Real-time TIN generation as points stream in from GNSS/LiDAR
- MBTiles-style tiling for seamless pan/zoom on massive datasets
- Memory-mapped file I/O — no loading time for 1GB+ LAS files

### 3. Auto-Blunder Detection in Traverses (OV4)
**Web limitation:** Basic Bowditch/Transit adjustment. No statistical testing.

**Desktop overkill:**
- Baarda's method (χ² test on the quadratic form of residuals)
- Data snooping (w-test on each observation for outlier detection)
- Robust estimation (Huber, IGG3, Tukey IRLS — already in the engine)
- Reliability analysis (redundancy numbers, internal/external reliability)
- Automatic blunder identification (which specific observation is bad)
- One-click re-adjustment after removing a flagged blunder
- 3D network adjustment (combined horizontal + vertical)
- Confidence ellipses on adjusted coordinates
- Full covariance matrix output for NLIMS submission

### 4. 3D Parcel Visualization (OV5)
**Web limitation:** 2D OpenLayers only. No 3D.

**Desktop overkill:**
- Three.js 3D scene with parcel extrusion (show building heights)
- Subsurface rights visualization (mineral rights, underground easements)
- Airspace rights (height restrictions, flight path clearance)
- 3D beacon placement (with real elevation, not just 2D point)
- Cross-section viewer (cut any parcel along a line, see the profile)
- Volumetric parcel computation (3D Shoelace formula)
- 3D animation of subdivision (show how a parcel is split over time)
- Export 3D parcel model as IFC (BIM integration for land developers)

### 5. Multi-Window Workspace (OV6)
**Web limitation:** Single tab, single view.

**Desktop overkill:**
- Detachable windows: map, traverse sheet, 3D view, profile, deed plan
- Multi-monitor support: map on monitor 1, data entry on monitor 2
- Synchronized selection: click a point on the map, it highlights in the
  traverse sheet and the 3D view simultaneously
- Split-screen mode: see field data and computed results side-by-side
- Pop-out windows for specific tools (COGO calculator, curve designer)
- Workspace presets: "Field Mode" (large map + minimal UI),
  "Office Mode" (full panels + data tables), "Review Mode" (deed plan + audit log)
- Each window remembers its position and size across sessions

### 6. Historical Title Chain Tracking (OV7)
**Web limitation:** No persistent local state. Each session starts fresh.

**Desktop overkill:**
- Full parcel genealogy: trace any parcel back to its original grant
- Visual timeline: see how a parcel has been subdivided/amalgamated over time
- Automatic conflict detection (overlapping claims, boundary disputes)
- Integration with ArdhiSasa historical records (when online)
- Local cache of all parcels ever surveyed — instant search across years
- Graph database of parcel relationships (parent → child subdivisions)
- Export title chain as PDF for legal proceedings
- Alert when a new survey encroaches on an existing parcel

### 7. AI-Assisted Deed Plan Auto-Layout (OV8)
**Web limitation:** Manual layout. Surveyor draws each element by hand.

**Desktop overkill:**
- Auto-layout engine: given a parcel + traverse, generate a complete deed plan
  with optimal placement of title block, beacon schedule, area table, north
  arrow, scale bar, grid overlay
- Constraint solver: ensures no overlaps, proper margins, SoK compliance
- Template learning: learns from the surveyor's previous plans
- Auto-rotation: orient the plan for maximum readability
- Auto-scale: pick the scale that fits the parcel on A1/A2/A3
- Auto-dimensioning: bearings and distances placed automatically
- One-click generation: from traverse to sealed PDF in under 60 seconds
- Style presets per county (Nairobi, Kiambu, Mombasa have different styles)

### 8. Real-Time GNSS RTK Rover Connection (OV9)
**Web limitation:** Web Bluetooth is Chrome-only, disconnects frequently.

**Desktop overkill:**
- Native BLE connection to GNSS rovers (Leica GS18, Trimble R12, Topcon Hiper)
- NTRIP client with persistent connection (no tab-suspension drops)
- RTK correction streaming from local CORS or NTRIP caster
- Real-time coordinate quality indicator (fix/float/DGNSS/autonomous)
- Auto-averaging of RTK shots at a point (configurable time/count)
- Real-time satellite skyplot with DOP values
- Base-rover radio link quality monitoring
- Post-processed kinematic (PPK) fallback when RTK is unavailable
- RINEX recording for post-processing

### 9. Voice-Controlled Field Data Entry (OV10)
**Web limitation:** Web Speech API is unreliable, Chrome-only.

**Desktop overkill:**
- Native speech recognition (Whisper.cpp model, runs locally, offline)
- Hands-free operation: "Point 1, code BM, description benchmark on rock"
- Voice-activated shot logging: "Store point" → total station measurement
- Voice search: "Find parcel LR 12345"
- Audio feedback: "Traverse closes at 1 to 5000, precision pass"
- Custom voice commands per surveyor
- Works in noisy environments (field-calibrated noise filtering)
- Multi-language: English, Swahili, Sheng

### 10. Predictive Error Detection
**Web limitation:** Reactive — only checks after the surveyor submits.

**Desktop overkill:**
- Real-time anomaly detection as measurements stream in
- ML model trained on thousands of Kenyan surveys
- Predicts likely errors before they happen:
  - "This bearing is 5° off from the expected — possible sight obstruction?"
  - "Distance is 0.5m shorter than design — stake moved?"
  - "Elevation jumps 2m between consecutive shots — level rod error?"
- Confidence scoring on every measurement
- Visual heat map of suspect areas on the map
- Auto-suggest re-measurement of flagged points
- Historical comparison: "This point was 0.02m different last year"

## Implementation Priority

| Priority | Feature | Why First |
|----------|---------|-----------|
| P0 | OV2: Real-time total station streaming | This is THE killer feature. No web app can match it. |
| P0 | OV4: Auto-blunder detection | Surveyors' #1 pain point. Saves hours of re-surveying. |
| P0 | OV3: Massive point cloud engine | Unlocks drone/LiDAR workflows web can't touch. |
| P1 | OV6: Multi-window workspace | Productivity multiplier. Surveyors work on 2 monitors. |
| P1 | OV5: 3D parcel visualization | Visual differentiation. Looks impressive in demos. |
| P1 | OV8: AI-assisted deed plan | Saves 30 min per survey. Huge ROI. |
| P2 | OV9: Real-time GNSS RTK | Important but NTRIP client already exists in engine. |
| P2 | OV7: Title chain tracking | Valuable for legal work. Needs data collection first. |
| P3 | OV10: Voice control | Nice-to-have. Field crews may prefer keyboard. |
| P3 | Predictive error detection | Needs training data. M8+ scope. |

## North Star

> "A surveyor should be able to walk into the field at 6 AM with a laptop
> and a total station, and by 6 PM have a sealed deed plan, NLIMS
> submission, and machine-control files — without ever opening another
> piece of software, without ever needing an internet connection, and
> without ever wondering if a measurement is wrong."

That's the overkill target.
