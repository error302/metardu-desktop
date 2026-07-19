/**
 * Property-based tests using fast-check.
 *
 * These tests verify mathematical invariants that should hold for ANY
 * valid input — not just hand-picked test cases. If a property fails,
 * fast-check automatically shrinks the counterexample to the smallest
 * failing case.
 *
 * # Invariants tested
 *
 *   1. ECEF ↔ geodetic round-trip: geodetic→ECEF→geodetic reproduces input
 *   2. Helmert identity: zero params = identity transform
 *   3. WGS84 ↔ Arc 1960 round-trip: WGS84→Arc1960→WGS84 reproduces input
 *   4. Levelling tolerance: 10√K is always ≥ 0 and monotonically increasing
 *   5. Bearing symmetry: bearing(A→B) ± 180° = bearing(B→A)
 *   6. Polygon area: Shoelace area is always ≥ 0
 *
 * # References
 *
 *   - fast-check docs: https://fast-check.dev/
 *   - Property-based testing: https://en.wikipedia.org/wiki/Property_testing
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  geodeticToEcef,
  ecefToGeodetic,
  helmertTransform,
  wgs84ToArc1960,
  arc1960ToWgs84,
  levellingToleranceMm,
} from "../../index.js";

// ─── 1. ECEF ↔ geodetic round-trip ──────────────────────────────

describe("Property: ECEF ↔ geodetic round-trip", () => {
  it("round-trips for any lat ∈ [-89, 89], lon ∈ [-179, 179], h ∈ [0, 9000]", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -89, max: 89, noNaN: true }),
        fc.float({ min: -179, max: 179, noNaN: true }),
        fc.float({ min: 0, max: 9000, noNaN: true }),
        (lat, lon, h) => {
          const ecef = geodeticToEcef(lat, lon, h);
          const back = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
          expect(Math.abs(back.lat - lat)).toBeLessThan(1e-5);
          expect(Math.abs(back.lon - lon)).toBeLessThan(1e-5);
          expect(Math.abs(back.height - h)).toBeLessThan(0.01);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 2. Helmert identity ─────────────────────────────────────────

describe("Property: Helmert identity (zero params = identity)", () => {
  it("returns the input unchanged for any ECEF point", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -7e6, max: 7e6, noNaN: true }),
        fc.float({ min: -7e6, max: 7e6, noNaN: true }),
        fc.float({ min: -7e6, max: 7e6, noNaN: true }),
        (x, y, z) => {
          const result = helmertTransform(
            { x, y, z },
            { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: 0 },
          );
          expect(Math.abs(result.x - x)).toBeLessThan(1e-6);
          expect(Math.abs(result.y - y)).toBeLessThan(1e-6);
          expect(Math.abs(result.z - z)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 3. WGS84 ↔ Arc 1960 round-trip ─────────────────────────────

describe("Property: WGS84 ↔ Arc 1960 round-trip", () => {
  it("round-trips for any lat ∈ [-35, 15], lon ∈ [28, 52] (East Africa)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -35, max: 15, noNaN: true }),
        fc.float({ min: 28, max: 52, noNaN: true }),
        fc.float({ min: 0, max: 5000, noNaN: true }),
        (lat, lon, h) => {
          const arc = wgs84ToArc1960(lat, lon, h);
          const back = arc1960ToWgs84(arc.lat, arc.lon, arc.height);
          expect(Math.abs(back.lat - lat)).toBeLessThan(1e-7);
          expect(Math.abs(back.lon - lon)).toBeLessThan(1e-7);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 4. Levelling tolerance monotonicity ─────────────────────────

describe("Property: Levelling tolerance 10√K", () => {
  it("is always ≥ 0 for any K ≥ 0", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000, noNaN: true }),
        (K) => {
          const tol = levellingToleranceMm(K);
          expect(tol).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is monotonically increasing (larger K → larger tolerance)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 250, noNaN: true }),
        fc.double({ min: 0.1, max: 250, noNaN: true }),
        (k1, k2) => {
          const small = Math.min(k1, k2);
          const large = Math.max(k1, k2);
          if (small === large) return;
          const tolSmall = levellingToleranceMm(small);
          const tolLarge = levellingToleranceMm(large);
          expect(tolLarge).toBeGreaterThanOrEqual(tolSmall);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 5. Bearing symmetry ─────────────────────────────────────────

describe("Property: bearing(A→B) ± 180° = bearing(B→A)", () => {
  it("for any two distinct 2D points", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        (e1, n1, e2, n2) => {
          // Skip if points are too close (would produce undefined bearing).
          fc.pre(Math.abs(e1 - e2) > 0.1 || Math.abs(n1 - n2) > 0.1);

          // Compute bearing A→B.
          const de12 = e2 - e1;
          const dn12 = n2 - n1;
          let brg12 = (Math.atan2(de12, dn12) * 180) / Math.PI;
          if (brg12 < 0) brg12 += 360;

          // Compute bearing B→A.
          const de21 = e1 - e2;
          const dn21 = n1 - n2;
          let brg21 = (Math.atan2(de21, dn21) * 180) / Math.PI;
          if (brg21 < 0) brg21 += 360;

          // They should differ by exactly 180°.
          let diff = Math.abs(brg12 - brg21);
          if (diff > 180) diff = 360 - diff;
          expect(Math.abs(diff - 180)).toBeLessThan(0.001);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 6. Shoelace area non-negativity ─────────────────────────────

describe("Property: Shoelace area is always ≥ 0", () => {
  // Local implementation of Shoelace (the engine's version is in the
  // Rust sidecar; this tests the same algorithm in TS).
  function shoelace(points: [number, number][]): number {
    if (points.length < 3) return 0;
    let sum = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sum += points[i]![0] * points[j]![1] - points[j]![0] * points[i]![1];
    }
    return Math.abs(sum / 2);
  }

  it("returns ≥ 0 for any polygon with ≥ 3 vertices", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.float({ min: -10000, max: 10000, noNaN: true }),
            fc.float({ min: -10000, max: 10000, noNaN: true }),
          ),
          { minLength: 3, maxLength: 20 },
        ),
        (points) => {
          const area = shoelace(points);
          expect(area).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(area)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns 0 for a degenerate polygon (all points same)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -1000, max: 1000, noNaN: true }),
        fc.float({ min: -1000, max: 1000, noNaN: true }),
        (x, y) => {
          const points: [number, number][] = [
            [x, y], [x, y], [x, y], [x, y],
          ];
          expect(shoelace(points)).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
