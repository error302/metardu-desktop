/**
 * Digital Field Book & Instrument Reduction Engine.
 *
 * Two modes:
 *   1. Digital Leveling Book — Rise & Fall / Height of Collimation with arithmetic page checks
 *   2. Total Station 3D Polar Book — full reduction with:
 *      - Atmospheric PPM correction (Metschke formula: temperature + pressure)
 *      - Instrumental errors: collimation, trunnion axis, index error
 *      - Face-left / Face-right averaging with quality indicator
 *      - 3D coordinate computation from station + polar observations
 *      - CSV paste import for bulk data entry
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useInstrumentConnection } from "@metardu/ui-components";
import { importInstrumentData, detectFormat, FORMAT_DESCRIPTIONS, type LevelObservation } from "../instrument-import.js";

function readMeasurement(value: unknown): number {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export const FieldBookView: React.FC = () => {
  const [bookType, setBookType] = useState<"leveling" | "total_station">("leveling");
  const [dragOver, setDragOver] = useState(false);
  const [importPreview, setImportPreview] = useState<{ format: string; count: number; fileName: string } | null>(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [fieldBookError, setFieldBookError] = useState<string | null>(null);

  // ── Instrument connection (live observations) ──
  const instrument = useInstrumentConnection();
  const [liveMode, setLiveMode] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const livePointCounter = useRef(0);

  // Subscribe to live observations from connected instrument
  useEffect(() => {
    if (!liveMode) return;
    const unsub = instrument.onObservation((obs) => {
      const d = obs.data;
      // Total Station observations: Hz, V, SD fields
      if (d.hz != null || d.v != null || d.sd != null) {
        livePointCounter.current++;
        const ptId = typeof d.point_id === "string" && d.point_id.trim() ? d.point_id : `LIVE${livePointCounter.current}`;
        const th = readMeasurement(d.target_height);
        const hz = readMeasurement(d.hz);
        const v = readMeasurement(d.v);
        const sd = readMeasurement(d.sd);
        const face = typeof d.face === "string" ? d.face.toUpperCase() : "";
        const remark = (d.remark as string) || "live";

        setTsObs(prev => {
          // Check if point already exists — update face-right
          const existing = prev.find(o => o.id === ptId);
          if (existing) {
            if ((face === "F2" || face === "FR") && existing.faceLeft) {
              return prev.map(o => o.id === ptId ? { ...o, faceRight: { hz, v, sd } } : o);
            }
            return prev;
          }
          // New point
          const newObs: TsObs = {
            id: ptId,
            targetHeight: th,
            faceLeft: (face === "F1" || face === "FL") ? { hz, v, sd } : null,
            faceRight: (face === "F2" || face === "FR") ? { hz, v, sd } : null,
            remark,
          };
          return [...prev, newObs];
        });
        setBookType("total_station");
        setLiveCount(c => c + 1);
      }
      // Level observations: BS, IS, FS fields
      else if (d.bs !== undefined || d.is !== undefined || d.fs !== undefined) {
        livePointCounter.current++;
        const ptId = (d.point_id as string) || `LV${livePointCounter.current}`;
        setLevelingRows(prev => {
          const bs = d.bs != null ? readMeasurement(d.bs) : null;
          const is_ = d.is != null ? readMeasurement(d.is) : null;
          const fs = d.fs != null ? readMeasurement(d.fs) : null;
          return [...prev, { id: ptId, bs, is: is_, fs, rl: Number.NaN, remark: (d.remark as string) || "live" }];
        });
        setBookType("leveling");
        setLiveCount(c => c + 1);
      }
    });
    return unsub;
  }, [liveMode, instrument.onObservation]);

  // ──── DIGITAL LEVELING BOOK ────

  const [levelingRows, setLevelingRows] = useState<LevelObservation[]>([]);

  const [levelingReduced, setLevelingReduced] = useState<Array<LevelObservation & { rise: number | null; fall: number | null; finalRL: number }>>([]);
  const [arithmeticCheck, setArithmeticCheck] = useState<{ sumBS: number; sumFS: number; deltaBSFS: number; deltaRL: number; valid: boolean } | null>(null);

  const reduceLeveling = () => {
    setLevelingReduced([]);
    setArithmeticCheck(null);
    const firstRow = levelingRows[0];
    if (levelingRows.length < 2 || !firstRow || firstRow.bs === null || !Number.isFinite(firstRow.bs) || !Number.isFinite(firstRow.rl)) {
      setFieldBookError("Import or record at least two level observations, beginning with a backsight on a benchmark with a known RL.");
      return;
    }
    if (levelingRows.slice(1).some((row) => (row.is === null && row.fs === null) ||
      (row.is !== null && !Number.isFinite(row.is)) || (row.fs !== null && !Number.isFinite(row.fs)) ||
      (row.bs !== null && !Number.isFinite(row.bs)))) {
      setFieldBookError("Every observation after the starting benchmark needs finite staff readings, including an intermediate sight or foresight.");
      return;
    }
    setFieldBookError(null);
    let currentRL = firstRow.rl;
    let sumBS = 0;
    let sumFS = 0;
    let prevStaff = firstRow.bs;

    const reduced: Array<LevelObservation & { rise: number | null; fall: number | null; finalRL: number }> = [];

    for (let i = 0; i < levelingRows.length; i++) {
      const row = levelingRows[i]!;
      if (row.bs !== null) sumBS += row.bs;
      if (row.fs !== null) sumFS += row.fs;

      if (i === 0) {
        reduced.push({ ...row, rise: null, fall: null, finalRL: currentRL });
        continue;
      }

      const staffVal = row.is !== null ? row.is : row.fs!;
      const diff = prevStaff - staffVal;
      const rise = diff > 0 ? diff : null;
      const fall = diff < 0 ? Math.abs(diff) : null;

      currentRL += diff;
      reduced.push({ ...row, rise, fall, finalRL: currentRL });

      if (row.bs !== null) {
        prevStaff = row.bs;
      } else {
        prevStaff = staffVal;
      }
    }

    const firstRL = firstRow.rl;
    const lastRL = currentRL;
    const deltaBSFS = sumBS - sumFS;
    const deltaRL = lastRL - firstRL;

    setLevelingReduced(reduced);
    setArithmeticCheck({
      sumBS,
      sumFS,
      deltaBSFS,
      deltaRL,
      valid: Math.abs(deltaBSFS - deltaRL) < 0.001,
    });
  };
// ──── TOTAL STATION 3D POLAR REDUCTION ENGINE ────

// Atmospheric parameters
const [temperature, setTemperature] = useState("");
const [pressure, setPressure] = useState("");
const [edmPpm, setEdmPpm] = useState("");

// Instrumental errors
const [collimationError, setCollimationError] = useState(""); // arcseconds
const [trunnionAxisError, setTrunnionAxisError] = useState(""); // arcseconds
const [indexError, setIndexError] = useState(""); // arcseconds

// Station setup
const [stationId, setStationId] = useState("");
const [stationE, setStationE] = useState("");
const [stationN, setStationN] = useState("");
const [stationZ, setStationZ] = useState("");
const [instrumentHeight, setInstrumentHeight] = useState("");

// Observations
interface TsObs {
  id: string;
  targetHeight: number;
  faceLeft: { hz: number; v: number; sd: number } | null;
  faceRight: { hz: number; v: number; sd: number } | null;
  remark: string;
}
const [tsObs, setTsObs] = useState<TsObs[]>([]);
const [tsReduced, setTsReduced] = useState<Array<any>>([]);
const [tsChecks, setTsChecks] = useState<Record<string, string> | null>(null);

// Atm PPM: formula from Leica/Trimble — Metschke formula
// PPM = 286.35 - (107.68 * P / (273.15 + T))  (approximate)
const atmosphericPPM = React.useMemo(() => {
  const temperatureValue = temperature.trim() === "" ? Number.NaN : Number(temperature);
  const pressureValue = pressure.trim() === "" ? Number.NaN : Number(pressure);
  if (!Number.isFinite(temperatureValue) || !Number.isFinite(pressureValue) || 273.15 + temperatureValue <= 0 || pressureValue <= 0) return null;
  const ppm = 286.35 - (107.68 * pressureValue / (273.15 + temperatureValue));
  return Number.isFinite(ppm) ? Math.round(ppm * 10) / 10 : null;
}, [temperature, pressure]);

const edmPpmValue = edmPpm.trim() === "" ? Number.NaN : Number(edmPpm);
const totalPPM = atmosphericPPM !== null && Number.isFinite(edmPpmValue) ? atmosphericPPM + edmPpmValue : null;

// Collimation + index correction (in arcseconds → radians)
const collimationErrorValue = collimationError.trim() ? Number(collimationError) : Number.NaN;
const indexErrorValue = indexError.trim() ? Number(indexError) : Number.NaN;
const trunnionAxisErrorValue = trunnionAxisError.trim() ? Number(trunnionAxisError) : Number.NaN;
const collRad = React.useMemo(() => (collimationErrorValue / 3600) * Math.PI / 180, [collimationErrorValue]);
const indexRad = React.useMemo(() => (indexErrorValue / 3600) * Math.PI / 180, [indexErrorValue]);
const trunnionRad = React.useMemo(() => (trunnionAxisErrorValue / 3600) * Math.PI / 180, [trunnionAxisErrorValue]);

const DEG = Math.PI / 180;

/** Curvature & refraction correction (m) for horizontal distance K in km. */
function curvatureRefractionCorrection(horizDistM: number): number {
  const k = horizDistM / 1000;
  return 0.0675 * k * k;
}

// Average face-left / face-right
const averageObs = (fl: { hz: number; v: number; sd: number } | null, fr: { hz: number; v: number; sd: number } | null) => {
  if (fl && fr) {
    let hzAvg = (fl.hz + fr.hz - 180) / 2;
    if (hzAvg < 0) hzAvg += 360;
    const vAvg = (fl.v + (360 - fr.v)) / 2;
    const sdAvg = (fl.sd + fr.sd) / 2;
    return { hz: hzAvg, v: vAvg, sd: sdAvg, faceCombo: "FL+FR" as const };
  }
  if (fl) return { ...fl, faceCombo: "FL" as const };
  if (fr) return { hz: fr.hz - 180 < 0 ? fr.hz + 180 : fr.hz - 180, v: 360 - fr.v, sd: fr.sd, faceCombo: "FR" as const };
  return null;
};

const reduceTS = () => {
  setTsReduced([]);
  setTsChecks(null);
  const requiredNumber = (raw: string, name: string): number => {
    if (!raw.trim()) throw new Error(`${name} is required.`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
    return value;
  };
  let stationEValue: number;
  let stationNValue: number;
  let stationZValue: number;
  let instrumentHeightValue: number;
  let totalPpmValue: number;
  try {
    if (!stationId.trim()) throw new Error("Station ID is required.");
    stationEValue = requiredNumber(stationE, "Station easting");
    stationNValue = requiredNumber(stationN, "Station northing");
    stationZValue = requiredNumber(stationZ, "Station elevation");
    instrumentHeightValue = requiredNumber(instrumentHeight, "Instrument height");
    totalPpmValue = requiredNumber(String(totalPPM ?? ""), "Atmospheric readings and instrument EDM PPM");
    requiredNumber(collimationError, "Measured collimation correction");
    requiredNumber(trunnionAxisError, "Measured trunnion-axis correction");
    requiredNumber(indexError, "Measured vertical-index correction");
    if (tsObs.length === 0) throw new Error("Import or record at least one total-station observation.");
    if (tsObs.some((obs) => !obs.id.trim() || !Number.isFinite(obs.targetHeight) || obs.targetHeight < 0 ||
      (!obs.faceLeft && !obs.faceRight) ||
      [obs.faceLeft, obs.faceRight].some((face) => face !== null && (!Number.isFinite(face.hz) || face.hz < 0 || face.hz >= 360 ||
        !Number.isFinite(face.v) || face.v <= 0 || face.v >= 360 || !Number.isFinite(face.sd) || face.sd <= 0)))) {
      throw new Error("Every observation needs an ID, non-negative target height, horizontal angle from 0 to under 360°, valid vertical circle reading, and positive slope distance.");
    }
  } catch (e) {
    setFieldBookError((e as Error).message);
    return;
  }
  setFieldBookError(null);

  const results: Array<{
    pointId: string; remark: string; faceCombo: string;
    hzCorr: number; vCorr: number; sdCorr: number;
    horizDist: number; zenAngle: number; deltaH: number; crCorr: number;
    deltaE: number; deltaN: number; deltaZ: number;
    easting: number; northing: number; elevation: number;
    distPPM: number;
  }> = [];

  for (const obs of tsObs) {
    const avg = averageObs(obs.faceLeft, obs.faceRight);
    if (!avg) continue;

    // Apply collimation correction to horizontal angle
    let hzCorr = avg.hz;
    hzCorr += collRad / DEG;

    // Apply index error to vertical/zenith angle
    let vCorr = avg.v;
    vCorr += indexRad / DEG;

    // Trunnion axis correction: affects Hz, not V.
    // Formula: ΔHz = trunnionError × cot(verticalCircleReading)
    const trunnionHzCorr = trunnionRad * (1 / Math.tan(vCorr * DEG));
    hzCorr += trunnionHzCorr / DEG;

    // Atmospheric + EDM PPM correction to slope distance
    const distPPM = avg.sd * (totalPpmValue / 1_000_000);
    const sdCorr = avg.sd + distPPM;

    // Zenith angle (convert vertical circle reading if needed — assuming zenith 0°)
    const zenAngle = vCorr;

    // Horizontal distance
    const horizDist = sdCorr * Math.sin(zenAngle * DEG);

    // Height difference (Zenith 0° = straight up, 90° = horizontal)
    // Add curvature & refraction correction for long sights
    const rawDeltaH = sdCorr * Math.cos(zenAngle * DEG) + instrumentHeightValue - obs.targetHeight;
    const crCorr = curvatureRefractionCorrection(horizDist);
    const deltaH = rawDeltaH - crCorr;

    // Bearing from horizontal angle (Hz = azimuth)
    const bearing = hzCorr;

    // dE, dN from horizontal distance + bearing
    const deltaE = horizDist * Math.sin(bearing * DEG);
    const deltaN = horizDist * Math.cos(bearing * DEG);

    // Absolute coordinates
    const easting = stationEValue + deltaE;
    const northing = stationNValue + deltaN;
    const elevation = stationZValue + deltaH;

    results.push({
      pointId: obs.id, remark: obs.remark, faceCombo: avg.faceCombo,
      hzCorr, vCorr, sdCorr, horizDist, zenAngle, deltaH,
      crCorr, deltaE, deltaN, deltaZ: deltaH,
      easting, northing, elevation, distPPM,
    });
  }

  setTsReduced(results);

  // Arithmetic checks
  const checks: Record<string, string> = {};
  const totalDist = results.reduce((s, r) => s + r.horizDist, 0);
  const totalDeltaE = results.reduce((s, r) => s + r.deltaE, 0);
  const totalDeltaN = results.reduce((s, r) => s + r.deltaN, 0);
  const totalDeltaH = results.reduce((s, r) => s + r.deltaH, 0);
  checks["Total Horiz Distance"] = `${totalDist.toFixed(3)} m`;
  checks["Sum ΔE"] = `${totalDeltaE >= 0 ? "+" : ""}${totalDeltaE.toFixed(3)} m`;
  checks["Sum ΔN"] = `${totalDeltaN >= 0 ? "+" : ""}${totalDeltaN.toFixed(3)} m`;
  checks["Sum ΔH"] = `${totalDeltaH >= 0 ? "+" : ""}${totalDeltaH.toFixed(3)} m`;
  checks["Atmospheric PPM"] = `${atmosphericPPM?.toFixed(1) ?? "—"} ppm @ ${temperature}°C, ${pressure} hPa`;
  checks["Total EDM PPM"] = `${totalPpmValue.toFixed(1)} ppm (atm + instrument)`;
  const maxCR = results.reduce((m, r) => Math.max(m, Math.abs(r.crCorr)), 0);
  checks["Curvature & Refraction"] = `max ${(-maxCR * 1000).toFixed(1)} mm @ ${results.length} sights`;
    checks["Instrument corrections"] = `Collimation ${collimationErrorValue}″ · Trunnion ${trunnionAxisErrorValue}″ · Index ${indexErrorValue}″`;
    checks["Instrument"] = `${stationId} — IH=${instrumentHeightValue.toFixed(3)} m`;
  checks["Stn Coords"] = `E ${stationEValue.toFixed(3)}  N ${stationNValue.toFixed(3)}  Z ${stationZValue.toFixed(3)}`;
  setTsChecks(checks);
};

const addTsObs = () => {
  const n = tsObs.length + 1;
  setTsObs([...tsObs, { id: `FS${n}`, targetHeight: Number.NaN, faceLeft: { hz: Number.NaN, v: Number.NaN, sd: Number.NaN }, faceRight: null, remark: "" }]);
};

const removeTsObs = (idx: number) => setTsObs(tsObs.filter((_, i) => i !== idx));

const updateTsObs = (idx: number, field: string, sub: string | null, value: string) => {
  const copy = [...tsObs];
  const obs = { ...copy[idx]! };
  if (sub) {
    const face = { ...((obs as any)[sub] || { hz: Number.NaN, v: Number.NaN, sd: Number.NaN }) };
    (face as any)[field] = value.trim() === "" ? Number.NaN : Number(value);
    (obs as any)[sub] = face;
  } else {
    (obs as any)[field] = field === "remark" ? value : value.trim() === "" ? Number.NaN : Number(value);
  }
  copy[idx] = obs;
  setTsObs(copy);
};

const pasteCsvObs = (csv: string) => {
  try {
    const lines = csv.trim().split(/\r?\n/).filter(l => l.trim());
    const parsed: TsObs[] = lines.map(line => {
      const parts = line.split(/[;,\\t]+/).map(s => s.trim());
      return {
        id: parts[0] || "PT",
        targetHeight: parts[1] ? Number(parts[1]) : Number.NaN,
        faceLeft: { hz: parts[2] ? Number(parts[2]) : Number.NaN, v: parts[3] ? Number(parts[3]) : Number.NaN, sd: parts[4] ? Number(parts[4]) : Number.NaN },
        faceRight: parts[5] ? { hz: Number(parts[5]), v: parts[6] ? Number(parts[6]) : Number.NaN, sd: parts[7] ? Number(parts[7]) : Number.NaN } : null,
        remark: parts[8] || "",
      };
    });
    setTsObs(parsed);
  } catch { /* ignore parse errors */ }
};

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Digital Field Book & Instrument Reduction Engine
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Direct reduction of digital level runs (Rise &amp; Fall / Collimation) and Total Station raw angles and slope distances.
      </p>

      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-default)", paddingBottom: "8px", alignItems: "center" }}>
        <button className={bookType === "leveling" ? "primary" : ""} onClick={() => setBookType("leveling")}>Digital Leveling Book</button>
        <button className={bookType === "total_station" ? "primary" : ""} onClick={() => setBookType("total_station")}>Total Station 3D Polar Book</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowFormatGuide(!showFormatGuide)} style={{ fontSize: "var(--text-xs)", color: showFormatGuide ? "var(--accent-primary)" : "var(--text-tertiary)" }}>
          {showFormatGuide ? "✕ Hide Formats" : "? Supported Formats"}
        </button>
        <input type="file" id="import-file" accept=".csv,.gsi,.sdr,.xml,.txt,.dat" style={{ display: "none" }} onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result ?? "");
            const fmt = detectFormat(text);
            const parsed = importInstrumentData(text);
            setImportPreview({ format: fmt, count: parsed.observations.length, fileName: file.name });
            setTimeout(() => setImportPreview(null), 5000);
            if (parsed.type === "total_station") {
              setTsObs(parsed.observations.map(o => ({ id: o.pointId, targetHeight: o.targetHeight, faceLeft: o.faceLeft, faceRight: o.faceRight, remark: o.remark })));
              setBookType("total_station");
            } else {
              setLevelingRows(parsed.observations);
              setBookType("leveling");
            }
          };
          reader.readAsText(file);
          e.target.value = "";
        }} />
        <button onClick={() => document.getElementById("import-file")?.click()} style={{ fontSize: "var(--text-xs)" }}>
          📂 Import File
        </button>
      </div>

      {/* ── Format Guide Panel ── */}
      {showFormatGuide && (
        <div style={{ padding: "12px", border: "1px solid var(--border-default)", borderRadius: "8px", background: "var(--bg-tertiary)", fontSize: "11px" }}>
          <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)", fontSize: "12px" }}>Supported Instrument Data Formats</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "8px" }}>
            {Object.entries(FORMAT_DESCRIPTIONS).map(([key, desc]) => (
              <div key={key} style={{ padding: "8px", border: "1px solid var(--border-default)", borderRadius: "6px", background: "var(--bg-primary)" }}>
                <div style={{ fontWeight: 600, color: "var(--accent-primary)", marginBottom: "4px" }}>{desc.label}</div>
                <div style={{ color: "var(--text-secondary)", marginBottom: "4px" }}>Extensions: <code>{desc.extensions}</code></div>
                <pre style={{ margin: 0, padding: "4px 6px", background: "var(--bg-secondary)", borderRadius: "4px", fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", overflow: "auto", whiteSpace: "pre-wrap" }}>{desc.example}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Import Preview Toast ── */}
      {importPreview && (
        <div style={{ padding: "8px 12px", borderRadius: "6px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>✓</span>
          <span>Imported <strong>{importPreview.count}</strong> observations from <strong>{importPreview.fileName}</strong></span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", padding: "1px 5px", background: "var(--bg-primary)", borderRadius: "3px" }}>{importPreview.format.toUpperCase()}</span>
        </div>
      )}

      {/* ── Live Instrument Connection ── */}
      <div style={{ padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: "8px", background: "var(--bg-tertiary)", fontSize: "11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: liveMode ? "8px" : 0 }}>
          <button
            onClick={() => setLiveMode(!liveMode)}
            style={{
              padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 500, cursor: "pointer",
              border: `1px solid ${liveMode ? "#22c55e" : "var(--border-default)"}`,
              background: liveMode ? "rgba(34,197,94,0.1)" : "var(--bg-primary)",
              color: liveMode ? "#22c55e" : "var(--text-secondary)",
            }}
          >
            {liveMode ? "● LIVE" : "○ Live Mode"}
          </button>
          {instrument.state.connected && (
            <span style={{ color: "#22c55e", fontFamily: "var(--font-mono)" }}>
              Connected: {instrument.connections[0]?.instrument_name || instrument.connections[0]?.port || "instrument"}
            </span>
          )}
          {liveMode && instrument.state.connected && (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", marginLeft: "auto" }}>
              {liveCount} live obs · {instrument.observationCount} total
            </span>
          )}
        </div>
        {liveMode && (
          <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", flexWrap: "wrap" }}>
            {!instrument.state.connected ? (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "10px", color: "var(--text-tertiary)", marginBottom: "2px" }}>Port</label>
                  <select
                    value={instrument.serialPorts[0]?.port_name || ""}
                    onChange={e => {
                      const port = e.target.value;
                      if (port) instrument.connect({ connection_type: "serial", port, baud_rate: 115200 });
                    }}
                    style={{ padding: "4px 6px", fontSize: "11px", fontFamily: "var(--font-mono)" }}
                  >
                    <option value="">Select port…</option>
                    {instrument.serialPorts.map(p => (
                      <option key={p.port_name} value={p.port_name}>{p.display_name || p.port_name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => instrument.refreshPorts()}
                  style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", border: "1px solid var(--border-default)", background: "var(--bg-primary)", color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  ↻ Refresh
                </button>
                <button
                  onClick={() => instrument.scanBle()}
                  style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", border: "1px solid var(--border-default)", background: "var(--bg-primary)", color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  ⚡ BLE Scan
                </button>
              </>
            ) : (
              <button
                onClick={() => instrument.state.connectionId && instrument.disconnect(instrument.state.connectionId)}
                style={{ padding: "4px 10px", fontSize: "10px", borderRadius: "4px", border: "1px solid var(--border-error, #ef4444)", background: "transparent", color: "var(--text-error, #ef4444)", cursor: "pointer" }}
              >
                Disconnect
              </button>
            )}
            {instrument.state.error && (
              <span style={{ color: "var(--text-error, #ef4444)", fontSize: "10px" }}>{instrument.state.error}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Drag-and-Drop Zone ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result ?? "");
            const fmt = detectFormat(text);
            const parsed = importInstrumentData(text);
            setImportPreview({ format: fmt, count: parsed.observations.length, fileName: file.name });
            setTimeout(() => setImportPreview(null), 5000);
            if (parsed.type === "total_station") {
              setTsObs(parsed.observations.map(o => ({ id: o.pointId, targetHeight: o.targetHeight, faceLeft: o.faceLeft, faceRight: o.faceRight, remark: o.remark })));
              setBookType("total_station");
            } else {
              setLevelingRows(parsed.observations);
              setBookType("leveling");
            }
          };
          reader.readAsText(file);
        }}
        style={{
          padding: dragOver ? "20px" : "8px",
          border: dragOver ? "2px dashed var(--accent-primary)" : "1px dashed var(--border-default)",
          borderRadius: "8px",
          textAlign: "center",
          fontSize: "11px",
          color: dragOver ? "var(--accent-primary)" : "var(--text-tertiary)",
          background: dragOver ? "rgba(255,149,0,0.05)" : "transparent",
          transition: "all 0.15s ease",
          cursor: "pointer",
        }}
        onClick={() => document.getElementById("import-file")?.click()}
      >
        {dragOver ? "📂 Drop instrument data file here" : "Drag & drop CSV, GSI, SDR, XML, or TXT file here — or click Import"}
      </div>
{bookType === "leveling" && (
  <div>
    <button className="primary" onClick={reduceLeveling} style={{ marginBottom: "12px" }}>
      Reduce Leveling Run (Rise & Fall)
    </button>

    {arithmeticCheck && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "12px" }}>
        <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>ΣBS - ΣFS</div>
          <div style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-mono)" }}>
            {arithmeticCheck.sumBS.toFixed(3)} - {arithmeticCheck.sumFS.toFixed(3)} = {arithmeticCheck.deltaBSFS.toFixed(3)} m
          </div>
        </div>
        <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Last RL - First RL</div>
          <div style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-mono)" }}>{arithmeticCheck.deltaRL.toFixed(3)} m</div>
        </div>
        <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Page Arithmetic Check</div>
          <div style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-mono)", color: arithmeticCheck.valid ? "var(--status-success)" : "var(--status-error)" }}>
            {arithmeticCheck.valid ? "✓ Arithmetic check passed" : "✗ Check failed"}
          </div>
        </div>
      </div>
    )}

    {fieldBookError && (
      <div role="alert" style={{ marginBottom: "12px", padding: "8px 12px", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
        {fieldBookError}
      </div>
    )}

    {levelingRows.length === 0 && (
      <div role="status" style={{ marginBottom: "12px", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
        Import level observations or connect a supported instrument to begin. No sample readings are loaded.
      </div>
    )}

    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
      <thead>
        <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
          <th style={{ padding: "6px 8px", textAlign: "left" }}>Station</th>
          <th style={{ padding: "6px 8px", textAlign: "right" }}>BS</th>
          <th style={{ padding: "6px 8px", textAlign: "right" }}>IS</th>
          <th style={{ padding: "6px 8px", textAlign: "right" }}>FS</th>
          <th style={{ padding: "6px 8px", textAlign: "right" }}>Rise</th>
          <th style={{ padding: "6px 8px", textAlign: "right" }}>Fall</th>
          <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--accent-primary)" }}>RL</th>
          <th style={{ padding: "6px 8px", textAlign: "left" }}>Remarks</th>
        </tr>
      </thead>
      <tbody>
        {(levelingReduced.length > 0
          ? levelingReduced
          : levelingRows.map((row) => ({ ...row, rise: null, fall: null, finalRL: row.rl }))
        ).map((row, idx) => (
          <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{row.id}</td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>{row.bs !== null ? row.bs.toFixed(3) : "—"}</td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>{row.is !== null ? row.is.toFixed(3) : "—"}</td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>{row.fs !== null ? row.fs.toFixed(3) : "—"}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--status-success)" }}>{row.rise != null ? row.rise.toFixed(3) : "—"}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--status-error)" }}>{row.fall != null ? row.fall.toFixed(3) : "—"}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{(row.finalRL ?? row.rl).toFixed(3)} m</td>
            <td style={{ padding: "6px 8px", color: "var(--text-secondary)" }}>{row.remark}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
{bookType === "total_station" && (
  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
    <div role="note" style={{ padding: "8px 12px", border: "1px solid var(--border-warning, #D97706)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
      Local reduction preview only. Results are not transferred to other workflows and do not establish a project CRS, vertical reference, calibration certificate, observation uncertainty, or professional acceptance.
    </div>
    {/* ── Instrument & Atmospheric Setup ── */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Station Setup</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Station ID</label>
            <input value={stationId} onChange={e => setStationId(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Inst. Height (m)</label>
            <input type="number" value={instrumentHeight} step={0.001} onChange={e => setInstrumentHeight(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Easting (m)</label>
            <input type="number" value={stationE} step={0.001} onChange={e => setStationE(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Northing (m)</label>
            <input type="number" value={stationN} step={0.001} onChange={e => setStationN(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Elevation (m)</label>
            <input type="number" value={stationZ} step={0.001} onChange={e => setStationZ(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
      </div>

      <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Atmospheric & EDM Corrections</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Temperature (°C)</label>
            <input type="number" value={temperature} step={0.5} onChange={e => setTemperature(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Pressure (hPa)</label>
            <input type="number" value={pressure} step={0.1} onChange={e => setPressure(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Instrument EDM PPM</label>
            <input type="number" value={edmPpm} step={1} onChange={e => setEdmPpm(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <div style={{ padding: "6px 10px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
              Total PPM: <strong style={{ color: "var(--accent-primary)" }}>{totalPPM?.toFixed(1) ?? "—"}</strong>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginLeft: 6 }}>(atm {atmosphericPPM?.toFixed(1) ?? "—"} + edm {edmPpm || "—"})</span>
            </div>
          </div>
        </div>

        <h4 style={{ margin: "12px 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Instrument Calibration Corrections (arcseconds)</h4>
        <div style={{ marginBottom: "8px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Enter the applicable measured corrections. Blank values block reduction; zero must be entered explicitly.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Collimation (″)</label>
            <input type="number" value={collimationError} step={1} onChange={e => setCollimationError(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Trunnion Axis (″)</label>
            <input type="number" value={trunnionAxisError} step={1} onChange={e => setTrunnionAxisError(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Index Error (″)</label>
            <input type="number" value={indexError} step={1} onChange={e => setIndexError(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
      </div>
    </div>

    {/* ── Observation Table ── */}
    <div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
        <button className="primary" onClick={reduceTS}>Reduce All Observations</button>
        <button onClick={addTsObs}>+ Add Observation</button>
        <button onClick={() => {
          const csv = prompt("Paste CSV: id,TargetH,FL_Hz,FL_V,FL_SD,FR_Hz,FR_V,FR_SD,Remark\\nOr one value per line: id,TH,Hz,V,SD");
          if (csv) pasteCsvObs(csv);
        }}>📋 Paste CSV</button>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          {tsObs.length} observations · {tsObs.filter(o => o.faceLeft && o.faceRight).length} FL+FR pairs
        </span>
      </div>

      {fieldBookError && (
        <div role="alert" style={{ marginBottom: "12px", padding: "8px 12px", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          {fieldBookError}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "4px 6px", textAlign: "left" }}>Pt</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>TH (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(34,197,94,0.08)" }}>FL Hz (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(34,197,94,0.08)" }}>FL V (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(34,197,94,0.08)" }}>FL SD (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(59,130,246,0.08)" }}>FR Hz (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(59,130,246,0.08)" }}>FR V (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", background: "rgba(59,130,246,0.08)" }}>FR SD (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "left" }}>Remark</th>
              <th style={{ padding: "4px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {tsObs.map((obs, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "3px 4px" }}><input value={obs.id} onChange={e => updateTsObs(idx, "id", null, e.target.value)} style={{ width: "60px", fontSize: "var(--text-xs)" }} /></td>
                <td style={{ padding: "3px 4px" }}><input type="number" value={Number.isFinite(obs.targetHeight) ? obs.targetHeight : ""} step={0.001} onChange={e => updateTsObs(idx, "targetHeight", null, e.target.value)} style={{ width: "65px", fontSize: "var(--text-xs)" }} /></td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceLeft?.hz) ? obs.faceLeft!.hz : ""} step={0.0001} onChange={e => updateTsObs(idx, "hz", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceLeft?.v) ? obs.faceLeft!.v : ""} step={0.0001} onChange={e => updateTsObs(idx, "v", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceLeft?.sd) ? obs.faceLeft!.sd : ""} step={0.001} onChange={e => updateTsObs(idx, "sd", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceRight?.hz) ? obs.faceRight!.hz : ""} step={0.0001} onChange={e => updateTsObs(idx, "hz", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceRight?.v) ? obs.faceRight!.v : ""} step={0.0001} onChange={e => updateTsObs(idx, "v", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={Number.isFinite(obs.faceRight?.sd) ? obs.faceRight!.sd : ""} step={0.001} onChange={e => updateTsObs(idx, "sd", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px" }}><input value={obs.remark} onChange={e => updateTsObs(idx, "remark", null, e.target.value)} style={{ width: "100px", fontSize: "var(--text-xs)" }} /></td>
                <td style={{ padding: "3px 4px" }}>
                  <button onClick={() => removeTsObs(idx)} style={{ background: "none", border: "none", color: "var(--status-error)", cursor: "pointer", fontSize: "var(--text-xs)" }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* ── Reduction Results ── */}
    {tsChecks && (
      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>Reduction Summary</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginBottom: "12px" }}>
          {Object.entries(tsChecks).map(([k, v]) => (
            <div key={k} style={{ padding: "6px 10px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{k}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>{v}</div>
            </div>
          ))}
        </div>

        <h4 style={{ margin: "0 0 8px 0", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>Computed Coordinates</h4>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "4px 6px", textAlign: "left" }}>Point</th>
              <th style={{ padding: "4px 6px", textAlign: "center" }}>Face</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Hz Corr (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>V Corr (°)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>SD Corr (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Horiz Dist (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>ΔH (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--status-success)" }}>Easting (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--status-success)" }}>Northing (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--accent-primary)" }}>Elevation (m)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>C&R (mm)</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>PPM Δ (m)</th>
            </tr>
          </thead>
          <tbody>
            {tsReduced.map((r, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "4px 6px", fontWeight: "bold" }}>{r.pointId}</td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>
                  <span style={{ padding: "1px 6px", fontSize: "10px", background: r.faceCombo === "FL+FR" ? "rgba(34,197,94,0.15)" : "rgba(255,149,0,0.15)", color: r.faceCombo === "FL+FR" ? "var(--status-success)" : "var(--accent-primary)", borderRadius: "3px" }}>
                    {r.faceCombo}
                  </span>
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.hzCorr.toFixed(4)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.vCorr.toFixed(4)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.sdCorr.toFixed(3)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.horizDist.toFixed(3)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", color: r.deltaH >= 0 ? "var(--status-success)" : "var(--status-error)" }}>
                  {r.deltaH >= 0 ? "+" : ""}{r.deltaH.toFixed(3)}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.easting.toFixed(3)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.northing.toFixed(3)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: "bold" }}>{r.elevation.toFixed(3)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-tertiary)" }}>{(-r.crCorr * 1000).toFixed(1)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-tertiary)" }}>{r.distPPM >= 0 ? "+" : ""}{(r.distPPM * 1000).toFixed(1)} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}

    </div>
  );
};
