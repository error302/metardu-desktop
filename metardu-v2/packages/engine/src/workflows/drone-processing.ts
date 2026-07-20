/**
 * Drone data processing pipeline — photogrammetry workflow.
 *
 * Inspired by TrialDroneDataProcessing and the metardu web app's /drone
 * page. Orchestrates the processing of drone photos into:
 *   - Orthophoto (georeferenced aerial image mosaic)
 *   - DSM (Digital Surface Model)
 *   - DTM (Digital Terrain Model)
 *   - 3D Point Cloud (RGB-colored)
 *   - Contour lines (derived from DSM/DTM)
 *
 * # References
 *   - OpenDroneMap docs: https://docs.opendronemap.org/
 *   - ASPRS 2014 accuracy standards
 *   - Annex 6 (KETRACO): 30cm GSD, 2m contours, 1:2500 topo maps
 */

import type { CountrySurveyConfig } from "@metardu/country-config";

export interface DronePhoto {
  filename: string;
  path: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  timestamp?: string;
}

export interface GCP {
  id: string;
  latitude: number;
  longitude: number;
  elevation: number;
  pixelCoordinates?: { photo: string; x: number; y: number }[];
}

export interface ProcessingQuality {
  achievedGsdCmPx: number;
  averageOverlap: number;
  photoCount: number;
  areaHa: number;
  pointDensity: number;
  rmsError: number;
  asprsClass: "Class 1" | "Class 2" | "Class 3" | "Not Met";
}

export interface ProcessingResult {
  orthophotoPath: string;
  dsmPath: string;
  dtmPath: string;
  pointCloudPath: string;
  contours: { elevation: number; coordinates: [number, number][] }[];
  quality: ProcessingQuality;
  processingTimeSec: number;
  log: string[];
}

export interface DroneProcessingInput {
  photos: DronePhoto[];
  gcps?: GCP[];
  outputDir: string;
  targetGsdCmPx: number;
  contourInterval: number;
  country: CountrySurveyConfig;
  focalLengthMm?: number;
  pixelSizeUm?: number;
}

/** Validate drone photos before processing. */
export function validatePhotos(photos: DronePhoto[]): {
  valid: boolean; errors: string[]; warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (photos.length < 5) {
    errors.push(`Need at least 5 photos for ODM processing; got ${photos.length}.`);
  }
  let noGpsCount = 0;
  for (const photo of photos) {
    if (photo.latitude === undefined || photo.longitude === undefined) noGpsCount++;
  }
  if (noGpsCount === photos.length) {
    errors.push(`${noGpsCount}/${photos.length} photos have no GPS data. ODM requires GPS.`);
  } else if (noGpsCount > 0) {
    warnings.push(`${noGpsCount}/${photos.length} photos have no GPS data.`);
  }
  const supportedExts = [".jpg", ".jpeg", ".tif", ".tiff"];
  for (const photo of photos) {
    const ext = photo.filename.toLowerCase().substring(photo.filename.lastIndexOf("."));
    if (!supportedExts.includes(ext)) {
      errors.push(`Unsupported file: ${photo.filename} (${ext})`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Compute GSD: GSD = (pixelSize × altitude) / focalLength */
export function computeGsd(pixelSizeUm: number, altitudeM: number, focalLengthMm: number): number {
  return (pixelSizeUm * altitudeM) / (focalLengthMm * 1000) * 100;
}

/** Compute required altitude for a target GSD. */
export function altitudeForGsd(targetGsdCmPx: number, focalLengthMm: number, pixelSizeUm: number): number {
  return (targetGsdCmPx / 100) * (focalLengthMm * 1000) / pixelSizeUm;
}

/** Classify against ASPRS 2014 standards. */
export function classifyAsprs(rmsError: number, gsdCmPx: number): ProcessingQuality["asprsClass"] {
  const ratio = rmsError / gsdCmPx;
  if (ratio <= 1.0) return "Class 1";
  if (ratio <= 2.0) return "Class 2";
  if (ratio <= 3.0) return "Class 3";
  return "Not Met";
}

/** Haversine distance (metres). */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Estimate photo overlap from GPS positions. */
export function estimateOverlap(photos: DronePhoto[], _footprintW: number, footprintH: number): {
  forward: number; side: number;
} {
  if (photos.length < 2) return { forward: 0, side: 0 };
  const distances: number[] = [];
  for (let i = 0; i < photos.length - 1; i++) {
    const a = photos[i]!; const b = photos[i + 1]!;
    if (a.latitude === undefined || b.latitude === undefined) continue;
    distances.push(haversine(a.latitude, a.longitude!, b.latitude, b.longitude!));
  }
  if (distances.length === 0) return { forward: 0, side: 0 };
  const avgFwd = distances.reduce((s, d) => s + d, 0) / distances.length;
  const fwdOverlap = Math.max(0, Math.min(99, (1 - avgFwd / footprintH) * 100));
  return { forward: fwdOverlap, side: 60 };
}

/** Generate a processing report. */
export function generateProcessingReport(input: DroneProcessingInput, result: ProcessingResult): Record<string, unknown> {
  return {
    projectDetails: {
      photoCount: input.photos.length,
      gcpCount: input.gcps?.length ?? 0,
      targetGsdCmPx: input.targetGsdCmPx,
      contourInterval: input.contourInterval,
      country: input.country.countryName,
      srid: input.country.geodeticFramework.primarySRID,
    },
    quality: result.quality,
    outputs: {
      orthophoto: result.orthophotoPath,
      dsm: result.dsmPath,
      dtm: result.dtmPath,
      pointCloud: result.pointCloudPath,
      contourCount: result.contours.length,
    },
    processingTime: `${result.processingTimeSec.toFixed(1)}s`,
    asprsClass: result.quality.asprsClass,
  };
}
