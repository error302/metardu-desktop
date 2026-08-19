/**
 * 3-Distance Beacon Verification for MetaRDU Desktop v2.0.
 *
 * Implements the Bahrain Cadastral Survey Standards §3.11:
 *   "Beacon Verification by 3 Distances"
 *
 * Every placed beacon must be verified by measuring distances to at least
 * 3 nearby known points. If any distance differs from the computed value
 * by more than the tolerance, the beacon position is suspect.
 *
 * References:
 *   - Bahrain CSD Survey Standards Guidelines Manual 2nd Ed. §3.11
 *   - Kenya Survey Regulations 1994, R.39 (referencing of boundary beacons)
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface VerificationPoint {
  /** Point label (e.g., "BM-01", "TRIG-12") */
  label: string;
  /** Easting in metres */
  easting: number;
  /** Northing in metres */
  northing: number;
  /** Optional elevation */
  elevation?: number;
  /** Whether this point is fixed/known */
  isFixed: boolean;
  /** Optional description */
  description?: string;
}

export interface DistanceObservation {
  /** Label of the point being verified */
  beaconLabel: string;
  /** Label of the reference point */
  referenceLabel: string;
  /** Observed distance in metres */
  observedDistanceM: number;
}

export interface DistanceCheck {
  /** Reference point label */
  referenceLabel: string;
  /** Computed distance from beacon to reference (m) */
  computedDistanceM: number;
  /** Observed distance (m) */
  observedDistanceM: number;
  /** Difference (m) */
  differenceM: number;
  /** Difference in mm */
  differenceMm: number;
  /** Whether within tolerance */
  withinTolerance: boolean;
}

export interface BeaconVerificationInput {
  /** The beacon being verified */
  beacon: VerificationPoint;
  /** All reference points available for verification */
  referencePoints: VerificationPoint[];
  /** Distance observations from beacon to reference points */
  observations: DistanceObservation[];
  /** Tolerance in mm (default: 50mm for standard cadastral) */
  toleranceMm?: number;
  /** Minimum number of distances required (default: 3 per Bahrain CSD) */
  minDistances?: number;
}

export interface BeaconVerificationResult {
  /** Beacon label */
  beaconLabel: string;
  /** Number of distances measured */
  distanceCount: number;
  /** Minimum required distances */
  minRequired: number;
  /** Individual distance checks */
  checks: DistanceCheck[];
  /** All distances within tolerance */
  allWithinTolerance: boolean;
  /** Number of distances within tolerance */
  passedCount: number;
  /** Number of distances outside tolerance */
  failedCount: number;
  /** Maximum difference in mm */
  maxDifferenceMm: number;
  /** Overall verification passed */
  verified: boolean;
  /** Summary text */
  summary: string;
}

// ─── Core Computation ──────────────────────────────────────────────

/**
 * Compute the 2D Euclidean distance between two points.
 */
function distance2D(
  a: { easting: number; northing: number },
  b: { easting: number; northing: number },
): number {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  return Math.sqrt(de * de + dn * dn);
}

/**
 * Verify a beacon position using 3 or more distance measurements.
 *
 * Per Bahrain CSD §3.11:
 *   1. Measure distances from the beacon to at least 3 known reference points.
 *   2. Compute the expected distance from the beacon's computed coordinates.
 *   3. Compare observed vs computed distances.
 *   4. If any difference exceeds the tolerance, the beacon position is suspect.
 *
 * @example
 * ```ts
 * const result = verifyBeaconByDistances({
 *   beacon: { label: "B-101", easting: 500000, northing: 9800000, isFixed: false },
 *   referencePoints: [
 *     { label: "BM-1", easting: 500100, northing: 9800100, isFixed: true },
 *     { label: "BM-2", easting: 499900, northing: 9800050, isFixed: true },
 *     { label: "BM-3", easting: 500050, northing: 9799900, isFixed: true },
 *   ],
 *   observations: [
 *     { beaconLabel: "B-101", referenceLabel: "BM-1", observedDistanceM: 141.42 },
 *     { beaconLabel: "B-101", referenceLabel: "BM-2", observedDistanceM: 111.80 },
 *     { beaconLabel: "B-101", referenceLabel: "BM-3", observedDistanceM: 111.80 },
 *   ],
 *   toleranceMm: 50,
 * });
 * // result.verified = true (all differences ≤ 50mm)
 * ```
 */
export function verifyBeaconByDistances(
  input: BeaconVerificationInput,
): BeaconVerificationResult {
  const toleranceMm = input.toleranceMm ?? 50;
  const minRequired = input.minDistances ?? 3;

  const checks: DistanceCheck[] = [];
  let maxDiffMm = 0;

  for (const obs of input.observations) {
    // Find the reference point
    const refPoint = input.referencePoints.find(
      (p) => p.label === obs.referenceLabel,
    );

    if (!refPoint) {
      // Reference point not found — skip with a warning
      checks.push({
        referenceLabel: obs.referenceLabel,
        computedDistanceM: 0,
        observedDistanceM: obs.observedDistanceM,
        differenceM: obs.observedDistanceM,
        differenceMm: obs.observedDistanceM * 1000,
        withinTolerance: false,
      });
      continue;
    }

    // Compute expected distance from beacon's coordinates
    const computedDist = distance2D(input.beacon, refPoint);
    const diffM = Math.abs(obs.observedDistanceM - computedDist);
    const diffMm = diffM * 1000;

    if (diffMm > maxDiffMm) maxDiffMm = diffMm;

    checks.push({
      referenceLabel: obs.referenceLabel,
      computedDistanceM: computedDist,
      observedDistanceM: obs.observedDistanceM,
      differenceM: diffM,
      differenceMm: diffMm,
      withinTolerance: diffMm <= toleranceMm,
    });
  }

  const allWithinTolerance = checks.every((c) => c.withinTolerance);
  const passedCount = checks.filter((c) => c.withinTolerance).length;
  const failedCount = checks.length - passedCount;
  const hasEnoughDistances = checks.length >= minRequired;
  const verified = hasEnoughDistances && allWithinTolerance;

  const summary = [
    `Beacon Verification: ${input.beacon.label}`,
    `Distances: ${checks.length}/${minRequired} measured`,
    hasEnoughDistances ? '✓ Enough distances' : `✗ Need ${minRequired - checks.length} more`,
    allWithinTolerance ? '✓ All within tolerance' : `✗ ${failedCount} outside tolerance`,
    `Max difference: ${maxDiffMm.toFixed(1)}mm (tolerance: ${toleranceMm}mm)`,
    verified ? '✓ BEACON VERIFIED' : '✗ BEACON NOT VERIFIED',
  ].join('\n');

  return {
    beaconLabel: input.beacon.label,
    distanceCount: checks.length,
    minRequired,
    checks,
    allWithinTolerance,
    passedCount,
    failedCount,
    maxDifferenceMm: maxDiffMm,
    verified,
    summary,
  };
}

/**
 * Batch verify multiple beacons.
 */
export function verifyMultipleBeacons(
  beacons: BeaconVerificationInput[],
): BeaconVerificationResult[] {
  return beacons.map((b) => verifyBeaconByDistances(b));
}
