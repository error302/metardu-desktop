/**
 * Tests for the extended detectSurveyType + GeoJSON feature builders
 * for the 7 new workflow types (sectional, setting-out, corridor,
 * drone-processing, lidar, surface-comparison, utility-mapping).
 *
 * Per the Brief 02 pattern: each workflow type has pointUncertainty,
 * is detected by detectSurveyType, and produces valid GeoJSON output
 * via the GeoJSON exporter.
 */

import { describe, it, expect } from "vitest";
import { detectSurveyType } from "../../survey-type-detection.js";
import { geoJsonExporter } from "../geojson-export.js";

const baseMetadata = {
  projectName: "Extended Types Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "extended-test-001",
};

describe("detectSurveyType — all 10 types", () => {
  it("detects sectional", () => {
    expect(detectSurveyType({ levels: [], totalBuildingArea: 0, totalUnitArea: 0, totalCommonArea: 0, areaBalanceOk: true, pointUncertainty: {}, regime: {} })).toBe("sectional");
  });
  it("detects setting-out", () => {
    expect(detectSurveyType({ instructions: [], results: [], allPass: true, failCount: 0, horizontalToleranceM: 0.01, maxHorizontalResidual: 0, meanHorizontalResidual: 0, pointUncertainty: {} })).toBe("setting-out");
  });
  it("detects corridor", () => {
    expect(detectSurveyType({ crossSections: [], totalLength: 0, cutVolume: 0, fillVolume: 0, netVolume: 0, template: {}, pointUncertainty: {} })).toBe("corridor");
  });
  it("detects drone-processing", () => {
    expect(detectSurveyType({ orthophotoPath: "", dsmPath: "", dtmPath: "", pointCloudPath: "", contours: [], quality: { asprsClass: "Class 1" }, processingTimeSec: 0, log: [], pointUncertainty: {} })).toBe("drone-processing");
  });
  it("detects lidar", () => {
    expect(detectSurveyType({ points: [], counts: {}, dtm: {}, dsm: {}, processingTimeMs: 0, warnings: [], pointUncertainty: {} })).toBe("lidar");
  });
  it("detects surface-comparison", () => {
    expect(detectSurveyType({ cutVolume: 0, fillVolume: 0, netVolume: 0, cutArea: 0, fillArea: 0, maxCutDepth: 0, maxFillHeight: 0, avgCutDepth: 0, avgFillHeight: 0, gridResolution: 0, pointUncertainty: {} })).toBe("surface-comparison");
  });
  it("detects utility-mapping", () => {
    expect(detectSurveyType({ detections: [], runs: [], crossings: [], stats: {}, pointUncertainty: {} })).toBe("utility-mapping");
  });
  // Existing types still work
  it("still detects cadastral", () => {
    expect(detectSurveyType({ form3: {}, allBeacons: [], residuals: {}, sigma_0_sq: 0, passesCadastralTolerance: false, uncertainty: {} })).toBe("cadastral");
  });
  it("still detects topographic", () => {
    expect(detectSurveyType({ tin: { vertices: [], triangles: [] }, contours: [], spotHeights: [], minElevation: 0, maxElevation: 0, meanSlope: 0, triangleCount: 0, topographicToleranceM: 0, maxResidualM: 0, pointUncertainty: {} })).toBe("topographic");
  });
  it("still detects engineering", () => {
    expect(detectSurveyType({ sections: [], cutVolume: 0, fillVolume: 0, netVolume: 0, engineeringToleranceM: 0, sectionCount: 0, maxCutDepth: 0, maxFillHeight: 0, pointUncertainty: {} })).toBe("engineering");
  });
});

describe("geoJsonExporter — new types produce valid GeoJSON", () => {
  it("sectional: metadata-only (no spatial features)", async () => {
    const input = {
      levels: [{ level: 1, name: "Ground", totalArea: 100, unitArea: 80, commonArea: 20, units: [{ number: "A", type: "residential", area: 80, participationQuota: 80 }] }],
      totalBuildingArea: 100, totalUnitArea: 80, totalCommonArea: 20, areaBalanceOk: true,
      pointUncertainty: {},
      regime: { legislation: "Sectional Properties Act 2020", planType: "Sectional Plan", requiresParticipationQuotas: true },
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("sectional");
    expect(parsed.metadata.metardu.sectional).toBeDefined();
    expect(parsed.metadata.metardu.sectional.totalBuildingArea).toBe(100);
    expect(parsed.features.length).toBe(0); // no spatial features
  });

  it("setting-out: design points as Point features with uncertainty", async () => {
    const input = {
      instructions: [
        { designPointId: "DP1", method: "polar", fromControlId: "CP1", bearingDeg: 45, distanceM: 50, designEasting: 1000, designNorthing: 2000 },
        { designPointId: "DP2", method: "polar", fromControlId: "CP1", bearingDeg: 90, distanceM: 30, designEasting: 1030, designNorthing: 2000 },
      ],
      results: [], allPass: true, failCount: 0, horizontalToleranceM: 0.015,
      maxHorizontalResidual: 0, meanHorizontalResidual: 0,
      pointUncertainty: { DP1: { adjusted: false, reason: "field-data" }, DP2: { adjusted: false, reason: "field-data" } },
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("setting-out");
    expect(parsed.features.length).toBe(2);
    expect(parsed.features[0].id).toBe("setting-out-DP1");
    expect(parsed.features[0].properties.adjusted).toBe(false);
    expect(parsed.features[0].properties.uncertainty.reason).toBe("field-data");
  });

  it("corridor: cross-section points as Point features", async () => {
    const input = {
      crossSections: [{
        chainage: 0,
        points: [
          { offset: -3.5, easting: 1000, northing: 2000, elevation: 100, label: "Left edge" },
          { offset: 3.5, easting: 1007, northing: 2000, elevation: 100, label: "Right edge" },
        ],
      }],
      totalLength: 100, cutVolume: 0, fillVolume: 0, netVolume: 0,
      template: { name: "Single Lane Road", elements: [] },
      pointUncertainty: {},
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("corridor");
    expect(parsed.features.length).toBe(2);
    expect(parsed.metadata.metardu.corridor.crossSectionCount).toBe(1);
  });

  it("lidar: point cloud as Point features", async () => {
    const input = {
      points: [
        { easting: 1000, northing: 2000, elevation: 100, classification: "ground" },
        { easting: 1001, northing: 2001, elevation: 101, classification: "vegetation" },
      ],
      counts: { ground: 1, vegetation: 1, building: 0, noise: 0 },
      dtm: { cellSize: 1, origin: { easting: 0, northing: 0 }, ncols: 1, nrows: 1, elevations: new Float64Array([100]) },
      dsm: { cellSize: 1, origin: { easting: 0, northing: 0 }, ncols: 1, nrows: 1, elevations: new Float64Array([101]) },
      processingTimeMs: 100, warnings: [], pointUncertainty: {},
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("lidar");
    expect(parsed.features.length).toBe(2);
    expect(parsed.features[0].id).toBe("lidar-point-0");
    expect(parsed.features[0].properties.classification).toBe("ground");
  });

  it("utility-mapping: detections as Point features + runs as LineStrings", async () => {
    const input = {
      detections: [
        { easting: 1000, northing: 2000, depth: 1.5, utilityType: "electric", signalStrength: 80, confidence: 0.9 },
        { easting: 1001, northing: 2000, depth: 1.6, utilityType: "electric", signalStrength: 75, confidence: 0.85 },
      ],
      runs: [{
        type: "electric",
        points: [{ easting: 1000, northing: 2000, depth: 1.5 }, { easting: 1001, northing: 2000, depth: 1.6 }],
        totalLength: 1, avgDepth: 1.55,
      }],
      crossings: [],
      stats: { totalDetections: 2, byType: { electric: 2 }, avgDepth: 1.55, maxDepth: 1.6, minDepth: 1.5, avgConfidence: 0.875 },
      pointUncertainty: { "0": { adjusted: false, reason: "field-data" }, "1": { adjusted: false, reason: "field-data" } },
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("utility-mapping");
    // 2 detection Points + 1 run LineString = 3 features
    expect(parsed.features.length).toBe(3);
    expect(parsed.features[0].id).toBe("utility-detection-0");
    expect(parsed.features[0].properties.utilityType).toBe("electric");
  });

  it("surface-comparison: metadata-only (no spatial features)", async () => {
    const input = {
      cutVolume: 100, fillVolume: 50, netVolume: 50,
      cutArea: 200, fillArea: 100,
      maxCutDepth: 2, maxFillHeight: 1,
      avgCutDepth: 0.5, avgFillHeight: 0.5,
      gridResolution: 1,
      pointUncertainty: {},
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("surface-comparison");
    expect(parsed.metadata.metardu["surface-comparison"].cutVolume).toBe(100);
    expect(parsed.features.length).toBe(0);
  });

  it("drone-processing: metadata-only (no spatial features)", async () => {
    const input = {
      orthophotoPath: "/tmp/ortho.tif", dsmPath: "/tmp/dsm.tif",
      dtmPath: "/tmp/dtm.tif", pointCloudPath: "/tmp/cloud.laz",
      contours: [], quality: { asprsClass: "Class 1" },
      processingTimeSec: 120, log: [], pointUncertainty: {},
    };
    const result = await geoJsonExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("drone-processing");
    expect(parsed.features.length).toBe(0);
  });
});

describe("geoJsonExporter — DXF/PyQGIS/QGS exporters reject new types honestly", () => {
  it("dxfExporter throws for sectional", async () => {
    const { dxfExporter } = await import("../dxf-export.js");
    const input = { levels: [], totalBuildingArea: 0, totalUnitArea: 0, totalCommonArea: 0, areaBalanceOk: true, pointUncertainty: {}, regime: {} };
    await expect(dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata } as any)).rejects.toThrow(/does not yet support survey type 'sectional'/);
  });
});
