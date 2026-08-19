/**
 * Road Design View — Interactive chainage, longitudinal profile, and mass-haul diagram.
 *
 * Features:
 *   - Editable chainage rows with add/remove/reorder
 *   - Longitudinal profile SVG chart (ground line vs design grade)
 *   - Mass-haul diagram SVG chart with balance line
 *   - Cut/fill volume summary with end-area method
 *   - Cross-section template editor
 */

import React, { useState, useMemo, useCallback } from "react";
import { useSurveyState } from "../SurveyStateContext.js";
import { AutoExportBanner } from "./AutoExportBanner.js";
import { Plus, Trash2, ArrowUp, ArrowDown, Download } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────

interface ChainageRow {
  chainage: number;
  groundElev: number;
  designElev: number;
  cutArea: number;
  fillArea: number;
}

interface VolumeRow extends ChainageRow {
  cutVol: number;
  fillVol: number;
  netVol: number;
  cumulativeHaul: number;
}

// ─── Default data ────────────────────────────────────────────────

const DEFAULT_ROWS: ChainageRow[] = [
  { chainage: 0, groundElev: 102.50, designElev: 102.00, cutArea: 2.8, fillArea: 0.0 },
  { chainage: 20, groundElev: 103.10, designElev: 102.20, cutArea: 4.5, fillArea: 0.0 },
  { chainage: 40, groundElev: 104.20, designElev: 102.40, cutArea: 6.2, fillArea: 0.0 },
  { chainage: 60, groundElev: 103.80, designElev: 102.60, cutArea: 3.1, fillArea: 1.5 },
  { chainage: 80, groundElev: 102.10, designElev: 102.80, cutArea: 0.0, fillArea: 4.8 },
  { chainage: 100, groundElev: 101.50, designElev: 103.00, cutArea: 0.0, fillArea: 7.2 },
  { chainage: 120, groundElev: 100.80, designElev: 103.20, cutArea: 0.0, fillArea: 9.5 },
  { chainage: 140, groundElev: 101.20, designElev: 103.40, cutArea: 0.0, fillArea: 6.1 },
  { chainage: 160, groundElev: 102.60, designElev: 103.60, cutArea: 1.2, fillArea: 2.8 },
  { chainage: 180, groundElev: 104.10, designElev: 103.80, cutArea: 3.8, fillArea: 0.0 },
  { chainage: 200, groundElev: 105.00, designElev: 104.00, cutArea: 5.5, fillArea: 0.0 },
];

// ─── Volume computation (end-area method) ────────────────────────

function computeVolumes(rows: ChainageRow[]): VolumeRow[] {
  const result: VolumeRow[] = [];
  let cumHaul = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (i === 0) {
      result.push({ ...r, cutVol: 0, fillVol: 0, netVol: 0, cumulativeHaul: 0 });
      continue;
    }
    const prev = rows[i - 1]!;
    const L = r.chainage - prev.chainage;
    const cutVol = ((prev.cutArea + r.cutArea) / 2) * L;
    const fillVol = ((prev.fillArea + r.fillArea) / 2) * L;
    const netVol = cutVol - fillVol;
    cumHaul += netVol;
    result.push({ ...r, cutVol, fillVol, netVol, cumulativeHaul: cumHaul });
  }
  return result;
}

// ─── SVG Chart: Longitudinal Profile ─────────────────────────────

function LongitudinalProfileChart({ rows, width, height }: { rows: ChainageRow[]; width: number; height: number }) {
  if (rows.length < 2) return <div style={{ color: "var(--text-tertiary)", padding: 20 }}>Need 2+ chainage points</div>;

  const pad = { top: 30, right: 30, bottom: 40, left: 55 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const minCh = rows[0]!.chainage;
  const maxCh = rows[rows.length - 1]!.chainage;
  const allElev = rows.flatMap((r) => [r.groundElev, r.designElev]);
  const minElev = Math.min(...allElev) - 0.5;
  const maxElev = Math.max(...allElev) + 0.5;

  const x = (chainage: number) => pad.left + ((chainage - minCh) / (maxCh - minCh || 1)) * cw;
  const y = (elev: number) => pad.top + ch - ((elev - minElev) / (maxElev - minElev || 1)) * ch;

  const groundPts = rows.map((r) => `${x(r.chainage).toFixed(1)},${y(r.groundElev).toFixed(1)}`).join(" ");
  const designPts = rows.map((r) => `${x(r.chainage).toFixed(1)},${y(r.designElev).toFixed(1)}`).join(" ");

  // Cut/fill fill polygons
  const cutPoly = rows.map((r) => `${x(r.chainage).toFixed(1)},${y(r.groundElev).toFixed(1)}`).join(" ")
    + " " + [...rows].reverse().map((r) => `${x(r.chainage).toFixed(1)},${y(r.designElev).toFixed(1)}`).join(" ");

  // Grid lines
  const elevStep = Math.ceil((maxElev - minElev) / 6);
  const gridLines: string[] = [];
  for (let e = Math.ceil(minElev / elevStep) * elevStep; e <= maxElev; e += elevStep) {
    const gy = y(e);
    gridLines.push(`<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width - pad.right}" y2="${gy.toFixed(1)}" stroke="var(--border-subtle)" stroke-width="0.5"/>`);
    gridLines.push(`<text x="${pad.left - 5}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-tertiary)" font-family="var(--font-mono)">${e.toFixed(1)}</text>`);
  }
  // Chainage labels
  for (const r of rows) {
    if (r.chainage % 40 === 0 || rows.length <= 8) {
      gridLines.push(`<text x="${x(r.chainage).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="8" fill="var(--text-tertiary)" font-family="var(--font-mono)">${r.chainage}</text>`);
    }
  }

  // Station markers
  const markers = rows.map((r) => {
    const cx = x(r.chainage);
    const cy = y(r.groundElev);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="var(--accent-primary)" stroke="var(--bg-primary)" stroke-width="1"/>`;
  }).join("\n    ");

  return (
    <svg width={width} height={height} style={{ background: "var(--bg-primary)", borderRadius: 8 }}>
      <defs>
        <linearGradient id="cutGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(239,68,68,0.2)"/>
          <stop offset="100%" stopColor="rgba(239,68,68,0.05)"/>
        </linearGradient>
      </defs>
      {gridLines.join("\n    ")}
      <polygon points={cutPoly} fill="url(#cutGrad)" stroke="none"/>
      <polyline points={designPts} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6,3"/>
      <polyline points={groundPts} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round"/>
      {markers}
      {/* Legend */}
      <line x1={width - 160} y1={15} x2={width - 140} y2={15} stroke="#22c55e" strokeWidth="2"/>
      <text x={width - 135} y={18} fontSize="9" fill="var(--text-secondary)" fontFamily="var(--font-mono)">Ground</text>
      <line x1={width - 160} y1={28} x2={width - 140} y2={28} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,2"/>
      <text x={width - 135} y={31} fontSize="9" fill="var(--text-secondary)" fontFamily="var(--font-mono)">Design</text>
      <text x={pad.left} y={18} fontSize="10" fontWeight="bold" fill="var(--text-primary)" fontFamily="var(--font-mono)">Longitudinal Profile</text>
    </svg>
  );
}

// ─── SVG Chart: Mass-Haul Diagram ────────────────────────────────

function MassHaulChart({ volumes, width, height }: { volumes: VolumeRow[]; width: number; height: number }) {
  if (volumes.length < 2) return <div style={{ color: "var(--text-tertiary)", padding: 20 }}>Need 2+ points</div>;

  const pad = { top: 30, right: 30, bottom: 40, left: 65 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const haulValues = volumes.map((v) => v.cumulativeHaul);
  const minHaul = Math.min(0, ...haulValues) - 50;
  const maxHaul = Math.max(0, ...haulValues) + 50;
  const minCh = volumes[0]!.chainage;
  const maxCh = volumes[volumes.length - 1]!.chainage;

  const x = (ch: number) => pad.left + ((ch - minCh) / (maxCh - minCh || 1)) * cw;
  const y = (haul: number) => pad.top + ch - ((haul - minHaul) / (maxHaul - minHaul || 1)) * ch;

  // Cumulative haul polyline
  const haulPts = volumes.map((v) => `${x(v.chainage).toFixed(1)},${y(v.cumulativeHaul).toFixed(1)}`).join(" ");

  // Fill above/below zero line
  const zeroY = y(0);
  const aboveZero = volumes.filter((v) => v.cumulativeHaul >= 0);
  const belowZero = volumes.filter((v) => v.cumulativeHaul < 0);

  // Area fill: from haul line down to zero (cut surplus) or up to zero (fill deficit)
  const fillPoly = volumes.map((v) => `${x(v.chainage).toFixed(1)},${y(v.cumulativeHaul).toFixed(1)}`).join(" ")
    + " " + [...volumes].reverse().map((v) => `${x(v.chainage).toFixed(1)},${zeroY.toFixed(1)}`).join(" ");

  // Grid
  const haulStep = Math.ceil((maxHaul - minHaul) / 6 / 10) * 10;
  const gridLines: string[] = [];
  for (let h = Math.ceil(minHaul / haulStep) * haulStep; h <= maxHaul; h += haulStep) {
    const gy = y(h);
    gridLines.push(`<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width - pad.right}" y2="${gy.toFixed(1)}" stroke="var(--border-subtle)" stroke-width="0.5"/>`);
    gridLines.push(`<text x="${pad.left - 5}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-tertiary)" font-family="var(--font-mono)">${h >= 0 ? "+" : ""}${h.toFixed(0)}</text>`);
  }
  // Chainage labels
  for (const v of volumes) {
    gridLines.push(`<text x="${x(v.chainage).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="8" fill="var(--text-tertiary)" font-family="var(--font-mono)">${v.chainage}</text>`);
  }

  // Balance points (where haul crosses zero)
  const balancePoints: string[] = [];
  for (let i = 1; i < volumes.length; i++) {
    const prev = volumes[i - 1]!;
    const curr = volumes[i]!;
    if ((prev.cumulativeHaul < 0 && curr.cumulativeHaul >= 0) || (prev.cumulativeHaul >= 0 && curr.cumulativeHaul < 0)) {
      // Linear interpolation to find crossing chainage
      const t = Math.abs(prev.cumulativeHaul) / (Math.abs(prev.cumulativeHaul) + Math.abs(curr.cumulativeHaul));
      const crossCh = prev.chainage + t * (curr.chainage - prev.chainage);
      balancePoints.push(`<circle cx="${x(crossCh).toFixed(1)}" cy="${zeroY.toFixed(1)}" r="5" fill="#f59e0b" stroke="var(--bg-primary)" stroke-width="2"/>`);
      balancePoints.push(`<text x="${x(crossCh).toFixed(1)}" y="${(zeroY - 10).toFixed(1)}" text-anchor="middle" font-size="8" fill="#f59e0b" font-weight="bold" fontFamily="var(--font-mono)">Balance CH${crossCh.toFixed(0)}</text>`);
    }
  }

  return (
    <svg width={width} height={height} style={{ background: "var(--bg-primary)", borderRadius: 8 }}>
      <defs>
        <linearGradient id="massGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(239,68,68,0.15)"/>
          <stop offset="50%" stopColor="rgba(239,68,68,0.02)"/>
          <stop offset="100%" stopColor="rgba(34,197,94,0.15)"/>
        </linearGradient>
      </defs>
      {gridLines.join("\n    ")}
      {/* Zero line */}
      <line x1={pad.left} y1={zeroY.toFixed(1)} x2={width - pad.right} y2={zeroY.toFixed(1)} stroke="var(--text-tertiary)" strokeWidth="0.8" strokeDasharray="4,2"/>
      {/* Fill area */}
      <polygon points={fillPoly} fill="url(#massGrad)" stroke="none"/>
      {/* Haul line */}
      <polyline points={haulPts} fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinejoin="round"/>
      {/* Station markers */}
      {volumes.map((v) => `<circle cx="${x(v.chainage).toFixed(1)}" cy="${y(v.cumulativeHaul).toFixed(1)}" r="3" fill="var(--accent-primary)" stroke="var(--bg-primary)" stroke-width="1"/>`).join("\n    ")}
      {balancePoints.join("\n    ")}
      {/* Legend */}
      <text x={pad.left} y={18} fontSize="10" fontWeight="bold" fill="var(--text-primary)" fontFamily="var(--font-mono)">Mass-Haul Diagram</text>
      <text x={width - pad.right} y={18} fontSize="8" textAnchor="end" fill="var(--text-tertiary)" fontFamily="var(--font-mono)">↑ Cut surplus / ↓ Fill deficit</text>
      <text x={pad.left - 5} y={zeroY - 5} fontSize="8" textAnchor="end" fill="var(--text-tertiary)" fontFamily="var(--font-mono)">0</text>
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────

export const RoadDesignView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();
  const [rows, setRows] = useState<ChainageRow[]>(DEFAULT_ROWS);
  const [carriagewayWidthM, setCarriagewayWidthM] = useState(7.0);
  const [shoulderWidthM, setShoulderWidthM] = useState(1.5);
  const [camberPercent, setCamberPercent] = useState(-2.5);

  const volumes = useMemo(() => computeVolumes(rows), [rows]);
  const totalCut = useMemo(() => volumes.reduce((s, v) => s + v.cutVol, 0), [volumes]);
  const totalFill = useMemo(() => volumes.reduce((s, v) => s + v.fillVol, 0), [volumes]);
  const netBalance = totalCut - totalFill;
  const maxHaul = useMemo(() => Math.max(...volumes.map((v) => Math.abs(v.cumulativeHaul))), [volumes]);

  const updateRow = useCallback((idx: number, field: keyof ChainageRow, value: string) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: parseFloat(value) || 0 } : r));
  }, []);

  const addRow = useCallback(() => {
    const last = rows[rows.length - 1];
    const newCh = last ? last.chainage + 20 : 0;
    setRows((prev) => [...prev, { chainage: newCh, groundElev: 102, designElev: 102, cutArea: 0, fillArea: 0 }]);
  }, [rows]);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveRow = useCallback((idx: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }, []);

  const pushToSurvey = useCallback(() => {
    setSurveyOutput({
      type: "engineering",
      chainages: volumes,
      totalCut,
      totalFill,
      netBalance,
      maxHaul,
    }, "engineering", "RoadDesignView", "KE");
  }, [volumes, totalCut, totalFill, netBalance, maxHaul, setSurveyOutput]);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Road Design & Mass-Haul
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Interactive chainage editor with longitudinal profile and mass-haul diagram. Edit ground/design elevations and cut/fill areas — charts update in real time.
      </p>

      {/* Template + Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <div>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Cross-Section Template</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Carriageway (m)</label>
              <input type="number" value={carriagewayWidthM} step="0.5" onChange={(e) => setCarriagewayWidthM(parseFloat(e.target.value) || 7)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Shoulder (m)</label>
              <input type="number" value={shoulderWidthM} step="0.25" onChange={(e) => setShoulderWidthM(parseFloat(e.target.value) || 1.5)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Camber (%)</label>
              <input type="number" value={camberPercent} step="0.5" onChange={(e) => setCamberPercent(parseFloat(e.target.value) || -2.5)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Total Width (m)</label>
              <div style={{ padding: "6px 10px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
                {(carriagewayWidthM + 2 * shoulderWidthM).toFixed(1)} m
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", alignContent: "start" }}>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Total Cut</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--status-error)" }}>{totalCut.toFixed(1)} m³</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Total Fill</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--status-success)" }}>{totalFill.toFixed(1)} m³</div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Net Balance</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: netBalance >= 0 ? "var(--accent-primary)" : "var(--status-error)" }}>
              {netBalance > 0 ? "+" : ""}{netBalance.toFixed(1)} m³
            </div>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)", gridColumn: "span 3" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Max Cumulative Haul</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{maxHaul.toFixed(1)} m³</div>
          </div>
        </div>
      </div>

      <AutoExportBanner />

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <LongitudinalProfileChart rows={rows} width={580} height={300} />
        <MassHaulChart volumes={volumes} width={580} height={300} />
      </div>

      {/* Editable Chainage Table */}
      <div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
          <h3 style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-mono)", margin: 0 }}>Chainage Schedule</h3>
          <button onClick={addRow} style={{ display: "flex", alignItems: "center", gap: "4px" }}><Plus size={14} /> Add Row</button>
          <button onClick={pushToSurvey} style={{ border: "1px solid var(--accent-primary)", color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
            <Download size={14} /> Save to Project
          </button>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{rows.length} stations</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "4px 6px", textAlign: "left" }}>CH (m)</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Ground Elev</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Design Elev</th>
                <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--status-error)" }}>Cut Area</th>
                <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--status-success)" }}>Fill Area</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Cut Vol</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Fill Vol</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Net Vol</th>
                <th style={{ padding: "4px 6px", textAlign: "right", color: "var(--accent-primary)" }}>Cum. Haul</th>
                <th style={{ padding: "4px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {volumes.map((v, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" value={v.chainage} step="20" onChange={(e) => updateRow(idx, "chainage", e.target.value)} style={{ width: "60px", fontSize: "var(--text-xs)" }} />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" value={v.groundElev} step="0.1" onChange={(e) => updateRow(idx, "groundElev", e.target.value)} style={{ width: "70px", fontSize: "var(--text-xs)" }} />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" value={v.designElev} step="0.1" onChange={(e) => updateRow(idx, "designElev", e.target.value)} style={{ width: "70px", fontSize: "var(--text-xs)" }} />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" value={v.cutArea} step="0.1" onChange={(e) => updateRow(idx, "cutArea", e.target.value)} style={{ width: "60px", fontSize: "var(--text-xs)" }} />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" value={v.fillArea} step="0.1" onChange={(e) => updateRow(idx, "fillArea", e.target.value)} style={{ width: "60px", fontSize: "var(--text-xs)" }} />
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{v.cutVol.toFixed(1)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{v.fillVol.toFixed(1)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: v.netVol >= 0 ? "var(--status-error)" : "var(--status-success)" }}>
                    {v.netVol >= 0 ? "+" : ""}{v.netVol.toFixed(1)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: "bold", color: v.cumulativeHaul >= 0 ? "var(--accent-primary)" : "var(--status-error)" }}>
                    {v.cumulativeHaul >= 0 ? "+" : ""}{v.cumulativeHaul.toFixed(1)}
                  </td>
                  <td style={{ padding: "3px 4px", display: "flex", gap: "2px" }}>
                    <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2 }}><ArrowUp size={12} /></button>
                    <button onClick={() => moveRow(idx, 1)} disabled={idx === rows.length - 1} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2 }}><ArrowDown size={12} /></button>
                    <button onClick={() => removeRow(idx)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--status-error)", padding: 2 }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
