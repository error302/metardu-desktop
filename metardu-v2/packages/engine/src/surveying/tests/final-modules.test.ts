/**
 * Tests for the final 4 modules: Survey Report, Total Station, Map Sheets, Cloud Sync.
 */

import { describe, it, expect } from "vitest";
import {
  generateSurveyReport,
  rdmComplianceTemplate,
} from "../survey-report.js";
import {
  averageFaceMeasurements,
  reduceMeasurement,
  simulateMeasurementSequence,
  INSTRUMENT_PRESETS,
  type TotalStationMeasurement,
} from "../total-station.js";
import {
  findKenyaMapSheet,
  findMapSheet,
  findSheetByName,
  SOK_SHEET_REGISTRY,
} from "../map-sheets.js";
import {
  SyncQueue,
  computePatch,
  applyPatch,
} from "../cloud-sync.js";

// ═══ Survey Report ═══

describe("Survey Report Generator", () => {
  it("should generate a complete report", () => {
    const report = generateSurveyReport({
      projectName: "Test Survey",
      surveyType: "engineering",
      location: "Nairobi",
      country: "Kenya",
      surveyDate: "2026-07-15",
      surveyorName: "Test Surveyor",
      crsEpsg: 21037,
      crsName: "Arc 1960 / UTM 37S",
      equipment: [{ type: "total_station", make: "Topcon", model: "GT-1200", serialNumber: "12345" }],
      controlPoints: [{ pointId: "BM1", easting: 1000, northing: 2000, elevation: 1700, method: "known", accuracyClass: "1st" }],
      coordinates: [{ pointId: "P1", easting: 1001, northing: 2001, elevation: 1700.5, code: "CTR" }],
      accuracy: { horizontalRms: 3, verticalRms: 2, maxErrorEllipse: 0.01, precisionRatio: "1:20000", meetsTolerance: true },
      compliance: { standard: "RDM 1.1", requirements: [], overallPass: true },
    });
    expect(report.project.projectName).toBe("Test Survey");
    expect(report.summary.totalPoints).toBe(1);
    expect(report.summary.overallPass).toBe(true);
  });

  it("should generate RDM compliance template for cadastral", () => {
    const template = rdmComplianceTemplate("cadastral");
    expect(template.standard).toContain("cadastral");
    expect(template.requirements.length).toBeGreaterThanOrEqual(5);
    expect(template.requirements.some(r => r.name.includes("Angular"))).toBe(true);
    expect(template.requirements.some(r => r.name.includes("seal"))).toBe(true);
  });

  it("should generate RDM compliance template for engineering", () => {
    const template = rdmComplianceTemplate("engineering");
    expect(template.requirements.some(r => r.name.includes("Curve"))).toBe(true);
  });

  it("should generate RDM compliance template for drone", () => {
    const template = rdmComplianceTemplate("drone");
    expect(template.requirements.some(r => r.name.includes("GCP"))).toBe(true);
    expect(template.requirements.some(r => r.name.includes("overlap"))).toBe(true);
  });
});

// ═══ Total Station ═══

describe("Robotic Total Station", () => {
  it("should average face-left and face-right measurements", () => {
    const fl: TotalStationMeasurement = {
      horizontalAngle: 45.000, verticalAngle: 90.000, slopeDistance: 100.000,
      face: "face_left", targetHeight: 1.5, instrumentHeight: 1.6, pointId: "P1", timestamp: 0,
    };
    const fr: TotalStationMeasurement = {
      horizontalAngle: 225.002, verticalAngle: 270.001, slopeDistance: 100.001,
      face: "face_right", targetHeight: 1.5, instrumentHeight: 1.6, pointId: "P1", timestamp: 1,
    };
    const avg = averageFaceMeasurements(fl, fr);
    expect(avg.measurementCount).toBe(2);
    // Mean HA ≈ 45.001 (small collimation error detected)
    expect(avg.horizontalAngle).toBeCloseTo(45.001, 3);
    expect(avg.errors.collimationError).toBeGreaterThan(0); // Error detected
  });

  it("should reduce measurement to coordinates", () => {
    const station = { easting: 1000, northing: 2000, elevation: 1700 };
    const measurement: TotalStationMeasurement = {
      horizontalAngle: 90, verticalAngle: 90, slopeDistance: 50,
      face: "face_left", targetHeight: 1.5, instrumentHeight: 1.5, pointId: "P1", timestamp: 0,
    };
    const result = reduceMeasurement(station, 0, measurement);
    // HA=90°, VA=90° (horizontal), SD=50m → 50m due east
    expect(result.easting).toBeCloseTo(1050, 1);
    expect(result.northing).toBeCloseTo(2000, 1);
    expect(result.elevation).toBeCloseTo(1700, 1);
  });

  it("should simulate measurement sequence", () => {
    const targets = [
      { pointId: "T1", targetEasting: 1050, targetNorthing: 2000, targetElevation: 1700 },
      { pointId: "T2", targetEasting: 1000, targetNorthing: 2050, targetElevation: 1701 },
    ];
    const results = simulateMeasurementSequence(
      { easting: 1000, northing: 2000, elevation: 1700 },
      0, 1.5, targets
    );
    expect(results.length).toBe(2);
    expect(results[0]!.pointId).toBe("T1");
    expect(results[0]!.slopeDistance).toBeCloseTo(50, 0);
  });

  it("should have instrument presets", () => {
    expect(INSTRUMENT_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(INSTRUMENT_PRESETS.some(p => p.brand === "Topcon")).toBe(true);
    expect(INSTRUMENT_PRESETS.some(p => p.brand === "Leica")).toBe(true);
  });
});

// ═══ Map Sheets ═══

describe("Map Sheet Indexing", () => {
  it("should find Nairobi map sheet", () => {
    const sheet = findKenyaMapSheet(-1.2864, 36.8172);
    expect(sheet).not.toBeNull();
    expect(sheet!.country).toBe("Kenya");
    expect(sheet!.scale).toBe("1:50,000");
    // Nairobi is around lat -1.2864, lng 36.8172
    expect(sheet!.south).toBeLessThanOrEqual(-1.2864);
    expect(sheet!.north).toBeGreaterThanOrEqual(-1.2864);
    expect(sheet!.west).toBeLessThanOrEqual(36.8172);
    expect(sheet!.east).toBeGreaterThanOrEqual(36.8172);
  });

  it("should auto-detect country and find sheet", () => {
    const sheet = findMapSheet(-1.2864, 36.8172);
    expect(sheet).not.toBeNull();
    expect(sheet!.country).toBe("Kenya");
  });

  it("should find Tanzania sheet", () => {
    const sheet = findMapSheet(-6.8, 39.25, "Tanzania");
    expect(sheet).not.toBeNull();
    expect(sheet!.country).toBe("Tanzania");
  });

  it("should find Uganda sheet", () => {
    const sheet = findMapSheet(0.35, 32.5, "Uganda");
    expect(sheet).not.toBeNull();
    expect(sheet!.country).toBe("Uganda");
  });

  it("should return null for coordinates outside East Africa", () => {
    expect(findMapSheet(-33.86, 151.21)).toBeNull(); // Sydney
  });

  it("should find sheet by name (Nairobi)", () => {
    const sheet = findSheetByName("Nairobi");
    expect(sheet).not.toBeNull();
    expect(sheet!.sheetName).toContain("Nairobi");
  });

  it("should have SoK sheet registry with 20+ entries", () => {
    expect(SOK_SHEET_REGISTRY.length).toBeGreaterThanOrEqual(20);
  });
});

// ═══ Cloud Sync ═══

describe("Cloud Sync", () => {
  it("should enqueue and process sync operations", async () => {
    const queue = new SyncQueue({ serverUrl: "http://test" });
    queue.enqueueCreate("parcels", "p1", { name: "Test" });
    queue.enqueueUpdate("parcels", "p2", { name: "Updated" });
    queue.enqueueDelete("parcels", "p3");

    const pending = queue.getPending();
    expect(pending.length).toBe(3);

    const result = await queue.simulateSync();
    expect(result.pushed).toBe(3);
    expect(result.conflicts).toBe(0);

    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.synced).toBe(3);
  });

  it("should handle conflicts", () => {
    const queue = new SyncQueue({ serverUrl: "http://test" });
    queue.enqueueUpdate("parcels", "p1", { name: "Local Version" });
    const pending = queue.getPending();
    const id = pending[0]!.id;
    queue.markConflict(id, { name: "Remote Version" });

    const conflicts = queue.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.conflictData).toContain("Remote Version");

    // Resolve: keep remote
    queue.resolveKeepRemote(id);
    expect(queue.getConflicts().length).toBe(0);
    expect(queue.getStats().synced).toBe(1);
  });

  it("should compute JSON patch", () => {
    const old = { name: "Test", elevation: 1700, code: "CTR" };
    const new_ = { name: "Test", elevation: 1701, code: "CTR" };
    const patch = computePatch(old, new_);
    expect(patch.length).toBe(1);
    expect(patch[0]!.op).toBe("replace");
    expect(patch[0]!.path).toBe("/elevation");
    expect(patch[0]!.value).toBe(1701);
  });

  it("should apply JSON patch", () => {
    const old = { name: "Test", elevation: 1700 };
    const patch = [{ op: "replace" as const, path: "/elevation", value: 1701 }];
    const result = applyPatch(old, patch);
    expect((result as any).elevation).toBe(1701);
    expect((result as any).name).toBe("Test");
  });

  it("should clear synced entries", async () => {
    const queue = new SyncQueue();
    queue.enqueueCreate("parcels", "p1", { name: "Test" });
    await queue.simulateSync();
    const cleared = queue.clearSynced();
    expect(cleared).toBe(1);
    expect(queue.getStats().total).toBe(0);
  });
});
