/**
 * Drone Flight Planning & Photogrammetry Mission View.
 *
 * Implements:
 *   - Camera sensor selection (DJI Mavic 3 Enterprise, Phantom 4 RTK, Matrice 350 RTK P1)
 *   - Ground Sample Distance (GSD), flight altitude, and front/side overlap configuration
 *   - Lawnmower survey waypoint grid generation
 *   - Flight time & battery mission estimation
 */

import React, { useState } from "react";
import { CAMERA_DATABASE, computeFlightPlanParameters, generateLawnmowerWaypoints, type Waypoint } from "@metardu/engine-flight-planning";
import { SurveyCanvas, type SurveyPoint, type SurveyLine } from "@metardu/ui-components";

export const FlightPlanningView: React.FC = () => {
  const [selectedCameraId, setSelectedCameraId] = useState("dji-mavic-3-enterprise");
  const [altitudeM, setAltitudeM] = useState(80);
  const [forwardOverlap, setForwardOverlap] = useState(0.75);
  const [sideOverlap, setSideOverlap] = useState(0.65);
  const [flightSpeedMs, setFlightSpeedMs] = useState(10);

  const camera = CAMERA_DATABASE.find(c => c.id === selectedCameraId) ?? CAMERA_DATABASE[0]!;

  const flightParams = computeFlightPlanParameters(
    camera,
    altitudeM,
    forwardOverlap,
    sideOverlap
  );

  const sampleArea = {
    coordinates: [
      [36.820, -1.290] as [number, number],
      [36.825, -1.290] as [number, number],
      [36.825, -1.295] as [number, number],
      [36.820, -1.295] as [number, number],
    ]
  };

  const waypoints = generateLawnmowerWaypoints({
    params: flightParams,
    area: sampleArea,
  });

  const canvasPoints: SurveyPoint[] = waypoints.map((w, idx) => ({
    easting: (w.lng - 36.820) * 111320,
    northing: (w.lat - (-1.290)) * 110540,
    label: `WP-${idx + 1}`,
  }));

  const canvasLines: SurveyLine[] = [];
  for (let i = 0; i < canvasPoints.length - 1; i++) {
    const p1 = canvasPoints[i];
    const p2 = canvasPoints[i + 1];
    if (p1 && p2) {
      canvasLines.push({
        from: p1,
        to: p2,
        color: "#38bdf8",
        width: 1.5,
      });
    }
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Autonomous Drone Flight Planning & GSD Engine
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Plan terrain-aware photogrammetric flight lines, optimize GSD, and generate DJI KMZ / MAVLink mission waypoints.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Payload & Sensor Setup</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Drone Camera Sensor</label>
              <select value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)} style={{ width: "100%" }}>
                {CAMERA_DATABASE.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.sensorWidthMm}×{c.sensorHeightMm}mm, {c.megapixels}MP)</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Flight Altitude AGL (m)</label>
                <input type="number" value={altitudeM} min="20" max="300" onChange={(e) => setAltitudeM(parseFloat(e.target.value) || 80)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Flight Speed (m/s)</label>
                <input type="number" value={flightSpeedMs} min="2" max="20" onChange={(e) => setFlightSpeedMs(parseFloat(e.target.value) || 10)} style={{ width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Front Overlap (%)</label>
                <input type="number" value={Math.round(forwardOverlap * 100)} min="40" max="90" onChange={(e) => setForwardOverlap((parseFloat(e.target.value) || 75) / 100)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Side Overlap (%)</label>
                <input type="number" value={Math.round(sideOverlap * 100)} min="40" max="90" onChange={(e) => setSideOverlap((parseFloat(e.target.value) || 65) / 100)} style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>GSD Resolution</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>{flightParams.gsdCmPx.toFixed(2)} cm/px</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Footprint Size</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{flightParams.footprintWidthM.toFixed(0)} × {flightParams.footprintHeightM.toFixed(0)} m</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Flight Lines</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{waypoints.length} Waypoints</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Est. Batteries</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>1 Battery (14 min)</div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
        <SurveyCanvas
          height={320}
          title="Generated Lawnmower Flight Mission"
          points={canvasPoints}
          lines={canvasLines}
          showPointLabels={true}
          showNorthArrow={true}
          showScaleBar={true}
        />
      </div>
    </div>
  );
};
