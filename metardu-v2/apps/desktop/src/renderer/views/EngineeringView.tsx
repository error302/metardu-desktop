/**
 * Engineering workflow view.
 *
 * Computes cut/fill volumes between an existing-ground TIN and a
 * design surface (flat plane), with cross-section extraction along
 * an alignment.
 */

import React, { useState } from "react";
import { KENYA } from "@metardu/country-config";
import { useSurveyState } from "../SurveyStateContext.js";
import { runEngineeringWorkflow, type EngineeringWorkflowOutput, type TIN, type TopoPoint } from "@metardu/engine-flight-planning";

// Synthetic existing-ground TIN: a 100×100m area at elevation 100m.
const defaultTIN: TIN = {
  vertices: [
    { id: "1", easting: 0, northing: 0, elevation: 100 },
    { id: "2", easting: 100, northing: 0, elevation: 100 },
    { id: "3", easting: 100, northing: 100, elevation: 100 },
    { id: "4", easting: 0, northing: 100, elevation: 100 },
  ],
  triangles: [[0, 1, 2], [0, 2, 3]],
};

export const EngineeringView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();
  const [designElevation, setDesignElevation] = useState(102);
  const [sectionSpacing, setSectionSpacing] = useState(20);
  const [sectionWidth, setSectionWidth] = useState(80);
  const [result, setResult] = useState<EngineeringWorkflowOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    try {
      const output = runEngineeringWorkflow({
        existingGround: defaultTIN,
        design: { type: "plane", plane: { a: 0, b: 0, c: designElevation } },
        alignment: {
          points: [
            { chainage: 0, easting: 50, northing: 0 },
            { chainage: 100, easting: 50, northing: 100 },
          ],
        },
        sectionSpacing,
        sectionWidth,
        sectionSampleInterval: 10,
        country: KENYA,
      });
      setResult(output);
      setSurveyOutput(output, "engineering", "EngineeringView", "KE");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Engineering Survey</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Cut/fill volume computation between existing ground and a design plane.
        Cross-sections extracted along the alignment using the average-end-area method.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "4px" }}>Design Elevation (m)</label>
          <input type="number" value={designElevation} step="0.5"
            onChange={(e) => setDesignElevation(parseFloat(e.target.value) || 0)}
            style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "4px" }}>Section Spacing (m)</label>
          <input type="number" value={sectionSpacing} step="5" min="5"
            onChange={(e) => setSectionSpacing(parseFloat(e.target.value) || 20)}
            style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "4px" }}>Section Width (m)</label>
          <input type="number" value={sectionWidth} step="10" min="10"
            onChange={(e) => setSectionWidth(parseFloat(e.target.value) || 80)}
            style={{ width: "100%" }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="primary" onClick={run} style={{ width: "100%" }}>Compute Volumes</button>
        </div>
      </div>

      <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
        Existing ground: 100m × 100m flat TIN at elevation 100.0m.
        Alignment: 100m north-south at easting 50.
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <h3 style={{ fontSize: "var(--text-lg)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Volume Report</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "12px" }}>
            <StatCard label="Cut Volume" value={`${result.cutVolume.toFixed(1)} m³`} color="var(--status-warning)" />
            <StatCard label="Fill Volume" value={`${result.fillVolume.toFixed(1)} m³`} color="var(--status-info)" />
            <StatCard label="Net Volume" value={`${result.netVolume.toFixed(1)} m³`} color={result.netVolume >= 0 ? "var(--status-warning)" : "var(--status-info)"} />
            <StatCard label="Sections" value={String(result.sectionCount)} />
            <StatCard label="Max Cut Depth" value={`${result.maxCutDepth.toFixed(2)} m`} />
            <StatCard label="Max Fill Height" value={`${result.maxFillHeight.toFixed(2)} m`} />
            <StatCard label="Eng. Tolerance" value={`${(result.engineeringToleranceM * 1000).toFixed(0)} mm`} />
            <StatCard label="Method" value="Avg End Area" />
          </div>

          <h4 style={{ fontSize: "var(--text-md)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>Cross-Sections</h4>
          <div style={{ maxHeight: "200px", overflow: "auto" }}>
            <table>
              <thead>
                <tr><th>Chainage</th><th>Area (m²)</th><th>Type</th></tr>
              </thead>
              <tbody>
                {result.sections.map((s, i) => (
                  <tr key={i}>
                    <td>{s.chainage.toFixed(1)}</td>
                    <td>{s.area.toFixed(2)}</td>
                    <td>{s.area > 0 ? "CUT" : s.area < 0 ? "FILL" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: color ?? "var(--text-primary)" }}>{value}</div>
  </div>
);

// Suppress unused import warning (TopoPoint is used by the TIN type).
void (null as unknown as TopoPoint);
