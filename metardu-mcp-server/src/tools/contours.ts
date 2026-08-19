import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Delaunay triangulation (Bowyer-Watson) ────────────────────

interface Point2D { x: number; y: number; elev: number; }
interface Triangle { a: number; b: number; c: number; }

function delaunay(points: Point2D[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];

  // Super triangle
  const minX = Math.min(...points.map((p) => p.x)) - 1;
  const minY = Math.min(...points.map((p) => p.y)) - 1;
  const maxX = Math.max(...points.map((p) => p.x)) + 1;
  const maxY = Math.max(...points.map((p) => p.y)) + 1;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dmax = Math.max(dx, dy);
  const midx = (minX + maxX) / 2;
  const midy = (minY + maxY) / 2;

  const superPts: Point2D[] = [
    { x: midx - 20 * dmax, y: midy - dmax, elev: 0 },
    { x: midx, y: midy + 20 * dmax, elev: 0 },
    { x: midx + 20 * dmax, y: midy - dmax, elev: 0 },
  ];
  const allPts = [...superPts, ...points];
  const superStart = 0;
  let triangles: Triangle[] = [{ a: superStart, b: superStart + 1, c: superStart + 2 }];

  for (let i = 0; i < n; i++) {
    const p = allPts[i + 3]!;
    const bad: number[] = [];
    for (let j = 0; j < triangles.length; j++) {
      const t = triangles[j]!;
      if (inCircumcircle(p, allPts[t.a]!, allPts[t.b]!, allPts[t.c]!)) {
        bad.push(j);
      }
    }
    const polygon: [number, number][] = [];
    for (const j of bad) {
      const t = triangles[j]!;
      const edges: [number, number][] = [
        [t.a, t.b], [t.b, t.c], [t.c, t.a],
      ];
      for (const e of edges) {
        let shared = false;
        for (const k of bad) {
          if (k === j) continue;
          const u = triangles[k]!;
          if (edgeInTriangle(e, u)) { shared = true; break; }
        }
        if (!shared) polygon.push(e);
      }
    }
    triangles = triangles.filter((_, j) => !bad.includes(j));
    for (const [ea, eb] of polygon) {
      triangles.push({ a: ea, b: eb, c: i + 3 });
    }
  }

  // Remove super triangle vertices
  return triangles.filter(
    (t) => t.a >= 3 && t.b >= 3 && t.c >= 3,
  ).map((t) => ({ a: t.a - 3, b: t.b - 3, c: t.c - 3 }));
}

function inCircumcircle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const ax = a.x - p.x, ay = a.y - p.y;
  const bx = b.x - p.x, by = b.y - p.y;
  const cx = c.x - p.x, cy = c.y - p.y;
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
    - (bx * bx + by * by) * (ax * cy - cx * ay)
    + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 0;
}

function edgeInTriangle(edge: [number, number], t: Triangle): boolean {
  const es = new Set(edge);
  return es.has(t.a) && es.has(t.b) || es.has(t.b) && es.has(t.c) || es.has(t.c) && es.has(t.a);
}

// ─── Marching triangles contour extraction ──────────────────────

interface ContourSegment { x1: number; y1: number; x2: number; y2: number; elev: number; }

function extractContours(points: Point2D[], triangles: Triangle[], interval: number): ContourSegment[] {
  if (interval <= 0 || points.length < 3) return [];
  const segments: ContourSegment[] = [];
  const minElev = Math.min(...points.map((p) => p.elev));
  const maxElev = Math.max(...points.map((p) => p.elev));
  const start = Math.ceil(minElev / interval) * interval;

  for (let e = start; e <= maxElev; e += interval) {
    for (const tri of triangles) {
      const pa = points[tri.a]!;
      const pb = points[tri.b]!;
      const pc = points[tri.c]!;
      const crossings: Point2D[] = [];
      const edges: [Point2D, Point2D][] = [[pa, pb], [pb, pc], [pc, pa]];
      for (const [p1, p2] of edges) {
        if ((p1.elev <= e && p2.elev > e) || (p2.elev <= e && p1.elev > e)) {
          const t = (e - p1.elev) / (p2.elev - p1.elev);
          crossings.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y), elev: e });
        }
      }
      if (crossings.length >= 2) {
        segments.push({ x1: crossings[0]!.x, y1: crossings[0]!.y, x2: crossings[1]!.x, y2: crossings[1]!.y, elev: e });
      }
    }
  }
  return segments;
}

// ─── Segment chaining into polylines ────────────────────────────

function chainSegments(segments: ContourSegment[]): Array<{ elev: number; coords: [number, number][] }> {
  if (segments.length === 0) return [];
  const tol = 0.001;
  const used = new Set<number>();
  const result: Array<{ elev: number; coords: [number, number][] }> = [];

  function close(a: number, b: number): boolean {
    return Math.abs(a - b) < tol;
  }

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const seg = segments[i]!;
    let chain: [number, number][] = [[seg.x1, seg.y1], [seg.x2, seg.y2]];

    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const s = segments[j]!;
        const head = chain[0]!;
        const tail = chain[chain.length - 1]!;
        if (close(s.x1, tail[0]) && close(s.y1, tail[1])) {
          chain.push([s.x2, s.y2]); used.add(j); changed = true;
        } else if (close(s.x2, tail[0]) && close(s.y2, tail[1])) {
          chain.push([s.x1, s.y1]); used.add(j); changed = true;
        } else if (close(s.x2, head[0]) && close(s.y2, head[1])) {
          chain.unshift([s.x1, s.y1]); used.add(j); changed = true;
        } else if (close(s.x1, head[0]) && close(s.y1, head[1])) {
          chain.unshift([s.x2, s.y2]); used.add(j); changed = true;
        }
      }
    }
    result.push({ elev: seg.elev, coords: chain });
  }
  return result;
}

// ─── Tool registration ──────────────────────────────────────────

export function registerContourTools(server: McpServer): void {
  server.registerTool(
    "metardu_contour_generate",
    {
      title: "Generate Contours from Points",
      description:
        "Generate contour lines from a point cloud using Delaunay triangulation and marching triangles. " +
        "Returns contour polylines with elevation values, suitable for visualization or export.",
      inputSchema: {
        points: z
          .array(
            z.object({
              easting: z.number().describe("Point easting (m)"),
              northing: z.number().describe("Point northing (m)"),
              elevation: z.number().describe("Point elevation (m)"),
              label: z.string().optional(),
            }),
          )
          .min(3)
          .max(5000)
          .describe("Input point cloud (3–5000 points)"),
        interval: z.number().positive().default(1.0).describe("Contour interval in metres"),
        index_interval: z.number().positive().optional().describe("Index contour interval (default: 5× interval)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ points, interval, index_interval }) => {
      const idxInterval = index_interval ?? interval * 5;
      const pts: Point2D[] = points.map((p) => ({ x: p.easting, y: p.northing, elev: p.elevation }));
      const tris = delaunay(pts);
      const segments = extractContours(pts, tris, interval);
      const polylines = chainSegments(segments);

      const contours = polylines.map((pl) => ({
        elevation: round2(pl.elev),
        is_index: Math.abs(pl.elev % idxInterval) < 0.001,
        vertex_count: pl.coords.length,
        coords: pl.coords.map(([x, y]) => [round4(x), round4(y)]),
      }));

      const elevations = [...new Set(contours.map((c) => c.elevation))].sort((a, b) => a - b);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              contour_interval: interval,
              index_interval: idxInterval,
              total_polylines: contours.length,
              elevation_range: elevations.length > 0 ? { min: elevations[0], max: elevations[elevations.length - 1] } : null,
              unique_elevations: elevations.length,
              triangles: tris.length,
              contours,
            }),
          },
        ],
      };
    },
  );
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
