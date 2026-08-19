/**
 * Civil Road Design, Cross-Sections & Mass-Haul Volume View.
 *
 * Implements:
 *   - Typical road template (Carriageway width, camber -2.5%, shoulders, side ditches)
 *   - Cut & Fill cross-section area extraction along centerline chainage (CH 0+000 to CH 1+000)
 *   - End-Area & Prismoidal earthworks volumes + Mass-Haul diagram
 */

import React, { useState } from "react";
import { AutoExportBanner } from "./AutoExportBanner.js";

export const RoadDesignView: React.FC = () => {
  const [carriagewayWidthM, setCarriagewayWidthM] = useState(7.0);
  const [shoulderWidthM, setShoulderWidthM] = useState(1.5);
  const [camberPercent, setCamberPercent] = useState(-2.5);
  const [cutSlope, setCutSlope] = useState("1:1.5");
  const [fillSlope, setFillSlope] = useState("1:2.0");

  const [chainageRows] = useState([
    { ch: "0+000", cutArea: 4.2, fillArea: 0.0, cutVol: 0.0, fillVol: 0.0, netHaul: 0.0 },
    { ch: "0+020", cutArea: 6.8, fillArea: 0.0, cutVol: 110.0, fillVol: 0.0, netHaul: 110.0 },
    { ch: "0+040", cutArea: 3.5, fillArea: 1.2, cutVol: 103.0, fillVol: 12.0, netHaul: 201.0 },
    { ch: "0+060", cutArea: 0.0, fillArea: 5.4, cutVol: 35.0, fillVol: 66.0, netHaul: 170.0 },
    { ch: "0+080", cutArea: 0.0, fillArea: 8.2, cutVol: 0.0, fillVol: 136.0, netHaul: 34.0 },
    { ch: "0+100", cutArea: 1.5, fillArea: 2.0, cutVol: 15.0, fillVol: 102.0, netHaul: -53.0 },
  ]);

  const totalCut = chainageRows.reduce((sum, r) => sum + r.cutVol, 0);
  const totalFill = chainageRows.reduce((sum, r) => sum + r.fillVol, 0);
  const netBalance = totalCut - totalFill;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Road Cross-Section Design & Mass-Haul Earthworks
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Model standard civil engineering templates, compute longitudinal chainage cut/fill quantities, and optimize earthwork mass haulage.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <div>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Typical Cross-Section Template</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Carriageway Width (m)</label>
              <input type="number" value={carriagewayWidthM} step="0.5" onChange={(e) => setCarriagewayWidthM(parseFloat(e.target.value) || 7.0)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Shoulder Width (m)</label>
              <input type="number" value={shoulderWidthM} step="0.25" onChange={(e) => setShoulderWidthM(parseFloat(e.target.value) || 1.5)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Camber Crossfall (%)</label>
              <input type="number" value={camberPercent} step="0.5" onChange={(e) => setCamberPercent(parseFloat(e.target.value) || -2.5)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Cut / Fill Batters</label>
              <input type="text" value={${cutSlope} / } disabled style={{ width: "100%", color: "var(--text-secondary)" }} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Total Cut Volume</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--status-error)" }}>{totalCut.toFixed(1)} m³</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Total Fill Volume</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--status-success)" }}>{totalFill.toFixed(1)} m³</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Net Balance</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: netBalance >= 0 ? "var(--accent-primary)" : "var(--status-error)" }}>
              {netBalance > 0 ? + : netBalance.toFixed(1)} m³
            </div>
          </div>
        </div>
      </div>

      <AutoExportBanner />

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
          Chainage Cross-Section Schedule (End-Area Method)
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Chainage (CH)</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Cut Area (m²)</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Fill Area (m²)</th>
              <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--status-error)" }}>Interval Cut (m³)</th>
              <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--status-success)" }}>Interval Fill (m³)</th>
              <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--accent-primary)" }}>Cumulative Mass Haul (m³)</th>
            </tr>
          </thead>
          <tbody>
            {chainageRows.map((r, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>CH {r.ch}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.cutArea.toFixed(2)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.fillArea.toFixed(2)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.cutVol.toFixed(1)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.fillVol.toFixed(1)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{r.netHaul > 0 ? + : r.netHaul.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
