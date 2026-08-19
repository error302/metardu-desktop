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
 * # Pan + zoom
 *
 * Built-in mouse-wheel zoom + drag-pan. No external gesture library.
 * The viewport transform is applied to the computed coordinates, keeping
 * the SVG lightweight.
 *
 * # Contour generation
 *
 * Pass `contourInterval` (e.g. 0.5 for 50cm contours) to auto-generate
 * contours from points that have `elevation` values. The engine runs
 * Delaunay triangulation → marching triangles → segment chaining to
 * produce smooth contour polylines with index contour highlighting.
 *
 * # Coordinate system
 *
 * Survey coordinates (easting/northing in metres) are transformed to
 * SVG screen coordinates (pixels) via a linear transform computed
 * from the data bounds + the available canvas size. The transform
 * preserves aspect ratio (no skew).
 */

import React, { useState, useRef, useCallback, useMemo, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  generateContours,
  computeIndexElevations,
  contourColor,
  type ContourInputPoint,
  type ContourLine,
} from "./contour-generation.js";

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

export interface SurveyEllipse {
  center: SurveyPoint;
  semiMajor: number;  // metres
  semiMinor: number;  // metres
  azimuthDeg: number; // clockwise from north
  color?: string;
  label?: string;
}

export interface SurveyContour {
  elevation: number;
  coordinates: [number, number][]; // [easting, northing] pairs
  color?: string;
  /** Whether the contour forms a closed loop. */
  closed?: boolean;
  /** Index contours are drawn thicker and labeled. */
  index?: boolean;
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
  ellipses?: SurveyEllipse[];
  backgroundColor?: string;
  showGrid?: boolean;
  gridSpacing?: number;
  showNorthArrow?: boolean;
  showScaleBar?: boolean;
  showPointLabels?: boolean;
  title?: string;
  /**
   * Auto-generate contours from points with elevation values at this interval.
   * E.g. 0.5 = 50cm contours, 1.0 = 1m contours. Overrides `contours` prop
   * when points have elevation data.
   */
  contourInterval?: number;
  /**
   * Index contour multiplier. Every Nth contour is drawn thicker and labeled.
   * Default: 5 (e.g. for 0.5m interval → 2.5m index contours).
   */
  indexMultiplier?: number;
  /** Show auto-generated TIN triangles. Default: false. */
  showTin?: boolean;
  /** Show contour labels (elevation values along contour lines). Default: true. */
  showContourLabels?: boolean;
  /** Show a legend row for contour symbology. Default: true. */
  showContourLegend?: boolean;
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
  ellipses?: SurveyEllipse[],
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
  if (ellipses) for (const el of ellipses) {
    const maxR = Math.max(el.semiMajor, el.semiMinor);
    expand(el.center.easting - maxR * 1.5, el.center.northing - maxR * 1.5);
    expand(el.center.easting + maxR * 1.5, el.center.northing + maxR * 1.5);
  }

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

// ─── Contour Label Placement ─────────────────────────────────────

/**
 * Pick positions along a polyline for elevation labels.
 * Returns up to N evenly-spaced label positions.
 */
function pickLabelPositions(
  coords: [number, number][],
  maxLabels: number,
): number[] {
  if (coords.length < 2) return [0];

  // Compute total length.
  let totalLen = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i]![0] - coords[i - 1]![0];
    const dy = coords[i]![1] - coords[i - 1]![1];
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }

  if (totalLen < 1e-6) return [0];

  const spacing = totalLen / (maxLabels + 1);
  const positions: number[] = [];
  let accumulated = 0;
  let nextTarget = spacing;

  for (let i = 1; i < coords.length && positions.length < maxLabels; i++) {
    const dx = coords[i]![0] - coords[i - 1]![0];
    const dy = coords[i]![1] - coords[i - 1]![1];
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const segEnd = accumulated + segLen;

    while (nextTarget <= segEnd && positions.length < maxLabels) {
      const t = segLen > 1e-9 ? (nextTarget - accumulated) / segLen : 0;
      positions.push(i - 1 + t); // fractional index into coords
      nextTarget += spacing;
    }

    accumulated = segEnd;
  }

  return positions.length > 0 ? positions : [Math.floor(coords.length / 2)];
}

// ─── Component ───────────────────────────────────────────────────

export const SurveyCanvas: React.FC<SurveyCanvasProps> = ({
  width = "100%",
  height = 500,
  points = [],
  lines = [],
  polygons = [],
  contours: explicitContours = [],
  triangles: explicitTriangles = [],
  spotHeights = [],
  ellipses = [],
  backgroundColor = "#0a0a0a",
  showGrid = true,
  gridSpacing,
  showNorthArrow = true,
  showScaleBar = true,
  showPointLabels = false,
  title,
  contourInterval,
  indexMultiplier = 5,
  showTin = false,
  showContourLabels = true,
  showContourLegend = true,
}) => {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  const canvasW = typeof width === "number" ? width : 800;
  const canvasH = height;

  // ─── Auto-generate contours from point elevations ────────────
  const autoContours = useMemo(() => {
    if (!contourInterval || contourInterval <= 0) return null;

    // Collect points with elevation data.
    const elevPoints: ContourInputPoint[] = points
      .filter((p) => p.elevation !== undefined && p.elevation !== null)
      .map((p) => ({
        easting: p.easting,
        northing: p.northing,
        elevation: p.elevation!,
      }));

    if (elevPoints.length < 3) return null;

    return generateContours(elevPoints, {
      interval: contourInterval,
      indexMultiplier,
    });
  }, [points, contourInterval, indexMultiplier]);

  // ─── Merge explicit + auto contours ──────────────────────────
  const allContours: SurveyContour[] = useMemo(() => {
    if (autoContours) {
      // Auto-generated contours take precedence.
      return autoContours.contours.map((c) => ({
        elevation: c.elevation,
        coordinates: c.coordinates,
        index: false, // will be set below
      }));
    }
    return explicitContours;
  }, [autoContours, explicitContours]);

  // ─── Index contour elevations ────────────────────────────────
  const indexElevations = useMemo(() => {
    if (!contourInterval || contourInterval <= 0 || !autoContours) {
      // For explicit contours, index if `index` prop is set.
      return new Set<number>();
    }
    return computeIndexElevations(
      autoContours.minElevation,
      autoContours.maxElevation,
      contourInterval,
      indexMultiplier,
    );
  }, [contourInterval, indexMultiplier, autoContours]);

  // ─── Auto-generated TIN triangles ────────────────────────────
  const allTriangles: SurveyTriangle[] = useMemo(() => {
    if (autoContours && showTin) {
      const { vertices, triangles } = autoContours;
      return triangles.map(([ai, bi, ci]) => ({
        a: vertices[ai]!,
        b: vertices[bi]!,
        c: vertices[ci]!,
      }));
    }
    return explicitTriangles;
  }, [autoContours, showTin, explicitTriangles]);

  const bounds = useMemo(
    () => computeBounds(points, lines, polygons, allContours, allTriangles, ellipses),
    [points, lines, polygons, allContours, allTriangles, ellipses],
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
        {allTriangles.map((tri, i) => {
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

        {/* Contours — rendered as smooth SVG polylines */}
        {allContours.map((contour, ci) => {
          if (contour.coordinates.length < 2) return null;

          const isIndex = contour.index ?? indexElevations.has(Math.round(contour.elevation * 1000) / 1000);
          const color = contour.color ?? contourColor(
            contour.elevation,
            indexElevations,
            autoContours?.minElevation ?? bounds.minN,
            autoContours?.maxElevation ?? bounds.maxN,
          );

          const strokeWidth = isIndex ? 2.0 : 1.0;
          const opacity = isIndex ? 1.0 : 0.75;

          // Build SVG path
          const pathParts = contour.coordinates.map((coord, i) => {
            const pt = transform(coord[0], coord[1]);
            return `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
          });
          const pathD = pathParts.join(" ") + (contour.closed ? " Z" : "");

          // Label positions
          const labels: React.ReactElement[] = [];
          if (showContourLabels && isIndex && contour.coordinates.length >= 2) {
            const positions = pickLabelPositions(contour.coordinates, 3);
            for (let li = 0; li < positions.length; li++) {
              const idx = positions[li]!;
              const floorIdx = Math.floor(idx);
              const frac = idx - floorIdx;
              const c1 = contour.coordinates[Math.min(floorIdx, contour.coordinates.length - 1)]!;
              const c2 = contour.coordinates[Math.min(floorIdx + 1, contour.coordinates.length - 1)]!;
              const px = c1[0] + frac * (c2[0] - c1[0]);
              const py = c1[1] + frac * (c2[1] - c1[1]);
              const pt = transform(px, py);
              labels.push(
                <text
                  key={`cl-${ci}-${li}`}
                  x={pt.x + 2}
                  y={pt.y - 3}
                  fill={color}
                  fontSize={9}
                  fontFamily="monospace"
                  fontWeight="bold"
                  stroke={backgroundColor}
                  strokeWidth={2}
                  paintOrder="stroke"
                >
                  {contour.elevation.toFixed(1)}
                </text>
              );
            }
          }

          return (
            <g key={`cg-${ci}`}>
              <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {labels}
            </g>
          );
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

        {/* Error ellipses */}
        {ellipses.map((el, i) => {
          const c = transform(el.center.easting, el.center.northing);
          const azimuthRad = (el.azimuthDeg * Math.PI) / 180;
          // SVG ellipse rotation is clockwise from x-axis; survey azimuth is clockwise from north
          const svgRotation = -(el.azimuthDeg);
          // Scale semi-axes from metres to pixels: use the same scale as the grid
          const pxPerM = canvasW / bounds.width / viewport.zoom;
          const rx = el.semiMajor * pxPerM;
          const ry = el.semiMinor * pxPerM;
          const color = el.color ?? "#a855f7";
          return (
            <g key={`ell-${i}`}>
              <ellipse
                cx={c.x} cy={c.y}
                rx={Math.max(rx, 2)} ry={Math.max(ry, 2)}
                transform={`rotate(${svgRotation} ${c.x} ${c.y})`}
                fill={`${color}18`}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4,2"
              />
              {/* Semi-major axis line */}
              {rx > 4 && (
                <line
                  x1={c.x - rx * Math.sin(azimuthRad)} y1={c.y - rx * Math.cos(azimuthRad)}
                  x2={c.x + rx * Math.sin(azimuthRad)} y2={c.y + rx * Math.cos(azimuthRad)}
                  stroke={color} strokeWidth={0.8} opacity={0.5}
                />
              )}
              {el.label && (
                <text x={c.x + Math.max(rx, 8) + 4} y={c.y - 2}
                  fill={color} fontSize={9} fontFamily="monospace">
                  {el.label}
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

        {/* Contour legend */}
        {showContourLegend && autoContours && contourInterval && (() => {
          const lx = 20;
          const ly = 20;
          const regularColor = contourColor(
            autoContours.minElevation + contourInterval,
            indexElevations,
            autoContours.minElevation,
            autoContours.maxElevation,
          );
          const indexColor = contourColor(
            [...indexElevations][0] ?? autoContours.minElevation,
            indexElevations,
            autoContours.minElevation,
            autoContours.maxElevation,
          );
          return (
            <g>
              {/* Regular contour */}
              <line x1={lx} y1={ly} x2={lx + 30} y2={ly}
                stroke={regularColor} strokeWidth={1} opacity={0.75} />
              <text x={lx + 35} y={ly + 3} fill="#a3a3a3" fontSize={9} fontFamily="monospace">
                {contourInterval}m contour
              </text>
              {/* Index contour */}
              <line x1={lx} y1={ly + 14} x2={lx + 30} y2={ly + 14}
                stroke={indexColor} strokeWidth={2} />
              <text x={lx + 35} y={ly + 17} fill="#a3a3a3" fontSize={9} fontFamily="monospace">
                {(contourInterval * indexMultiplier)}m index
              </text>
              {/* Point count */}
              <text x={lx} y={ly + 32} fill="#666" fontSize={8} fontFamily="monospace">
                {points.filter((p) => p.elevation !== undefined).length} elevation points · {autoContours.triangles.length} triangles · {autoContours.contours.length} contour lines
              </text>
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
