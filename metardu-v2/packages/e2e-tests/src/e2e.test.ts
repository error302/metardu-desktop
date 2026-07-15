/**
 * End-to-end integration tests for MetaRDU v2.0.
 *
 * These tests exercise the FULL pipeline from start to finish:
 *
 *   1. Flight planning: camera → GSD → footprint → waypoints → mission stats
 *   2. Mission export: generate all 5 formats (KMZ, .waypoints, CSV, XML, KML)
 *   3. Mission import: read all 5 formats back in
 *   4. Round-trip verification: imported waypoints match originals
 *   5. Terrain-aware altitude: apply terrain → verify AMSL altitudes
 *   6. Battery estimation: compute battery count → verify reasonable
 *   7. Report generation: generate JSON report → verify structure
 *   8. PDF rendering: generate PDF from report → verify bytes
 *   9. Sidecar RPC: spawn sidecar → ping → mavlink connect → upload mission
 *  10. IPC schema validation: valid input passes, invalid input rejected
 *
 * These tests are the "Reality Checker" gate — if any test fails, the build
 * is not production-ready.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Engine imports
import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  computeBoundingBox,
  computeMissionStats,
  estimateBatteryAndTime,
  elevationFromFunction,
  makeTerrainAware,
  exportMission,
  importMission,
  generateFlightPlanReport,
  type Waypoint,
} from "../../engine/src/index.js";

// IPC schemas import
import { validateIpcInput, listRegisteredChannels } from "../../ipc-schemas/src/index.js";

// PDF renderer import
import { renderReportToPdf } from "../../report-pdf/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Test data: 50ha Nairobi survey ────────────────────────────────

const NAIROBI_SURVEY = {
  coordinates: [
    { lat: -1.2864, lng: 36.8172 },
    { lat: -1.2774, lng: 36.8172 },
    { lat: -1.2774, lng: 36.8227 },
    { lat: -1.2864, lng: 36.8227 },
    { lat: -1.2864, lng: 36.8172 },
  ],
};

const CAMERA_ID = "dji-mavic-3-enterprise";
const ALTITUDE_M = 75;
const FRONT_OVERLAP = 0.75;
const SIDE_OVERLAP = 0.65;

// ─── E2E Test Suite ────────────────────────────────────────────────

describe("E2E: Full Pipeline — Flight Planning → Export → Import → Round-Trip", () => {
  let waypoints: Waypoint[];
  let originalParams: ReturnType<typeof computeFlightPlanParameters>;

  beforeAll(() => {
    const camera = getCameraById(CAMERA_ID);
    originalParams = computeFlightPlanParameters(camera, ALTITUDE_M, FRONT_OVERLAP, SIDE_OVERLAP);
    waypoints = generateLawnmowerWaypoints({
      params: originalParams,
      area: NAIROBI_SURVEY,
    });
  });

  // ─── Step 1: Flight Planning ────────────────────────────────────

  it("Step 1a: Camera database should have the Mavic 3 Enterprise", () => {
    const camera = getCameraById(CAMERA_ID);
    expect(camera.name).toBe("DJI Mavic 3 Enterprise");
    expect(camera.sensorWidthMm).toBe(17.9);
    expect(camera.focalLengthMm).toBe(12.0);
  });

  it("Step 1b: GSD at 75m should be ~2.12 cm/px (matches Pix4D calculator)", () => {
    expect(originalParams.gsdCmPx).toBeCloseTo(2.12, 1);
  });

  it("Step 1c: Footprint at 75m should be ~111.9 × 81.3 m", () => {
    expect(originalParams.footprintWidthM).toBeCloseTo(111.875, 1);
    expect(originalParams.footprintHeightM).toBeCloseTo(81.25, 1);
  });

  it("Step 1d: Should generate >100 waypoints for a 50ha survey", () => {
    expect(waypoints.length).toBeGreaterThan(100);
    expect(waypoints.length).toBeLessThan(2000);
  });

  it("Step 1e: All waypoints should have valid coordinates in Nairobi", () => {
    for (const wp of waypoints) {
      expect(wp.latitude).toBeGreaterThan(-1.30);
      expect(wp.latitude).toBeLessThan(-1.27);
      expect(wp.longitude).toBeGreaterThan(36.81);
      expect(wp.longitude).toBeLessThan(36.83);
    }
  });

  // ─── Step 2: Mission Export (all 5 formats) ─────────────────────

  it("Step 2a: Should export to DJI KMZ (valid ZIP binary)", async () => {
    const result = await exportMission(waypoints, { format: "dji-kmz" });
    expect(result.bytes).toBeDefined();
    expect(result.bytes![0]).toBe(0x50); // PK signature
    expect(result.bytes!.length).toBeGreaterThan(1000);
  });

  it("Step 2b: Should export to ArduPilot .waypoints (QGC WPL 110)", async () => {
    const result = await exportMission(waypoints, { format: "ardupilot-waypoints" });
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("QGC WPL 110")).toBe(true);
  });

  it("Step 2c: Should export to Litchi CSV", async () => {
    const result = await exportMission(waypoints, { format: "litchi-csv" });
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("latitude,longitude")).toBe(true);
  });

  it("Step 2d: Should export to senseFly XML", async () => {
    const result = await exportMission(waypoints, { format: "sensefly-xml" });
    expect(result.text).toBeDefined();
    expect(result.text!.includes("<Mission")).toBe(true);
  });

  it("Step 2e: Should export to generic KML", async () => {
    const result = await exportMission(waypoints, { format: "kml" });
    expect(result.text).toBeDefined();
    expect(result.text!.includes("<kml")).toBe(true);
  });

  // ─── Step 3+4: Round-Trip Verification (export → import → compare) ──

  it("Step 3a: ArduPilot .waypoints round-trip should preserve coordinates", async () => {
    const exported = await exportMission(waypoints, { format: "ardupilot-waypoints" });
    const imported = await importMission("ardupilot-waypoints", exported.text!);
    expect(imported.length).toBe(waypoints.length);
    for (let i = 0; i < imported.length; i++) {
      expect(imported[i]!.latitude).toBeCloseTo(waypoints[i]!.latitude, 5);
      expect(imported[i]!.longitude).toBeCloseTo(waypoints[i]!.longitude, 5);
    }
  });

  it("Step 3b: Litchi CSV round-trip should preserve coordinates", async () => {
    const exported = await exportMission(waypoints, { format: "litchi-csv" });
    const imported = await importMission("litchi-csv", exported.text!);
    expect(imported.length).toBe(waypoints.length);
    for (let i = 0; i < imported.length; i++) {
      expect(imported[i]!.latitude).toBeCloseTo(waypoints[i]!.latitude, 5);
      expect(imported[i]!.longitude).toBeCloseTo(waypoints[i]!.longitude, 5);
    }
  });

  it("Step 3c: senseFly XML round-trip should preserve coordinates", async () => {
    const exported = await exportMission(waypoints, { format: "sensefly-xml" });
    const imported = await importMission("sensefly-xml", exported.text!);
    expect(imported.length).toBe(waypoints.length);
    for (let i = 0; i < imported.length; i++) {
      expect(imported[i]!.latitude).toBeCloseTo(waypoints[i]!.latitude, 5);
      expect(imported[i]!.longitude).toBeCloseTo(waypoints[i]!.longitude, 5);
    }
  });

  it("Step 3d: KML round-trip should preserve coordinates", async () => {
    const exported = await exportMission(waypoints, { format: "kml" });
    const imported = await importMission("kml", exported.text!);
    expect(imported.length).toBe(waypoints.length);
    for (let i = 0; i < imported.length; i++) {
      expect(imported[i]!.latitude).toBeCloseTo(waypoints[i]!.latitude, 5);
      expect(imported[i]!.longitude).toBeCloseTo(waypoints[i]!.longitude, 5);
    }
  });

  it("Step 3e: DJI KMZ round-trip should preserve coordinates", async () => {
    const exported = await exportMission(waypoints, { format: "dji-kmz" });
    const imported = await importMission("dji-kmz", exported.bytes!);
    expect(imported.length).toBe(waypoints.length);
    for (let i = 0; i < imported.length; i++) {
      expect(imported[i]!.latitude).toBeCloseTo(waypoints[i]!.latitude, 4);
      expect(imported[i]!.longitude).toBeCloseTo(waypoints[i]!.longitude, 4);
    }
  });

  // ─── Step 5: Terrain-Aware Altitude ─────────────────────────────

  it("Step 5: Terrain-aware altitude should adjust AMSL elevations", () => {
    const elevation = elevationFromFunction(() => 1700); // Nairobi plateau
    const terrainWaypoints = makeTerrainAware(waypoints, elevation);

    for (const wp of terrainWaypoints) {
      // AMSL altitude = ground elevation (1700m) + AGL altitude (75m) = 1775m
      expect(wp.altitudeMeters).toBeCloseTo(1775, 0);
    }
  });

  // ─── Step 6: Battery Estimation ────────────────────────────────

  it("Step 6: Battery estimation should compute reasonable battery count", () => {
    const camera = getCameraById(CAMERA_ID);
    const battery = estimateBatteryAndTime(waypoints, { camera });

    expect(battery.batteryCount).toBeGreaterThanOrEqual(1);
    expect(battery.batteryCount).toBeLessThanOrEqual(5);
    expect(battery.flightTimeMin).toBeGreaterThan(30);
    expect(battery.usableFlightTimePerBatteryMin).toBeCloseTo(27, 0); // 45 * 0.75 * 0.8
  });

  // ─── Step 7: Report Generation ──────────────────────────────────

  it("Step 7: Flight plan report should contain all required sections", () => {
    const camera = getCameraById(CAMERA_ID);
    const bbox = computeBoundingBox(NAIROBI_SURVEY);
    const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
    const battery = estimateBatteryAndTime(waypoints, { camera });

    const report = generateFlightPlanReport({
      camera,
      params: originalParams,
      boundingBox: bbox,
      waypoints,
      battery,
      missionStats: stats,
      missionName: "E2E Test Mission",
    });

    expect(report.metadata.missionName).toBe("E2E Test Mission");
    expect(report.camera.id).toBe(CAMERA_ID);
    expect(report.flightPlan.gsdCmPx).toBeCloseTo(2.12, 1);
    expect(report.missionStats.totalWaypoints).toBe(waypoints.length);
    expect(report.battery.batteryCount).toBeGreaterThanOrEqual(1);
    expect(report.asprsCompliance.length).toBe(3);
    expect(report.footprintDiagramSvg).toContain("<svg");
    expect(report.flightPatternSvg).toContain("<svg");
  });

  // ─── Step 8: PDF Rendering ──────────────────────────────────────

  it("Step 8: PDF renderer should produce valid PDF bytes", async () => {
    const camera = getCameraById(CAMERA_ID);
    const bbox = computeBoundingBox(NAIROBI_SURVEY);
    const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
    const battery = estimateBatteryAndTime(waypoints, { camera });

    const report = generateFlightPlanReport({
      camera,
      params: originalParams,
      boundingBox: bbox,
      waypoints,
      battery,
      missionStats: stats,
      missionName: "E2E Test Mission PDF",
    });

    const pdfBytes = await renderReportToPdf(report);

    // Verify PDF starts with %PDF-
    const header = new TextDecoder().decode(pdfBytes.subarray(0, 5));
    expect(header).toBe("%PDF-");
    expect(pdfBytes.length).toBeGreaterThan(5000);
  });

  // ─── Step 10: IPC Schema Validation ─────────────────────────────

  it("Step 10a: IPC schema registry should have 42 channels", () => {
    const channels = listRegisteredChannels();
    expect(channels.length).toBe(42);
  });

  it("Step 10b: Valid drone:mission.plan input should pass validation", () => {
    const validInput = {
      cameraId: CAMERA_ID,
      altitudeM: ALTITUDE_M,
      frontOverlap: FRONT_OVERLAP,
      sideOverlap: SIDE_OVERLAP,
      area: NAIROBI_SURVEY,
    };
    const result = validateIpcInput("drone:mission.plan", validInput);
    expect(result.success).toBe(true);
  });

  it("Step 10c: Invalid drone:mission.plan (non-closed polygon) should fail", () => {
    const invalidInput = {
      cameraId: CAMERA_ID,
      altitudeM: ALTITUDE_M,
      frontOverlap: FRONT_OVERLAP,
      sideOverlap: SIDE_OVERLAP,
      area: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          // Missing closing point
        ],
      },
    };
    const result = validateIpcInput("drone:mission.plan", invalidInput);
    expect(result.success).toBe(false);
  });

  it("Step 10d: Unknown IPC channel should return CHANNEL_NOT_REGISTERED", () => {
    const result = validateIpcInput("nonexistent:action", {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CHANNEL_NOT_REGISTERED");
    }
  });
});

// ─── E2E: Sidecar RPC (if binary available) ───────────────────────

const SIDECAR_BIN = [
  join(__dirname, "..", "..", "metardu-sidecar", "target", "release", "metardu-sidecar"),
  "/home/z/my-project/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar",
].find(p => existsSync(p));

const skipIfNoBinary = SIDECAR_BIN && existsSync(SIDECAR_BIN) ? describe : describe.skip;

skipIfNoBinary("E2E: Sidecar RPC — Full Drone Mission Lifecycle", () => {
  let client: any;
  let api: any;

  beforeAll(async () => {
    const { SidecarClient, MetarduApi } = await import("../../electron-integration/src/index.js");
    client = new SidecarClient({
      binaryPath: SIDECAR_BIN!,
      callTimeoutMs: 5000,
      autoRestart: false,
    });
    await client.start();
    api = new MetarduApi(client);
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  it("Sidecar should respond to ping", async () => {
    const result = await api.ping();
    expect(result.pong).toBe(true);
  });

  it("Sidecar should list all registered methods", async () => {
    const result = await api.listMethods();
    expect(result.methods).toContain("ping");
    expect(result.methods).toContain("gdal_contour");
    expect(result.methods).toContain("mavlink_connect");
    expect(result.methods).toContain("odm_process");
    expect(result.methods).toContain("ml_extract_buildings");
  });

  it("Full drone mission lifecycle: connect → upload → arm → start → RTL → disconnect", async () => {
    // 1. Connect
    const connectResult = await api.mavlinkConnect({
      connectionUrl: "udp://:14540",
    });
    expect(connectResult.connected).toBe(true);

    // 2. Upload mission
    const uploadResult = await api.mavlinkUploadMission({
      waypoints: [
        { latitude: -1.2864, longitude: 36.8172, altitude_m: 75 },
        { latitude: -1.2854, longitude: 36.8172, altitude_m: 75 },
      ],
    });
    expect(uploadResult.waypoint_count).toBe(2);

    // 3. Arm
    const armResult = await api.mavlinkArm();
    expect(armResult.armed).toBe(true);

    // 4. Start mission
    const startResult = await api.mavlinkStartMission();
    expect(startResult.started).toBe(true);

    // 5. RTL
    const rtlResult = await api.mavlinkRtl();
    expect(rtlResult.rtl).toBe(true);

    // 6. Disconnect
    const disconnectResult = await api.mavlinkDisconnect();
    expect(disconnectResult.connected).toBe(false);
  });

  it("GDAL contour should reject nonexistent file", async () => {
    await expect(api.generateContours({
      dsmPath: "/nonexistent/file.tif",
      interval: 5.0,
    })).rejects.toThrow(/not found/);
  });

  it("ML building extraction should return placeholder without model", async () => {
    // Create a dummy file so the orthophoto_path check passes
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "metardu-e2e-"));
    const orthoPath = join(tmpDir, "ortho.tif");
    writeFileSync(orthoPath, "dummy");

    const result = await api.mlExtractBuildings({
      orthophotoPath: orthoPath,
    });
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
