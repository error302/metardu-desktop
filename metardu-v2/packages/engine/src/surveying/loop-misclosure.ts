/**
 * Loop Misclosure Calculator for MetaRDU Desktop v2.0.
 *
 * Implements the Kenya RDM 1.1 §2.1.7 allowable loop misclosure standards:
 *   - 12√K mm (precise levelling)
 *   - 20√K mm (ordinary levelling)
 *   - 30√K mm (reconnaissance levelling)
 *
 * Also supports linear misclosure ratio checks for traverses.
 *
 * References:
 *   - Kenya RDM 1.1 Table 2.4: Allowable Loop/Section Misclosure
 *   - Kenya Survey Regulations 1994, R.60: Traverse accuracy standards
 *   - EM 1110-1-1005 Table 3-1: USACE Point Closure Standards
 */

// ─── Types ─────────────────────────────────────────────────────────

/** Misclosure standard constant (mm per √K). */
export type MisclosureConstant = 12 | 20 | 30;

/** Linear misclosure ratio for traverses. */
export type LinearRatio = 5000 | 8000 | 10000 | 12000 | 20000;

export interface LoopMisclosureInput {
  /** Loop length in kilometres */
  loopLengthKm: number;
  /** Observed misclosure in millimetres */
  observedMisclosureMm: number;
  /** Which standard to check against (default: 12√K for precise) */
  constant?: MisclosureConstant;
}

export interface LoopMisclosureResult {
  /** Loop length in km */
  loopLengthKm: number;
  /** Observed misclosure in mm */
  observedMisclosureMm: number;
  /** Standard used */
  constant: MisclosureConstant;
  /** Allowable misclosure in mm = constant × √K */
  allowableMisclosureMm: number;
  /** Whether misclosure is within tolerance */
  withinTolerance: boolean;
  /** Ratio of observed to allowable (1.0 = exactly at limit) */
  ratio: number;
  /** Margin in mm (positive = within tolerance) */
  marginMm: number;
}

export interface LinearMisclosureInput {
  /** Total traverse length in metres */
  traverseLengthM: number;
  /** Observed linear misclosure in metres */
  misclosureM: number;
  /** Required ratio (e.g. 5000 for 1:5000) */
  requiredRatio: LinearRatio;
}

export interface LinearMisclosureResult {
  /** Traverse length in m */
  traverseLengthM: number;
  /** Misclosure in m */
  misclosureM: number;
  /** Required ratio */
  requiredRatio: LinearRatio;
  /** Achieved ratio (Infinity for zero misclosure) */
  achievedRatio: number;
  /** Whether ratio meets requirement */
  withinTolerance: boolean;
}

export interface AngularMisclosureInput {
  /** Number of traverse stations/angles */
  numberOfStations: number;
  /** Observed angular misclosure in arc-seconds */
  observedMisclosureArcsec: number;
}

export interface AngularMisclosureResult {
  /** Number of stations */
  numberOfStations: number;
  /** Observed misclosure in arc-seconds */
  observedMisclosureArcsec: number;
  /** Allowable = 3.0 × √N (Kenya Survey Regs 1994 §4.3) */
  allowableArcsec: number;
  /** Whether within tolerance */
  withinTolerance: boolean;
  /** Ratio */
  ratio: number;
}

// ─── Loop Misclosure ───────────────────────────────────────────────

/**
 * Compute the allowable loop misclosure and check against observed.
 *
 * Formula: allowable = constant × √K
 *   where K = loop length in km
 *   constant = 12 (precise), 20 (ordinary), or 30 (reconnaissance)
 *
 * @example
 * ```ts
 * const result = checkLoopMisclosure({
 *   loopLengthKm: 4.0,
 *   observedMisclosureMm: 18,
 *   constant: 12,
 * });
 * // result.allowableMisclosureMm = 24 (12 × √4 = 24)
 * // result.withinTolerance = true (18 ≤ 24)
 * ```
 */
export function checkLoopMisclosure(input: LoopMisclosureInput): LoopMisclosureResult {
  const constant = input.constant ?? 12;
  const allowable = constant * Math.sqrt(input.loopLengthKm);
  const ratio = allowable > 0 ? input.observedMisclosureMm / allowable : Infinity;

  return {
    loopLengthKm: input.loopLengthKm,
    observedMisclosureMm: input.observedMisclosureMm,
    constant,
    allowableMisclosureMm: allowable,
    withinTolerance: input.observedMisclosureMm <= allowable,
    ratio,
    marginMm: allowable - input.observedMisclosureMm,
  };
}

/**
 * Generate a table of allowable misclosures for a range of loop lengths.
 *
 * Useful for field reference cards and tolerance lookup tables.
 */
export function generateMisclosureTable(
  maxKm: number = 20,
  stepKm: number = 1,
): Array<{ km: number; m12: number; m20: number; m30: number }> {
  const table: Array<{ km: number; m12: number; m20: number; m30: number }> = [];
  for (let km = stepKm; km <= maxKm; km += stepKm) {
    const sqrtK = Math.sqrt(km);
    table.push({
      km,
      m12: Math.round(12 * sqrtK * 100) / 100,
      m20: Math.round(20 * sqrtK * 100) / 100,
      m30: Math.round(30 * sqrtK * 100) / 100,
    });
  }
  return table;
}

// ─── Linear Misclosure (Traverse) ──────────────────────────────────

/**
 * Check linear misclosure ratio for a traverse.
 *
 * Required ratio examples:
 *   - 1:5000 — Kenya cadastral (Survey Regs R.60)
 *   - 1:10000 — Kenya control survey
 *   - 1:20000 — Kenya third-order built-up
 *   - 1:12000 — Australia NSW deposited plan
 *   - 1:8000 — South Africa cadastral
 *
 * @example
 * ```ts
 * const result = checkLinearMisclosure({
 *   traverseLengthM: 5000,
 *   misclosureM: 0.5,
 *   requiredRatio: 5000,
 * });
 * // result.achievedRatio = 10000 (5000/0.5)
 * // result.withinTolerance = true (10000 ≥ 5000)
 * ```
 */
export function checkLinearMisclosure(input: LinearMisclosureInput): LinearMisclosureResult {
  const achievedRatio = input.misclosureM === 0
    ? Infinity
    : input.traverseLengthM / input.misclosureM;

  return {
    traverseLengthM: input.traverseLengthM,
    misclosureM: input.misclosureM,
    requiredRatio: input.requiredRatio,
    achievedRatio,
    withinTolerance: achievedRatio >= input.requiredRatio,
  };
}

// ─── Angular Misclosure ────────────────────────────────────────────

/**
 * Check angular misclosure for a traverse.
 *
 * Kenya Survey Regulations 1994 §4.3:
 *   allowable = 3.0″ × √N  (N = number of stations)
 *
 * Australia ICSM SP1 §3.5:
 *   allowable = 6″ × √N
 *
 * @example
 * ```ts
 * const result = checkAngularMisclosure({
 *   numberOfStations: 16,
 *   observedMisclosureArcsec: 10,
 * });
 * // result.allowableArcsec = 12 (3.0 × √16 = 12)
 * // result.withinTolerance = true (10 ≤ 12)
 * ```
 */
export function checkAngularMisclosure(
  input: AngularMisclosureInput,
  constant: number = 3.0,
): AngularMisclosureResult {
  const allowable = constant * Math.sqrt(input.numberOfStations);
  const ratio = allowable > 0 ? input.observedMisclosureArcsec / allowable : Infinity;

  return {
    numberOfStations: input.numberOfStations,
    observedMisclosureArcsec: input.observedMisclosureArcsec,
    allowableArcsec: allowable,
    withinTolerance: input.observedMisclosureArcsec <= allowable,
    ratio,
  };
}

// ─── Combined Traverser Closure Report ──────────────────────────────

export interface TraverseClosureReport {
  /** Loop misclosure check */
  loopMisclosure: LoopMisclosureResult;
  /** Linear misclosure check */
  linearMisclosure: LinearMisclosureResult;
  /** Angular misclosure check */
  angularMisclosure: AngularMisclosureResult;
  /** Overall pass/fail */
  allPassed: boolean;
  /** Summary text */
  summary: string;
}

/**
 * Generate a comprehensive traverse closure report.
 *
 * Combines loop, linear, and angular misclosure checks into a single
 * report with pass/fail status and a human-readable summary.
 */
export function generateTraverseClosureReport(params: {
  loopLengthKm: number;
  loopMisclosureMm: number;
  traverseLengthM: number;
  linearMisclosureM: number;
  numberOfStations: number;
  angularMisclosureArcsec: number;
  loopConstant?: MisclosureConstant;
  linearRatio?: LinearRatio;
  angularConstant?: number;
}): TraverseClosureReport {
  const loop = checkLoopMisclosure({
    loopLengthKm: params.loopLengthKm,
    observedMisclosureMm: params.loopMisclosureMm,
    constant: params.loopConstant ?? 12,
  });

  const linear = checkLinearMisclosure({
    traverseLengthM: params.traverseLengthM,
    misclosureM: params.linearMisclosureM,
    requiredRatio: params.linearRatio ?? 5000,
  });

  const angular = checkAngularMisclosure(
    {
      numberOfStations: params.numberOfStations,
      observedMisclosureArcsec: params.angularMisclosureArcsec,
    },
    params.angularConstant ?? 3.0,
  );

  const allPassed = loop.withinTolerance && linear.withinTolerance && angular.withinTolerance;

  const summary = [
    `Traverse Closure Report`,
    `Loop: ${loop.withinTolerance ? '✓ PASS' : '✗ FAIL'} (${loop.observedMisclosureMm.toFixed(1)}mm / ${loop.allowableMisclosureMm.toFixed(1)}mm allowable)`,
    `Linear: ${linear.withinTolerance ? '✓ PASS' : '✗ FAIL'} (1:${Math.round(linear.achievedRatio)} achieved, 1:${linear.requiredRatio} required)`,
    `Angular: ${angular.withinTolerance ? '✓ PASS' : '✗ FAIL'} (${angular.observedMisclosureArcsec.toFixed(1)}″ / ${angular.allowableArcsec.toFixed(1)}″ allowable)`,
    `Overall: ${allPassed ? '✓ ALL PASSED' : '✗ ONE OR MORE FAILED'}`,
  ].join('\n');

  return {
    loopMisclosure: loop,
    linearMisclosure: linear,
    angularMisclosure: angular,
    allPassed,
    summary,
  };
}
