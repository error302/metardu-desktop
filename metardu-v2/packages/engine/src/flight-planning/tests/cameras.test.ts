/**
 * Tests for the camera sensor database.
 *
 * Verifies:
 *   - All camera specs are internally consistent (pixel size = sensorWidth / imageWidth)
 *   - All specs have valid positive values
 *   - Pixel sizes match known published values for spot-check cameras
 *   - Lookup functions work correctly
 */
import { describe, it, expect } from "vitest";
import {
  CAMERA_DATABASE,
  getCameraById,
  getCamerasByManufacturer,
  getCamerasByCategory,
  getManufacturers,
  pixelSizeMicrometers,
  type CameraSpec,
} from "../cameras.js";

describe("camera database integrity", () => {
  it("should have at least 10 cameras for production use", () => {
    expect(CAMERA_DATABASE.length).toBeGreaterThanOrEqual(10);
  });

  it("every camera should have all required fields populated", () => {
    for (const cam of CAMERA_DATABASE) {
      expect(cam.id).toBeTruthy();
      expect(cam.name).toBeTruthy();
      expect(cam.manufacturer).toBeTruthy();
      expect(cam.category).toBeTruthy();
      expect(cam.sensorWidthMm).toBeGreaterThan(0);
      expect(cam.sensorHeightMm).toBeGreaterThan(0);
      expect(cam.imageWidthPx).toBeGreaterThan(0);
      expect(cam.imageHeightPx).toBeGreaterThan(0);
      expect(cam.focalLengthMm).toBeGreaterThan(0);
      expect(cam.source).toMatch(/^https?:\/\//);
    }
  });

  it("every camera ID should be unique", () => {
    const ids = CAMERA_DATABASE.map((c) => c.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it("sensor aspect ratio should match image aspect ratio (within 5%)", () => {
    // sensorWidth/sensorHeight should ≈ imageWidth/imageHeight
    // Tolerance is 5% because some cameras (e.g., DJI Mavic 3 Enterprise's 4/3 sensor)
    // have an active area that doesn't perfectly match the published image dimensions
    // due to sensor masking and aspect ratio cropping.
    for (const cam of CAMERA_DATABASE) {
      const sensorRatio = cam.sensorWidthMm / cam.sensorHeightMm;
      const imageRatio = cam.imageWidthPx / cam.imageHeightPx;
      const diff = Math.abs(sensorRatio - imageRatio) / sensorRatio;
      expect(diff, `${cam.id}: sensor ratio ${sensorRatio.toFixed(3)} vs image ratio ${imageRatio.toFixed(3)}`).toBeLessThan(0.05);
    }
  });

  it("every camera should have optional fields populated for battery estimation", () => {
    for (const cam of CAMERA_DATABASE) {
      // These are optional in the type, but we want all our DB entries to have them
      // for complete flight planning
      expect(cam.cruiseSpeedMs).toBeDefined();
      expect(cam.maxFlightTimeMin).toBeDefined();
      expect(cam.batteryCapacityMah).toBeDefined();
    }
  });
});

describe("pixelSizeMicrometers", () => {
  it("should compute pixel size = (sensorWidth / imageWidth) * 1000", () => {
    const cam: CameraSpec = {
      id: "test-cam",
      name: "Test Camera",
      manufacturer: "Test",
      category: "consumer",
      sensorWidthMm: 10,
      imageWidthPx: 4000,
      sensorHeightMm: 7.5,
      imageHeightPx: 3000,
      focalLengthMm: 8,
      source: "https://example.com",
    };
    // 10mm / 4000px * 1000 = 2.5 µm
    expect(pixelSizeMicrometers(cam)).toBeCloseTo(2.5, 5);
  });

  // Spot-checks against published pixel sizes:
  // Source: https://www.dji.com/mavic-3-enterprise/specs
  it("DJI Mavic 3 Enterprise pixel size ≈ 3.39 µm (published)", () => {
    const cam = getCameraById("dji-mavic-3-enterprise");
    // 17.9mm / 5280px * 1000 = 3.3901... µm
    expect(pixelSizeMicrometers(cam)).toBeCloseTo(3.39, 1);
  });

  // Source: https://www.dji.com/phantom-4-rtk/info (1-inch sensor, 2.41µm pixel size)
  it("DJI Phantom 4 RTK pixel size ≈ 2.41 µm (published)", () => {
    const cam = getCameraById("dji-phantom-4-rtk");
    // 13.2mm / 5472px * 1000 = 2.4123... µm
    expect(pixelSizeMicrometers(cam)).toBeCloseTo(2.41, 1);
  });

  // Source: DJI Mini 4 Pro (1/1.3-inch, ~1.19µm pixel size in 48MP mode)
  it("DJI Mini 4 Pro pixel size ≈ 1.19 µm (published 48MP mode)", () => {
    const cam = getCameraById("dji-mini-4-pro");
    // 9.6mm / 8064px * 1000 = 1.1904... µm
    expect(pixelSizeMicrometers(cam)).toBeCloseTo(1.19, 1);
  });

  // Source: DJI Zenmuse P1 (full-frame 45MP, 4.4µm pixel size)
  it("DJI Zenmuse P1 pixel size ≈ 4.39 µm (published 45MP full-frame)", () => {
    const cam = getCameraById("dji-matrice-350-p1-35mm");
    // 36mm / 8192px * 1000 = 4.3945... µm
    expect(pixelSizeMicrometers(cam)).toBeCloseTo(4.39, 1);
  });
});

describe("lookup functions", () => {
  it("getCameraById should return the correct camera", () => {
    const cam = getCameraById("dji-mavic-3-enterprise");
    expect(cam.name).toBe("DJI Mavic 3 Enterprise");
    expect(cam.manufacturer).toBe("DJI");
  });

  it("getCameraById should throw for unknown ID", () => {
    expect(() => getCameraById("nonexistent-camera")).toThrow(/Camera not found/);
  });

  it("getCamerasByManufacturer should filter by manufacturer", () => {
    const djiCams = getCamerasByManufacturer("DJI");
    expect(djiCams.length).toBeGreaterThanOrEqual(5);
    expect(djiCams.every((c) => c.manufacturer === "DJI")).toBe(true);
  });

  it("getCamerasByCategory should filter by category", () => {
    const consumer = getCamerasByCategory("consumer");
    expect(consumer.length).toBeGreaterThanOrEqual(2);
    expect(consumer.every((c) => c.category === "consumer")).toBe(true);

    const enterprise = getCamerasByCategory("enterprise");
    expect(enterprise.length).toBeGreaterThanOrEqual(3);
    expect(enterprise.every((c) => c.category === "enterprise")).toBe(true);
  });

  it("getManufacturers should return unique sorted list", () => {
    const mfrs = getManufacturers();
    expect(mfrs).toContain("DJI");
    expect(mfrs).toContain("senseFly");
    expect(mfrs).toContain("Autel");
    // Should be sorted
    for (let i = 1; i < mfrs.length; i++) {
      expect(mfrs[i - 1]! <= mfrs[i]!).toBe(true);
    }
  });
});
