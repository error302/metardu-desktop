/**
 * Topographic workflow view.
 *
 * Provides a UI for running the topographic workflow:
 *   - Input: paste field points as CSV (id,e,n,code)
 *   - Configure: contour interval, spot height density
 *   - Run: calls runTopographicWorkflow from the engine
 *   - Output: TIN stats, contour count, elevation range, mean slope
 *   - Visual: SurveyCanvas SVG showing the TIN + contours + spot heights
 *     (pan with mouse drag, zoom with mouse wheel)
 *
 * Country: Kenya (Arc 1960 / UTM 37S).
 */

import React, { useState } from "react";
import { KENYA, type CountrySurveyConfig } from "@metardu/country-config";
import { runTopographicWorkflow, type TopoPoint, type TopoWorkflowOutput } from "@metardu/engine-flight-planning";
import { SurveyCanvas, type SurveyPoint, type SurveyContour, type SurveyTriangle } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";

const COUNTRIES: Record<string, CountrySurveyConfig> = {
  KE: KENYA,
};

export const TopographicView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();
  const [csvInput, setCsvInput] = useState(
    "P1,257100,9857700,100.0,TOP\nP2,257110,9857700,101.5,TOP\nP3,257110,9857710,102.0,TOP\nP4,257100,9857710,100.5,TOP\nP5,257105,9857705,101.0,TOP"
  );
  const [contourInterval, setContourInterval] = useState(0.5);
  const [spotHeightEvery, setSpotHeightEvery] = useState(2);
  const [result, setResult] = useState<TopoWorkflowOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    try {
      const points: TopoPoint[] = csvInput
        .trim()
        .split("\n")
        .map((line) => {
          const [id, e, n, elev, code] = line.trim().split(",");
          return {
            id: id ?? "",
            easting: parseFloat(e ?? "0"),
            northing: parseFloat(n ?? "0"),
            elevation: parseFloat(elev ?? "0"),
            code: code ?? undefined,
          };
        });

      const output = runTopographicWorkflow({
        points,
        contourInterval,
        spotHeightEvery,
        country: COUNTRIES.KE!,
        planTitle: "Topographic Survey",
        surveyor: { name: "Surveyor", regNo: "LS/0000", dateOfSurvey: new Date().toISOString().split("T")[0]! },
      });
      setResult(output);
      // Push to shared survey state so ExportPanel can access it.
      setSurveyOutput(output, "topographic", "TopographicView", "KE");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Topographic Survey</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Import field points, generate a TIN, extract contours, and compute elevation statistics.
        Country: Kenya (Arc 1960 / UTM 37S).
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "4px" }}>Field Points (CSV: id,easting,northing,elevation,code)</label>
          <textarea
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px" }}>Contour Interval (m)</label>
            <input type="number" value={contourInterval} step="0.5" min="0.1"
              onChange={(e) => setContourInterval(parseFloat(e.target.value) || 0.5)}
              style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px" }}>Spot Height Every Nth Point</label>
            <input type="number" value={spotHeightEvery} step="1" min="1"
              onChange={(e) => setSpotHeightEvery(parseInt(e.target.value) || 1)}
              style={{ width: "100%" }} />
          </div>
          <button className="primary" onClick={run} style={{ marginTop: "8px" }}>Generate TIN + Contours</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          {/* Visual: SVG canvas with TIN + contours + spot heights */}
          <SurveyCanvas
            height={350}
            title="Topographic Plan"
            showPointLabels={true}
            triangles={result.tin.triangles.map((tri): SurveyTriangle => ({
              a: { easting: result.tin.vertices[tri[0]]!.easting, northing: result.tin.vertices[tri[0]]!.northing },
              b: { easting: result.tin.vertices[tri[1]]!.easting, northing: result.tin.vertices[tri[1]]!.northing },
              c: { easting: result.tin.vertices[tri[2]]!.easting, northing: result.tin.vertices[tri[2]]!.northing },
            }))}
            contours={result.contours.map((c): SurveyContour => ({
              elevation: c.elevation,
              coordinates: c.coordinates,
            }))}
            spotHeights={result.spotHeights.map((sh): SurveyPoint => ({
              easting: sh.easting, northing: sh.northing, elevation: sh.elevation,
            }))}
          />
          <h3 style={{ fontSize: "var(--text-lg)", marginBottom: "8px", fontFamily: "var(--font-mono)", marginTop: "12px" }}>Results</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "12px" }}>
            <StatCard label="Points" value={String(result.tin.vertices.length)} />
            <StatCard label="Triangles" value={String(result.triangleCount)} />
            <StatCard label="Contours" value={String(result.contours.length)} />
            <StatCard label="Min Elevation" value={`${result.minElevation.toFixed(2)} m`} />
            <StatCard label="Max Elevation" value={`${result.maxElevation.toFixed(2)} m`} />
            <StatCard label="Mean Slope" value={`${result.meanSlope.toFixed(1)}°`} />
            <StatCard label="Spot Heights" value={String(result.spotHeights.length)} />
            <StatCard label="Topo Tolerance" value={`${(result.topographicToleranceM * 1000).toFixed(0)} mm`} />
            <StatCard label="Max Residual" value={`${result.maxResidualM.toFixed(3)} m`} />
          </div>
          <h4 style={{ fontSize: "var(--text-md)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>Contour Lines</h4>
          <div style={{ maxHeight: "200px", overflow: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            {result.contours.map((c, i) => (
              <div key={i}>Elev {c.elevation.toFixed(2)}m — {c.coordinates.length} vertices — {c.closed ? "closed" : "open"}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{value}</div>
  </div>
);
