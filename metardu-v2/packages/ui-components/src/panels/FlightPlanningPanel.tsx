/**
 * Flight Planning Panel — drone survey mission planning UI.
 *
 * Lets the surveyor:
 *   1. Select a camera (dropdown with 12 drone cameras)
 *   2. Set altitude, front overlap, side overlap
 *   3. Draw a survey area on the map (or paste coordinates)
 *   4. See computed GSD, footprint, waypoint count, flight time, batteries
 *   5. Export to DJI KMZ, ArduPilot .waypoints, Litchi CSV, senseFly XML, KML
 */

import React, { useState, useCallback } from "react";
import { useFlightPlanning } from "../hooks/index.js";

const CAMERAS = [
  { id: "dji-mavic-3-enterprise", name: "DJI Mavic 3 Enterprise" },
  { id: "dji-phantom-4-rtk", name: "DJI Phantom 4 RTK" },
  { id: "dji-mini-4-pro", name: "DJI Mini 4 Pro" },
  { id: "dji-matrice-350-p1-35mm", name: "DJI Matrice 350 + P1 (35mm)" },
  { id: "sensefly-ebee-x-soda3d", name: "senseFly eBee X" },
  { id: "autel-evo-ii-pro-rtk", name: "Autel EVO II Pro RTK" },
];

const FORMATS = [
  { id: "dji-kmz", name: "DJI KMZ (Pilot 2)" },
  { id: "ardupilot-waypoints", name: "ArduPilot .waypoints (QGC)" },
  { id: "litchi-csv", name: "Litchi CSV" },
  { id: "sensefly-xml", name: "senseFly XML" },
  { id: "kml", name: "Generic KML" },
];

export const FlightPlanningPanel: React.FC = () => {
  const { plan, exportMission, result, loading, error } = useFlightPlanning();

  const [cameraId, setCameraId] = useState("dji-mavic-3-enterprise");
  const [altitude, setAltitude] = useState(75);
  const [frontOverlap, setFrontOverlap] = useState(75);
  const [sideOverlap, setSideOverlap] = useState(65);
  const [areaCoords, setAreaCoords] = useState("");
  const [exportFormat, setExportFormat] = useState("dji-kmz");

  const handlePlan = useCallback(() => {
    const coords = areaCoords
      .trim().split("\n")
      .map(line => {
        const [lat, lng] = line.trim().split(",").map(parseFloat);
        return { lat, lng };
      })
      .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    // Close the polygon if not closed
    if (coords.length > 0 && (coords[0].lat !== coords[coords.length - 1].lat ||
        coords[0].lng !== coords[coords.length - 1].lng)) {
      coords.push({ ...coords[0] });
    }

    plan({
      cameraId,
      altitudeM: altitude,
      frontOverlap: frontOverlap / 100,
      sideOverlap: sideOverlap / 100,
      area: { coordinates: coords },
    });
  }, [cameraId, altitude, frontOverlap, sideOverlap, areaCoords, plan]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>Flight Planning</h2>

      {/* Camera selection */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Camera</span>
        <select value={cameraId} onChange={e => setCameraId(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}>
          {CAMERAS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      {/* Parameters */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Altitude (m AGL)</span>
          <input type="number" value={altitude} onChange={e => setAltitude(Number(e.target.value))}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Front Overlap (%)</span>
          <input type="number" value={frontOverlap} onChange={e => setFrontOverlap(Number(e.target.value))}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Side Overlap (%)</span>
          <input type="number" value={sideOverlap} onChange={e => setSideOverlap(Number(e.target.value))}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
      </div>

      {/* Survey area coordinates */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Survey Area (lat,lng per line)</span>
        <textarea
          value={areaCoords}
          onChange={e => setAreaCoords(e.target.value)}
          placeholder={"-1.2864,36.8172\n-1.2774,36.8172\n-1.2774,36.8227\n-1.2864,36.8227"}
          rows={5}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }}
        />
      </label>

      <button onClick={handlePlan} disabled={loading}
        style={{ padding: 10, borderRadius: 6, border: "none", background: loading ? "#ccc" : "#2563eb", color: "white", fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
        {loading ? "Computing..." : "Plan Mission"}
      </button>

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Results */}
      {result && (
        <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#333" }}>Mission Summary</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            <div><strong>GSD:</strong> {result.params?.gsdCmPx?.toFixed(2) ?? "—"} cm/px</div>
            <div><strong>Altitude:</strong> {result.params?.altitudeM ?? "—"} m</div>
            <div><strong>Footprint:</strong> {result.params?.footprintWidthM?.toFixed(1) ?? "—"} × {result.params?.footprintHeightM?.toFixed(1) ?? "—"} m</div>
            <div><strong>Photo spacing:</strong> {result.params?.photoSpacingM?.toFixed(1) ?? "—"} m</div>
            <div><strong>Waypoints:</strong> {result.waypoints?.length ?? "—"}</div>
            <div><strong>Flight lines:</strong> {result.stats?.flightLineCount ?? "—"}</div>
            <div><strong>Distance:</strong> {((result.stats?.totalDistanceMeters ?? 0) / 1000).toFixed(2)} km</div>
            <div><strong>Flight time:</strong> {result.stats?.estimatedFlightTimeMin?.toFixed(1) ?? "—"} min</div>
            <div><strong>Batteries:</strong> {result.battery?.batteryCount ?? "—"}</div>
            <div><strong>Total mission:</strong> {result.battery?.totalMissionTimeMin?.toFixed(0) ?? "—"} min</div>
          </div>

          {/* Export */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <select value={exportFormat} onChange={e => setExportFormat(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", flex: 1 }}>
              {FORMATS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button onClick={() => exportMission(result.waypoints, exportFormat, `/tmp/mission${exportFormat === "dji-kmz" ? ".kmz" : exportFormat === "litchi-csv" ? ".csv" : ".txt"}`)}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#059669", color: "white", fontWeight: 600, cursor: "pointer" }}>
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
