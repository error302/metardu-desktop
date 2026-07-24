/**
 * GPR / Utility mapping module — import GPR data, overlay on orthophoto,
 * generate utility survey plan.
 *
 * For the UK utility surveying market (the surveyor profile you found
 * uses Mala GPR). This module:
 *   1. Imports GPR scan data (XYZ + depth + signal strength)
 *   2. Classifies detected utilities by type
 *   3. Generates a utility survey plan (PDF + DXF)
 *   4. Computes depths, offsets, and crossing clearances
 *
 * References:
 *   - PAS 128 (UK standard for underground utility detection)
 *   - Mala GPR data format documentation
 *   - RICS Measured Surveys of Utilities specification
 */

import type { PointUncertainty } from "../survey-types.js";

// ─── Types ───────────────────────────────────────────────────────

export type UtilityType =
  | "electric" | "water" | "gas" | "telecom" | "sewer"
  | "drainage" | "fiber" | "unknown";

export interface GprDetection {
  easting: number;
  northing: number;
  /** Depth below surface (metres). */
  depth: number;
  /** Signal strength (0-100, higher = stronger reflection). */
  signalStrength: number;
  /** Detected utility type. */
  utilityType: UtilityType;
  /** Estimated pipe/cable diameter (mm, if detectable). */
  diameter?: number;
  /** Material (if identifiable). */
  material?: string;
  /** Confidence (0-1). */
  confidence: number;
}

export interface GprImportResult {
  detections: GprDetection[];
  warnings: string[];
  errors: string[];
  detectionCount: number;
}

export interface UtilitySurveyPlan {
  detections: GprDetection[];
  /** Utility runs (connected sequences of detections). */
  runs: UtilityRun[];
  /** Crossing points where utilities intersect. */
  crossings: UtilityCrossing[];
  /** Statistics. */
  stats: {
    totalDetections: number;
    byType: Record<UtilityType, number>;
    avgDepth: number;
    maxDepth: number;
    minDepth: number;
    avgConfidence: number;
  };
  /**
   * Per-point uncertainty for GPR detections, keyed by index (as string).
   */
  pointUncertainty: Record<string, PointUncertainty>;
}

export interface UtilityRun {
  type: UtilityType;
  points: { easting: number; northing: number; depth: number }[];
  totalLength: number;
  avgDepth: number;
}

export interface UtilityCrossing {
  easting: number;
  northing: number;
  run1Type: UtilityType;
  run2Type: UtilityType;
  run1Depth: number;
  run2Depth: number;
  verticalSeparation: number;
}

// ─── Utility type colors (for DXF + PDF rendering) ───────────────

export const UTILITY_COLORS: Record<UtilityType, string> = {
  electric: "#FF0000",     // Red
  water: "#0000FF",        // Blue
  gas: "#FFFF00",          // Yellow
  telecom: "#00FF00",      // Green
  sewer: "#800080",        // Purple
  drainage: "#00FFFF",     // Cyan
  fiber: "#FFA500",        // Orange
  unknown: "#808080",      // Gray
};

export const UTILITY_LABELS: Record<UtilityType, string> = {
  electric: "Electric",
  water: "Water",
  gas: "Gas",
  telecom: "Telecom",
  sewer: "Sewer",
  drainage: "Drainage",
  fiber: "Fiber Optic",
  unknown: "Unknown",
};

// ─── GPR data import ─────────────────────────────────────────────

/**
 * Import GPR detection data from a CSV or JSON file.
 *
 * CSV format: easting, northing, depth, signal, type, diameter, confidence
 * JSON format: array of GprDetection objects
 */
export function importGprData(content: string, format: "csv" | "json" = "csv"): GprImportResult {
  const detections: GprDetection[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  if (format === "json") {
    try {
      const data = JSON.parse(content) as GprDetection[];
      for (const d of data) {
        if (d.easting !== undefined && d.northing !== undefined && d.depth !== undefined) {
          detections.push(d);
        }
      }
    } catch (err) {
      errors.push(`JSON parse error: ${(err as Error).message}`);
    }
  } else {
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
    for (let i = 0; i < lines.length; i++) {
      try {
        const parts = lines[i]!.split(/[,\s]+/);
        if (parts.length < 4) continue;
        detections.push({
          easting: parseFloat(parts[0]!),
          northing: parseFloat(parts[1]!),
          depth: parseFloat(parts[2]!),
          signalStrength: parseFloat(parts[3]!),
          utilityType: (parts[4] as UtilityType) ?? "unknown",
          diameter: parts[5] ? parseFloat(parts[5]) : undefined,
          confidence: parts[6] ? parseFloat(parts[6]) : 0.5,
        });
      } catch (err) {
        errors.push(`Line ${i + 1}: ${(err as Error).message}`);
      }
    }
  }

  if (detections.length === 0) {
    warnings.push("No GPR detections found in the input data.");
  }

  return { detections, warnings, errors, detectionCount: detections.length };
}

// ─── Utility survey plan generation ──────────────────────────────

/**
 * Generate a utility survey plan from GPR detections.
 *
 * 1. Groups detections into utility runs (connected sequences of same type)
 * 2. Finds crossing points where runs intersect
 * 3. Computes statistics
 */
export function generateUtilitySurveyPlan(detections: GprDetection[]): UtilitySurveyPlan {
  if (detections.length === 0) {
    return {
      detections: [],
      runs: [],
      crossings: [],
      stats: {
        totalDetections: 0,
        byType: { electric: 0, water: 0, gas: 0, telecom: 0, sewer: 0, drainage: 0, fiber: 0, unknown: 0 },
        avgDepth: 0, maxDepth: 0, minDepth: 0, avgConfidence: 0,
      },
      pointUncertainty: {},
    };
  }

  // Group detections by type.
  const byType = new Map<UtilityType, GprDetection[]>();
  for (const d of detections) {
    const arr = byType.get(d.utilityType) ?? [];
    arr.push(d);
    byType.set(d.utilityType, arr);
  }

  // Create utility runs (simple: all detections of same type within 5m of each other).
  const runs: UtilityRun[] = [];
  for (const [type, dets] of byType) {
    const run = groupDetectionsIntoRun(dets, type);
    runs.push(...run);
  }

  // Find crossings (where two runs of different types come within 1m of each other).
  const crossings: UtilityCrossing[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[i]!.type === runs[j]!.type) continue;
      for (const p1 of runs[i]!.points) {
        for (const p2 of runs[j]!.points) {
          const dist = Math.sqrt((p1.easting - p2.easting) ** 2 + (p1.northing - p2.northing) ** 2);
          if (dist < 1.0) {
            crossings.push({
              easting: (p1.easting + p2.easting) / 2,
              northing: (p1.northing + p2.northing) / 2,
              run1Type: runs[i]!.type,
              run2Type: runs[j]!.type,
              run1Depth: p1.depth,
              run2Depth: p2.depth,
              verticalSeparation: Math.abs(p1.depth - p2.depth),
            });
          }
        }
      }
    }
  }

  // Statistics.
  const byTypeCounts: Record<UtilityType, number> = {
    electric: 0, water: 0, gas: 0, telecom: 0, sewer: 0, drainage: 0, fiber: 0, unknown: 0,
  };
  let depthSum = 0, confSum = 0;
  let maxDepth = -Infinity, minDepth = Infinity;
  for (const d of detections) {
    byTypeCounts[d.utilityType]++;
    depthSum += d.depth;
    confSum += d.confidence;
    if (d.depth > maxDepth) maxDepth = d.depth;
    if (d.depth < minDepth) minDepth = d.depth;
  }

  return {
    detections,
    runs,
    crossings,
    stats: {
      totalDetections: detections.length,
      byType: byTypeCounts,
      avgDepth: depthSum / detections.length,
      maxDepth,
      minDepth,
      avgConfidence: confSum / detections.length,
    },
    pointUncertainty: Object.fromEntries(
      detections.map((_d, i) => [String(i), { adjusted: false, reason: "field-data" } as const])
    ),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function groupDetectionsIntoRun(detections: GprDetection[], type: UtilityType): UtilityRun[] {
  if (detections.length === 0) return [];
  // Sort by easting then northing (creates a rough path order).
  const sorted = [...detections].sort((a, b) => a.easting - b.easting || a.northing - b.northing);

  const runs: UtilityRun[] = [];
  let currentRun: GprDetection[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentRun[currentRun.length - 1]!;
    const curr = sorted[i]!;
    const dist = Math.sqrt((curr.easting - prev.easting) ** 2 + (curr.northing - prev.northing) ** 2);
    if (dist < 5.0) {
      currentRun.push(curr);
    } else {
      runs.push(createRun(currentRun, type));
      currentRun = [curr];
    }
  }
  if (currentRun.length > 0) runs.push(createRun(currentRun, type));
  return runs;
}

function createRun(dets: GprDetection[], type: UtilityType): UtilityRun {
  const points = dets.map((d) => ({ easting: d.easting, northing: d.northing, depth: d.depth }));
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.sqrt(
      (points[i]!.easting - points[i - 1]!.easting) ** 2 +
      (points[i]!.northing - points[i - 1]!.northing) ** 2,
    );
  }
  return {
    type,
    points,
    totalLength: length,
    avgDepth: points.reduce((s, p) => s + p.depth, 0) / points.length,
  };
}
