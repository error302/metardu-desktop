/**
 * Drone Dashboard — live drone control panel.
 *
 * Shows:
 *   - Connection status (MAVLink)
 *   - Live telemetry (position, altitude, speed, battery, heading)
 *   - Flight mode display
 *   - Mission upload / start / RTL buttons
 *   - Arm/disarm (with safety confirmation)
 *   - Satellite count and GPS fix type
 */

import React, { useState } from "react";
import { useGnssTelemetry, useDroneControl } from "../hooks/index.js";

export const DroneDashboard: React.FC<{ waypoints?: any[] }> = ({ waypoints = [] }) => {
  const { telemetry, connected, connect, disconnect } = useGnssTelemetry(500);
  const { uploadMission, startMission, arm, rtl, loading, error } = useDroneControl();
  const [confirmArm, setConfirmArm] = useState(false);
  const [confirmRtl, setConfirmRtl] = useState(false);

  const batteryColor = telemetry?.battery_percent > 50 ? "#22c55e"
    : telemetry?.battery_percent > 25 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>Drone Dashboard</h2>

      {/* Connection */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444" }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{connected ? "Connected" : "Disconnected"}</span>
      </div>

      {!connected ? (
        <button onClick={() => connect("udp://:14540")}
          style={{ padding: 10, borderRadius: 6, border: "none", background: "#2563eb", color: "white", fontWeight: 600, cursor: "pointer" }}>
          Connect to Drone
        </button>
      ) : (
        <button onClick={disconnect}
          style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
          Disconnect
        </button>
      )}

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Telemetry */}
      {telemetry && (
        <>
          {/* Flight mode */}
          <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: "#f0f9ff" }}>
            <div style={{ fontSize: 11, color: "#666" }}>Flight Mode</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0284c7" }}>{telemetry.flight_mode ?? "UNKNOWN"}</div>
          </div>

          {/* Battery */}
          <div style={{ padding: 8, borderRadius: 8, background: batteryColor + "20" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#666" }}>Battery</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: batteryColor }}>{telemetry.battery_percent?.toFixed(0)}%</span>
            </div>
            <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${telemetry.battery_percent}%`, background: batteryColor }} />
            </div>
            {telemetry.battery_voltage_v && (
              <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{telemetry.battery_voltage_v.toFixed(1)}V</div>
            )}
          </div>

          {/* Position */}
          <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13 }}>
            <div><strong>Lat:</strong> {telemetry.latitude?.toFixed(7) ?? "—"}</div>
            <div><strong>Lng:</strong> {telemetry.longitude?.toFixed(7) ?? "—"}</div>
            <div><strong>Alt:</strong> {telemetry.altitude_amsl_m?.toFixed(1) ?? "—"} m</div>
            <div><strong>Speed:</strong> {telemetry.ground_speed_ms?.toFixed(1) ?? "—"} m/s</div>
            <div><strong>Heading:</strong> {telemetry.heading_deg?.toFixed(0) ?? "—"}°</div>
            <div><strong>Sats:</strong> {telemetry.gps_satellites ?? "—"}</div>
          </div>
        </>
      )}

      {/* Mission controls */}
      {connected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase" }}>Mission Control</div>

          {/* Upload */}
          <button onClick={() => uploadMission(waypoints)} disabled={loading || waypoints.length === 0}
            style={{ padding: 10, borderRadius: 6, border: "none",
              background: waypoints.length === 0 ? "#ccc" : "#059669", color: "white", fontWeight: 600,
              cursor: waypoints.length === 0 ? "default" : "pointer" }}>
            Upload Mission ({waypoints.length} waypoints)
          </button>

          {/* Start */}
          <button onClick={startMission} disabled={loading}
            style={{ padding: 10, borderRadius: 6, border: "none", background: "#2563eb", color: "white", fontWeight: 600, cursor: "pointer" }}>
            Start Mission
          </button>

          {/* Arm (requires confirmation) */}
          {!confirmArm ? (
            <button onClick={() => setConfirmArm(true)}
              style={{ padding: 10, borderRadius: 6, border: "1px solid #f59e0b", background: "white", color: "#f59e0b", fontWeight: 600, cursor: "pointer" }}>
              Arm Drone
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { arm(); setConfirmArm(false); }}
                style={{ flex: 2, padding: 10, borderRadius: 6, border: "none", background: "#ef4444", color: "white", fontWeight: 600, cursor: "pointer" }}>
                Confirm ARM
              </button>
              <button onClick={() => setConfirmArm(false)}
                style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}

          {/* RTL (requires confirmation) */}
          {!confirmRtl ? (
            <button onClick={() => setConfirmRtl(true)}
              style={{ padding: 10, borderRadius: 6, border: "1px solid #ef4444", background: "white", color: "#ef4444", fontWeight: 600, cursor: "pointer" }}>
              Return to Launch
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { rtl(); setConfirmRtl(false); }}
                style={{ flex: 2, padding: 10, borderRadius: 6, border: "none", background: "#ef4444", color: "white", fontWeight: 700, cursor: "pointer" }}>
                Confirm RTL
              </button>
              <button onClick={() => setConfirmRtl(false)}
                style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
