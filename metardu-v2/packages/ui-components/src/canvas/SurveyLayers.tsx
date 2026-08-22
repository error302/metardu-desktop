/**
 * SurveyLayers — composable SVG rendering layers for SurveyCanvas.
 *
 * Each layer is a pure function of data + transform → SVG elements.
 * Layers can be composed in any order by the consumer, or used
 * independently outside SurveyCanvas.
 *
 * # Architecture
 *
 *   <SurveyCanvas>           ← orchestrator (pan/zoom + composition)
 *     <GridLayer />          ← background grid
 *     <TriangleLayer />      ← TIN wireframe
 *     <ContourLayer />       ← contour polylines + labels
 *     <PolygonLayer />       ← filled/stroked polygons
 *     <LineLayer />          ← beams, traverse legs, baselines
 *     <PointLayer />         ← beacon markers + labels
 *     <EllipseLayer />       ← error ellipses
 *     <ChromeLayer />        ← north arrow, scale bar, title, legend
 *   </SurveyCanvas>
 *
 * # Deletion test
 *
 * Deleting this file would force every consumer that wants custom
 * z-ordering or selective layer visibility to rebuild SVG rendering
 * from scratch. The layers concentrate reusable rendering logic.
 */

import React from "react";
import type { SurveyPointLike, TransformFn } from "./useSurveyViewport.js";
import {
  contourColor,
  computeIndexElevations,
  type ContourLine,
} from "./contour-generation.js";

// ─── Shared types ─────────────────────────────────────────────────

export interface LayerProps {
  /** Survey → pixel coordinate transform. */
  transform: TransformFn;
}

// ─── Grid Layer ───────────────────────────────────────────────────

export interface GridLayerProps extends LayerProps {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
  spacing: number;
  color?: string;
  strokeWidth?: number;
}

export const GridLayer: React.FC<GridLayerProps> = ({
  transform, minE, maxE, minN, maxN, spacing,
  color = "#1a1a1a", strokeWidth = 0.5,
}) => {
  const lines: React.ReactElement[] = [];
  const startE = Math.ceil(minE / spacing) * spacing;
  const startN = Math.ceil(minN / spacing) * spacing;

  for (let e = startE; e <= maxE; e += spacing) {
    const p1 = transform(e, minN);
    const p2 = transform(e, maxN);
    lines.push(
      <line key={`gv-${e}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={color} strokeWidth={strokeWidth} />,
    );
  }
  for (let n = startN; n <= maxN; n += spacing) {
    const p1 = transform(minE, n);
    const p2 = transform(maxE, n);
    lines.push(
      <line key={`gh-${n}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={color} strokeWidth={strokeWidth} />,
    );
  }

  return <g className="grid-layer">{lines}</g>;
};

// ─── Triangle Layer ───────────────────────────────────────────────

export interface TriangleLayerProps extends LayerProps {
  triangles: Array<{
    a: SurveyPointLike;
    b: SurveyPointLike;
    c: SurveyPointLike;
  }>;
  color?: string;
  strokeWidth?: number;
}

export const TriangleLayer: React.FC<TriangleLayerProps> = ({
  transform, triangles, color = "#333", strokeWidth = 0.5,
}) => (
  <g className="triangle-layer">
    {triangles.map((tri, i) => {
      const a = transform(tri.a.easting, tri.a.northing);
      const b = transform(tri.b.easting, tri.b.northing);
      const c = transform(tri.c.easting, tri.c.northing);
      return (
        <g key={`tri-${i}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={strokeWidth} />
          <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} stroke={color} strokeWidth={strokeWidth} />
          <line x1={c.x} y1={c.y} x2={a.x} y2={a.y} stroke={color} strokeWidth={strokeWidth} />
        </g>
      );
    })}
  </g>
);

// ─── Contour Layer ────────────────────────────────────────────────

/** Pick evenly-spaced positions along a polyline for labels. */
function pickLabelPositions(coords: [number, number][], maxLabels: number): number[] {
  if (coords.length < 2) return [0];
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
      positions.push(i - 1 + t);
      nextTarget += spacing;
    }
    accumulated = segEnd;
  }
  return positions.length > 0 ? positions : [Math.floor(coords.length / 2)];
}

export interface ContourLayerProps extends LayerProps {
  contours: Array<{
    elevation: number;
    coordinates: [number, number][];
    color?: string;
    closed?: boolean;
    index?: boolean;
  }>;
  indexElevations: Set<number>;
  minElevation: number;
  maxElevation: number;
  showLabels?: boolean;
  backgroundColor?: string;
}

export const ContourLayer: React.FC<ContourLayerProps> = ({
  transform, contours, indexElevations, minElevation, maxElevation,
  showLabels = true, backgroundColor = "#0a0a0a",
}) => (
  <g className="contour-layer">
    {contours.map((contour, ci) => {
      if (contour.coordinates.length < 2) return null;
      const isIndex = contour.index ?? indexElevations.has(
        Math.round(contour.elevation * 1000) / 1000,
      );
      const color = contour.color ?? contourColor(
        contour.elevation, indexElevations, minElevation, maxElevation,
      );
      const strokeWidth = isIndex ? 2.0 : 1.0;
      const opacity = isIndex ? 1.0 : 0.75;

      const pathParts = contour.coordinates.map((coord, i) => {
        const pt = transform(coord[0], coord[1]);
        return `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
      });
      const pathD = pathParts.join(" ") + (contour.closed ? " Z" : "");

      const labels: React.ReactElement[] = [];
      if (showLabels && isIndex && contour.coordinates.length >= 2) {
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
            <text key={`cl-${ci}-${li}`}
              x={pt.x + 2} y={pt.y - 3}
              fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold"
              stroke={backgroundColor} strokeWidth={2} paintOrder="stroke"
            >{contour.elevation.toFixed(1)}</text>,
          );
        }
      }

      return (
        <g key={`cg-${ci}`}>
          <path d={pathD} fill="none" stroke={color}
            strokeWidth={strokeWidth} opacity={opacity}
            strokeLinecap="round" strokeLinejoin="round" />
          {labels}
        </g>
      );
    })}
  </g>
);

// ─── Polygon Layer ────────────────────────────────────────────────

export interface PolygonLayerProps extends LayerProps {
  polygons: Array<{
    points: SurveyPointLike[];
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    label?: string;
  }>;
}

export const PolygonLayer: React.FC<PolygonLayerProps> = ({ transform, polygons }) => (
  <g className="polygon-layer">
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
  </g>
);

// ─── Line Layer ───────────────────────────────────────────────────

export interface LineLayerProps extends LayerProps {
  lines: Array<{
    from: SurveyPointLike;
    to: SurveyPointLike;
    color?: string;
    width?: number;
    dashed?: boolean;
  }>;
}

export const LineLayer: React.FC<LineLayerProps> = ({ transform, lines }) => (
  <g className="line-layer">
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
  </g>
);

// ─── Point Layer ──────────────────────────────────────────────────

export interface PointLayerProps extends LayerProps {
  points: SurveyPointLike[];
  showLabels?: boolean;
  color?: string;
  radius?: number;
}

export const PointLayer: React.FC<PointLayerProps> = ({
  transform, points, showLabels = false, color = "#FF9500", radius = 3,
}) => (
  <g className="point-layer">
    {points.map((p, i) => {
      const pos = transform(p.easting, p.northing);
      return (
        <g key={`pt-${i}`}>
          <circle cx={pos.x} cy={pos.y} r={radius}
            fill={color} stroke="#fff" strokeWidth={1} />
          {showLabels && (p as any).label && (
            <text x={pos.x + 5} y={pos.y - 5}
              fill="#2dd4bf" fontSize={10} fontFamily="monospace">
              {(p as any).label}
            </text>
          )}
          {showLabels && p.elevation !== undefined && (
            <text x={pos.x + 5} y={pos.y + 12}
              fill="#a3a3a3" fontSize={9} fontFamily="monospace">
              +{p.elevation.toFixed(2)}
            </text>
          )}
        </g>
      );
    })}
  </g>
);

// ─── Spot Height Layer ────────────────────────────────────────────

export interface SpotHeightLayerProps extends LayerProps {
  spotHeights: SurveyPointLike[];
  color?: string;
}

export const SpotHeightLayer: React.FC<SpotHeightLayerProps> = ({
  transform, spotHeights, color = "#2dd4bf",
}) => (
  <g className="spoutheight-layer">
    {spotHeights.map((sh, i) => {
      const pos = transform(sh.easting, sh.northing);
      const s = 4;
      return (
        <g key={`sh-${i}`}>
          <line x1={pos.x - s} y1={pos.y} x2={pos.x + s} y2={pos.y}
            stroke={color} strokeWidth={1} />
          <line x1={pos.x} y1={pos.y - s} x2={pos.x} y2={pos.y + s}
            stroke={color} strokeWidth={1} />
          {sh.elevation !== undefined && (
            <text x={pos.x + 5} y={pos.y + 3}
              fill={color} fontSize={9} fontFamily="monospace">
              +{sh.elevation.toFixed(2)}
            </text>
          )}
        </g>
      );
    })}
  </g>
);

// ─── Ellipse Layer ────────────────────────────────────────────────

export interface EllipseLayerProps extends LayerProps {
  ellipses: Array<{
    center: SurveyPointLike;
    semiMajor: number;
    semiMinor: number;
    azimuthDeg: number;
    color?: string;
    label?: string;
  }>;
  pxPerMetre: number;
}

export const EllipseLayer: React.FC<EllipseLayerProps> = ({
  transform, ellipses, pxPerMetre,
}) => (
  <g className="ellipse-layer">
    {ellipses.map((el, i) => {
      const c = transform(el.center.easting, el.center.northing);
      const azimuthRad = (el.azimuthDeg * Math.PI) / 180;
      const svgRotation = -el.azimuthDeg;
      const rx = el.semiMajor * pxPerMetre;
      const ry = el.semiMinor * pxPerMetre;
      const color = el.color ?? "#a855f7";
      return (
        <g key={`ell-${i}`}>
          <ellipse cx={c.x} cy={c.y}
            rx={Math.max(rx, 2)} ry={Math.max(ry, 2)}
            transform={`rotate(${svgRotation} ${c.x} ${c.y})`}
            fill={`${color}18`} stroke={color} strokeWidth={1.5}
            strokeDasharray="4,2" />
          {rx > 4 && (
            <line
              x1={c.x - rx * Math.sin(azimuthRad)} y1={c.y - rx * Math.cos(azimuthRad)}
              x2={c.x + rx * Math.sin(azimuthRad)} y2={c.y + rx * Math.cos(azimuthRad)}
              stroke={color} strokeWidth={0.8} opacity={0.5} />
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
  </g>
);

// ─── Chrome Layer (north arrow, scale bar, title, legend) ────────

export interface ChromeLayerProps {
  canvasW: number;
  canvasH: number;
  boundsWidth: number;
  pxPerMetre: number;
  showNorthArrow?: boolean;
  showScaleBar?: boolean;
  title?: string;
  backgroundColor?: string;
  autoContours?: {
    minElevation: number;
    maxElevation: number;
    contourCount: number;
    triangleCount: number;
    pointCount: number;
  } | null;
  contourInterval?: number;
  indexMultiplier?: number;
  indexElevations?: Set<number>;
}

export const ChromeLayer: React.FC<ChromeLayerProps> = ({
  canvasW, canvasH, boundsWidth, pxPerMetre,
  showNorthArrow = true, showScaleBar = true,
  title, backgroundColor = "#0a0a0a",
  autoContours, contourInterval, indexMultiplier = 5, indexElevations,
}) => (
  <g className="chrome-layer">
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
      const targetM = 100 / pxPerMetre;
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetM, 0.1))));
      const niceLength = Math.round(targetM / magnitude) * magnitude;
      const barLengthPx = niceLength * pxPerMetre;
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
    {autoContours && contourInterval && indexElevations && (() => {
      const lx = 20;
      const ly = 20;
      const regularColor = contourColor(
        autoContours.minElevation + contourInterval,
        indexElevations, autoContours.minElevation, autoContours.maxElevation,
      );
      const indexColor = contourColor(
        [...indexElevations][0] ?? autoContours.minElevation,
        indexElevations, autoContours.minElevation, autoContours.maxElevation,
      );
      return (
        <g>
          <line x1={lx} y1={ly} x2={lx + 30} y2={ly}
            stroke={regularColor} strokeWidth={1} opacity={0.75} />
          <text x={lx + 35} y={ly + 3} fill="#a3a3a3" fontSize={9} fontFamily="monospace">
            {contourInterval}m contour
          </text>
          <line x1={lx} y1={ly + 14} x2={lx + 30} y2={ly + 14}
            stroke={indexColor} strokeWidth={2} />
          <text x={lx + 35} y={ly + 17} fill="#a3a3a3" fontSize={9} fontFamily="monospace">
            {(contourInterval * indexMultiplier)}m index
          </text>
          <text x={lx} y={ly + 32} fill="#666" fontSize={8} fontFamily="monospace">
            {autoContours.pointCount} elevation points · {autoContours.triangleCount} triangles · {autoContours.contourCount} contour lines
          </text>
        </g>
      );
    })()}

    {/* Title */}
    {title && (
      <text x={15} y={20} fill="#FF9500" fontSize={13} fontFamily="monospace" fontWeight="bold">
        {title}
      </text>
    )}
  </g>
);
