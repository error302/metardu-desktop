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

import React, { useState, useRef } from "react";
import { importInstrumentData } from "../instrument-import.js";
import { bus } from "../cross-import-bus.js";

export const FieldBookView: React.FC = () => {
  const [bookType, setBookType] = useState<"leveling" | "total_station">("leveling");

  // ──── DIGITAL LEVELING BOOK ────

  const [levelingRows, setLevelingRows] = useState([
    { id: "BM1", bs: 1.452, is: null as number | null, fs: null as number | null, rl: 100.000, remark: "Bench Mark 1" },
    { id: "CP1", bs: 1.230, is: null as number | null, fs: 0.985, rl: 0, remark: "Change Point 1" },
    { id: "IS1", bs: null as number | null, is: 1.670, fs: null as number | null, rl: 0, remark: "Ground Level" },
    { id: "BM2", bs: null as number | null, is: null as number | null, fs: 1.120, rl: 0, remark: "Closing Bench Mark" },
  ]);

  const [levelingReduced, setLevelingReduced] = useState<Array<any>>([]);
  const [arithmeticCheck, setArithmeticCheck] = useState<{ sumBS: number; sumFS: number; deltaBSFS: number; deltaRL: number; valid: boolean } | null>(null);

  const reduceLeveling = () => {
    let currentRL = levelingRows[0]?.rl ?? 100.0;
    let sumBS = 0;
    let sumFS = 0;
    let prevStaff = levelingRows[0]?.bs ?? 0;

    const reduced = [];

    for (let i = 0; i < levelingRows.length; i++) {
      const row = levelingRows[i]!;
      if (row.bs !== null) sumBS += row.bs;
      if (row.fs !== null) sumFS += row.fs;

      if (i === 0) {
        reduced.push({ ...row, rise: null, fall: null, finalRL: currentRL });
        continue;
      }

      const staffVal = row.is !== null ? row.is : (row.fs ?? 0);
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

    const firstRL = levelingRows[0]?.rl ?? 100.0;
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
const [temperature, setTemperature] = useState(20);
const [pressure, setPressure] = useState(1013.25);
const [edmPpm, setEdmPpm] = useState(0);

// Instrumental errors
const [collimationError, setCollimationError] = useState(0); // arcseconds
const [trunnionAxisError, setTrunnionAxisError] = useState(0); // arcseconds
const [indexError, setIndexError] = useState(0); // arcseconds

// Station setup
const [stationId, setStationId] = useState("STN1");
const [stationE, setStationE] = useState(257100.000);
const [stationN, setStationN] = useState(9857700.000);
const [stationZ, setStationZ] = useState(100.000);
const [instrumentHeight, setInstrumentHeight] = useState(1.500);

// Observations
interface TsObs {
  id: string;
  targetHeight: number;
  faceLeft: { hz: number; v: number; sd: number } | null;
  faceRight: { hz: number; v: number; sd: number } | null;
  remark: string;
}
const defaultObs: TsObs[] = [
  { id: "FS1", targetHeight: 1.600, faceLeft: { hz: 45.2317, v: 87.5431, sd: 45.234 }, faceRight: { hz: 225.2319, v: 272.4573, sd: 45.236 }, remark: "Far Side 1" },
  { id: "FS2", targetHeight: 1.600, faceLeft: { hz: 112.0542, v: 92.1025, sd: 78.912 }, faceRight: null, remark: "Far Side 2" },
  { id: "FS3", targetHeight: 1.600, faceLeft: { hz: 198.4410, v: 89.3320, sd: 32.456 }, faceRight: { hz: 18.4408, v: 270.6684, sd: 32.458 }, remark: "Far Side 3" },
];
const [tsObs, setTsObs] = useState<TsObs[]>(defaultObs);
const [tsReduced, setTsReduced] = useState<Array<any>>([]);
const [tsChecks, setTsChecks] = useState<Record<string, string> | null>(null);

// Atm PPM: formula from Leica/Trimble — Metschke formula
// PPM = 286.35 - (107.68 * P / (273.15 + T))  (approximate)
const atmosphericPPM = React.useMemo(() => {
  const ppm = 286.35 - (107.68 * pressure / (273.15 + temperature));
  return Math.round(ppm * 10) / 10;
}, [temperature, pressure]);

const totalPPM = atmosphericPPM + edmPpm;

// Collimation + index correction (in arcseconds → radians)
const collRad = React.useMemo(() => (collimationError / 3600) * Math.PI / 180, [collimationError]);
const indexRad = React.useMemo(() => (indexError / 3600) * Math.PI / 180, [indexError]);
const trunnionRad = React.useMemo(() => (trunnionAxisError / 3600) * Math.PI / 180, [trunnionAxisError]);

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
  const results: Array<{
    pointId: string; remark: string; faceCombo: string;
    hzCorr: number; vCorr: number; sdCorr: number;
    horizDist: number; zenAngle: number; deltaH: number;
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
    const distPPM = avg.sd * (totalPPM / 1_000_000);
    const sdCorr = avg.sd + distPPM;

    // Zenith angle (convert vertical circle reading if needed — assuming zenith 0°)
    const zenAngle = vCorr;

    // Horizontal distance
    const horizDist = sdCorr * Math.sin(zenAngle * DEG);

    // Height difference (Zenith 0° = straight up, 90° = horizontal)
    // Add curvature & refraction correction for long sights
    const rawDeltaH = sdCorr * Math.cos(zenAngle * DEG) + instrumentHeight - obs.targetHeight;
    const crCorr = curvatureRefractionCorrection(horizDist);
    const deltaH = rawDeltaH - crCorr;

    // Bearing from horizontal angle (Hz = azimuth)
    const bearing = hzCorr;

    // dE, dN from horizontal distance + bearing
    const deltaE = horizDist * Math.sin(bearing * DEG);
    const deltaN = horizDist * Math.cos(bearing * DEG);

    // Absolute coordinates
    const easting = stationE + deltaE;
    const northing = stationN + deltaN;
    const elevation = stationZ + deltaH;

    results.push({
      pointId: obs.id, remark: obs.remark, faceCombo: avg.faceCombo,
      hzCorr, vCorr, sdCorr, horizDist, zenAngle, deltaH,
      crCorr, deltaE, deltaN, deltaZ: deltaH,
      easting, northing, elevation, distPPM,
    });
  }

  setTsReduced(results);

  // Publish reduced readings for downstream views (Traverse import, etc.)
  for (const r of results) {
    bus.emit("fieldbook:reading", {
      station: stationId, target: r.pointId,
      distance: r.horizDist, bearing: r.hzCorr,
      zenithAngle: r.zenAngle, sigma: 0.005,
    });
  }

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
  checks["Atmospheric PPM"] = `${atmosphericPPM.toFixed(1)} ppm @ ${temperature}°C, ${pressure} hPa`;
  checks["Total EDM PPM"] = `${totalPPM.toFixed(1)} ppm (atm + instrument)`;
  const maxCR = results.reduce((m, r) => Math.max(m, Math.abs(r.crCorr)), 0);
  checks["Curvature & Refraction"] = `max ${(-maxCR * 1000).toFixed(1)} mm @ ${results.length} sights`;
  checks["Instrument"] = `${stationId} — IH=${instrumentHeight.toFixed(3)} m`;
  checks["Stn Coords"] = `E ${stationE.toFixed(3)}  N ${stationN.toFixed(3)}  Z ${stationZ.toFixed(3)}`;
  setTsChecks(checks);
};

const addTsObs = () => {
  const n = tsObs.length + 1;
  setTsObs([...tsObs, { id: `FS${n}`, targetHeight: 1.600, faceLeft: { hz: 0, v: 90, sd: 0 }, faceRight: null, remark: "" }]);
};

const removeTsObs = (idx: number) => setTsObs(tsObs.filter((_, i) => i !== idx));

const updateTsObs = (idx: number, field: string, sub: string | null, value: string) => {
  const copy = [...tsObs];
  const obs = { ...copy[idx]! };
  if (sub) {
    const face = { ...((obs as any)[sub] || { hz: 0, v: 90, sd: 0 }) };
    (face as any)[field] = parseFloat(value) || 0;
    (obs as any)[sub] = face;
  } else {
    (obs as any)[field] = field === "remark" ? value : parseFloat(value) || 0;
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
        targetHeight: parseFloat(parts[1]) || 1.6,
        faceLeft: { hz: parseFloat(parts[2]) || 0, v: parseFloat(parts[3]) || 90, sd: parseFloat(parts[4]) || 0 },
        faceRight: parts[5] ? { hz: parseFloat(parts[5]) || 0, v: parseFloat(parts[6]) || 270, sd: parseFloat(parts[7]) || 0 } : null,
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
        <input type="file" id="import-file" accept=".csv,.gsi,.sdr,.txt,.dat" style={{ display: "none" }} onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result ?? "");
            const parsed = importInstrumentData(text);
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
          📂 Import Instrument Data (CSV/GSI/SDR)
        </button>
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
            {arithmeticCheck.valid ? "✓ VERIFIED (0.000 error)" : "✗ CHECK FAILED"}
          </div>
        </div>
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
        {(levelingReduced.length > 0 ? levelingReduced : levelingRows).map((row, idx) => (
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
            <input type="number" value={instrumentHeight} step={0.001} onChange={e => setInstrumentHeight(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Easting (m)</label>
            <input type="number" value={stationE} step={0.001} onChange={e => setStationE(parseFloat(e.target.value) || 0)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Northing (m)</label>
            <input type="number" value={stationN} step={0.001} onChange={e => setStationN(parseFloat(e.target.value) || 0)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Elevation (m)</label>
            <input type="number" value={stationZ} step={0.001} onChange={e => setStationZ(parseFloat(e.target.value) || 0)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
      </div>

      <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Atmospheric & EDM Corrections</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Temperature (°C)</label>
            <input type="number" value={temperature} step={0.5} onChange={e => setTemperature(parseFloat(e.target.value) || 20)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Pressure (hPa)</label>
            <input type="number" value={pressure} step={0.1} onChange={e => setPressure(parseFloat(e.target.value) || 1013.25)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Instrument EDM PPM</label>
            <input type="number" value={edmPpm} step={1} onChange={e => setEdmPpm(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <div style={{ padding: "6px 10px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
              Total PPM: <strong style={{ color: "var(--accent-primary)" }}>{totalPPM.toFixed(1)}</strong>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginLeft: 6 }}>(atm {atmosphericPPM.toFixed(1)} + edm {edmPpm})</span>
            </div>
          </div>
        </div>

        <h4 style={{ margin: "12px 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Instrumental Errors</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Collimation (″)</label>
            <input type="number" value={collimationError} step={1} onChange={e => setCollimationError(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Trunnion Axis (″)</label>
            <input type="number" value={trunnionAxisError} step={1} onChange={e => setTrunnionAxisError(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Index Error (″)</label>
            <input type="number" value={indexError} step={1} onChange={e => setIndexError(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
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
                <td style={{ padding: "3px 4px" }}><input type="number" value={obs.targetHeight} step={0.001} onChange={e => updateTsObs(idx, "targetHeight", null, e.target.value)} style={{ width: "65px", fontSize: "var(--text-xs)" }} /></td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={obs.faceLeft?.hz ?? ""} step={0.0001} onChange={e => updateTsObs(idx, "hz", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={obs.faceLeft?.v ?? ""} step={0.0001} onChange={e => updateTsObs(idx, "v", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(34,197,94,0.04)" }}>
                  <input type="number" value={obs.faceLeft?.sd ?? ""} step={0.001} onChange={e => updateTsObs(idx, "sd", "faceLeft", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={obs.faceRight?.hz ?? ""} step={0.0001} onChange={e => updateTsObs(idx, "hz", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={obs.faceRight?.v ?? ""} step={0.0001} onChange={e => updateTsObs(idx, "v", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
                </td>
                <td style={{ padding: "3px 4px", background: "rgba(59,130,246,0.04)" }}>
                  <input type="number" value={obs.faceRight?.sd ?? ""} step={0.001} onChange={e => updateTsObs(idx, "sd", "faceRight", e.target.value)} style={{ width: "80px", fontSize: "var(--text-xs)" }} />
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
