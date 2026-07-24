/**
 * Construction Setting-Out workflow view.
 *
 * Two-panel UI:
 *   Left: design points + control points (editable table)
 *   Right: stakeout instructions + as-built QC results
 */

import React, { useState } from "react";
import { KENYA } from "@metardu/country-config";
import { useSurveyState } from "../SurveyStateContext.js";
import {
  runSettingOutWorkflow,
  type SettingOutWorkflowOutput,
  type DesignPoint,
  type ControlPoint,
  type AsBuiltObservation,
} from "@metardu/engine-flight-planning";

export const SettingOutView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();
  const [designPoints, setDesignPoints] = useState<DesignPoint[]>([
    { id: "F1", easting: 257100, northing: 9857700, type: "foundation" },
    { id: "F2", easting: 257110, northing: 9857700, type: "foundation" },
    { id: "C1", easting: 257105, northing: 9857710, type: "column" },
  ]);
  const [controlPoints] = useState<ControlPoint[]>([
    { id: "CP1", easting: 257090, northing: 9857690 },
  ]);
  const [asBuilt, setAsBuilt] = useState<AsBuiltObservation[]>([]);
  const [result, setResult] = useState<SettingOutWorkflowOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    try {
      const output = runSettingOutWorkflow({
        designPoints,
        controlPoints,
        asBuilt,
        country: KENYA,
      });
      setResult(output);
      setSurveyOutput(output, "setting-out", "SettingOutView", "KE");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addAsBuilt = () => {
    // Generate mock as-built data: 5mm offset from design for each point.
    const mock: AsBuiltObservation[] = designPoints.map((dp) => ({
      designPointId: dp.id,
      easting: dp.easting + 0.005,
      northing: dp.northing + 0.003,
    }));
    setAsBuilt(mock);
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Construction Setting-Out</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Generate stakeout instructions from design points, then verify as-built positions against the country's construction tolerance.
      </p>

      <div style={{ display: "flex", gap: "8px" }}>
        <button className="primary" onClick={run}>Generate Stakeout Plan</button>
        <button onClick={addAsBuilt} style={{ fontSize: "var(--text-sm)" }}>Load Mock As-Built (5mm offset)</button>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Left: Stakeout Instructions */}
          <div>
            <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Stakeout Instructions</h3>
            <div style={{ maxHeight: "300px", overflow: "auto" }}>
              <table>
                <thead>
                  <tr><th>ID</th><th>Method</th><th>From</th><th>Bearing</th><th>Distance</th></tr>
                </thead>
                <tbody>
                  {result.instructions.map((inst, i) => (
                    <tr key={i}>
                      <td>{inst.designPointId}</td>
                      <td>{inst.method}</td>
                      <td>{inst.fromControlId}</td>
                      <td>{inst.bearingDeg.toFixed(2)}°</td>
                      <td>{inst.distanceM.toFixed(3)}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: As-Built QC */}
          <div>
            <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>As-Built QC</h3>
            {result.results.length === 0 ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>No as-built observations loaded.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <div className={`badge ${result.allPass ? "success" : "error"}`}>
                    {result.allPass ? "ALL PASS" : `${result.failCount} FAILED`}
                  </div>
                  <div className="badge info">
                    Tolerance: {(result.horizontalToleranceM * 1000).toFixed(0)}mm
                  </div>
                </div>
                <div style={{ maxHeight: "250px", overflow: "auto" }}>
                  <table>
                    <thead>
                      <tr><th>ID</th><th>ΔE (mm)</th><th>ΔN (mm)</th><th>Horiz (mm)</th><th>Pass</th></tr>
                    </thead>
                    <tbody>
                      {result.results.map((r, i) => (
                        <tr key={i}>
                          <td>{r.designPointId}</td>
                          <td>{(r.deltaE * 1000).toFixed(1)}</td>
                          <td>{(r.deltaN * 1000).toFixed(1)}</td>
                          <td>{(r.horizontalResidual * 1000).toFixed(1)}</td>
                          <td>
                            <span className={`badge ${r.passes ? "success" : "error"}`} style={{ fontSize: "var(--text-xs)" }}>
                              {r.passes ? "✓" : "✗"}
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
        </div>
      )}
    </div>
  );
};
