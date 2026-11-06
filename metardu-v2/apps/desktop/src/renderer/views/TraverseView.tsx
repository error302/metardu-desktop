/**
 * Traverse & Network Adjustment view with live instrument integration.
 *
 * Least-squares observations are sent to the Rust sidecar. Bowditch and
 * Transit remain unavailable until their existing Rust methods are exposed
 * through an approved preload contract. GNSS GGA fixes are shown as raw
 * WGS84 observations and are never projected into a project grid here.
 */

import React, { useState, useCallback, useEffect } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyLine, useInstrumentConnection } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { bus } from "../cross-import-bus.js";
import { COUNTRY_OPTIONS } from "../countries.js";
import { AutoExportBanner } from "./AutoExportBanner.js";
import { Radio, Wifi, Bluetooth, Plug, Unplug, CircleDot, Plus, Trash2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────

type AdjustMode = "bowditch" | "transit" | "ls-distance" | "ls-mixed" | "ls-angles";

interface PointDef { id: string; easting: number; northing: number; fixed: boolean; height: number | null; }
interface LegDef { from: string; to: string; distance: number; bearing: number; sigma: number; }
interface DirectionDef { station: string; target: string; direction: number; sigma: number; }
interface AzimuthDef { from: string; to: string; azimuth: number; sigma: number; }
interface BaselineDef { from: string; to: string; dE: number; dN: number; dH: number; sigmaE: number; sigmaN: number; sigmaH: number; correlationEN: number; }

interface LsResult {
  adjusted: Array<{ id: string; easting: number; northing: number; height: number | null }>;
  residuals: Array<{ from: string; to: string; kind: string; residual: number; redundancy: number; wStatistic: number }>;
  sigma0Squared: number; chiSquare: number; chiSquarePasses: boolean; degreesOfFreedom: number; iterations: number;
}

interface LiveFix {
  timestamp: string;
  latitude: number;
  longitude: number;
  fixQuality: number | null;
  hdop: number | null;
  satelliteCount: number | null;
  altitude: number | null;
}

// ─── Sidecar call ─────────────────────────────────────────────────

async function callSidecar(method: string, params: Record<string, unknown>): Promise<unknown> {
  const call = window.metardu?.sidecar?.call;
  if (!call) return null;
  return call(method, params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLsResult(value: unknown): value is LsResult {
  if (!isRecord(value) || !Array.isArray(value.adjusted) || !Array.isArray(value.residuals)) return false;
  const adjustedValid = value.adjusted.every((point) => isRecord(point) && typeof point.id === "string" &&
    Number.isFinite(point.easting) && Number.isFinite(point.northing) &&
    (point.height === null || Number.isFinite(point.height)));
  const residualsValid = value.residuals.every((residual) => isRecord(residual) &&
    typeof residual.from === "string" && typeof residual.to === "string" && typeof residual.kind === "string" &&
    Number.isFinite(residual.residual) && Number.isFinite(residual.redundancy) && Number.isFinite(residual.wStatistic));
  return adjustedValid && residualsValid && Number.isFinite(value.sigma0Squared) && Number.isFinite(value.chiSquare) &&
    typeof value.chiSquarePasses === "boolean" && Number.isFinite(value.degreesOfFreedom) && Number.isFinite(value.iterations);
}

// ─── Main component ──────────────────────────────────────────────

export const TraverseView: React.FC = () => {
  const { setSurveyOutput, activeProject } = useSurveyState();
  const [countryCode, setCountryCode] = useState(activeProject?.countryCode ?? "");
  const [mode, setMode] = useState<AdjustMode>("ls-mixed");
  const [crossImportNotice, setCrossImportNotice] = useState<string | null>(null);

  // ── Cross-import: subscribe to COGO points ────────────────────────
  useEffect(() => {
    const unsub = bus.on("cogo:points", (payload) => {
      if (payload.points.length < 2) return;
      const pts = payload.points;
      setPointsText((prev) => {
        const existingIds = new Set(prev.trim().split("\n").map((l) => l.split(",")[0]?.trim()));
        const uniqueNew = pts.filter((p) => !existingIds.has(p.id));
        if (uniqueNew.length === 0) return prev;
        const additions = uniqueNew.map((p) => `${p.id},${p.easting.toFixed(3)},${p.northing.toFixed(3)},false`).join("\n");
        return prev ? prev + "\n" + additions : additions;
      });
      setCrossImportNotice(payload.evidenceStatus === "draft_unverified"
        ? `Imported ${pts.length} COGO draft coordinates as candidate stations. They have no verified CRS or observation uncertainty.`
        : `Imported ${pts.length} points from COGO as stations.`);
    });
    return unsub;
  }, []);

  const [lsResult, setLsResult] = useState<LsResult | null>(null);

  // ── Push LS results to COGO for area verification ─────────────────
  const pushToCogo = useCallback(() => {
    if (!lsResult) return;
    bus.emit("traverse:results", {
      adjusted: lsResult.adjusted,
      residuals: lsResult.residuals,
      sigma0Squared: lsResult.sigma0Squared,
    });
    setCrossImportNotice(`Sent ${lsResult.adjusted.length} adjusted coordinates to COGO unchanged. CRS and area methodology were not checked here.`);
  }, [lsResult]);

  const pushToCad = useCallback(() => {
    const pts = lsResult?.adjusted;
    if (!pts || pts.length === 0) return;
    bus.emit("cad:import_entities", {
      source: "Traverse Adjustment",
      beacons: pts.map((p) => ({ id: p.id, easting: p.easting, northing: p.northing })),
      boundaries: [{ name: "ADJUSTED_TRAVERSE", vertices: pts.map((p) => ({ easting: p.easting, northing: p.northing })) }],
    });
    setCrossImportNotice(`Sent ${pts.length} adjusted coordinates to CAD unchanged. The coordinate reference was not checked or attached.`);
  }, [lsResult]);

  const saveTraverseToProject = useCallback(() => {
    const pts = lsResult?.adjusted;
    if (!pts || pts.length === 0) return;
    const outputCountry = activeProject?.countryCode || countryCode;
    if (!outputCountry) {
      setCrossImportNotice("Select the project jurisdiction before saving. Confirm project CRS and vertical reference before deliverable use.");
      return;
    }
    const output = {
      evidenceStatus: "draft_unverified",
      coordinateReference: null,
      verticalReference: null,
      jurisdictionAcceptance: "not_evaluated",
      beacons: pts.map((p) => ({
        label: p.id,
        easting: p.easting,
        northing: p.northing,
      })),
      boundaries: [{ label: activeProject?.name || "ADJUSTED TRAVERSE", vertices: pts.map((p) => ({ easting: p.easting, northing: p.northing })) }],
      contours: [],
      fieldPoints: [],
    };
    setSurveyOutput(output, "Traverse adjustment (draft)", "TraverseView", outputCountry);
    setCrossImportNotice("Saved as a draft. This project record does not include a verified CRS, vertical reference, or jurisdiction acceptance.");
  }, [lsResult, activeProject, countryCode, setSurveyOutput]);

  // Points / legs / baselines (CSV text)
  const [pointsText, setPointsText] = useState("");
  const [legsText, setLegsText] = useState("");
  const [baselinesText, setBaselinesText] = useState("");

  // Angular observations
  const [directionsText, setDirectionsText] = useState("");
  const [azimuthText, setAzimuthText] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  // ── Live instrument state (via shared hook) ─────────────────────
  const instrument = useInstrumentConnection();
  const [connType, setConnType] = useState<"serial" | "bluetooth" | "ntrip">("serial");
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [casterUrl, setCasterUrl] = useState("");
  const [mountpoint, setMountpoint] = useState("");
  const [connName, setConnName] = useState("");
  const [liveFix, setLiveFix] = useState<LiveFix | null>(null);

  // Derive connected state from hook
  const connected = instrument.state.connected;
  const connectionId = instrument.state.connectionId;
  const obsCount = instrument.observationCount;

  // Auto-select first port when ports load
  useEffect(() => {
    if (instrument.serialPorts.length > 0 && !selectedPort) {
      setSelectedPort(instrument.serialPorts[0].port_name);
    }
  }, [instrument.serialPorts]);

  // Keep receiver output in its native geographic form. Projected coordinates
  // require an explicitly selected CRS and a validated sidecar operation.
  useEffect(() => {
    const unsub = instrument.onObservation((obs) => {
      if (obs.sentence_type !== "GGA") return;
      const d = obs.data;
      const numberOrNull = (value: unknown): number | null =>
        typeof value === "number" && Number.isFinite(value) ? value : null;
      const latitude = numberOrNull(d.latitude);
      const longitude = numberOrNull(d.longitude);
      if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

      const fix: LiveFix = {
        timestamp: obs.timestamp,
        latitude,
        longitude,
        fixQuality: numberOrNull(d.fix_quality),
        hdop: numberOrNull(d.hdop),
        satelliteCount: numberOrNull(d.satellite_count),
        altitude: numberOrNull(d.altitude_m),
      };

      setLiveFix(fix);
    });
    return unsub;
  }, [instrument.onObservation]);

  const handleConnect = useCallback(() => {
    instrument.clearError();
    instrument.connect({
      connection_type: connType,
      port: connType === "serial" ? selectedPort : undefined,
      baud_rate: connType === "serial" ? baudRate : undefined,
      caster_url: connType === "ntrip" ? casterUrl : undefined,
      mountpoint: connType === "ntrip" ? mountpoint : undefined,
      instrument_name: connName || undefined,
    });
  }, [instrument, connType, selectedPort, baudRate, casterUrl, mountpoint, connName]);

  const handleDisconnect = useCallback(() => {
    if (connectionId) instrument.disconnect(connectionId);
  }, [instrument, connectionId]);

  // ── Parse helpers ───────────────────────────────────────────────

  const parsePoints = useCallback((): PointDef[] => {
    return pointsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [id = "", e = "", n = "", f = "false", h = ""] = line.split(",").map((s) => s.trim());
      return { id, easting: e === "" ? Number.NaN : Number(e), northing: n === "" ? Number.NaN : Number(n), fixed: f === "true", height: h === "" ? null : Number(h) };
    });
  }, [pointsText]);

  const parseLegs = useCallback((): LegDef[] => {
    return legsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from = "", to = "", dist = "", brg = "", sig = ""] = line.split(",").map((s) => s.trim());
      return { from, to, distance: dist === "" ? Number.NaN : Number(dist), bearing: brg === "" ? Number.NaN : Number(brg), sigma: sig === "" ? Number.NaN : Number(sig) };
    });
  }, [legsText]);

  const parseDirections = useCallback((): DirectionDef[] => {
    if (!directionsText.trim()) return [];
    return directionsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [station = "", target = "", dir = "", sig = ""] = line.split(",").map((s) => s.trim());
      return { station, target, direction: dir === "" ? Number.NaN : Number(dir), sigma: sig === "" ? Number.NaN : Number(sig) / 3600 };
    });
  }, [directionsText]);

  const parseAzimuths = useCallback((): AzimuthDef[] => {
    if (!azimuthText.trim()) return [];
    return azimuthText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from = "", to = "", az = "", sig = ""] = line.split(",").map((s) => s.trim());
      return { from, to, azimuth: az === "" ? Number.NaN : Number(az), sigma: sig === "" ? Number.NaN : Number(sig) / 3600 };
    });
  }, [azimuthText]);

  const parseBaselines = useCallback((): BaselineDef[] => {
    if (!baselinesText.trim()) return [];
    return baselinesText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from = "", to = "", dE = "", dN = "", dH = "", sE = "", sN = "", sH = "", corr = ""] = line.split(",").map((s) => s.trim());
      return { from, to, dE: dE === "" ? Number.NaN : Number(dE), dN: dN === "" ? Number.NaN : Number(dN), dH: dH === "" ? Number.NaN : Number(dH), sigmaE: sE === "" ? Number.NaN : Number(sE), sigmaN: sN === "" ? Number.NaN : Number(sN), sigmaH: sH === "" ? Number.NaN : Number(sH), correlationEN: corr === "" ? Number.NaN : Number(corr) };
    });
  }, [baselinesText]);

  // ── LS adjustment ───────────────────────────────────────────────

  const computeLs = useCallback(async () => {
    setError(null); setLsResult(null); setComputing(true);
    try {
      const points = parsePoints(); const legs = parseLegs(); const baselines = parseBaselines();
      const directions = parseDirections(); const azimuths = parseAzimuths();
      const isMixed = mode === "ls-mixed";
      const isAngles = mode === "ls-angles";
      const pointIds = new Set(points.map((point) => point.id));
      if (points.length < 2 || points.some((point) => !point.id || !Number.isFinite(point.easting) || !Number.isFinite(point.northing) ||
        (point.height !== null && !Number.isFinite(point.height)))) {
        throw new Error("Enter at least two points with unique IDs and finite coordinates. Any supplied height must also be finite.");
      }
      if (pointIds.size !== points.length) throw new Error("Point IDs must be unique.");
      if (!points.some((point) => point.fixed)) throw new Error("At least one fixed control point is required.");
      if (legs.some((leg) => !pointIds.has(leg.from) || !pointIds.has(leg.to) || leg.from === leg.to ||
        !Number.isFinite(leg.distance) || leg.distance <= 0 || !Number.isFinite(leg.bearing) ||
        !Number.isFinite(leg.sigma) || leg.sigma <= 0)) {
        throw new Error("Every distance observation needs known point IDs, a positive distance, a finite bearing, and a measured positive sigma.");
      }
      if ((isMixed || isAngles) && baselines.some((baseline) => !pointIds.has(baseline.from) || !pointIds.has(baseline.to) ||
        ![baseline.dE, baseline.dN, baseline.dH, baseline.sigmaE, baseline.sigmaN, baseline.sigmaH, baseline.correlationEN].every(Number.isFinite) ||
        baseline.sigmaE <= 0 || baseline.sigmaN <= 0 || baseline.sigmaH <= 0 || Math.abs(baseline.correlationEN) > 1)) {
        throw new Error("Every GNSS baseline needs known point IDs, finite components, positive standard deviations, and correlation from -1 to 1.");
      }
      if ((isMixed || isAngles) && baselines.some((baseline) => [baseline.from, baseline.to].some((id) => {
        const point = points.find((candidate) => candidate.id === id);
        return !point || point.height === null || !Number.isFinite(point.height);
      }))) {
        throw new Error("GNSS baseline endpoints need measured or controlled point heights. A zero-height approximation is not inserted.");
      }
      if ((isAngles || directions.length > 0) && directions.some((direction) => !pointIds.has(direction.station) || !pointIds.has(direction.target) ||
        !Number.isFinite(direction.direction) || !Number.isFinite(direction.sigma) || direction.sigma <= 0)) {
        throw new Error("Every direction observation needs known station and target IDs, a finite direction, and a measured positive sigma.");
      }
      if ((isAngles || azimuths.length > 0) && azimuths.some((azimuth) => !pointIds.has(azimuth.from) || !pointIds.has(azimuth.to) ||
        !Number.isFinite(azimuth.azimuth) || !Number.isFinite(azimuth.sigma) || azimuth.sigma <= 0)) {
        throw new Error("Every azimuth control needs known point IDs, a finite azimuth, and a measured positive sigma.");
      }
      if (isMixed && baselines.length === 0) throw new Error("Mixed network mode requires at least one GNSS baseline.");
      if (isAngles && (directions.length === 0 || azimuths.length === 0)) {
        throw new Error("Angular network mode requires measured directions and at least one azimuth control.");
      }
      if (legs.length + ((isMixed || isAngles) ? baselines.length : 0) + directions.length + azimuths.length === 0) {
        throw new Error("Enter at least one complete observation before running an adjustment.");
      }
      const parameters = points.map((p) => ({ id: p.id, dimension: 2, fixed: p.fixed }));

      if ((isMixed || isAngles) && baselines.length > 0) {
        const gnssPts = new Set(baselines.flatMap((b) => [b.from, b.to]));
        for (const param of parameters) { if (gnssPts.has(param.id)) param.dimension = 3; }
      }

      const approximations: Record<string, number[]> = {};
      for (const p of points) {
        const dim = parameters.find((pp) => pp.id === p.id)?.dimension ?? 2;
        if (dim === 3) {
          if (p.height === null || !Number.isFinite(p.height)) throw new Error(`Point ${p.id} needs an explicit height for 3D adjustment.`);
          approximations[p.id] = [p.easting, p.northing, p.height];
        } else {
          approximations[p.id] = [p.easting, p.northing];
        }
      }

      const observations: Array<Record<string, unknown>> = [];

      // Distance observations (from traverse legs)
      for (const leg of legs) {
        observations.push({ kind: "Distance", from: leg.from, to: leg.to, value: leg.distance, sigma: leg.sigma });
      }

      // Direction observations (measured horizontal angles from a station)
      // Each direction is referenced to an orientation parameter at the station
      for (const d of directions) {
        observations.push({ kind: "Direction", station: d.station, target: d.target, value: d.direction, sigma: d.sigma });
      }

      // Azimuth control observations (known azimuth constraining orientation)
      for (const a of azimuths) {
        observations.push({ kind: "AzimuthControl", from: a.from, to: a.to, value: a.azimuth, sigma: a.sigma });
      }

      // GNSS baselines (mixed network mode)
      if (isMixed || isAngles) {
        for (const b of baselines) {
          observations.push({ kind: "GnssBaseline", from: b.from, to: b.to, value: [b.dE, b.dN, b.dH], covariance: [
            b.sigmaE * b.sigmaE, b.correlationEN * b.sigmaE * b.sigmaN, 0,
            b.correlationEN * b.sigmaE * b.sigmaN, b.sigmaN * b.sigmaN, 0,
            0, 0, b.sigmaH * b.sigmaH,
          ]});
        }
      }

      // Orientation parameters: one per station that has direction observations
      const orientationStations = [...new Set(directions.map((d) => d.station))];
      const orientationParameters = orientationStations.map((sid) => ({ id: `orient_${sid}`, stationId: sid }));

      const result = await callSidecar("adjustment.run", { parameters, approximations, observations, orientation_parameters: orientationParameters, config: { max_iterations: 50, convergence_threshold: 1e-6, blunder_detection: true, blunder_threshold: 3.5, confidence_level: 0.95 } });
      if (!isRecord(result) || typeof result.success !== "boolean") throw new Error("Adjustment sidecar returned an invalid response.");
      if (!result.success) throw new Error(typeof result.error === "string" ? result.error : "Adjustment failed.");
      if (!isLsResult(result.result)) throw new Error("Adjustment sidecar response contains an invalid result.");
      setLsResult(result.result);
    } catch (e) { setError((e as Error).message); } finally { setComputing(false); }
  }, [mode, parsePoints, parseLegs, parseBaselines]);

  const handleCompute = useCallback(() => {
    void computeLs();
  }, [computeLs]);

  // ── Canvas data ─────────────────────────────────────────────────

  const canvasData = (() => {
    const pts: SurveyPoint[] = [];
    const lines: SurveyLine[] = [];

    if (lsResult) {
      for (const p of lsResult.adjusted) pts.push({ easting: p.easting, northing: p.northing, label: p.id });
    }

    return { points: pts, lines };
  })();

  const showBaselineInputs = mode === "ls-mixed" || mode === "ls-angles";
  const showAngularInputs = mode === "ls-angles";
  const fixQualityLabel = liveFix
    ? liveFix.fixQuality === null ? "Fix quality unavailable" : `NMEA quality ${liveFix.fixQuality}`
    : "---";
  const fixQualityColor = liveFix?.fixQuality !== null && liveFix?.fixQuality !== undefined
    ? liveFix.fixQuality >= 4 ? "#22c55e" : liveFix.fixQuality >= 2 ? "#f59e0b" : "#ef4444"
    : "var(--text-tertiary)";
  const lsMetrics: Array<{ label: string; value: string; color?: string }> = [
    { label: "sigma_0^2", value: lsResult?.sigma0Squared.toFixed(6) ?? "" },
    { label: "Chi-Square", value: lsResult ? `${lsResult.chiSquare.toFixed(4)} (${lsResult.degreesOfFreedom} dof)` : "" },
    { label: "Chi-Square Test", value: lsResult ? (lsResult.chiSquarePasses ? "PASS" : "FAIL") : "—", color: lsResult ? (lsResult.chiSquarePasses ? "var(--status-success)" : "var(--status-error)") : undefined },
    { label: "Iterations", value: String(lsResult?.iterations ?? "") },
    { label: "Observations", value: String(lsResult?.residuals.length ?? "") },
  ];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Traverse & Network Adjustment
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Least-squares adjustment through the local sidecar. Outputs remain drafts until the project CRS, coordinate operation, uncertainty evidence, and applicable jurisdiction checks are attached.
      </p>

      {/* Live Instrument Panel */}        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <Radio size={14} style={{ color: connected ? "#22c55e" : "var(--text-tertiary)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: "bold" }}>Live Instrument</span>
          {connected && (
            <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(34,197,94,0.15)", color: "#22c55e", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
              CONNECTED
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {!connected ? (
            <>
              <select value={connType} onChange={(e) => {
                const value = e.target.value;
                if (value === "serial" || value === "bluetooth" || value === "ntrip") setConnType(value);
              }} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                <option value="serial">Serial</option>
                <option value="bluetooth">Bluetooth</option>
                <option value="ntrip">NTRIP</option>
              </select>
              {connType === "serial" && (
                <>
                  <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", minWidth: "120px" }}>
                    {instrument.serialPorts.length === 0 && <option value="">No ports</option>}
                    {instrument.serialPorts.map((p) => <option key={p.port_name} value={p.port_name}>{p.display_name}</option>)}
                  </select>
                  <select value={baudRate} onChange={(e) => setBaudRate(+e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                    {[9600, 19200, 38400, 57600, 115200, 230400].map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </>
              )}
              {connType === "ntrip" && (
                <>
                  <input placeholder="Caster URL" value={casterUrl} onChange={(e) => setCasterUrl(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", width: "180px" }} />
                  <input placeholder="Mountpoint" value={mountpoint} onChange={(e) => setMountpoint(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", width: "100px" }} />
                </>
              )}
              <button className="primary" onClick={handleConnect} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "var(--text-xs)" }}>
                <Plug size={12} /> Connect
              </button>
            </>
          ) : (
            <>
              <button onClick={handleDisconnect} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "var(--text-xs)", color: "var(--status-error)" }}>
                <Unplug size={12} /> Disconnect
              </button>
              <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                {obsCount} obs
              </span>
              {liveFix && (
                <>
                  <span style={{ padding: "2px 6px", borderRadius: "4px", background: `${fixQualityColor}20`, color: fixQualityColor, fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                    {fixQualityLabel}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {liveFix.satelliteCount ?? "—"} sats | HDOP {liveFix.hdop?.toFixed(1) ?? "—"}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    WGS84 {liveFix.latitude.toFixed(8)}, {liveFix.longitude.toFixed(8)}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Raw GNSS status; no projected traverse coordinates are inferred here. */}
        {connected && (
          <div role="note" style={{ marginTop: "8px", borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Receiver fixes remain raw WGS84 observations. Traverse capture is unavailable until a project CRS, validated coordinate operation, and receiver uncertainty model are connected.
          </div>
        )}

        {instrument.state.error && (
          <div style={{ marginTop: "6px", padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            {instrument.state.error}
          </div>
        )}
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <label style={{ marginRight: "6px" }}>Country:</label>
          <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ minWidth: "140px" }}>
            <option value="">Select jurisdiction</option>
            {COUNTRY_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ marginRight: "6px" }}>Mode:</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as AdjustMode)}>
            <option value="bowditch" disabled>Bowditch (sidecar bridge unavailable)</option>
            <option value="transit" disabled>Transit (sidecar bridge unavailable)</option>
            <option value="ls-distance">Least Squares (Distance)</option>
            <option value="ls-mixed">Mixed Network (Distance + GNSS)</option>
            <option value="ls-angles">Angular Network (Directions + Azimuths)</option>
          </select>
        </div>
        <button className="primary" onClick={handleCompute} disabled={computing || mode === "bowditch" || mode === "transit"} style={{ marginTop: "4px" }}>
          {computing ? "Computing..." : "Run Adjustment"}
        </button>
      </div>
      {(mode === "bowditch" || mode === "transit") && (
        <div role="note" style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
          Bowditch and Transit are unavailable here because the sandboxed sidecar bridge does not expose those existing Rust methods. Renderer-side adjustment is disabled; no precision or jurisdiction acceptance result is inferred.
        </div>
      )}

      {/* Input panels */}
      <div style={{ display: "grid", gridTemplateColumns: showBaselineInputs ? (showAngularInputs ? "1fr 1fr 1fr" : "1fr 1fr 1fr") : "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>Points (ID, E, N, fixed, height)</label>
          <textarea value={pointsText} onChange={(e) => setPointsText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>Traverse Legs (From, To, Dist, Bearing, Sigma)</label>
          <textarea value={legsText} onChange={(e) => setLegsText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
        </div>
        {showBaselineInputs && (
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>GNSS Baselines (From, To, dE, dN, dH, sE, sN, sH, corr)</label>
            <textarea value={baselinesText} onChange={(e) => setBaselinesText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
          </div>
        )}
      </div>

      {/* Angular observation panels (shown in ls-angles mode) */}
      {showAngularInputs && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              Directions (Station, Target, Direction deg, Sigma sec)
              <span style={{ fontWeight: "normal", color: "var(--text-tertiary)", marginLeft: 8, fontSize: "var(--text-xs)" }}>Measured horizontal angles from station</span>
            </label>
            <textarea value={directionsText} onChange={(e) => setDirectionsText(e.target.value)} style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              {parseDirections().length} directions · {new Set(parseDirections().map((d) => d.station)).size} stations
            </div>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              Azimuth Controls (From, To, Azimuth deg, Sigma sec)
              <span style={{ fontWeight: "normal", color: "var(--text-tertiary)", marginLeft: 8, fontSize: "var(--text-xs)" }}>Known azimuth constraining orientation</span>
            </label>
            <textarea value={azimuthText} onChange={(e) => setAzimuthText(e.target.value)} style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              {parseAzimuths().length} azimuth controls
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {crossImportNotice && (
        <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          {crossImportNotice}
        </div>
      )}

      <AutoExportBanner />

      {/* LS results */}
      {lsResult && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "12px" }}>
            {lsMetrics.map((item) => (
              <div key={item.label} style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{item.label}</div>
                <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px", background: "var(--bg-tertiary)", padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: "4px" }}>
            <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--accent-primary)", display: "flex", alignItems: "center" }}>
              Surveyor Workflow Handoff:
            </span>
            <button onClick={pushToCogo}
              style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "11px", border: "1px solid var(--accent-primary)", background: "transparent", color: "var(--accent-primary)", borderRadius: "3px", cursor: "pointer" }}>
              Area Calculator
            </button>
            <button onClick={pushToCad}
              style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "11px", border: "1px solid var(--border-default)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "3px", cursor: "pointer" }}>
              Open in 2D/3D CAD
            </button>
            <button onClick={saveTraverseToProject}
              style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "11px", border: "none", background: "var(--accent-primary)", color: "#1A1F36", fontWeight: "bold", borderRadius: "3px", cursor: "pointer" }}>
              Save Draft to Project
            </button>
          </div>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Adjusted Coordinates</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", marginBottom: "16px" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Station</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj E</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj N</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Height</th>
            </tr></thead>
            <tbody>{lsResult.adjusted.map((p, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{p.id}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.easting.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.northing.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.height?.toFixed(3) ?? "-"}</td>
              </tr>
            ))}</tbody>
          </table>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Observation Diagnostics</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>From</th><th style={{ padding: "6px 8px", textAlign: "left" }}>To</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Kind</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Residual</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Redundancy</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Baarda w</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>Flag</th>
            </tr></thead>
            <tbody>{lsResult.residuals.map((r, i) => {
              const isBlunder = r.wStatistic > 3.5;
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: isBlunder ? "rgba(239,68,68,0.08)" : undefined }}>
                  <td style={{ padding: "6px 8px" }}>{r.from}</td><td style={{ padding: "6px 8px" }}>{r.to}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-secondary)" }}>{r.kind}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.residual.toFixed(4)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.redundancy.toFixed(3)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: isBlunder ? "var(--status-error)" : "var(--text-primary)" }}>{r.wStatistic.toFixed(3)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", color: isBlunder ? "var(--status-error)" : undefined }}>{isBlunder ? "BLUNDER" : "OK"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {/* Canvas */}
      {canvasData.points.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas height={320} title="Adjusted Network" points={canvasData.points} lines={canvasData.lines} showPointLabels={true} showNorthArrow={true} showScaleBar={true} />
        </div>
      )}
    </div>
  );
};
