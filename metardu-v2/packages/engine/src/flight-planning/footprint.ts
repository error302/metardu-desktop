/**
 * Camera footprint math for drone flight planning.
 *
 * This module implements the fundamental photogrammetry formulas used to:
 *   - Compute Ground Sample Distance (GSD) at a given altitude
 *   - Compute the image footprint on the ground at a given altitude
 *   - Compute the line spacing and photo spacing given overlap requirements
 *   - Compute the altitude required to achieve a target GSD
 *
 * References:
 *   - Colomina, I., & Molina, P. (2014). "UAV photogrammetry for mapping."
 *     ISPRS International Journal of Geo-Information.
 *   - ASPRS (2014). "Positional Accuracy Standards for Digital Geospatial Data."
 *   - Pix4D documentation: https://support.pix4d.com/hc/en-us/articles/202559889
 *
 * All formulas use SI units internally:
 *   - Distances: meters (m)
 *   - Altitude: meters above ground level (AGL)
 *   - GSD: centimeters per pixel (cm/px) for output, meters per pixel internally
 *   - Sensor dimensions: millimeters (mm)
 *   - Focal length: millimeters (mm)
 *   - Pixel size: micrometers (µm)
 */

import type { CameraSpec } from "./cameras.js";
import { pixelSizeMicrometers } from "./cameras.js";

/**
 * Compute Ground Sample Distance (GSD) at a given altitude.
 *
 * Formula:
 *   GSD = (pixelSize * altitude) / focalLength
 *
 * where pixelSize and focalLength are in the same unit (we use µm and mm,
 * so we convert: 1 µm = 0.001 mm, giving GSD in meters).
 *
 * Equivalently:
 *   GSD = (sensorWidth / imageWidth) * altitude / focalLength
 *
 * Returns GSD in meters per pixel.
 *
 * @param camera Camera spec
 * @param altitudeMetersAltitudeAGL Altitude above ground level in meters
 * @returns GSD in meters per pixel
 */
export function gsdMetersPerPixel(
  camera: CameraSpec,
  altitudeMetersAltitudeAGL: number
): number {
  if (altitudeMetersAltitudeAGL <= 0) {
    throw new Error(`Altitude must be positive, got ${altitudeMetersAltitudeAGL}`);
  }
  // Convert pixel size from µm to mm: pixelSize_mm = pixelSize_µm / 1000
  // GSD = pixelSize_mm * altitude / focalLength
  //     = (pixelSize_µm / 1000) * altitude / focalLength
  const pixelSizeMm = pixelSizeMicrometers(camera) / 1000;
  return (pixelSizeMm * altitudeMetersAltitudeAGL) / camera.focalLengthMm;
}

/**
 * Compute GSD in centimeters per pixel (the industry-standard reporting unit).
 *
 * @returns GSD in cm/px
 */
export function gsdCentimetersPerPixel(
  camera: CameraSpec,
  altitudeMetersAGL: number
): number {
  return gsdMetersPerPixel(camera, altitudeMetersAGL) * 100;
}

/**
 * Compute the altitude required to achieve a target GSD.
 *
 * Inverse of gsdMetersPerPixel:
 *   altitude = GSD * focalLength / pixelSize
 *
 * @param targetGsdCmPx Desired GSD in cm/px
 * @returns Altitude in meters AGL
 */
export function altitudeForGsd(
  camera: CameraSpec,
  targetGsdCmPx: number
): number {
  if (targetGsdCmPx <= 0) {
    throw new Error(`Target GSD must be positive, got ${targetGsdCmPx}`);
  }
  const targetGsdM = targetGsdCmPx / 100;
  const pixelSizeMm = pixelSizeMicrometers(camera) / 1000;
  return (targetGsdM * camera.focalLengthMm) / pixelSizeMm;
}

/**
 * Compute the image footprint on the ground at a given altitude.
 *
 * The footprint is the area of ground captured by a single photo.
 *
 * Formulas:
 *   footprintWidth  = (altitude * sensorWidth)  / focalLength
 *   footprintHeight = (altitude * sensorHeight) / focalLength
 *
 * @returns { width, height } in meters
 */
export function footprintMeters(
  camera: CameraSpec,
  altitudeMetersAGL: number
): { widthMeters: number; heightMeters: number } {
  if (altitudeMetersAGL <= 0) {
    throw new Error(`Altitude must be positive, got ${altitudeMetersAGL}`);
  }
  const widthMeters =
    (altitudeMetersAGL * camera.sensorWidthMm) / camera.focalLengthMm;
  const heightMeters =
    (altitudeMetersAGL * camera.sensorHeightMm) / camera.focalLengthMm;
  return { widthMeters, heightMeters };
}

/**
 * Compute the photo spacing along a flight line and the line spacing
 * between flight lines, given the overlap requirements.
 *
 * Formulas:
 *   photoSpacing = footprintWidth  * (1 - frontOverlap)
 *   lineSpacing  = footprintHeight * (1 - sideOverlap)
 *
 * Note: by convention, "front overlap" is the overlap between consecutive
 * photos along the flight direction (typically the image width direction),
 * and "side overlap" is the overlap between adjacent flight lines (image height).
 *
 * @param footprint Output of footprintMeters()
 * @param frontOverlap Fraction 0-1 (e.g., 0.75 for 75%)
 * @param sideOverlap Fraction 0-1 (e.g., 0.65 for 65%)
 */
export function spacingMeters(
  footprint: { widthMeters: number; heightMeters: number },
  frontOverlap: number,
  sideOverlap: number
): { photoSpacingMeters: number; lineSpacingMeters: number } {
  if (frontOverlap < 0 || frontOverlap >= 1) {
    throw new Error(
      `frontOverlap must be in [0, 1), got ${frontOverlap}`
    );
  }
  if (sideOverlap < 0 || sideOverlap >= 1) {
    throw new Error(
      `sideOverlap must be in [0, 1), got ${sideOverlap}`
    );
  }
  const photoSpacingMeters = footprint.widthMeters * (1 - frontOverlap);
  const lineSpacingMeters = footprint.heightMeters * (1 - sideOverlap);
  return { photoSpacingMeters, lineSpacingMeters };
}

/**
 * Full flight plan parameters derived from a camera, altitude, and overlaps.
 *
 * This is the single-call convenience function that returns everything
 * the UI needs to display a flight plan summary.
 */
export interface FlightPlanParameters {
  /** GSD in cm/px */
  gsdCmPx: number;
  /** GSD in m/px (for internal use) */
  gsdMPx: number;
  /** Image footprint on the ground (meters) */
  footprintWidthM: number;
  footprintHeightM: number;
  /** Distance between photo trigger points along a flight line (meters) */
  photoSpacingM: number;
  /** Distance between adjacent flight lines (meters) */
  lineSpacingM: number;
  /** Altitude above ground level (meters) */
  altitudeM: number;
  /** Front overlap fraction (0-1) */
  frontOverlap: number;
  /** Side overlap fraction (0-1) */
  sideOverlap: number;
  /** Camera used */
  cameraId: string;
}

/**
 * Compute all flight plan parameters at once.
 *
 * @param camera Camera spec
 * @param altitudeMetersAGL Altitude above ground level in meters
 * @param frontOverlap Front overlap fraction (0-1, e.g., 0.75 for 75%)
 * @param sideOverlap Side overlap fraction (0-1, e.g., 0.65 for 65%)
 */
export function computeFlightPlanParameters(
  camera: CameraSpec,
  altitudeMetersAGL: number,
  frontOverlap: number,
  sideOverlap: number
): FlightPlanParameters {
  const fp = footprintMeters(camera, altitudeMetersAGL);
  const sp = spacingMeters(fp, frontOverlap, sideOverlap);
  const gsdM = gsdMetersPerPixel(camera, altitudeMetersAGL);
  return {
    gsdCmPx: gsdM * 100,
    gsdMPx: gsdM,
    footprintWidthM: fp.widthMeters,
    footprintHeightM: fp.heightMeters,
    photoSpacingM: sp.photoSpacingMeters,
    lineSpacingM: sp.lineSpacingMeters,
    altitudeM: altitudeMetersAGL,
    frontOverlap,
    sideOverlap,
    cameraId: camera.id,
  };
}

/**
 * Compute the number of photos per flight line and the number of flight lines
 * required to cover a survey area.
 *
 * @param params Flight plan parameters
 * @param areaWidthMeters Width of the survey area along the flight direction (meters)
 * @param areaHeightMeters Height of the survey area perpendicular to flight direction (meters)
 * @param margin Fraction of the area to extend beyond (e.g., 0.1 for 10% buffer)
 */
export function photoAndLineCount(
  params: FlightPlanParameters,
  areaWidthMeters: number,
  areaHeightMeters: number,
  margin: number = 0.1
): { photoCount: number; lineCount: number; totalPhotos: number } {
  if (areaWidthMeters <= 0 || areaHeightMeters <= 0) {
    throw new Error("Area dimensions must be positive");
  }
  if (margin < 0 || margin > 1) {
    throw new Error("Margin must be in [0, 1]");
  }

  // Extend the area by the margin on each side
  const effectiveWidth = areaWidthMeters * (1 + 2 * margin);
  const effectiveHeight = areaHeightMeters * (1 + 2 * margin);

  // Number of photos per line: distance / spacing + 1 (to cover the last bit)
  const photoCount = Math.ceil(effectiveWidth / params.photoSpacingM) + 1;
  // Number of flight lines: distance / spacing + 1
  const lineCount = Math.ceil(effectiveHeight / params.lineSpacingM) + 1;
  const totalPhotos = photoCount * lineCount;

  return { photoCount, lineCount, totalPhotos };
}
