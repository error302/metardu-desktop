/**
 * LiDAR point cloud classification — DSM → DTM ground extraction.
 *
 * Inspired by the LinkedIn post showing GIS + Remote Sensing + LiDAR
 * point cloud classification. This module implements a progressive
 * morphological filter (PMF) to classify LiDAR points as:
 *
 *   - Ground (bare earth) → used to generate DTM
 *   - Vegetation → removed for DTM
 *   - Buildings → removed for DTM
 *   - Noise → discarded
 *
 * # Algorithm: Progressive Morphological Filter (PMF)
 *
 * Based on Zhang et al. (2003), "A progressive morphological filter
 * for removing nonground measurements from airborne LIDAR data."
 * The method:
 *
 *   1. Organize points into a regular grid (rasterization)
 *   2. Iteratively apply morphological OPENING with increasing
 *      window sizes
 *   3. Compare the filtered surface to the original — points that
 *      deviate more than a threshold are classified as non-ground
 *   4. The threshold increases with elevation difference (to handle
 *      slopes) and the window size increases with each iteration
 *      (to handle large buildings)
 *
 * # Performance
 *
 * Pure TypeScript implementation — suitable for up to ~100K points.
 * For millions of points, the Rust sidecar's `import/` module should
 * be used (future enhancement). The grid-based approach is O(n) in
 * the number of grid cells, which is much smaller than O(n²) for
 * point-to-point methods.
 *
 * # References
 *
 *   - Zhang, K. et al. (2003), "A progressive morphological filter
 *     for removing nonground measurements from airborne LIDAR data"
 *   - Axelsson, P. (2000), "DEM generation from laser scanner data
 *     using adaptive TIN models"
 *   - ArcGIS Pro LiDAR classification documentation
 *   - PDAL (Point Data Abstraction Library) documentation
 */

// ─── Types ───────────────────────────────────────────────────────

/** A single LiDAR point. */
export interface LidarPoint {
  easting: number;
  northing: number;
  elevation: number;
  /** Intensity return (0-65535, optional). */
  intensity?: number;
  /** Return number (1=first, 2=second, etc.). */
  returnNumber?: number;
  /** Number of returns for this pulse. */
  numberOfReturns?: number;
  /** Classification (assigned by this module). */
  classification?: LidarClass;
}

/** LiDAR point classification. */
export type LidarClass =
  | "ground"       // Class 2 — bare earth
  | "vegetation"   // Class 3-5 — low/medium/high vegetation
  | "building"     // Class 6 — building roof
  | "noise"        // Class 7 — noise/outlier
  | "unclassified" // Class 1 — not yet classified
  ;

/** Classification result. */
export interface ClassificationResult {
  /** Classified points. */
  points: LidarPoint[];
  /** Number of points in each class. */
  counts: Record<LidarClass, number>;
  /** Generated DTM (ground-only grid). */
  dtm: GridSurface;
  /** Generated DSM (all-points grid). */
  dsm: GridSurface;
  /** Processing time (ms). */
  processingTimeMs: number;
  /** Warnings. */
  warnings: string[];
  /**
   * Per-point uncertainty for LiDAR points, keyed by index (as string).
   */
  pointUncertainty: Record<string, PointUncertainty>;
}

/** A regular grid surface (rasterized elevation model). */
export interface GridSurface {
  /** Grid cell size (metres). */
  cellSize: number;
  /** Origin (min easting, min northing). */
  origin: { easting: number; northing: number };
  /** Number of columns. */
  ncols: number;
  /** Number of rows. */
  nrows: number;
  /** Elevation values (row-major, NaN = no data). */
  elevations: Float64Array;
  /** Classification per cell (for DTM = ground only). */
  nodata: number;
}

/** Classification parameters. */
export interface ClassificationParams {
  /** Grid cell size in metres (default 1.0). */
  cellSize?: number;
  /** Maximum window size for morphological filter (metres, default 20). */
  maxWindowSize?: number;
  /** Initial elevation threshold (metres, default 0.5). */
  initialThreshold?: number;
  /** Maximum elevation threshold (metres, default 5.0). */
  maxThreshold?: number;
  /** Slope parameter for threshold adaptation (default 0.15). */
  slope?: number;
  /** Minimum building area (grid cells, default 10). */
  minBuildingArea?: number;
}

// ─── Main entry point ────────────────────────────────────────────

/**
 * Classify a LiDAR point cloud into ground, vegetation, buildings,
 * and noise using a Progressive Morphological Filter.
 *
 * @param points Raw LiDAR points
 * @param params Classification parameters
 * @returns Classification result with DTM + DSM
 */
export function classifyLidarPoints(
  points: LidarPoint[],
  params: ClassificationParams = {},
): ClassificationResult {
  const startTime = Date.now();
  const warnings: string[] = [];

  const cellSize = params.cellSize ?? 1.0;
  const maxWindow = params.maxWindowSize ?? 20.0;
  const initThreshold = params.initialThreshold ?? 0.5;
  const maxThreshold = params.maxThreshold ?? 5.0;
  const slope = params.slope ?? 0.15;
  const minBuildingArea = params.minBuildingArea ?? 10;

  if (points.length === 0) {
    throw new Error("No points to classify.");
  }
  if (points.length > 200_000) {
    warnings.push(`Large point cloud (${points.length} points). Performance may be degraded. Consider using the Rust sidecar for > 200K points.`);
  }

  // Step 1: Compute bounds.
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }

  const ncols = Math.ceil((maxE - minE) / cellSize) + 1;
  const nrows = Math.ceil((maxN - minN) / cellSize) + 1;
  const origin = { easting: minE, northing: minN };

  // Step 2: Rasterize into DSM (take minimum Z in each cell for PMF).
  // We use minimum Z (not mean) because ground points have the lowest Z.
  const dsmElevations = new Float64Array(ncols * nrows);
  const dsmCounts = new Int32Array(ncols * nrows);
  dsmElevations.fill(NaN);

  for (const p of points) {
    const col = Math.floor((p.easting - minE) / cellSize);
    const row = Math.floor((p.northing - minN) / cellSize);
    if (col < 0 || col >= ncols || row < 0 || row >= nrows) continue;
    const idx = row * ncols + col;
    const cur = dsmElevations[idx] ?? NaN;
    if (isNaN(cur) || p.elevation < cur) {
      dsmElevations[idx] = p.elevation;
    }
    dsmCounts[idx] = (dsmCounts[idx] ?? 0) + 1;
  }

  // Fill NaN cells with interpolated values (simple nearest-neighbor).
  fillNaNCells(dsmElevations, ncols, nrows);

  // Step 3: Progressive Morphological Filter.
  // Iteratively apply morphological opening with increasing window sizes.
  let filtered = new Float64Array(dsmElevations);
  const isGround = new Uint8Array(ncols * nrows).fill(1); // 1 = ground, 0 = non-ground

  const maxIter = Math.ceil(Math.log2(maxWindow / cellSize));
  for (let iter = 0; iter < maxIter; iter++) {
    const windowSize = cellSize * Math.pow(2, iter + 1);
    const windowCells = Math.max(1, Math.round(windowSize / cellSize));

    // Morphological opening = erosion followed by dilation.
    const eroded = morphologicalErosion(filtered, ncols, nrows, windowCells);
    const opened = morphologicalDilation(eroded, ncols, nrows, windowCells);

    // Compute elevation difference threshold (increases with slope).
    const threshold = Math.min(
      initThreshold + slope * windowSize,
      maxThreshold,
    );

    // Classify cells: if the difference exceeds the threshold, it's non-ground.
    for (let i = 0; i < ncols * nrows; i++) {
      if (!isGround[i]) continue;
      const diff = dsmElevations[i]! - opened[i]!;
      if (diff > threshold) {
        isGround[i] = 0; // non-ground
        filtered[i] = opened[i]!; // replace with filtered surface
      }
    }
  }

  // Step 4: Classify individual points.
  const counts: Record<LidarClass, number> = {
    ground: 0, vegetation: 0, building: 0, noise: 0, unclassified: 0,
  };

  // Identify buildings: non-ground cells that form large connected areas.
  const isBuilding = identifyBuildings(isGround, ncols, nrows, minBuildingArea);

  for (const p of points) {
    const col = Math.floor((p.easting - minE) / cellSize);
    const row = Math.floor((p.northing - minN) / cellSize);
    if (col < 0 || col >= ncols || row < 0 || row >= nrows) {
      p.classification = "noise";
      counts.noise++;
      continue;
    }

    const idx = row * ncols + col;
    const groundElev: number = filtered[idx] ?? NaN;

    if (isNaN(groundElev)) {
      p.classification = "unclassified";
      counts.unclassified++;
      continue;
    }

    const heightAboveGround = p.elevation - groundElev;

    if (isGround[idx!]) {
      // Ground point — but check for noise (too far below ground).
      if (heightAboveGround < -2.0) {
        p.classification = "noise";
        counts.noise++;
      } else {
        p.classification = "ground";
        counts.ground++;
      }
    } else if (isBuilding[idx!]) {
      p.classification = "building";
      counts.building++;
    } else if (heightAboveGround > 0.5) {
      // Above ground and not a building → vegetation.
      p.classification = "vegetation";
      counts.vegetation++;
    } else {
      // Low non-ground → could be ground that was missed.
      p.classification = "ground";
      counts.ground++;
    }
  }

  // Step 5: Generate DTM (ground-only surface).
  const dtmElevations = new Float64Array(ncols * nrows);
  dtmElevations.fill(NaN);
  for (let i = 0; i < ncols * nrows; i++) {
    if (isGround[i]) {
      dtmElevations[i] = filtered[i]!;
    }
  }
  fillNaNCells(dtmElevations, ncols, nrows);

  const dtm: GridSurface = {
    cellSize, origin, ncols, nrows,
    elevations: dtmElevations,
    nodata: NaN,
  };

  const dsm: GridSurface = {
    cellSize, origin, ncols, nrows,
    elevations: dsmElevations,
    nodata: NaN,
  };

  return {
    points,
    counts,
    dtm,
    dsm,
    processingTimeMs: Date.now() - startTime,
    warnings,
    pointUncertainty: {},
  };
}

// ─── Morphological operations ────────────────────────────────────

/** Morphological erosion: each cell takes the minimum of its neighborhood. */
function morphologicalErosion(
  elevations: Float64Array,
  ncols: number,
  nrows: number,
  windowCells: number,
): Float64Array {
  const result = new Float64Array(ncols * nrows);
  const halfWin = Math.floor(windowCells / 2);

  for (let row = 0; row < nrows; row++) {
    for (let col = 0; col < ncols; col++) {
      let minVal = Infinity;
      for (let dr = -halfWin; dr <= halfWin; dr++) {
        for (let dc = -halfWin; dc <= halfWin; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= nrows || c < 0 || c >= ncols) continue;
          const val = elevations[r * ncols + c]!;
          if (!isNaN(val) && val < minVal) minVal = val;
        }
      }
      result[row * ncols + col] = minVal === Infinity ? NaN : minVal;
    }
  }
  return result;
}

/** Morphological dilation: each cell takes the maximum of its neighborhood. */
function morphologicalDilation(
  elevations: Float64Array,
  ncols: number,
  nrows: number,
  windowCells: number,
): Float64Array {
  const result = new Float64Array(ncols * nrows);
  const halfWin = Math.floor(windowCells / 2);

  for (let row = 0; row < nrows; row++) {
    for (let col = 0; col < ncols; col++) {
      let maxVal = -Infinity;
      for (let dr = -halfWin; dr <= halfWin; dr++) {
        for (let dc = -halfWin; dc <= halfWin; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= nrows || c < 0 || c >= ncols) continue;
          const val = elevations[r * ncols + c]!;
          if (!isNaN(val) && val > maxVal) maxVal = val;
        }
      }
      result[row * ncols + col] = maxVal === -Infinity ? NaN : maxVal;
    }
  }
  return result;
}

// ─── Building identification ─────────────────────────────────────

/**
 * Identify buildings: non-ground cells that form connected areas
 * larger than minBuildingArea.
 *
 * Uses a simple flood-fill algorithm to find connected components.
 */
function identifyBuildings(
  isGround: Uint8Array,
  ncols: number,
  nrows: number,
  minBuildingArea: number,
): Uint8Array {
  const isBuilding = new Uint8Array(ncols * nrows);
  const visited = new Uint8Array(ncols * nrows);

  for (let row = 0; row < nrows; row++) {
    for (let col = 0; col < ncols; col++) {
      const idx = row * ncols + col;
      if (visited[idx!] || isGround[idx!]) continue;

      // Flood fill from this non-ground cell.
      const component: number[] = [];
      const queue: number[] = [idx!];
      visited[idx!] = 1;

      while (queue.length > 0) {
        const cellIdx = queue.shift()!;
        component.push(cellIdx);
        const cellRow = Math.floor(cellIdx / ncols);
        const cellCol = cellIdx % ncols;

        // Check 4 neighbors.
        const neighbors = [
          cellRow > 0 ? (cellRow - 1) * ncols + cellCol : -1,
          cellRow < nrows - 1 ? (cellRow + 1) * ncols + cellCol : -1,
          cellCol > 0 ? cellRow * ncols + (cellCol - 1) : -1,
          cellCol < ncols - 1 ? cellRow * ncols + (cellCol + 1) : -1,
        ];

        for (const nIdx of neighbors) {
          if (nIdx < 0 || visited[nIdx] || isGround[nIdx]) continue;
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }

      // If the component is large enough, mark as building.
      if (component.length >= minBuildingArea) {
        for (const cellIdx of component) {
          isBuilding[cellIdx] = 1;
        }
      }
    }
  }

  return isBuilding;
}

// ─── NaN fill ────────────────────────────────────────────────────

/** Fill NaN cells with the average of their non-NaN neighbors. */
function fillNaNCells(elevations: Float64Array, ncols: number, nrows: number): void {
  for (let pass = 0; pass < 3; pass++) {
    for (let row = 0; row < nrows; row++) {
      for (let col = 0; col < ncols; col++) {
        const idx = row * ncols + col;
        if (!isNaN(elevations[idx]!)) continue;

        // Average of 4 neighbors.
        let sum = 0, count = 0;
        const neighbors = [
          row > 0 ? (row - 1) * ncols + col : -1,
          row < nrows - 1 ? (row + 1) * ncols + col : -1,
          col > 0 ? row * ncols + (col - 1) : -1,
          col < ncols - 1 ? row * ncols + (col + 1) : -1,
        ];
        for (const nIdx of neighbors) {
          if (nIdx >= 0 && nIdx < elevations.length && !isNaN(elevations[nIdx]!)) {
            sum += elevations[nIdx]!
            count++;
          }
        }
        if (count > 0) {
          elevations[idx] = sum / count;
        }
      }
    }
  }
}

// ─── Grid surface helpers ────────────────────────────────────────

/**
 * Sample an elevation from a GridSurface at a given (easting, northing).
 * Uses bilinear interpolation.
 */
export function sampleGridElevation(
  grid: GridSurface,
  easting: number,
  northing: number,
): number {
  const col = (easting - grid.origin.easting) / grid.cellSize;
  const row = (northing - grid.origin.northing) / grid.cellSize;

  if (col < 0 || col >= grid.ncols - 1 || row < 0 || row >= grid.nrows - 1) {
    return grid.nodata;
  }

  const col0 = Math.floor(col);
  const row0 = Math.floor(row);
  const dCol = col - col0;
  const dRow = row - row0;

  const idx00 = row0 * grid.ncols + col0;
  const idx01 = row0 * grid.ncols + (col0 + 1);
  const idx10 = (row0 + 1) * grid.ncols + col0;
  const idx11 = (row0 + 1) * grid.ncols + (col0 + 1);

  const v00 = grid.elevations[idx00]!;
  const v01 = grid.elevations[idx01]!;
  const v10 = grid.elevations[idx10]!;
  const v11 = grid.elevations[idx11]!;

  if (isNaN(v00) || isNaN(v01) || isNaN(v10) || isNaN(v11)) return grid.nodata;

  // Bilinear interpolation.
  const v0 = v00 * (1 - dCol) + v01 * dCol;
  const v1 = v10 * (1 - dCol) + v11 * dCol;
  return v0 * (1 - dRow) + v1 * dRow;
}

/**
 * Generate contour lines from a GridSurface.
 * Uses the marching squares algorithm.
 */
export function generateContoursFromGrid(
  grid: GridSurface,
  interval: number,
): { elevation: number; coordinates: [number, number][] }[] {
  const contours: { elevation: number; coordinates: [number, number][] }[] = [];

  // Find min/max elevation.
  let minElev = Infinity, maxElev = -Infinity;
  for (const e of grid.elevations) {
    if (!isNaN(e)) {
      if (e < minElev) minElev = e;
      if (e > maxElev) maxElev = e;
    }
  }
  if (minElev === Infinity) return contours;

  // Generate contours at each interval.
  for (let elev = Math.ceil(minElev / interval) * interval; elev <= maxElev; elev += interval) {
    const segments: [number, number][][] = [];

    for (let row = 0; row < grid.nrows - 1; row++) {
      for (let col = 0; col < grid.ncols - 1; col++) {
        const tl = grid.elevations[row * grid.ncols + col] ?? NaN;
        const tr = grid.elevations[row * grid.ncols + (col + 1)]!;
        const br = grid.elevations[(row + 1) * grid.ncols + (col + 1)]!;
        const bl = grid.elevations[(row + 1) * grid.ncols + col]!;

        if (isNaN(tl) || isNaN(tr) || isNaN(br) || isNaN(bl)) continue;

        // Marching squares case.
        const caseVal =
          (tl >= elev ? 1 : 0) |
          (tr >= elev ? 2 : 0) |
          (br >= elev ? 4 : 0) |
          (bl >= elev ? 8 : 0);

        if (caseVal === 0 || caseVal === 15) continue;

        const x0 = grid.origin.easting + col * grid.cellSize;
        const x1 = grid.origin.easting + (col + 1) * grid.cellSize;
        const y0 = grid.origin.northing + row * grid.cellSize;
        const y1 = grid.origin.northing + (row + 1) * grid.cellSize;

        // Interpolate edge crossings.
        const interp = (v1: number, v2: number, xa: number, ya: number, xb: number, yb: number): [number, number] => {
          const t = (elev - v1) / (v2 - v1);
          return [xa + t * (xb - xa), ya + t * (yb - ya)];
        };

        const top = () => interp(tl, tr, x0, y0, x1, y0);
        const right = () => interp(tr, br, x1, y0, x1, y1);
        const bottom = () => interp(bl, br, x0, y1, x1, y1);
        const left = () => interp(tl, bl, x0, y0, x0, y1);

        switch (caseVal) {
          case 1: case 14: segments.push([left(), bottom()]); break;
          case 2: case 13: segments.push([top(), right()]); break;
          case 3: case 12: segments.push([left(), right()]); break;
          case 4: case 11: segments.push([right(), bottom()]); break;
          case 5: segments.push([top(), right()]); segments.push([left(), bottom()]); break;
          case 6: case 9: segments.push([top(), bottom()]); break;
          case 7: case 8: segments.push([left(), bottom()]); break;
          case 10: segments.push([top(), left()]); segments.push([right(), bottom()]); break;
        }
      }
    }

    // Flatten segments into a coordinates array.
    const coordinates: [number, number][] = [];
    for (const seg of segments) {
      coordinates.push(seg[0]!);
      coordinates.push(seg[1]!);
    }

    if (coordinates.length > 0) {
      contours.push({ elevation: elev, coordinates });
    }
  }

  return contours;
}
