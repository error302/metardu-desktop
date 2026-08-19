/**
 * contour-generation.ts — Pure-TS contour line generation from point clouds.
 *
 * Takes an array of 3D survey points (easting, northing, elevation) and
 * produces chained contour polylines at a specified interval.
 *
 * Pipeline:
 *   1. Deduplicate input points
 *   2. Bowyer-Watson Delaunay triangulation (O(n log n))
 *   3. Marching triangles: for each contour elevation, find edge crossings
 *      in every triangle → produces disconnected line segments
 *   4. Segment chaining: connect segments that share endpoints → polylines
 *   5. Return as SurveyContour[] ready for SVG rendering
 *
 * Zero external dependencies — pure arithmetic + array operations.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface ContourInputPoint {
  easting: number;
  northing: number;
  elevation: number;
  label?: string;
}

export interface ContourLine {
  elevation: number;
  coordinates: [number, number][];
  closed: boolean;
}

export interface ContourResult {
  /** Generated contour lines grouped by elevation. */
  contours: ContourLine[];
  /** The Delaunay triangles (vertex indices). */
  triangles: [number, number, number][];
  /** Deduplicated vertices used for triangulation. */
  vertices: ContourInputPoint[];
  /** Computed elevation range. */
  minElevation: number;
  maxElevation: number;
}

export interface ContourOptions {
  /** Contour interval in metres (e.g. 0.5 for 50cm contours). Must be > 0. */
  interval: number;
  /**
   * Index contour interval multiplier. Every Nth contour is drawn thicker
   * and labeled. Default: 5 (e.g. for 0.5m interval → 2.5m index contours).
   */
  indexMultiplier?: number;
  /** Optional: minimum elevation (defaults to min of points). */
  minElevation?: number;
  /** Optional: maximum elevation (defaults to max of points). */
  maxElevation?: number;
  /** Maximum number of input points before decimation. Default: 2000. */
  maxPoints?: number;
}

// ─── Delaunay Triangulation (Bowyer-Watson) ──────────────────────

/**
 * Bowyer-Watson incremental Delaunay triangulation.
 * O(n log n) average case. Returns triangle indices into the vertex array.
 */
export function delaunayTriangulate(
  points: ContourInputPoint[],
): { vertices: ContourInputPoint[]; triangles: [number, number, number][] } {
  if (points.length < 3) {
    return { vertices: points, triangles: [] };
  }

  // Deduplicate by (easting, northing).
  const seen = new Set<string>();
  const unique: ContourInputPoint[] = [];
  for (const p of points) {
    const key = `${p.easting.toFixed(6)},${p.northing.toFixed(6)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  if (unique.length < 3) {
    return { vertices: unique, triangles: [] };
  }

  const n = unique.length;

  // Compute super-triangle that encloses all points.
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of unique) {
    if (p.easting < minX) minX = p.easting;
    if (p.easting > maxX) maxX = p.easting;
    if (p.northing < minY) minY = p.northing;
    if (p.northing > maxY) maxY = p.northing;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dmax = Math.max(dx, dy);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle vertices (indices n, n+1, n+2 — virtual, removed at end).
  const stA: ContourInputPoint = { easting: midX - 20 * dmax, northing: midY - dmax, elevation: 0 };
  const stB: ContourInputPoint = { easting: midX, northing: midY + 20 * dmax, elevation: 0 };
  const stC: ContourInputPoint = { easting: midX + 20 * dmax, northing: midY - dmax, elevation: 0 };

  const vertices = [...unique, stA, stB, stC];
  const stAIdx = n;
  const stBIdx = n + 1;
  const stCIdx = n + 2;

  // Active triangles: each is { v: [i, j, k], circumscribed circle: { cx, cy, r2 } }.
  interface Tri {
    v: [number, number, number];
    cx: number;
    cy: number;
    r2: number;
  }

  function circumcircleOf(ai: number, bi: number, ci: number): { cx: number; cy: number; r2: number } | null {
    const ax = vertices[ai]!.easting, ay = vertices[ai]!.northing;
    const bx = vertices[bi]!.easting, by = vertices[bi]!.northing;
    const cx = vertices[ci]!.easting, cy = vertices[ci]!.northing;

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-12) return null;

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const r2 = (ux - ax) ** 2 + (uy - ay) ** 2;

    return { cx: ux, cy: uy, r2 };
  }

  // Seed with the super-triangle.
  const superCC = circumcircleOf(stAIdx, stBIdx, stCIdx)!;
  let triangles: Tri[] = [{ v: [stAIdx, stBIdx, stCIdx], ...superCC }];

  // Insert each point.
  for (let pIdx = 0; pIdx < n; pIdx++) {
    const px = vertices[pIdx]!.easting;
    const py = vertices[pIdx]!.northing;

    // Find triangles whose circumcircle contains this point.
    const bad: number[] = [];
    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t]!;
      const dx = px - tri.cx;
      const dy = py - tri.cy;
      if (dx * dx + dy * dy < tri.r2 + 1e-9) {
        bad.push(t);
      }
    }

    // Collect boundary edges of the bad triangle polygon.
    // An edge is shared by two bad triangles → internal, not boundary.
    const edgeCount = new Map<string, number>();
    const edgeTri = new Map<string, [number, number, number]>();

    for (const tIdx of bad) {
      const tri = triangles[tIdx]!;
      const edges: [number, number][] = [
        [tri.v[0], tri.v[1]],
        [tri.v[1], tri.v[2]],
        [tri.v[2], tri.v[0]],
      ];
      for (const [a, b] of edges) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        edgeTri.set(key, tri.v);
      }
    }

    // Remove bad triangles (from highest index to preserve indices).
    bad.sort((a, b) => b - a);
    for (const tIdx of bad) {
      triangles.splice(tIdx, 1);
    }

    // Create new triangles from boundary edges to the new point.
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue; // shared edge — internal
      const [aStr, bStr] = key.split("-");
      const a = parseInt(aStr!, 10);
      const b = parseInt(bStr!, 10);

      const cc = circumcircleOf(a, b, pIdx);
      if (cc) {
        triangles.push({ v: [a, b, pIdx], ...cc });
      }
    }
  }

  // Remove triangles that reference super-triangle vertices.
  const result: [number, number, number][] = [];
  for (const tri of triangles) {
    if (tri.v[0] === stAIdx || tri.v[0] === stBIdx || tri.v[0] === stCIdx) continue;
    if (tri.v[1] === stAIdx || tri.v[1] === stBIdx || tri.v[1] === stCIdx) continue;
    if (tri.v[2] === stAIdx || tri.v[2] === stBIdx || tri.v[2] === stCIdx) continue;
    result.push([tri.v[0], tri.v[1], tri.v[2]]);
  }

  return { vertices: unique, triangles: result };
}

// ─── Marching Triangles: Segment Extraction ──────────────────────

/**
 * For a given contour elevation, walk every TIN triangle and extract
 * the line segment where the contour crosses the triangle.
 */
function marchingTriangles(
  vertices: ContourInputPoint[],
  triangles: [number, number, number][],
  elevation: number,
): Array<[[number, number], [number, number]]> {
  const segments: Array<[[number, number], [number, number]]> = [];

  for (const [ai, bi, ci] of triangles) {
    const a = vertices[ai]!;
    const b = vertices[bi]!;
    const c = vertices[ci]!;

    // Find which edges the contour crosses.
    const edges: [ContourInputPoint, ContourInputPoint][] = [
      [a, b],
      [b, c],
      [c, a],
    ];

    const crossings: [number, number][] = [];
    for (const [p1, p2] of edges) {
      const cross = interpolateEdge(p1, p2, elevation);
      if (cross) crossings.push(cross);
    }

    // A plane-triangle contour crosses either 0 or 2 edges (ignoring vertices).
    if (crossings.length >= 2) {
      segments.push([crossings[0]!, crossings[1]!]);
    }
  }

  return segments;
}

/** Interpolate crossing point on edge p1→p2 at the given elevation. */
function interpolateEdge(
  p1: ContourInputPoint,
  p2: ContourInputPoint,
  elevation: number,
): [number, number] | null {
  const e1 = p1.elevation;
  const e2 = p2.elevation;
  if ((e1 < elevation) === (e2 < elevation)) return null;
  if (Math.abs(e2 - e1) < 1e-12) return null;

  const t = (elevation - e1) / (e2 - e1);
  return [
    p1.easting + t * (p2.easting - p1.easting),
    p1.northing + t * (p2.northing - p1.northing),
  ];
}

// ─── Segment Chaining → Polylines ────────────────────────────────

/**
 * Chain disconnected line segments into continuous polylines.
 * Two segments share an endpoint if their coordinates are within `tol`.
 */
function chainSegments(
  segments: Array<[[number, number], [number, number]]>,
  tol = 1e-4,
): Array<{ coordinates: [number, number][]; closed: boolean }> {
  if (segments.length === 0) return [];

  // Build adjacency: endpoint → list of { segIndex, whichEnd }.
  const EPS = tol;
  const key = (p: [number, number]) => `${(p[0] / EPS).toFixed(0)},${(p[1] / EPS).toFixed(0)}`;

  const adj = new Map<string, Array<{ seg: number; end: 0 | 1 }>>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    for (const end of [0, 1] as const) {
      const k = key(seg[end]);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push({ seg: i, end });
    }
  }

  const used = new Set<number>();
  const polylines: Array<{ coordinates: [number, number][]; closed: boolean }> = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    // Start a new polyline from segment i.
    const coords: [number, number][] = [segments[i]![0], segments[i]![1]];

    // Extend forward from the end of the last point.
    let extending = true;
    while (extending) {
      extending = false;
      const lastPt = coords[coords.length - 1]!;
      const k = key(lastPt);
      const neighbors = adj.get(k);
      if (!neighbors) continue;

      for (const { seg, end } of neighbors) {
        if (used.has(seg)) continue;
        used.add(seg);
        // Connect: the other end of this segment is the next point.
        const nextPt = segments[seg]![end === 0 ? 1 : 0]!;
        coords.push(nextPt);
        extending = true;
        break;
      }
    }

    // Check if closed (first ≈ last).
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    const closed = Math.abs(first[0] - last[0]) < tol && Math.abs(first[1] - last[1]) < tol;

    polylines.push({ coordinates: coords, closed });
  }

  return polylines;
}

// ─── Grid Decimation ─────────────────────────────────────────────

/**
 * Grid-based point decimation that preserves terrain features.
 *
 * Strategy:
 *   1. Compute bounding box + grid cells (sqrt(targetCount) × sqrt(targetCount))
 *   2. Per cell: keep the most extreme elevation (peak or valley)
 *   3. Per cell: keep the point closest to each edge neighbor cell's
 *      extreme (preserves ridgelines and valley bottoms across cells)
 *   4. Always keep convex-hull boundary points (preserves the survey extent)
 *   5. If still over target, uniform sample the remainder
 *
 * This preserves:
 *   - Peaks and valleys (extreme elevation per cell)
 *   - Ridgelines and valley bottoms (cross-cell edge points)
 *   - Survey boundary (convex hull points)
 *   - Steep slopes (both min and max when range > threshold)
 */
function gridDecimate(
  points: ContourInputPoint[],
  targetCount: number,
): ContourInputPoint[] {
  if (points.length <= targetCount) return points;

  // Compute bounding box.
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.easting < minX) minX = p.easting;
    if (p.easting > maxX) maxX = p.easting;
    if (p.northing < minY) minY = p.northing;
    if (p.northing > maxY) maxY = p.northing;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Determine grid size: sqrt(targetCount) × sqrt(targetCount) ≈ targetCount cells.
  // Use 0.6 factor to leave room for boundary + edge points.
  const gridDim = Math.ceil(Math.sqrt(targetCount * 0.6));
  const cellW = rangeX / gridDim;
  const cellH = rangeY / gridDim;

  // Assign each point to a cell.
  const cells = new Map<string, ContourInputPoint[]>();
  for (const p of points) {
    const cx = Math.min(Math.floor((p.easting - minX) / cellW), gridDim - 1);
    const cy = Math.min(Math.floor((p.northing - minY) / cellH), gridDim - 1);
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(p);
  }

  // Identify convex-hull boundary points (keep all of them).
  const boundarySet = new Set<string>();
  if (points.length >= 3) {
    // Simple convex hull via gift-wrapping (O(n·h) — fine for our use case).
    const pts = points.map((p, i) => ({ ...p, idx: i }));
    pts.sort((a, b) => a.easting - b.easting || a.northing - b.northing);
    const hull: typeof pts = [];

    // Lower hull.
    for (const p of pts) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!;
        const b = hull[hull.length - 1]!;
        const cross = (b.easting - a.easting) * (p.northing - a.northing) -
                      (b.northing - a.northing) * (p.easting - a.easting);
        if (cross <= 0) { hull.pop(); } else break;
      }
      hull.push(p);
    }

    // Upper hull.
    const lowerLen = hull.length + 1;
    for (let i = pts.length - 2; i >= 0; i--) {
      const p = pts[i]!;
      while (hull.length >= lowerLen) {
        const a = hull[hull.length - 2]!;
        const b = hull[hull.length - 1]!;
        const cross = (b.easting - a.easting) * (p.northing - a.northing) -
                      (b.northing - a.northing) * (p.easting - a.easting);
        if (cross <= 0) { hull.pop(); } else break;
      }
      hull.push(p);
    }
    hull.pop(); // Remove duplicate start point.

    for (const p of hull) {
      boundarySet.add(`${points[p.idx]!.easting.toFixed(6)},${points[p.idx]!.northing.toFixed(6)}`);
    }
  }

  const ptKey = (p: ContourInputPoint) => `${p.easting.toFixed(6)},${p.northing.toFixed(6)}`;
  const isBoundary = (p: ContourInputPoint) => boundarySet.has(ptKey(p));

  // Collect selected points.
  const selected = new Map<string, ContourInputPoint>();
  const add = (p: ContourInputPoint) => {
    const k = ptKey(p);
    if (!selected.has(k)) selected.set(k, p);
  };

  // 1. Always keep boundary points.
  for (const p of points) {
    if (isBoundary(p)) add(p);
  }

  // 2. Per cell: keep extreme elevation points.
  for (const cellPoints of cells.values()) {
    if (cellPoints.length === 1) {
      add(cellPoints[0]!);
      continue;
    }

    // Find min and max elevation points.
    let minP = cellPoints[0]!;
    let maxP = cellPoints[0]!;
    for (const p of cellPoints) {
      if (p.elevation < minP.elevation) minP = p;
      if (p.elevation > maxP.elevation) maxP = p;
    }

    // Always keep the most extreme point.
    add(maxP.elevation >= minP.elevation ? maxP : minP);

    // If the cell has significant elevation range, keep both extremes
    // (preserves steep slopes and ridgelines).
    if (Math.abs(maxP.elevation - minP.elevation) > 0.5 && minP !== maxP) {
      add(minP);
    }
  }

  // 3. Per cell: keep the point closest to each neighboring cell's extreme
  //    (preserves ridgelines that cross cell boundaries).
  const cellKeys = [...cells.keys()];
  for (const key of cellKeys) {
    const [cx, cy] = key.split(",").map(Number);
    const cellPts = cells.get(key)!;

    // Check 4-connected neighbors.
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nk = `${cx! + dx},${cy! + dy}`;
      const neighborPts = cells.get(nk);
      if (!neighborPts || neighborPts.length === 0) continue;

      // Find neighbor's extreme point.
      let neighborExtreme = neighborPts[0]!;
      for (const p of neighborPts) {
        if (p.elevation > neighborExtreme.elevation) neighborExtreme = p;
      }

      // Find the point in this cell closest to the neighbor's extreme.
      let closest = cellPts[0]!;
      let closestDist = Infinity;
      for (const p of cellPts) {
        const d = (p.easting - neighborExtreme.easting) ** 2 +
                  (p.northing - neighborExtreme.northing) ** 2;
        if (d < closestDist) { closestDist = d; closest = p; }
      }
      add(closest);
    }
  }

  // 4. If still under target, fill with centroid of remaining points per cell.
  const result = [...selected.values()];
  if (result.length < targetCount * 0.9) {
    for (const cellPoints of cells.values()) {
      if (result.length >= targetCount) break;

      // Compute cell centroid.
      let sumE = 0, sumN = 0, sumH = 0;
      for (const p of cellPoints) {
        sumE += p.easting;
        sumN += p.northing;
        sumH += p.elevation;
      }
      const centroid: ContourInputPoint = {
        easting: sumE / cellPoints.length,
        northing: sumN / cellPoints.length,
        elevation: sumH / cellPoints.length,
      };
      add(centroid);
    }
  }

  const final = [...selected.values()];

  // 5. If still over target, uniform sample.
  if (final.length > targetCount) {
    const step = Math.ceil(final.length / targetCount);
    return final.filter((_, i) => i % step === 0);
  }

  return final;
}

// ─── Main Entry Point ────────────────────────────────────────────

/**
 * Generate contour lines from a point cloud.
 *
 * @param points - Survey points with easting, northing, and elevation.
 * @param options - Contour interval, index multiplier, elevation range.
 * @returns Chained contour polylines ready for SVG rendering.
 */
export function generateContours(
  points: ContourInputPoint[],
  options: ContourOptions,
): ContourResult {
  const { interval, indexMultiplier: _indexMultiplier = 5, maxPoints = 2000 } = options;

  if (interval <= 0) {
    throw new Error(`Contour interval must be positive; got ${interval}.`);
  }

  // Grid decimation: divide bounding box into cells, keep the point
  // with the most extreme elevation per cell (preserves ridges/valleys).
  let input = points;
  if (points.length > maxPoints) {
    input = gridDecimate(points, maxPoints);
  }

  // Triangulate.
  const { vertices, triangles } = delaunayTriangulate(input);

  if (triangles.length === 0) {
    return {
      contours: [],
      triangles,
      vertices,
      minElevation: 0,
      maxElevation: 0,
    };
  }

  // Compute elevation range.
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const v of vertices) {
    if (v.elevation < minElev) minElev = v.elevation;
    if (v.elevation > maxElev) maxElev = v.elevation;
  }

  const minElevation = options.minElevation ?? minElev;
  const maxElevation = options.maxElevation ?? maxElev;

  // Round to nearest interval boundaries.
  const startElev = Math.ceil(minElevation / interval) * interval;
  const endElev = Math.floor(maxElevation / interval) * interval;

  // Generate contours at each interval.
  const allContours: ContourLine[] = [];

  for (let elev = startElev; elev <= endElev + 1e-9; elev += interval) {
    // Snap to avoid floating-point drift.
    const snappedElev = Math.round(elev / interval) * interval;

    // Extract segments from marching triangles.
    const segments = marchingTriangles(vertices, triangles, snappedElev);

    if (segments.length === 0) continue;

    // Chain segments into polylines.
    const polylines = chainSegments(segments);

    for (const polyline of polylines) {
      allContours.push({
        elevation: snappedElev,
        coordinates: polyline.coordinates,
        closed: polyline.closed,
      });
    }
  }

  return {
    contours: allContours,
    triangles,
    vertices,
    minElevation,
    maxElevation,
  };
}

// ─── Contour Color Scale ─────────────────────────────────────────

/**
 * Map an elevation to a color from a survey-grade contour color ramp.
 * Index contours get a distinct darker shade.
 */
export function contourColor(
  elevation: number,
  indexElevations: Set<number>,
  minElev: number,
  maxElev: number,
): string {
  const isIndex = indexElevations.has(Math.round(elevation * 1000) / 1000);

  if (isIndex) {
    // Dark teal for index contours.
    return "#0d9488";
  }

  // Gradient from warm (low) to cool (high).
  const t = maxElev > minElev ? (elevation - minElev) / (maxElev - minElev) : 0.5;

  // HSL: hue shifts from 120 (green) at low to 200 (blue) at high.
  const hue = 120 + t * 80;
  const sat = 55 + (isIndex ? 15 : 0);
  const light = isIndex ? 35 : 50;

  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Compute which elevations are "index" contours (every Nth interval).
 */
export function computeIndexElevations(
  minElev: number,
  maxElev: number,
  interval: number,
  indexMultiplier: number,
): Set<number> {
  const indexInterval = interval * indexMultiplier;
  const start = Math.ceil(minElev / indexInterval) * indexInterval;
  const indices = new Set<number>();
  for (let e = start; e <= maxElev; e += indexInterval) {
    indices.add(Math.round(e * 1000) / 1000);
  }
  return indices;
}
