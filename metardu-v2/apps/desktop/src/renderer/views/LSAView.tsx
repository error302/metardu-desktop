/**
 * GNSS Network Adjustment Panel
 *
 * Lets surveyors:
 *   1. Define a control network with fixed and free points
 *   2. Add GNSS baseline observations (dE, dN, dH with correlated covariance)
 *   3. Run least-squares adjustment via the sidecar engine
 *   4. Visualise error ellipses, residuals, and Baarda w-statistics
 *
 * Error ellipse computation:
 *   From the 2x2 covariance sub-matrix Q_xx for each free point's
 *   (E, N) parameters, eigenvalue decomposition gives:
 *     a = chi2 * sqrt(lam1),  b = chi2 * sqrt(lam2)
 *     theta = atan2(v1_y, v1_x)
 *   where chi2 = sqrt(-2 * ln(1 - confidence)).
 *
 * The panel supports up to 20 points and 40 baselines.
 */

import React, { useState, useCallback, useMemo } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyLine, type SurveyEllipse } from "@metardu/ui-components";
import { COUNTRY_OPTIONS } from "../countries.js";
import { AutoExportBanner } from "./AutoExportBanner.js";
import {
  Network,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Download,
  AlertTriangle,
  CheckCircle,
  Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetPoint {
  id: string;
  easting: number;
  northing: number;
  height: number;
  fixed: boolean;
}

interface NetBaseline {
  id: string;
  from: string;
  to: string;
  dE: number;
  dN: number;
  dH: number;
  sigmaE: number;
  sigmaN: number;
  sigmaH: number;
  correlationEN: number;
}

interface LsResult {
  adjusted: Array<{
    id: string;
    easting: number;
    northing: number;
    height: number | null;
  }>;
  covariance: number[];
  residuals: number[];
  redundancy: number[];
  baarda_w: number[];
  sigma_0_sq: number;
  degrees_of_freedom: number;
  chi_square_p_value: number;
  passes_global_test: boolean;
  has_flagged_blunder: boolean;
  adjusted_orientations: number[];
}

interface EllipseData {
  centerE: number;
  centerN: number;
  semiMajor: number;
  semiMinor: number;
  azimuthDeg: number;
  pointId: string;
}

// ─── Sidecar call ─────────────────────────────────────────────────────────────

async function callSidecar(method: string, params: Record<string, unknown>): Promise<unknown> {
  return (window as any).metardu?.sidecar?.call?.(method, params) ?? null;
}

// ─── Error ellipse computation ────────────────────────────────────────────────

function computeEllipses(
  adjusted: LsResult["adjusted"],
  covarianceFlat: number[],
  pointIds: string[],
  freePointIndices: number[],
  parameters: Array<{ id: string; dimension: number }>,
  confidence: number = 0.95,
): EllipseData[] {
  const ellipses: EllipseData[] = [];

  // chi2 for 2 DOF at given confidence level
  // P(r < chi2) = 1 - exp(-chi2/2) for Rayleigh distribution
  const chi2Factor = Math.sqrt(-2 * Math.log(1 - confidence));

  for (let fi = 0; fi < freePointIndices.length; fi++) {
    const paramIdx = freePointIndices[fi];
    const ptId = pointIds[paramIdx];
    if (!ptId) continue;

    const param = parameters[paramIdx];
    if (!param || param.dimension < 2) continue;

    // Find the adjusted values for this point
    const adjPt = adjusted.find((a) => a.id === ptId);
    if (!adjPt) continue;

    // Find the global unknown index for this point's E,N parameters.
    // Unknown indices are contiguous for non-fixed parameters.
    let unknownStart = 0;
    for (let i = 0; i < paramIdx; i++) {
      if (!parameters[i]?.fixed) {
        unknownStart += parameters[i].dimension;
      }
    }
    if (parameters[paramIdx].fixed) continue;

    const dim = param.dimension;
    const nUnknowns = parameters.filter((p) => !p.fixed).reduce((s, p) => s + p.dimension, 0);

    // Extract the 2x2 covariance block for (E, N)
    const idxE = unknownStart;
    const idxN = unknownStart + 1;
    if (idxE >= nUnknowns || idxN >= nUnknowns) continue;

    const covEE = covarianceFlat[idxE * nUnknowns + idxE] ?? 0;
    const covEN = covarianceFlat[idxE * nUnknowns + idxN] ?? 0;
    const covNE = covarianceFlat[idxN * nUnknowns + idxE] ?? 0;
    const covNN = covarianceFlat[idxN * nUnknowns + idxN] ?? 0;

    // Eigenvalue decomposition of 2x2 symmetric matrix
    const trace = covEE + covNN;
    const det = covEE * covNN - covEN * covNE;
    const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));

    const lam1 = trace / 2 + discriminant;
    const lam2 = trace / 2 - discriminant;

    const semiMajor = chi2Factor * Math.sqrt(Math.max(0, lam1));
    const semiMinor = chi2Factor * Math.sqrt(Math.max(0, lam2));

    // Orientation: angle of first eigenvector from north
    let azimuthDeg = 0;
    if (lam1 > 1e-15) {
      // Eigenvector for lam1: (covEN, lam1 - covEE) or (lam1 - covNN, covNE)
      const vx = lam1 - covNN;
      const vy = covNE;
      azimuthDeg = (Math.atan2(vx, vy) * 180) / Math.PI;
      if (azimuthDeg < 0) azimuthDeg += 360;
    }

    ellipses.push({
      centerE: adjPt.easting,
      centerN: adjPt.northing,
      semiMajor,
      semiMinor,
      azimuthDeg,
      pointId: ptId,
    });
  }

  return ellipses;
}

// ─── Sample network ──────────────────────────────────────────────────────────

const SAMPLE_POINTS: NetPoint[] = [
  { id: "CTR1", easting: 257000, northing: 9857000, height: 1650.0, fixed: true },
  { id: "CTR2", easting: 257500, northing: 9857000, height: 1655.0, fixed: true },
  { id: "CTR3", easting: 257500, northing: 9857500, height: 1660.0, fixed: true },
  { id: "PT1", easting: 257150, northing: 9857200, height: 1652.0, fixed: false },
  { id: "PT2", easting: 257350, northing: 9857350, height: 1658.0, fixed: false },
];

const SAMPLE_BASELINES: NetBaseline[] = [
  { id: "B1", from: "CTR1", to: "PT1", dE: 150.012, dN: 200.045, dH: 2.010, sigmaE: 0.012, sigmaN: 0.012, sigmaH: 0.025, correlationEN: 0.6 },
  { id: "B2", from: "CTR2", to: "PT1", dE: -349.980, dN: 200.030, dH: -3.020, sigmaE: 0.015, sigmaN: 0.015, sigmaH: 0.030, correlationEN: 0.5 },
  { id: "B3", from: "CTR1", to: "PT2", dE: 350.010, dN: 349.980, dH: 7.990, sigmaE: 0.014, sigmaN: 0.014, sigmaH: 0.028, correlationEN: 0.55 },
  { id: "B4", from: "CTR2", to: "PT2", dE: -149.990, dN: 350.020, dH: 2.980, sigmaE: 0.013, sigmaN: 0.013, sigmaH: 0.026, correlationEN: 0.5 },
  { id: "B5", from: "CTR3", to: "PT2", dE: -150.005, dN: -150.010, dH: -2.015, sigmaE: 0.014, sigmaN: 0.014, sigmaH: 0.028, correlationEN: 0.55 },
  { id: "B6", from: "PT1", to: "PT2", dE: 200.005, dN: 149.960, dH: 5.990, sigmaE: 0.018, sigmaN: 0.018, sigmaH: 0.035, correlationEN: 0.45 },
  { id: "B7", from: "CTR3", to: "PT1", dE: -349.995, dN: -300.020, dH: -8.010, sigmaE: 0.016, sigmaN: 0.016, sigmaH: 0.032, correlationEN: 0.5 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const LSAView: React.FC = () => {
  const [countryCode, setCountryCode] = useState("KE");
  const [points, setPoints] = useState<NetPoint[]>(SAMPLE_POINTS);
  const [baselines, setBaselines] = useState<NetBaseline[]>(SAMPLE_BASELINES);
  const [result, setResult] = useState<LsResult | null>(null);
  const [ellipses, setEllipses] = useState<EllipseData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [confidence, setConfidence] = useState(0.95);
  const [flagThreshold, setFlagThreshold] = useState(3.5);
  const [excludedBaselines, setExcludedBaselines] = useState<Set<string>>(new Set());
  const [removalHistory, setRemovalHistory] = useState<Array<{ baselineId: string; reason: string; timestamp: string }>>([]);

  // New point form
  const [newPt, setNewPt] = useState<NetPoint>({
    id: "", easting: 0, northing: 0, height: 0, fixed: false,
  });

  // New baseline form
  const [newBl, setNewBl] = useState<NetBaseline>({
    id: "", from: "", to: "", dE: 0, dN: 0, dH: 0, sigmaE: 0.015, sigmaN: 0.015, sigmaH: 0.030, correlationEN: 0.5,
  });

  // ── Add / Remove helpers ──────────────────────────────────────────────────

  const addPoint = useCallback(() => {
    if (!newPt.id || points.some((p) => p.id === newPt.id)) return;
    setPoints((prev) => [...prev, { ...newPt }]);
    setNewPt({ id: "", easting: 0, northing: 0, height: 0, fixed: false });
  }, [newPt, points]);

  const removePoint = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    setBaselines((prev) => prev.filter((b) => b.from !== id && b.to !== id));
  }, []);

  const addBaseline = useCallback(() => {
    if (!newBl.id || !newBl.from || !newBl.to) return;
    if (baselines.some((b) => b.id === newBl.id)) return;
    if (newBl.from === newBl.to) return;
    setBaselines((prev) => [...prev, { ...newBl }]);
    setNewBl({
      id: "", from: "", to: "", dE: 0, dN: 0, dH: 0, sigmaE: 0.015, sigmaN: 0.015, sigmaH: 0.030, correlationEN: 0.5,
    });
  }, [newBl, baselines]);

  const removeBaseline = useCallback((id: string) => {
    setBaselines((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // ── Baarda blunder removal workflow ──────────────────────────────

  /** Identify baselines with any flagged component (|w| > threshold) */
  const flaggedBaselineIds = useMemo(() => {
    if (!result) return new Set<string>();
    const flagged = new Set<string>();
    baselines.forEach((b, bi) => {
      for (let ci = 0; ci < 3; ci++) {
        const w = result.baarda_w[bi * 3 + ci] ?? 0;
        if (Math.abs(w) > flagThreshold) {
          flagged.add(b.id);
          break;
        }
      }
    });
    return flagged;
  }, [result, baselines, flagThreshold]);

  /** Remove all flagged baselines from the network and re-run */
  const removeFlaggedAndRerun = useCallback(() => {
    if (flaggedBaselineIds.size === 0) return;
    const newExcluded = new Set(excludedBaselines);
    const newHistory = [...removalHistory];
    const now = new Date().toISOString();

    for (const id of flaggedBaselineIds) {
      newExcluded.add(id);
      const bl = baselines.find((b) => b.id === id);
      if (bl) {
        newHistory.push({
          baselineId: id,
          reason: `Blunder: ${bl.from}→${bl.to} (|w| > ${flagThreshold})`,
          timestamp: now,
        });
      }
    }

    setExcludedBaselines(newExcluded);
    setRemovalHistory(newHistory);
    // Re-run will be triggered by the user clicking Run again
  }, [flaggedBaselineIds, excludedBaselines, removalHistory, baselines, flagThreshold]);

  /** Restore all excluded baselines */
  const restoreAllExcluded = useCallback(() => {
    setExcludedBaselines(new Set());
    setRemovalHistory([]);
  }, []);

  /** Restore a single excluded baseline */
  const restoreBaseline = useCallback((id: string) => {
    setExcludedBaselines((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setRemovalHistory((prev) => prev.filter((h) => h.baselineId !== id));
  }, []);

  // ── Auto-estimate covariance from satellite geometry ─────────────────
  const [autoEstimating, setAutoEstimating] = useState(false);
  const [autoEstimateError, setAutoEstimateError] = useState<string | null>(null);
  // Satellite geometry for auto-estimation (JSON text input per receiver)
  const [satGeometryText, setSatGeometryText] = useState(
    JSON.stringify(
      {
        from: {
          receiver_id: "FROM",
          satellites: [
            { satellite_id: "G01", elevation_deg: 75, azimuth_deg: 0, snr_dbhz: 42 },
            { satellite_id: "G03", elevation_deg: 45, azimuth_deg: 45, snr_dbhz: 38 },
            { satellite_id: "G06", elevation_deg: 30, azimuth_deg: 90, snr_dbhz: 35 },
            { satellite_id: "G09", elevation_deg: 20, azimuth_deg: 135, snr_dbhz: 30 },
            { satellite_id: "G12", elevation_deg: 35, azimuth_deg: 180, snr_dbhz: 36 },
            { satellite_id: "G15", elevation_deg: 25, azimuth_deg: 225, snr_dbhz: 32 },
          ],
        },
        to: {
          receiver_id: "TO",
          satellites: [
            { satellite_id: "G01", elevation_deg: 72, azimuth_deg: 5, snr_dbhz: 41 },
            { satellite_id: "G03", elevation_deg: 42, azimuth_deg: 50, snr_dbhz: 37 },
            { satellite_id: "G06", elevation_deg: 28, azimuth_deg: 95, snr_dbhz: 34 },
            { satellite_id: "G09", elevation_deg: 18, azimuth_deg: 140, snr_dbhz: 29 },
            { satellite_id: "G12", elevation_deg: 33, azimuth_deg: 185, snr_dbhz: 35 },
            { satellite_id: "G15", elevation_deg: 22, azimuth_deg: 230, snr_dbhz: 31 },
          ],
        },
        is_rtk: true,
      },
      null,
      2,
    ),
  );

  const autoEstimateCovariance = useCallback(async () => {
    setAutoEstimating(true);
    setAutoEstimateError(null);
    try {
      let geoData: { from: { receiver_id: string; satellites: Array<{ satellite_id: string; elevation_deg: number; azimuth_deg: number; snr_dbhz?: number }> }; to: { receiver_id: string; satellites: Array<{ satellite_id: string; elevation_deg: number; azimuth_deg: number; snr_dbhz?: number }> }; is_rtk?: boolean };
      try {
        geoData = JSON.parse(satGeometryText);
      } catch {
        throw new Error("Invalid satellite geometry JSON");
      }

      const result = await callSidecar("gnss.estimate_baseline_covariance", {
        from_receiver: geoData.from,
        to_receiver: geoData.to,
        is_rtk: geoData.is_rtk ?? true,
      }) as {
        covariance: number[];
        sigma_e: number; sigma_n: number; sigma_h: number;
        correlation_en: number;
        pdop_avg: number; quality: string; warnings: string[];
      };

      if (!result || !result.covariance) {
        throw new Error("Estimation returned no result");
      }

      // Auto-fill the new baseline form with estimated values
      setNewBl((prev) => ({
        ...prev,
        sigmaE: result.sigma_e,
        sigmaN: result.sigma_n,
        sigmaH: result.sigma_h,
        correlationEN: result.correlation_en,
      }));

      setAutoEstimateError(
        result.warnings.length > 0
          ? `PDOP: ${result.pdop_avg.toFixed(1)} (${result.quality}) — ${result.warnings.join("; ")}`
          : `PDOP: ${result.pdop_avg.toFixed(1)} (${result.quality}) — sigma: E=${(result.sigma_e * 1000).toFixed(1)}mm N=${(result.sigma_n * 1000).toFixed(1)}mm H=${(result.sigma_h * 1000).toFixed(1)}mm, r_EN=${result.correlation_en.toFixed(3)}`,
      );
    } catch (e) {
      setAutoEstimateError((e as Error).message);
    } finally {
      setAutoEstimating(false);
    }
  }, [satGeometryText]);

  const loadSample = useCallback(() => {
    setPoints(SAMPLE_POINTS);
    setBaselines(SAMPLE_BASELINES);
    setResult(null);
    setEllipses([]);
    setError(null);
  }, []);

  // ── Run adjustment ────────────────────────────────────────────────────────

  const runAdjustment = useCallback(async () => {
    setError(null);
    setResult(null);
    setEllipses([]);
    setComputing(true);

    try {
      // Filter out excluded baselines
      const activeBaselines = baselines.filter((b) => !excludedBaselines.has(b.id));

      if (points.length < 2) throw new Error("Need at least 2 points");
      if (activeBaselines.length < 1) throw new Error("Need at least 1 baseline (after exclusions)");
      if (!points.some((p) => p.fixed)) throw new Error("Need at least 1 fixed point");

      // Build sidecar parameters
      const freePoints = points.filter((p) => !p.fixed);
      const pointIndexMap = new Map(points.map((p, i) => [p.id, i]));

      const parameters = points.map((p) => ({
        id: p.id,
        dimension: 3,
        fixed: p.fixed,
      }));

      const approximations: Record<string, number[]> = {};
      for (const p of points) {
        approximations[p.id] = [p.easting, p.northing, p.height];
      }

      const observations = activeBaselines.map((b) => ({
        kind: "GnssBaseline",
        from: b.from,
        to: b.to,
        value: [b.dE, b.dN, b.dH],
        covariance: [
          b.sigmaE * b.sigmaE,
          b.correlationEN * b.sigmaE * b.sigmaN,
          0,
          b.correlationEN * b.sigmaE * b.sigmaN,
          b.sigmaN * b.sigmaN,
          0,
          0,
          0,
          b.sigmaH * b.sigmaH,
        ],
      }));

      const config = {
        max_iterations: 50,
        convergence_threshold: 1e-6,
        blunder_detection: true,
        blunder_threshold: flagThreshold,
        confidence_level: confidence,
      };

      const response = await callSidecar("adjustment.run", {
        parameters,
        approximations,
        observations,
        orientation_parameters: [],
        config,
      });

      if (!response || !(response as any).success) {
        throw new Error((response as any)?.error ?? "Adjustment failed");
      }

      const lsResult = (response as any).result as LsResult;
      setResult(lsResult);

      // Compute error ellipses
      const freePointIndices: number[] = [];
      for (let i = 0; i < parameters.length; i++) {
        if (!parameters[i].fixed) freePointIndices.push(i);
      }

      const ellipseData = computeEllipses(
        lsResult.adjusted,
        lsResult.covariance,
        points.map((p) => p.id),
        freePointIndices,
        parameters,
        confidence,
      );
      setEllipses(ellipseData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComputing(false);
    }
  }, [points, baselines, confidence, flagThreshold]);

  // ── Canvas data ───────────────────────────────────────────────────────────

  const canvasPoints: SurveyPoint[] = useMemo(() => {
    if (result) {
      return result.adjusted.map((a) => ({
        easting: a.easting,
        northing: a.northing,
        label: a.id,
      }));
    }
    return points.map((p) => ({
      easting: p.easting,
      northing: p.northing,
      label: p.id,
    }));
  }, [result, points]);

  const canvasLines: SurveyLine[] = useMemo(() =>
    baselines.map((b) => {
      const fromPt = (result ? result.adjusted : points).find((p) => p.id === b.from);
      const toPt = (result ? result.adjusted : points).find((p) => p.id === b.to);
      if (!fromPt || !toPt) return null;
      const excluded = excludedBaselines.has(b.id);
      return {
        from: { easting: fromPt.easting, northing: fromPt.northing },
        to: { easting: toPt.easting, northing: toPt.northing },
        color: excluded ? "#ef4444" : "#38bdf8",
        width: excluded ? 1 : 1.5,
        dashed: excluded,
      };
    }).filter(Boolean) as SurveyLine[],
  [baselines, result, points, excludedBaselines]);

  const canvasEllipses: SurveyEllipse[] = useMemo(() =>
    ellipses.map((el) => ({
      center: { easting: el.centerE, northing: el.centerN },
      semiMajor: el.semiMajor,
      semiMinor: el.semiMinor,
      azimuthDeg: el.azimuthDeg,
      color: "#a855f7",
      label: `${el.pointId} (${(el.semiMajor * 1000).toFixed(1)}×${(el.semiMinor * 1000).toFixed(1)}mm)`,
    })),
  [ellipses]);

  const ptIds = points.map((p) => p.id);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const networkStats = useMemo(() => {
    const nFixed = points.filter((p) => p.fixed).length;
    const nFree = points.filter((p) => !p.fixed).length;
    const nObs = baselines.length * 3; // 3 components per baseline
    const nUnknowns = nFree * 3;
    const dof = nObs - nUnknowns;
    const redundancyRatio = dof > 0 ? (dof / nObs * 100).toFixed(1) : "0";
    return { nFixed, nFree, nObs, nUnknowns, dof, redundancyRatio };
  }, [points, baselines]);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        GNSS Network Adjustment
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Define a control network with GNSS baseline vectors, run least-squares adjustment, and visualise 95% error ellipses.
      </p>

      {/* Controls */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ minWidth: "120px" }}>
          {COUNTRY_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
        <label style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          Confidence:
          <select value={confidence} onChange={(e) => setConfidence(+e.target.value)} style={{ marginLeft: "4px" }}>
            <option value={0.90}>90%</option>
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </select>
        </label>
        <label style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          Flag threshold (w):
          <input type="number" value={flagThreshold} step="0.1" min="2.0" max="5.0"
            onChange={(e) => setFlagThreshold(+e.target.value || 3.5)}
            style={{ width: "60px", marginLeft: "4px" }} />
        </label>
        <button className="primary" onClick={runAdjustment} disabled={computing}
          style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Play size={14} /> {computing ? "Running..." : "Run LS Adjustment"}
        </button>
        <button onClick={loadSample} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <RotateCcw size={14} /> Load Sample
        </button>
        {flaggedBaselineIds.size > 0 && (
          <button onClick={removeFlaggedAndRerun}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", border: "1px solid #ef4444", color: "#ef4444", background: "rgba(239,68,68,0.1)", fontWeight: 600 }}>
            <Trash2 size={14} /> Remove {flaggedBaselineIds.size} Flagged Blunder{flaggedBaselineIds.size > 1 ? "s" : ""}
          </button>
        )}
        {excludedBaselines.size > 0 && (
          <button onClick={restoreAllExcluded}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", border: "1px solid #f59e0b", color: "#f59e0b" }}>
            <RotateCcw size={14} /> Restore {excludedBaselines.size} Excluded
          </button>
        )}
      </div>

      {/* Network overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "8px" }}>
        {[
          { label: "Fixed Points", value: String(networkStats.nFixed), color: "#22c55e" },
          { label: "Free Points", value: String(networkStats.nFree), color: "#3b82f6" },
          { label: "Baselines", value: String(baselines.length), color: "#38bdf8" },
          { label: "Observations", value: String(networkStats.nObs), color: "#a3a3a3" },
          { label: "Unknowns", value: String(networkStats.nUnknowns), color: "#f59e0b" },
          { label: "DOF", value: String(networkStats.dof), color: networkStats.dof > 0 ? "#22c55e" : "#ef4444" },
        ].map((s) => (
          <div key={s.label} style={{ padding: "6px 8px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{s.label}</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          <AlertTriangle size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
          {error}
        </div>
      )}

      <AutoExportBanner />

      {/* Points table */}
      <div>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "6px" }}>
          <Network size={16} /> Control Points ({points.length})
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>ID</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Easting</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Northing</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Height</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>Status</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{p.id}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.easting.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.northing.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.height.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: "4px", fontSize: "var(--text-xs)",
                    background: p.fixed ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
                    color: p.fixed ? "#22c55e" : "#3b82f6",
                  }}>
                    {p.fixed ? "FIXED" : "FREE"}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  <button onClick={() => removePoint(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Add point form */}
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="ID" value={newPt.id} onChange={(e) => setNewPt({ ...newPt, id: e.target.value })} style={{ width: "70px" }} />
          <input type="number" placeholder="Easting" value={newPt.easting || ""} onChange={(e) => setNewPt({ ...newPt, easting: +e.target.value || 0 })} style={{ width: "100px" }} />
          <input type="number" placeholder="Northing" value={newPt.northing || ""} onChange={(e) => setNewPt({ ...newPt, northing: +e.target.value || 0 })} style={{ width: "100px" }} />
          <input type="number" placeholder="Height" value={newPt.height || ""} onChange={(e) => setNewPt({ ...newPt, height: +e.target.value || 0 })} style={{ width: "80px" }} />
          <label style={{ fontSize: "var(--text-xs)", display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={newPt.fixed} onChange={(e) => setNewPt({ ...newPt, fixed: e.target.checked })} />
            Fixed
          </label>
          <button onClick={addPoint} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Baselines table */}
      <div>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "6px" }}>
          <Network size={16} /> GNSS Baselines ({baselines.length})
        </h3>
        <div style={{ maxHeight: "240px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>ID</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>From</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>To</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>dE (m)</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>dN (m)</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>dH (m)</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>sE</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>sN</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>sH</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>r_EN</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {baselines.map((b) => {
                const isExcluded = excludedBaselines.has(b.id);
                return (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--border-subtle)", opacity: isExcluded ? 0.4 : 1, background: isExcluded ? "rgba(239,68,68,0.05)" : undefined }}>
                  <td style={{ padding: "4px 8px" }}>{b.id}</td>
                  <td style={{ padding: "4px 8px" }}>{b.from}</td>
                  <td style={{ padding: "4px 8px" }}>{b.to}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.dE.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.dN.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.dH.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.sigmaE.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.sigmaN.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.sigmaH.toFixed(4)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{b.correlationEN.toFixed(2)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "center" }}>
                    {isExcluded ? (
                      <button onClick={() => restoreBaseline(b.id)} title="Restore this baseline"
                        style={{ background: "none", border: "1px solid #f59e0b", cursor: "pointer", color: "#f59e0b", padding: "1px 6px", fontSize: "var(--text-xs)", borderRadius: "3px" }}>
                        Restore
                      </button>
                    ) : (
                      <button onClick={() => removeBaseline(b.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        {/* Auto-estimate covariance from satellite geometry */}
        <div style={{ marginTop: "12px", padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <h4 style={{ margin: 0, fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>
              Auto-Estimate Covariance from Satellite Geometry
            </h4>
            <button onClick={autoEstimateCovariance} disabled={autoEstimating}
              style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px" }}>
              {autoEstimating ? "Estimating..." : "Estimate"}
            </button>
          </div>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", margin: "0 0 8px 0" }}>
            Paste satellite geometry JSON for both receivers. The sidecar computes PDOP-weighted
            correlated covariance (sigma_E, sigma_N, sigma_H, r_EN) and auto-fills the baseline form.
          </p>
          <textarea value={satGeometryText} onChange={(e) => setSatGeometryText(e.target.value)}
            style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "11px" }} />
          {autoEstimateError && (
            <div style={{ marginTop: "6px", padding: "6px 10px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)",
              background: autoEstimateError.includes("PDOP") ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              border: `1px solid ${autoEstimateError.includes("PDOP") ? "#22c55e" : "#ef4444"}`,
              color: autoEstimateError.includes("PDOP") ? "#22c55e" : "#ef4444" }}>
              {autoEstimateError}
            </div>
          )}
        </div>

        {/* Add baseline form */}
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="ID" value={newBl.id} onChange={(e) => setNewBl({ ...newBl, id: e.target.value })} style={{ width: "50px" }} />
          <select value={newBl.from} onChange={(e) => setNewBl({ ...newBl, from: e.target.value })} style={{ width: "80px" }}>
            <option value="">From</option>
            {ptIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <select value={newBl.to} onChange={(e) => setNewBl({ ...newBl, to: e.target.value })} style={{ width: "80px" }}>
            <option value="">To</option>
            {ptIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <input type="number" placeholder="dE" value={newBl.dE || ""} onChange={(e) => setNewBl({ ...newBl, dE: +e.target.value || 0 })} style={{ width: "80px" }} />
          <input type="number" placeholder="dN" value={newBl.dN || ""} onChange={(e) => setNewBl({ ...newBl, dN: +e.target.value || 0 })} style={{ width: "80px" }} />
          <input type="number" placeholder="dH" value={newBl.dH || ""} onChange={(e) => setNewBl({ ...newBl, dH: +e.target.value || 0 })} style={{ width: "60px" }} />
          <button onClick={addBaseline} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* LS Results */}
      {result && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Adjustment Results</h3>

          {/* Global stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: "sigma_0^2", value: result.sigma_0_sq.toFixed(6) },
              { label: "Chi-Square p", value: result.chi_square_p_value.toFixed(4) },
              {
                label: "Global Test",
                value: result.passes_global_test ? "PASS" : "FAIL",
                color: result.passes_global_test ? "#22c55e" : "#ef4444",
              },
              { label: "DOF", value: String(result.degrees_of_freedom) },
              {
                label: "Blunders",
                value: result.has_flagged_blunder ? "FLAGGED" : "None",
                color: result.has_flagged_blunder ? "#f59e0b" : "#22c55e",
              },
            ].map((s) => (
              <div key={s.label} style={{ padding: "8px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{s.label}</div>
                <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: (s as any).color ?? "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Adjusted coordinates + error ellipses */}
          <h4 style={{ fontSize: "var(--text-sm)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>Adjusted Coordinates & Error Ellipses</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", marginBottom: "12px" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Point</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj E</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj N</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj H</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Semi-Major</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Semi-Minor</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Azimuth</th>
              </tr>
            </thead>
            <tbody>
              {result.adjusted.map((a) => {
                const el = ellipses.find((e) => e.pointId === a.id);
                const pt = points.find((p) => p.id === a.id);
                return (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{a.id}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{a.easting.toFixed(4)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{a.northing.toFixed(4)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{a.height?.toFixed(4) ?? "-"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: pt?.fixed ? "var(--text-tertiary)" : "#a855f7" }}>
                      {pt?.fixed ? "---" : el ? `${(el.semiMajor * 1000).toFixed(1)} mm` : "---"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: pt?.fixed ? "var(--text-tertiary)" : "#a855f7" }}>
                      {pt?.fixed ? "---" : el ? `${(el.semiMinor * 1000).toFixed(1)} mm` : "---"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: pt?.fixed ? "var(--text-tertiary)" : "#a855f7" }}>
                      {pt?.fixed ? "---" : el ? `${el.azimuthDeg.toFixed(1)}\u00B0` : "---"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Observation diagnostics */}
          <h4 style={{ fontSize: "var(--text-sm)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>Observation Diagnostics</h4>
          <div style={{ maxHeight: "200px", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
              <thead>
                <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Baseline</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Component</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Residual</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Redundancy</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Baarda w</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}>Flag</th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((b, bi) => {
                  const components = ["dE", "dN", "dH"];
                  return components.map((comp, ci) => {
                    const obsIdx = bi * 3 + ci;
                    const residual = result.residuals[obsIdx] ?? 0;
                    const redundancy = result.redundancy[obsIdx] ?? 0;
                    const w = result.baarda_w[obsIdx] ?? 0;
                    const isBlunder = Math.abs(w) > flagThreshold;
                    return (
                      <tr
                        key={`${b.id}-${comp}`}
                        style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          background: isBlunder ? "rgba(239,68,68,0.08)" : undefined,
                        }}
                      >
                        <td style={{ padding: "4px 8px" }}>{b.id}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{comp}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }}>{residual.toFixed(5)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }}>{redundancy.toFixed(3)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: isBlunder ? "#ef4444" : "var(--text-primary)" }}>
                          {w.toFixed(3)}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "center", color: isBlunder ? "#ef4444" : "#22c55e" }}>
                          {isBlunder ? "BLUNDER" : "OK"}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>

          {/* Removal history */}
          {removalHistory.length > 0 && (
            <div style={{ marginTop: "12px", padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "#f59e0b" }}>
                Blunder Removal History ({removalHistory.length} removed)
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {removalHistory.map((h, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "var(--bg-secondary)", borderRadius: "3px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{h.reason}</span>
                    <button onClick={() => restoreBaseline(h.baselineId)}
                      style={{ background: "none", border: "1px solid #f59e0b", color: "#f59e0b", padding: "1px 6px", fontSize: "10px", borderRadius: "3px", cursor: "pointer" }}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "8px" }}>
                Excluded baselines are not used in the adjustment. Restore them to re-include in the network.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Survey canvas with ellipses */}
      {canvasPoints.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas
            height={400}
            title="GNSS Control Network & Error Ellipses"
            points={canvasPoints}
            lines={canvasLines}
            ellipses={canvasEllipses}
            showPointLabels={true}
            showNorthArrow={true}
            showScaleBar={true}
          />
          {canvasEllipses.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              <div style={{ width: "16px", height: "2px", background: "#a855f7", borderBottom: "1px dashed #a855f7" }} />
              <span>{Math.round(confidence * 100)}% confidence error ellipses (semi-major &times; semi-minor shown in mm)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
