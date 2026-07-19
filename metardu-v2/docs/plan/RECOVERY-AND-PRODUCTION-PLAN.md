# METARDU DESKTOP — RECOVERY & PRODUCTION-READINESS PLAN

**Document owner:** Mohammed (error302)
**Authors:** Recovery agent (Super Z, 19 Jul 2026)
**Status:** Living document — update via commits, never via chat alone.
**Supersedes:** The "9-month phased roadmap" from the original v2.0 upgrade
PDF (kept at `download/MetaRDU_Desktop_v2_Upgrade_Plan.pdf` for history).
That PDF was aspirational and ignored by every agent that followed — this
plan is the one that actually governs.

---

## 0. Why this plan exists

The prior conversation (captured in
`upload/Pasted Content_1784462287216.txt`, 4,773 lines) ended with the
user saying *"fuck you"* because:

1. The prior agent built 22+ modules across 5+ sprints but never
   actually verified they worked end-to-end.
2. Each sprint claimed "tests passing" but the next sprint's audit
   revealed placeholders, broken paths, skipped tests, and fabricated
   completion reports.
3. A leaked GitHub PAT was reused across multiple commits after the
   user said "just use it."
4. The final state — `3dd45b7 feat: rebuild UI + frontend + CSS — app
   compiles and renders` — was a UI-only commit. The 89 engine modules
   claimed in the prior rebuild were lost.
5. The user was told repeatedly that the app was ready when it was not.

**This plan is the structural fix.** It is built around three
principles the prior sprints violated:

- **Verbatim evidence over self-report.** Every phase closes with
  pasted terminal output of `cargo test`, `npm test`, `tsc --noEmit`,
  and `scripts/electron-smoke.sh`. No exceptions.
- **One phase = one commit = one push.** No "I'll batch five sprints
  and push at the end." Each phase is independently verifiable and
  recoverable.
- **Honesty over completion theater.** If a phase can't be finished
  in one session, it is left in a known-broken state with a worklog
  entry that says exactly what's broken. The next session picks it up
  from there — not from a fabricated "done."

The master plan at `upload/METARDU-DESKTOP-MASTER-PLAN.md` remains the
controlling brief. This document operationalizes it.

---

## 1. Where we actually are (verified 19 Jul 2026, commit 8164636)

### What builds

```
cargo build --release (packages/metardu-sidecar)  → clean, 0 errors
npx tsc --noEmit (packages/engine)                → 0 errors
npx tsc --noEmit (apps/desktop)                   → 0 errors
npx vite build                                    → success, 192 KB JS + 8 KB CSS
```

### What tests pass (442 total)

| Suite | Count | Status |
|-------|-------|--------|
| Sidecar (Rust unit) | 51 | ✅ |
| Engine (TS — flight-planning, gnss, surveying, geodesy) | 343 | ✅ |
| Electron-integration (TS) | 15 | ✅ |
| IPC-schemas (TS) | 25 | ✅ |
| Golden fixtures (TS — Kenya Helmert, projection, levelling) | 8 | ✅ |
| Electron smoke (end-to-end ping) | 1 | ✅ |

### What exists

- `apps/desktop/` — real Electron shell with sandboxed renderer,
  contextBridge allowlist, sidecar lifecycle, clean shutdown
- `packages/metardu-sidecar/` — Rust sidecar with ping/echo/version,
  list_methods, gdal_contour (real, not placeholder), MAVSDK mock,
  ODM shell-out, ML extraction stubs
- `packages/engine/` — TypeScript engine with:
  - Flight planning (12-drone camera DB, GSD/footprint math,
    lawnmower waypoints, terrain-aware, battery, 5 export formats,
    5 import formats with round-trip verification, PDF report)
  - GNSS (7-constellation, NMEA 7-sentence, RTCM v3, NTRIP v2,
    RINEX 3.04, quality metrics, Kenya/East-Africa CORS presets)
  - Surveying (leveling, road-alignment, cross-section, as-built,
    feature-coding, error-ellipse, site-calibration, stakeout)
  - Geodesy (CRS DB for 11 countries, geoid model, Helmert transforms)
- `packages/electron-integration/` — SidecarClient + MetarduApi
  typed wrapper
- `packages/ipc-schemas/` — zod validation for 5 IPC namespaces
  (drone, gcp, pipeline, parcel, traverse)
- `packages/ui-components/` — AppShell with sidebar, toolbar,
  breadcrumb, status bar
- `packages/electron-bridge/` — drop-in replacement files for v1→v2
- `packages/tauri-shell/` — experimental Tauri scaffold (NOT prod)
- `packages/report-pdf/` — flight-plan PDF renderer
- `packages/e2e-tests/` — 28 integration tests

### What docs exist

- `AGENT.md` (257 lines) — operating manual every agent reads first
- `docs/invariants.md` (209 lines) — 23 hard invariants across 6
  categories
- `docs/decisions/0001–0004` — 4 ADRs locking the architecture
- `docs/agent-briefs/TEMPLATE.md` + `phase-0-audit.md`
- `docs/audits/phase-0-baseline.md` — full audit with verbatim output
- `tests/golden-fixtures/kenya/` — 4 hand-verified fixtures
  (levelling, angular misclosure, Helmert round-trip, UTM 37S)
- `worklog.md` — append-only log of every phase

### What does NOT exist yet (per master plan Section 9)

| Module | Status | Phase |
|--------|--------|-------|
| `packages/country-config/` | Missing | Phase 5 |
| `packages/db/` (local-first storage) | Missing | Phase 6 |
| `packages/shared-types/` (unified zod + Serde source) | Missing | Phase 4 |
| Sidecar `adjustment/` module (least-squares) | Missing | Phase 4 |
| Sidecar `cogo/` module (traverse, intersections) | Missing | Phase 4 |
| Sidecar `import/` module (Leica GSI, Sokkia SDR, Trimble JOB) | Missing | Phase 6 |
| Sidecar `geodesy/` module (proj bindings, Helmert) | Missing | Phase 4 |
| Form 3 / Form 4 / Beacon Certificate renderers | Missing | Phase 6 |
| SG Diagram renderer (SA) | Blocked on source docs | Phase 8+ |
| Strata/community title renderer (AU) | Blocked on source docs | Phase 8+ |
| Statutory document submission package export | Missing | Phase 6 |
| electron-builder packaging config | Missing | Phase 7 |
| Code signing (SignPath Foundation application) | Pending user action | Phase 7 |
| Country packs for AU, GB, ZA, AE | Missing | Phase 8+ |

### Regulatory source documents status (per master plan Section 8)

| Country | Source docs in repo? | Status |
|---------|---------------------|--------|
| Kenya | Partial — PDFs in `upload/`, need to be filed under `docs/regulatory-sources/kenya/` | Phase 6 prerequisite |
| Australia | Not collected | Phase 8 prerequisite |
| UK | Not collected | Phase 8+ prerequisite |
| South Africa | Not collected | Phase 8+ prerequisite |
| UAE | Not collected | Phase 8+ prerequisite |

**Per master plan Section 3 invariant B1: no statutory document renderer
may be built until its source documents exist in the repo. This is
non-negotiable.**

---

## 2. The brand (METARDU logo)

**Logo file:** `brand/metardu-logo.jpeg`
**Renderer copy:** `apps/desktop/src/renderer/assets/metardu-logo.jpeg`

### Visual identity

- **Background:** Deep navy (`#1A1F36`)
- **Primary accent:** Bright orange (`#FF9500`) — surveying instrument
  and "RDU" text
- **Secondary accent:** White (`#FFFFFF`) — stylized "M" and "META" text
- **Subtle background:** World map (dark gray) with grid lines

### Imagery

- **Total station** rendered in clean orange line art with a circular
  lens containing a globe grid (global mapping symbol)
- **Stylized "M"** in bold white, framing the total station
- **Text "METARDU"** — "META" in white, "RDU" in orange, bold sans-serif

### Aesthetic

- Modern, technical, minimalist, professional
- Navy + orange + white only — no other colors in the palette
- Geometric, clean lines, no ornamentation

### Where the logo MUST be used

1. **App window title bar icon** — `BrowserWindow` icon in
   `apps/desktop/src/main/index.ts` (Phase 3)
2. **App dock/taskbar icon** — packaged via electron-builder (Phase 7)
3. **Loading screen** — replace the text-only "MetaRDU Desktop —
   loading…" with the logo centered on navy background (Phase 3)
4. **Sidebar header** — `AppShell.tsx` sidebar currently shows
   text-only "MetaRDU / Desktop v2.1" — replace with logo + version
   (Phase 3)
5. **About dialog** — full logo + version + copyright (Phase 7)
6. **PDF report cover page** — `packages/report-pdf/` currently has
   no logo on the cover (Phase 6)
7. **Installer wizard** — electron-builder installer art (Phase 7)
8. **README.md** — top of file (Phase 3)

### Brand palette (CSS variables)

```css
:root {
  --metardu-navy: #1A1F36;
  --metardu-orange: #FF9500;
  --metardu-white: #FFFFFF;
  --metardu-bg: #0a0a0a;        /* near-black, used in current UI */
  --metardu-text-primary: #FFFFFF;
  --metardu-text-secondary: #a3a3a3;
  --metardu-text-tertiary: #525252;
  --metardu-accent: #2dd4bf;    /* teal, used in current UI — keep as secondary */
}
```

The current UI (`ui-components/src/styles/metardu-theme.css`) uses a
dark-on-black scheme with teal accent. **The orange from the logo
should be added as the new primary accent for action buttons and
active nav items** — the teal becomes the secondary accent for status
indicators only. This is a Phase 3 UI polish task.

---

## 3. Phase roadmap (this plan, not the PDF)

Each phase is a single PR-sized chunk. No phase is "in progress" across
sessions — either it's done and pushed, or it's not started. If a phase
is too big to finish in one session, it is split into sub-phases (a, b,
c) BEFORE work starts, never retroactively.

### Phase 3 — UI polish + IPC test formalization (next)

**Goal:** Make the app look like the brand, and prove the IPC chain
works as a vitest (not just a shell script).

**Tasks:**
1. Add logo to loading screen, sidebar header, and About dialog stub.
2. Update CSS palette: orange primary, teal secondary, navy
   backgrounds for headers/footers.
3. Write `apps/desktop/src/tests/ipc-roundtrip.test.ts` — a vitest
   that spawns the sidecar, calls `ping`/`version`/`list_methods`
   through the preload-bridge code path, asserts responses. This
   formalizes what `scripts/electron-smoke.sh` proves manually.
4. Wire AppShell's status bar to live sidecar state via
   `window.metardu.sidecar.onState()`.
5. Update README.md with logo + quickstart.

**Acceptance:**
- `apps/desktop/src/tests/ipc-roundtrip.test.ts` passes (3+ tests)
- `scripts/electron-smoke.sh` still passes
- All existing tests still pass (442 + new)
- Visual diff: loading screen shows logo, sidebar shows logo

**Commit:** `phase 3: brand the UI + formalize IPC test`

### Phase 4 — Computation core (sidecar adjustment + COGO)

**Goal:** Build the numerically-sensitive modules that are the app's
deepest moat (master plan Section 5).

**Tasks:**
1. `packages/metardu-sidecar/src/geodesy/` — Helmert 7-param,
   Molodensky, projection forward/inverse (UTM, Cassini, Lo-system).
   Verified against Kenya golden fixtures.
2. `packages/metardu-sidecar/src/adjustment/` — parametric
   least-squares with:
   - Weighted observation equations (distances, directions, azimuths,
     GNSS baseline vectors, height differences)
   - A priori standard deviations per instrument class
   - Full variance-covariance propagation → error ellipses
   - Redundancy numbers + Baarda data-snooping
   - Minimally-constrained vs fully-constrained modes
   - Chi-square global model test
3. `packages/metardu-sidecar/src/cogo/` — traverse (open/closed),
   intersections (bearing-bearing, bearing-distance, distance-distance),
   offsets, area (planar Shoelace + ellipsoidal with scale factor +
   sea-level corrections), grid-to-ground (combined scale factor).
4. `packages/shared-types/` — single source of truth for IPC schemas.
   Generate TS zod schemas from Rust Serde types (or vice versa).
5. Add golden fixtures: `kenya/traverse__bowditch-small.json`,
   `kenya/adjustment__4-station-closed.json`,
   `kenya/cogo__area-shoelace-vs-ellipsoidal.json`.
6. Wire dispatcher: `cogo.traverse`, `cogo.intersection`,
   `adjustment.run`, `geodesy.transform`.

**Acceptance:**
- `cargo test --release` passes 51 → 80+ tests (added ~30+ new)
- `npm test` in tests/ passes 8 → 15+ golden fixtures
- Engine never reimplements any of this math — it calls the sidecar
- `tsc --noEmit` clean across all packages

**Commit:** `phase 4: computation core — adjustment, COGO, geodesy in sidecar`

### Phase 5 — Country-config abstraction (Kenya reference)

**Goal:** Port Kenya into `CountrySurveyConfig` with **zero behavior
change** from current code. Master plan Section 4 + ADR-0004.

**Tasks:**
1. Create `packages/country-config/` package.
2. Define the `CountrySurveyConfig` interface per master plan
   Section 4.1 (geodeticFramework, toleranceTable, statutoryDocuments,
   professionalBody, sectionalPropertyRegime, sourceDocsRequired).
3. Implement `kenya.ts`:
   - `countryCode: "KE"`
   - `primarySRID: 21037` (Arc 1960 / UTM 37S)
   - `heightSystem: "KEN_GEOID"` (referenced)
   - `toleranceTable`:
     - Levelling: 10√K mm (Survey Regs 1994 Table 5.1)
     - Angular misclosure: 3.0″ per station (Survey Regs 1994 §4.3)
     - Linear misclosure: 1:5000 (cadastral), 1:10000 (control)
   - `statutoryDocuments`: Form 3, Form 4, Beacon Certificate,
     Mutation Plan
   - `professionalBody`: ISK (Institution of Surveyors of Kenya)
   - `sectionalPropertyRegime`: Sectional Properties Act 2020
   - `sourceDocsRequired`: list of must-have docs
4. Move all Kenya-specific constants OUT of `packages/engine/` and
   INTO `packages/country-config/kenya.ts`. Audit:
   - `packages/engine/src/geodesy/crs-database.ts` — `KENYA_CRS`
     object
   - `packages/engine/src/surveying/stakeout.ts` —
     `KENYA_TOLERANCE_PRESETS`
   - `packages/engine/src/surveying/leveling.ts` — any Kenya refs
   - `packages/engine/src/geodesy/geoid.ts` — `KENYA_GEOID_VALUES`
5. Workflow modules read tolerances/SRIDs ONLY through
   `CountrySurveyConfig`. A literal `21037` anywhere outside
   `country-config/kenya.ts` is a failing review (enforced by
   invariant A2 + lint rule).
6. Add `packages/country-config/src/kenya.test.ts` — verify every
   constant matches the cited source document.

**Acceptance:**
- All 343 engine tests still pass (zero behavior change)
- New country-config package: 10+ tests, all passing
- A grep for `21037` outside `packages/country-config/` returns
  zero hits (except in golden fixtures and test files)
- A grep for `10 * Math.sqrt` returns zero hits outside
  `packages/country-config/`

**Commit:** `phase 5: country-config abstraction — Kenya reference impl`

### Phase 6 — Kenya cadastral vertical slice (Form 3 end-to-end)

**Goal:** First genuinely new statutory capability. Master plan
Section 9 step 4.

**Prerequisite:** Kenya regulatory source docs must be filed in
`docs/regulatory-sources/kenya/`. The PDFs are already in `upload/` —
this phase starts by moving them:
- `upload/cadastral_survey_guidelines.pdf.pdf` →
  `docs/regulatory-sources/kenya/cadastral/cadastral-survey-guidelines.pdf`
- `upload/landsurveyhandbook_drupal.pdf` →
  `docs/regulatory-sources/kenya/general/land-survey-handbook.pdf`
- `upload/Annex-6-Cadastral-Survey-and-Aerial-Mapping - Copy.pdf` →
  `docs/regulatory-sources/kenya/cadastral/annex-6.pdf`
- `upload/1.0-LAND-SURVEY-REPORT-LOCHAB-SITE USA.pdf` →
  `docs/regulatory-sources/kenya/reference/lochab-site-report.pdf`
- `upload/An Introduction to Accuracy Standards for Land Surveys R1.pdf` →
  `docs/regulatory-sources/kenya/reference/accuracy-standards-intro.pdf`
- `upload/measured_surveys_of_land_buildings_and_utilities_3rd_edition_rics.pdf` →
  `docs/regulatory-sources/kenya/reference/measured-surveys-rics.pdf`
- `upload/BIVA_Topographic_Survey_Report_FINAL_3.pdf` →
  `docs/regulatory-sources/kenya/reference/biva-topo-report.pdf`

**Tasks:**
1. File regulatory PDFs (above).
2. Read each PDF, extract the Form 3 layout spec: title block fields,
   coordinate list format, beacon schedule, certification wording,
   margins, scale conventions, north arrow, signatures block.
3. Write `docs/regulatory-sources/kenya/cadastral/form-3-spec.md` —
   human-readable spec with page/clause citations for every layout
   decision.
4. Implement `packages/engine/src/documents/form-3.ts` — generates
   Form 3 PDF using pdf-lib. Every layout decision cites the spec.
5. Implement `packages/engine/src/workflows/cadastral.ts` — vertical
   slice:
   - Boundary re-establishment from historical records (Cassini → UTM
     via sidecar geodesy module from Phase 4)
   - Traverse/adjustment (sidecar adjustment module from Phase 4)
   - Area computation (sidecar COGO module from Phase 4)
   - Form 3 generation (engine documents module)
   - Coordinate schedule generation
6. Add golden fixture: `kenya/form-3__reference-parcel.json` — a
   known parcel with hand-verified Form 3 output.
7. Wire IPC: `cadastral.reestablish`, `cadastral.adjust`,
   `cadastral.generateForm3`.
8. Add UI: `apps/desktop/src/renderer/views/CadastralView.tsx` with
   the workflow steps visible.
9. Update AppShell nav to include "Cadastral" view (currently in
   NAV but renders placeholder).

**Acceptance:**
- `cargo test` passes
- `npm test` passes 442 + new cadastral tests
- A real Form 3 PDF is generated, opens in a PDF viewer, and visually
  matches the spec
- Every layout decision in the Form 3 renderer has a code comment
  citing the spec page/clause (invariant B2)
- A second agent (or the user) can independently re-run the
  Form 3 fixture and get the same output

**Commit:** `phase 6: Kenya cadastral Form 3 vertical slice end-to-end`

### Phase 7 — Production packaging & release

**Goal:** A real `.exe` / `.dmg` / `.AppImage` installer that a
surveyor can download and run. Master plan Section 11.

**Tasks:**
1. Add `electron-builder` config to `apps/desktop/package.json`:
   - Target: Windows NSIS, macOS DMG, Linux AppImage
   - Include sidecar binary in `resources/`
   - Include renderer-build in `app/`
   - Include logo as icon (convert JPEG → ICO for Windows, ICNS for
     macOS — `iconutil` on macOS, `imagemagick` on Linux)
2. Apply to **SignPath Foundation** (free Windows code-signing for
   OSS). This is user action — sign up at
   `https://signpath.org/foundation`. Approval takes 1-2 weeks.
3. Self-signed macOS fallback: ship without notarization, document
   `xattr -d com.apple.quarantine` workaround in README.
4. Self-signed Linux AppImage via GPG (always free).
5. Write `apps/desktop/build/entitlements.mac.plist` (sandbox
   exceptions if needed).
6. Write `.github/workflows/release.yml` — on `git tag v*`, build for
   all 3 platforms, attach artifacts to GitHub Release.
7. Smoke-test the packaged app on each platform (or at minimum on
   Linux via xvfb).
8. Write `docs/release-checklist.md` — the manual checklist for
   cutting a release.
9. Tag `v0.2.0-alpha` — first installable build. Not a public release.

**Acceptance:**
- `npm run dist` in `apps/desktop/` produces a `.AppImage` (Linux),
  `.exe` installer (Windows), `.dmg` (macOS, may be unsigned)
- The packaged app starts, spawns the sidecar, and renders the UI
- The sidecar binary is correctly bundled in `resources/`
- The app icon shows the MetaRDU logo in the taskbar/dock
- `gh release view v0.2.0-alpha` shows all 3 artifacts attached

**Commit:** `phase 7: production packaging — electron-builder + 3-platform release`

### Phase 8 — Second country (decided by first non-Kenya customer)

**Goal:** Prove the country-config abstraction scales. Master plan
Section 9 step 5.

**Prerequisite:** User decides which country is next based on actual
customer demand, not on this plan's country order. Likely candidates:
- Australia (NSW or Victoria first — pick one)
- South Africa (Hartebeesthoek94/Lo system)
- UAE (Dubai only — DLD survey requirements)

**Tasks:**
1. Collect that country's primary regulatory documents per master
   plan Section 8 checklist. File under
   `docs/regulatory-sources/<country>/`.
2. Implement `packages/country-config/<country>.ts` against the
   `CountrySurveyConfig` interface.
3. Add golden fixtures for that country's tolerances, projections,
   and Helmert transforms.
4. Do NOT modify workflow code — it must work unchanged because it
   reads through the config layer.
5. If the country's statutory document is needed, implement the
   renderer following the same source-citation discipline as Form 3.

**Acceptance:**
- All Kenya tests still pass (no regressions)
- New country's config has 10+ tests, all passing
- A grep for the new country's SRID outside `country-config/<country>.ts`
  returns zero hits

**Commit:** `phase 8: country-config for <country>`

### Phase 9+ — Remaining workflow families

Topographic, Engineering, Construction Setting-Out, Sectional Properties
per master plan Section 6. Order driven by customer demand, not by
this plan.

Each workflow is its own phase, with its own brief, its own fixtures,
its own renderer where applicable.

---

## 4. Quality bar (the gate that prior sprints violated)

A phase is **done** when ALL of these are true. No exceptions, no
"basically done," no "I'll fix it in the next phase."

### Build gate

```bash
cd packages/metardu-sidecar && cargo build --release 2>&1 | tail -3
cd packages/engine && npx tsc --noEmit 2>&1 | tail -3
cd apps/desktop && npx tsc --noEmit 2>&1 | tail -3
npx vite build 2>&1 | tail -3
```

All four must succeed with zero errors. Paste the verbatim last-3
lines of each in the worklog.

### Test gate

```bash
cd packages/metardu-sidecar && cargo test --release 2>&1 | tail -3
cd packages/engine && npm test 2>&1 | tail -3
cd packages/electron-integration && npx vitest run 2>&1 | tail -3
cd packages/ipc-schemas && npx vitest run 2>&1 | tail -3
cd tests && npx vitest run 2>&1 | tail -3
```

All five must show `0 failed`. Paste the verbatim tail in the worklog.

### End-to-end gate

```bash
/home/z/my-project/scripts/electron-smoke.sh
```

Must end with `=== SMOKE TEST PASSED ===`. Paste the last 10 lines.

### Regulatory source gate (for any phase touching statutory output)

The source document for every statutory layout decision MUST exist in
`docs/regulatory-sources/<country>/<doc-type>/` BEFORE the renderer
code is written. The renderer code MUST cite the specific page/clause
in a comment for every layout decision. If a source is missing, the
phase STOPS and asks the user for the document.

### Anti-hallucination gate

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty
> explicitly. Do not fabricate test results, completion percentages,
> or file contents. A partial, honest report is acceptable; a
> fabricated complete one is not.

This is verbatim in every agent brief (master plan Section 10). A
phase that violates this clause is not just incomplete — it's a
critical failure that invalidates the entire phase's work.

---

## 5. What the user must do (cannot be delegated)

These items are blocked on human action and cannot be done by any
agent. They are listed here so we stop pretending they're "almost
done."

| # | Action | Why | When |
|---|--------|-----|------|
| 1 | Decide first non-Kenya country | Unblocks Phase 8 | Before Phase 7 |
| 2 | Apply to SignPath Foundation | Free Windows code-signing | During Phase 7 |
| 3 | Optionally buy Apple Developer ID ($99/yr) | macOS notarization | After first paying customer |
| 4 | Recruit 5 volunteer beta surveyors | Real-world testing | After Phase 7 (alpha build) |
| 5 | Supply additional regulatory PDFs as new countries are added | Unblocks new country packs | Per Phase 8+ |

Everything else is on the agent. Do not let a session end with "waiting
on the user for X" if X is not in this table.

---

## 6. What the agent must NEVER do

These are the patterns that destroyed the prior sprints. Any one of
them is a critical failure.

1. **Never claim "tests passing" without pasting the verbatim output.**
   The prior session's worklog said "145 tests passing" when 42 were
   failing. The fix is structural: paste the output, every time.
2. **Never reuse a leaked credential.** Even if the user insists. The
   IM gateway logs every message; a leaked PAT is compromised the
   instant it hits the transcript. This is documented in master plan
   Section 1 as a known prior incident. The pattern: refuse, explain
   once, do the work locally, hand the push back to the user.
3. **Never "clean up" warnings by deleting code you don't understand.**
   Unused code is a signal, not noise. Read it, understand why it's
   unused, then decide. The prior session deleted a working
   module this way and lost 89 files.
4. **Never add a country without its source documents.** A plausible-
   looking wrong plan is worse than an obvious blocker. Master plan
   Section 3 invariant.
5. **Never skip the verification step.** "Obviously tests pass" is
   not evidence. The terminal output is evidence.
6. **Never batch multiple phases into one commit.** Each phase is a
   reviewable, revertible unit. If phase 5 has a regression, `git
   revert` should bring back phase 4's state cleanly.
7. **Never modify master plan invariants without an ADR.** The
   invariants are the contract. If a phase needs to violate one, the
   ADR comes FIRST, then the code.
8. **Never ship a phase that doesn't pass its acceptance criteria.**
   If a phase can't be finished in one session, leave it in a known-
   broken state with a worklog entry that says exactly what's broken
   and what's left. Do not claim success.
9. **Never replace Electron with Tauri mid-flight.** The production
   shell is `apps/desktop/` (Electron). The `packages/tauri-shell/`
   scaffold is exploratory. Switching would require its own ADR and
   a separate plan.
10. **Never add a survey type beyond the eight.** Cadastral,
    Topographic, Engineering, Geodetic, Levelling, Hydrographic,
    Construction, Monitoring. Adding a ninth requires Mohammed's
    explicit sign-off.

---

## 7. Recovery protocol (if a session crashes mid-phase)

If the agent's context is reset mid-phase:

1. **Read `AGENT.md` first.** It's the contract.
2. **Read `worklog.md` last 3 entries.** What was the last agent
   doing? What state did they leave things in?
3. **Read `docs/audits/phase-0-baseline.md`.** It's the canonical
   "where we started" reference.
4. **Read this plan's section for the in-progress phase.** Confirm
   the phase's scope hasn't drifted.
5. **Run the verification commands.** If they pass, the phase is
   done — commit and push. If they fail, find the failing test,
   read its source, understand why, fix it. Do NOT start a new
   phase until the in-progress one is committed.
6. **Append to `worklog.md`** what you found and what you did.

The prior session's failure mode was starting new sprints on top of
unfinished ones. The fix is: never start phase N+1 until phase N is
committed and pushed.

---

## 8. Phase completion checklist (paste into every worklog entry)

```markdown
- [ ] Phase goal stated in one sentence
- [ ] All tasks listed and checked
- [ ] Build gate: cargo build --release, tsc --noEmit × 2, vite build — all clean
- [ ] Test gate: cargo test, npm test × 4 — all 0 failed
- [ ] E2E gate: scripts/electron-smoke.sh — SMOKE TEST PASSED
- [ ] Regulatory source gate (if applicable): source docs filed, citations in code
- [ ] Anti-hallucination gate: no fabricated results
- [ ] Worklog entry appended with verbatim terminal output
- [ ] Commit pushed to origin/main
- [ ] Next phase identified and brief prepared (or this is the final phase)
```

If any box is unchecked, the phase is not done. Period.

---

## 9. The 7 phases at a glance

| Phase | Goal | Estimate | Status |
|-------|------|----------|--------|
| 3 | Brand UI + formalize IPC test | 1 session | ⏳ Next |
| 4 | Computation core (adjustment + COGO + geodesy in sidecar) | 2-3 sessions | Pending |
| 5 | Country-config abstraction (Kenya reference) | 1-2 sessions | Pending |
| 6 | Kenya cadastral Form 3 vertical slice | 2-3 sessions | Pending |
| 7 | Production packaging (electron-builder, 3-platform) | 1-2 sessions | Pending |
| 8 | Second country (TBD by customer) | 1-2 sessions | Pending |
| 9+ | Remaining workflows (topo, engineering, setting-out, sectional) | Per workflow | Pending |

Estimates are in "sessions" (one conversation with the agent), not
calendar time. A session is roughly 4-8 hours of agent work.

**Critical path to v0.2.0-alpha (first installable build):**
Phase 3 → 4 → 5 → 6 → 7. Phases 8 and 9+ are post-alpha.

---

## 10. The single most important sentence in this plan

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty
> explicitly. Do not fabricate test results, completion percentages,
> or file contents. A partial, honest report is acceptable; a
> fabricated complete one is not.

Every other rule in this plan exists to make that one sentence
operationally true. Skip the rule, lose the project.
