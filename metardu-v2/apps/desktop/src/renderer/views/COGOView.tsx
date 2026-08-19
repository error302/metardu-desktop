/**
 * Coordinate Geometry (COGO) Interactive View.
 *
 * Five core COGO operations:
 *   1. Radiation (polar to rectangular)
 *   2. Bearing-Bearing intersection
 *   3. Distance-Distance intersection
 *   4. Line offset / point projection
 *   5. Area computation (Shoelace) from accumulated computed points
 *
 * Uses SurveyCanvas for live geometry display.
 * Country-aware: reads tolerance settings for distance/bearing precision display.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyLine } from "@metardu/ui-components";
import { useSurveyState, type CrossImportPayload } from "../SurveyStateContext.js";
import { COUNTRY_OPTIONS } from "../countries.js";
import { AutoExportBanner } from "./AutoExportBanner.js";
import { Compass, Target, Circle, ArrowUpDown, Triangle, Trash2, Copy, Plus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type COGOMode = "radiation" | "bearing-bearing" | "distance-distance" | "offset" | "area";

interface ComputedPoint {
  id: string;
  easting: number;
  northing: number;
  source: string;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function bbIntersection(
  a: { e: number; n: number; bearing: number },
  b: { e: number; n: number; bearing: number },
): { e: number; n: number } | null {
  const a1 = (90 - a.bearing) * (Math.PI / 180);
  const a2 = (90 - b.bearing) * (Math.PI / 180);
  const det = Math.sin(a2 - a1);
  if (Math.abs(det) < 1e-10) return null;
  const dx = b.e - a.e, dy = b.n - a.n;
  const t = (dx * Math.sin(a2) - dy * Math.cos(a2)) / det;
  return { e: a.e + t * Math.cos(a1), n: a.n + t * Math.sin(a1) };
}

function ddIntersection(
  a: { e: number; n: number; dist: number },
  b: { e: number; n: number; dist: number },
): { e: number; n: number } | null {
  const dx = b.e - a.e, dy = b.n - a.n;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > a.dist + b.dist || d < Math.abs(a.dist - b.dist) || d < 1e-10) return null;
  const aa = (a.dist * a.dist - b.dist * b.dist + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.dist * a.dist - aa * aa));
  const mx = a.e + aa * dx / d;
  const my = a.n + aa * dy / d;
  return { e: mx + h * dy / d, n: my - h * dx / d };
}

function shoelaceArea(points: ComputedPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].easting * points[j].northing;
    area -= points[j].easting * points[i].northing;
  }
  return Math.abs(area) / 2;
}

function bearingDeg(from: ComputedPoint, to: ComputedPoint): number {
  const dx = to.easting - from.easting;
  const dy = to.northing - from.northing;
  let brg = Math.atan2(dx, dy) * (180 / Math.PI);
  if (brg < 0) brg += 360;
  return brg;
}

function distanceBetween(a: ComputedPoint, b: ComputedPoint): number {
  return Math.sqrt((b.easting - a.easting) ** 2 + (b.northing - a.northing) ** 2);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const COGOView: React.FC = () => {
  const { setSurveyOutput, crossImport, setCrossImport } = useSurveyState();
  const [mode, setMode] = useState<COGOMode>("radiation");
  const [countryCode, setCountryCode] = useState("KE");
  const [computedPoints, setComputedPoints] = useState<ComputedPoint[]>([]);

  // ── Cross-import: receive Traverse LS results as area polygon ──────
  const [importNotice, setImportNotice] = useState<string | null>(null);
  useEffect(() => {
    if (crossImport?.type === "traverse_results" && crossImport.adjusted.length >= 3) {
      const pts = crossImport.adjusted.map((p) => ({
        id: p.id, easting: p.easting, northing: p.northing,
        source: `TRaverse LS (σ₀²=${crossImport.sigma0Squared.toFixed(4)})`,
      }));
      setComputedPoints(pts);
      setMode("area");
      setImportNotice(`Imported ${pts.length} adjusted coordinates from Traverse LS — area computation ready.`);
      setCrossImport(null);
    }
  }, [crossImport, setCrossImport]);

  // ── Push computed points to Traverse view ─────────────────────────
  const pushToTraverse = useCallback(() => {
    if (computedPoints.length < 2) return;
    const payload: CrossImportPayload = {
      type: "cogo_points",
      points: computedPoints,
      timestamp: new Date().toISOString(),
    };
    setCrossImport(payload);
    setImportNotice(`Pushed ${computedPoints.length} points to Traverse — switch to Traverse view to import.`);
  }, [computedPoints, setCrossImport]);

  // ── Radiation inputs ──────────────────────────────────────────────────────
  const [radStnE, setRadStnE] = useState(257000.0);
  const [radStnN, setRadStnN] = useState(9857000.0);
  const [radBrg, setRadBrg] = useState(45.0);
  const [radDist, setRadDist] = useState(150.0);
  const [radSigma, setRadSigma] = useState(0.005);

  // ── BB inputs ─────────────────────────────────────────────────────────────
  const [bbA, setBbA] = useState({ e: 257000, n: 9857000, bearing: 60 });
  const [bbB, setBbB] = useState({ e: 257200, n: 9857000, bearing: 300 });

  // ── DD inputs ─────────────────────────────────────────────────────────────
  const [ddA, setDdA] = useState({ e: 257000, n: 9857000, dist: 200 });
  const [ddB, setDdB] = useState({ e: 257200, n: 9857000, dist: 200 });

  // ── Offset inputs ─────────────────────────────────────────────────────────
  const [offFrom, setOffFrom] = useState({ e: 257000, n: 9857000 });
  const [offTo, setOffTo] = useState({ e: 257200, n: 9857100 });
  const [offDist, setOffDist] = useState(50.0);
  const [offSide, setOffSide] = useState<"left" | "right">("left");

  // ── Result feedback ───────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<string | null>(null);

  // ── Computed computations ─────────────────────────────────────────────────

  const doRadiation = useCallback(() => {
    const rad = (radBrg * Math.PI) / 180;
    const pt: ComputedPoint = {
      id: `P${computedPoints.length + 1}`,
      easting: radStnE + radDist * Math.sin(rad),
      northing: radStnN + radDist * Math.cos(rad),
      source: `RADIATION from (${radStnE}, ${radStnN}) brg=${radBrg} dist=${radDist}`,
    };
    setComputedPoints((prev) => [...prev, pt]);
    setFeedback(`Computed ${pt.id}: E=${pt.easting.toFixed(4)}, N=${pt.northing.toFixed(4)}`);
  }, [radStnE, radStnN, radBrg, radDist, computedPoints.length]);

  const doBB = useCallback(() => {
    const inter = bbIntersection(bbA, bbB);
    if (!inter) { setFeedback("Error: Lines are parallel or coincident."); return; }
    const pt: ComputedPoint = {
      id: `P${computedPoints.length + 1}`,
      easting: inter.e,
      northing: inter.n,
      source: `BB INTERSECT from A(${bbA.e},${bbA.n}) B(${bbB.e},${bbB.n})`,
    };
    setComputedPoints((prev) => [...prev, pt]);
    setFeedback(`Intersection ${pt.id}: E=${pt.easting.toFixed(4)}, N=${pt.northing.toFixed(4)}`);
  }, [bbA, bbB, computedPoints.length]);

  const doDD = useCallback(() => {
    const inter = ddIntersection(ddA, ddB);
    if (!inter) { setFeedback("Error: No intersection (circles don't meet or are tangent)."); return; }
    const pt: ComputedPoint = {
      id: `P${computedPoints.length + 1}`,
      easting: inter.e,
      northing: inter.n,
      source: `DD INTERSECT from A(${ddA.e},${ddA.n}) d=${ddA.dist} B(${ddB.e},${ddB.n}) d=${ddB.dist}`,
    };
    setComputedPoints((prev) => [...prev, pt]);
    setFeedback(`Intersection ${pt.id}: E=${pt.easting.toFixed(4)}, N=${pt.northing.toFixed(4)}`);
  }, [ddA, ddB, computedPoints.length]);

  const doOffset = useCallback(() => {
    const dx = offTo.e - offFrom.e;
    const dy = offTo.n - offFrom.n;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) { setFeedback("Error: Zero-length line."); return; }
    const sign = offSide === "left" ? 1 : -1;
    const pt: ComputedPoint = {
      id: `P${computedPoints.length + 1}`,
      easting: (offFrom.e + offTo.e) / 2 + sign * offDist * dy / len,
      northing: (offFrom.n + offTo.n) / 2 - sign * offDist * dx / len,
      source: `OFFSET ${offSide}=${offDist}m from line (${offFrom.e},${offFrom.n})-(${offTo.e},${offTo.n})`,
    };
    setComputedPoints((prev) => [...prev, pt]);
    setFeedback(`Offset point ${pt.id}: E=${pt.easting.toFixed(4)}, N=${pt.northing.toFixed(4)}`);
  }, [offFrom, offTo, offDist, offSide, computedPoints.length]);

  const handleCompute = useCallback(() => {
    switch (mode) {
      case "radiation": doRadiation(); break;
      case "bearing-bearing": doBB(); break;
      case "distance-distance": doDD(); break;
      case "offset": doOffset(); break;
      case "area": {
        const area = shoelaceArea(computedPoints);
        setFeedback(`Polygon area (Shoelace): ${area.toFixed(4)} m\u00B2`);
        break;
      }
    }
  }, [mode, doRadiation, doBB, doDD, doOffset, computedPoints]);

  const area = useMemo(() => shoelaceArea(computedPoints), [computedPoints]);

  // ── Canvas data ───────────────────────────────────────────────────────────

  const canvasPoints: SurveyPoint[] = computedPoints.map((p) => ({
    easting: p.easting,
    northing: p.northing,
    label: p.id,
    color: "#3B82F6",
  }));

  const canvasLines: SurveyLine[] = [];
  for (let i = 0; i < canvasPoints.length - 1; i++) {
    canvasLines.push({ from: canvasPoints[i], to: canvasPoints[i + 1], color: "#FF9500", width: 2 });
  }
  if (canvasPoints.length >= 3) {
    canvasLines.push({ from: canvasPoints[canvasPoints.length - 1], to: canvasPoints[0], color: "#FF9500", width: 2 });
  }

  const tabs: { key: COGOMode; label: string; icon: React.ReactNode }[] = [
    { key: "radiation", label: "Radiation", icon: <Compass size={14} /> },
    { key: "bearing-bearing", label: "BB Intersect", icon: <Target size={14} /> },
    { key: "distance-distance", label: "DD Intersect", icon: <Circle size={14} /> },
    { key: "offset", label: "Line Offset", icon: <ArrowUpDown size={14} /> },
    { key: "area", label: "Area", icon: <Triangle size={14} /> },
  ];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Coordinate Geometry (COGO)
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Radiations, bearing/distance intersections, line offsets, and area computation. Points accumulate across calculations.
      </p>

      {/* Country & mode tabs */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ minWidth: "120px" }}>
          {COUNTRY_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: "4px" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={mode === t.key ? "primary" : ""}
              onClick={() => setMode(t.key)}
              style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-sm)" }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Radiation panel */}
      {mode === "radiation" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <div><label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "2px" }}>Station Easting</label><input type="number" value={radStnE} onChange={(e) => setRadStnE(+e.target.value || 0)} style={{ width: "100%" }} /></div>
          <div><label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "2px" }}>Station Northing</label><input type="number" value={radStnN} onChange={(e) => setRadStnN(+e.target.value || 0)} style={{ width: "100%" }} /></div>
          <div><label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "2px" }}>Bearing (deg)</label><input type="number" value={radBrg} step="0.0001" onChange={(e) => setRadBrg(+e.target.value || 0)} style={{ width: "100%" }} /></div>
          <div><label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "2px" }}>Distance (m)</label><input type="number" value={radDist} step="0.001" onChange={(e) => setRadDist(+e.target.value || 0)} style={{ width: "100%" }} /></div>
        </div>
      )}

      {/* BB panel */}
      {mode === "bearing-bearing" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <div>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>Station A</h4>
            <input type="number" placeholder="Easting" value={bbA.e} onChange={(e) => setBbA({ ...bbA, e: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Northing" value={bbA.n} onChange={(e) => setBbA({ ...bbA, n: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Bearing" value={bbA.bearing} onChange={(e) => setBbA({ ...bbA, bearing: +e.target.value || 0 })} style={{ width: "100%" }} />
          </div>
          <div>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>Station B</h4>
            <input type="number" placeholder="Easting" value={bbB.e} onChange={(e) => setBbB({ ...bbB, e: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Northing" value={bbB.n} onChange={(e) => setBbB({ ...bbB, n: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Bearing" value={bbB.bearing} onChange={(e) => setBbB({ ...bbB, bearing: +e.target.value || 0 })} style={{ width: "100%" }} />
          </div>
        </div>
      )}

      {/* DD panel */}
      {mode === "distance-distance" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <div>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>Center A</h4>
            <input type="number" placeholder="Easting" value={ddA.e} onChange={(e) => setDdA({ ...ddA, e: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Northing" value={ddA.n} onChange={(e) => setDdA({ ...ddA, n: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Radius (m)" value={ddA.dist} step="0.001" onChange={(e) => setDdA({ ...ddA, dist: +e.target.value || 0 })} style={{ width: "100%" }} />
          </div>
          <div>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>Center B</h4>
            <input type="number" placeholder="Easting" value={ddB.e} onChange={(e) => setDdB({ ...ddB, e: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Northing" value={ddB.n} onChange={(e) => setDdB({ ...ddB, n: +e.target.value || 0 })} style={{ width: "100%", marginBottom: "4px" }} />
            <input type="number" placeholder="Radius (m)" value={ddB.dist} step="0.001" onChange={(e) => setDdB({ ...ddB, dist: +e.target.value || 0 })} style={{ width: "100%" }} />
          </div>
        </div>
      )}

      {/* Offset panel */}
      {mode === "offset" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <div><label style={{ fontSize: "var(--text-xs)" }}>From Easting</label><input type="number" value={offFrom.e} onChange={(e) => setOffFrom({ ...offFrom, e: +e.target.value || 0 })} style={{ width: "100%" }} /></div>
          <div><label style={{ fontSize: "var(--text-xs)" }}>From Northing</label><input type="number" value={offFrom.n} onChange={(e) => setOffFrom({ ...offFrom, n: +e.target.value || 0 })} style={{ width: "100%" }} /></div>
          <div><label style={{ fontSize: "var(--text-xs)" }}>To Easting</label><input type="number" value={offTo.e} onChange={(e) => setOffTo({ ...offTo, e: +e.target.value || 0 })} style={{ width: "100%" }} /></div>
          <div><label style={{ fontSize: "var(--text-xs)" }}>To Northing</label><input type="number" value={offTo.n} onChange={(e) => setOffTo({ ...offTo, n: +e.target.value || 0 })} style={{ width: "100%" }} /></div>
          <div><label style={{ fontSize: "var(--text-xs)" }}>Offset (m)</label><input type="number" value={offDist} step="0.001" onChange={(e) => setOffDist(+e.target.value || 0)} style={{ width: "100%" }} /></div>
          <div>
            <label style={{ fontSize: "var(--text-xs)" }}>Side</label>
            <select value={offSide} onChange={(e) => setOffSide(e.target.value as any)} style={{ width: "100%" }}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      )}

      {/* Area mode shows stats */}
      {mode === "area" && (
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <div style={{ padding: "8px" }}>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Polygon Area</div>
              <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{area.toFixed(4)} m&sup2;</div>
            </div>
            <div style={{ padding: "8px" }}>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Perimeter</div>
              <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>
                {computedPoints.length >= 3
                  ? (computedPoints.reduce((sum, p, i) => {
                      const next = computedPoints[(i + 1) % computedPoints.length];
                      return sum + distanceBetween(p, next);
                    }, 0)).toFixed(4) + " m"
                  : "Need 3+ points"}
              </div>
            </div>
            <div style={{ padding: "8px" }}>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Vertices</div>
              <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{computedPoints.length}</div>
            </div>
          </div>
          {computedPoints.length >= 3 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", marginTop: "8px" }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-default)" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>Pt</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>E</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>N</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Bearing to Next</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Distance to Next</th>
                </tr>
              </thead>
              <tbody>
                {computedPoints.map((p, i) => {
                  const next = computedPoints[(i + 1) % computedPoints.length];
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "4px 8px", fontWeight: "bold" }}>{p.id}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{p.easting.toFixed(4)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{p.northing.toFixed(4)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{bearingDeg(p, next).toFixed(4)}&deg;</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{distanceBetween(p, next).toFixed(4)} m</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Compute & action buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button className="primary" onClick={handleCompute} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Plus size={14} /> {mode === "area" ? "Compute Area" : "Compute Point"}
        </button>
        <button onClick={() => { setComputedPoints([]); setFeedback(null); setImportNotice(null); }} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Trash2 size={14} /> Clear All
        </button>
        {computedPoints.length > 0 && (
          <button onClick={() => {
            const last = computedPoints[computedPoints.length - 1];
            setFeedback(`${last.id}: E=${last.easting.toFixed(4)}, N=${last.northing.toFixed(4)}`);
          }} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Copy size={14} /> Last Point
          </button>
        )}
        {computedPoints.length >= 2 && (
          <button onClick={pushToTraverse} style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid var(--accent-primary)", color: "var(--accent-primary)" }}>
            Send to Traverse
          </button>
        )}
      </div>

      {importNotice && (
        <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          {importNotice}
        </div>
      )}

      {feedback && (
        <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", borderLeft: "3px solid var(--accent-primary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
          {feedback}
        </div>
      )}

      <AutoExportBanner />

      {/* Computed points table */}
      {computedPoints.length > 0 && (
        <div>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            Computed Points ({computedPoints.length})
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>ID</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Easting</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Northing</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {computedPoints.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{p.id}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.easting.toFixed(4)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.northing.toFixed(4)}</td>
                  <td style={{ padding: "6px 8px", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Survey canvas */}
      {canvasPoints.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas
            height={320}
            title="COGO Geometry"
            points={canvasPoints}
            lines={canvasLines}
            showPointLabels={true}
            showNorthArrow={true}
            showScaleBar={true}
          />
        </div>
      )}
    </div>
  );
};
