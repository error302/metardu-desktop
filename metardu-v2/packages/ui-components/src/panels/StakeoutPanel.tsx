/**
 * Stakeout Panel — real-time field guidance for staking design points.
 *
 * Shows the surveyor:
 *   - Current target point ID and description
 *   - Distance to go (big number, color-coded)
 *   - Direction (left/right, forward/back with arrows)
 *   - Cut/Fill (elevation difference)
 *   - Progress bar (X of Y points staked)
 *   - Skip / Mark Staked buttons
 *
 * This is the most-used panel in the field — designed for
 * glanceability (surveyor reads it while walking).
 */

import React, { useState, useEffect } from "react";
import { useStakeout } from "../hooks/index.js";

export const StakeoutPanel: React.FC<{ designPoints: any[] }> = ({ designPoints }) => {
  const { guidance, active, start, stop, update, skipPoint, progress } = useStakeout(designPoints);

  // Simulated rover position (in production, fed from GNSS/total station)
  const [roverPos, setRoverPos] = useState({ easting: 0, northing: 0, elevation: 0, heading: 0 });

  useEffect(() => {
    if (!active) return;
    // In production: subscribe to GNSS NMEA stream or total station driver
    // For demo: simulate position updates
    const interval = setInterval(() => {
      if (guidance?.target) {
        // Move toward target
        setRoverPos(prev => ({
          easting: prev.easting + (guidance.target.easting - prev.easting) * 0.1,
          northing: prev.northing + (guidance.target.northing - prev.northing) * 0.1,
          elevation: prev.elevation + (guidance.target.elevation - prev.elevation) * 0.1,
          heading: guidance.bearing,
        }));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [active, guidance]);

  useEffect(() => {
    if (active) {
      update(roverPos);
    }
  }, [roverPos, active, update]);

  if (!active) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>Stakeout</h2>
        <p style={{ color: "#666" }}>{designPoints.length} design points loaded</p>
        <button onClick={start}
          style={{ padding: 12, borderRadius: 8, border: "none", background: "#2563eb", color: "white", fontWeight: 600, cursor: "pointer", width: "100%" }}>
          Start Stakeout
        </button>
      </div>
    );
  }

  const statusColor = guidance?.status === "within_tolerance" ? "#22c55e"
    : guidance?.status === "close" ? "#f59e0b" : "#6b7280";

  const distColor = guidance?.distance < 0.02 ? "#22c55e"
    : guidance?.distance < 0.5 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>Stakeout</h2>
        <button onClick={stop}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
          Stop
        </button>
      </div>

      {/* Progress */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 4 }}>
          <span>Progress</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress * 100}%`, background: "#2563eb", transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Target point */}
      <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase" }}>Target Point</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#333" }}>{guidance?.target?.label ?? "—"}</div>
        <div style={{ fontSize: 12, color: "#666" }}>
          E: {guidance?.target?.easting?.toFixed(3)} | N: {guidance?.target?.northing?.toFixed(3)} | H: {guidance?.target?.elevation?.toFixed(3)}
        </div>
      </div>

      {/* Distance — big number */}
      <div style={{ textAlign: "center", padding: 16, background: statusColor + "20", borderRadius: 12 }}>
        <div style={{ fontSize: 48, fontWeight: 900, color: distColor, lineHeight: 1 }}>
          {guidance?.distance?.toFixed(3) ?? "—"}
        </div>
        <div style={{ fontSize: 14, color: "#666" }}>meters to go</div>
      </div>

      {/* Direction */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: 12 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24 }}>{guidance?.rightOffset > 0.001 ? "→" : guidance?.rightOffset < -0.001 ? "←" : "·"}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{Math.abs(guidance?.rightOffset ?? 0).toFixed(3)}m</div>
          <div style={{ fontSize: 10, color: "#999" }}>{guidance?.rightOffset > 0 ? "RIGHT" : guidance?.rightOffset < 0 ? "LEFT" : "—"}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24 }}>{guidance?.forwardOffset > 0.001 ? "↑" : guidance?.forwardOffset < -0.001 ? "↓" : "·"}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{Math.abs(guidance?.forwardOffset ?? 0).toFixed(3)}m</div>
          <div style={{ fontSize: 10, color: "#999" }}>{guidance?.forwardOffset > 0 ? "FORWARD" : guidance?.forwardOffset < 0 ? "BACK" : "—"}</div>
        </div>
      </div>

      {/* Cut/Fill */}
      {guidance?.cutFill !== null && guidance?.cutFill !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: 12, borderRadius: 8,
          background: Math.abs(guidance.cutFill) < 0.02 ? "#22c55e20" : "#f59e0b20" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {guidance.cutFill > 0 ? "▲ FILL" : "▼ CUT"}
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: Math.abs(guidance.cutFill) < 0.02 ? "#22c55e" : "#f59e0b" }}>
            {Math.abs(guidance.cutFill).toFixed(3)}m
          </span>
        </div>
      )}

      {/* Status */}
      <div style={{ textAlign: "center", padding: 8, borderRadius: 6, background: statusColor + "20" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: statusColor, textTransform: "uppercase" }}>
          {guidance?.status?.replace(/_/g, " ") ?? "—"}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={skipPoint}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
          Skip
        </button>
        <button
          onClick={() => { if (guidance?.target) { /* markStaked is handled in hook */ } }}
          disabled={guidance?.status !== "within_tolerance"}
          style={{ flex: 2, padding: 10, borderRadius: 6, border: "none",
            background: guidance?.status === "within_tolerance" ? "#22c55e" : "#ccc",
            color: "white", fontWeight: 600, cursor: guidance?.status === "within_tolerance" ? "pointer" : "default" }}>
          ✓ Mark Staked
        </button>
      </div>
    </div>
  );
};
