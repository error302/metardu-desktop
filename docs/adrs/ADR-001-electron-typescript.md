# ADR-001 — Desktop Stack: Electron + TypeScript

**Status:** Accepted
**Date:** 2025-07-11
**Decision Maker:** Software Architect agent
**Phase:** 0 (Initiation)

## Context

METARDU is a 400,000-LOC TypeScript application. Reusing it verbatim requires a
desktop stack that runs TypeScript natively. Four candidates were considered:

| Stack | Reuse | Binary Size | CAD Canvas | Time to v1.0 |
|-------|-------|-------------|------------|--------------|
| Electron + TS | ~95% | ~150 MB | OpenLayers + Three.js | 9 months |
| Tauri + TS | ~90% | ~10 MB | WebView canvas | 11 months |
| PySide6/Qt | 0% (port) | ~60 MB | QGraphicsView (best) | 15–18 months |
| .NET Avalonia | 0% (port) | ~80 MB | SkiaSharp | 15–18 months |

## Decision

**Adopt Electron + TypeScript.**

## Consequences

**Positive:**
- ~95% of METARDU's TypeScript libraries can be lifted verbatim into
  `packages/engine/` with zero code changes.
- Fastest path to v1.0 (9 months).
- The 345 React components and the OpenLayers editing stack are reusable as-is.
- Mature ecosystem: electron-builder, electron-updater, electron-notarize.

**Negative:**
- Binary size ~150 MB (vs Tauri's ~10 MB).
- Chromium memory footprint.
- Security model requires careful contextBridge isolation.

**Neutral:**
- Single-language codebase (TypeScript everywhere) — easier onboarding.

## Alternatives Considered

- **Tauri**: Stronger security model and smaller binary, but the Rust↔TS bridge
  doubles glue code and adds 2 months to the timeline. Reconsider for v2.0
  if binary size becomes a competitive disadvantage.
- **PySide6/Qt**: Best 2D CAD canvas (QGraphicsView), but requires porting
  400k LOC from TypeScript to Python — a 6–9 month penalty.
- **.NET Avalonia**: Strong GIS ecosystem (NetTopologySuite, ProjNet) but
  zero library reuse from METARDU.

## References

- METARDU Desktop Master Plan §5
- electron-builder docs: https://www.electron.build/
- Original evaluation thread: docs/gates/phase-0-decision.md
