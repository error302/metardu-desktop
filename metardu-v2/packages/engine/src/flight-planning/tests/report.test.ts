/**
 * Tests for flight plan summary report generation.
 */
import { describe, it, expect } from "vitest";
import {
  generateFlightPlanReport,
  reportToJson,
  checkAsprsCompliance,
  ASPRS_CLASSES,
  KENYA_COMPLIANCE,
} from "../report.js";
import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  computeBoundingBox,
  computeMissionStats,
  estimateBatteryAndTime,
} from "../../index.js";

function getTestReport() {
  const camera = getCameraById("dji-mavic-3-enterprise");
  const params = computeFlightPlanParameters(camera, 75, 0.75, 0.65);
  const surveyArea = {
    coordinates: [
      { lat: -1.2864, lng: 36.8172 },
      { lat: -1.2774, lng: 36.8172 },
      { lat: -1.2774, lng: 36.8227 },
      { lat: -1.2864, lng: 36.8227 },
      { lat: -1.2864, lng: 36.8172 },
    ],
  };
  const waypoints = generateLawnmowerWaypoints({ params, area: surveyArea });
  const bbox = computeBoundingBox(surveyArea);
  const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
  const battery = estimateBatteryAndTime(waypoints, { camera });

  return generateFlightPlanReport({
    camera,
    params,
    boundingBox: bbox,
    waypoints,
    battery,
    missionStats: stats,
    missionName: "Nairobi 50ha Test Survey",
    surveyorName: "Test Surveyor",
    projectRef: "TEST-001",
  });
}

describe("ASPRS_CLASSES", () => {
  it("should define 3 classes (I, II, III)", () => {
    expect(ASPRS_CLASSES.length).toBe(3);
    expect(ASPRS_CLASSES[0]!.name).toBe("Class I");
    expect(ASPRS_CLASSES[1]!.name).toBe("Class II");
    expect(ASPRS_CLASSES[2]!.name).toBe("Class III");
  });

  it("Class I should require finer GSD than Class III", () => {
    expect(ASPRS_CLASSES[0]!.maxGsdCmPx).toBeLessThan(ASPRS_CLASSES[2]!.maxGsdCmPx);
  });
});

describe("checkAsprsCompliance", () => {
  it("GSD of 2 cm/px should support all 3 classes", () => {
    const results = checkAsprsCompliance(2);
    expect(results.every((r) => r.supported)).toBe(true);
  });

  it("GSD of 8 cm/px should support Class II and III but not Class I", () => {
    const results = checkAsprsCompliance(8);
    expect(results[0]!.supported).toBe(false); // Class I (max 5 cm/px)
    expect(results[1]!.supported).toBe(true);  // Class II (max 10 cm/px)
    expect(results[2]!.supported).toBe(true);  // Class III (max 25 cm/px)
  });

  it("GSD of 30 cm/px should not support any class", () => {
    const results = checkAsprsCompliance(30);
    expect(results.every((r) => !r.supported)).toBe(true);
  });
});

describe("KENYA_COMPLIANCE", () => {
  it("levelling tolerance should be 10 × √K mm", () => {
    expect(KENYA_COMPLIANCE.levellingToleranceMm(1)).toBeCloseTo(10, 5);
    expect(KENYA_COMPLIANCE.levellingToleranceMm(4)).toBeCloseTo(20, 5);
    expect(KENYA_COMPLIANCE.levellingToleranceMm(9)).toBeCloseTo(30, 5);
  });

  // Phase 5: corrected from 15 × √N (which was actually the 15-course
  // azimuth check, a DIFFERENT tolerance) to 3.0 × √N per Kenya Survey
  // Regulations 1994 §4.3. The 15× value was a latent bug — it would
  // have allowed ~5× larger angular misclosures than the regulation
  // permits. The canonical source is now
  // packages/country-config/src/countries/kenya.ts (ANGULAR_MISCLOSURE).
  it("angular misclosure should be 3.0 × √N arcsec (Survey Regs 1994 §4.3)", () => {
    expect(KENYA_COMPLIANCE.angularMisclosureArcsec(1)).toBeCloseTo(3.0, 5);
    expect(KENYA_COMPLIANCE.angularMisclosureArcsec(4)).toBeCloseTo(6.0, 5);   // 3 × √4
    expect(KENYA_COMPLIANCE.angularMisclosureArcsec(9)).toBeCloseTo(9.0, 5);   // 3 × √9
    expect(KENYA_COMPLIANCE.angularMisclosureArcsec(16)).toBeCloseTo(12.0, 5); // 3 × √16
    expect(KENYA_COMPLIANCE.angularMisclosureArcsec(25)).toBeCloseTo(15.0, 5); // 3 × √25
  });
});

describe("generateFlightPlanReport", () => {
  const report = getTestReport();

  it("should populate metadata section", () => {
    expect(report.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.metadata.engineVersion).toBeTruthy();
    expect(report.metadata.missionName).toBe("Nairobi 50ha Test Survey");
    expect(report.metadata.surveyorName).toBe("Test Surveyor");
    expect(report.metadata.projectRef).toBe("TEST-001");
  });

  it("should populate camera section with correct values", () => {
    expect(report.camera.id).toBe("dji-mavic-3-enterprise");
    expect(report.camera.name).toBe("DJI Mavic 3 Enterprise");
    expect(report.camera.sensorWidthMm).toBe(17.9);
    expect(report.camera.pixelSizeMicrometers).toBeCloseTo(3.39, 1);
  });

  it("should populate flightPlan section", () => {
    expect(report.flightPlan.altitudeMeters).toBe(75);
    expect(report.flightPlan.frontOverlap).toBe(0.75);
    expect(report.flightPlan.sideOverlap).toBe(0.65);
    expect(report.flightPlan.gsdCmPx).toBeCloseTo(2.12, 1);
    expect(report.flightPlan.footprintWidthM).toBeCloseTo(111.875, 1);
  });

  it("should populate surveyArea section with correct area", () => {
    expect(report.surveyArea.areaHectares).toBeGreaterThan(40);
    expect(report.surveyArea.areaHectares).toBeLessThan(70);
    expect(report.surveyArea.vertexCount).toBeGreaterThan(100);
  });

  it("should populate missionStats section", () => {
    expect(report.missionStats.totalWaypoints).toBeGreaterThan(100);
    expect(report.missionStats.flightLineCount).toBeGreaterThan(5);
    expect(report.missionStats.totalDistanceMeters).toBeGreaterThan(10_000);
  });

  it("should populate battery section", () => {
    expect(report.battery.batteryCount).toBeGreaterThanOrEqual(1);
    expect(report.battery.usableFlightTimePerBatteryMin).toBeCloseTo(27, 0);
  });

  it("should populate asprsCompliance section with 3 classes", () => {
    expect(report.asprsCompliance.length).toBe(3);
    // GSD of ~2.12 cm/px should support all classes
    expect(report.asprsCompliance[0]!.supported).toBe(true); // Class I
  });

  it("should include kenyaCompliance reference", () => {
    expect(report.kenyaCompliance.urbanLinearMisclosure).toBe("1:10000");
    expect(report.kenyaCompliance.ruralLinearMisclosure).toBe("1:5000");
  });

  it("should generate footprintDiagramSvg", () => {
    expect(report.footprintDiagramSvg).toContain("<svg");
    expect(report.footprintDiagramSvg).toContain("Camera Footprint");
    expect(report.footprintDiagramSvg).toContain("</svg>");
  });

  it("should generate flightPatternSvg", () => {
    expect(report.flightPatternSvg).toContain("<svg");
    expect(report.flightPatternSvg).toContain("Flight Pattern");
    expect(report.flightPatternSvg).toContain("</svg>");
  });

  it("should not include terrain stats when not provided", () => {
    expect(report.terrain).toBeUndefined();
  });
});

describe("reportToJson", () => {
  it("should produce valid JSON that round-trips", () => {
    const report = getTestReport();
    const json = reportToJson(report);
    const parsed = JSON.parse(json);

    expect(parsed.metadata.missionName).toBe(report.metadata.missionName);
    expect(parsed.camera.id).toBe(report.camera.id);
    expect(parsed.flightPlan.gsdCmPx).toBeCloseTo(report.flightPlan.gsdCmPx, 5);
    expect(parsed.asprsCompliance.length).toBe(3);
  });
});
