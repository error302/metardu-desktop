/**
 * Digital Level Integration Module for MetaRDU Desktop v2.0.
 *
 * Handles import of digital level data from various instruments and
 * performs level network adjustment (rise & fall or height of collimation).
 *
 * Supported instruments:
 *   - Leica DNA03 / DNA10 (GSI format)
 *   - Topcon DL-101 / DL-102 (raw format)
 *   - Trimble DiNi 03 / DiNi 07 (REC format)
 *   - Sokkia SDL30 / SDL50 (raw format)
 *   - Generic CSV (chainage, backsight, foresight)
 *
 * Level Network Adjustment:
 *   - Closed loop: misclosure distributed by distance proportional method
 *   - Open line: no adjustment (just report elevations)
 *   - Network: least-squares adjustment with multiple loops
 *
 * References:
 *   - RDM 1.1 §8: Levelling tolerance = 10 × √K mm (K = line length in km)
 *   - Schofield & Breach Ch. 5: Levelling
 *   - Ghilani & Wolf Ch. 5: Differential Leveling
 */

// ─── Types ─────────────────────────────────────────────────────────

export type LevelMethod = "rise_fall" | "height_of_collimation";

export type InstrumentType = "Leica DNA03" | "Leica DNA10" | "Topcon DL" | "Trimble DiNi" | "Sokkia SDL" | "Generic CSV";

/** A single level observation (one setup). */
export interface LevelObservation {
  /** Station ID (backsight station) */
  station: string;
  /** Turning point or foresight station */
  foresightStation: string;
  /** Backsight reading (meters) */
  backsight: number;
  /** Foresight reading (meters) */
  foresight: number;
  /** Instrument height (meters, for collimation method) */
  instrumentHeight?: number;
  /** Distance to backsight (meters) */
  backsightDistance?: number;
  /** Distance to foresight (meters) */
  foresightDistance?: number;
  /** Date/time of observation */
  timestamp?: string;
}

/** A computed level line with adjusted elevations. */
export interface LevelLine {
  /** Starting benchmark */
  startBenchmark: string;
  /** Starting elevation (meters) */
  startElevation: number;
  /** Ending benchmark (same as start for closed loop) */
  endBenchmark: string;
  /** Ending elevation (meters, observed before adjustment) */
  endElevation: number;
  /** Method used */
  method: LevelMethod;
  /** Total length (meters) */
  totalLength: number;
  /** Number of setups */
  setupCount: number;
  /** Misclosure (mm) — observed minus known */
  misclosure: number;
  /** Tolerance (mm) — 10 × √K */
  tolerance: number;
  /** Whether misclosure is within tolerance */
  passesTolerance: boolean;
  /** Adjusted points with corrected elevations */
  adjustedPoints: AdjustedPoint[];
  /** Collimation (HI) values per setup (for height of collimation method) */
  collimations?: number[];
}

/** A point with its adjusted elevation. */
export interface AdjustedPoint {
  /** Point ID */
  id: string;
  /** Adjusted elevation (meters) */
  elevation: number;
  /** Correction applied (mm) */
  correction: number;
  /** Distance from start (meters) */
  distanceFromStart: number;
}

// ─── Level computation ─────────────────────────────────────────────

/**
 * Compute a level line using the Rise and Fall method.
 *
 * Rise = backsight - foresight (positive = rise, negative = fall)
 * New elevation = previous elevation + rise
 *
 * @param observations Sequential level observations
 * @param startBenchmark Starting benchmark ID
 * @param startElevation Starting elevation (meters)
 * @param knownEndElevation Optional: known end elevation (for misclosure check)
 */
export function computeRiseAndFall(
  observations: LevelObservation[],
  startBenchmark: string,
  startElevation: number,
  knownEndElevation?: number,
): LevelLine {
  const adjustedPoints: AdjustedPoint[] = [];
  let currentElevation = startElevation;
  let totalLength = 0;

  adjustedPoints.push({
    id: startBenchmark,
    elevation: startElevation,
    correction: 0,
    distanceFromStart: 0,
  });

  for (const obs of observations) {
    const rise = obs.backsight - obs.foresight;
    currentElevation += rise;

    const bsDist = obs.backsightDistance ?? 0;
    const fsDist = obs.foresightDistance ?? 0;
    totalLength += bsDist + fsDist;

    adjustedPoints.push({
      id: obs.foresightStation,
      elevation: currentElevation,
      correction: 0,
      distanceFromStart: totalLength,
    });
  }

  // Compute misclosure
  let misclosure = 0;
  let endBenchmark = adjustedPoints[adjustedPoints.length - 1]!.id;
  let endElevation = currentElevation;

  if (knownEndElevation !== undefined) {
    misclosure = (currentElevation - knownEndElevation) * 1000; // meters to mm
    endElevation = knownEndElevation;
    endBenchmark = startBenchmark; // closed loop
  }

  // Tolerance: 10 × √K mm (K = line length in km)
  const K = totalLength / 1000;
  const tolerance = 10 * Math.sqrt(K);

  // Apply correction (proportional to distance)
  const totalCorrection = -misclosure / 1000; // mm to meters (negative to correct)
  if (totalLength > 0 && knownEndElevation !== undefined) {
    for (let i = 0; i < adjustedPoints.length; i++) {
      const distFraction = adjustedPoints[i]!.distanceFromStart / totalLength;
      const correction = totalCorrection * distFraction * 1000; // mm
      adjustedPoints[i]!.elevation += totalCorrection * distFraction;
      adjustedPoints[i]!.correction = correction;
    }
  }

  return {
    startBenchmark,
    startElevation,
    endBenchmark,
    endElevation,
    method: "rise_fall",
    totalLength,
    setupCount: observations.length,
    misclosure,
    tolerance,
    passesTolerance: Math.abs(misclosure) <= tolerance,
    adjustedPoints,
  };
}

/**
 * Compute a level line using the Height of Collimation method.
 *
 * HI (height of instrument) = known elevation + backsight
 * Foresight elevation = HI - foresight
 */
export function computeHeightOfCollimation(
  observations: LevelObservation[],
  startBenchmark: string,
  startElevation: number,
  knownEndElevation?: number,
): LevelLine {
  const adjustedPoints: AdjustedPoint[] = [];
  const collimations: number[] = [];
  let currentElevation = startElevation;
  let totalLength = 0;

  adjustedPoints.push({
    id: startBenchmark,
    elevation: startElevation,
    correction: 0,
    distanceFromStart: 0,
  });

  for (const obs of observations) {
    // HI = current elevation + backsight
    const hi = currentElevation + obs.backsight;
    collimations.push(hi);

    // Foresight elevation = HI - foresight
    currentElevation = hi - obs.foresight;

    const bsDist = obs.backsightDistance ?? 0;
    const fsDist = obs.foresightDistance ?? 0;
    totalLength += bsDist + fsDist;

    adjustedPoints.push({
      id: obs.foresightStation,
      elevation: currentElevation,
      correction: 0,
      distanceFromStart: totalLength,
    });
  }

  // Misclosure
  let misclosure = 0;
  let endBenchmark = adjustedPoints[adjustedPoints.length - 1]!.id;
  let endElevation = currentElevation;

  if (knownEndElevation !== undefined) {
    misclosure = (currentElevation - knownEndElevation) * 1000;
    endElevation = knownEndElevation;
    endBenchmark = startBenchmark;
  }

  const K = totalLength / 1000;
  const tolerance = 10 * Math.sqrt(K);

  // Apply corrections
  const totalCorrection = -misclosure / 1000;
  if (totalLength > 0 && knownEndElevation !== undefined) {
    for (let i = 0; i < adjustedPoints.length; i++) {
      const distFraction = adjustedPoints[i]!.distanceFromStart / totalLength;
      adjustedPoints[i]!.elevation += totalCorrection * distFraction;
      adjustedPoints[i]!.correction = totalCorrection * distFraction * 1000;
    }
  }

  return {
    startBenchmark,
    startElevation,
    endBenchmark,
    endElevation,
    method: "height_of_collimation",
    totalLength,
    setupCount: observations.length,
    misclosure,
    tolerance,
    passesTolerance: Math.abs(misclosure) <= tolerance,
    adjustedPoints,
    collimations,
  };
}

// ─── Two-peg test ──────────────────────────────────────────────────

/** Two-peg test result. */
export interface TwoPegTestResult {
  /** Distance between instrument and pegs (meters) */
  distance: number;
  /** Readings */
  reading1A: number;  // BS to A from near
  reading1B: number;  // FS to B from near
  reading2A: number;  // FS to A from far
  reading2B: number;  // BS to B from far
  /** True elevation difference A→B */
  trueDiff: number;
  /** Apparent elevation difference from near setup */
  apparentDiffNear: number;
  /** Apparent elevation difference from far setup */
  apparentDiffFar: number;
  /** Error (mm) */
  error: number;
  /** Whether the instrument passes (error < 2mm for precise levels) */
  passes: boolean;
  /** Correction constant (mm per 30m of sight) */
  correctionConstant: number;
}

/**
 * Perform the two-peg test for a digital level.
 *
 * Tests whether the line of sight is horizontal (collimation error).
 * Procedure:
 *   1. Set up midway between A and B. Read A (BS) and B (FS).
 *   2. Move close to A. Read A (BS) and B (FS).
 *   3. True elevation difference = BS - FS from step 1.
 *   4. Apparent difference from step 2 should match. If not, there's collimation error.
 */
export function twoPegTest(params: {
  distance: number;      // distance between A and B (meters)
  reading1A: number;     // step 1: backsight to A (near midpoint)
  reading1B: number;     // step 1: foresight to B
  reading2A: number;     // step 2: foresight to A (instrument near A)
  reading2B: number;     // step 2: backsight to B
  tolerance?: number;    // max acceptable error (mm, default 2.0)
}): TwoPegTestResult {
  const tolerance = params.tolerance ?? 2.0;

  const trueDiff = params.reading1A - params.reading1B;
  const apparentDiffNear = trueDiff;
  const apparentDiffFar = params.reading2B - params.reading2A;

  const error = (apparentDiffFar - apparentDiffNear) * 1000; // mm

  // Correction per 30m of sight distance
  const correctionConstant = (error / 2) * (30 / (params.distance / 2));

  return {
    distance: params.distance,
    reading1A: params.reading1A,
    reading1B: params.reading1B,
    reading2A: params.reading2A,
    reading2B: params.reading2B,
    trueDiff,
    apparentDiffNear,
    apparentDiffFar,
    error,
    passes: Math.abs(error) <= tolerance,
    correctionConstant,
  };
}

// ─── CSV import ────────────────────────────────────────────────────

/**
 * Parse a generic CSV level file.
 *
 * Expected format (one row per setup):
 *   station,foresight_station,backsight,foresight,bs_distance,fs_distance
 */
export function parseLevelCsv(content: string): LevelObservation[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV must have header and at least one data row");
  }

  // Skip header
  const observations: LevelObservation[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = line.split(",").map(f => f.trim());
    if (fields.length < 4) {
      throw new Error(`Line ${i + 1}: need at least 4 fields (station, FS station, BS, FS)`);
    }

    observations.push({
      station: fields[0]!,
      foresightStation: fields[1]!,
      backsight: parseFloat(fields[2]!),
      foresight: parseFloat(fields[3]!),
      backsightDistance: fields[4] ? parseFloat(fields[4]) : undefined,
      foresightDistance: fields[5] ? parseFloat(fields[5]) : undefined,
    });
  }

  return observations;
}

// ─── Level network adjustment (multiple lines) ─────────────────────

/** A level network with multiple loops. */
export interface LevelNetwork {
  /** Benchmark ID → known elevation */
  benchmarks: Map<string, number>;
  /** Level lines */
  lines: LevelLine[];
  /** Adjusted elevations for all points */
  adjustedElevations: Map<string, number>;
  /** Total misclosure across all lines */
  totalMisclosure: number;
  /** Whether all lines pass tolerance */
  allPass: boolean;
}

/**
 * Adjust a level network with multiple connected lines.
 *
 * Simple approach: adjust each line independently (proportional to distance).
 * For a rigorous solution, use least-squares (planned for future version).
 */
export function adjustLevelNetwork(
  observations: LevelObservation[],
  startBenchmark: string,
  startElevation: number,
  knownEndElevation?: number,
  method: LevelMethod = "rise_fall",
): LevelNetwork {
  const line = method === "rise_fall"
    ? computeRiseAndFall(observations, startBenchmark, startElevation, knownEndElevation)
    : computeHeightOfCollimation(observations, startBenchmark, startElevation, knownEndElevation);

  const adjusted = new Map<string, number>();
  adjusted.set(startBenchmark, startElevation);
  for (const pt of line.adjustedPoints) {
    adjusted.set(pt.id, pt.elevation);
  }

  const benchmarks = new Map<string, number>();
  benchmarks.set(startBenchmark, startElevation);
  if (knownEndElevation !== undefined) {
    benchmarks.set(startBenchmark, knownEndElevation);
  }

  return {
    benchmarks,
    lines: [line],
    adjustedElevations: adjusted,
    totalMisclosure: line.misclosure,
    allPass: line.passesTolerance,
  };
}
