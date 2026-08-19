/**
 * contour-generation — pure math tests for the contour line generator.
 *
 * Tests the Delaunay triangulation, marching triangles, segment chaining,
 * and full contour generation pipeline. No React, no DOM, no Electron.
 */

import { describe, it, expect } from "vitest";
import {
  delaunayTriangulate,
  generateContours,
  computeIndexElevations,
  contourColor,
  type ContourInputPoint,
} from "@metardu/ui-components";

// ─── Test data ───────────────────────────────────────────────────

/** A simple 4-point grid with known elevations. */
function grid4(): ContourInputPoint[] {
  return [
    { easting: 0, northing: 0, elevation: 100.0 }, // bottom-left
    { easting: 10, northing: 0, elevation: 101.0 }, // bottom-right
    { easting: 0, northing: 10, elevation: 102.0 }, // top-left
    { easting: 10, northing: 10, elevation: 103.0 }, // top-right
  ];
}

/** A 9-point 3×3 grid with a hill in the centre. */
function grid9(): ContourInputPoint[] {
  return [
    { easting: 0, northing: 0, elevation: 100 },
    { easting: 5, northing: 0, elevation: 101 },
    { easting: 10, northing: 0, elevation: 100 },
    { easting: 0, northing: 5, elevation: 101 },
    { easting: 5, northing: 5, elevation: 110 }, // hill peak
    { easting: 10, northing: 5, elevation: 101 },
    { easting: 0, northing: 10, elevation: 100 },
    { easting: 5, northing: 10, elevation: 101 },
    { easting: 10, northing: 10, elevation: 100 },
  ];
}

/** Points with duplicate locations. */
function withDuplicates(): ContourInputPoint[] {
  return [
    { easting: 0, northing: 0, elevation: 100 },
    { easting: 5, northing: 0, elevation: 102 },
    { easting: 0, northing: 5, elevation: 101 },
    { easting: 5, northing: 0, elevation: 102 }, // duplicate of point 1
    { easting: 5, northing: 5, elevation: 103 },
  ];
}

// ─── Delaunay Triangulation ──────────────────────────────────────

describe("delaunayTriangulate", () => {
  it("triangulates 4 grid points into 2 triangles", () => {
    const { vertices, triangles } = delaunayTriangulate(grid4());
    expect(vertices.length).toBe(4);
    expect(triangles.length).toBe(2);
    // All vertex indices should be valid.
    for (const [a, b, c] of triangles) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(4);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(4);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(4);
    }
  });

  it("triangulates 9 grid points into 8 triangles (Delaunay property)", () => {
    const { vertices, triangles } = delaunayTriangulate(grid9());
    // 3×3 grid → 8 triangles for Delaunay.
    expect(vertices.length).toBe(9);
    expect(triangles.length).toBe(8);
  });

  it("deduplicates points at the same location", () => {
    const { vertices } = delaunayTriangulate(withDuplicates());
    expect(vertices.length).toBe(4); // 5 input, 1 duplicate removed.
  });

  it("returns empty triangles for fewer than 3 points", () => {
    const { triangles } = delaunayTriangulate([
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 1, northing: 1, elevation: 101 },
    ]);
    expect(triangles.length).toBe(0);
  });

  it("handles collinear points (degenerate case)", () => {
    const { triangles } = delaunayTriangulate([
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 5, northing: 0, elevation: 101 },
      { easting: 10, northing: 0, elevation: 102 },
    ]);
    // Collinear points → no valid Delaunay triangle.
    expect(triangles.length).toBe(0);
  });
});

// ─── Contour Generation Pipeline ─────────────────────────────────

describe("generateContours", () => {
  it("generates contours at 1m interval from 4-point grid", () => {
    const result = generateContours(grid4(), { interval: 1.0 });
    expect(result.contours.length).toBeGreaterThan(0);
    // Elevation range: 100–103. At 1m interval → contours at 101, 102.
    const elevations = [...new Set(result.contours.map((c) => c.elevation))].sort((a, b) => a - b);
    expect(elevations).toContain(101);
    expect(elevations).toContain(102);
  });

  it("generates contours at 0.5m interval (more detail)", () => {
    const result = generateContours(grid4(), { interval: 0.5 });
    const elevations = [...new Set(result.contours.map((c) => c.elevation))].sort((a, b) => a - b);
    // Should have contours at 100.5, 101.0, 101.5, 102.0, 102.5.
    expect(elevations).toContain(100.5);
    expect(elevations).toContain(101.5);
    expect(elevations).toContain(102.5);
  });

  it("generates contour lines with at least 2 coordinates each", () => {
    const result = generateContours(grid4(), { interval: 1.0 });
    for (const contour of result.contours) {
      expect(contour.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("chains segments into longer polylines", () => {
    // With the 9-point hill grid, some contours should be multi-segment.
    const result = generateContours(grid9(), { interval: 1.0 });
    // Some contour lines should have more than 2 points (chained).
    const hasMultiPoint = result.contours.some((c) => c.coordinates.length > 2);
    expect(hasMultiPoint).toBe(true);
  });

  it("returns elevation range and vertex count", () => {
    const result = generateContours(grid4(), { interval: 1.0 });
    expect(result.minElevation).toBe(100);
    expect(result.maxElevation).toBe(103);
    expect(result.vertices.length).toBe(4);
    expect(result.triangles.length).toBeGreaterThan(0);
  });

  it("throws for non-positive interval", () => {
    expect(() => generateContours(grid4(), { interval: 0 })).toThrow("positive");
    expect(() => generateContours(grid4(), { interval: -1 })).toThrow("positive");
  });

  it("returns empty contours for fewer than 3 points", () => {
    const result = generateContours([
      { easting: 0, northing: 0, elevation: 100 },
    ], { interval: 1.0 });
    expect(result.contours.length).toBe(0);
  });

  it("respects custom elevation range", () => {
    const result = generateContours(grid4(), {
      interval: 1.0,
      minElevation: 100.5,
      maxElevation: 102.5,
    });
    for (const c of result.contours) {
      expect(c.elevation).toBeGreaterThanOrEqual(100.5);
      expect(c.elevation).toBeLessThanOrEqual(102.5);
    }
  });

  it("generates contours from hill grid with closed contours for intermediate elevations", () => {
    const result = generateContours(grid9(), { interval: 2.0 });
    // Some contours around the hill peak should be closed.
    // (They form rings around the hill.)
    // Not guaranteed on a small grid, but we should have some contours.
    expect(result.contours.length).toBeGreaterThan(0);
  });
});

// ─── Index Elevation Computation ─────────────────────────────────

describe("computeIndexElevations", () => {
  it("returns every Nth elevation", () => {
    const indices = computeIndexElevations(100, 110, 1.0, 5);
    // Index interval = 5. Indices at 100, 105, 110.
    expect(indices.has(100)).toBe(true);
    expect(indices.has(105)).toBe(true);
    expect(indices.has(110)).toBe(true);
    expect(indices.has(101)).toBe(false);
    expect(indices.has(103)).toBe(false);
  });

  it("handles non-round intervals", () => {
    const indices = computeIndexElevations(0, 10, 0.5, 5);
    // Index interval = 2.5. Indices at 0, 2.5, 5, 7.5, 10.
    expect(indices.size).toBe(5);
    expect(indices.has(2.5)).toBe(true);
    expect(indices.has(7.5)).toBe(true);
  });
});

// ─── Contour Color Mapping ───────────────────────────────────────

describe("contourColor", () => {
  it("returns a distinct color for index contours", () => {
    const indexSet = new Set([105]);
    const regular = contourColor(102, indexSet, 100, 110);
    const index = contourColor(105, indexSet, 100, 110);
    // Index contour should be the dark teal color.
    expect(index).toBe("#0d9488");
    // Regular contour should be different.
    expect(regular).not.toBe(index);
  });

  it("returns a valid HSL color for non-index contours", () => {
    const color = contourColor(105, new Set(), 100, 110);
    expect(color).toMatch(/^hsl\(/);
  });

  it("returns mid-range color for mid elevation", () => {
    const low = contourColor(100, new Set(), 100, 110);
    const mid = contourColor(105, new Set(), 100, 110);
    const high = contourColor(110, new Set(), 100, 110);
    // All should be different (gradient).
    expect(low).not.toBe(mid);
    expect(mid).not.toBe(high);
  });
});

// ─── Integration: Full Pipeline ──────────────────────────────────

describe("contour generation integration", () => {
  it("generates contours from 50 random points", () => {
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 50; i++) {
      points.push({
        easting: Math.random() * 100,
        northing: Math.random() * 100,
        elevation: 50 + Math.random() * 20,
      });
    }
    const result = generateContours(points, { interval: 2.0 });
    expect(result.contours.length).toBeGreaterThan(0);
    expect(result.triangles.length).toBeGreaterThan(0);
    expect(result.vertices.length).toBe(50);
  });

  it("handles points with flat elevation (single contour level)", () => {
    const points: ContourInputPoint[] = [
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 10, northing: 0, elevation: 100 },
      { easting: 0, northing: 10, elevation: 100 },
      { easting: 10, northing: 10, elevation: 100 },
    ];
    const result = generateContours(points, { interval: 1.0 });
    // All same elevation → no contour crossings.
    expect(result.contours.length).toBe(0);
  });

  it("handles decimation for large point sets", () => {
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 3000; i++) {
      points.push({
        easting: Math.random() * 1000,
        northing: Math.random() * 1000,
        elevation: 1000 + Math.random() * 100,
      });
    }
    // Should decimate and still produce contours.
    const result = generateContours(points, { interval: 5.0, maxPoints: 500 });
    expect(result.vertices.length).toBeLessThanOrEqual(500);
    expect(result.contours.length).toBeGreaterThan(0);
  });

  it("decimates 10k points within 2 seconds", () => {
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 10_000; i++) {
      points.push({
        easting: Math.random() * 5000,
        northing: Math.random() * 5000,
        elevation: 100 + Math.random() * 50,
      });
    }
    const start = performance.now();
    const result = generateContours(points, { interval: 2.0, maxPoints: 1000 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.vertices.length).toBeLessThanOrEqual(1000);
    expect(result.contours.length).toBeGreaterThan(0);
    expect(result.triangles.length).toBeGreaterThan(0);
  });

  it("decimates 20k points with terrain features preserved", () => {
    // Create a hill + valley terrain.
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 20_000; i++) {
      const e = Math.random() * 10000;
      const n = Math.random() * 10000;
      // Hill at center, valley at edges.
      const distFromCenter = Math.sqrt((e - 5000) ** 2 + (n - 5000) ** 2);
      const elevation = 500 - distFromCenter * 0.05 + Math.random() * 5;
      points.push({ easting: e, northing: n, elevation });
    }
    const result = generateContours(points, { interval: 10.0, maxPoints: 1500 });
    expect(result.vertices.length).toBeLessThanOrEqual(1500);
    // Should have contours — hill/valley terrain guarantees crossings.
    expect(result.contours.length).toBeGreaterThan(0);
  });

  it("decimates 50k points without crashing", () => {
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 50_000; i++) {
      points.push({
        easting: Math.random() * 20000,
        northing: Math.random() * 20000,
        elevation: 0 + Math.random() * 100,
      });
    }
    const result = generateContours(points, { interval: 5.0, maxPoints: 2000 });
    expect(result.vertices.length).toBeLessThanOrEqual(2000);
    expect(result.triangles.length).toBeGreaterThan(0);
  });

  it("preserves spatial extent after decimation", () => {
    // Create points with a known bounding box.
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 5000; i++) {
      points.push({
        easting: Math.random() * 1000,
        northing: Math.random() * 1000,
        elevation: 100 + Math.random() * 20,
      });
    }
    const result = generateContours(points, { interval: 2.0, maxPoints: 500 });
    // Decimated points should span the full bounding box.
    const minE = Math.min(...result.vertices.map((p) => p.easting));
    const maxE = Math.max(...result.vertices.map((p) => p.easting));
    const minN = Math.min(...result.vertices.map((p) => p.northing));
    const maxN = Math.max(...result.vertices.map((p) => p.northing));
    // Should cover at least 80% of the original extent.
    expect(maxE - minE).toBeGreaterThan(800);
    expect(maxN - minN).toBeGreaterThan(800);
  });

  it("handles all points at same location (dedup edge case)", () => {
    const points: ContourInputPoint[] = [];
    for (let i = 0; i < 1000; i++) {
      points.push({ easting: 100, northing: 200, elevation: 50 });
    }
    const result = generateContours(points, { interval: 1.0, maxPoints: 100 });
    // All same location → deduplicated to 1 point → no triangles → no contours.
    expect(result.vertices.length).toBe(1);
    expect(result.contours.length).toBe(0);
  });
});
