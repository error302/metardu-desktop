/**
 * Error Ellipse Visualization Module for MetaRDU Desktop v2.0.
 *
 * Computes and renders confidence error ellipses for adjusted survey
 * coordinates. After a Least Squares Adjustment, each adjusted point
 * has a covariance matrix that describes the uncertainty in 2D.
 *
 * The error ellipse shows:
 *   - Semi-major axis (a): largest expected error direction
 *   - Semi-minor axis (b): smallest expected error direction
 *   - Orientation (θ): rotation of the ellipse from the east axis
 *
 * At 95% confidence, the ellipse encloses 95% of possible true positions.
 *
 * References:
 *   - Ghilani & Wolf, "Adjustment Computations" Ch. 6 (Error Ellipses)
 *   - Mikhail & Ackermann, "Observations and Least Squares"
 *   - RDM 1.1 §4.3 (Kenya accuracy requirements)
 */

// ─── Types ─────────────────────────────────────────────────────────

/** 2×2 covariance matrix for a point. */
export interface Covariance2D {
  /** Variance in easting (σ²_E, m²) */
  sigmaEE: number;
  /** Variance in northing (σ²_N, m²) */
  sigmaNN: number;
  /** Covariance between easting and northing (σ²_EN, m²) */
  sigmaEN: number;
}

/** Error ellipse parameters. */
export interface ErrorEllipse {
  /** Semi-major axis (meters) */
  semiMajor: number;
  /** Semi-minor axis (meters) */
  semiMinor: number;
  /** Orientation of semi-major axis from east axis (degrees, 0=east, 90=north) */
  orientation: number;
  /** Confidence level (0-1, e.g., 0.95 for 95%) */
  confidence: number;
  /** Scaling factor used (chi-square quantile) */
  scale: number;
  /** Point coordinates (for SVG rendering) */
  easting?: number;
  northing?: number;
}

/** A point with its error ellipse (for batch processing). */
export interface PointWithError {
  id: string;
  label: string;
  easting: number;
  northing: number;
  covariance: Covariance2D;
  ellipse: ErrorEllipse;
  /** Whether the point meets the tolerance */
  withinTolerance: boolean;
  /** If outside tolerance, by how much (meters) */
  excess: number;
}

// ─── Computation ───────────────────────────────────────────────────

/**
 * Compute the error ellipse from a 2×2 covariance matrix.
 *
 * Steps:
 *   1. Find eigenvalues of the covariance matrix (λ1 ≥ λ2)
 *   2. Semi-axes = sqrt(λ1) and sqrt(λ2)
 *   3. Orientation = angle of the eigenvector for λ1
 *   4. Scale by chi-square quantile for the desired confidence
 *
 * @param covariance 2×2 covariance matrix
 * @param confidence Confidence level (0-1, default 0.95)
 * @returns Error ellipse parameters
 */
export function computeErrorEllipse(
  covariance: Covariance2D,
  confidence: number = 0.95,
): ErrorEllipse {
  const { sigmaEE, sigmaNN, sigmaEN } = covariance;

  // Eigenvalues of the 2×2 matrix:
  // λ = (σ_EE + σ_NN) / 2 ± sqrt(((σ_EE - σ_NN) / 2)² + σ_EN²)
  const mean = (sigmaEE + sigmaNN) / 2;
  const diff = (sigmaEE - sigmaNN) / 2;
  const discriminant = Math.sqrt(diff * diff + sigmaEN * sigmaEN);

  const lambda1 = mean + discriminant; // larger eigenvalue (semi-major²)
  const lambda2 = mean - discriminant; // smaller eigenvalue (semi-minor²)

  // Semi-axes (standard deviations)
  const sigmaMajor = Math.sqrt(Math.max(lambda1, 0));
  const sigmaMinor = Math.sqrt(Math.max(lambda2, 0));

  // Orientation: angle of the eigenvector for λ1
  // tan(2θ) = 2σ_EN / (σ_EE - σ_NN)
  let orientation: number;
  if (Math.abs(sigmaEN) < 1e-15 && Math.abs(diff) < 1e-15) {
    orientation = 0; // Isotropic — no preferred direction
  } else {
    orientation = 0.5 * Math.atan2(2 * sigmaEN, sigmaEE - sigmaNN);
  }

  // Convert to degrees from east (0=east, 90=north, -90=south)
  let orientationDeg = orientation * 180 / Math.PI;
  // Normalize to 0-180
  if (orientationDeg < 0) orientationDeg += 180;

  // Scale by chi-square quantile
  // For 2 DOF: k = sqrt(chi2inv(confidence, 2))
  const scale = chiSquareScale2D(confidence);

  return {
    semiMajor: sigmaMajor * scale,
    semiMinor: sigmaMinor * scale,
    orientation: orientationDeg,
    confidence,
    scale,
  };
}

/**
 * Chi-square scaling factor for 2D error ellipses.
 *
 * For 2 degrees of freedom:
 *   39% → 1.0σ (1-sigma ellipse)
 *   63% → 1.52σ
 *   90% → 2.15σ
 *   95% → 2.45σ (standard surveying)
 *   99% → 3.03σ
 *
 * @param confidence Confidence level (0-1)
 * @returns Scale factor k
 */
export function chiSquareScale2D(confidence: number): number {
  // Pre-computed values for common confidence levels
  const table: Record<number, number> = {
    0.39: 1.000,
    0.50: 1.177,
    0.63: 1.520,
    0.90: 2.146,
    0.95: 2.448,
    0.99: 3.035,
    0.999: 3.717,
  };

  // Exact match
  if (table[confidence] !== undefined) return table[confidence]!;

  // Interpolate
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const k1 = keys[i]!;
    const k2 = keys[i + 1]!;
    if (confidence >= k1 && confidence <= k2) {
      const t = (confidence - k1) / (k2 - k1);
      return table[k1]! + t * (table[k2]! - table[k1]!);
    }
  }

  // Fallback: 95%
  return 2.448;
}

// ─── Batch computation ─────────────────────────────────────────────

/**
 * Compute error ellipses for multiple points.
 *
 * @param points Array of points with covariance matrices
 * @param tolerance Maximum acceptable semi-major axis (meters)
 * @param confidence Confidence level (default 0.95)
 */
export function computePointErrors(
  points: Array<{
    id: string;
    label: string;
    easting: number;
    northing: number;
    covariance: Covariance2D;
  }>,
  tolerance: number,
  confidence: number = 0.95,
): PointWithError[] {
  return points.map(p => {
    const ellipse = computeErrorEllipse(p.covariance, confidence);
    const withinTolerance = ellipse.semiMajor <= tolerance;
    const excess = withinTolerance ? 0 : ellipse.semiMajor - tolerance;

    return {
      ...p,
      ellipse,
      withinTolerance,
      excess,
    };
  });
}

// ─── SVG rendering ─────────────────────────────────────────────────

/**
 * Generate an SVG rendering of error ellipses on a set of points.
 *
 * @param points Points with error ellipses
 * @param options Rendering options
 */
export function renderErrorEllipsesSvg(
  points: PointWithError[],
  options: {
    width?: number;
    height?: number;
    scale?: number;       // pixels per meter
    tolerance?: number;   // draw tolerance circle if set
    showLabels?: boolean;
  } = {},
): string {
  const width = options.width ?? 600;
  const height = options.height ?? 400;
  const scale = options.scale ?? 100; // 100 px/m = 1cm = 1px
  const tolerance = options.tolerance;
  const showLabels = options.showLabels ?? true;

  // Compute bounds
  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width/2}" y="${height/2}" text-anchor="middle">No points</text></svg>`;
  }

  const allE = points.map(p => p.easting);
  const allN = points.map(p => p.northing);
  const minE = Math.min(...allE);
  const maxE = Math.max(...allE);
  const minN = Math.min(...allN);
  const maxN = Math.max(...allN);

  const centerX = (minE + maxE) / 2;
  const centerY = (minN + maxN) / 2;

  // Project to SVG coordinates (flip Y because SVG y-axis is down)
  const project = (e: number, n: number): [number, number] => {
    const x = width / 2 + (e - centerX) * scale;
    const y = height / 2 - (n - centerY) * scale;
    return [x, y];
  };

  // Draw ellipses
  const ellipses = points.map(p => {
    const [cx, cy] = project(p.easting, p.northing);
    const rx = p.ellipse.semiMajor * scale;
    const ry = p.ellipse.semiMinor * scale;
    const rotation = p.ellipse.orientation;

    const color = p.withinTolerance ? "#22c55e" : "#ef4444"; // green if OK, red if not
    const fillOpacity = p.withinTolerance ? 0.15 : 0.25;

    let ellipseSvg = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="1.5" transform="rotate(${-rotation} ${cx} ${cy})"/>`;

    // Point marker
    ellipseSvg += `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>`;

    // Label
    if (showLabels) {
      ellipseSvg += `<text x="${cx + 6}" y="${cy - 6}" font-size="9" fill="#333">${p.label}</text>`;
      ellipseSvg += `<text x="${cx + 6}" y="${cy + 4}" font-size="7" fill="#666">${p.ellipse.semiMajor.toFixed(3)}m</text>`;
    }

    return ellipseSvg;
  }).join("");

  // Tolerance circle (if specified)
  let toleranceSvg = "";
  if (tolerance !== undefined) {
    const tolCircles = points.map(p => {
      const [cx, cy] = project(p.easting, p.northing);
      const r = tolerance * scale;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#999" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    }).join("");
    toleranceSvg = tolCircles;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
    <rect width="100%" height="100%" fill="#fafafa"/>
    <text x="${width/2}" y="20" text-anchor="middle" font-size="12" font-weight="bold">Error Ellipses (${(points[0]?.ellipse.confidence ?? 0.95) * 100}% confidence)</text>
    ${toleranceSvg}
    ${ellipses}
    <text x="10" y="${height - 10}" font-size="8" fill="#999">Green = within tolerance | Red = exceeds tolerance | Dashed = tolerance circle</text>
  </svg>`;
}

// ─── Kenya RDM 1.1 tolerance presets ──────────────────────────────

export const ELLIPSE_TOLERANCE_PRESETS: Record<string, number> = {
  cadastral_urban: 0.010,    // 1cm at 95%
  cadastral_rural: 0.050,    // 5cm at 95%
  engineering_precise: 0.005, // 5mm at 95%
  engineering_standard: 0.020, // 2cm at 95%
  topographic: 0.100,        // 10cm at 95%
  control_1st_order: 0.003,  // 3mm at 95%
  control_2nd_order: 0.008,  // 8mm at 95%
  control_3rd_order: 0.015,  // 15mm at 95%
};
