/**
 * useSurveyViewport — pan/zoom state + coordinate transform for SurveyCanvas.
 *
 * Extracted from SurveyCanvas so consumers can:
 *   - Programmatically pan to a point (flyTo)
 *   - Sync viewport across multiple canvases
 *   - Access the survey→pixel transform for tooltips / overlays
 *   - Reset view from outside the canvas
 *
 * # Deletion test
 *
 * Deleting this hook would force every consumer that needs programmatic
 * viewport control to reimplement pan/zoom state + bounds + transform —
 * concentrating complexity back into each consumer. The hook is the
 * shared seam for viewport management.
 */

import { useState, useCallback, useMemo, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────

export interface SurveyPointLike {
  easting: number;
  northing: number;
  elevation?: number;
}

export interface Bounds {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
  width: number;
  height: number;
}

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export type TransformFn = (easting: number, northing: number) => { x: number; y: number };

export interface UseSurveyViewportOptions {
  /** Canvas width in pixels. */
  canvasW: number;
  /** Canvas height in pixels. */
  canvasH: number;
  /** Padding fraction around data bounds (default: 0.1 = 10%). */
  padding?: number;
}

export interface UseSurveyViewportReturn {
  /** Current viewport state (pan offset + zoom level). */
  viewport: ViewportState;
  /** Computed data bounds (with padding). */
  bounds: Bounds;
  /** Transform survey coordinates to SVG pixel coordinates. */
  transform: TransformFn;
  /** Transform a survey point to pixel coordinates. */
  toPixel: (p: SurveyPointLike) => { x: number; y: number };
  /** Inverse transform: pixel coordinates to survey coordinates. */
  fromPixel: (x: number, y: number) => { easting: number; northing: number };
  /** Zoom by a factor (positive = zoom in, negative = zoom out). */
  zoomBy: (factor: number) => void;
  /** Pan by pixel offset. */
  panBy: (dx: number, dy: number) => void;
  /** Fly to a specific survey coordinate (animated or instant). */
  flyTo: (easting: number, northing: number, zoom?: number) => void;
  /** Reset to default viewport (fit all data). */
  resetView: () => void;
  /** Mouse wheel handler — attach to SVG. */
  onWheel: (e: { deltaY: number; preventDefault: () => void }) => void;
  /** Mouse down handler — attach to SVG. */
  onMouseDown: (e: { clientX: number; clientY: number }) => void;
  /** Mouse move handler — attach to SVG. */
  onMouseMove: (e: { clientX: number; clientY: number }) => void;
  /** Mouse up handler — attach to SVG. */
  onMouseUp: () => void;
  /** Whether the user is currently dragging. */
  isDragging: boolean;
  /** Pixels per metre at current zoom (useful for ellipse scaling, etc.). */
  pxPerMetre: number;
}

// ─── Defaults ─────────────────────────────────────────────────────

const DEFAULT_VIEWPORT: ViewportState = { panX: 0, panY: 0, zoom: 1 };

// ─── Bounds computation ───────────────────────────────────────────

export function computeDataBounds(
  allPoints: SurveyPointLike[],
  padding: number = 0.1,
): Bounds {
  let minE = Infinity, maxE = -Infinity;
  let minN = Infinity, maxN = -Infinity;

  for (const p of allPoints) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }

  if (minE === Infinity) {
    return { minE: 0, maxE: 100, minN: 0, maxN: 100, width: 100, height: 100 };
  }

  const w = maxE - minE;
  const h = maxN - minN;
  const padE = w * padding || 10;
  const padN = h * padding || 10;
  return {
    minE: minE - padE, maxE: maxE + padE,
    minN: minN - padN, maxN: maxN + padN,
    width: w + 2 * padE, height: h + 2 * padN,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useSurveyViewport(
  bounds: Bounds,
  options: UseSurveyViewportOptions,
): UseSurveyViewportReturn {
  const { canvasW, canvasH } = options;
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0, y: 0, panX: 0, panY: 0,
  });

  // Base transform (without pan/zoom)
  const baseTransform = useMemo(() => {
    const scaleE = canvasW / bounds.width;
    const scaleN = canvasH / bounds.height;
    const scale = Math.min(scaleE, scaleN);
    const contentW = bounds.width * scale;
    const contentH = bounds.height * scale;
    const offsetX = (canvasW - contentW) / 2;
    const offsetY = (canvasH - contentH) / 2;

    return (easting: number, northing: number): { x: number; y: number } => ({
      x: offsetX + (easting - bounds.minE) * scale,
      y: canvasH - (offsetY + (northing - bounds.minN) * scale),
    });
  }, [bounds, canvasW, canvasH]);

  // Full transform (with pan/zoom)
  const transform: TransformFn = useCallback(
    (easting, northing) => {
      const base = baseTransform(easting, northing);
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      return {
        x: cx + (base.x - cx) * viewport.zoom + viewport.panX,
        y: cy + (base.y - cy) * viewport.zoom + viewport.panY,
      };
    },
    [baseTransform, viewport, canvasW, canvasH],
  );

  const toPixel = useCallback(
    (p: SurveyPointLike) => transform(p.easting, p.northing),
    [transform],
  );

  // Inverse transform (pixel → survey)
  const fromPixel = useCallback(
    (px: number, py: number) => {
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      const baseX = (px - cx - viewport.panX) / viewport.zoom + cx;
      const baseY = (py - cy - viewport.panY) / viewport.zoom + cy;

      const scaleE = canvasW / bounds.width;
      const scaleN = canvasH / bounds.height;
      const scale = Math.min(scaleE, scaleN);
      const contentW = bounds.width * scale;
      const contentH = bounds.height * scale;
      const offsetX = (canvasW - contentW) / 2;
      const offsetY = (canvasH - contentH) / 2;

      return {
        easting: bounds.minE + (baseX - offsetX) / scale,
        northing: bounds.minN + (canvasH - baseY - offsetY) / scale,
      };
    },
    [bounds, viewport, canvasW, canvasH],
  );

  const pxPerMetre = useMemo(() => {
    const scaleE = canvasW / bounds.width;
    const scaleN = canvasH / bounds.height;
    return Math.min(scaleE, scaleN) * viewport.zoom;
  }, [bounds, canvasW, canvasH, viewport.zoom]);

  // ── Actions ───────────────────────────────────────────────────

  const zoomBy = useCallback((factor: number) => {
    setViewport((vp) => ({
      ...vp,
      zoom: Math.max(0.1, Math.min(50, vp.zoom * factor)),
    }));
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((vp) => ({ ...vp, panX: vp.panX + dx, panY: vp.panY + dy }));
  }, []);

  const flyTo = useCallback(
    (easting: number, northing: number, zoom?: number) => {
      const target = baseTransform(easting, northing);
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      setViewport({
        panX: cx - target.x,
        panY: cy - target.y,
        zoom: zoom ?? viewport.zoom,
      });
    },
    [baseTransform, canvasW, canvasH, viewport.zoom],
  );

  const resetView = useCallback(() => setViewport(DEFAULT_VIEWPORT), []);

  // ── Mouse handlers ────────────────────────────────────────────

  const onWheel = useCallback(
    (e: { deltaY: number; preventDefault: () => void }) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomBy(factor);
    },
    [zoomBy],
  );

  const onMouseDown = useCallback(
    (e: { clientX: number; clientY: number }) => {
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX, y: e.clientY,
        panX: viewport.panX, panY: viewport.panY,
      };
    },
    [viewport],
  );

  const onMouseMove = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setViewport((vp) => ({
        ...vp,
        panX: dragStart.current.panX + dx,
        panY: dragStart.current.panY + dy,
      }));
    },
    [isDragging],
  );

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  return {
    viewport, bounds, transform, toPixel, fromPixel,
    zoomBy, panBy, flyTo, resetView,
    onWheel, onMouseDown, onMouseMove, onMouseUp,
    isDragging, pxPerMetre,
  };
}
