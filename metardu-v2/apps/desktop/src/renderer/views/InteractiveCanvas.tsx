/**
 * Map canvas enhancements — drawing, annotation, and measurement tools
 * for the SurveyCanvas component.
 *
 * Adds interactive drawing capabilities to the SVG canvas:
 *   - Draw points, lines, polygons
 *   - Annotate with text labels
 *   - Measure distances and areas
 *   - Undo/redo
 *
 * This module provides the React component that wraps SurveyCanvas
 * with toolbar + drawing state.
 */

import React, { useState, useRef, useCallback, useMemo } from "react";
import {
  SurveyCanvas,
  type SurveyPoint,
  type SurveyLine,
  type SurveyPolygon,
  type SurveyContour,
  type SurveyTriangle,
} from "@metardu/ui-components";
import {
  MousePointer2, Crosshair, Pencil, Ruler, Square, Type, Undo2, Redo2, Trash2,
} from "lucide-react";

type Tool = "select" | "point" | "line" | "polygon" | "measure_distance" | "measure_area" | "annotate";

interface DrawnPoint extends SurveyPoint { id: string; }
interface DrawnLine extends SurveyLine { id: string; }
interface DrawnPolygon extends SurveyPolygon { id: string; }
interface Annotation { id: string; x: number; y: number; text: string; }
interface Measurement { id: string; type: "distance" | "area"; points: { x: number; y: number }[]; value: number; unit: string; }

export const InteractiveCanvas: React.FC<{
  width?: number | string;
  height?: number;
  existingPoints?: SurveyPoint[];
  existingLines?: SurveyLine[];
  existingPolygons?: SurveyPolygon[];
  existingContours?: SurveyContour[];
  existingTriangles?: SurveyTriangle[];
}> = ({
  width = "100%",
  height = 400,
  existingPoints = [],
  existingLines = [],
  existingPolygons = [],
  existingContours = [],
  existingTriangles = [],
}) => {
  const [tool, setTool] = useState<Tool>("select");
  const [drawnPoints, setDrawnPoints] = useState<DrawnPoint[]>([]);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [drawnPolygons, setDrawnPolygons] = useState<DrawnPolygon[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [currentLinePoints, setCurrentLinePoints] = useState<SurveyPoint[]>([]);
  const [currentPolyPoints, setCurrentPolyPoints] = useState<SurveyPoint[]>([]);
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([]);
  const [history, setHistory] = useState<{ points: DrawnPoint[]; lines: DrawnLine[]; polys: DrawnPolygon[] }[]>([]);
  const [redoStack, setRedoStack] = useState<typeof history>([]);

  const pointIdCounter = useRef(0);
  const lineIdCounter = useRef(0);
  const polyIdCounter = useRef(0);

  const saveHistory = useCallback(() => {
    setHistory((h) => [...h, { points: [...drawnPoints], lines: [...drawnLines], polys: [...drawnPolygons] }]);
    setRedoStack([]);
  }, [drawnPoints, drawnLines, drawnPolygons]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setRedoStack((r) => [...r, { points: [...drawnPoints], lines: [...drawnLines], polys: [...drawnPolygons] }]);
      setDrawnPoints(prev.points);
      setDrawnLines(prev.lines);
      setDrawnPolygons(prev.polys);
      return h.slice(0, -1);
    });
  }, [drawnPoints, drawnLines, drawnPolygons]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1]!;
      setHistory((h) => [...h, { points: [...drawnPoints], lines: [...drawnLines], polys: [...drawnPolygons] }]);
      setDrawnPoints(next.points);
      setDrawnLines(next.lines);
      setDrawnPolygons(next.polys);
      return r.slice(0, -1);
    });
  }, [drawnPoints, drawnLines, drawnPolygons]);

  const clearAll = useCallback(() => {
    saveHistory();
    setDrawnPoints([]);
    setDrawnLines([]);
    setDrawnPolygons([]);
    setAnnotations([]);
    setMeasurements([]);
    setCurrentLinePoints([]);
    setCurrentPolyPoints([]);
    setMeasurePoints([]);
  }, [saveHistory]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Get click position in SVG coordinates.
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * (svg.viewBox?.baseVal?.width || rect.width);
    const y = (e.clientY - rect.top) / rect.height * (svg.viewBox?.baseVal?.height || rect.height);

    const point: SurveyPoint = { easting: x, northing: y };

    switch (tool) {
      case "point":
        saveHistory();
        setDrawnPoints((p) => [...p, { ...point, id: `pt_${++pointIdCounter.current}`, label: `P${pointIdCounter.current}` }]);
        break;
      case "line":
        setCurrentLinePoints((prev) => {
          const newPoints = [...prev, point];
          if (newPoints.length >= 2) {
            saveHistory();
            const from = newPoints[0]!;
            const to = newPoints[newPoints.length - 1]!;
            setDrawnLines((l) => [...l, {
              id: `ln_${++lineIdCounter.current}`,
              from, to, color: "#FF9500", width: 2,
            }]);
            return [];
          }
          return newPoints;
        });
        break;
      case "polygon":
        setCurrentPolyPoints((prev) => [...prev, point]);
        break;
      case "measure_distance":
        setMeasurePoints((prev) => {
          const newPoints = [...prev, { x, y }];
          if (newPoints.length >= 2) {
            const a = newPoints[0]!;
            const b = newPoints[1]!;
            const dist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
            setMeasurements((m) => [...m, {
              id: `meas_${Date.now()}`, type: "distance", points: newPoints,
              value: dist, unit: "m",
            }]);
            return [];
          }
          return newPoints;
        });
        break;
      case "measure_area":
        setMeasurePoints((prev) => [...prev, { x, y }]);
        break;
      case "annotate": {
        const text = window.prompt("Annotation text:");
        if (text) {
          setAnnotations((a) => [...a, { id: `ann_${Date.now()}`, x, y, text }]);
        }
        break;
      }
    }
  }, [tool, saveHistory]);

  const finishPolygon = useCallback(() => {
    if (currentPolyPoints.length >= 3) {
      saveHistory();
      setDrawnPolygons((p) => [...p, {
        id: `poly_${++polyIdCounter.current}`,
        points: currentPolyPoints,
        strokeColor: "#2dd4bf",
        fillColor: "rgba(45,212,191,0.1)",
        strokeWidth: 2,
      }]);
      setCurrentPolyPoints([]);
    }
  }, [currentPolyPoints, saveHistory]);

  const finishAreaMeasurement = useCallback(() => {
    if (measurePoints.length >= 3) {
      // Shoelace formula.
      let area = 0;
      for (let i = 0; i < measurePoints.length; i++) {
        const j = (i + 1) % measurePoints.length;
        area += measurePoints[i]!.x * measurePoints[j]!.y - measurePoints[j]!.x * measurePoints[i]!.y;
      }
      area = Math.abs(area) / 2;
      setMeasurements((m) => [...m, {
        id: `meas_${Date.now()}`, type: "area", points: [...measurePoints],
        value: area, unit: "m²",
      }]);
      setMeasurePoints([]);
    }
  }, [measurePoints]);

  // Combine existing + drawn geometry for display.
  const allPoints = useMemo(() => [...existingPoints, ...drawnPoints], [existingPoints, drawnPoints]);
  const allLines = useMemo(() => [...existingLines, ...drawnLines], [existingLines, drawnLines]);
  const allPolygons = useMemo(() => [...existingPolygons, ...drawnPolygons], [existingPolygons, drawnPolygons]);

  // Add current drawing-in-progress as temporary lines.
  const tempLines: SurveyLine[] = [];
  if (currentLinePoints.length === 1) {
    // Show a point marker.
  }
  if (currentPolyPoints.length > 0) {
    for (let i = 0; i < currentPolyPoints.length - 1; i++) {
      tempLines.push({
        from: currentPolyPoints[i]!, to: currentPolyPoints[i + 1]!,
        color: "#2dd4bf", width: 1, dashed: true,
      });
    }
  }
  if (measurePoints.length > 1) {
    for (let i = 0; i < measurePoints.length - 1; i++) {
      tempLines.push({
        from: { easting: measurePoints[i]!.x, northing: measurePoints[i]!.y },
        to: { easting: measurePoints[i + 1]!.x, northing: measurePoints[i + 1]!.y },
        color: "#f59e0b", width: 1, dashed: true,
      });
    }
  }

  const TOOLS: { id: Tool; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select" },
    { id: "point", icon: Crosshair, label: "Point" },
    { id: "line", icon: Pencil, label: "Line" },
    { id: "polygon", icon: Square, label: "Polygon" },
    { id: "measure_distance", icon: Ruler, label: "Distance" },
    { id: "measure_area", icon: Square, label: "Area" },
    { id: "annotate", icon: Type, label: "Annotate" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: "4px", alignItems: "center", padding: "4px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", flexWrap: "wrap" }}>
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={tool === t.id ? "primary" : ""}
              style={{ padding: "4px 8px", fontSize: "var(--text-xs)", display: "flex", alignItems: "center", gap: "4px" }}
              title={t.label}
            >
              <Icon size={14} />
              <span>{t.label}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={undo} style={{ padding: "4px 8px" }} title="Undo" disabled={history.length === 0}>
          <Undo2 size={14} />
        </button>
        <button onClick={redo} style={{ padding: "4px 8px" }} title="Redo" disabled={redoStack.length === 0}>
          <Redo2 size={14} />
        </button>
        <button onClick={clearAll} style={{ padding: "4px 8px" }} title="Clear all">
          <Trash2 size={14} />
        </button>
        {(tool === "polygon" && currentPolyPoints.length >= 3) && (
          <button className="primary" onClick={finishPolygon} style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}>
            Finish Polygon ({currentPolyPoints.length} pts)
          </button>
        )}
        {(tool === "measure_area" && measurePoints.length >= 3) && (
          <button className="primary" onClick={finishAreaMeasurement} style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}>
            Finish Area ({measurePoints.length} pts)
          </button>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", pointerEvents: tool === "select" ? "auto" : "auto" }}>
          <SurveyCanvas
            width={width}
            height={height}
            points={allPoints}
            lines={[...allLines, ...tempLines]}
            polygons={allPolygons}
            contours={existingContours}
            triangles={existingTriangles}
            showGrid={true}
            showNorthArrow={true}
            showScaleBar={true}
            showPointLabels={true}
          />
        </div>
      </div>

      {/* Measurements panel */}
      {measurements.length > 0 && (
        <div style={{ padding: "8px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", maxHeight: "100px", overflow: "auto" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase", marginBottom: "4px" }}>Measurements</div>
          {measurements.map((m) => (
            <div key={m.id} style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {m.type === "distance" ? "Distance" : "Area"}: {m.value.toFixed(2)} {m.unit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
