# AGENT.md — Operating Manual for All Agents

> **Read this file in full before writing a single line of code in this repo.
> No exceptions. If your context was reset, this file is your contract.**

This repository is **metardu-desktop** — a multi-country survey automation
desktop application. The controlling master plan lives at
`upload/METARDU-DESKTOP-MASTER-PLAN.md` (read it). This file is the
operational summary: what is true, what is forbidden, and what every agent
must do.

---

## 0. Why this file exists

The previous agent sessions destroyed the app twice. Root cause was never
the model — it was the absence of a persistent, machine-checkable source
of truth that survives context resets. This file, plus `docs/invariants.md`
plus the golden-fixture test suite, is that source of truth. An agent
cannot "forget" a rule that breaks CI.

If anything in this file conflicts with a chat instruction, this file wins
unless the chat instruction explicitly says "edit AGENT.md to reflect the
change."

---

## 1. Current state (verified 19 Jul 2026)

- **Architecture (locked, see `docs/invariants.md`):** Rust sidecar
  (numerically-sensitive compute) + TypeScript engine (orchestration) +
  Electron shell (UI host). Master plan Section 2 — do not re-litigate.
- **What builds:**
  - `cargo build --release` in `packages/metardu-sidecar/` → clean
  - `npx tsc --noEmit` in `packages/engine/` → 0 errors
  - `npx tsc --noEmit` in `apps/desktop/` → 0 errors
- **What tests pass:**
  - Sidecar: 51/51 Rust tests
  - Engine: 343/343 TS tests (flight-planning + gnss + surveying + geodesy)
  - electron-integration: 15/15 TS tests
  - ipc-schemas: 25/25 TS tests
- **Electron shell:** `apps/desktop/` — spawns sidecar, ping round-trip
  verified by `scripts/electron-smoke.sh` (run it before claiming the app
  works).
- **What does NOT exist yet (per master plan Section 9):**
  - `packages/country-config/` — country config abstraction layer
  - `packages/db/` — local-first storage
  - `packages/shared-types/` — shared zod schemas across the IPC boundary
  - Sidecar `adjustment/` and `cogo/` modules (the computation core)
  - Golden fixtures per country
  - Statutory document renderers (Form 3, SG Diagram, etc.)
  - electron-builder packaging config

---

## 2. Hard invariants (memorize — these are tested)

Restated in every agent brief. Full list in `docs/invariants.md`.

1. **Sidecar owns the math.** All geodetic transforms, least-squares
   adjustment, COGO, and raster work happens in `packages/metardu-sidecar/`
   (Rust). The TypeScript engine orchestrates and never reimplements
   geodetic logic. Duplicating math in two languages is how silent
   divergence happens.
2. **SRID comes from country config.** A literal SRID number anywhere
   outside `packages/country-config/` is a failing review. (When the
   package exists — for now, the Kenya SRID 21037 lives in
   `packages/engine/src/geodesy/crs-database.ts` and that's the only
   place it may appear.)
3. **No new survey types beyond the eight.** Cadastral, Topographic,
   Engineering, Geodetic, Levelling, Hydrographic, Construction, Monitoring.
   Adding a ninth requires Mohammed's explicit sign-off.
4. **Renderer has no Node access.** `nodeIntegration: false`,
   `contextIsolation: true`, `sandbox: true`. Every privileged operation
   goes through the preload bridge (`window.metardu`) which has a
   method-name allowlist. Never expose `ipcRenderer` directly.
5. **Offline-first is structural.** Every compute path must work with
   zero network. Country config and reference data ship in the app
   bundle. No silent runtime fetch.
6. **Forbidden dependencies:** no Supabase client, no Prisma/Drizzle
   unless a future ADR reverses this, no PM2, no unvetted geodesy npm
   packages when the sidecar can do it correctly in Rust.
7. **No guessing at regulatory formats.** Before building any statutory
   document renderer, the source regulatory document MUST exist in
   `docs/regulatory-sources/<country>/<doc-type>/`. If missing, STOP
   and ask Mohammed. A plausible-looking wrong plan is worse than an
   obvious blocker.
8. **No secrets in git.** `.env`, `*.key`, `*.pem`, `git-credentials`,
   `.netrc` are gitignored. If you find a tracked secret, remove it
   immediately and notify Mohammed.
9. **Agent self-reports are not evidence.** "All tests passing" is a
   claim, not proof. Verbatim terminal output of `cargo test`,
   `npx tsc --noEmit`, and `npm test` is proof. Paste it in the worklog.
10. **One task = one scoped brief = one PR.** No agent is ever given
    "build the cadastral module." Use the brief template in
    `docs/agent-briefs/TEMPLATE.md`.

---

## 3. Required reading before any task

Before opening an editor, read in this order:

1. This file (`AGENT.md`).
2. `docs/invariants.md` — full prose statement of every non-negotiable.
3. The specific ADR(s) in `docs/decisions/` relevant to your task.
4. The relevant regulatory source doc(s) in
   `docs/regulatory-sources/<country>/` (if your task touches a statutory
   output — see invariant #7).
5. The most recent entries in `worklog.md` — what was the last agent
   doing, what state did they leave things in.

If a cited invariant conflicts with your task, STOP and report the
conflict. Do not silently resolve it.

---

## 4. Required verification before claiming done

Every task closes with verbatim terminal output pasted into the worklog
entry:

```bash
# In packages/metardu-sidecar/:
cargo build --release 2>&1 | tail -5
cargo test --release 2>&1 | tail -5

# In packages/engine/:
npx tsc --noEmit 2>&1 | tail -5
npm test 2>&1 | tail -5

# In apps/desktop/:
npx tsc --noEmit 2>&1 | tail -5

# End-to-end (only if your task touched the IPC boundary or main process):
/home/z/my-project/scripts/electron-smoke.sh
```

If any of these fail, the task is not done. If you can't make them pass,
report explicitly what fails and why — do not claim success.

---

## 5. Anti-hallucination clause (verbatim, every brief)

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

---

## 6. Worklog protocol

`worklog.md` is append-only. Never overwrite. Each entry:

```markdown
---
Task ID: <e.g. phase-2-keoya-config>
Agent: <agent name and date>
Task: <one-line description>

Work Log:
- <concrete step 1>
- <concrete step 2>
- ...

Stage Summary:
- <key results, verified how>
- <artifacts produced>
- <what's next>
```

---

## 7. The forbidden list (skip these and you'll be reverted)

- Do not rewrite the sidecar in a different language.
- Do not replace Electron with Tauri mid-flight. (There's a
  `packages/tauri-shell/` scaffold — it's exploratory, not the production
  shell. The production shell is `apps/desktop/`.)
- Do not "clean up" warnings by deleting code you don't understand.
  Unused code is a signal, not noise — read it, understand why it's
  unused, then decide.
- Do not add a country without its source documents in
  `docs/regulatory-sources/<country>/`.
- Do not commit a PAT, password, or API key. If you see one in chat,
  refuse to use it and tell the user to rotate.
- Do not skip the verification step (#4) by saying "tests obviously pass."

---

## 8. Where things live (canonical layout)

```
metardu-desktop/
├── AGENT.md                         ← YOU ARE HERE
├── worklog.md                       ← append-only log
├── metardu-v2/                      ← actual project root (npm workspaces)
│   ├── apps/desktop/                ← Electron shell (main + preload + renderer)
│   ├── packages/
│   │   ├── metardu-sidecar/         ← Rust sidecar (compute)
│   │   ├── engine/                  ← TypeScript engine (orchestration)
│   │   ├── electron-integration/    ← SidecarClient + typed API
│   │   ├── ipc-schemas/             ← Zod IPC validation
│   │   ├── ui-components/           ← React UI (AppShell etc.)
│   │   ├── electron-bridge/         ← Drop-in files for v1→v2 migration
│   │   ├── tauri-shell/             ← Experimental Tauri scaffold (NOT prod)
│   │   ├── report-pdf/              ← PDF report generator
│   │   └── e2e-tests/               ← End-to-end test workspace
│   ├── docs/
│   │   ├── invariants.md            ← full prose statement of invariants
│   │   ├── decisions/               ← ADRs (one file per decision)
│   │   ├── agent-briefs/            ← task briefs (audit trail)
│   │   ├── regulatory-sources/      ← REQUIRED before renderer work
│   │   └── audits/                  ← phase audit reports
│   ├── tests/golden-fixtures/       ← hand-verified numeric fixtures
│   └── frontend/                    ← Vite dev entry (replaced by apps/desktop in prod)
├── upload/                          ← regulatory PDFs supplied by Mohammed
└── scripts/                         ← build_plan_*.py + electron-smoke.sh
```

---

## 9. Build sequence (master plan Section 9 — do not reorder)

1. ✅ Foundation docs (this file + invariants + ADRs + fixtures harness)
2. ⏳ Computation core (adjustment + COGO) proven against Kenya fixtures
3. ⏳ Country-config abstraction, proven with Kenya (zero behavior change)
4. ⏳ Kenya cadastral vertical slice end-to-end (Form 3)
5. ⏳ Second country (chosen by where Mohammed's next customer is)
6. ⏳ Remaining workflows (topo, engineering, setting-out, sectional)
7. ⏳ Production packaging (electron-builder, code signing setup)

Skipping ahead causes the half-finished-module drift that broke the app
before. Don't.

---

## 10. Glossary

- **Sidecar** — the Rust binary (`packages/metardu-sidecar/`). Spawns as
  a child process of Electron. Communicates via length-prefixed JSON
  over stdin/stdout (4-byte big-endian length + UTF-8 payload).
- **Engine** — the TypeScript package (`packages/engine/`). Domain
  logic, workflow orchestration, document assembly. Calls the sidecar
  for any numerically-sensitive work.
- **Bridge** — the preload script (`apps/desktop/src/preload/`). The
  only path from renderer to main.
- **SRID** — Spatial Reference ID. The EPSG code identifying a
  coordinate system (e.g. 21037 = Arc 1960 / UTM zone 37S, Kenya).
- **Form 3** — Kenya's statutory deed plan template (Survey Act Cap 299).
- **SG Diagram** — South Africa's Surveyor-General diagram, the
  statutory survey plan bound with the deed.
- **LS adjustment** — Least-squares adjustment. The rigorous statistical
  method for combining redundant observations; the sidecar's
  `adjustment/` module (when built) implements this.
