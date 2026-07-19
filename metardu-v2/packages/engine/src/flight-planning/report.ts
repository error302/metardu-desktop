/**
 * Flight plan summary report generator.
 *
 * Produces a structured JSON report containing everything needed to render
 * a PDF survey report. The desktop app's React layer will consume this JSON
 * and render it to PDF using pdf-lib or jsPDF.
 *
 * The report includes:
 *   - Mission metadata (camera, altitude, overlaps, GSD)
 *   - Survey area bounding box and dimensions
 *   - Camera footprint diagram as SVG (for embedding in PDF)
 *   - Mission statistics (waypoints, flight lines, distance, time)
 *   - Battery estimation (battery count, swap points)
 *   - ASPRS 2014 compliance check (which class the GSD supports)
 *   - Terrain statistics (if terrain-aware mode was used)
 *
 * Reference standards:
 *   - ASPRS 2014 Positional Accuracy Standards for Digital Geospatial Data
 *   - RDM 1.1 (Kenya Roads Design Manual, 2025)
 *   - Survey Act Cap. 299 (Kenya)
 */

import type { CameraSpec } from "./cameras.js";
import type { FlightPlanParameters } from "./footprint.js";
import type { Waypoint, BoundingBox, MissionStats } from "./waypoints.js";
import type { BatteryEstimation } from "./battery.js";
import type { TerrainStats } from "./terrain.js";

/**
 * ASPRS 2014 accuracy classes.
 *
 * For photogrammetry, the GSD must be at least as fine as the class requires
 * to support that accuracy tier.
 *
 * Source: ASPRS Positional Accuracy Standards for Digital Geospatial Data (2014)
 */
export interface AsprsClass {
  name: string;
  /** Required horizontal RMSE in centimeters */
  horizontalRmseCm: number;
  /** Required vertical RMSE in centimeters */
  verticalRmseCm: number;
  /** Maximum GSD that supports this class (cm/px) */
  maxGsdCmPx: number;
  /** Scale equivalent (e.g., 1:500) */
  scaleEquivalent: string;
}

export const ASPRS_CLASSES: readonly AsprsClass[] = [
  {
    name: "Class I",
    horizontalRmseCm: 7.5,
    verticalRmseCm: 15,
    maxGsdCmPx: 5.0,
    scaleEquivalent: "1:500",
  },
  {
    name: "Class II",
    horizontalRmseCm: 15,
    verticalRmseCm: 30,
    maxGsdCmPx: 10.0,
    scaleEquivalent: "1:1000",
  },
  {
    name: "Class III",
    horizontalRmseCm: 37.5,
    verticalRmseCm: 75,
    maxGsdCmPx: 25.0,
    scaleEquivalent: "1:2500",
  },
] as const;

/**
 * Check which ASPRS accuracy classes are supported by a given GSD.
 *
 * A class is "supported" if the GSD is at least as fine as (≤) the class's
 * maxGsdCmPx. Higher classes (Class I) require finer GSD.
 */
export function checkAsprsCompliance(gsdCmPx: number): Array<{
  asprsClass: AsprsClass;
  supported: boolean;
  marginCmPx: number; // negative means unsupported by this many cm/px
}> {
  return ASPRS_CLASSES.map((cls) => ({
    asprsClass: cls,
    supported: gsdCmPx <= cls.maxGsdCmPx,
    marginCmPx: cls.maxGsdCmPx - gsdCmPx,
  }));
}

/**
 * RDM 1.1 / Cap. 299 compliance checks (Kenya-specific).
 */
export interface KenyaComplianceCheck {
  /** Levelling closure tolerance: 10 × √K mm where K is line length in km */
  levellingToleranceMm: (lineLengthKm: number) => number;
  /** Angular misclosure: 15" × √N where N is number of stations */
  angularMisclosureArcsec: (stationCount: number) => number;
  /** Linear misclosure for urban surveys: 1:10000 */
  urbanLinearMisclosure: string;
  /** Linear misclosure for rural surveys: 1:5000 */
  ruralLinearMisclosure: string;
}

// Phase 5: source levelling tolerance + angular misclosure from
// country-config (canonical Kenya config per ADR-0004). We delegate to
// the country-config helpers so that any future update to the Kenya
// regulations propagates here automatically.
//
// Note: the previous version of this object used a 15 × √N formula for
// angular misclosure, but the Kenya Survey Regulations 1994 §4.3
// actually specifies 3.0 × √N (per the cited source in country-config).
// The previous value was a bug — it would have allowed ~5x larger
// angular misclosures than the regulation permits. We delegate to the
// correct formula from country-config now.
//
// Backward compatibility: the existing report.ts tests (in
// flight-planning/tests/report.test.ts) only check that KENYA_COMPLIANCE
// exists and has the right shape — they don't assert specific numeric
// values for the levelling/angular formulas. So this delegation is
// behavior-preserving for those tests, AND it fixes the latent
// 15× vs 3× bug.
import {
  KENYA as KENYA_CONFIG,
  levellingToleranceMm as ccLevellingToleranceMm,
  angularMisclosureToleranceArcsec as ccAngularMisclosureArcsec,
} from "@metardu/country-config";

export const KENYA_COMPLIANCE: KenyaComplianceCheck = {
  levellingToleranceMm: (k) => ccLevellingToleranceMm(KENYA_CONFIG, k),
  // Note: the previous code used 15 × √N for "angular misclosure", but
  // that was actually the 15-COURSE AZIMUTH CHECK (a different test).
  // The per-station angular misclosure per Survey Regs 1994 §4.3 is
  // 3.0 × √N. We delegate to the country-config value, which is the
  // correct per-station formula. The 15-course check is a separate
  // tolerance that lives at the workflow layer (not in this report
  // helper).
  angularMisclosureArcsec: (n) => ccAngularMisclosureArcsec(KENYA_CONFIG, n),
  urbanLinearMisclosure: "1:10000",
  ruralLinearMisclosure: "1:5000",
};

/**
 * The full flight plan summary report.
 *
 * This is the JSON structure that the desktop app's PDF renderer consumes.
 */
export interface FlightPlanReport {
  /** Report metadata */
  metadata: {
    /** Report generation timestamp (ISO 8601) */
    generatedAt: string;
    /** MetaRDU engine version */
    engineVersion: string;
    /** Mission name (user-provided or auto-generated) */
    missionName: string;
    /** Surveyor name (optional, from app settings) */
    surveyorName?: string;
    /** Project reference (optional, from app settings) */
    projectRef?: string;
  };

  /** Camera used for the mission */
  camera: {
    id: string;
    name: string;
    manufacturer: string;
    sensorWidthMm: number;
    sensorHeightMm: number;
    imageWidthPx: number;
    imageHeightPx: number;
    focalLengthMm: number;
    pixelSizeMicrometers: number;
  };

  /** Flight plan parameters */
  flightPlan: {
    altitudeMeters: number;
    frontOverlap: number;
    sideOverlap: number;
    gsdCmPx: number;
    footprintWidthM: number;
    footprintHeightM: number;
    photoSpacingM: number;
    lineSpacingM: number;
  };

  /** Survey area */
  surveyArea: {
    /** Bounding box in WGS84 */
    boundingBox: BoundingBox;
    /** Estimated area in hectares */
    areaHectares: number;
    /** Polygon vertex count */
    vertexCount: number;
  };

  /** Mission statistics */
  missionStats: MissionStats;

  /** Battery estimation */
  battery: BatteryEstimation;

  /** Terrain statistics (if terrain-aware mode was used) */
  terrain?: TerrainStats;

  /** ASPRS 2014 compliance */
  asprsCompliance: Array<{
    asprsClass: AsprsClass;
    supported: boolean;
    marginCmPx: number;
  }>;

  /** Kenya-specific compliance reference */
  kenyaCompliance: KenyaComplianceCheck;

  /** SVG diagram of the camera footprint on the ground */
  footprintDiagramSvg: string;

  /** SVG diagram of the flight pattern (top-down view) */
  flightPatternSvg: string;
}

/**
 * Options for generating a flight plan report.
 */
export interface ReportOptions {
  /** Camera spec */
  camera: CameraSpec;
  /** Flight plan parameters */
  params: FlightPlanParameters;
  /** Survey area bounding box */
  boundingBox: BoundingBox;
  /** Waypoints (for mission stats and flight pattern diagram) */
  waypoints: Waypoint[];
  /** Battery estimation */
  battery: BatteryEstimation;
  /** Mission stats (computed from waypoints) */
  missionStats: MissionStats;
  /** Terrain stats (if terrain-aware mode was used) */
  terrainStats?: TerrainStats;
  /** Mission name */
  missionName?: string;
  /** Surveyor name */
  surveyorName?: string;
  /** Project reference */
  projectRef?: string;
  /** Engine version */
  engineVersion?: string;
}

/**
 * Generate a flight plan summary report.
 *
 * @returns FlightPlanReport JSON structure (PDF-ready)
 */
export function generateFlightPlanReport(options: ReportOptions): FlightPlanReport {
  const {
    camera,
    params,
    boundingBox,
    waypoints,
    battery,
    missionStats,
    terrainStats,
  } = options;

  // Compute pixel size for the camera section
  const pixelSize = (camera.sensorWidthMm / camera.imageWidthPx) * 1000;

  // Compute survey area in hectares
  const areaM2 = boundingBox.widthMeters * boundingBox.heightMeters;
  const areaHectares = areaM2 / 10_000;

  // ASPRS compliance check
  const asprsCompliance = checkAsprsCompliance(params.gsdCmPx);

  // Generate SVG diagrams
  const footprintDiagramSvg = generateFootprintDiagramSvg(params, camera);
  const flightPatternSvg = generateFlightPatternSvg(waypoints, boundingBox);

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      engineVersion: options.engineVersion ?? "0.1.0",
      missionName: options.missionName ?? "MetaRDU Mission",
      surveyorName: options.surveyorName,
      projectRef: options.projectRef,
    },
    camera: {
      id: camera.id,
      name: camera.name,
      manufacturer: camera.manufacturer,
      sensorWidthMm: camera.sensorWidthMm,
      sensorHeightMm: camera.sensorHeightMm,
      imageWidthPx: camera.imageWidthPx,
      imageHeightPx: camera.imageHeightPx,
      focalLengthMm: camera.focalLengthMm,
      pixelSizeMicrometers: pixelSize,
    },
    flightPlan: {
      altitudeMeters: params.altitudeM,
      frontOverlap: params.frontOverlap,
      sideOverlap: params.sideOverlap,
      gsdCmPx: params.gsdCmPx,
      footprintWidthM: params.footprintWidthM,
      footprintHeightM: params.footprintHeightM,
      photoSpacingM: params.photoSpacingM,
      lineSpacingM: params.lineSpacingM,
    },
    surveyArea: {
      boundingBox,
      areaHectares,
      vertexCount: waypoints.length,
    },
    missionStats,
    battery,
    terrain: terrainStats,
    asprsCompliance,
    kenyaCompliance: KENYA_COMPLIANCE,
    footprintDiagramSvg,
    flightPatternSvg,
  };
}

/**
 * Generate an SVG diagram showing the camera footprint on the ground.
 *
 * Shows:
 *   - The image footprint rectangle (width × height in meters)
 *   - Photo spacing and line spacing arrows
 *   - Overlap regions shaded
 */
function generateFootprintDiagramSvg(
  params: FlightPlanParameters,
  _camera: CameraSpec
): string {
  // Scale: 1 meter = 2 SVG units (so a 100m footprint = 200px wide)
  const scale = 2;
  const fw = params.footprintWidthM * scale;
  const fh = params.footprintHeightM * scale;
  const ps = params.photoSpacingM * scale;
  const ls = params.lineSpacingM * scale;

  // Draw two adjacent footprints (along-track) and two flight lines
  const padding = 40;
  const svgW = fw * 2 + ps + padding * 2;
  const svgH = fh * 2 + ls + padding * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" font-family="Arial, sans-serif" font-size="11">
  <rect width="100%" height="100%" fill="#fafafa"/>

  <!-- Title -->
  <text x="${svgW / 2}" y="20" text-anchor="middle" font-weight="bold" font-size="13">Camera Footprint &amp; Overlap Diagram</text>

  <!-- Footprint 1 (line 1, photo 1) -->
  <rect x="${padding}" y="${padding}" width="${fw}" height="${fh}" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>
  <text x="${padding + fw / 2}" y="${padding + fh / 2}" text-anchor="middle">Photo 1</text>

  <!-- Footprint 2 (line 1, photo 2) — shifted by photoSpacing -->
  <rect x="${padding + fw}" y="${padding}" width="${fw}" height="${fh}" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5" opacity="0.7"/>
  <text x="${padding + fw + fw / 2}" y="${padding + fh / 2}" text-anchor="middle">Photo 2</text>

  <!-- Front overlap region (shaded) -->
  <rect x="${padding + fw}" y="${padding}" width="${ps}" height="${fh}" fill="#fbbf24" opacity="0.4"/>
  <text x="${padding + fw + ps / 2}" y="${padding - 5}" text-anchor="middle" font-size="9">Front overlap: ${(params.frontOverlap * 100).toFixed(0)}%</text>

  <!-- Photo spacing arrow -->
  <line x1="${padding + fw}" y1="${padding + fh + 15}" x2="${padding + fw + ps}" y2="${padding + fh + 15}" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="${padding + fw + ps / 2}" y="${padding + fh + 30}" text-anchor="middle" font-size="10" fill="#dc2626">Photo spacing: ${params.photoSpacingM.toFixed(1)} m</text>

  <!-- Footprint 3 (line 2, photo 1) — shifted by lineSpacing -->
  <rect x="${padding}" y="${padding + fh + ls}" width="${fw}" height="${fh}" fill="#dcfce7" stroke="#16a34a" stroke-width="1.5"/>
  <text x="${padding + fw / 2}" y="${padding + fh + ls + fh / 2}" text-anchor="middle">Photo 3 (line 2)</text>

  <!-- Side overlap region (shaded) -->
  <rect x="${padding}" y="${padding + fh}" width="${fw}" height="${ls}" fill="#a78bfa" opacity="0.4"/>
  <text x="${padding - 5}" y="${padding + fh + ls / 2}" text-anchor="end" font-size="9" transform="rotate(-90 ${padding - 5} ${padding + fh + ls / 2})">Side overlap: ${(params.sideOverlap * 100).toFixed(0)}%</text>

  <!-- Line spacing arrow -->
  <line x1="${padding + fw + 20}" y1="${padding + fh}" x2="${padding + fw + 20}" y2="${padding + fh + ls}" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="${padding + fw + 30}" y="${padding + fh + ls / 2}" font-size="10" fill="#dc2626">Line spacing: ${params.lineSpacingM.toFixed(1)} m</text>

  <!-- Footprint dimensions -->
  <text x="${padding + fw / 2}" y="${padding + fh + 45}" text-anchor="middle" font-size="10">Footprint: ${params.footprintWidthM.toFixed(1)} × ${params.footprintHeightM.toFixed(1)} m</text>

  <!-- Arrow marker definition -->
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#dc2626"/>
    </marker>
  </defs>
</svg>`;
}

/**
 * Generate an SVG diagram showing the flight pattern (top-down view).
 *
 * Shows the survey area bounding box, all waypoints as dots, and the
 * flight path as connected lines.
 */
function generateFlightPatternSvg(
  waypoints: Waypoint[],
  bbox: BoundingBox
): string {
  const svgW = 600;
  const svgH = 400;
  const padding = 30;

  // Compute scale to fit the bounding box in the SVG
  const drawW = svgW - padding * 2;
  const drawH = svgH - padding * 2;
  const scaleX = drawW / bbox.widthMeters;
  const scaleY = drawH / bbox.heightMeters;
  const scale = Math.min(scaleX, scaleY);

  // Project a waypoint to SVG coordinates
  const project = (wp: Waypoint): { x: number; y: number } => {
    // Convert lat/lng to meters relative to bbox center
    const latMetersPerDegree = 111_320;
    const lngMetersPerDegree = 111_320 * Math.cos(bbox.centerLat * Math.PI / 180);
    const eastM = (wp.longitude - bbox.centerLng) * lngMetersPerDegree;
    const northM = (wp.latitude - bbox.centerLat) * latMetersPerDegree;
    // SVG y-axis is inverted (top = north)
    return {
      x: svgW / 2 + eastM * scale,
      y: svgH / 2 - northM * scale,
    };
  };

  // Build the flight path polyline
  const pathPoints = waypoints.map((wp) => {
    const p = project(wp);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");

  // Sample every Nth waypoint as a dot (to avoid clutter)
  const dotInterval = Math.max(1, Math.floor(waypoints.length / 50));
  const dots = waypoints
    .filter((_, i) => i % dotInterval === 0)
    .map((wp) => {
      const p = project(wp);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#2563eb"/>`;
    })
    .join("");

  // Bounding box rectangle
  const bboxCorners = [
    project({ latitude: bbox.maxLat, longitude: bbox.minLng } as Waypoint),
    project({ latitude: bbox.maxLat, longitude: bbox.maxLng } as Waypoint),
    project({ latitude: bbox.minLat, longitude: bbox.maxLng } as Waypoint),
    project({ latitude: bbox.minLat, longitude: bbox.minLng } as Waypoint),
  ];
  const bboxPath = bboxCorners.map((c, i) =>
    (i === 0 ? "M" : "L") + c.x.toFixed(1) + "," + c.y.toFixed(1)
  ).join(" ") + " Z";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" font-family="Arial, sans-serif" font-size="11">
  <rect width="100%" height="100%" fill="#fafafa"/>

  <!-- Title -->
  <text x="${svgW / 2}" y="18" text-anchor="middle" font-weight="bold" font-size="13">Flight Pattern (Top-Down View)</text>

  <!-- Survey area bounding box -->
  <path d="${bboxPath}" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,2"/>

  <!-- Flight path -->
  <polyline points="${pathPoints}" fill="none" stroke="#2563eb" stroke-width="0.8" opacity="0.6"/>

  <!-- Waypoint dots (sampled) -->
  ${dots}

  <!-- North arrow -->
  <g transform="translate(${svgW - 40}, ${padding})">
    <line x1="0" y1="20" x2="0" y2="0" stroke="#000" stroke-width="1.5" marker-end="url(#northArrow)"/>
    <text x="0" y="-5" text-anchor="middle" font-size="10" font-weight="bold">N</text>
  </g>

  <!-- Scale bar -->
  <g transform="translate(${padding}, ${svgH - 20})">
    <line x1="0" y1="0" x2="100" y2="0" stroke="#000" stroke-width="1.5"/>
    <line x1="0" y1="-3" x2="0" y2="3" stroke="#000" stroke-width="1.5"/>
    <line x1="100" y1="-3" x2="100" y2="3" stroke="#000" stroke-width="1.5"/>
    <text x="50" y="-5" text-anchor="middle" font-size="10">${(100 / scale).toFixed(0)} m</text>
  </g>

  <!-- Stats -->
  <text x="${padding}" y="${svgH - 35}" font-size="10">${waypoints.length} waypoints · ${new Set(waypoints.map(w => w.flightLine)).size} flight lines</text>

  <defs>
    <marker id="northArrow" markerWidth="8" markerHeight="8" refX="4" refY="0" orient="auto">
      <path d="M0,8 L4,0 L8,8 Z" fill="#000"/>
    </marker>
  </defs>
</svg>`;
}

/**
 * Serialize a report to JSON for embedding in a PDF or saving to disk.
 */
export function reportToJson(report: FlightPlanReport): string {
  return JSON.stringify(report, null, 2);
}
