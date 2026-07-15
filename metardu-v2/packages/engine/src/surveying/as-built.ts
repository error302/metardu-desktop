/**
 * As-built vs Design Comparison Module for MetaRDU Desktop v2.0.
 *
 * Compares surveyed (as-built) points to design coordinates and flags
 * points that exceed tolerance. This is used for:
 *   - Quality control after construction
 *   - Verifying that staked points were built correctly
 *   - Deformation monitoring (comparing epochs)
 *
 * References:
 *   - RDM 1.1 §10: As-built Surveys
 *   - ISO 19157: Data Quality — Positional Accuracy
 */

// ─── Types ─────────────────────────────────────────────────────────

/** Comparison result for a single point. */
export interface PointComparison {
  /** Point ID */
  id: string;
  /** Design easting */
  designE: number;
  /** Design northing */
  designN: number;
  /** Design elevation */
  designH: number;
  /** Surveyed (as-built) easting */
  surveyedE: number;
  /** Surveyed northing */
  surveyedN: number;
  /** Surveyed elevation */
  surveyedH: number;
  /** Easting difference (surveyed - design, mm) */
  deltaE: number;
  /** Northing difference (mm) */
  deltaN: number;
  /** Elevation difference (mm) */
  deltaH: number;
  /** Horizontal difference (mm) */
  horizontalDiff: number;
  /** 3D difference (mm) */
  totalDiff: number;
  /** Whether this point is within tolerance */
  withinTolerance: boolean;
  /** Status */
  status: "pass" | "fail" | "warning";
}

/** Overall comparison summary. */
export interface ComparisonSummary {
  /** Total points compared */
  totalPoints: number;
  /** Points within tolerance */
  passed: number;
  /** Points outside tolerance */
  failed: number;
  /** Points in warning zone (within 2× tolerance) */
  warnings: number;
  /** Pass rate (%) */
  passRate: number;
  /** RMS of horizontal differences (mm) */
  horizontalRms: number;
  /** RMS of vertical differences (mm) */
  verticalRms: number;
  /** RMS of 3D differences (mm) */
  totalRms: number;
  /** Maximum horizontal difference (mm) */
  maxHorizontal: number;
  /** Point ID with max horizontal difference */
  maxHorizontalPoint: string | null;
  /** Points sorted by difference (worst first) */
  sortedResults: PointComparison[];
}

/** Tolerance for comparison. */
export interface ComparisonTolerance {
  /** Max horizontal difference (mm) */
  horizontal: number;
  /** Max vertical difference (mm) */
  vertical: number;
  /** Warning threshold (fraction of tolerance, e.g., 0.5 = warn at 50% of tolerance) */
  warningThreshold: number;
}

export const DEFAULT_COMPARISON_TOLERANCE: ComparisonTolerance = {
  horizontal: 20,    // 20mm
  vertical: 20,      // 20mm
  warningThreshold: 0.5,
};

// ─── Comparison computation ────────────────────────────────────────

/**
 * Compare surveyed points to design coordinates.
 *
 * @param designPoints Design coordinates (id → E, N, H)
 * @param surveyedPoints Surveyed coordinates (id → E, N, H)
 * @param tolerance Tolerance settings
 */
export function comparePoints(
  designPoints: Array<{ id: string; easting: number; northing: number; elevation: number }>,
  surveyedPoints: Array<{ id: string; easting: number; northing: number; elevation: number }>,
  tolerance: ComparisonTolerance = DEFAULT_COMPARISON_TOLERANCE,
): ComparisonSummary {
  const surveyMap = new Map(surveyedPoints.map(p => [p.id, p]));
  const results: PointComparison[] = [];

  for (const design of designPoints) {
    const surveyed = surveyMap.get(design.id);
    if (!surveyed) continue;

    const deltaE = (surveyed.easting - design.easting) * 1000;   // mm
    const deltaN = (surveyed.northing - design.northing) * 1000; // mm
    const deltaH = (surveyed.elevation - design.elevation) * 1000;

    const horizontalDiff = Math.sqrt(deltaE * deltaE + deltaN * deltaN);
    const totalDiff = Math.sqrt(deltaE * deltaE + deltaN * deltaN + deltaH * deltaH);

    const hOk = horizontalDiff <= tolerance.horizontal;
    const vOk = Math.abs(deltaH) <= tolerance.vertical;
    const withinTolerance = hOk && vOk;

    const warningZone = horizontalDiff <= tolerance.horizontal * 2 &&
                        Math.abs(deltaH) <= tolerance.vertical * 2;

    let status: "pass" | "fail" | "warning";
    if (withinTolerance) {
      status = "pass";
    } else if (warningZone) {
      status = "warning";
    } else {
      status = "fail";
    }

    results.push({
      id: design.id,
      designE: design.easting,
      designN: design.northing,
      designH: design.elevation,
      surveyedE: surveyed.easting,
      surveyedN: surveyed.northing,
      surveyedH: surveyed.elevation,
      deltaE,
      deltaN,
      deltaH,
      horizontalDiff,
      totalDiff,
      withinTolerance,
      status,
    });
  }

  // Sort by horizontal difference (worst first)
  const sorted = [...results].sort((a, b) => b.horizontalDiff - a.horizontalDiff);

  // Compute statistics
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const warnings = results.filter(r => r.status === "warning").length;

  const hRms = Math.sqrt(results.reduce((s, r) => s + r.horizontalDiff * r.horizontalDiff, 0) / results.length);
  const vRms = Math.sqrt(results.reduce((s, r) => s + r.deltaH * r.deltaH, 0) / results.length);
  const tRms = Math.sqrt(results.reduce((s, r) => s + r.totalDiff * r.totalDiff, 0) / results.length);

  const maxH = Math.max(...results.map(r => r.horizontalDiff));
  const maxHPoint = sorted[0]?.id ?? null;

  return {
    totalPoints: results.length,
    passed,
    failed,
    warnings,
    passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
    horizontalRms: hRms,
    verticalRms: vRms,
    totalRms: tRms,
    maxHorizontal: maxH,
    maxHorizontalPoint: maxHPoint,
    sortedResults: sorted,
  };
}

// ─── SVG visualization ─────────────────────────────────────────────

/**
 * Generate an SVG scatter plot of as-built vs design differences.
 */
export function renderComparisonSvg(
  summary: ComparisonSummary,
  tolerance: ComparisonTolerance,
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width ?? 600;
  const height = options.height ?? 400;
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) / (tolerance.horizontal * 5); // 5× tolerance = full scale

  // Tolerance circles
  const tolR = tolerance.horizontal * scale;
  const warnR = tolerance.horizontal * 2 * scale;

  // Points
  const points = summary.sortedResults.map(p => {
    const x = cx + p.deltaE * scale;
    const y = cy - p.deltaN * scale; // flip Y
    const color = p.status === "pass" ? "#22c55e" : p.status === "warning" ? "#f59e0b" : "#ef4444";
    const label = p.deltaH > 0 ? "+" : "";
    return `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#333" stroke-width="0.5"/>
            <text x="${x + 6}" y="${y + 3}" font-size="7" fill="#666">${p.id} (${label}${p.deltaH.toFixed(1)})</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
    <rect width="100%" height="100%" fill="#fafafa"/>
    <text x="${width/2}" y="20" text-anchor="middle" font-size="12" font-weight="bold">As-Built vs Design (ΔE/ΔN scatter)</text>
    <!-- Axes -->
    <line x1="${cx}" y1="30" x2="${cx}" y2="${height-30}" stroke="#ccc" stroke-width="0.5"/>
    <line x1="30" y1="${cy}" x2="${width-30}" y2="${cy}" stroke="#ccc" stroke-width="0.5"/>
    <text x="${width-30}" y="${cy+12}" text-anchor="end" font-size="8">ΔE (mm)</text>
    <text x="${cx+5}" y="35" font-size="8">ΔN (mm)</text>
    <!-- Tolerance circle -->
    <circle cx="${cx}" cy="${cy}" r="${tolR}" fill="#22c55e" fill-opacity="0.05" stroke="#22c55e" stroke-width="1"/>
    <!-- Warning circle -->
    <circle cx="${cx}" cy="${cy}" r="${warnR}" fill="#f59e0b" fill-opacity="0.05" stroke="#f59e0b" stroke-width="0.5" stroke-dasharray="3,2"/>
    <!-- Points -->
    ${points}
    <!-- Legend -->
    <text x="10" y="${height-10}" font-size="8" fill="#22c55e">● Pass (${summary.passed})</text>
    <text x="80" y="${height-10}" font-size="8" fill="#f59e0b">● Warning (${summary.warnings})</text>
    <text x="170" y="${height-10}" font-size="8" fill="#ef4444">● Fail (${summary.failed})</text>
    <text x="${width-10}" y="${height-10}" text-anchor="end" font-size="8" fill="#666">RMS: ${summary.horizontalRms.toFixed(1)}mm | Max: ${summary.maxHorizontal.toFixed(1)}mm</text>
  </svg>`;
}
