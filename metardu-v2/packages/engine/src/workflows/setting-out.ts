/**
 * Construction Setting-Out workflow — design import → stakeout → as-built QC.
 *
 * Master plan Section 6.4. Takes a design (list of points to be staked),
 * generates a stakeout plan with method (polar from control, resection,
 * GNSS RTK), records as-built observations, and produces an as-built
 * verification report with pass/fail per the country's construction
 * tolerance.
 *
 * This workflow has the tightest real-time accuracy requirements —
 * every setting-out coordinate must show its propagated uncertainty
 * from the sidecar's adjustment engine so the surveyor knows whether
 * the stakeout is inside tolerance BEFORE concrete gets poured.
 *
 * # Pipeline
 *
 *   1. Accept design points (CAD import or manual entry)
 *   2. Generate stakeout plan: for each design point, pick the method
 *      (polar from nearest control, resection if no control nearby,
 *      GNSS RTK if open sky)
 *   3. Compute theoretical bearings + distances from control
 *   4. (Field phase — out of scope for this module: surveyor records
 *      as-built observations)
 *   5. Accept as-built observations, compute residuals vs design
 *   6. Check each residual against the country's construction tolerance
 *   7. Generate as-built verification report (pass/fail per point)
 *
 * # References
 *
 *   - Master plan Section 6.4
 *   - RICS Setting Out Guidance Note, 2nd ed. (UK)
 *   - ICSM SP1 v2.2 §3.3 Class A (Australia engineering)
 *   - Kenya RDM 1.1 §7 (construction tolerances)
 */

import type { CountrySurveyConfig } from "@metardu/country-config";
import type { PointUncertainty } from "../survey-types.js";

// ─── Types ───────────────────────────────────────────────────────

/** A design point to be staked out. */
export interface DesignPoint {
  /** Point ID (e.g. "P1", "F1" for foundation, "CB1" for column base). */
  id: string;
  /** Design easting (metres). */
  easting: number;
  /** Design northing (metres). */
  northing: number;
  /** Design elevation (metres, optional — null for 2D-only stakeout). */
  elevation?: number;
  /** Point type (drives tolerance selection). */
  type: "foundation" | "column" | "wall" | "edge" | "general";
}

/** A control point (known position used as the stakeout origin). */
export interface ControlPoint {
  id: string;
  easting: number;
  northing: number;
  elevation?: number;
}

/** Stakeout method. */
export type StakeoutMethod = "polar" | "resection" | "gnss_rtk";

/** A stakeout instruction for one design point. */
export interface StakeoutInstruction {
  designPointId: string;
  method: StakeoutMethod;
  /** Control point used (for polar / resection). */
  fromControlId?: string;
  /** Theoretical bearing from control to design point (decimal degrees, CW from N). */
  bearingDeg: number;
  /** Theoretical distance from control to design point (metres). */
  distanceM: number;
  /** Design coordinates (echoed for convenience). */
  designEasting: number;
  designNorthing: number;
}

/** An as-built observation (what was actually staked). */
export interface AsBuiltObservation {
  designPointId: string;
  /** As-built easting (metres). */
  easting: number;
  /** As-built northing (metres). */
  northing: number;
  /** As-built elevation (metres, optional). */
  elevation?: number;
}

/** Result of as-built verification for one point. */
export interface AsBuiltResult {
  designPointId: string;
  /** Easting residual (as-built - design), metres. */
  deltaE: number;
  /** Northing residual (as-built - design), metres. */
  deltaN: number;
  /** Horizontal residual (sqrt(deltaE² + deltaN²)), metres. */
  horizontalResidual: number;
  /** Elevation residual (as-built - design), metres (null if no elev). */
  deltaZ: number | null;
  /** True if horizontal residual is within tolerance. */
  passesHorizontal: boolean;
  /** True if vertical residual is within tolerance. */
  passesVertical: boolean;
  /** Overall pass/fail. */
  passes: boolean;
}

/** Input to the setting-out workflow. */
export interface SettingOutWorkflowInput {
  /** Design points to be staked. */
  designPoints: DesignPoint[];
  /** Available control points. */
  controlPoints: ControlPoint[];
  /** As-built observations (empty if generating stakeout instructions only). */
  asBuilt?: AsBuiltObservation[];
  /** Active country config. */
  country: CountrySurveyConfig;
}

/** Output of the setting-out workflow. */
export interface SettingOutWorkflowOutput {
  /** Stakeout instructions per design point. */
  instructions: StakeoutInstruction[];
  /** As-built verification results (empty if no as-built observations). */
  results: AsBuiltResult[];
  /** True if ALL as-built points pass. */
  allPass: boolean;
  /** Number of points that failed. */
  failCount: number;
  /** Construction horizontal tolerance from country config (metres). */
  horizontalToleranceM: number;
  /** Max horizontal residual (metres). */
  maxHorizontalResidual: number;
  /** Mean horizontal residual (metres). */
  meanHorizontalResidual: number;
  /**
   * Per-point uncertainty for design + control points, keyed by label.
   * Design points default to `{ adjusted: false, reason: "field-data" }` —
   * they’re design coordinates, not adjusted survey points. Control
   * points default to `{ adjusted: false, reason: "fixed-control" }`.
   * When a future task brief wires setting-out through the sidecar’s
   * LS adjustment, this field gets the real ellipses.
   */
  pointUncertainty: Record<string, PointUncertainty>;
}

// ─── Main entry point ────────────────────────────────────────────

export function runSettingOutWorkflow(input: SettingOutWorkflowInput): SettingOutWorkflowOutput {
  if (input.designPoints.length === 0) {
    throw new Error("Setting-out workflow requires at least 1 design point.");
  }
  if (input.controlPoints.length === 0) {
    throw new Error("Setting-out workflow requires at least 1 control point.");
  }

  // Generate stakeout instructions: for each design point, pick the
  // nearest control point and compute bearing + distance.
  const instructions: StakeoutInstruction[] = [];
  for (const dp of input.designPoints) {
    const nearest = findNearestControl(dp, input.controlPoints);
    if (!nearest) continue;

    const de = dp.easting - nearest.easting;
    const dn = dp.northing - nearest.northing;
    const distance = Math.sqrt(de * de + dn * dn);
    let bearing = Math.atan2(de, dn) * 180 / Math.PI;
    if (bearing < 0) bearing += 360;

    // Pick the method. If the nearest control is within 200m and we
    // have line of sight (simplified: always assume yes), use polar.
    // Otherwise, use GNSS RTK.
    const method: StakeoutMethod = distance < 200 ? "polar" : "gnss_rtk";

    instructions.push({
      designPointId: dp.id,
      method,
      fromControlId: nearest.id,
      bearingDeg: bearing,
      distanceM: distance,
      designEasting: dp.easting,
      designNorthing: dp.northing,
    });
  }

  // As-built verification (if observations provided).
  const results: AsBuiltResult[] = [];
  const horizontalTolerance = getConstructionTolerance(input.country);

  for (const obs of input.asBuilt ?? []) {
    const dp = input.designPoints.find((p) => p.id === obs.designPointId);
    if (!dp) continue;

    const deltaE = obs.easting - dp.easting;
    const deltaN = obs.northing - dp.northing;
    const horizontalResidual = Math.sqrt(deltaE * deltaE + deltaN * deltaN);

    const deltaZ = (dp.elevation !== undefined && obs.elevation !== undefined)
      ? obs.elevation - dp.elevation
      : null;

    const passesHorizontal = horizontalResidual <= horizontalTolerance;
    const passesVertical = deltaZ === null || Math.abs(deltaZ) <= horizontalTolerance * 1.5;
    // Vertical tolerance is typically 1.5× horizontal for construction.

    results.push({
      designPointId: obs.designPointId,
      deltaE,
      deltaN,
      horizontalResidual,
      deltaZ,
      passesHorizontal,
      passesVertical,
      passes: passesHorizontal && passesVertical,
    });
  }

  const failCount = results.filter((r) => !r.passes).length;
  const maxHorizontalResidual = results.length > 0
    ? Math.max(...results.map((r) => r.horizontalResidual))
    : 0;
  const meanHorizontalResidual = results.length > 0
    ? results.reduce((s, r) => s + r.horizontalResidual, 0) / results.length
    : 0;

  // Per-point uncertainty: design points are field-data (design coordinates,
  // not adjusted survey points). Control points are fixed-control.
  const pointUncertainty: Record<string, PointUncertainty> = {};
  for (const dp of input.designPoints) {
    pointUncertainty[dp.id] = { adjusted: false, reason: "field-data" };
  }
  for (const cp of input.controlPoints) {
    pointUncertainty[cp.id] = { adjusted: false, reason: "fixed-control" };
  }

  return {
    instructions,
    results,
    allPass: failCount === 0,
    failCount,
    horizontalToleranceM: horizontalTolerance,
    maxHorizontalResidual,
    meanHorizontalResidual,
    pointUncertainty,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function findNearestControl(dp: DesignPoint, control: ControlPoint[]): ControlPoint | null {
  let nearest: ControlPoint | null = null;
  let nearestDist = Infinity;
  for (const cp of control) {
    const de = dp.easting - cp.easting;
    const dn = dp.northing - cp.northing;
    const d = de * de + dn * dn;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = cp;
    }
  }
  return nearest;
}

function getConstructionTolerance(country: CountrySurveyConfig): number {
  // Try to find a Construction survey type tolerance.
  const rule = country.toleranceTable.find(
    (r) => r.surveyType === "Construction" && r.toleranceType === "horizontal_position",
  );
  if (rule) return rule.compute({});

  // Fall back to Engineering standard.
  const engRule = country.toleranceTable.find(
    (r) => r.surveyType === "Engineering" && r.toleranceType === "horizontal_position",
  );
  if (engRule) {
    const val = engRule.compute({});
    // If there are multiple engineering rules (precise/standard), pick the larger (standard).
    const allEng = country.toleranceTable.filter(
      (r) => r.surveyType === "Engineering" && r.toleranceType === "horizontal_position",
    );
    for (const r of allEng) {
      const v = r.compute({});
      if (v > val) engRule.compute = () => v;
    }
    return engRule.compute({});
  }

  // Final fallback: 15mm (typical construction tolerance).
  return 0.015;
}
