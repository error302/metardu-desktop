/**
 * Instrument Monitor View — live instrument connection management.
 *
 * Provides a UI for:
 *   - Connecting to surveying instruments (serial, BLE, NTRIP)
 *   - Monitoring live data streams (NMEA observations, Leica GSI records)
 *   - Displaying DOP gauges and fix quality indicators
 *   - Showing a satellite skyplot from GSV sentences
 *   - Recording points from the live stream into the project
 *
 * Keyboard shortcut: `g g` (GNSS Monitor).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Radio,
  Bluetooth,
  Wifi,
  WifiOff,
  CircleDot,
  Circle,
  Signal,
  Satellite,
  Target,
  RefreshCw,
  Plug,
  Unplug,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Clock,
  ArrowUp,
  ArrowDown,
  Plus,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────

interface SerialPort {
  port_name: string;
  display_name: string;
  is_usb: boolean;
  manufacturer?: string;
  product?: string;
}

interface BleDevice {
  name: string;
  address: string;
  rssi: number;
  service_uuids: string[];
}

interface Connection {
  id: string;
  connection_type: string;
  port: string;
  status: string;
  instrument_name?: string;
  protocol?: string;
  data_rate_hz?: number;
  observation_count: number;
  connected_at?: string;
}

interface NmeaObservation {
  talker: string;
  sentence_type: string;
  timestamp: string;
  data: {
    fix_quality?: number;
    satellite_count?: number;
    hdop?: number;
    altitude_m?: number;
    latitude?: number;
    longitude?: number;
    satellites_in_view?: number;
    satellites?: Array<{
      prn: number;
      elevation: number;
      azimuth: number;
      snr: number;
      constellation: string;
    }>;
    pdop?: number;
    vdop?: number;
    std_latitude?: number;
    std_longitude?: number;
    std_height?: number;
  };
}

// ─── Skyplot Component ────────────────────────────────────────────

const Skyplot: React.FC<{ satellites: Array<{ prn: number; elevation: number; azimuth: number; snr: number; constellation: string }> }> = ({
  satellites,
}) => {
  const size = 200;
  const center = size / 2;
  const maxRadius = size / 2 - 20;

  // Polar to Cartesian
  const toXY = (elevation: number, azimuth: number) => {
    const r = maxRadius * (1 - elevation / 90);
    const rad = ((azimuth - 90) * Math.PI) / 180;
    return {
      x: center + r * Math.cos(rad),
      y: center + r * Math.sin(rad),
    };
  };

  const constellationColor = (c: string) => {
    switch (c) {
      case "GPS": return "#3b82f6";
      case "GLONASS": return "#ef4444";
      case "Galileo": return "#22c55e";
      case "BeiDou": return "#f59e0b";
      case "Multi": return "#a855f7";
      default: return "#6b7280";
    }
  };

  return (
    <svg width={size} height={size} style={{ background: "var(--bg-primary)", borderRadius: "8px" }}>
      {/* Elevation rings */}
      {[30, 60, 90].map((el) => {
        const r = maxRadius * (1 - el / 90);
        return (
          <circle
            key={el}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Cardinal directions */}
      <text x={center} y={8} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8} fontFamily="var(--font-mono)">N</text>
      <text x={size - 4} y={center + 3} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8} fontFamily="var(--font-mono)">E</text>
      <text x={center} y={size - 4} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8} fontFamily="var(--font-mono)">S</text>
      <text x={8} y={center + 3} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8} fontFamily="var(--font-mono)">W</text>
      {/* Satellites */}
      {satellites.map((sat, i) => {
        const { x, y } = toXY(sat.elevation, sat.azimuth);
        const color = constellationColor(sat.constellation);
        return (
          <g key={`${sat.constellation}-${sat.prn}-${i}`}>
            <circle
              cx={x}
              cy={y}
              r={6}
              fill={color}
              opacity={0.3}
            />
            <circle
              cx={x}
              cy={y}
              r={4}
              fill={color}
              stroke="white"
              strokeWidth={0.5}
            />
            <text
              x={x}
              y={y + 3}
              textAnchor="middle"
              fill="white"
              fontSize={6}
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              {sat.prn}
            </text>
          </g>
        );
      })}
      {satellites.length === 0 && (
        <text x={center} y={center} textAnchor="middle" fill="var(--text-disabled)" fontSize={10} fontFamily="var(--font-mono)">
          No satellites
        </text>
      )}
    </svg>
  );
};

// ─── DOP Gauge ────────────────────────────────────────────────────

const DopGauge: React.FC<{ label: string; value: number; max?: number }> = ({ label, value, max = 20 }) => {
  const pct = Math.min((value / max) * 100, 100);
  const color = value < 2 ? "var(--accent-green, #22c55e)" :
                value < 5 ? "var(--accent-primary)" :
                value < 10 ? "var(--accent-yellow, #f59e0b)" :
                "var(--accent-red, #ef4444)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", width: "32px" }}>{label}</span>
      <div style={{ flex: 1, height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "2px", transition: "width 0.3s" }} />
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color, minWidth: "36px", textAlign: "right" }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
};

// ─── Fix Quality Badge ────────────────────────────────────────────

const FixBadge: React.FC<{ quality: number }> = ({ quality }) => {
  const labels: Record<number, { label: string; color: string }> = {
    0: { label: "No Fix", color: "var(--accent-red, #ef4444)" },
    1: { label: "GPS SPS", color: "var(--text-secondary)" },
    2: { label: "DGPS", color: "var(--text-secondary)" },
    4: { label: "RTK Fixed", color: "var(--accent-green, #22c55e)" },
    5: { label: "RTK Float", color: "var(--accent-yellow, #f59e0b)" },
    9: { label: "SBAS", color: "var(--accent-primary)" },
  };
  const info = labels[quality] ?? { label: `Q${quality}`, color: "var(--text-tertiary)" };

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 8px",
      borderRadius: "4px",
      background: `${info.color}20`,
      color: info.color,
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      fontWeight: 600,
    }}>
      {quality >= 4 ? <CircleDot size={10} /> : <Circle size={10} />}
      {info.label}
    </span>
  );
};

// ─── Main View ────────────────────────────────────────────────────

export const InstrumentMonitorView: React.FC = () => {
  // Connection state
  const [connectionType, setConnectionType] = useState<"serial" | "bluetooth" | "ntrip">("serial");
  const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);
  const [bleDevices, setBleDevices] = useState<BleDevice[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [protocol, setProtocol] = useState("auto");
  const [instrumentName, setInstrumentName] = useState("");

  // NTRIP fields
  const [casterUrl, setCasterUrl] = useState("");
  const [mountpoint, setMountpoint] = useState("");
  const [ntripUser, setNtripUser] = useState("");
  const [ntripPass, setNtripPass] = useState("");

  // BLE fields
  const [bleDeviceName, setBleDeviceName] = useState("");

  // Live data
  const [observations, setObservations] = useState<NmeaObservation[]>([]);
  const [satellites, setSatellites] = useState<NmeaObservation["data"]["satellites"]>([]);
  const [fixQuality, setFixQuality] = useState(0);
  const [hdop, setHdop] = useState(0);
  const [vdop, setVdop] = useState(0);
  const [pdop, setPdop] = useState(0);
  const [satCount, setSatCount] = useState(0);
  const [altitude, setAltitude] = useState(0);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  // UI state
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    connection: true,
    live: true,
    skyplot: true,
    raw: false,
  });

  const observationsEndRef = useRef<HTMLDivElement>(null);

  // Get the metardu API from the preload bridge
  const api = (window as unknown as { metardu?: any }).metardu;

  // ─── Load serial ports on mount ──────────────────────────────────
  useEffect(() => {
    if (!api?.instrument) return;
    api.instrument.listPorts().then((result: any) => {
      if (result?.ports) {
        setSerialPorts(result.ports);
        if (result.ports.length > 0 && !selectedPort) {
          setSelectedPort(result.ports[0].port_name);
        }
      }
    }).catch(() => {});
  }, []);

  // ─── Subscribe to live observations ──────────────────────────────
  useEffect(() => {
    if (!api?.instrument) return;

    const unsubObs = api.instrument.onObservation((data: any) => {
      const obs = data?.observation;
      if (!obs?.data) return;

      const nmeaObs = obs.data as NmeaObservation;

      // Update DOP and fix from GGA
      if (nmeaObs.sentence_type === "GGA" && nmeaObs.data) {
        if (nmeaObs.data.fix_quality !== undefined) setFixQuality(nmeaObs.data.fix_quality);
        if (nmeaObs.data.hdop !== undefined) setHdop(nmeaObs.data.hdop);
        if (nmeaObs.data.satellite_count !== undefined) setSatCount(nmeaObs.data.satellite_count);
        if (nmeaObs.data.altitude_m !== undefined) setAltitude(nmeaObs.data.altitude_m);
        if (nmeaObs.data.latitude !== undefined && nmeaObs.data.longitude !== undefined) {
          setPosition({ lat: nmeaObs.data.latitude, lon: nmeaObs.data.longitude });
        }
      }

      // Update satellite list from GSV
      if (nmeaObs.sentence_type === "GSV" && nmeaObs.data?.satellites) {
        setSatellites((prev) => {
          const merged = [...(prev ?? [])];
          for (const sat of nmeaObs.data.satellites!) {
            const idx = merged.findIndex((s) => s.prn === sat.prn && s.constellation === sat.constellation);
            if (idx >= 0) {
              merged[idx] = sat;
            } else {
              merged.push(sat);
            }
          }
          return merged;
        });
      }

      // Update DOP from GSA
      if (nmeaObs.sentence_type === "GSA" && nmeaObs.data) {
        if (nmeaObs.data.pdop !== undefined) setPdop(nmeaObs.data.pdop);
        if (nmeaObs.data.hdop !== undefined) setHdop(nmeaObs.data.hdop);
        if (nmeaObs.data.vdop !== undefined) setVdop(nmeaObs.data.vdop);
      }

      // Add to observations feed (keep last 100)
      setObservations((prev) => {
        const next = [nmeaObs, ...prev];
        return next.slice(0, 100);
      });

      setLastUpdate(new Date().toLocaleTimeString());
    });

    const unsubStatus = api.instrument.onStatusUpdate((data: any) => {
      if (data?.connections) {
        setConnections(data.connections);
      }
    });

    // Start polling
    api.instrument.startPolling();

    return () => {
      unsubObs();
      unsubStatus();
      api.instrument.stopPolling();
    };
  }, []);

  // ─── Connect ─────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    if (!api?.instrument) return;
    setConnecting(true);
    setError(null);

    try {
      const params: any = { connection_type: connectionType };

      if (connectionType === "serial") {
        params.port = selectedPort;
        params.baud_rate = baudRate;
        params.protocol = protocol;
        params.instrument_name = instrumentName || undefined;
      } else if (connectionType === "bluetooth") {
        params.device_name = bleDeviceName;
        params.instrument_name = instrumentName || undefined;
      } else if (connectionType === "ntrip") {
        params.caster_url = casterUrl;
        params.mountpoint = mountpoint;
        params.username = ntripUser || undefined;
        params.password = ntripPass || undefined;
      }

      await api.instrument.connect(params);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [connectionType, selectedPort, baudRate, protocol, instrumentName, bleDeviceName, casterUrl, mountpoint, ntripUser, ntripPass]);

  // ─── Disconnect ──────────────────────────────────────────────────
  const handleDisconnect = useCallback(async (connId: string) => {
    if (!api?.instrument) return;
    try {
      await api.instrument.disconnect(connId);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // ─── Scan BLE ────────────────────────────────────────────────────
  const handleScanBle = useCallback(async () => {
    if (!api?.instrument) return;
    setScanning(true);
    try {
      const result = await api.instrument.listBleDevices();
      setBleDevices(result?.devices ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeConnection = connections.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "100%" }}>
      {/* Connection Form */}
      <div className="enterprise-panel">
        <div
          className="enterprise-panel-header"
          style={{ cursor: "pointer" }}
          onClick={() => toggleSection("connection")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {expandedSections.connection ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Plug size={14} />
            Connection
          </span>
          {activeConnection && (
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--accent-green, #22c55e)",
              background: "rgba(34,197,94,0.1)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}>
              {connections.length} active
            </span>
          )}
        </div>

        {expandedSections.connection && (
          <div className="enterprise-panel-body">
            {/* Connection type tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {(["serial", "bluetooth", "ntrip"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setConnectionType(type)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    border: `1px solid ${connectionType === type ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    borderRadius: "4px",
                    background: connectionType === type ? "var(--accent-primary)15" : "transparent",
                    color: connectionType === type ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                  }}
                >
                  {type === "serial" && <Radio size={12} />}
                  {type === "bluetooth" && <Bluetooth size={12} />}
                  {type === "ntrip" && <Wifi size={12} />}
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {/* Serial connection form */}
            {connectionType === "serial" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <select
                    value={selectedPort}
                    onChange={(e) => setSelectedPort(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  >
                    {serialPorts.length === 0 && <option value="">No ports found</option>}
                    {serialPorts.map((p) => (
                      <option key={p.port_name} value={p.port_name}>{p.display_name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => api?.instrument?.listPorts().then((r: any) => setSerialPorts(r?.ports ?? []))}
                    style={{
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "transparent",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                    title="Refresh ports"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    style={{
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      width: "100px",
                    }}
                  >
                    {[9600, 19200, 38400, 57600, 115200, 230400, 460800].map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <select
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="nmea">NMEA 0183</option>
                    <option value="gsi">Leica GSI</option>
                    <option value="sdr">Sokkia SDR</option>
                    <option value="trimble_sdr">Trimble SDR</option>
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Instrument name (optional)"
                  value={instrumentName}
                  onChange={(e) => setInstrumentName(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "4px",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                  }}
                />
              </div>
            )}

            {/* BLE connection form */}
            {connectionType === "bluetooth" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  onClick={handleScanBle}
                  disabled={scanning}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "4px",
                    background: scanning ? "var(--bg-tertiary)" : "transparent",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    cursor: scanning ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <Bluetooth size={12} />
                  {scanning ? "Scanning..." : "Scan for BLE Devices"}
                </button>
                {bleDevices.length > 0 && (
                  <select
                    value={bleDeviceName}
                    onChange={(e) => setBleDeviceName(e.target.value)}
                    style={{
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  >
                    <option value="">Select device...</option>
                    {bleDevices.map((d) => (
                      <option key={d.address} value={d.name}>{d.name} ({d.address}) — {d.rssi}dBm</option>
                    ))}
                  </select>
                )}
                {bleDevices.length === 0 && !scanning && (
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    No devices found. Click scan to discover BLE instruments.
                  </div>
                )}
              </div>
            )}

            {/* NTRIP connection form */}
            {connectionType === "ntrip" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Caster URL (e.g., http://caster.example.com:2101)"
                  value={casterUrl}
                  onChange={(e) => setCasterUrl(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "4px",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                  }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Mountpoint"
                    value={mountpoint}
                    onChange={(e) => setMountpoint(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Username"
                    value={ntripUser}
                    onChange={(e) => setNtripUser(e.target.value)}
                    style={{
                      width: "120px",
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={ntripPass}
                    onChange={(e) => setNtripPass(e.target.value)}
                    style={{
                      width: "100px",
                      padding: "6px 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "4px",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Connect / Disconnect buttons */}
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                onClick={handleConnect}
                disabled={connecting || activeConnection}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "1px solid var(--accent-primary)",
                  borderRadius: "4px",
                  background: connecting || activeConnection ? "var(--bg-tertiary)" : "var(--accent-primary)",
                  color: connecting || activeConnection ? "var(--text-disabled)" : "white",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: connecting || activeConnection ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Plug size={12} />
                {connecting ? "Connecting..." : "Connect"}
              </button>
              {activeConnection && connections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleDisconnect(c.id)}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--accent-red, #ef4444)",
                    borderRadius: "4px",
                    background: "transparent",
                    color: "var(--accent-red, #ef4444)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Unplug size={12} />
                  Disconnect
                </button>
              ))}
            </div>

            {error && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 8px",
                marginTop: "4px",
                borderRadius: "4px",
                background: "rgba(239,68,68,0.1)",
                color: "var(--accent-red, #ef4444)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}>
                <AlertTriangle size={12} />
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Data Display */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "12px", flex: 1, minHeight: 0 }}>
        {/* Left: Fix info + observations */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden" }}>
          {/* Fix quality + key metrics */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: "8px",
          }}>
            <div className="stat-card">
              <div style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Fix</div>
              <FixBadge quality={fixQuality} />
            </div>
            <div className="stat-card">
              <div style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Sats</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "16px", color: "var(--text-primary)" }}>{satCount}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Alt</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "14px", color: "var(--text-primary)" }}>{altitude.toFixed(2)}m</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Time</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-secondary)" }}>{lastUpdate || "—"}</div>
            </div>
          </div>

          {/* Position */}
          {position && (
            <div style={{
              padding: "8px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "4px",
              background: "var(--bg-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              display: "flex",
              gap: "16px",
            }}>
              <span style={{ color: "var(--text-tertiary)" }}>LAT</span>
              <span style={{ color: "var(--text-primary)" }}>{position.lat.toFixed(8)}°</span>
              <span style={{ color: "var(--text-tertiary)" }}>LON</span>
              <span style={{ color: "var(--text-primary)" }}>{position.lon.toFixed(8)}°</span>
            </div>
          )}

          {/* Raw observations */}
          <div style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border-subtle)",
            borderRadius: "4px",
          }}>
            <div
              style={{
                padding: "6px 8px",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--bg-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
              onClick={() => toggleSection("raw")}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                {expandedSections.raw ? "▼" : "▶"} Raw NMEA Feed ({observations.length})
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}
              >
                {showRaw ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            {(expandedSections.raw || showRaw) && (
              <div style={{
                flex: 1,
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                padding: "4px",
              }}>
                {observations.length === 0 && (
                  <div style={{ color: "var(--text-disabled)", textAlign: "center", padding: "20px" }}>
                    Waiting for data...
                  </div>
                )}
                {observations.map((obs, i) => (
                  <div key={i} style={{
                    padding: "2px 4px",
                    borderBottom: "1px solid var(--border-subtle)",
                    display: "flex",
                    gap: "8px",
                  }}>
                    <span style={{ color: "var(--text-disabled)", width: "50px" }}>{obs.talker}</span>
                    <span style={{
                      color: obs.sentence_type === "GGA" ? "var(--accent-primary)" :
                             obs.sentence_type === "GSA" ? "var(--accent-green, #22c55e)" :
                             obs.sentence_type === "GSV" ? "var(--accent-yellow, #f59e0b)" :
                             "var(--text-secondary)",
                      width: "30px",
                      fontWeight: 600,
                    }}>
                      {obs.sentence_type}
                    </span>
                    <span style={{ color: "var(--text-tertiary)" }}>{obs.timestamp}</span>
                  </div>
                ))}
                <div ref={observationsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Right: Skyplot + DOP */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Skyplot */}
          <div className="enterprise-panel" style={{ flex: 0 }}>
            <div
              className="enterprise-panel-header"
              style={{ cursor: "pointer" }}
              onClick={() => toggleSection("skyplot")}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Satellite size={12} />
                Skyplot ({satellites.length})
              </span>
            </div>
            {expandedSections.skyplot && (
              <div className="enterprise-panel-body" style={{ display: "flex", justifyContent: "center" }}>
                <Skyplot satellites={satellites ?? []} />
              </div>
            )}
          </div>

          {/* DOP Gauges */}
          <div className="enterprise-panel">
            <div className="enterprise-panel-header">
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Signal size={12} />
                Dilution of Precision
              </span>
            </div>
            <div className="enterprise-panel-body" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <DopGauge label="PDOP" value={pdop} />
              <DopGauge label="HDOP" value={hdop} />
              <DopGauge label="VDOP" value={vdop} />
            </div>
          </div>

          {/* Active connections */}
          {connections.length > 0 && (
            <div className="enterprise-panel">
              <div className="enterprise-panel-header">
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <CircleDot size={12} />
                  Connections ({connections.length})
                </span>
              </div>
              <div className="enterprise-panel-body" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {connections.map((c) => (
                  <div key={c.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px",
                    borderRadius: "4px",
                    background: "var(--bg-secondary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                  }}>
                    {c.connection_type === "serial" && <Radio size={10} />}
                    {c.connection_type === "bluetooth" && <Bluetooth size={10} />}
                    {c.connection_type === "ntrip" && <Wifi size={10} />}
                    <span style={{ color: "var(--text-primary)", flex: 1 }}>{c.instrument_name ?? c.port}</span>
                    <span style={{
                      color: c.status === "streaming" ? "var(--accent-green, #22c55e)" : "var(--text-tertiary)",
                    }}>
                      {c.observation_count} obs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
