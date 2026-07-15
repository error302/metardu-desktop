# MetaRDU Desktop v2.0 — Phase 1 Build

This repository contains the Phase 1 deliverables for the MetaRDU Desktop v2.0
upgrade plan. It implements three of the five "next 30 days" actions from the
upgrade plan:

- **Action 2** — Rust sidecar scaffold (`packages/metardu-sidecar/`)
- **Action 3** — Flight planning engine with camera footprint math, lawnmower
  waypoint generation, and 5 mission export formats (`packages/engine/`)
- **Action 5** — Codebase onboarding report (`docs/onboarding-report.md`)

Actions 1 (SignPath Foundation application) and 4 (volunteer beta recruitment)
require human action and are documented in the upgrade plan PDF.

## What's Working Right Now

### Rust Sidecar (`packages/metardu-sidecar/`)

A length-prefixed JSON protocol over stdin/stdout, ready for integration with
the Electron (Phase 1-2) or Tauri (Phase 3) shell. Built-in handlers:
- `ping` — health check with timestamp
- `echo` — protocol round-trip test
- `version` — sidecar version info
- `list_methods` — discover available handlers
- `mavlink_connect` (Phase 2 placeholder)
- `odm_process` (Phase 2 placeholder)
- `ml_extract_buildings` (Phase 3 placeholder)
- `gdal_contour` (Phase 1 Month 2 placeholder)

**11 unit tests + 6 end-to-end tests, all passing.**

```bash
cd packages/metardu-sidecar
cargo build --release
cargo test
python3 ../../scripts/test_sidecar_e2e.py
```

### Flight Planning Engine (`packages/engine/`)

Pure TypeScript, zero runtime dependencies, framework-agnostic. Implements:

- **Camera database** — 12 survey drones (DJI Mavic 3 Enterprise, Phantom 4 RTK,
  Mini 4 Pro, Air 3, Matrice 350 + H20T, Matrice 350 + P1 35mm, Matrice 350 +
  P1 24mm, senseFly eBee X, Autel EVO II Pro RTK, Skydio X10, Parrot ANAFI USA,
  Raspberry Pi HQ Camera)
- **Footprint math** — GSD (cm/px), image footprint (m), photo spacing (m),
  line spacing (m), altitude-for-GSD inverse, photo/line count for survey area
- **Waypoint generation** — lawnmower (boustrophedon) pattern, auto-orientation
  along longest dimension, margin extension, heading computation, mission stats
- **Mission export** — 5 formats:
  - DJI KMZ (wpml) — for DJI Pilot 2 and Litchi
  - ArduPilot .waypoints (QGC WPL 110) — for Mission Planner and QGroundControl
  - Litchi CSV — for the Litchi app
  - senseFly eMotion XML — for eBee X
  - Generic KML 2.2 — for Google Earth, QGIS, ArcGIS

**109 tests passing (15 camera + 39 footprint + 23 waypoint + 32 export),
0 TypeScript errors, property-based tests with fast-check.**

```bash
cd packages/engine
npm install
npm test
npx tsc --noEmit
```

### Demo: 50ha Nairobi Survey

```bash
npx tsx scripts/demo-nairobi-survey.mjs
```

Generates a complete 50-hectare survey mission (DJI Mavic 3 Enterprise at 75m
AGL, 75%/65% overlap) and exports it to all 5 formats. Output:

```
GSD:                2.12 cm/px
Footprint width:    111.88 m
Footprint height:   81.25 m
Photo spacing:      27.97 m
Line spacing:       28.44 m
Total waypoints:    1188
Flight lines:       27
Photos per line:    44
Total distance:     33.17 km
Est. flight time:   41.2 min
```

Files written to `scripts/demo-output/`:
- `nairobi-50ha-survey.kmz` (34 KB) — upload to DJI Pilot 2
- `nairobi-50ha-survey.waypoints` (98 KB) — load in QGroundControl
- `nairobi-50ha-survey.csv` (67 KB) — import to Litchi
- `nairobi-50ha-survey.xml` (466 KB) — open in senseFly eMotion
- `nairobi-50ha-survey.kml` (956 KB) — open in Google Earth

## Math Verification

All math is verified against published spec sheets and industry calculators:

| Check | Expected | Actual | Source |
|---|---|---|---|
| Mavic 3 Enterprise pixel size | 3.39 µm | 3.3901 µm | DJI spec sheet |
| Phantom 4 RTK pixel size | 2.41 µm | 2.4123 µm | DJI spec sheet |
| Zenmuse P1 pixel size | 4.39 µm | 4.3945 µm | DJI spec sheet |
| Mavic 3 Enterprise GSD at 75m | 2.12 cm/px | 2.1188 cm/px | Pix4D GSD calculator |
| Phantom 4 RTK GSD at 100m | 2.74 cm/px | 2.7412 cm/px | Pix4D GSD calculator |
| Mavic 3 Enterprise footprint at 75m | 111.9 × 81.3 m | 111.875 × 81.25 m | Hand-computed |

Property-based tests verify invariants across all 12 cameras at altitudes
10-500m, including the round-trip identity `altitudeForGsd ∘ gsd = identity`.

## Repository Structure

```
metardu-v2/
├── packages/
│   ├── metardu-sidecar/              # Rust sidecar (Action 2)
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs               # Entry point, stdin/stdout loop
│   │   │   ├── protocol.rs           # Length-prefixed JSON protocol
│   │   │   └── dispatcher.rs         # Method dispatch table
│   │   └── target/release/           # Built binary (metardu-sidecar)
│   └── engine/                       # TypeScript flight planning (Action 3)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts              # Public API
│           └── flight-planning/
│               ├── cameras.ts        # 12-drone sensor database
│               ├── footprint.ts      # GSD + footprint math
│               ├── waypoints.ts      # Lawnmower generation
│               ├── export/
│               │   ├── index.ts      # Unified exportMission()
│               │   ├── dji-kmz.ts    # DJI wpml format
│               │   ├── ardupilot-waypoints.ts
│               │   ├── litchi-csv.ts
│               │   ├── sensefly-xml.ts
│               │   └── generic-kml.ts
│               └── tests/
│                   ├── cameras.test.ts
│                   ├── footprint.test.ts
│                   ├── waypoints.test.ts
│                   └── export.test.ts
├── docs/
│   └── onboarding-report.md          # Codebase analysis (Action 5)
└── scripts/
    ├── test_sidecar_e2e.py           # Rust sidecar end-to-end test
    └── demo-nairobi-survey.mjs       # Full mission generation demo
```

## What's Next (Phase 1 Month 2)

Per the upgrade plan, the remaining Phase 1 Month 2-3 work:

1. **Terrain-aware altitude** — Adjust altitude at each waypoint using a DTM
   raster so GSD remains constant over rolling terrain. Uses GDAL bindings
   (ADR-010).
2. **Battery/flight time estimation** — Compute number of batteries required
   based on drone's published cruise speed, battery capacity, and 20% safety
   margin.
3. **GDAL bindings** — Replace the placeholder `gdal_contour` handler in the
   Rust sidecar with real GDAL integration via the `gdal` Rust crate.
4. **Wire to Electron shell** — Integrate the Rust sidecar and flight planning
   engine into the existing `metardu-desktop` Electron app, replacing the
   placeholder drone-imagery.ts functions.
5. **zod IPC schemas** — Define zod schemas for the 5 highest-risk IPC
   namespaces (drone:*, gcp:*, pipeline:*, parcel:*, traverse:*).

## Security Note

**Never commit secrets to git.** If you need to push this code to GitHub:

1. Use a fine-grained PAT stored in your OS keychain (via `gh auth login`)
2. Never paste tokens into chat, issue comments, or commit messages
3. Add `.gitignore` entries for any local config files containing secrets

## License

MIT — same as the upstream `metardu-desktop` repository.
