/**
 * Drone Flight Planning & Photogrammetry Mission View.
 *
 * Implements:
 *   - Camera sensor selection (DJI Mavic 3 Enterprise, Phantom 4 RTK, Matrice 350 RTK P1)
 *   - Ground Sample Distance (GSD), flight altitude, and front/side overlap configuration
 *   - Lawnmower survey waypoint grid generation
 *   - Flight time & battery mission estimation
 */

import React, { useMemo, useState } from "react";
import { CAMERA_DATABASE, computeFlightPlanParameters, generateLawnmowerWaypoints, type SurveyArea } from "@metardu/engine-flight-planning";

export const FlightPlanningView: React.FC = () => {
  const [selectedCameraId, setSelectedCameraId] = useState("dji-mavic-3-enterprise");
  const [altitudeM, setAltitudeM] = useState(80);
  const [forwardOverlap, setForwardOverlap] = useState(0.75);
  const [sideOverlap, setSideOverlap] = useState(0.65);
  const [areaInput, setAreaInput] = useState("");

  const camera = CAMERA_DATABASE.find(c => c.id === selectedCameraId) ?? CAMERA_DATABASE[0]!;

  const flightParams = computeFlightPlanParameters(
    camera,
    altitudeM,
    forwardOverlap,
    sideOverlap
  );

  const parsedArea = useMemo((): { area: SurveyArea | null; error: string | null } => {
    const lines = areaInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return { area: null, error: null };

    const coordinates: SurveyArea["coordinates"] = [];
    for (const [index, line] of lines.entries()) {
      const parts = line.split(",").map((part) => Number(part.trim()));
      const [lat, lng] = parts;
      if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lng) || lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) {
        return { area: null, error: `Line ${index + 1} must contain valid WGS84 latitude,longitude.` };
      }
      coordinates.push({ lat: lat!, lng: lng! });
    }

    if (coordinates.length < 4) return { area: null, error: "Enter at least three vertices and repeat the first coordinate to close the polygon." };
    const first = coordinates[0]!;
    const last = coordinates[coordinates.length - 1]!;
    if (first.lat !== last.lat || first.lng !== last.lng) {
      return { area: null, error: "The polygon must be closed by repeating its first coordinate on the last line." };
    }
    return { area: { coordinates }, error: null };
  }, [areaInput]);

  const waypoints = useMemo(() => {
    if (!parsedArea.area) return [];
    try {
      return generateLawnmowerWaypoints({ params: flightParams, area: parsedArea.area });
    } catch {
      return [];
    }
  }, [parsedArea, flightParams]);
  const flightLineCount = new Set(waypoints.map((waypoint) => waypoint.flightLine)).size;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Autonomous Drone Flight Planning & GSD Engine
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Generate a draft lawnmower route from an explicit WGS84 polygon. Height conversion, device export, and aircraft validation are not provided by this screen.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Payload & Sensor Setup</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Drone Camera Sensor</label>
              <select value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)} style={{ width: "100%" }}>
                {CAMERA_DATABASE.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.sensorWidthMm}×{c.sensorHeightMm}mm, {(c.imageWidthPx * c.imageHeightPx / 1_000_000).toFixed(1)} MP)</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Flight Altitude AGL (m)</label>
                <input type="number" value={altitudeM} min="20" max="300" onChange={(e) => setAltitudeM(parseFloat(e.target.value) || 80)} style={{ width: "100%" }} />
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
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{flightLineCount}</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Route State</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{parsedArea.area ? "Draft" : "Needs area"}</div>
          </div>
        </div>
      </div>

      <section style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
        <label htmlFor="flight-area-wgs84" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Survey polygon (WGS84 latitude,longitude; repeat first point to close)</label>
        <textarea
          id="flight-area-wgs84"
          value={areaInput}
          onChange={(event) => setAreaInput(event.target.value)}
          placeholder={"51.5000,-0.1200\n51.5010,-0.1200\n51.5010,-0.1180\n51.5000,-0.1180\n51.5000,-0.1200"}
          rows={5}
          spellCheck={false}
          style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: "12px" }}
        />
        <div style={{ marginTop: "6px", fontSize: "11px", color: parsedArea.error ? "var(--status-error, #EF4444)" : "var(--text-tertiary)" }}>
          {parsedArea.error ?? (parsedArea.area ? `${waypoints.length} draft waypoints across ${flightLineCount} flight lines. Coordinates remain WGS84.` : "No project area selected. Enter a closed polygon to generate a draft route.")}
        </div>
      </section>

      {waypoints.length > 0 && (
        <section style={{ border: "1px solid var(--border-default)", maxHeight: "320px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
            <thead><tr><th style={{ textAlign: "left", padding: "6px" }}>#</th><th style={{ textAlign: "left", padding: "6px" }}>Lat (°)</th><th style={{ textAlign: "left", padding: "6px" }}>Lon (°)</th><th style={{ textAlign: "left", padding: "6px" }}>Height input (m)</th></tr></thead>
            <tbody>{waypoints.map((waypoint) => (
              <tr key={waypoint.index}><td style={{ padding: "5px 6px" }}>{waypoint.index + 1}</td><td style={{ padding: "5px 6px" }}>{waypoint.latitude.toFixed(8)}</td><td style={{ padding: "5px 6px" }}>{waypoint.longitude.toFixed(8)}</td><td style={{ padding: "5px 6px" }}>{waypoint.altitudeMeters.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
};
