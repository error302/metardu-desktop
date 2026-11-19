/**
 * Coordinate geometry for local, planar survey calculations.
 *
 * Numerically sensitive geometry is computed by the Rust sidecar. Every
 * result remains a draft until a project CRS, observations, and jurisdiction
 * requirements are independently established.
 */

import React, { useEffect, useMemo, useState } from "react";
import { SurveyCanvas, type SurveyLine, type SurveyPoint } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { bus } from "../cross-import-bus.js";

type Mode = "radiation" | "bearing-bearing" | "distance-distance" | "offset" | "area";
type Side = "left" | "right";

interface DraftPoint {
  id: string;
  easting: number;
  northing: number;
  source: string;
}

interface EdgeMetric {
  bearing_deg: number;
  distance_m: number;
}

interface AreaMetrics {
  planar_area_sq_m: number;
  planar_area_ha: number;
  planar_area_acres: number;
  perimeter_m: number;
  edges: EdgeMetric[];
}

interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
}

const MODE_FIELDS: Record<Exclude<Mode, "area">, FieldSpec[]> = {
  radiation: [
    { key: "origin_e", label: "Station easting (m)" },
    { key: "origin_n", label: "Station northing (m)" },
    { key: "bearing", label: "Grid bearing (°)" },
    { key: "distance", label: "Horizontal distance (m)" },
  ],
  "bearing-bearing": [
    { key: "p1_e", label: "Station A easting (m)" },
    { key: "p1_n", label: "Station A northing (m)" },
    { key: "bearing1", label: "Station A bearing (°)" },
    { key: "p2_e", label: "Station B easting (m)" },
    { key: "p2_n", label: "Station B northing (m)" },
    { key: "bearing2", label: "Station B bearing (°)" },
  ],
  "distance-distance": [
    { key: "p1_e", label: "Centre A easting (m)" },
    { key: "p1_n", label: "Centre A northing (m)" },
    { key: "radius1", label: "Centre A distance (m)" },
    { key: "p2_e", label: "Centre B easting (m)" },
    { key: "p2_n", label: "Centre B northing (m)" },
    { key: "radius2", label: "Centre B distance (m)" },
  ],
  offset: [
    { key: "start_e", label: "Line start easting (m)" },
    { key: "start_n", label: "Line start northing (m)" },
    { key: "end_e", label: "Line end easting (m)" },
    { key: "end_n", label: "Line end northing (m)" },
    { key: "offset", label: "Perpendicular offset (m)" },
  ],
};

const MODE_LABELS: Array<{ id: Mode; label: string }> = [
  { id: "radiation", label: "Radiation" },
  { id: "bearing-bearing", label: "Bearing intersection" },
  { id: "distance-distance", label: "Distance intersection" },
  { id: "offset", label: "Midpoint offset" },
  { id: "area", label: "Polygon metrics" },
];

const EMPTY_INPUTS: Record<string, string> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteResultPoint(value: unknown): value is { easting: number; northing: number } {
  return isRecord(value) && Number.isFinite(value.easting) && Number.isFinite(value.northing);
}

function parseRequired(inputs: Record<string, string>, key: string, label: string): number {
  const raw = inputs[key]?.trim() ?? "";
  if (!raw) throw new Error(`${label} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function parseBearing(inputs: Record<string, string>, key: string, label: string): number {
  const value = parseRequired(inputs, key, label);
  if (value < 0 || value > 360) throw new Error(`${label} must be between 0° and 360°.`);
  return value;
}

function parseNonNegative(inputs: Record<string, string>, key: string, label: string): number {
  const value = parseRequired(inputs, key, label);
  if (value < 0) throw new Error(`${label} cannot be negative.`);
  return value;
}

function parseAreaMetrics(value: unknown): AreaMetrics {
  if (!isRecord(value) || !Array.isArray(value.edges)) {
    throw new Error("The Rust sidecar returned an invalid polygon metrics response.");
  }
  const numericKeys = ["planar_area_sq_m", "planar_area_ha", "planar_area_acres", "perimeter_m"] as const;
  for (const key of numericKeys) {
    if (!Number.isFinite(value[key])) throw new Error("The Rust sidecar returned incomplete polygon metrics.");
  }
  const edges = value.edges.map((edge) => {
    if (!isRecord(edge) || !Number.isFinite(edge.bearing_deg) || !Number.isFinite(edge.distance_m)) {
      throw new Error("The Rust sidecar returned invalid edge metrics.");
    }
    return { bearing_deg: edge.bearing_deg as number, distance_m: edge.distance_m as number };
  });
  return {
    planar_area_sq_m: value.planar_area_sq_m as number,
    planar_area_ha: value.planar_area_ha as number,
    planar_area_acres: value.planar_area_acres as number,
    perimeter_m: value.perimeter_m as number,
    edges,
  };
}

async function callSidecar(method: string, params: unknown): Promise<unknown> {
  const call = (window as unknown as {
    metardu?: { sidecar?: { call?: (name: string, input: unknown) => Promise<unknown> } };
  }).metardu?.sidecar?.call;
  if (!call) throw new Error("COGO calculations are available in the METARDU Desktop app with its Rust sidecar running.");
  return call(method, params);
}

export const COGOView: React.FC = () => {
  const { activeProject, saveDraftToProject } = useSurveyState();
  const [mode, setMode] = useState<Mode>("radiation");
  const [inputs, setInputs] = useState<Record<string, string>>(EMPTY_INPUTS);
  const [side, setSide] = useState<Side>("left");
  const [points, setPoints] = useState<DraftPoint[]>([]);
  const [areaMetrics, setAreaMetrics] = useState<AreaMetrics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => bus.on("traverse:results", (payload) => {
    const imported = payload.adjusted
      .filter((point) => Number.isFinite(point.easting) && Number.isFinite(point.northing))
      .map((point) => ({
        id: point.id,
        easting: point.easting,
        northing: point.northing,
        source: "Imported adjusted traverse coordinate; CRS not checked by COGO",
      }));
    if (imported.length === 0) {
      setMessage("Traverse handoff contained no finite coordinates.");
      setMessageKind("error");
      return;
    }
    setPoints(imported);
    setAreaMetrics(null);
    setMessage(`Loaded ${imported.length} traverse coordinates as unverified planar draft points.`);
    setMessageKind("info");
  }), []);

  const fields = mode === "area" ? [] : MODE_FIELDS[mode];
  const canvasPoints: SurveyPoint[] = useMemo(() => points.map((point) => ({
    easting: point.easting,
    northing: point.northing,
    label: point.id,
  })), [points]);
  // This is only a visual ordering aid. It is not used for any computation.
  const canvasLines: SurveyLine[] = useMemo(() => points.slice(1).map((point, index) => ({
    from: canvasPoints[index],
    to: canvasPoints[index + 1],
    color: "#ff9b54",
    dashed: true,
  })), [canvasPoints, points]);

  const updateInput = (key: string, value: string) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  const compute = async () => {
    setMessage(null);
    setBusy(true);
    try {
      if (mode === "area") {
        if (points.length < 3) throw new Error("Add or import at least three ordered points before computing polygon metrics.");
        const raw = await callSidecar("cogo.area", { points: points.map((point) => [point.easting, point.northing]) });
        setAreaMetrics(parseAreaMetrics(raw));
        setMessage("Planar polygon metrics computed by the Rust sidecar. CRS and ground-area corrections remain unverified.");
        setMessageKind("info");
        return;
      }

      let method: string;
      let params: Record<string, unknown>;
      let source: string;
      if (mode === "radiation") {
        method = "cogo.radiation";
        params = {
          origin: {
            easting: parseRequired(inputs, "origin_e", "Station easting"),
            northing: parseRequired(inputs, "origin_n", "Station northing"),
          },
          bearing_deg: parseBearing(inputs, "bearing", "Grid bearing"),
          distance_m: parseNonNegative(inputs, "distance", "Horizontal distance"),
        };
        source = "Rust COGO radiation; local planar draft";
      } else if (mode === "bearing-bearing") {
        method = "cogo.bearing_bearing";
        params = {
          p1: { easting: parseRequired(inputs, "p1_e", "Station A easting"), northing: parseRequired(inputs, "p1_n", "Station A northing") },
          bearing1_deg: parseBearing(inputs, "bearing1", "Station A bearing"),
          p2: { easting: parseRequired(inputs, "p2_e", "Station B easting"), northing: parseRequired(inputs, "p2_n", "Station B northing") },
          bearing2_deg: parseBearing(inputs, "bearing2", "Station B bearing"),
        };
        source = "Rust bearing-ray intersection; local planar draft";
      } else if (mode === "distance-distance") {
        method = "cogo.distance_distance";
        params = {
          p1: { easting: parseRequired(inputs, "p1_e", "Centre A easting"), northing: parseRequired(inputs, "p1_n", "Centre A northing") },
          r1_m: parseNonNegative(inputs, "radius1", "Centre A distance"),
          p2: { easting: parseRequired(inputs, "p2_e", "Centre B easting"), northing: parseRequired(inputs, "p2_n", "Centre B northing") },
          r2_m: parseNonNegative(inputs, "radius2", "Centre B distance"),
        };
        source = "Rust distance intersection; local planar draft";
      } else {
        method = "cogo.midpoint_offset";
        params = {
          start: { easting: parseRequired(inputs, "start_e", "Line start easting"), northing: parseRequired(inputs, "start_n", "Line start northing") },
          end: { easting: parseRequired(inputs, "end_e", "Line end easting"), northing: parseRequired(inputs, "end_n", "Line end northing") },
          offset_m: parseNonNegative(inputs, "offset", "Perpendicular offset"),
          side,
        };
        source = `Rust midpoint ${side} offset; local planar draft`;
      }

      const result = await callSidecar(method, params);
      if (!finiteResultPoint(result)) throw new Error("The Rust sidecar returned invalid coordinates.");
      const point: DraftPoint = {
        id: `P${points.length + 1}`,
        easting: result.easting,
        northing: result.northing,
        source,
      };
      setPoints((current) => [...current, point]);
      setAreaMetrics(null);
      setMessage(`${point.id} computed. Coordinates are unverified local planar geometry in metres.`);
      setMessageKind("info");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "COGO calculation failed.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (points.length === 0) return;
    const projects = (window as unknown as {
      metardu?: { projects?: { create?: unknown; update?: unknown } };
    }).metardu?.projects;
    if (!projects?.create || !projects.update) {
      setMessage("Project storage is available only in the METARDU Desktop app.");
      setMessageKind("error");
      return;
    }
    try {
      await saveDraftToProject({
        evidenceStatus: "draft_unverified",
        coordinateReference: null,
        verticalReference: null,
        jurisdictionAcceptance: "not_evaluated",
        cogoDraft: {
          coordinateUnit: "metre",
          bearingConvention: "decimal degrees clockwise from local positive northing",
          points: points.map(({ id, easting, northing, source }) => ({ id, easting, northing, source })),
          planarMetrics: areaMetrics,
        },
      }, "COGO geometry draft", "COGOView", activeProject?.countryCode ?? "");
      setMessage("Saved to the active project as an unverified COGO draft. It was not sent to statutory export.");
      setMessageKind("info");
    } catch (error) {
      setMessage(error instanceof Error ? `Draft save failed: ${error.message}` : "Draft save failed.");
      setMessageKind("error");
    }
  };

  const pushToTraverse = () => {
    if (points.length < 2) return;
    bus.emit("cogo:points", { points: points.map(({ id, easting, northing, source }) => ({ id, easting, northing, source })), evidenceStatus: "draft_unverified" });
    setMessage("Sent candidate stations to Traverse. No CRS, observations, uncertainty, or adjustment evidence was attached.");
    setMessageKind("info");
  };

  const pushToCad = () => {
    if (points.length === 0) return;
    bus.emit("cad:import_entities", {
      source: "COGO local planar draft — unverified coordinates",
      beacons: points.map(({ id, easting, northing }) => ({ id, easting, northing })),
    });
    setMessage("Sent draft points to CAD for visual work. CAD import does not verify their coordinate reference.");
    setMessageKind("info");
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, height: "100%", overflow: "auto" }}>
      <header>
        <h2 style={{ margin: 0, color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Coordinate Geometry (COGO)</h2>
        <p style={{ margin: "6px 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
          Radiation, intersections, midpoint offsets, and polygon metrics calculated by the Rust sidecar.
        </p>
      </header>

      <section aria-label="COGO reference status" style={{ padding: 12, background: "rgba(245, 158, 11, 0.10)", border: "1px solid rgba(245, 158, 11, 0.55)", color: "var(--text-primary)" }}>
        <strong>Unverified local planar draft</strong>
        <div style={{ marginTop: 4, fontSize: "var(--text-sm)" }}>
          Coordinates are treated as metres on a local plane. Project CRS is not set or verified. Bearings are decimal degrees clockwise from local northing. No grid-to-ground correction, coordinate epoch, uncertainty, ground area, or jurisdiction acceptance is established.
        </div>
      </section>

      <nav aria-label="COGO operation" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MODE_LABELS.map((item) => (
          <button key={item.id} type="button" className={mode === item.id ? "primary" : ""} aria-pressed={mode === item.id} onClick={() => { setMode(item.id); setMessage(null); }}>
            {item.label}
          </button>
        ))}
      </nav>

      {fields.length > 0 && (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, background: "var(--bg-tertiary)", padding: 12, border: "1px solid var(--border-default)" }}>
          {fields.map((field) => (
            <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              {field.label}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={inputs[field.key] ?? ""}
                placeholder={field.placeholder ?? "Required"}
                aria-label={field.label}
                onChange={(event) => updateInput(field.key, event.target.value)}
              />
            </label>
          ))}
          {mode === "offset" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              Offset side
              <select value={side} onChange={(event) => setSide(event.target.value as Side)}>
                <option value="left">Left of start-to-end line</option>
                <option value="right">Right of start-to-end line</option>
              </select>
            </label>
          )}
        </section>
      )}

      {mode === "area" && (
        <section style={{ padding: 12, background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <p style={{ margin: "0 0 8px", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
            Polygon order follows the point list. Import adjusted traverse coordinates from Traverse or create points above. The sidecar rejects repeated adjacent vertices, self-intersections, and degenerate rings.
          </p>
          {areaMetrics ? (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
              <span>Planar area: {areaMetrics.planar_area_sq_m.toFixed(4)} m²</span>
              <span>{areaMetrics.planar_area_ha.toFixed(6)} ha</span>
              <span>{areaMetrics.planar_area_acres.toFixed(6)} acres</span>
              <span>Perimeter: {areaMetrics.perimeter_m.toFixed(4)} m</span>
            </div>
          ) : <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>No polygon metrics computed for the current point list.</span>}
        </section>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="primary" onClick={() => void compute()} disabled={busy}>
          {busy ? "Computing…" : mode === "area" ? "Compute planar metrics" : "Compute point"}
        </button>
        {points.length >= 2 && <button type="button" onClick={pushToTraverse}>Send draft points to Traverse</button>}
        {points.length > 0 && <button type="button" onClick={pushToCad}>Open draft points in CAD</button>}
        {points.length > 0 && <button type="button" onClick={() => void saveDraft()}>Save unverified project draft</button>}
        {points.length > 0 && <button type="button" onClick={() => { setPoints([]); setAreaMetrics(null); setMessage(null); }}>Clear points</button>}
      </div>

      {message && (
        <div role={messageKind === "error" ? "alert" : "status"} style={{ padding: "8px 12px", background: messageKind === "error" ? "rgba(239,68,68,0.10)" : "var(--bg-tertiary)", borderLeft: `3px solid ${messageKind === "error" ? "#ef4444" : "var(--accent-primary)"}`, fontSize: "var(--text-sm)" }}>
          {message}
        </div>
      )}

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-md)", fontFamily: "var(--font-mono)" }}>Draft points ({points.length})</h3>
        {points.length === 0 ? <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>Enter a calculation or import coordinates to begin.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
              <thead><tr style={{ background: "var(--bg-tertiary)" }}><th align="left">ID</th><th align="right">Easting (m)</th><th align="right">Northing (m)</th><th align="left">Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{points.map((point, index) => (
                <tr key={`${point.id}-${index}`} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td>{point.id}</td><td align="right">{point.easting.toFixed(4)}</td><td align="right">{point.northing.toFixed(4)}</td><td>{point.source}</td>
                  <td><button type="button" aria-label={`Remove ${point.id}`} onClick={() => { setPoints((current) => current.filter((_, i) => i !== index)); setAreaMetrics(null); }}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {areaMetrics && points.length >= 3 && (
        <section>
          <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-md)", fontFamily: "var(--font-mono)" }}>Planar edge metrics</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)" }}><th align="left">From → to</th><th align="right">Bearing (°)</th><th align="right">Distance (m)</th></tr></thead>
            <tbody>{areaMetrics.edges.map((edge, index) => (
              <tr key={index} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <td>{points[index]?.id} → {points[(index + 1) % points.length]?.id}</td>
                <td align="right">{edge.bearing_deg.toFixed(6)}</td>
                <td align="right">{edge.distance_m.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {canvasPoints.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 12 }}>
          <SurveyCanvas height={320} title="Draft coordinate preview" points={canvasPoints} lines={canvasLines} showPointLabels showNorthArrow={false} showScaleBar={false} />
          <p style={{ margin: "6px 0 0", color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>Schematic preview only; no verified project north or print scale.</p>
        </div>
      )}
    </div>
  );
};
