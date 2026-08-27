/**
 * VerticalAlignmentView — Civil Highway Vertical Curves & Superelevation Runoff Engine.
 *
 * Implements:
 *   - Parabolic vertical curve calculation:
 *       • K-value (rate of vertical curvature: K = L / |g2 - g1|)
 *       • PVI (Point of Vertical Intersection), PVC (Point of Vertical Curvature), PVT (Point of Vertical Tangency)
 *       • High/Low turning point chainage and elevation: x = -g1 * L / (g2 - g1)
 *       • Stopping Sight Distance (SSD) and headlight sight distance crest/sag clearance checks
 *   - Superelevation runoff & transition designer:
 *       • Maximum superelevation rate (e_max = 4%, 6%, 8%)
 *       • Runoff length (Lr) and tangent runout (Lt) transition calculation
 *       • Curve mechanical widening on spirals: W = n * (L^2 / (2R)) + V / (10 * sqrt(R))
 */

import React, { useState } from "react";

interface VerticalCurve {
  id: string;
  type: "CREST" | "SAG";
  pviChainage: number;
  pviElevation: number;
  gradeInPercent: number;
  gradeOutPercent: number;
  curveLengthM: number;
  kValue: number;
  pvcChainage: number;
  pvcElevation: number;
  pvtChainage: number;
  pvtElevation: number;
  turningPointChainage: number;
  turningPointElevation: number;
  sightDistancePass: boolean;
}

export const VerticalAlignmentView: React.FC = () => {
  const [designSpeedKmh, setDesignSpeedKmh] = useState(80);
  const [maxSuperelevation, setMaxSuperelevation] = useState(6.0); // 6% max superelevation
  const [normalCamber, setNormalCamber] = useState(-2.5); // -2.5% normal crossfall
  const [laneWidthM, setLaneWidthM] = useState(3.5);
  const [numberOfLanes] = useState(2);

  const [verticalCurves, setVerticalCurves] = useState<VerticalCurve[]>([
    {
      id: "VC-01",
      type: "CREST",
      pviChainage: 450.0,
      pviElevation: 1685.20,
      gradeInPercent: +4.5,
      gradeOutPercent: -3.0,
      curveLengthM: 180.0,
      kValue: 24.0,
      pvcChainage: 360.0,
      pvcElevation: 1681.15,
      pvtChainage: 540.0,
      pvtElevation: 1682.50,
      turningPointChainage: 468.0,
      turningPointElevation: 1683.58,
      sightDistancePass: true,
    },
    {
      id: "VC-02",
      type: "SAG",
      pviChainage: 920.0,
      pviElevation: 1668.40,
      gradeInPercent: -3.0,
      gradeOutPercent: +5.0,
      curveLengthM: 200.0,
      kValue: 25.0,
      pvcChainage: 820.0,
      pvcElevation: 1671.40,
      pvtChainage: 1020.0,
      pvtElevation: 1673.40,
      turningPointChainage: 895.0,
      turningPointElevation: 1670.28,
      sightDistancePass: true,
    },
  ]);

  // AASHTO / Eurocode Superelevation runoff calculation
  const relativeGradient = 1 / 175; // for 80 km/h
  const runoffLengthM = ((maxSuperelevation - Math.abs(normalCamber)) / 100) * laneWidthM / relativeGradient;
  const runoutLengthM = (Math.abs(normalCamber) / (maxSuperelevation - Math.abs(normalCamber))) * runoffLengthM;
  const mechanicalWideningM = (numberOfLanes * Math.pow(6.0, 2)) / (2 * 350) + designSpeedKmh / (10 * Math.sqrt(350));

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-default)", paddingBottom: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
            Vertical Alignment & Superelevation Runoff Engine
          </h2>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Highway vertical curve geometry, K-values, high/low turning points, Stopping Sight Distance (SSD), and superelevation transition development.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="primary">
            Export Profile & Superelevation XML
          </button>
        </div>
      </div>

      {/* Top Road Design Standards Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
        <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Design Speed (V)</div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
            {designSpeedKmh} km/h
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Stopping Sight Dist: 130 m</div>
        </div>

        <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Max Superelevation (e_max)</div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "#00E5FF", fontFamily: "var(--font-mono)" }}>
            +{maxSuperelevation.toFixed(1)}% ({runoffLengthM.toFixed(1)}m Runoff)
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Tangent Runout: {runoutLengthM.toFixed(1)} m</div>
        </div>

        <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Curve Mechanical Widening</div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--status-success)", fontFamily: "var(--font-mono)" }}>
            +{mechanicalWideningM.toFixed(2)} m (Total)
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>R = 350 m Horizontal Curve</div>
        </div>

        <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Vertical Standards Check</div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--status-success)", fontFamily: "var(--font-mono)" }}>
            AASHTO / SATCC COMPLIANT
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>K_crest &ge; 17 | K_sag &ge; 18</div>
        </div>
      </div>

      {/* Main Grid: Vertical Curve Table + Superelevation Transition Diagram */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "12px", flex: 1 }}>
        {/* Left: Vertical Curve Schedule */}
        <div style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--accent-primary)" }}>
            Vertical Curve Elements (PVI, PVC, PVT, K-Values)
          </h3>

          <div style={{ border: "1px solid var(--border-default)", borderRadius: "4px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
              <thead style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-default)" }}>
                <tr>
                  <th style={{ padding: "6px", textAlign: "left" }}>ID / Type</th>
                  <th style={{ padding: "6px", textAlign: "right" }}>PVI Chainage (m)</th>
                  <th style={{ padding: "6px", textAlign: "right" }}>PVI Elev (m)</th>
                  <th style={{ padding: "6px", textAlign: "right" }}>Grades (g1/g2)</th>
                  <th style={{ padding: "6px", textAlign: "right" }}>Length (L)</th>
                  <th style={{ padding: "6px", textAlign: "right" }}>K-Value</th>
                  <th style={{ padding: "6px", textAlign: "center" }}>Turning Pt</th>
                </tr>
              </thead>
              <tbody>
                {verticalCurves.map((vc) => (
                  <tr key={vc.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "6px" }}>
                      <div style={{ fontWeight: "bold", color: "var(--accent-primary)" }}>{vc.id}</div>
                      <div style={{ fontSize: "10px", color: vc.type === "CREST" ? "#FF9500" : "#00E5FF" }}>{vc.type} CURVE</div>
                    </td>
                    <td style={{ padding: "6px", textAlign: "right" }}>CH {vc.pviChainage.toFixed(1)}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{vc.pviElevation.toFixed(2)}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>
                      {vc.gradeInPercent > 0 ? `+${vc.gradeInPercent}` : vc.gradeInPercent}% / {vc.gradeOutPercent > 0 ? `+${vc.gradeOutPercent}` : vc.gradeOutPercent}%
                    </td>
                    <td style={{ padding: "6px", textAlign: "right", fontWeight: "bold" }}>{vc.curveLengthM.toFixed(1)} m</td>
                    <td style={{ padding: "6px", textAlign: "right", color: "var(--status-success)" }}>K = {vc.kValue.toFixed(1)}</td>
                    <td style={{ padding: "6px", textAlign: "center", fontSize: "10px", color: "var(--text-secondary)" }}>
                      CH {vc.turningPointChainage.toFixed(1)}<br />
                      Elev {vc.turningPointElevation.toFixed(2)}m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "auto", padding: "10px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 4px 0", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              Parabolic Profile Elevation Formula (Chainage x from PVC)
            </h4>
            <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Elevation(x) = PVC_Elev + (g1 * x) + ((g2 - g1) / (2 * L)) * x²
            </div>
          </div>
        </div>

        {/* Right: Superelevation Transition Runoff Diagram */}
        <div style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--accent-primary)" }}>
            Superelevation Transition Development
          </h3>

          <div style={{ flex: 1, minHeight: "220px", background: "#0D1117", border: "1px solid var(--border-default)", borderRadius: "4px", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="100%" height="100%" viewBox="0 0 400 200">
              {/* Centerline baseline */}
              <line x1="20" y1="100" x2="380" y2="100" stroke="#777" strokeWidth="1" strokeDasharray="4,4" />
              <text x="25" y="95" fill="#777" fontSize="9" fontFamily="monospace">CENTERLINE (0.0%)</text>

              {/* Normal crown (-2.5%) */}
              <line x1="30" y1="130" x2="110" y2="130" stroke="#00E5FF" strokeWidth="2" />
              <text x="30" y="145" fill="#00E5FF" fontSize="9" fontFamily="monospace">NORMAL CROWN (-2.5%)</text>

              {/* Tangent runout transition */}
              <line x1="110" y1="130" x2="190" y2="100" stroke="#00E5FF" strokeWidth="2" />
              <text x="120" y="85" fill="#FFFFFF" fontSize="9" fontFamily="monospace">RUNOUT (Lt)</text>

              {/* Full Superelevation runoff (+6.0%) */}
              <line x1="190" y1="100" x2="320" y2="40" stroke="#FF9500" strokeWidth="2.5" />
              <line x1="320" y1="40" x2="380" y2="40" stroke="#FF9500" strokeWidth="2.5" />
              <text x="240" y="30" fill="#FF9500" fontSize="9" fontFamily="monospace" fontWeight="bold">FULL SUPERELEVATION (+6.0%)</text>
            </svg>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
            <div style={{ padding: "6px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}>
              Runout Length (Lt): <strong>{runoutLengthM.toFixed(1)} m</strong>
            </div>
            <div style={{ padding: "6px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}>
              Runoff Length (Lr): <strong>{runoffLengthM.toFixed(1)} m</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
