# ADR-003 — CAD Canvas: OpenLayers in Electron BrowserView

**Status:** Accepted
**Date:** 2025-07-11
**Decision Maker:** Software Architect agent
**Phase:** 0 (Initiation)

## Context

METARDU's editing canvas is OpenLayers 10 with custom editing tools. A desktop
CAD app needs precise panning, zooming, snapping, and feature editing on tens
of thousands of geometries.

## Decision

**Keep OpenLayers 10 running inside the Electron renderer (BrowserView).**

## Consequences

**Positive:**
- We reuse all 345 React components and the entire OpenLayers editing stack
  verbatim.
- For 2D survey plans (parcels, traverses, contours) OpenLayers is more than
  sufficient.
- Three.js (already in METARDU for 3D TIN visualisation) handles dense point
  clouds.
- WebGL acceleration is built-in.
- Familiar API for our team — no new framework to learn.

**Negative:**
- For very large point clouds (>500k points) we may need to add a binary spatial
  index on top of OpenLayers. Profiling will tell us in v1.1.
- Canvas rendering is not as fast as a native QGraphicsView, but it's faster
  than the web app version because there's no HTTP round-trip for tile fetches
  (we use local mbtiles).

## Alternatives Considered

- **QGraphicsView (PySide6)**: Best 2D CAD performance, but requires a Python
  rewrite of the entire UI layer. Rejected per ADR-001.
- **Custom Skia canvas**: Best performance, but a 6-month rewrite with no
  immediate user benefit.
- **WebView2 + Canvas 2D**: Identical to what we're doing, but with more manual
  work. No advantage.

## Performance Strategy

1. v1.0: Ship OpenLayers as-is. Profile against real surveyor workloads.
2. v1.1: If a real surveyor hits a real wall (>500k points or >10k parcels in
   a single project), add a Worker-based spatial index.
3. v2.0: Only if profiling shows OpenLayers is the bottleneck, consider a
   native canvas overlay for the active editing layer only.

## References

- METARDU Desktop Master Plan §5
- OpenLayers 10 docs: https://openlayers.org/
