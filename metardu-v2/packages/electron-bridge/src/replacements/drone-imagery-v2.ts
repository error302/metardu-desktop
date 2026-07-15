/**
 * REPLACE: apps/desktop/electron/drone-imagery.ts
 *
 * This file replaces the v1.0 drone-imagery.ts which had placeholder
 * functions that returned synthetic data. The v2.0 version uses:
 *   - @metardu/engine-flight-planning for flight planning math
 *   - The Rust sidecar (via MetarduApi) for GDAL contour generation
 *   - The Rust sidecar for ML feature extraction
 *
 * The function signatures are kept compatible with v1.0 where possible
 * to minimize UI changes. New functions are added for v2.0 features.
 */

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
  generateFlightPlanReport,
  type Waypoint,
  type FlightPlanParameters,
  type CameraSpec,
} from "@metardu/engine-flight-planning";

import { getApi } from "./sidecar-manager.js";

// ─── Types (kept compatible with v1.0) ─────────────────────────────

export interface DroneDataset {
  id: string;
  name: string;
  source: "odm" | "pix4d" | "agisoft";
  createdAt: string;
  orthophotoPath?: string;
  dsmPath?: string;
  dtmPath?: string;
  pointCloudPath?: string;
  contourPath?: string;
  gsdCmPx?: number;
}

export interface FlightPlanResult {
  params: FlightPlanParameters;
  waypoints: Waypoint[];
  stats: ReturnType<typeof computeMissionStats>;
  battery: ReturnType<typeof estimateBatteryAndTime>;
}

export interface ContourResult {
  count: number;
  minElevation: number;
  maxElevation: number;
  interval: number;
  geojson: string;
}

export interface FeatureExtractionResult {
  success: boolean;
  featureCount: number;
  geojson: string;
  warnings: string[];
}

// ─── Flight Planning (NEW in v2.0 — replaces the v1.0 placeholder) ──

/**
 * Plan a drone survey mission.
 *
 * This is the main entry point for the flight planning UI. It computes
 * all flight parameters, generates waypoints, and estimates battery usage.
 *
 * v1.0 had NO flight planning — this is entirely new.
 */
export function planMission(params: {
  cameraId: string;
  altitudeM: number;
  frontOverlap: number;
  sideOverlap: number;
  area: {
    coordinates: Array<{ lat: number; lng: number }>;
  };
  margin?: number;
}): FlightPlanResult {
  const camera = getCameraById(params.cameraId);
  const flightParams = computeFlightPlanParameters(
    camera,
    params.altitudeM,
    params.frontOverlap,
    params.sideOverlap
  );
  const waypoints = generateLawnmowerWaypoints({
    params: flightParams,
    area: params.area,
    margin: params.margin ?? 0.1,
  });
  const bbox = computeBoundingBox(params.area);
  const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
  const battery = estimateBatteryAndTime(waypoints, { camera });

  return {
    params: flightParams,
    waypoints,
    stats,
    battery,
  };
}

/**
 * Export a mission to a file.
 *
 * Supports all 5 formats: DJI KMZ, ArduPilot .waypoints, Litchi CSV,
 * senseFly XML, generic KML.
 */
export async function exportMissionToFile(
  waypoints: Waypoint[],
  format: "dji-kmz" | "ardupilot-waypoints" | "litchi-csv" | "sensefly-xml" | "kml",
  outputPath: string
): Promise<void> {
  const result = await exportMission(waypoints, { format });
  const fs = await import("node:fs");
  if (result.text) {
    await fs.promises.writeFile(outputPath, result.text, "utf-8");
  } else if (result.bytes) {
    await fs.promises.writeFile(outputPath, result.bytes);
  }
}

// ─── Contour Generation (REPLACES v1.0 placeholder) ────────────────

/**
 * Generate contours from a DSM GeoTIFF.
 *
 * v1.0 returned synthetic concentric circles. v2.0 uses the Rust sidecar
 * with real GDAL bindings to generate actual contours from the raster data.
 *
 * Falls back to an error if the sidecar is not running.
 */
export async function generateContoursFromDSM(params: {
  dsmPath: string;
  interval: number;
  outputPath?: string;
}): Promise<ContourResult> {
  const api = getApi();
  if (!api) {
    throw new Error(
      "Sidecar is not running. Cannot generate contours. " +
      "Start the sidecar or use an external tool (gdal_contour CLI)."
    );
  }

  const result = await api.generateContours({
    dsmPath: params.dsmPath,
    interval: params.interval,
    format: "geojson",
    outputPath: params.outputPath,
  });

  return {
    count: result.count,
    minElevation: result.min_elevation,
    maxElevation: result.max_elevation,
    interval: result.interval,
    geojson: result.geojson ?? "",
  };
}

// ─── Feature Extraction (REPLACES v1.0 placeholder) ────────────────

/**
 * Extract building footprints from an orthophoto.
 *
 * v1.0 returned 10 hardcoded square polygons. v2.0 uses the Rust sidecar
 * with ONNX Runtime to run a pre-trained U-Net model.
 *
 * Falls back to an error if the sidecar is not running or no model is bundled.
 */
export async function extractFeaturesFromOrthophoto(params: {
  orthophotoPath: string;
  featureType: "buildings" | "roads" | "changes";
  previousOrthophotoPath?: string;
}): Promise<FeatureExtractionResult> {
  const api = getApi();
  if (!api) {
    throw new Error(
      "Sidecar is not running. Cannot extract features. " +
      "Start the sidecar or use an external tool."
    );
  }

  let result;
  switch (params.featureType) {
    case "buildings":
      result = await api.mlExtractBuildings({
        orthophotoPath: params.orthophotoPath,
      });
      break;
    case "roads":
      result = await api.mlExtractRoads({
        orthophotoPath: params.orthophotoPath,
      });
      break;
    case "changes":
      if (!params.previousOrthophotoPath) {
        throw new Error("previousOrthophotoPath is required for change detection");
      }
      result = await api.mlExtractChanges({
        orthophotoPath: params.orthophotoPath,
        previousOrthophotoPath: params.previousOrthophotoPath,
      });
      break;
  }

  return {
    success: result.success,
    featureCount: result.feature_count,
    geojson: result.geojson,
    warnings: result.warnings,
  };
}

// ─── Photogrammetry (NEW in v2.0 — in-app ODM) ─────────────────────

/**
 * Process drone photos through OpenDroneMap.
 *
 * v1.0 delegated to an external WebODM server. v2.0 runs ODM locally
 * via the Rust sidecar (Docker container or native binary).
 *
 * Falls back to an error if the sidecar is not running.
 */
export async function processPhotos(params: {
  photosPath: string;
  outputPath: string;
  gcpPath?: string;
  orthophotoResolutionCm?: number;
  dsm?: boolean;
  dtm?: boolean;
  mode?: "docker" | "native" | "shell-out";
}): Promise<DroneDataset> {
  const api = getApi();
  if (!api) {
    throw new Error(
      "Sidecar is not running. Cannot process photos. " +
      "Start the sidecar or use an external WebODM server."
    );
  }

  const result = await api.odmProcess({
    photosPath: params.photosPath,
    outputPath: params.outputPath,
    gcpPath: params.gcpPath,
    orthophotoResolutionCm: params.orthophotoResolutionCm ?? 5,
    dsm: params.dsm ?? true,
    dtm: params.dtm ?? true,
    mode: params.mode ?? "docker",
  });

  if (!result.success) {
    throw new Error(`ODM processing failed: ${result.status}`);
  }

  return {
    id: crypto.randomUUID(),
    name: `ODM ${new Date().toISOString()}`,
    source: "odm",
    createdAt: new Date().toISOString(),
    orthophotoPath: result.orthophoto_path ?? undefined,
    dsmPath: result.dsm_path ?? undefined,
    dtmPath: result.dtm_path ?? undefined,
    pointCloudPath: result.point_cloud_path ?? undefined,
    contourPath: result.contour_path ?? undefined,
  };
}

// ─── Live Drone Telemetry (NEW in v2.0 — MAVSDK) ───────────────────

/**
 * Connect to a drone via MAVLink.
 *
 * v1.0 had no live drone connectivity. v2.0 uses the Rust sidecar with
 * MAVSDK-Rust for live telemetry and mission upload.
 */
export async function connectToDrone(params: {
  connectionUrl: string;
  baudRate?: number;
}): Promise<{ connected: boolean }> {
  const api = getApi();
  if (!api) {
    throw new Error("Sidecar is not running. Cannot connect to drone.");
  }
  return api.mavlinkConnect(params);
}

/**
 * Get the latest telemetry from the connected drone.
 */
export async function getDroneTelemetry(): Promise<{
  flight_mode: string | null;
  armed: boolean | null;
  latitude: number | null;
  longitude: number | null;
  altitude_amsl_m: number | null;
  battery_percent: number | null;
  gps_satellites: number | null;
}> {
  const api = getApi();
  if (!api) {
    throw new Error("Sidecar is not running. Cannot get telemetry.");
  }
  return api.mavlinkGetTelemetry();
}

/**
 * Upload a mission to the connected drone.
 */
export async function uploadMissionToDrone(waypoints: Waypoint[]): Promise<{
  waypoint_count: number;
  mission_id: number;
}> {
  const api = getApi();
  if (!api) {
    throw new Error("Sidecar is not running. Cannot upload mission.");
  }
  return api.mavlinkUploadMission({
    waypoints: waypoints.map(wp => ({
      latitude: wp.latitude,
      longitude: wp.longitude,
      altitude_m: wp.altitudeMeters,
    })),
  });
}

// ─── Report Generation (NEW in v2.0) ───────────────────────────────

/**
 * Generate a flight plan summary report (JSON).
 *
 * This is consumed by the PDF renderer to produce a print-ready PDF.
 */
export function generateReport(params: {
  cameraId: string;
  altitudeM: number;
  frontOverlap: number;
  sideOverlap: number;
  area: { coordinates: Array<{ lat: number; lng: number }> };
  missionName?: string;
  surveyorName?: string;
  projectRef?: string;
}): ReturnType<typeof generateFlightPlanReport> {
  const camera = getCameraById(params.cameraId);
  const flightParams = computeFlightPlanParameters(
    camera, params.altitudeM, params.frontOverlap, params.sideOverlap
  );
  const waypoints = generateLawnmowerWaypoints({ params: flightParams, area: params.area });
  const bbox = computeBoundingBox(params.area);
  const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
  const battery = estimateBatteryAndTime(waypoints, { camera });

  return generateFlightPlanReport({
    camera,
    params: flightParams,
    boundingBox: bbox,
    waypoints,
    battery,
    missionStats: stats,
    missionName: params.missionName,
    surveyorName: params.surveyorName,
    projectRef: params.projectRef,
  });
}

// ─── Camera Database (NEW in v2.0) ─────────────────────────────────

/**
 * List all available cameras.
 */
export function listCameras(): Array<{
  id: string;
  name: string;
  manufacturer: string;
  category: string;
}> {
  const { CAMERA_DATABASE } = require("@metardu/engine-flight-planning");
  return CAMERA_DATABASE.map((c: CameraSpec) => ({
    id: c.id,
    name: c.name,
    manufacturer: c.manufacturer,
    category: c.category,
  }));
}
