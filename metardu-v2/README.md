<div align="center">

<img src="brand/metardu-logo.jpeg" alt="MetaRDU Logo" width="200" />

# MetaRDU Desktop

**Multi-country survey automation platform — local-first, offline-capable, regulation-aware.**

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-442%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Phase](https://img.shields.io/badge/phase-3%20of%209-orange)]()

</div>

---

## What this is

MetaRDU Desktop is a desktop application for **post-field-data survey
automation** — what a surveyor does after leaving the field. It covers
five workflow families:

- **Topographic** — drone/field-data import, TIN, contours, plans
- **Cadastral** — boundary re-establishment, adjustment, Form 3 / SG
  Diagram / deed plan generation
- **Engineering** — cross-sections, volumes, alignment/chainage
- **Construction Setting-Out** — design import, stakeout, as-built QC
- **Sectional Properties** — sectional title / strata / condominium plans

Target jurisdictions: **Kenya** (reference implementation) → Australia →
United Kingdom → South Africa → United Arab Emirates.

## Architecture (locked — see [ADR-0001](metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md))

```
┌────────────────────────────────────────────────┐
│  Electron main (apps/desktop/)                 │  ← process host, IPC broker
├────────────────────────────────────────────────┤
│  Renderer (React UI, Vite-built)               │  ← pure web sandbox
│    ↕ window.metardu (preload bridge, allowlist) │
├────────────────────────────────────────────────┤
│  Engine (TypeScript, packages/engine/)         │  ← orchestration, documents
├────────────────────────────────────────────────┤
│  Sidecar (Rust, packages/metardu-sidecar/)     │  ← numerically-sensitive compute
│    ↕ stdin/stdout length-prefixed JSON         │
└────────────────────────────────────────────────┘
```

**Why this way:** the sidecar owns all geodetic math (deterministic
floats, mature Rust crates, small binary). The engine orchestrates but
never reimplements math. The renderer is sandboxed — no Node access,
no direct filesystem, no network. Every privileged operation goes
through a curated preload bridge.

## Quickstart

```bash
# Prerequisites: Node 20+, Rust 1.97+, libgdal-dev, libclang

# Install all workspace deps
cd metardu-v2
npm install

# Build the sidecar
npm run build:sidecar

# Build the engine + ipc-schemas + electron-integration (for the desktop shell to import)
npm run build --workspaces

# Build the renderer (Vite)
npm run build:renderer

# Run the Electron app (headless smoke test)
/home/z/my-project/scripts/electron-smoke.sh

# Or run all tests
npm test --workspaces
cd packages/metardu-sidecar && cargo test --release
cd ../../tests && npx vitest run
```

## Current state (verified 19 Jul 2026)

| Layer | Status |
|-------|--------|
| Sidecar (Rust) | ✅ 51 tests passing, `cargo build --release` clean |
| Engine (TypeScript) | ✅ 343 tests passing, `tsc --noEmit` 0 errors |
| Electron shell | ✅ Spawns sidecar, ping round-trip verified |
| IPC schemas | ✅ 25 tests passing, 5 namespaces |
| Electron-integration | ✅ 15 tests passing |
| Golden fixtures | ✅ 8 tests passing (Kenya Helmert, projection, levelling) |
| Electron smoke | ✅ PASSED |
| Foundation docs | ✅ AGENT.md, invariants.md, 4 ADRs, brief template |
| Country-config | ⏳ Phase 5 |
| Computation core (adjustment + COGO) | ⏳ Phase 4 |
| Form 3 renderer | ⏳ Phase 6 |
| Production packaging | ⏳ Phase 7 |

## Reading order for new agents

1. **`AGENT.md`** — operating manual (257 lines, every agent reads first)
2. **`metardu-v2/docs/invariants.md`** — 23 hard invariants
3. **`metardu-v2/docs/plan/RECOVERY-AND-PRODUCTION-PLAN.md`** — the 7-phase plan
4. **`metardu-v2/docs/decisions/`** — ADRs (0001–0004 so far)
5. **`worklog.md`** — append-only log of every phase
6. **`upload/METARDU-DESKTOP-MASTER-PLAN.md`** — the controlling master plan

## The non-negotiable rule

> **Never guess at a regulatory format.** Before building any statutory
> document renderer (deed plan, mutation plan, SG diagram, sectional
> title plan, etc.), the source regulatory document MUST exist in
> `docs/regulatory-sources/<country>/<doc-type>/`. If it doesn't, STOP
> and ask. A plausible-looking wrong plan is worse than an obvious
> blocker.

This is master plan Section 3, restated in `AGENT.md` and
`docs/invariants.md`. It is the single highest-leverage rule in this
entire project.

## License

MIT — see `LICENSE` (TODO: Phase 7 will add the file).

## Owner

Mohammed ([@error302](https://github.com/error302))
