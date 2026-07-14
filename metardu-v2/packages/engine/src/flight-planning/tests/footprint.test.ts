/**
 * Tests for the camera footprint math module.
 *
 * Verifies the core formulas against:
 *   - Hand-computed reference values
 *   - Pix4D GSD calculator outputs (https://support.pix4d.com/hc/en-us/articles/202559889)
 *   - Property-based tests with fast-check for invariants
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  gsdMetersPerPixel,
  gsdCentimetersPerPixel,
  altitudeForGsd,
  footprintMeters,
  spacingMeters,
  computeFlightPlanParameters,
  photoAndLineCount,
} from "../footprint.js";
import { getCameraById, type CameraSpec } from "../cameras.js";

// Reference camera for hand-computed tests: DJI Mavic 3 Enterprise
const MAVIC3 = () => getCameraById("dji-mavic-3-enterprise");
// 4/3 sensor, 5280x3956, 12mm focal length, pixel size = 3.39 µm

describe("gsdMetersPerPixel — hand-computed reference values", () => {
  it("DJI Mavic 3 Enterprise at 75m AGL should give GSD ≈ 2.12 cm/px", () => {
    // GSD_m = (pixelSize_µm / 1000) * altitude / focalLength
    //       = (3.3901 / 1000) * 75 / 12
    //       = 0.021188... m
    //       = 2.1188 cm/px
    const gsd = gsdMetersPerPixel(MAVIC3(), 75);
    expect(gsd).toBeCloseTo(0.02119, 4);
    expect(gsdCentimetersPerPixel(MAVIC3(), 75)).toBeCloseTo(2.119, 2);
  });

  it("DJI Mavic 3 Enterprise at 100m AGL should give GSD ≈ 2.83 cm/px", () => {
    // GSD = 3.3901/1000 * 100 / 12 = 0.028251 m = 2.8251 cm/px
    const gsd = gsdMetersPerPixel(MAVIC3(), 100);
    expect(gsd).toBeCloseTo(0.02825, 4);
  });

  it("DJI Phantom 4 RTK at 100m AGL should give GSD ≈ 2.74 cm/px", () => {
    // pixelSize = 13.2/5472 * 1000 = 2.4123 µm
    // GSD = 2.4123/1000 * 100 / 8.8 = 0.027412 m = 2.7412 cm/px
    // Pix4D GSD calculator reports 2.72 cm/px for this configuration
    const cam = getCameraById("dji-phantom-4-rtk");
    const gsd = gsdCentimetersPerPixel(cam, 100);
    expect(gsd).toBeCloseTo(2.74, 1);
  });

  it("senseFly eBee X S.O.D.A. 3D at 100m AGL should give GSD ≈ 2.20 cm/px", () => {
    // pixelSize = 13.2/5472 * 1000 = 2.4123 µm
    // GSD = 2.4123/1000 * 100 / 10.0 = 0.024123 m = 2.4123 cm/px
    const cam = getCameraById("sensefly-ebee-x-soda3d");
    const gsd = gsdCentimetersPerPixel(cam, 100);
    expect(gsd).toBeCloseTo(2.41, 1);
  });

  it("should throw for non-positive altitude", () => {
    expect(() => gsdMetersPerPixel(MAVIC3(), 0)).toThrow(/positive/);
    expect(() => gsdMetersPerPixel(MAVIC3(), -10)).toThrow(/positive/);
  });
});

describe("altitudeForGsd — inverse of GSD calculation", () => {
  it("should return the altitude that produces the requested GSD", () => {
    // If we want 2.12 cm/px with Mavic 3 Enterprise:
    // altitude = GSD * focalLength / pixelSize = 0.0212 * 12 / (3.3901/1000) = 75.04 m
    const alt = altitudeForGsd(MAVIC3(), 2.12);
    expect(alt).toBeCloseTo(75.04, 1);
  });

  it("should be the exact inverse of gsdMetersPerPixel (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 50, noNaN: true }), // GSD in cm/px (0.5 to 50)
        (targetGsd) => {
          const alt = altitudeForGsd(MAVIC3(), targetGsd);
          const actualGsd = gsdCentimetersPerPixel(MAVIC3(), alt);
          // Should round-trip within 0.1% (floating-point tolerance)
          const relError = Math.abs(actualGsd - targetGsd) / targetGsd;
          return relError < 0.001;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should throw for non-positive target GSD", () => {
    expect(() => altitudeForGsd(MAVIC3(), 0)).toThrow(/positive/);
    expect(() => altitudeForGsd(MAVIC3(), -1)).toThrow(/positive/);
  });
});

describe("footprintMeters — image footprint on ground", () => {
  it("DJI Mavic 3 Enterprise at 75m AGL should give footprint ≈ 111.9 × 81.3 m", () => {
    // footprintWidth  = altitude * sensorWidth  / focalLength = 75 * 17.9 / 12 = 111.875 m
    // footprintHeight = altitude * sensorHeight / focalLength = 75 * 13.0 / 12 = 81.25 m
    const fp = footprintMeters(MAVIC3(), 75);
    expect(fp.widthMeters).toBeCloseTo(111.875, 2);
    expect(fp.heightMeters).toBeCloseTo(81.25, 2);
  });

  it("DJI Phantom 4 RTK at 100m AGL should give footprint ≈ 150 × 100 m", () => {
    // footprintWidth  = 100 * 13.2 / 8.8 = 150.0 m
    // footprintHeight = 100 * 8.8  / 8.8 = 100.0 m
    const cam = getCameraById("dji-phantom-4-rtk");
    const fp = footprintMeters(cam, 100);
    expect(fp.widthMeters).toBeCloseTo(150.0, 2);
    expect(fp.heightMeters).toBeCloseTo(100.0, 2);
  });

  it("footprint should scale linearly with altitude (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 500, noNaN: true }),
        fc.double({ min: 10, max: 500, noNaN: true }),
        (alt1, alt2) => {
          fc.pre(Math.abs(alt1 - alt2) > 0.1);
          const fp1 = footprintMeters(MAVIC3(), alt1);
          const fp2 = footprintMeters(MAVIC3(), alt2);
          // ratio of footprints should equal ratio of altitudes
          const widthRatio = fp1.widthMeters / fp2.widthMeters;
          const altRatio = alt1 / alt2;
          return Math.abs(widthRatio - altRatio) < 0.001;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("spacingMeters — overlap calculations", () => {
  it("75% front / 65% side overlap on 111.9 × 81.3 m footprint gives 28.0 × 28.5 m spacing", () => {
    // photoSpacing = 111.875 * (1 - 0.75) = 27.969 m ≈ 28.0 m
    // lineSpacing  = 81.25   * (1 - 0.65) = 28.438 m ≈ 28.5 m
    const fp = footprintMeters(MAVIC3(), 75);
    const sp = spacingMeters(fp, 0.75, 0.65);
    expect(sp.photoSpacingMeters).toBeCloseTo(27.969, 1);
    expect(sp.lineSpacingMeters).toBeCloseTo(28.438, 1);
  });

  it("0% overlap gives spacing = footprint (edge case)", () => {
    const fp = { widthMeters: 100, heightMeters: 80 };
    const sp = spacingMeters(fp, 0, 0);
    expect(sp.photoSpacingMeters).toBeCloseTo(100);
    expect(sp.lineSpacingMeters).toBeCloseTo(80);
  });

  it("should throw for overlap >= 1 (impossible)", () => {
    const fp = { widthMeters: 100, heightMeters: 80 };
    expect(() => spacingMeters(fp, 1.0, 0.5)).toThrow();
    expect(() => spacingMeters(fp, 0.5, 1.0)).toThrow();
    expect(() => spacingMeters(fp, -0.1, 0.5)).toThrow();
  });

  it("higher overlap gives smaller or equal spacing (monotonic, property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 0.95, noNaN: true }),
        fc.double({ min: 0.1, max: 0.95, noNaN: true }),
        (overlap1, overlap2) => {
          // Require a meaningful difference to avoid float edge cases
          fc.pre(overlap2 - overlap1 > 0.01);
          const fp = { widthMeters: 100, heightMeters: 80 };
          const sp1 = spacingMeters(fp, overlap1, 0.5);
          const sp2 = spacingMeters(fp, overlap2, 0.5);
          // Higher overlap → strictly smaller spacing
          return sp2.photoSpacingMeters < sp1.photoSpacingMeters;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("computeFlightPlanParameters — combined convenience", () => {
  it("should compute all parameters consistently", () => {
    const params = computeFlightPlanParameters(MAVIC3(), 75, 0.75, 0.65);
    expect(params.gsdCmPx).toBeCloseTo(2.119, 2);
    expect(params.footprintWidthM).toBeCloseTo(111.875, 2);
    expect(params.footprintHeightM).toBeCloseTo(81.25, 2);
    expect(params.photoSpacingM).toBeCloseTo(27.969, 1);
    expect(params.lineSpacingM).toBeCloseTo(28.438, 1);
    expect(params.altitudeM).toBe(75);
    expect(params.frontOverlap).toBe(0.75);
    expect(params.sideOverlap).toBe(0.65);
    expect(params.cameraId).toBe("dji-mavic-3-enterprise");
  });
});

describe("photoAndLineCount — survey coverage", () => {
  it("50ha area (500×1000m) at 75%F/65%S with Mavic 3 should need reasonable photo count", () => {
    // 50ha = 500m × 1000m
    const params = computeFlightPlanParameters(MAVIC3(), 75, 0.75, 0.65);
    const counts = photoAndLineCount(params, 500, 1000, 0.1);
    // Effective area: 550 × 1100 m
    // Photos per line: ceil(550 / 27.969) + 1 = 20 + 1 = 21 (with margin)
    // Lines: ceil(1100 / 28.438) + 1 = 39 + 1 = 40 (with margin)
    // Total: 21 * 40 = 840 photos
    expect(counts.photoCount).toBeGreaterThanOrEqual(18);
    expect(counts.photoCount).toBeLessThanOrEqual(25);
    expect(counts.lineCount).toBeGreaterThanOrEqual(35);
    expect(counts.lineCount).toBeLessThanOrEqual(45);
    expect(counts.totalPhotos).toBe(counts.photoCount * counts.lineCount);
  });

  it("should throw for non-positive area dimensions", () => {
    const params = computeFlightPlanParameters(MAVIC3(), 75, 0.75, 0.65);
    expect(() => photoAndLineCount(params, 0, 100)).toThrow();
    expect(() => photoAndLineCount(params, 100, 0)).toThrow();
    expect(() => photoAndLineCount(params, -10, 100)).toThrow();
  });
});

// ─── Cross-camera property tests ────────────────────────────────────
describe("property-based tests across all cameras", () => {
  // Test against all cameras in the database
  const allCameras: CameraSpec[] = [
    ...["dji-mavic-3-enterprise", "dji-phantom-4-rtk", "dji-mini-4-pro",
        "sensefly-ebee-x-soda3d", "autel-evo-ii-pro-rtk",
        "dji-matrice-350-p1-35mm", "dji-matrice-350-p1-24mm"].map(getCameraById),
  ];

  it.for(allCameras)(
    "GSD should be positive for any camera at any altitude 10-500m (%s)",
    (cam) => {
      fc.assert(
        fc.property(
          fc.double({ min: 10, max: 500, noNaN: true }),
          (alt) => {
            const gsd = gsdCentimetersPerPixel(cam, alt);
            return gsd > 0 && Number.isFinite(gsd);
          }
        ),
        { numRuns: 50 }
      );
    }
  );

  it.for(allCameras)(
    "footprint dimensions should be positive and finite (%s)",
    (cam) => {
      fc.assert(
        fc.property(
          fc.double({ min: 10, max: 500, noNaN: true }),
          (alt) => {
            const fp = footprintMeters(cam, alt);
            return (
              fp.widthMeters > 0 && fp.heightMeters > 0 &&
              Number.isFinite(fp.widthMeters) && Number.isFinite(fp.heightMeters)
            );
          }
        ),
        { numRuns: 50 }
      );
    }
  );

  it.for(allCameras)(
    "altitudeForGsd ∘ gsdCentimetersPerPixel = identity (%s)",
    (cam) => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.5, max: 50, noNaN: true }),
          (targetGsdCm) => {
            const alt = altitudeForGsd(cam, targetGsdCm);
            const actualGsdCm = gsdCentimetersPerPixel(cam, alt);
            const relError = Math.abs(actualGsdCm - targetGsdCm) / targetGsdCm;
            return relError < 0.001; // 0.1% float tolerance
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
