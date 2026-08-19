/**
 * ellipse — pure error-ellipse display math tests.
 *
 * Pins the WGS84 ellipse ring builder (metre axes → degree polygon for the
 * OpenLayers overlay) and the uncertainty formatter used by the MapView
 * beacon popup. Pure — no ol, no React, no Electron.
 */

import { describe, it, expect } from "vitest";
import { ellipseRingDegrees, formatUncertainty } from "../renderer/ellipse.js";
import type { MapUncertainty } from "../renderer/map-geometry.js";

describe("ellipseRingDegrees", () => {
  it("builds a closed ring (first vertex repeats) around the centre", () => {
    const ring = ellipseRingDegrees(36.82, -1.29, 10, 5, 0);
    expect(ring.length).toBe(73); // samples + closure
    expect(ring[0]![0]).toBeCloseTo(ring[ring.length - 1]![0], 12);
    expect(ring[0]![1]).toBeCloseTo(ring[ring.length - 1]![1], 12);
  });

  it("aligns the major axis due north for orientation 0° (a along N, b along E)", () => {
    const ring = ellipseRingDegrees(0, 0, 10, 5, 0);
    const maxN = Math.max(...ring.map((p) => p[1]!));
    const minN = Math.min(...ring.map((p) => p[1]!));
    const maxE = Math.max(...ring.map((p) => p[0]!));
    const minE = Math.min(...ring.map((p) => p[0]!));
    // 10 m north ↔ 10 / 110_574 degrees; 5 m east ↔ 5 / 111_320 degrees.
    expect(maxN - minN).toBeCloseTo((2 * 10) / 110_574, 10);
    expect(maxE - minE).toBeCloseTo((2 * 5) / 111_320, 10);
    // North/south and east/west extremes are all on the ring.
    expect(maxN).toBeCloseTo(10 / 110_574, 10);
    expect(maxE).toBeCloseTo(5 / 111_320, 10);
  });

  it("swaps the axes for orientation 90° (major axis due east)", () => {
    const ring = ellipseRingDegrees(0, 0, 10, 5, 90);
    const maxN = Math.max(...ring.map((p) => p[1]!));
    const maxE = Math.max(...ring.map((p) => p[0]!));
    expect(maxN).toBeCloseTo(5 / 110_574, 10);
    expect(maxE).toBeCloseTo(10 / 111_320, 10);
  });

  it("scales the parallel arc by cos(lat) for longitude offsets", () => {
    // At the equator cos(0) = 1; at 60° the east scale halves.
    const eq = ellipseRingDegrees(0, 0, 0, 10, 0);
    const hi = ellipseRingDegrees(0, 60, 0, 10, 0);
    const eqEast = Math.max(...eq.map((p) => p[0]!));
    const hiEast = Math.max(...hi.map((p) => p[0]!));
    expect(eqEast).toBeCloseTo(10 / 111_320, 10);
    expect(hiEast).toBeCloseTo(10 / (111_320 * 0.5), 9);
  });

  it("degenerates to a circle for equal axes (GPS-style accuracy)", () => {
    // A circle is orientation-invariant, but the 72-sample ring only hits
    // its true extreme when the orientation aligns with the sampling grid
    // (0°/90° do; 37° does not). The sampled polygon underestimates the
    // extreme by at most a half-step chord: 7·(1−cos(2.5°)) ≈ 6.7 mm ≈
    // 6e-8 degrees — so assert at display tolerance (1e-6°), which still
    // catches axis/orientation bugs by orders of magnitude.
    const ring = ellipseRingDegrees(10, 20, 7, 7, 37);
    const maxN = Math.max(...ring.map((p) => p[1]!));
    const minE = Math.min(...ring.map((p) => p[0]!));
    expect(maxN - 20).toBeCloseTo(7 / 110_574, 6);
    expect(10 - minE).toBeCloseTo(7 / (111_320 * Math.cos((20 * Math.PI) / 180)), 6);
  });
});

describe("formatUncertainty", () => {
  it("renders an adjusted point's ellipse with axes + orientation", () => {
    const u: MapUncertainty = {
      adjusted: true,
      semiMajorAxis: 0.012,
      semiMinorAxis: 0.008,
      orientation: 45.3,
      confidenceLevel: 0.95,
    };
    expect(formatUncertainty(u)).toBe("95% error ellipse: a = 12.0 mm, b = 8.0 mm, θ = 45.3°");
  });

  it("renders metre axes for large ellipses", () => {
    const u: MapUncertainty = { adjusted: true, semiMajorAxis: 2.5, semiMinorAxis: 1.25 };
    expect(formatUncertainty(u)).toBe("95% error ellipse: a = 2.500 m, b = 1.250 m");
  });

  it("explains fixed control points and field readings", () => {
    expect(formatUncertainty({ adjusted: false, reason: "fixed-control" }))
      .toBe("Fixed control point — no propagated uncertainty");
    expect(formatUncertainty({ adjusted: false, reason: "field-data" }))
      .toBe("Field reading — no LS adjustment");
    expect(formatUncertainty({ adjusted: false }))
      .toBe("Known point — no propagated uncertainty");
  });

  it("flags adjusted points with no computed ellipse honestly", () => {
    expect(formatUncertainty({ adjusted: true, reason: "degenerate-configuration" }))
      .toBe("Adjusted — degenerate configuration, no ellipse");
    expect(formatUncertainty({ adjusted: true }))
      .toBe("Adjusted — no error ellipse computed");
  });

  it("handles a missing record", () => {
    expect(formatUncertainty(null)).toBe("No uncertainty record");
    expect(formatUncertainty(undefined)).toBe("No uncertainty record");
  });
});
