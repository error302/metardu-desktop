/**
 * Slope and Area Analysis from DTM Surface
 *
 * Computation engine for slope classification, area distribution, and cut/fill
 * analysis from Digital Terrain Model (DTM) point clouds.
 *
 * All functions are pure — no side effects, no external dependencies.
 *
 * Coordinate System: Arc 1960 / UTM Zone 37S or any local grid (Easting/Northing/Elevation).
 * All distances in metres, angles in decimal degrees unless otherwise specified.
 *
 * Standards:
 * - Ghilani & Wolf, "Elementary Surveying: An Introduction to Geomatics" §17.4
 * - RDM 1.3 §4 (Roads Design Manual — Kenya)
 * - KENHA Design Manual 2017 — Slope classification thresholds
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DTMPoint {
  easting: number;
  northing: number;
  elevation: number;
}

export interface SlopePoint {
  easting: number;
  northing: number;
  elevation: number;
  slopePercent: number; // slope as percentage (rise/run * 100)
  slopeDegrees: number; // slope in degrees
  aspect: number; // aspect in degrees (0=N, 90=E, 180=S, 270=W)
  slopeClass: 'flat' | 'gentle' | 'moderate' | 'steep' | 'very_steep' | 'cliff';
}

export interface SlopeAnalysisResult {
  slopePoints: SlopePoint[];
  statistics: {
    meanSlopePercent: number;
    maxSlopePercent: number;
    minSlopePercent: number;
    meanSlopeDegrees: number;
    slopeDistribution: {
      flat: number; // 0-2%
      gentle: number; // 2-5%
      moderate: number; // 5-15%
      steep: number; // 15-35%
      very_steep: number; // 35-60%
      cliff: number; // >60%
    }; // count of points in each class
    totalArea: number; // Total area in sq meters
    areaByClass: Record<string, number>; // area per slope class (sq meters)
  };
  boundingBox: { minE: number; minN: number; maxE: number; maxN: number };
  gridResolution: number;
}

export interface CutFillDatumResult {
  totalCutVolume: number; // cubic meters
  totalFillVolume: number;
  netVolume: number;
  cutArea: number; // sq meters
  fillArea: number;
  balancePoint: number; // datum RL where cut ≈ fill
  points: {
    easting: number;
    northing: number;
    existingRL: number;
    designRL: number;
    difference: number; // positive = cut, negative = fill
  }[];
}

// ─── Slope Classification (KENHA/RDM Standards) ─────────────────────────────

/**
 * Classify slope percentage per KENHA Design Manual 2017 / RDM 1.3 §4.
 *
 * | Class       | Range    |
 * |-------------|----------|
 * | flat        | 0–2%     |
 * | gentle      | 2–5%     |
 * | moderate    | 5–15%    |
 * | steep       | 15–35%   |
 * | very_steep  | 35–60%   |
 * | cliff       | >60%     |
 */
function classifySlope(
  slopePercent: number
): SlopePoint['slopeClass'] {
  if (slopePercent < 2) return 'flat';
  if (slopePercent < 5) return 'gentle';
  if (slopePercent < 15) return 'moderate';
  if (slopePercent < 35) return 'steep';
  if (slopePercent < 60) return 'very_steep';
  return 'cliff';
}

// ─── Bounding Box ────────────────────────────────────────────────────────────

function computeBoundingBox(points: DTMPoint[]): {
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
} {
  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;

  for (const p of points) {
    if (p.easting < minE) minE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing > maxN) maxN = p.northing;
  }

  return { minE, minN, maxE, maxN };
}

// ─── Auto Grid Resolution ───────────────────────────────────────────────────

/**
 * Estimate a suitable grid resolution from the point cloud.
 *
 * Uses average nearest-neighbour distance scaled so that each grid cell
 * covers approximately 4–9 original points on average. Falls back to a
 * reasonable maximum of 10 m for dense surveys.
 */
function autoGridResolution(points: DTMPoint[]): number {
  if (points.length < 4) return 1.0;

  // Sample-based nearest-neighbour distance estimation (max 500 points)
  const sample = points.length > 500 ? samplePoints(points, 500) : points;
  let totalMinDist = 0;
  let count = 0;

  for (let i = 0; i < sample.length; i++) {
    let minDist = Infinity;
    const pi = sample[i];
    for (let j = 0; j < sample.length; j++) {
      if (i === j) continue;
      const dx = pi.easting - sample[j].easting;
      const dy = pi.northing - sample[j].northing;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) minDist = d;
    }
    if (minDist < Infinity) {
      totalMinDist += minDist;
      count++;
    }
  }

  const avgNN = totalMinDist / count;
  // Grid resolution ≈ 2× average nearest-neighbour distance
  const resolution = avgNN * 2;
  return Math.min(Math.max(resolution, 0.5), 50.0);
}

function samplePoints(points: DTMPoint[], n: number): DTMPoint[] {
  const step = Math.max(1, Math.floor(points.length / n));
  const result: DTMPoint[] = [];
  for (let i = 0; i < points.length && result.length < n; i += step) {
    result.push(points[i]);
  }
  return result;
}

// ─── IDW Interpolation ──────────────────────────────────────────────────────

/**
 * Inverse Distance Weighting (IDW) interpolation.
 *
 * For a query point (x, y), find nearby source points within `maxRadius`,
 * require at least `minNeighbors`, and compute:
 *
 *   Z(x,y) = Σ(wᵢ · zᵢ) / Σ(wᵢ)   where wᵢ = 1/dᵢ^power
 *
 * @param points   Source DTM points
 * @param x        Query easting
 * @param y        Query northing
 * @param power    IDW exponent (default 2)
 * @param minNeighbors  Minimum neighbours required (default 4)
 * @param maxRadius  Maximum search radius (default: 3 × estimated avg spacing)
 * @returns Interpolated elevation, or NaN if insufficient data
 *
 * Reference: Ghilani & Wolf §17.4 — Surface Modelling
 */
export function idwInterpolate(
  points: DTMPoint[],
  x: number,
  y: number,
  power: number = 2,
  minNeighbors: number = 4,
  maxRadius?: number
): number {
  if (points.length === 0) return NaN;

  // Auto-estimate maxRadius if not provided (3× average nearest-neighbour distance)
  let searchRadius = maxRadius;
  if (searchRadius === undefined || searchRadius === 0) {
    searchRadius = autoGridResolution(points) * 3;
  }

  // Collect neighbours within search radius
  interface Neighbour {
    dist2: number;
    z: number;
  }

  const neighbours: Neighbour[] = [];

  for (const p of points) {
    const dx = p.easting - x;
    const dy = p.northing - y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 === 0) {
      // Exact match — return immediately
      return p.elevation;
    }

    if (dist2 <= searchRadius * searchRadius) {
      neighbours.push({ dist2, z: p.elevation });
    }
  }

  // Sort by distance (ascending) so we can use the closest ones
  neighbours.sort((a, b) => a.dist2 - b.dist2);

  // If fewer than minNeighbors within radius, expand search or use all available
  if (neighbours.length < minNeighbors) {
    // If we have at least 1 point, use it as fallback (nearest point)
    if (neighbours.length === 0 && points.length > 0) {
      // Fall back to single nearest point overall
      let nearestDist2 = Infinity;
      let nearestZ = 0;
      for (const p of points) {
        const dx = p.easting - x;
        const dy = p.northing - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestDist2) {
          nearestDist2 = d2;
          nearestZ = p.elevation;
        }
      }
      return nearestZ;
    }
    // Otherwise proceed with what we have (even if less than minNeighbors)
  }

  // Use minNeighbors or all available, whichever is smaller
  const useCount = Math.min(minNeighbors, neighbours.length);
  const subset = neighbours.length > useCount
    ? neighbours.slice(0, useCount)
    : neighbours;

  let wSum = 0;
  let wzSum = 0;

  for (const n of subset) {
    const d = Math.sqrt(n.dist2);
    const w = 1 / Math.pow(d, power);
    wSum += w;
    wzSum += w * n.z;
  }

  return wSum > 0 ? wzSum / wSum : NaN;
}

// ─── Build Regular Grid via IDW ─────────────────────────────────────────────

interface GridCell {
  easting: number;
  northing: number;
  elevation: number;
}

/**
 * Build a regular grid from DTM points using IDW interpolation.
 * Grid is snapped to multiples of resolution for alignment.
 */
function buildIDWGrid(
  points: DTMPoint[],
  resolution: number,
  bbox: { minE: number; minN: number; maxE: number; maxN: number }
): GridCell[][] {
  // Snap grid origin to resolution multiples
  const startE = Math.floor(bbox.minE / resolution) * resolution;
  const startN = Math.floor(bbox.minN / resolution) * resolution;
  const endE = Math.ceil(bbox.maxE / resolution) * resolution;
  const endN = Math.ceil(bbox.maxN / resolution) * resolution;

  const cols = Math.round((endE - startE) / resolution);
  const rows = Math.round((endN - startN) / resolution);

  const grid: GridCell[][] = [];

  for (let r = 0; r <= rows; r++) {
    const row: GridCell[] = [];
    const northing = startN + r * resolution;
    for (let c = 0; c <= cols; c++) {
      const easting = startE + c * resolution;
      const elevation = idwInterpolate(points, easting, northing, 2, 4, resolution * 3);
      row.push({ easting, northing, elevation: isNaN(elevation) ? 0 : elevation });
    }
    grid.push(row);
  }

  return grid;
}

// ─── Slope Computation (4-neighbor finite difference) ───────────────────────

/**
 * Compute slope and aspect for a grid cell using the 4-neighbor finite difference
 * method (Horn's method with uniform grid spacing).
 *
 *   dz/dx = (z_east - z_west)  / (2·res)
 *   dz/dy = (z_north - z_south) / (2·res)
 *
 *   slope_rad = atan(√((dz/dx)² + (dz/dy)²))
 *   slope_deg = slope_rad × 180/π
 *   slope_pct = tan(slope_rad) × 100
 *
 *   aspect = atan2(-dz/dy, dz/dx) converted to 0–360 from North
 *
 * Reference: Ghilani & Wolf §17.4
 */
function computeSlopeAtCell(
  grid: GridCell[][],
  row: number,
  col: number,
  resolution: number
): { slopePercent: number; slopeDegrees: number; aspect: number } {
  const rows = grid.length;
  const cols = grid[0].length;

  // Center elevation
  const zCenter = grid[row][col].elevation;

  // Get neighbors with boundary clamping (repeat edge values)
  const zNorth = row > 0 ? grid[row - 1][col].elevation : zCenter;
  const zSouth = row < rows - 1 ? grid[row + 1][col].elevation : zCenter;
  const zEast = col < cols - 1 ? grid[row][col + 1].elevation : zCenter;
  const zWest = col > 0 ? grid[row][col - 1].elevation : zCenter;

  // Finite differences
  const dzdx = (zEast - zWest) / (2 * resolution);
  const dzdy = (zNorth - zSouth) / (2 * resolution);

  // Slope magnitude
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  const slopeDegrees = (slopeRad * 180) / Math.PI;
  const slopePercent = Math.tan(slopeRad) * 100;

  // Aspect: 0=N, 90=E, 180=S, 270=W
  // atan2 returns angle from East (x-axis), counterclockwise
  // We want angle from North (y-axis), clockwise
  let aspectDeg = (Math.atan2(-dzdy, dzdx) * 180) / Math.PI;
  if (aspectDeg < 0) aspectDeg += 360;

  return {
    slopePercent: Math.abs(slopePercent),
    slopeDegrees: Math.abs(slopeDegrees),
    aspect: aspectDeg,
  };
}

// ─── Main: analyzeSlopeFromPoints ───────────────────────────────────────────

/**
 * Full slope and area analysis from a DTM point cloud.
 *
 * Workflow:
 *  1. Build a regular grid from the point cloud using IDW interpolation
 *     (power=2, min 4 nearest neighbours, max search radius = 3×gridResolution)
 *  2. For each grid point, compute slope using the 4-neighbor finite
 *     difference method
 *  3. Compute aspect = atan2(-dz/dy, dz/dx) converted to 0–360 from North
 *  4. Classify slope per KENHA/RDM standards
 *  5. Compute statistics and area distribution
 *
 * @param points         DTM point cloud
 * @param gridResolution Grid spacing in metres (auto-estimated if omitted)
 * @returns Complete slope analysis result
 *
 * @example
 * ```ts
 * const result = analyzeSlopeFromPoints(dtmPoints, 2.0);
 * }%`);
 * } m²`);
 * ```
 */
export function analyzeSlopeFromPoints(
  points: DTMPoint[],
  gridResolution?: number
): SlopeAnalysisResult {
  if (points.length < 3) {
    throw new Error('At least 3 DTM points are required for slope analysis.');
  }

  const resolution = gridResolution ?? autoGridResolution(points);
  const bbox = computeBoundingBox(points);

  // Build IDW grid
  const grid = buildIDWGrid(points, resolution, bbox);

  const rows = grid.length;
  const cols = grid[0].length;
  const cellArea = resolution * resolution;

  // Compute slope for each interior grid cell
  const slopePoints: SlopePoint[] = [];
  const allSlopePercents: number[] = [];
  const allSlopeDegrees: number[] = [];

  // Initialize distribution counters
  const distribution = {
    flat: 0,
    gentle: 0,
    moderate: 0,
    steep: 0,
    very_steep: 0,
    cliff: 0,
  };

  const areaByClass: Record<string, number> = {
    flat: 0,
    gentle: 0,
    moderate: 0,
    steep: 0,
    very_steep: 0,
    cliff: 0,
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      const { slopePercent, slopeDegrees, aspect } = computeSlopeAtCell(
        grid,
        r,
        c,
        resolution
      );

      const slopeClass = classifySlope(slopePercent);

      slopePoints.push({
        easting: cell.easting,
        northing: cell.northing,
        elevation: cell.elevation,
        slopePercent: roundTo(slopePercent, 4),
        slopeDegrees: roundTo(slopeDegrees, 4),
        aspect: roundTo(aspect, 2),
        slopeClass,
      });

      allSlopePercents.push(slopePercent);
      allSlopeDegrees.push(slopeDegrees);

      distribution[slopeClass]++;
      areaByClass[slopeClass] += cellArea;
    }
  }

  // Compute statistics
  const meanSlopePercent =
    allSlopePercents.reduce((a, b) => a + b, 0) / allSlopePercents.length;
  const maxSlopePercent = Math.max(...allSlopePercents);
  const minSlopePercent = Math.min(...allSlopePercents);
  const meanSlopeDegrees =
    allSlopeDegrees.reduce((a, b) => a + b, 0) / allSlopeDegrees.length;

  const totalArea = slopePoints.length * cellArea;

  return {
    slopePoints,
    statistics: {
      meanSlopePercent: roundTo(meanSlopePercent, 4),
      maxSlopePercent: roundTo(maxSlopePercent, 4),
      minSlopePercent: roundTo(minSlopePercent, 4),
      meanSlopeDegrees: roundTo(meanSlopeDegrees, 4),
      slopeDistribution: distribution,
      totalArea: roundTo(totalArea, 2),
      areaByClass: Object.fromEntries(
        Object.entries(areaByClass).map(([k, v]) => [k, roundTo(v, 2)])
      ),
    },
    boundingBox: bbox,
    gridResolution: resolution,
  };
}

// ─── Main: computeCutFillDatum ──────────────────────────────────────────────

/**
 * Compute cut and fill volumes relative to a horizontal datum plane.
 *
 * Workflow:
 *  1. Build an IDW grid from the DTM points
 *  2. For each grid cell: diff = existing_elevation − datum_RL, area = resolution²
 *  3. Cut volume = Σ(max(diff, 0) × area)   (where terrain is above datum)
 *  4. Fill volume = Σ(max(−diff, 0) × area)   (where terrain is below datum)
 *  5. Balance point: binary search for datum where cut ≈ fill (tolerance 0.001 m)
 *
 * @param points         DTM point cloud
 * @param datumRL        Design datum reduced level (metres)
 * @param gridResolution Grid spacing in metres (auto-estimated if omitted)
 * @returns Cut/fill volume result with per-cell detail
 *
 * @example
 * ```ts
 * const result = computeCutFillDatum(dtmPoints, 1250.0, 2.0);
 * } m³`);
 * } m³`);
 * } m`);
 * ```
 */
export function computeCutFillDatum(
  points: DTMPoint[],
  datumRL: number,
  gridResolution?: number
): CutFillDatumResult {
  if (points.length < 3) {
    throw new Error(
      'At least 3 DTM points are required for cut/fill computation.'
    );
  }

  const resolution = gridResolution ?? autoGridResolution(points);
  const bbox = computeBoundingBox(points);
  const grid = buildIDWGrid(points, resolution, bbox);

  const rows = grid.length;
  const cols = grid[0].length;
  const cellArea = resolution * resolution;

  let totalCut = 0;
  let totalFill = 0;
  let cutArea = 0;
  let fillArea = 0;

  const cellResults: CutFillDatumResult['points'] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      const existingRL = cell.elevation;
      const designRL = datumRL;
      const difference = existingRL - designRL; // positive = cut, negative = fill

      if (difference > 0) {
        totalCut += difference * cellArea;
        cutArea += cellArea;
      } else if (difference < 0) {
        totalFill += Math.abs(difference) * cellArea;
        fillArea += cellArea;
      }

      cellResults.push({
        easting: cell.easting,
        northing: cell.northing,
        existingRL: roundTo(existingRL, 4),
        designRL: roundTo(designRL, 4),
        difference: roundTo(difference, 4),
      });
    }
  }

  // Find balance point (datum RL where cut ≈ fill) via binary search
  const balancePoint = findBalancePoint(points, resolution);

  return {
    totalCutVolume: roundTo(totalCut, 3),
    totalFillVolume: roundTo(totalFill, 3),
    netVolume: roundTo(totalCut - totalFill, 3),
    cutArea: roundTo(cutArea, 2),
    fillArea: roundTo(fillArea, 2),
    balancePoint: roundTo(balancePoint, 3),
    points: cellResults,
  };
}

/**
 * Binary search for the datum RL where cut volume ≈ fill volume.
 *
 * Search range: from min elevation to max elevation of the point cloud.
 * Tolerance: 0.001 m on the datum, 0.01 m³ on volume difference.
 * Max iterations: 60 (sufficient for double precision convergence).
 */
function findBalancePoint(
  points: DTMPoint[],
  resolution: number
): number {
  // Determine search range from point elevations
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const p of points) {
    if (p.elevation < minElev) minElev = p.elevation;
    if (p.elevation > maxElev) maxElev = p.elevation;
  }

  // Add a small margin
  const margin = (maxElev - minElev) * 0.01;
  let low = minElev - margin;
  let high = maxElev + margin;

  const bbox = computeBoundingBox(points);

  for (let iter = 0; iter < 60; iter++) {
    const mid = (low + high) / 2;
    const { totalCutVolume, totalFillVolume } = quickCutFill(
      points,
      mid,
      resolution,
      bbox
    );

    const diff = totalCutVolume - totalFillVolume;

    if (Math.abs(diff) < 0.01) {
      return mid; // Balanced to within 0.01 m³
    }

    if (diff > 0) {
      // Too much cut → raise the datum
      low = mid;
    } else {
      // Too much fill → lower the datum
      high = mid;
    }

    // Convergence check on datum
    if (high - low < 0.001) {
      return (low + high) / 2;
    }
  }

  return (low + high) / 2;
}

/**
 * Fast cut/fill computation without storing per-cell results.
 * Used internally by the balance point binary search.
 */
function quickCutFill(
  points: DTMPoint[],
  datumRL: number,
  resolution: number,
  bbox: { minE: number; minN: number; maxE: number; maxN: number }
): { totalCutVolume: number; totalFillVolume: number } {
  const grid = buildIDWGrid(points, resolution, bbox);
  const rows = grid.length;
  const cols = grid[0].length;
  const cellArea = resolution * resolution;

  let cutVol = 0;
  let fillVol = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const diff = grid[r][c].elevation - datumRL;
      if (diff > 0) {
        cutVol += diff * cellArea;
      } else {
        fillVol += Math.abs(diff) * cellArea;
      }
    }
  }

  return { totalCutVolume: cutVol, totalFillVolume: fillVol };
}

// ─── Main: computeAreaBetweenPoints ─────────────────────────────────────────

/**
 * Compute the 2D plan area of a polygon defined by an ordered set of points
 * using the Shoelace formula (Gauss's area formula).
 *
 *   A = ½ |Σ(xᵢ · yᵢ₊₁ − xᵢ₊₁ · yᵢ)|
 *
 * Points must be ordered (clockwise or counter-clockwise). The polygon is
 * implicitly closed (last point connects to first).
 *
 * @param points  Ordered polygon vertices (at least 3)
 * @returns Area in square metres
 *
 * @example
 * ```ts
 * const area = computeAreaBetweenPoints([
 *   { easting: 100, northing: 100, elevation: 0 },
 *   { easting: 200, northing: 100, elevation: 0 },
 *   { easting: 200, northing: 200, elevation: 0 },
 *   { easting: 100, northing: 200, elevation: 0 },
 * ]);
 * // area = 10000 m²
 * ```
 */
export function computeAreaBetweenPoints(points: DTMPoint[]): number {
  if (points.length < 3) {
    return 0;
  }

  let sum = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i].easting * points[j].northing;
    sum -= points[j].easting * points[i].northing;
  }

  return Math.abs(sum) / 2;
}

// ─── Main: slopeAnalysisToCSV ───────────────────────────────────────────────

/**
 * Export slope analysis results to CSV string.
 *
 * Columns: Easting, Northing, Elevation, SlopePercent, SlopeDegrees,
 *          Aspect, SlopeClass
 *
 * Followed by a statistics summary section.
 *
 * @param result  Slope analysis result from `analyzeSlopeFromPoints`
 * @returns CSV-formatted string
 */
export function slopeAnalysisToCSV(result: SlopeAnalysisResult): string {
  const lines: string[] = [];

  // Header
  lines.push(
    'Easting,Northing,Elevation,SlopePercent,SlopeDegrees,Aspect,SlopeClass'
  );

  // Data rows
  for (const sp of result.slopePoints) {
    lines.push(
      [
        sp.easting.toFixed(4),
        sp.northing.toFixed(4),
        sp.elevation.toFixed(4),
        sp.slopePercent.toFixed(4),
        sp.slopeDegrees.toFixed(4),
        sp.aspect.toFixed(2),
        sp.slopeClass,
      ].join(',')
    );
  }

  // Blank separator
  lines.push('');

  // Summary header
  lines.push('SLOPE ANALYSIS SUMMARY');
  lines.push(`Grid Resolution,${result.gridResolution} m`);
  lines.push(
    `Bounding Box,${result.boundingBox.minE} ${result.boundingBox.minN} to ${result.boundingBox.maxE} ${result.boundingBox.maxN}`
  );
  lines.push('');
  lines.push('STATISTICS');
  lines.push(`Mean Slope Percent,${result.statistics.meanSlopePercent}`);
  lines.push(`Max Slope Percent,${result.statistics.maxSlopePercent}`);
  lines.push(`Min Slope Percent,${result.statistics.minSlopePercent}`);
  lines.push(`Mean Slope Degrees,${result.statistics.meanSlopeDegrees}`);
  lines.push(`Total Area (m²),${result.statistics.totalArea}`);
  lines.push('');

  // Distribution
  lines.push('SLOPE CLASS DISTRIBUTION');
  lines.push('Class,Count,Area (m²)');
  const dist = result.statistics.slopeDistribution;
  const areas = result.statistics.areaByClass;
  const classNames: Array<keyof typeof dist> = [
    'flat',
    'gentle',
    'moderate',
    'steep',
    'very_steep',
    'cliff',
  ];
  for (const cls of classNames) {
    lines.push(`${cls},${dist[cls]},${areas[cls]}`);
  }

  return lines.join('\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Round a number to a given number of decimal places.
 * Uses the "round half away from zero" method for consistency with survey practice.
 */
function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
