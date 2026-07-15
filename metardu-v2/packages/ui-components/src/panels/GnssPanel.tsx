/**
 * GNSS Panel — live GNSS receiver monitoring.
 *
 * Shows:
 *   - Connection status (connect/disconnect NTRIP)
 *   - Current fix quality (GPS/DGPS/RTK Fixed/RTK Float)
 *   - Position (lat/lng/height)
 *   - Satellites used/visible
 *   - DOP values (HDOP/VDOP/PDOP)
 *   - Skyplot SVG (satellite positions)
 *   - Accuracy estimation (CEP, R95)
 *   - NTRIP caster selection
 */

import React, { useState, useEffect } from "react";
import { useGnssTelemetry } from "../hooks/index.js";

const NTRIP_PRESETS = [
  { name: "Kenya CORS — Nairobi", url: "ntrip://kencors.go.ke:2101/NAIROBI_RTCM3" },
  { name: "Kenya CORS — Mombasa", url: "ntrip://kencors.go.ke:2101/MOMBASA_RTCM3" },
  { name: "Kenya CORS — Nakuru", url: "ntrip://kencors.go.ke:2101/NAKURU_RTCM3" },
  { name: "Tanzania — Dar es Salaam", url: "ntrip://ntrip.pec.go.tz:2101/DAR_ES_SALAAM" },
  { name: "Uganda — Kampala", url: "ntrip://ntrip.unma.or.ug:2101/KAMPALA" },
  { name: "Manual URL", url: "" },
];

const FIX_COLORS: Record<number, string> = {
  0: "#ef4444", // No fix — red
  1: "#f59e0b", // GPS SPS — amber
  2: "#3b82f6", // DGPS — blue
  4: "#22c55e", // RTK Fixed — green
  5: "#f59e0b", // RTK Float — amber
  9: "#3b82f6", // SBAS — blue
};

const FIX_NAMES: Record<number, string> = {
  0: "NO FIX",
  1: "GPS SPS (3-10m)",
  2: "DGPS (0.5-3m)",
  4: "RTK FIXED (<2cm)",
  5: "RTK FLOAT (20cm-1m)",
  9: "SBAS (0.5-2m)",
};

export const GnssPanel: React.FC = () => {
  const { telemetry, connected, error, connect, disconnect } = useGnssTelemetry(1000);
  const [ntripUrl, setNtripUrl] = useState(NTRIP_PRESETS[0]!.url);
  const [skyplotSvg, setSkyplotSvg] = useState<string>("");

  // Generate skyplot from telemetry (if satellites available)
  useEffect(() => {
    if (telemetry?.satellites) {
      import("@metardu/engine-v2").then(({ generateSkyplotSvg }) => {
        setSkyplotSvg(generateSkyplotSvg(telemetry.satellites));
      });
    }
  }, [telemetry]);

  const fixQuality = telemetry?.flight_mode ? 4 : telemetry?.fixQuality ?? 0;
  const fixColor = FIX_COLORS[fixQuality] ?? "#666";
  const fixName = FIX_NAMES[fixQuality] ?? "UNKNOWN";

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>GNSS Monitor</h2>

      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444" }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{connected ? "Connected" : "Disconnected"}</span>
      </div>

      {/* Connect/Disconnect */}
      {!connected ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#666" }}>NTRIP Caster</span>
            <select value={ntripUrl} onChange={e => setNtripUrl(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}>
              {NTRIP_PRESETS.map((p, i) => <option key={i} value={p.url}>{p.name}</option>)}
            </select>
          </label>
          {ntripUrl === "" && (
            <input type="text" placeholder="ntrip://host:port/mountpoint"
              onChange={e => setNtripUrl(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
          )}
          <button onClick={() => connect(ntripUrl || undefined)}
            style={{ padding: 10, borderRadius: 6, border: "none", background: "#2563eb", color: "white", fontWeight: 600, cursor: "pointer" }}>
            Connect
          </button>
        </>
      ) : (
        <button onClick={disconnect}
          style={{ padding: 10, borderRadius: 6, border: "1px solid #ef4444", background: "white", color: "#ef4444", fontWeight: 600, cursor: "pointer" }}>
          Disconnect
        </button>
      )}

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Fix quality — big display */}
      <div style={{ textAlign: "center", padding: 16, borderRadius: 12, background: fixColor + "20" }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: fixColor }}>{fixName}</div>
      </div>

      {/* Position */}
      {telemetry && (
        <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
          <div><strong>Lat:</strong> {telemetry.latitude?.toFixed(8) ?? "—"}</div>
          <div><strong>Lng:</strong> {telemetry.longitude?.toFixed(8) ?? "—"}</div>
          <div><strong>Elev:</strong> {telemetry.altitude_amsl_m?.toFixed(3) ?? "—"} m</div>
          <div><strong>Sats:</strong> {telemetry.gps_satellites ?? "—"}</div>
          <div><strong>HDOP:</strong> {telemetry.hdop?.toFixed(2) ?? "—"}</div>
          <div><strong>Battery:</strong> {telemetry.battery_percent?.toFixed(0) ?? "—"}%</div>
        </div>
      )}

      {/* Skyplot */}
      {skyplotSvg && (
        <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Skyplot</div>
          <div dangerouslySetInnerHTML={{ __html: skyplotSvg }} style={{ display: "flex", justifyContent: "center" }} />
        </div>
      )}

      {/* Accuracy estimation */}
      {telemetry?.hdop != null && (
        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Estimated Accuracy</div>
          <div>Horizontal (2DRMS): {(2 * telemetry.hdop * 3.0).toFixed(2)} m</div>
          <div>CEP (50%): {(0.59 * telemetry.hdop * 3.0).toFixed(2)} m</div>
          <div>R95 (95%): {(1.73 * telemetry.hdop * 3.0).toFixed(2)} m</div>
        </div>
      )}
    </div>
  );
};
