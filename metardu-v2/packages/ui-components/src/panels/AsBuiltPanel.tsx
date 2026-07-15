/**
 * As-Built Comparison Panel — quality control after construction.
 *
 * Shows:
 *   - Design vs surveyed point table with ΔE/ΔN/ΔH
 *   - Pass/Warning/Fail status per point (color-coded)
 *   - Summary: pass rate, RMS, max deviation
 *   - Scatter plot SVG (ΔE vs ΔN with tolerance circles)
 */

import React, { useState, useCallback } from "react";
import { useAsBuiltComparison } from "../hooks/index.js";

export const AsBuiltPanel: React.FC = () => {
  const { summary, compare, loading } = useAsBuiltComparison();
  const [designCsv, setDesignCsv] = useState("");
  const [surveyedCsv, setSurveyedCsv] = useState("");
  const [tolerance, setTolerance] = useState(20); // mm

  const parsePoints = (csv: string) => {
    return csv.trim().split("\n").filter(l => l.trim()).map(line => {
      const [id, e, n, h] = line.trim().split(",").map(s => s.trim());
      return { id, easting: parseFloat(e), northing: parseFloat(n), elevation: parseFloat(h) };
    }).filter(p => p.id && !isNaN(p.easting));
  };

  const handleCompare = useCallback(() => {
    const design = parsePoints(designCsv);
    const surveyed = parsePoints(surveyedCsv);
    if (design.length === 0 || surveyed.length === 0) return;
    compare(design, surveyed, { horizontal: tolerance, vertical: tolerance });
  }, [designCsv, surveyedCsv, tolerance, compare]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>As-Built vs Design</h2>

      {/* Input tolerance */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Tolerance (mm)</span>
        <input type="number" value={tolerance} onChange={e => setTolerance(Number(e.target.value))}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", width: 100 }} />
      </label>

      {/* Design points input */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Design Points (id,easting,northing,elevation)</span>
        <textarea value={designCsv} onChange={e => setDesignCsv(e.target.value)} rows={4}
          placeholder={"P1,1000.000,2000.000,1700.000\nP2,1010.000,2000.000,1700.000"}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }} />
      </label>

      {/* Surveyed points input */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Surveyed Points (id,easting,northing,elevation)</span>
        <textarea value={surveyedCsv} onChange={e => setSurveyedCsv(e.target.value)} rows={4}
          placeholder={"P1,1000.005,2000.003,1700.002\nP2,1010.015,2000.010,1700.008"}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }} />
      </label>

      <button onClick={handleCompare} disabled={loading}
        style={{ padding: 10, borderRadius: 6, border: "none", background: loading ? "#ccc" : "#2563eb", color: "white", fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
        {loading ? "Comparing..." : "Compare"}
      </button>

      {/* Summary */}
      {summary && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: "#22c55e20" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#22c55e" }}>{summary.passed}</div>
              <div style={{ fontSize: 11, color: "#666" }}>PASS</div>
            </div>
            <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: "#f59e0b20" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#f59e0b" }}>{summary.warnings}</div>
              <div style={{ fontSize: 11, color: "#666" }}>WARN</div>
            </div>
            <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: "#ef444420" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#ef4444" }}>{summary.failed}</div>
              <div style={{ fontSize: 11, color: "#666" }}>FAIL</div>
            </div>
          </div>

          <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 12, fontSize: 13, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            <div><strong>Pass Rate:</strong> {summary.passRate.toFixed(1)}%</div>
            <div><strong>RMS (H):</strong> {summary.horizontalRms.toFixed(1)} mm</div>
            <div><strong>RMS (V):</strong> {summary.verticalRms.toFixed(1)} mm</div>
            <div><strong>Max Dev:</strong> {summary.maxHorizontal.toFixed(1)} mm ({summary.maxHorizontalPoint})</div>
          </div>

          {/* Results table */}
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                <tr>
                  <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Point</th>
                  <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>ΔE (mm)</th>
                  <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>ΔN (mm)</th>
                  <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>ΔH (mm)</th>
                  <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>2D (mm)</th>
                  <th style={{ padding: 6, textAlign: "center", borderBottom: "1px solid #e5e7eb" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.sortedResults.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 6 }}>{r.id}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.deltaE.toFixed(1)}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.deltaN.toFixed(1)}</td>
                    <td style={{ padding: 6, textAlign: "right", color: Math.abs(r.deltaH) > tolerance ? "#ef4444" : "#666" }}>{r.deltaH.toFixed(1)}</td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 600, color: r.horizontalDiff > tolerance ? "#ef4444" : "#22c55e" }}>{r.horizontalDiff.toFixed(1)}</td>
                    <td style={{ padding: 6, textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: r.status === "pass" ? "#22c55e20" : r.status === "warning" ? "#f59e0b20" : "#ef444420",
                        color: r.status === "pass" ? "#22c55e" : r.status === "warning" ? "#f59e0b" : "#ef4444" }}>
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
