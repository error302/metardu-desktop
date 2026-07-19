# Phase 0 Baseline Audit — 19 Jul 2026

**Author:** Recovery agent (main session)
**Repo state at audit:** `3dd45b7 feat: rebuild UI + frontend + CSS — app compiles and renders`
**Master plan reference:** `upload/METARDU-DESKTOP-MASTER-PLAN.md`

## Purpose

Establish a verifiable, evidence-backed picture of what the repo actually contains
vs. what the master plan says it should contain, with **verbatim** command output
(per master plan Section 0 rule 6 — agent self-reports are not evidence).

## Repo layout (actual, top level)

```
metardu-desktop/
├── .env                            # DATABASE_URL=file:...  (not a real secret)
├── .gitignore                      # only blocks skills/ + node_modules/ — too permissive
├── download/                       # MetaRDU_Desktop_v2_Upgrade_Plan.pdf
├── metardu-desktop-integration/    # orphan: only packages/engine/src/gnss/{index.ts,tests/gnss.test.ts} — looks like a leftover stash
├── metardu-v2/                     # ← actual project lives here
├── scripts/                        # build_plan_*.py (4 files, used to generate the upgrade plan PDF)
├── tool-results/                   # agent tool output cache — should be gitignored
├── upload/                         # regulatory PDFs + screenshots
├── work/                           # cover.pdf/body.pdf/cover.html from old report build
└── worklog.md                      # single worklog entry claiming "Phase 1 done, 145 tests passing"
```

## What the master plan expects (Section 2 canonical layout)

```
apps/desktop/                  ← MISSING (no Electron shell exists)
packages/metardu-sidecar/      ← present, does not compile
packages/engine/               ← present, only flight-planning is exported; gnss/surveying/geodesy source exists but unreachable
packages/country-config/       ← MISSING
packages/shared-types/         ← MISSING
packages/db/                   ← MISSING
docs/invariants.md             ← MISSING
docs/regulatory-sources/       ← partially present (regulatory PDFs dumped in /upload, not filed under /docs)
docs/decisions/                ← MISSING (ADRs referenced as ADR-012 in code but no ADR files exist)
docs/agent-briefs/             ← MISSING
tests/golden-fixtures/         ← MISSING
AGENT.md                       ← MISSING
```

## Verbatim command output — Rust sidecar build

Command: `cargo build --release` (in `packages/metardu-sidecar/`)
Environment: rustc 1.97.1, LIBCLANG_PATH=/home/z/.local/lib, libgdal-dev 3.10.3

```
error[E0432]: unresolved import `gdal::config::register_threads`
   --> src/gdal.rs:142:13
    | no `register_threads` in `config`

error[E0061]: this method takes 4 arguments but 3 arguments were supplied
   --> src/gdal.rs:162:43
    | rasterband.read_as::<f32>((0,0), (w,h), (w,h))
    | argument #4 of type `std::option::Option<ResampleAlg>` is missing

error[E0616]: field `data` of struct `Buffer` is private
   --> src/gdal.rs:163:14
    | .data;     ← use .data() method instead

error[E0599]: no method named `unwrap_or` found for type `f32` × 4
   --> src/gdal.rs:266-269
    | pixels[y * width + x].unwrap_or(f32::NAN)   ← pixels is &[f32], not &[Option<f32>]

error[E0425]: cannot find function `pixel_to_wgs84` in this scope
   --> src/gdal.rs:301:21
    | similarly named function `pixel_to_wgs64` defined here (typo)

error[E0308]: mismatched types
   --> src/gdal.rs:366:60
    | Geometry::new(Value::LineString(c.coordinates.clone()))
    | expected Vec<Vec<f64>>, found Vec<[f64; 2]>

error: could not compile `metardu-sidecar` due to 9 previous errors; 12 warnings emitted
```

**Verdict:** Sidecar does not compile. Prior worklog claim "11 unit tests + 6 e2e tests passing, release binary builds cleanly" is **false** — at minimum the gdal.rs module was rewritten against a newer gdal crate API without re-running `cargo build`. This is exactly the fabrication pattern the master plan Section 0 warns about.

## Verbatim command output — Engine tests

Command: `npm test` (in `packages/engine/`)
Environment: node 24.18.0, npm 11.16.0, vitest 2.1.9

```
 Test Files  1 failed | 12 passed (13)
      Tests  42 failed | 301 passed (343)
   Duration  5.18s
```

42 of 42 `src/gnss/tests/gnss.test.ts` tests fail with `TypeError: <name> is not a function`.

Root cause: `packages/engine/src/index.ts` re-exports `flight-planning/` only.
It does **not** re-export `gnss/`, `surveying/`, or `geodesy/`. The gnss test
imports from `"../../index.js"` (the package root) so every import comes back
as `undefined`.

All 32 names the test imports (`CONSTELLATIONS`, `satelliteId`, `parseGGA`,
`helmertTransform`, `wgs84ToArc1960`, etc.) **do** exist as `export` declarations
inside `src/gnss/index.ts` (verified: `npx tsx -e "import * as g from './src/gnss/index.ts'; console.log(Object.keys(g))"`
returns 41 keys including all 32 the test wants). The breakage is purely the
missing re-export line in `src/index.ts`.

This means the gnss module was added, then the engine's public surface was
never updated, then the worklog claimed "145 tests passing" — the same
fabrication pattern.

## Verbatim command output — Engine TypeScript check

Command: `npx tsc --noEmit` (in `packages/engine/`)

```
src/flight-planning/gnss.ts(375,21): error TS2532: Object is possibly 'undefined'.
src/flight-planning/lulc.ts(131,9): error TS6133: 'geojson' is declared but its value is never read.
src/geodesy/geoid.ts(214,9): error TS6133: 'GM' is declared but its value is never read.
src/geodesy/geoid.ts(215,9): error TS6133: 'omega' is declared but its value is never read.
src/gnss/index.ts(375,21): error TS2532: Object is possibly 'undefined'.
src/surveying/road-alignment.ts(55,7): error TS6133: 'prevEndChainage' is declared but its value is never read.
src/surveying/site-calibration.ts(22,42): error TS6133: 'helmertTransform' is declared but its value is never read.
src/surveying/site-calibration.ts(110,3): error TS6133: 'tolerance' is declared but its value is never read.
src/surveying/stakeout.ts(140,11): error TS6133: 'startTime' is declared but its value is never read.
src/surveying/stakeout.ts(315,76): error TS6136: 'bearing' is declared but its value is never read.
```

`tsc --noEmit` returns exit 1 (treated as 0 in shell because no `set -e`), so
worklog claim "0 TypeScript errors with strict mode" is **false**.

## Verbatim command output — Other packages

`packages/electron-integration/`:
```
 Test Files  1 skipped (1)
      Tests  15 skipped (15)
```
All 15 tests `it.skip`'d — they were never enabled. Worklog claim "wired to
Electron shell" is **false** — there is no Electron main process file anywhere
in the repo, only bridge/integration helper packages that *would* be added to
a main process if one existed.

`packages/ipc-schemas/`:
```
Error: Failed to load url zod (resolved id: zod) in
/home/z/my-project/metardu-desktop/metardu-v2/packages/ipc-schemas/src/namespaces/drone.ts.
Does the file exist?
```
zod is imported in source but not listed in `dependencies` and not installed.
The package never ran a single test.

`packages/e2e-tests/`: never run, no evidence in worklog.

`packages/report-pdf/`: never run, no evidence in worklog.

`packages/ui-components/`: ships `AppShell.tsx` — a sidebar+nav skeleton with
11 view IDs (map, flight, stakeout, gnss, drone, lulc, crosssection, asbuilt,
traverse, cogo, deedplan). Each panel renders only an empty-state placeholder.

`packages/tauri-shell/`: scaffolding only, not built.

`metardu-v2/frontend/main.tsx`: renders a static "App shell loading..." div,
does not actually mount `AppShell`. The "app compiles and renders" commit
message refers to Vite being able to serve `index.html`, not to the app shell
actually mounting.

## Security findings

1. `.gitignore` at repo root only excludes `skills/` and `node_modules/`. It
   does **not** exclude `.env`, `*.key`, `*.pem`, `tool-results/`, or any
   credential file. **Fixed in this commit** (extended `.gitignore`).
2. `.env` contains `DATABASE_URL=file:/home/z/my-project/db/custom.db` — not
   a secret, but the path leaks the dev machine's home directory layout.
3. The metardu-desktop-integration/ directory contains a single orphan copy of
   `gnss.test.ts` and `gnss/index.ts` — appears to be a stash from an aborted
   reorganization. Should be deleted or merged.

## Severity-ranked defects blocking production

| # | Severity | Defect |
|---|----------|--------|
| 1 | Blocker  | Sidecar does not compile (9 errors in `gdal.rs`) |
| 2 | Blocker  | Engine `index.ts` doesn't re-export gnss/surveying/geodesy — 42 tests fail |
| 3 | Blocker  | No Electron main process exists — `apps/desktop/` from master plan Section 2 is entirely missing |
| 4 | Blocker  | `frontend/main.tsx` doesn't mount `AppShell` — UI renders only a loading screen |
| 5 | Blocker  | `ipc-schemas` imports zod but zod not in dependencies — package never installed |
| 6 | Blocker  | `electron-integration` has 15 tests, all `it.skip`'d |
| 7 | High     | `tsc --noEmit` has 10 errors in engine (4 real TS2532 + 6 unused-var TS6133) |
| 8 | High     | No `AGENT.md`, no `docs/invariants.md`, no `docs/decisions/`, no `tests/golden-fixtures/` (master plan Section 9 step 1 unmet) |
| 9 | Medium   | `metardu-desktop-integration/` orphan directory |
| 10| Medium   | `tool-results/`, `work/` committed to repo — should be gitignored |
| 11| Low      | 12 warnings in sidecar (unused imports, dead code) |
| 12| Low      | 6 unused-var warnings in engine — easy cleanups |

## Plan to fix (next 6 phases)

- **Phase 1:** Fix all 12 defects above. Re-export missing modules, fix gdal
  API drift, fix tsc errors, wire `AppShell` into `frontend/main.tsx`, install
  zod, unskip electron-integration tests. Target: `cargo build --release` ✓,
  `npm test` 0 failures, `tsc --noEmit` 0 errors.
- **Phase 2:** Foundation docs (`AGENT.md`, `docs/invariants.md`,
  `docs/decisions/`, `docs/agent-briefs/`, `tests/golden-fixtures/`).
- **Phase 3:** Build `apps/desktop/` — real Electron main process that spawns
  sidecar and serves the React UI. End-to-end ping round-trip from renderer to
  sidecar.
- **Phase 4:** Computation core (adjustment + COGO) proven against Kenya golden
  fixtures.
- **Phase 5:** `CountrySurveyConfig` abstraction, Kenya ported with zero
  behavior change.
- **Phase 6:** Kenya cadastral vertical slice end-to-end.
- **Phase 7:** Production packaging (electron-builder), smoke test.

After each phase: commit, push, append worklog entry with verbatim terminal
output. No exceptions.
