/**
 * SurveyCanvas — lightweight SVG-based canvas for survey plan visualization.
 *
 * This is now a thin orchestrator that composes:
 *   - `useSurveyViewport` — pan/zoom/transform state
 *   - Rendering layers from `SurveyLayers.tsx` — each a pure function
 *     of data + transform → SVG elements
 *
 * The orchestrator handles:
 *   - Contour auto-generation from point elevations
 *   - Merging explicit + auto contours and triangles
 *   - Computing bounds from all data
 *   - Composing layers in default z-order
 *   - Reset button + zoom indicator chrome
 *
 * Consumers who need custom z-ordering, selective layer visibility,
 * or programmatic viewport control can use the layers + hook directly.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { placeRetainedContourLabels } from "@metardu/engine-flight-planning";
import {
  generateContours,
  computeIndexElevations,
  type ContourInputPoint,
} from "./contour-generation.js";
import { useSurveyViewport, computeDataBounds, type Bounds } from "./useSurveyViewport.js";
import {
  GridLayer,
  TriangleLayer,
  ContourLayer,
  PolygonLayer,
  LineLayer,
  PointLayer,
  SpotHeightLayer,
  EllipseLayer,
  ChromeLayer,
} from "./SurveyLayers.js";

// ─── Types (re-exported for backward compat) ──────────────────────

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
  semiMajor: number;
  semiMinor: number;
  azimuthDeg: number;
  color?: string;
  label?: string;
}

export interface SurveyContour {
  elevation: number;
  coordinates: [number, number][];
  color?: string;
  closed?: boolean;
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
  contourInterval?: number;
  indexMultiplier?: number;
  showTin?: boolean;
  showContourLabels?: boolean;
  showContourLegend?: boolean;
}

// ─── Component ────────────────────────────────────────────────────

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
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(800);
  useEffect(() => {
    if (typeof width === "number" || !containerRef.current) return;
    const element = containerRef.current;
    const measure = () => { if (element.clientWidth > 0) setMeasuredWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const canvasW = typeof width === "number" ? width : measuredWidth;
  const canvasH = height;

  // ── Auto-generate contours ────────────────────────────────────
  const autoContours = useMemo(() => {
    if (!contourInterval || contourInterval <= 0) return null;
    const elevPoints: ContourInputPoint[] = points
      .filter((p) => p.elevation !== undefined && p.elevation !== null)
      .map((p) => ({ easting: p.easting, northing: p.northing, elevation: p.elevation! }));
    if (elevPoints.length < 3) return null;
    return generateContours(elevPoints, { interval: contourInterval, indexMultiplier });
  }, [points, contourInterval, indexMultiplier]);

  // ── Merge contours + triangles ────────────────────────────────
  const allContours = useMemo(() => {
    if (autoContours) {
      return autoContours.contours.map((c) => ({
        elevation: c.elevation, coordinates: c.coordinates, index: false,
      }));
    }
    return explicitContours;
  }, [autoContours, explicitContours]);

  const indexElevations = useMemo(() => {
    if (!contourInterval || contourInterval <= 0 || !autoContours) return new Set<number>();
    return computeIndexElevations(autoContours.minElevation, autoContours.maxElevation, contourInterval, indexMultiplier);
  }, [contourInterval, indexMultiplier, autoContours]);

  const allTriangles = useMemo(() => {
    if (autoContours && showTin) {
      const { vertices, triangles } = autoContours;
      return triangles.map(([ai, bi, ci]) => ({ a: vertices[ai]!, b: vertices[bi]!, c: vertices[ci]! }));
    }
    return explicitTriangles;
  }, [autoContours, showTin, explicitTriangles]);

  // ── Compute bounds from all data ──────────────────────────────
  const allPointsFlat = useMemo(() => {
    const flat: SurveyPoint[] = [...points, ...spotHeights];
    for (const contour of allContours) for (const [easting, northing] of contour.coordinates) flat.push({ easting, northing });
    for (const l of lines) { flat.push(l.from, l.to); }
    for (const poly of polygons) flat.push(...poly.points);
    for (const tri of allTriangles) flat.push(tri.a, tri.b, tri.c);
    if (ellipses) for (const el of ellipses) {
      const maxR = Math.max(el.semiMajor, el.semiMinor);
      flat.push(
        { easting: el.center.easting - maxR * 1.5, northing: el.center.northing - maxR * 1.5 },
        { easting: el.center.easting + maxR * 1.5, northing: el.center.northing + maxR * 1.5 },
      );
    }
    return flat;
  }, [points, lines, polygons, allTriangles, ellipses, allContours, spotHeights]);

  const bounds = useMemo(() => computeDataBounds(allPointsFlat), [allPointsFlat]);

  // ── Viewport hook ─────────────────────────────────────────────
  const vp = useSurveyViewport(bounds, { canvasW, canvasH });

  const retainedLabels = useMemo(() => {
    if (autoContours || !showContourLabels) return [];
    const reserved = points.map(point => {
      const p = vp.toPixel(point);
      return {left:p.x-7,top:p.y-7,right:p.x+(showPointLabels ? 80 : 7),bottom:p.y+(showPointLabels ? 16 : 7)};
    });
    for (const point of spotHeights) {
      const p=vp.toPixel(point);reserved.push({left:p.x-6,top:p.y-10,right:p.x+65,bottom:p.y+8});
    }
    reserved.push({left:canvasW-90,top:0,right:canvasW,bottom:100});
    return placeRetainedContourLabels(allContours,vp.transform,reserved,{width:canvasW,height:canvasH});
  }, [autoContours, showContourLabels, allContours, points, spotHeights, vp.transform, vp.toPixel, canvasW, canvasH, showPointLabels]);

  useEffect(() => {
    const element=svgRef.current;if(!element)return;
    const wheel=(event:WheelEvent)=>vp.onWheel(event);
    element.addEventListener("wheel",wheel,{passive:false});
    return ()=>element.removeEventListener("wheel",wheel);
  }, [vp.onWheel]);

  // ── Grid spacing ──────────────────────────────────────────────
  const spacing = gridSpacing ?? Math.max(bounds.width, bounds.height) / 10;

  // ── Auto-contour metadata for ChromeLayer ─────────────────────
  const contourMeta = autoContours ? {
    minElevation: autoContours.minElevation,
    maxElevation: autoContours.maxElevation,
    contourCount: autoContours.contours.length,
    triangleCount: autoContours.triangles.length,
    pointCount: points.filter((p) => p.elevation !== undefined).length,
  } : null;

  return (
    <div ref={containerRef} style={{ position: "relative", width: typeof width === "string" ? width : `${width}px`, height: `${height}px` }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ backgroundColor, cursor: vp.isDragging ? "grabbing" : "grab", display: "block" }}
        onMouseDown={vp.onMouseDown as (e: ReactMouseEvent<SVGSVGElement>) => void}
        onMouseMove={vp.onMouseMove as (e: ReactMouseEvent<SVGSVGElement>) => void}
        onMouseUp={vp.onMouseUp}
        onMouseLeave={vp.onMouseUp}
      >
        {/* Grid */}
        {showGrid && (
          <GridLayer transform={vp.transform}
            minE={bounds.minE} maxE={bounds.maxE}
            minN={bounds.minN} maxN={bounds.maxN}
            spacing={spacing} />
        )}

        {/* TIN triangles */}
        {allTriangles.length > 0 && (
          <TriangleLayer transform={vp.transform} triangles={allTriangles} />
        )}

        {/* Contours */}
        {allContours.length > 0 && (
          <ContourLayer transform={vp.transform} contours={allContours}
            indexElevations={indexElevations}
            minElevation={autoContours?.minElevation ?? Math.min(...allContours.map(c => c.elevation))}
            maxElevation={autoContours?.maxElevation ?? Math.max(...allContours.map(c => c.elevation))}
            showLabels={showContourLabels && !!autoContours}
            backgroundColor={backgroundColor} />
        )}

        {/* Polygons */}
        {polygons.length > 0 && (
          <PolygonLayer transform={vp.transform} polygons={polygons} />
        )}

        {/* Lines */}
        {lines.length > 0 && (
          <LineLayer transform={vp.transform} lines={lines} />
        )}

        {/* Points */}
        {points.length > 0 && (
          <PointLayer transform={vp.transform} points={points}
            showLabels={showPointLabels} />
        )}

        {/* Spot heights */}
        {spotHeights.length > 0 && (
          <SpotHeightLayer transform={vp.transform} spotHeights={spotHeights} />
        )}

        {retainedLabels.map((label,i) => <text key={`retained-label-${i}`} x={label.x} y={label.y}
          textAnchor="middle" dominantBaseline="middle" fill="#c6ae87" fontSize={9} fontFamily="monospace"
          stroke={backgroundColor} strokeWidth={4} paintOrder="stroke">{label.text}</text>)}

        {/* Error ellipses */}
        {ellipses.length > 0 && (
          <EllipseLayer transform={vp.transform} ellipses={ellipses}
            pxPerMetre={vp.pxPerMetre} />
        )}

        {/* Chrome (north arrow, scale bar, title, legend) */}
        <ChromeLayer canvasW={canvasW} canvasH={canvasH}
          boundsWidth={bounds.width} pxPerMetre={vp.pxPerMetre}
          showNorthArrow={showNorthArrow} showScaleBar={showScaleBar}
          title={title} backgroundColor={backgroundColor}
          autoContours={contourMeta} contourInterval={contourInterval}
          indexMultiplier={indexMultiplier} indexElevations={indexElevations} />
      </svg>

      {/* Reset view button */}
      <button
        onClick={vp.resetView}
        style={{
          position: "absolute", top: 8, right: 8,
          padding: "4px 8px", fontSize: 11, fontFamily: "monospace",
          background: "var(--bg-tertiary)", color: "var(--text-secondary)",
          border: "1px solid var(--border-default)", cursor: "pointer",
        }}
      >Reset View</button>

      {/* Zoom indicator */}
      <div style={{
        position: "absolute", bottom: 8, right: 8,
        padding: "2px 6px", fontSize: 10, fontFamily: "monospace",
        color: "var(--text-tertiary)",
      }}>
        Zoom: {vp.viewport.zoom.toFixed(2)}×
      </div>
    </div>
  );
};
