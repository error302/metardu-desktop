# METARDU Desktop

**Production surveying platform for cadastral, engineering, and topographical surveyors.**

A desktop application fork of [error302/metardu](https://github.com/error302/metardu),
lifted out of the browser into an Electron shell. Targets Windows, macOS, and Ubuntu.
Aligned to the Kenyan Survey Act Cap. 299, Survey Regulations 1994, and RDM 1.1 (2025).
Country-pack architecture supports the East African Community and beyond.

---

## Status

**Phase 2 — Walking Skeleton.** This is the v0.1.0 build that satisfies the
Phase 2 NEXUS gate:

- ✅ Electron app launches on Windows, macOS, and Ubuntu
- ✅ OpenLayers 10 map renders with OSM basemap
- ✅ CSV import parses survey points (point_number, easting, northing, elevation, code, description)
- ✅ Points persist to a local SQLite database (.metardu file)
- ✅ Auto-zoom to bounding box of imported points
- ✅ Audit log records every import

What is NOT here yet (roadmap):

- ⏳ Engine extraction from metardu (M1)
- ⏳ Cadastral UI: traverse closure, Form No. 4 deed plan (M2-M3)
- ⏳ Topographic: TIN, contours, RINEX import (M4-M5)
- ⏳ Engineering: road design, earthworks (M6-M7)
- ⏳ Installer signing + auto-update (M8)
- ⏳ v1.0 release (M9)

See [`/docs/reference/METARDU_UPSTREAM_README.md`](docs/reference/METARDU_UPSTREAM_README.md)
for the upstream project's full feature documentation.

---

## Architecture

Four layers, per [ADR-001](docs/adrs/ADR-001-electron-typescript.md):

```
┌─────────────────────────────────────────────────────────────┐
│  UI LAYER          Electron renderer (sandboxed)            │
│                    React 18 + OpenLayers 10 + Three.js      │
├─────────────────────────────────────────────────────────────┤
│  SHELL LAYER       Electron main (trust boundary)           │
│                    IPC handlers + Python RINEX worker        │
├─────────────────────────────────────────────────────────────┤
│  PERSISTENCE       SQLite + SpatiaLite (zero-install)       │
│                    4 tables in v0.1; 106 tables in v1.0      │
├─────────────────────────────────────────────────────────────┤
│  ENGINE LAYER      @metardu/engine (reused from metardu)    │
│                    Traverse, COGO, LSA, TIN, transforms     │
└─────────────────────────────────────────────────────────────┘
```

See the [Architecture Decisions](docs/adrs/) for the five ADRs that lock in
these choices.

---

## Repository Layout

```
metardu-desktop/
├── apps/
│   └── desktop/                    # Electron + React app
│       ├── electron/               # Main process (Node)
│       │   ├── main.ts             # Window + menu + lifecycle
│       │   ├── preload.ts          # contextBridge — secure IPC API
│       │   ├── database.ts         # SQLite + SpatiaLite wrapper
│       │   ├── ipc.ts              # IPC handler registry
│       │   └── csv-importer.ts     # CSV → SurveyPoint[] parser
│       ├── src/                    # Renderer (React)
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   ├── components/         # TopBar, MapView, Sidebar, StatusBar
│       │   └── styles/
│       ├── public/
│       │   └── sample-survey-points.csv  # Try importing this!
│       ├── index.html
│       ├── vite.config.ts
│       ├── electron-builder.yml    # Win/Mac/Linux installer config
│       └── package.json
├── packages/
│   └── engine/                     # Surveying engine libs (reused from metardu)
│       ├── src/
│       │   ├── engine/             # traverse, COGO, LSA, network adjustment
│       │   ├── geo/                # Cassini-Soldner, Arc 1960, Helmert
│       │   ├── topo/               # TIN, contours, feature codes
│       │   ├── engineering/        # road design, earthworks, leveling
│       │   ├── importers/          # CSV, GSI, JobXML, RW5, LAS, RINEX
│       │   ├── export/             # LandXML, DXF, Shapefile, NLIMS
│       │   ├── documents/          # Form No. 4, workbook, mutation
│       │   └── index.ts
│       └── package.json
├── docs/
│   ├── adrs/                       # ADR-001 through ADR-005
│   ├── gates/                      # NEXUS phase gate decisions
│   ├── reference/                  # Upstream metardu README + ARCHITECTURE_PLAN
│   └── user/                       # User guide (TBD M8)
├── .claude/
│   ├── agents/                     # 12 AI agents adopted from agency-agents
│   └── strategy/                   # NEXUS phase playbooks + runbooks
├── .github/workflows/ci.yml        # CI on Win/Mac/Ubuntu
├── scripts/                        # Build + dev helper scripts
├── LICENSE                         # MIT, crediting error302 as original author
├── NOTICE                          # Third-party attributions
└── package.json                    # Workspace root
```

---

## Quickstart

### Prerequisites

- **Node.js 20+** (use [nvm](https://github.com/nvm-sh/nvm) or download from nodejs.org)
- **Python 3.11+** (for the RINEX worker in M4 — not needed for v0.1)
- On Ubuntu: `sudo apt install libsqlite3-dev libspatialite-dev build-essential`
- On macOS: `xcode-select --install` (for native module compilation)
- On Windows: `npm config set msvs_version 2022` (Visual Studio Build Tools)

### Install & Run

```bash
# Clone this repository
git clone <your-fork-url> metardu-desktop
cd metardu-desktop

# Install all workspace dependencies
npm ci

# Run the dev mode (Vite dev server + Electron)
npm run dev
```

The app will open a window. On first launch it auto-creates a default project
at `/tmp/metardu-walking-skeleton.metardu` (or `C:\Users\Public\Documents\` on Windows).

### Try the Walking Skeleton

1. Click **Import CSV** in the top-right.
2. Select `apps/desktop/public/sample-survey-points.csv`.
3. 12 survey points will appear on the map and in the sidebar.
4. The status bar shows the project path and point count.

### Build Production Installers

```bash
npm run package:linux   # produces .deb + .AppImage in apps/desktop/release/
npm run package:win     # produces .exe (NSIS) + .msix in apps/desktop/release/
npm run package:mac     # produces .dmg in apps/desktop/release/
```

Code-signing requires environment variables (see [§11 of the Master Plan](/home/z/my-project/download/metardu-desktop-master-plan.pdf)):

- `CSC_LINK` + `CSC_KEY_PASSWORD` for Windows EV cert
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` for macOS notarization

---

## AI Agent Orchestration (NEXUS)

This project is built with the [NEXUS phase-playbook doctrine](https://github.com/msitarzewski/agency-agents),
adopted from `msitarzewski/agency-agents`. Twelve agents are installed in
[`.claude/agents/`](.claude/agents/) and the full NEXUS strategy layer is in
[`.claude/strategy/`](.claude/strategy/).

| # | Agent | Phase | Role |
|---|-------|-------|------|
| 01 | Senior PM | 0–9 | Roadmap, gates, handoffs |
| 02 | Software Architect | 0–2 | ADRs, module boundaries |
| 03 | GIS Technical Consultant | 0–2 | Surveyor-domain review |
| 04 | Spatial Data Engineer | 1–7 | SQLite/SpatiaLite, importers |
| 05 | Desktop App Engineer | 1–8 | Electron, IPC, packaging |
| 06 | DevOps Automator | 1–9 | CI/CD on 3 OSes |
| 07 | Code Reviewer | 2–9 | Every PR |
| 08 | Minimal Change Engineer | 2–9 | Smallest possible diffs |
| 09 | GIS QA Engineer | 2–9 | PASS/CONDITIONAL/FAIL reports |
| 10 | Test Automation Engineer | 2–9 | Vitest + Playwright |
| 11 | Reality Checker | 3–9 | Verify-before-review |
| 12 | Technical Writer | 7–9 | User docs, release notes |

---

## License

MIT, crediting [error302](https://github.com/error302) as the original author of
the metardu project from which the surveying engine is reused. See
[LICENSE](LICENSE) and [NOTICE](NOTICE) for full attribution.

Vendored third-party agent-prompt directories (`.agents/`, `.claude/`, `skills/`)
present in the upstream metardu repository have been **removed** from this fork
as they are not surveying code and carry their own separate licenses.

---

## Roadmap

This is Phase 2 (walking skeleton) of a 9-month plan to v1.0 production.
The full plan is in [`/home/z/my-project/download/metardu-desktop-master-plan.pdf`](file:///home/z/my-project/download/metardu-desktop-master-plan.pdf).

| Month | Phase | Deliverable |
|-------|-------|-------------|
| M0 | Phase 2 | Walking skeleton (this commit) |
| M1 | Phase 3 | Engine extraction + test port |
| M2-M3 | Phase 3 | Cadastral MVP (traverse, deed plan, NLIMS) |
| M4-M5 | Phase 3-4 | Topographic (TIN, contours, RINEX) |
| M6-M7 | Phase 4 | Engineering (road design, earthworks) |
| M8 | Phase 5 | Hardening (signing, betas, docs) |
| M9 | Phase 6 | v1.0 release |

---

## Contributing

This is a fork-and-finish project. Issues and PRs are welcome at the fork's
GitHub repository. Before contributing, read:

1. The [Master Plan PDF](file:///home/z/my-project/download/metardu-desktop-master-plan.pdf)
2. The [5 ADRs](docs/adrs/)
3. The [NEXUS phase playbook](.claude/strategy/QUICKSTART.md)

Every PR goes through the Dev↔QA loop with a 3-retry cap (see
[§9.2 of the Master Plan](file:///home/z/my-project/download/metardu-desktop-master-plan.pdf)).
