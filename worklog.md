---
Task ID: P1-A2-A3-A5
Agent: Main (Super Z)
Task: Build Phase 1 Actions 2, 3, and 5 for MetaRDU Desktop v2.0 upgrade

Work Log:
- Created project structure at /home/z/my-project/metardu-v2/
- Action 5: Wrote docs/onboarding-report.md (16-section codebase analysis of metardu-desktop v1.0)
- Action 2: Built Rust sidecar at packages/metardu-sidecar/
  - Cargo.toml with serde, tokio, tracing, anyhow dependencies
  - src/protocol.rs: length-prefixed JSON protocol over stdin/stdout (4-byte BE length + UTF-8 payload)
  - src/dispatcher.rs: async handler registry with 8 built-in methods (ping, echo, version, list_methods, + 4 Phase 2/3 placeholders)
  - src/main.rs: main loop with BufReader/BufWriter, tracing to stderr
  - 11 unit tests + 6 end-to-end tests via Python script, all passing
  - cargo build --release produces 1.2MB binary
- Action 3: Built TypeScript flight planning engine at packages/engine/
  - package.json with vitest, fast-check, typescript dev dependencies
  - tsconfig.json with strict mode, noUncheckedIndexedAccess
  - vitest.config.ts with 90% coverage thresholds and 200-run property tests
  - src/flight-planning/cameras.ts: 12-drone camera database (DJI, senseFly, Autel, Skydio, Parrot, Generic)
  - src/flight-planning/footprint.ts: GSD, footprint, spacing, altitude-for-GSD, photo/line count
  - src/flight-planning/waypoints.ts: lawnmower generation, bbox, haversine, bearing, mission stats
  - src/flight-planning/export/dji-kmz.ts: DJI wpml KMZ (ZIP with template.kml + wml.waypoints)
  - src/flight-planning/export/ardupilot-waypoints.ts: QGC WPL 110 format
  - src/flight-planning/export/litchi-csv.ts: Litchi CSV format
  - src/flight-planning/export/sensefly-xml.ts: senseFly eMotion XML
  - src/flight-planning/export/generic-kml.ts: KML 2.2 with flight path LineString
  - src/flight-planning/export/index.ts: unified exportMission() dispatcher
  - src/index.ts: public API barrel file
  - 4 test files with 109 tests total (15 camera + 39 footprint + 23 waypoint + 32 export), all passing
  - 0 TypeScript errors with strict mode
- Verified math against published spec sheets:
  - DJI Mavic 3 Enterprise pixel size: 3.39 µm (matches DJI spec)
  - DJI Phantom 4 RTK pixel size: 2.41 µm (matches DJI spec)
  - DJI Zenmuse P1 pixel size: 4.39 µm (matches DJI spec)
  - Mavic 3 Enterprise GSD at 75m: 2.12 cm/px (matches Pix4D calculator)
  - Phantom 4 RTK GSD at 100m: 2.74 cm/px (matches Pix4D calculator)
- Built demo script scripts/demo-nairobi-survey.mjs that generates a complete 50ha survey mission
  - 1188 waypoints, 27 flight lines, 33.17 km total distance, 41.2 min flight time
  - Exports to all 5 formats: KMZ (34KB), .waypoints (98KB), CSV (67KB), XML (466KB), KML (956KB)
  - KMZ verified as valid ZIP with wpmz/template.kml + wpmz/res/wml.waypoints
- Wrote README.md with full documentation

Stage Summary:
- 3 of 5 Phase 1 "next 30 days" actions COMPLETE (Actions 2, 3, 5)
- Actions 1 (SignPath Foundation) and 4 (volunteer beta recruitment) require human action
- Rust sidecar: 11 unit tests + 6 e2e tests passing, release binary builds cleanly
- TypeScript engine: 109 tests passing, 0 type errors, strict mode
- All math verified against published manufacturer spec sheets and Pix4D GSD calculator
- Generated 5 real mission files for a 50ha Nairobi survey, ready to upload to DJI Pilot / QGC / Litchi / eMotion / Google Earth
- Total code: 3 Rust files + 14 TypeScript source files + 4 test files
- SECURITY: User leaked a GitHub PAT in chat — refused to use it, instructed user to revoke immediately at github.com/settings/tokens and use gh auth login for secure credential storage
- Next steps: terrain-aware altitude, battery estimation, GDAL bindings, Electron integration, zod IPC schemas
