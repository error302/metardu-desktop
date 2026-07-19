# ADR-0001: Rust sidecar + TypeScript engine + Electron shell

**Status:** Accepted (locked, do not re-litigate)
**Date:** 19 Jul 2026 (formalized; architecture predates this ADR)
**Supersedes:** None
**Superseded by:** None

## Context

The previous web-app architecture (`metardu` / metardu.duckdns.org) used
Supabase + Leaflet + Prisma. It worked but had three structural problems:

1. **Cloud dependency.** Surveyors in rural Kenya (and rural Australia,
   rural UK field sites, etc.) cannot rely on connectivity.
2. **Python compute via PyInstaller.** Worked but produced huge binaries
   with fragile packaging, and Python's float behavior across versions
   was a recurring source of subtle numeric drift.
3. **Frontend/backend split.** Every regulatory computation needed a
   server round-trip, which is both slow and a deployment liability.

The desktop pivot (this repo) was specifically created to escape those
constraints.

## Decision

Adopt the three-layer architecture from master plan Section 2:

```
┌────────────────────────────────────────────┐
│  Electron main (apps/desktop/src/main/)    │  ← process host, IPC broker
├────────────────────────────────────────────┤
│  Renderer (React UI, Vite-built)           │  ← pure web environment
│    ↕ window.metardu (preload bridge)       │
├────────────────────────────────────────────┤
│  Sidecar (Rust binary, spawned as child)   │  ← numerically-sensitive compute
│    ↕ stdin/stdout length-prefixed JSON     │
├────────────────────────────────────────────┤
│  Engine (TypeScript package)               │  ← orchestration, document assembly
└────────────────────────────────────────────┘
```

## Rationale

- **Rust sidecar** for math: strong typing, no GIL, deterministic
  floating-point, mature geodesy crates (`proj` bindings, `gdal` crate),
  small statically-linked binaries.
- **TypeScript engine** for orchestration: same language as the UI,
  faster iteration on workflow logic, calls sidecar for any numerically
  sensitive work.
- **Electron** for the shell: mature, cross-platform, mature
  sandbox/isolation primitives, supports the React UI we already have.
- **Length-prefixed JSON over stdio** for IPC: trivial to debug, no port
  conflicts, no serialization library mismatch risk, works the same in
  dev and packaged.

## Alternatives considered

- **Tauri instead of Electron.** Smaller binaries, native webview. But:
  the Rust sidecar architecture is independent of the shell, and
  Electron's sandbox model is more mature. A `packages/tauri-shell/`
  scaffold exists for future exploration but is NOT the production
  shell. Switching would require its own ADR.
- **All-Rust (skip the TypeScript engine).** Rejected: workflow logic
  changes much faster than math, and TypeScript iteration speed wins
  there. The split is deliberate.
- **All-TypeScript (skip the Rust sidecar).** Rejected: floating-point
  determinism, geodesy crate ecosystem, and packaging size all favor
  Rust for the math layer.
- **Python compute via PyInstaller.** Rejected: binary size, packaging
  fragility, numeric drift across Python versions.

## Consequences

- Two languages to maintain (Rust + TypeScript). Acceptable: the
  boundary is sharp (math on one side, orchestration on the other) and
  validated by zod/Serde.
- Sidecar binary must be packaged into the Electron app bundle.
  electron-builder will copy it to `resources/` and the main process
  will resolve it from `process.resourcesPath` in production.
- Every renderer→compute call crosses three process boundaries
  (renderer → preload → main → sidecar). Latency is acceptable for
  non-real-time work; for true real-time (live GNSS stakeout), we'll
  need a sidecar push channel (future ADR).

## Verification

This ADR is realized by:
- `apps/desktop/src/main/index.ts` — Electron main spawns sidecar.
- `packages/electron-integration/src/SidecarClient` — RPC client.
- `apps/desktop/src/preload/index.ts` — contextBridge with allowlist.
- `scripts/electron-smoke.sh` — end-to-end smoke test.

The smoke test must pass before any PR touching the IPC boundary is merged.
