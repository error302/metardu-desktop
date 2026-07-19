/**
 * SurveyCanvas — lightweight SVG-based canvas for survey plan visualization.
 *
 * Renders TIN, contours, boundaries, beacons, spot heights, and labels
 * as pure SVG. No external dependencies (no Leaflet, no MapLibre, no
 * canvas API) — just React + SVG, which means:
 *
 *   - Zero bundle size impact (SVG is native to the browser)
 *   - Crisp at any zoom level (vector, not raster)
 *   - Printable (SVG prints perfectly; canvas doesn't always)
 *   - Selectable (users can select text labels; canvas text is not)
 *
 * # When to use this vs a full map library
 *
 * Use SurveyCanvas when:
 *   - You're drawing survey geometry (TIN, contours, boundaries, beacons)
 *   - You don't need a street/satellite basemap
 *   - You want the smallest possible bundle
 *
 * Use OpenLayers/MapLibre (future) when:
 *   - You need to overlay the parcel on satellite imagery
 *   - You need WMS/WMTS tile services
 *   - You need coordinate system reprojection on the fly
 *
 * # Pan + zoom
 *
 * Built-in mouse-wheel zoom + drag-pan. No external gesture library.
 * The viewport transform is applied to the computed coordinates, keeping
 * the SVG lightweight.
 *
 * # Coordinate system
 *
 * Survey coordinates (easting/northing in metres) are transformed to
 * SVG screen coordinates (pixels) via a linear transform computed
 * from the data bounds + the available canvas size. The transform
 * preserves aspect ratio (no skew).
 */

import React, { useState, useRef, useCallback, useMemo, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from "react";

// ─── Types ───────────────────────────────────────────────────────

export interface SurveyPoint {
  easting: number;
  northing: number;
  elevation?: number;
  label?: string;
}

export interface SurveyLine {
  from: SurveyPoint;
  to: SurveyPoint;
  color?: string;
  width?: number;
  dashed?: boolean;
}

export interface SurveyPolygon {
  points: SurveyPoint[];
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  label?: string;
}

export interface SurveyContour {
  elevation: number;
  coordinates: [number, number][]; // [easting, northing] pairs
  color?: string;
}

export interface SurveyTriangle {
  a: SurveyPoint;
  b: SurveyPoint;
  c: SurveyPoint;
}

export interface SurveyCanvasProps {
  width?: number | string;
  height?: number;
  points?: SurveyPoint[];
  lines?: SurveyLine[];
  polygons?: SurveyPolygon[];
  contours?: SurveyContour[];
  triangles?: SurveyTriangle[];
  spotHeights?: SurveyPoint[];
  backgroundColor?: string;
  showGrid?: boolean;
  gridSpacing?: number;
  showNorthArrow?: boolean;
  showScaleBar?: boolean;
  showPointLabels?: boolean;
  title?: string;
}

// ─── Viewport state ──────────────────────────────────────────────

interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

const DEFAULT_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 };

// ─── Bounds + transform ──────────────────────────────────────────

interface Bounds {
  minE: number; maxE: number;
  minN: number; maxN: number;
  width: number; height: number;
}

function computeBounds(
  points: SurveyPoint[],
  lines: SurveyLine[],
  polygons: SurveyPolygon[],
  contours: SurveyContour[],
  triangles: SurveyTriangle[],
): Bounds {
  let minE = Infinity, maxE = -Infinity;
  let minN = Infinity, maxN = -Infinity;

  const expand = (e: number, n: number) => {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };

  for (const p of points) expand(p.easting, p.northing);
  for (const l of lines) { expand(l.from.easting, l.from.northing); expand(l.to.easting, l.to.northing); }
  for (const poly of polygons) for (const p of poly.points) expand(p.easting, p.northing);
  for (const c of contours) for (const [e, n] of c.coordinates) expand(e, n);
  for (const t of triangles) { expand(t.a.easting, t.a.northing); expand(t.b.easting, t.b.northing); expand(t.c.easting, t.c.northing); }

  if (minE === Infinity) {
    return { minE: 0, maxE: 100, minN: 0, maxN: 100, width: 100, height: 100 };
  }

  const w = maxE - minE;
  const h = maxN - minN;
  const padE = w * 0.1 || 10;
  const padN = h * 0.1 || 10;
  return {
    minE: minE - padE, maxE: maxE + padE,
    minN: minN - padN, maxN: maxN + padN,
    width: w + 2 * padE, height: h + 2 * padN,
  };
}

function makeBaseTransform(bounds: Bounds, canvasW: number, canvasH: number) {
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
}

// ─── Component ───────────────────────────────────────────────────

export const SurveyCanvas: React.FC<SurveyCanvasProps> = ({
  width = "100%",
  height = 500,
  points = [],
  lines = [],
  polygons = [],
  contours = [],
  triangles = [],
  spotHeights = [],
  backgroundColor = "#0a0a0a",
  showGrid = true,
  gridSpacing,
  showNorthArrow = true,
  showScaleBar = true,
  showPointLabels = false,
  title,
}) => {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  const canvasW = typeof width === "number" ? width : 800;
  const canvasH = height;

  const bounds = useMemo(
    () => computeBounds(points, lines, polygons, contours, triangles),
    [points, lines, polygons, contours, triangles],
  );

  const baseTransform = useMemo(
    () => makeBaseTransform(bounds, canvasW, canvasH),
    [bounds, canvasW, canvasH],
  );

  const transform = useCallback(
    (easting: number, northing: number): { x: number; y: number } => {
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

  const onWheel = useCallback((e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setViewport((vp) => ({
      ...vp,
      zoom: Math.max(0.1, Math.min(50, vp.zoom * factor)),
    }));
  }, []);

  const onMouseDown = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: viewport.panX, panY: viewport.panY };
  }, [viewport]);

  const onMouseMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setViewport((vp) => ({
      ...vp,
      panX: dragStart.current.panX + dx,
      panY: dragStart.current.panY + dy,
    }));
  }, [isDragging]);

  const onMouseUp = useCallback(() => setIsDragging(false), []);
  const resetView = useCallback(() => setViewport(DEFAULT_VIEWPORT), []);

  // Grid lines
  const gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (showGrid) {
    const spacing = gridSpacing ?? Math.max(bounds.width, bounds.height) / 10;
    const startE = Math.ceil(bounds.minE / spacing) * spacing;
    const startN = Math.ceil(bounds.minN / spacing) * spacing;
    for (let e = startE; e <= bounds.maxE; e += spacing) {
      const p1 = transform(e, bounds.minN);
      const p2 = transform(e, bounds.maxN);
      gridLines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
    for (let n = startN; n <= bounds.maxN; n += spacing) {
      const p1 = transform(bounds.minE, n);
      const p2 = transform(bounds.maxE, n);
      gridLines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
  }

  return (
    <div style={{ position: "relative", width: typeof width === "string" ? width : `${width}px`, height: `${height}px` }}>
      <svg
        width={width}
        height={height}
        style={{ backgroundColor, cursor: isDragging ? "grabbing" : "grab", display: "block" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Grid */}
        {showGrid && gridLines.map((g, i) => (
          <line key={`grid-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
            stroke="#1a1a1a" strokeWidth={0.5} />
        ))}

        {/* TIN triangles */}
        {triangles.map((tri, i) => {
          const a = transform(tri.a.easting, tri.a.northing);
          const b = transform(tri.b.easting, tri.b.northing);
          const c = transform(tri.c.easting, tri.c.northing);
          return (
            <g key={`tri-${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#333" strokeWidth={0.5} />
              <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} stroke="#333" strokeWidth={0.5} />
              <line x1={c.x} y1={c.y} x2={a.x} y2={a.y} stroke="#333" strokeWidth={0.5} />
            </g>
          );
        })}

        {/* Contours */}
        {contours.map((contour, ci) => {
          const color = contour.color ?? "#22c55e";
          const elems: React.ReactElement[] = [];
          for (let i = 0; i < contour.coordinates.length - 1; i += 2) {
            const a = transform(contour.coordinates[i]![0], contour.coordinates[i]![1]);
            const b = contour.coordinates[i + 1];
            if (!b) break;
            const bp = transform(b[0], b[1]);
            elems.push(
              <line key={`c-${ci}-${i}`} x1={a.x} y1={a.y} x2={bp.x} y2={bp.y}
                stroke={color} strokeWidth={1} />
            );
          }
          if (contour.coordinates.length > 0) {
            const first = transform(contour.coordinates[0]![0], contour.coordinates[0]![1]);
            elems.push(
              <text key={`cl-${ci}`} x={first.x + 3} y={first.y - 3}
                fill={color} fontSize={9} fontFamily="monospace">
                {contour.elevation.toFixed(1)}
              </text>
            );
          }
          return <g key={`cg-${ci}`}>{elems}</g>;
        })}

        {/* Polygons */}
        {polygons.map((poly, pi) => {
          if (poly.points.length < 2) return null;
          const pts = poly.points.map((p) => transform(p.easting, p.northing));
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
          return (
            <g key={`poly-${pi}`}>
              <path d={path}
                fill={poly.fillColor ?? "none"}
                stroke={poly.strokeColor ?? "#FF9500"}
                strokeWidth={poly.strokeWidth ?? 2} />
              {poly.label && pts[0] && (
                <text x={pts[0]!.x + 5} y={pts[0]!.y - 5}
                  fill="#FF9500" fontSize={11} fontFamily="monospace" fontWeight="bold">
                  {poly.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Lines */}
        {lines.map((line, i) => {
          const a = transform(line.from.easting, line.from.northing);
          const b = transform(line.to.easting, line.to.northing);
          return (
            <line key={`line-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={line.color ?? "#FF9500"}
              strokeWidth={line.width ?? 1.5}
              strokeDasharray={line.dashed ? "5,3" : undefined} />
          );
        })}

        {/* Points (beacons) */}
        {points.map((p, i) => {
          const pos = transform(p.easting, p.northing);
          return (
            <g key={`pt-${i}`}>
              <circle cx={pos.x} cy={pos.y} r={3}
                fill="#FF9500" stroke="#fff" strokeWidth={1} />
              {showPointLabels && p.label && (
                <text x={pos.x + 5} y={pos.y - 5}
                  fill="#2dd4bf" fontSize={10} fontFamily="monospace">
                  {p.label}
                </text>
              )}
              {showPointLabels && p.elevation !== undefined && (
                <text x={pos.x + 5} y={pos.y + 12}
                  fill="#a3a3a3" fontSize={9} fontFamily="monospace">
                  +{p.elevation.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {/* Spot heights */}
        {spotHeights.map((sh, i) => {
          const pos = transform(sh.easting, sh.northing);
          const s = 4;
          return (
            <g key={`sh-${i}`}>
              <line x1={pos.x - s} y1={pos.y} x2={pos.x + s} y2={pos.y}
                stroke="#2dd4bf" strokeWidth={1} />
              <line x1={pos.x} y1={pos.y - s} x2={pos.x} y2={pos.y + s}
                stroke="#2dd4bf" strokeWidth={1} />
              {sh.elevation !== undefined && (
                <text x={pos.x + 5} y={pos.y + 3}
                  fill="#2dd4bf" fontSize={9} fontFamily="monospace">
                  +{sh.elevation.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {/* North arrow */}
        {showNorthArrow && (() => {
          const ax = canvasW - 40;
          const ay = 30;
          const sz = 20;
          return (
            <g>
              <line x1={ax} y1={ay} x2={ax} y2={ay - sz} stroke="#fff" strokeWidth={1.5} />
              <line x1={ax - 4} y1={ay - sz + 5} x2={ax} y2={ay - sz} stroke="#fff" strokeWidth={1.5} />
              <line x1={ax + 4} y1={ay - sz + 5} x2={ax} y2={ay - sz} stroke="#fff" strokeWidth={1.5} />
              <text x={ax - 4} y={ay - sz - 3} fill="#fff" fontSize={12} fontFamily="monospace" fontWeight="bold">N</text>
            </g>
          );
        })()}

        {/* Scale bar */}
        {showScaleBar && (() => {
          const bx = 20;
          const by = canvasH - 25;
          const pxPerM = canvasW / bounds.width / viewport.zoom;
          const targetM = 100 / pxPerM;
          const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetM, 0.1))));
          const niceLength = Math.round(targetM / magnitude) * magnitude;
          const barLengthPx = niceLength * pxPerM;
          return (
            <g>
              <line x1={bx} y1={by} x2={bx + barLengthPx} y2={by} stroke="#fff" strokeWidth={2} />
              <line x1={bx} y1={by - 4} x2={bx} y2={by + 4} stroke="#fff" strokeWidth={1} />
              <line x1={bx + barLengthPx} y1={by - 4} x2={bx + barLengthPx} y2={by + 4} stroke="#fff" strokeWidth={1} />
              <text x={bx} y={by + 16} fill="#a3a3a3" fontSize={10} fontFamily="monospace">0</text>
              <text x={bx + barLengthPx - 15} y={by + 16} fill="#a3a3a3" fontSize={10} fontFamily="monospace">{niceLength}m</text>
            </g>
          );
        })()}

        {/* Title */}
        {title && (
          <text x={15} y={20} fill="#FF9500" fontSize={13} fontFamily="monospace" fontWeight="bold">{title}</text>
        )}
      </svg>

      {/* Reset view button */}
      <button
        onClick={resetView}
        style={{
          position: "absolute", top: 8, right: 8,
          padding: "4px 8px", fontSize: 11, fontFamily: "monospace",
          background: "var(--bg-tertiary)", color: "var(--text-secondary)",
          border: "1px solid var(--border-default)", cursor: "pointer",
        }}
      >
        Reset View
      </button>

      {/* Zoom indicator */}
      <div style={{
        position: "absolute", bottom: 8, right: 8,
        padding: "2px 6px", fontSize: 10, fontFamily: "monospace",
        color: "var(--text-tertiary)",
      }}>
        Zoom: {viewport.zoom.toFixed(2)}×
      </div>
    </div>
  );
};
