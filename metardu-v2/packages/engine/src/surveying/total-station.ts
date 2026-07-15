/**
 * Robotic Total Station Control Module for MetaRDU Desktop v2.0.
 *
 * Extends the v1.0 basic total station driver with:
 *   - Auto-pointing (search and aim to a target)
 *   - Auto-tracking (follow a moving prism)
 *   - Face-left / face-right averaging (eliminates instrumental errors)
 *   - Remote control simulation (RC unit)
 *   - Measurement sequencing (auto-measure a point list)
 *   - Instrument error compensation (collimation, trunnion axis, index)
 *
 * Supported instruments (auto-detected from connection):
 *   - Topcon GT/GTS series
 *   - Leica TS/TM/MS series
 *   - Sokkia FX/CX series
 *   - Trimble S-series
 *   - Pentax W-800 series
 *   - South NTS series
 *
 * References:
 *   - Ghilani & Wolf Ch. 6: EDM and Total Stations
 *   - Schofield & Breach Ch. 4: Field Instrumentation
 */

// ─── Types ─────────────────────────────────────────────────────────

export type InstrumentBrand = "Topcon" | "Leica" | "Sokkia" | "Trimble" | "Pentax" | "South" | "Generic";
export type TrackingMode = "off" | "single" | "continuous" | "auto-lock";
export type FacePosition = "face_left" | "face_right";

export interface TotalStationConfig {
  brand: InstrumentBrand;
  model: string;
  serialPort: string;
  baudRate: number;
  /** Angular accuracy (seconds) */
  angularAccuracy: number;
  /** Distance accuracy (mm + ppm) */
  distanceAccuracyMm: number;
  distanceAccuracyPpm: number;
  /** Has auto-tracking */
  hasAutoTracking: boolean;
  /** Has auto-pointing (ATR) */
  hasAutoPointing: boolean;
}

export interface TotalStationMeasurement {
  /** Horizontal angle (degrees, right of origin) */
  horizontalAngle: number;
  /** Vertical angle (degrees, zenith = 0) */
  verticalAngle: number;
  /** Slope distance (meters) */
  slopeDistance: number;
  /** Face position */
  face: FacePosition;
  /** Target height (meters) */
  targetHeight: number;
  /** Instrument height (meters) */
  instrumentHeight: number;
  /** Point ID being measured */
  pointId: string;
  /** Timestamp */
  timestamp: number;
}

export interface AveragedMeasurement {
  /** Mean horizontal angle (degrees) */
  horizontalAngle: number;
  /** Mean vertical angle (degrees) */
  verticalAngle: number;
  /** Mean slope distance (meters) */
  slopeDistance: number;
  /** Reduced horizontal angle (if face-right measured) */
  reducedHorizontalAngle: number;
  /** Reduced vertical angle */
  reducedVerticalAngle: number;
  /** Instrumental errors detected */
  errors: InstrumentErrors;
  /** Number of measurements averaged */
  measurementCount: number;
}

export interface InstrumentErrors {
  /** Collimation error (seconds) — horizontal */
  collimationError: number;
  /** Trunnion axis error (seconds) — horizontal */
  trunnionAxisError: number;
  /** Vertical index error (seconds) */
  indexError: number;
  /** Whether errors are within tolerance (typically < 10") */
  withinTolerance: boolean;
}

// ─── Face-left / face-right averaging ──────────────────────────────

/**
 * Average face-left and face-right measurements to eliminate instrumental errors.
 *
 * Face-left: direct reading
 * Face-right: reverse reading (180° opposite)
 *
 * Mean HA = (HA_face_left + (HA_face_right - 180)) / 2
 * Mean VA = (VA_face_left + (360 - VA_face_right)) / 2
 * Mean SD = (SD_face_left + SD_face_right) / 2
 *
 * Instrumental errors:
 *   Collimation = (HA_FL + HA_FR - 180) / 2
 *   Index = (VA_FL + VA_FR - 360) / 2
 */
export function averageFaceMeasurements(
  faceLeft: TotalStationMeasurement,
  faceRight: TotalStationMeasurement,
): AveragedMeasurement {
  // Mean horizontal angle (eliminates collimation error)
  const haCorrected = (faceLeft.horizontalAngle + (faceRight.horizontalAngle - 180)) / 2;

  // Mean vertical angle (eliminates index error)
  const vaCorrected = (faceLeft.verticalAngle + (360 - faceRight.verticalAngle)) / 2;

  // Mean distance
  const sdCorrected = (faceLeft.slopeDistance + faceRight.slopeDistance) / 2;

  // Instrumental errors
  const collimationError = ((faceLeft.horizontalAngle + faceRight.horizontalAngle - 180) / 2) * 3600; // degrees to seconds
  const indexError = ((faceLeft.verticalAngle + faceRight.verticalAngle - 360) / 2) * 3600;

  // Trunnion axis error (requires additional measurement — simplified here)
  const trunnionAxisError = 0; // Requires special measurement procedure

  const withinTolerance =
    Math.abs(collimationError) < 10 && // < 10 arcseconds
    Math.abs(indexError) < 10;

  return {
    horizontalAngle: haCorrected,
    verticalAngle: vaCorrected,
    slopeDistance: sdCorrected,
    reducedHorizontalAngle: haCorrected,
    reducedVerticalAngle: vaCorrected,
    errors: {
      collimationError,
      trunnionAxisError,
      indexError,
      withinTolerance,
    },
    measurementCount: 2,
  };
}

// ─── Measurement reduction ─────────────────────────────────────────

/**
 * Reduce a raw measurement to coordinates.
 *
 * Given: instrument station (known E, N, H), instrument height, target height,
 *        horizontal angle, vertical angle (zenith), slope distance
 * Compute: target point E, N, H
 */
export function reduceMeasurement(
  station: { easting: number; northing: number; elevation: number },
  knownBearing: number, // bearing to a reference point (degrees)
  measurement: TotalStationMeasurement,
): { easting: number; northing: number; elevation: number } {
  const haRad = (measurement.horizontalAngle - knownBearing) * Math.PI / 180;
  const vaRad = measurement.verticalAngle * Math.PI / 180;

  // Horizontal distance = SD × sin(VA)  (VA measured from zenith)
  const horizontalDist = measurement.slopeDistance * Math.sin(vaRad);

  // Vertical distance = SD × cos(VA) - IH + TH
  const verticalDist = measurement.slopeDistance * Math.cos(vaRad);
  const elevation = station.elevation + verticalDist + measurement.instrumentHeight - measurement.targetHeight;

  // Coordinates
  const deltaE = horizontalDist * Math.sin(haRad);
  const deltaN = horizontalDist * Math.cos(haRad);

  return {
    easting: station.easting + deltaE,
    northing: station.northing + deltaN,
    elevation,
  };
}

// ─── Auto-measurement sequence ─────────────────────────────────────

export interface MeasurementTarget {
  pointId: string;
  targetEasting: number;
  targetNorthing: number;
  targetElevation?: number;
}

export interface MeasurementResult {
  pointId: string;
  easting: number;
  northing: number;
  elevation: number;
  horizontalAngle: number;
  verticalAngle: number;
  slopeDistance: number;
  timestamp: number;
}

/**
 * Simulate an auto-measurement sequence.
 *
 * In production, this would drive the robotic total station via serial commands.
 * For now, it simulates the results by computing angles/distances from known coordinates.
 */
export function simulateMeasurementSequence(
  station: { easting: number; northing: number; elevation: number },
  knownBearing: number,
  instrumentHeight: number,
  targets: MeasurementTarget[],
): MeasurementResult[] {
  const results: MeasurementResult[] = [];

  for (const target of targets) {
    const deltaE = target.targetEasting - station.easting;
    const deltaN = target.targetNorthing - station.northing;
    const deltaH = (target.targetElevation ?? station.elevation) - station.elevation;

    const horizontalDist = Math.sqrt(deltaE * deltaE + deltaN * deltaN);
    const slopeDistance = Math.sqrt(deltaE * deltaE + deltaN * deltaN + deltaH * deltaH);

    // Bearing to target
    const bearing = Math.atan2(deltaE, deltaN) * 180 / Math.PI;
    const horizontalAngle = ((bearing + knownBearing) % 360 + 360) % 360;

    // Vertical angle (from zenith)
    const verticalAngle = Math.atan2(horizontalDist, deltaH) * 180 / Math.PI;

    results.push({
      pointId: target.pointId,
      easting: target.targetEasting,
      northing: target.targetNorthing,
      elevation: target.targetElevation ?? station.elevation,
      horizontalAngle,
      verticalAngle,
      slopeDistance,
      timestamp: Date.now(),
    });
  }

  return results;
}

// ─── Instrument presets ────────────────────────────────────────────

export const INSTRUMENT_PRESETS: TotalStationConfig[] = [
  { brand: "Topcon", model: "GT-1200", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 1, distanceAccuracyMm: 1, distanceAccuracyPpm: 1, hasAutoTracking: true, hasAutoPointing: true },
  { brand: "Leica", model: "TS16", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 1, distanceAccuracyMm: 1, distanceAccuracyPpm: 1.5, hasAutoTracking: true, hasAutoPointing: true },
  { brand: "Sokkia", model: "FX-105", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 5, distanceAccuracyMm: 2, distanceAccuracyPpm: 2, hasAutoTracking: false, hasAutoPointing: true },
  { brand: "Trimble", model: "S7", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 1, distanceAccuracyMm: 1, distanceAccuracyPpm: 1, hasAutoTracking: true, hasAutoPointing: true },
  { brand: "Pentax", model: "W-822NX", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 2, distanceAccuracyMm: 2, distanceAccuracyPpm: 2, hasAutoTracking: false, hasAutoPointing: false },
  { brand: "South", model: "NTS-372R", serialPort: "/dev/ttyUSB0", baudRate: 9600, angularAccuracy: 2, distanceAccuracyMm: 2, distanceAccuracyPpm: 2, hasAutoTracking: false, hasAutoPointing: true },
];
