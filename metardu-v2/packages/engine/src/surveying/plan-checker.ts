/**
 * Automated Plan Compliance Checker for MetaRDU Desktop v2.0.
 *
 * Runs a survey plan's observed metrics against the selected country's
 * statutory tolerance table (country-config — the canonical, source-cited
 * tolerance source per invariants A2/B1). Produces a per-rule compliance
 * report with the regulation citation for every check: the audit trail a
 * surveyor needs before lodging a plan.
 *
 * This is the international-market differentiator: ONE checker works for
 * every implemented country because it reads each country's own
 * `toleranceTable` rather than hardcoding per-country logic. Adding a
 * country (with its source documents filed) automatically extends the
 * checker — no code change required.
 *
 * References:
 *   - Kenya Survey Regulations 1994 (R.39, R.60, §4.4) — via country-config
 *   - Bahrain CSD Survey Standards §3.11 — via country-config
 *   - Each rule carries its own `source` citation (invariant B1).
 */

import {
  getCountryConfig,
  type CountryCode,
  type ToleranceRule,
} from "@metardu/country-config";

/** The eight survey families (mirrors country-config's ToleranceRule.surveyType). */
export type PlanSurveyType =
  | "Cadastral"
  | "Topographic"
  | "Engineering"
  | "Geodetic"
  | "Levelling"
  | "Hydrographic"
  | "Construction"
  | "Monitoring";

/** Observed metrics for a plan. All fields optional — only supplied checks run. */
export interface PlanCheckObservations {
  /** Max observed beacon uncertainty semi-major axis (m) for horizontal_position checks. */
  maxSemiMajorM?: number;
  /** Observed levelling loop misclosure (mm) + loop length (km). */
  levellingMisclosureMm?: number;
  loopLengthKm?: number;
  /** Observed angular misclosure (arcsec) + number of stations. */
  angularMisclosureArcsec?: number;
  stationCount?: number;
  /** Observed linear misclosure (m) + total traverse length (m). */
  linearMisclosureM?: number;
  traverseLengthM?: number;
}

export interface RuleCheckResult {
  toleranceType: string;
  /** Human-readable formula, e.g. "10 × √K mm". */
  formula: string;
  /** Unit of the value ("mm" | "arcsec" | "ratio" | "m"). */
  unit: string;
  /** Regulation citation for this rule. */
  source: string;
  /** Observed value (null if not supplied for this run). */
  observed: number | null;
  /** Allowable limit from the country's tolerance table. */
  allowable: number;
  /** null if no observation supplied; true/false when compared. */
  withinTolerance: boolean | null;
  /** Optional human note (e.g. "observed 1:6250 vs limit 1:5000"). */
  note?: string;
}

export interface PlanComplianceReport {
  countryCode: CountryCode;
  surveyType: PlanSurveyType;
  checks: RuleCheckResult[];
  /** Number of checks that had a supplied observation. */
  checkedCount: number;
  /** Number of supplied observations that failed their limit. */
  failedCount: number;
  /** true iff every checked rule is within tolerance. */
  pass: boolean;
}

type Category = "levelling" | "angular" | "linear" | "horizontal";

function classify(rule: ToleranceRule): Category | null {
  const t = rule.toleranceType.toLowerCase();
  if (t.includes("levelling")) return "levelling";
  if (t.includes("angular")) return "angular";
  if (t.includes("linear")) return "linear";
  if (t.includes("horizontal")) return "horizontal";
  return null;
}

/**
 * Parse the allowable ratio from a linear-misclosure formula like
 * "1:5000 (ratio of misclosure to total traverse length)".
 *
 * country-config's linear rules return the *achieved* ratio from `compute()`
 * (length ÷ misclosure); the regulatory *limit* (the "5000" in "1:5000") is
 * only expressed in the formula text. We parse it so the checker can compare
 * observed vs limit without hardcoding per-country constants.
 */
function parseRatioLimit(formula: string): number | null {
  const m = formula.match(/1\s*:(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Run the country's statutory tolerance checks for a given survey type.
 *
 * @param countryCode ISO 3166-1 alpha-2 (must be an implemented country).
 * @param surveyType  Which tolerance family to evaluate.
 * @param obs         Observed metrics. Only categories with supplied inputs are
 *                    compared; the rest report their allowable limit for reference.
 */
export function runPlanComplianceCheck(
  countryCode: CountryCode,
  surveyType: PlanSurveyType,
  obs: PlanCheckObservations,
): PlanComplianceReport {
  const config = getCountryConfig(countryCode);
  const rules = (config.toleranceTable ?? []).filter((r) => r.surveyType === surveyType);

  const checks: RuleCheckResult[] = [];
  let checkedCount = 0;
  let failedCount = 0;

  for (const rule of rules) {
    const cat = classify(rule);
    if (!cat) continue;

    let observed: number | null = null;
    let allowable = 0;
    let within: boolean | null = null;
    let note: string | undefined;

    if (cat === "levelling") {
      if (obs.loopLengthKm === undefined) continue;
      allowable = rule.compute({ K_km: obs.loopLengthKm });
      if (obs.levellingMisclosureMm !== undefined) {
        observed = obs.levellingMisclosureMm;
        within = observed <= allowable;
      }
    } else if (cat === "angular") {
      if (obs.stationCount === undefined) continue;
      allowable = rule.compute({ N_stations: obs.stationCount });
      if (obs.angularMisclosureArcsec !== undefined) {
        observed = obs.angularMisclosureArcsec;
        within = observed <= allowable;
      }
    } else if (cat === "linear") {
      if (obs.traverseLengthM === undefined || obs.linearMisclosureM === undefined) continue;
      // Rule.compute() returns the *achieved* ratio (length ÷ misclosure);
      // the regulatory limit lives in the formula text ("1:N").
      const limit = parseRatioLimit(rule.formula);
      if (limit === null) continue;
      allowable = limit;
      // Achieved ratio (higher = better; 1:10000 ≥ 1:5000 passes).
      observed = obs.traverseLengthM / obs.linearMisclosureM;
      within = observed >= allowable;
      note = `observed 1:${observed.toFixed(0)} vs limit 1:${allowable.toFixed(0)}`;
    } else if (cat === "horizontal") {
      allowable = rule.compute({});
      if (obs.maxSemiMajorM !== undefined) {
        observed = obs.maxSemiMajorM;
        within = observed <= allowable;
      }
    }

    if (observed !== null) checkedCount++;
    if (within === false) failedCount++;
    checks.push({
      toleranceType: rule.toleranceType,
      formula: rule.formula,
      unit: rule.unit,
      source: rule.source,
      observed,
      allowable,
      withinTolerance: within,
      note,
    });
  }

  return {
    countryCode,
    surveyType,
    checks,
    checkedCount,
    failedCount,
    pass: failedCount === 0,
  };
}

/**
 * Extract checkable observations from a cadastral workflow output.
 * Reads per-beacon uncertainty (semi-major axis) produced by the LS
 * adjustment; the largest adjusted ellipse drives the horizontal_position
 * check.
 */
export function observationsFromCadastral(output: {
  uncertainty?: Record<string, { adjusted: boolean; semiMajorAxis?: number }>;
  sigma_0_sq?: number;
}): PlanCheckObservations {
  let maxSemiMajor = 0;
  const u = output.uncertainty;
  if (u) {
    for (const v of Object.values(u)) {
      if (v.adjusted && typeof v.semiMajorAxis === "number") {
        maxSemiMajor = Math.max(maxSemiMajor, v.semiMajorAxis);
      }
    }
  }
  return { maxSemiMajorM: maxSemiMajor > 0 ? maxSemiMajor : undefined };
}
