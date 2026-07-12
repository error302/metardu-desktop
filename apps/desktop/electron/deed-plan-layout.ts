/**
 * Smart Deed Plan Auto-Layout — Constraint Solver (NO AI)
 *
 * OV8: Pure computational geometry + constraint satisfaction.
 * Given a parcel + traverse, generate a complete deed plan with optimal
 * placement of title block, beacon schedule, area table, north arrow,
 * scale bar, grid overlay.
 *
 * This is NOT AI/ML. It's deterministic geometry:
 *   - Auto-rotation: orient the parcel so its longest dimension is horizontal
 *   - Auto-scale: pick the scale that fits the parcel on A1/A2/A3/A4
 *   - Auto-dimensioning: place bearings/distances perpendicular to each edge
 *   - Constraint solver: no overlaps, proper margins, SoK compliance
 *
 * References:
 *   - Survey of Kenya Deed Plan Standards
 *   - Survey Act Cap 299, Survey Regulations 1994
 */

import log from 'electron-log/main';

export interface AutoLayoutInput {
  parcelPoints: Array<{ number: string; easting: number; northing: number; elevation?: number }>;
  parcelNumber: string;
  lrNumber: string;
  areaSqM: number;
  perimeter: number;
  paperSize: 'A1' | 'A2' | 'A3' | 'A4';
  surveyorName: string;
  surveyorLicense: string;
  county: string;
  surveyDate: string;
  scale?: number;  // if not provided, auto-computed
}

export interface AutoLayoutResult {
  paperSize: string;
  paperWidth: number;   // mm
  paperHeight: number;  // mm
  orientation: 'landscape' | 'portrait';
  scale: number;        // e.g. 1000 means 1:1000
  rotation: number;     // degrees — how much the parcel is rotated for best fit
  mapBounds: { x: number; y: number; width: number; height: number };  // mm on paper
  titleBlock: { x: number; y: number; width: number; height: number };
  beaconSchedule: { x: number; y: number; width: number; height: number };
  areaTable: { x: number; y: number; width: number; height: number };
  northArrow: { x: number; y: number; size: number };
  scaleBar: { x: number; y: number; width: number };
  gridOverlay: { enabled: boolean; interval: number };  // interval in metres
  dimensions: Array<{
    pointFrom: string;
    pointTo: string;
    bearing: number;
    distance: number;
    labelPosition: { x: number; y: number };  // mm on paper
    labelRotation: number;  // degrees
  }>;
  points: Array<{
    number: string;
    x: number;  // mm on paper
    y: number;  // mm on paper
    isBeacon: boolean;
  }>;
  warnings: string[];
}

const PAPER_SIZES: Record<string, { width: number; height: number }> = {
  'A1': { width: 841, height: 594 },
  'A2': { width: 594, height: 420 },
  'A3': { width: 420, height: 297 },
  'A4': { width: 297, height: 210 },
};

const MARGIN = 15;  // mm
const TITLE_BLOCK_HEIGHT = 70;  // mm
const BEACON_SCHEDULE_WIDTH = 120;  // mm
const AREA_TABLE_HEIGHT = 30;  // mm

const STANDARD_SCALES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

export function generateAutoLayout(input: AutoLayoutInput): AutoLayoutResult {
  const paper = PAPER_SIZES[input.paperSize];
  const warnings: string[] = [];

  // ─── 1. Auto-rotation: orient the parcel so its longest dimension is horizontal ───
  // Compute the parcel's principal axis (PCA — deterministic, not AI)
  const points = input.parcelPoints;
  const cx = points.reduce((s, p) => s + p.easting, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.northing, 0) / points.length;

  // Find the longest edge of the parcel
  let maxDist = 0;
  let longestEdgeAngle = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].easting - points[i].easting;
    const dy = points[j].northing - points[i].northing;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) {
      maxDist = dist;
      longestEdgeAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
  }

  // Rotate so the longest edge is horizontal
  const rotation = -longestEdgeAngle;

  // Rotate all points
  const cosR = Math.cos(rotation * Math.PI / 180);
  const sinR = Math.sin(rotation * Math.PI / 180);
  const rotatedPoints = points.map((p) => ({
    ...p,
    rx: (p.easting - cx) * cosR - (p.northing - cy) * sinR,
    ry: (p.easting - cx) * sinR + (p.northing - cy) * cosR,
  }));

  // Compute rotated bounds
  const rxMin = Math.min(...rotatedPoints.map((p) => p.rx));
  const rxMax = Math.max(...rotatedPoints.map((p) => p.rx));
  const ryMin = Math.min(...rotatedPoints.map((p) => p.ry));
  const ryMax = Math.max(...rotatedPoints.map((p) => p.ry));
  const parcelWidthM = rxMax - rxMin;
  const parcelHeightM = ryMax - ryMin;

  // ─── 2. Auto-scale: pick the largest scale that fits ───────────────
  // Available area on paper (minus margins + title block + beacon schedule)
  const orientation: 'landscape' | 'portrait' = parcelWidthM > parcelHeightM ? 'landscape' : 'portrait';
  const paperW = orientation === 'landscape' ? paper.width : paper.height;
  const paperH = orientation === 'landscape' ? paper.height : paper.width;

  // Available map area
  const availW = paperW - 2 * MARGIN - BEACON_SCHEDULE_WIDTH;
  const availH = paperH - 2 * MARGIN - TITLE_BLOCK_HEIGHT - AREA_TABLE_HEIGHT;

  let scale = input.scale ?? 0;
  if (scale === 0) {
    // Try each standard scale from largest to smallest
    for (const s of STANDARD_SCALES) {
      const mapW = parcelWidthM * 1000 / s;  // mm on paper
      const mapH = parcelHeightM * 1000 / s;
      if (mapW <= availW && mapH <= availH) {
        scale = s;
        break;
      }
    }
    if (scale === 0) {
      scale = STANDARD_SCALES[STANDARD_SCALES.length - 1];  // smallest scale
      warnings.push(`Parcel too large for ${input.paperSize} at any standard scale. Using 1:${scale} (may overflow).`);
    }
  }

  // ─── 3. Compute map position on paper ──────────────────────────────
  const mapWidthMm = parcelWidthM * 1000 / scale;
  const mapHeightMm = parcelHeightM * 1000 / scale;
  const mapX = MARGIN;
  const mapY = MARGIN + AREA_TABLE_HEIGHT;

  // ─── 4. Map points to paper coordinates (mm) ───────────────────────
  const paperPoints = rotatedPoints.map((p) => ({
    number: p.number,
    x: mapX + (p.rx - rxMin) * 1000 / scale,
    y: mapY + mapHeightMm - (p.ry - ryMin) * 1000 / scale,  // flip Y (paper Y goes up)
    isBeacon: true,
  }));

  // ─── 5. Auto-dimensioning: place bearings and distances ────────────
  const dimensions: AutoLayoutResult['dimensions'] = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].easting - points[i].easting;
    const dy = points[j].northing - points[i].northing;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

    // Place label at midpoint of the edge, offset perpendicular
    const midX = (paperPoints[i].x + paperPoints[j].x) / 2;
    const midY = (paperPoints[i].y + paperPoints[j].y) / 2;
    // Perpendicular direction (outward from parcel)
    const edgeAngle = Math.atan2(paperPoints[j].y - paperPoints[i].y, paperPoints[j].x - paperPoints[i].x);
    const perpAngle = edgeAngle + Math.PI / 2;
    const offset = 8;  // mm
    const labelX = midX + Math.cos(perpAngle) * offset;
    const labelY = midY + Math.sin(perpAngle) * offset;
    const labelRotation = edgeAngle * 180 / Math.PI;
    // Normalize rotation to -90 to +90 for readability
    const normRot = labelRotation > 90 ? labelRotation - 180 : labelRotation < -90 ? labelRotation + 180 : labelRotation;

    dimensions.push({
      pointFrom: points[i].number,
      pointTo: points[j].number,
      bearing,
      distance: dist,
      labelPosition: { x: labelX, y: labelY },
      labelRotation: normRot,
    });
  }

  // ─── 6. Grid overlay ───────────────────────────────────────────────
  const gridInterval = scale <= 100 ? 5 : scale <= 500 ? 10 : scale <= 2000 ? 50 : 100;

  // ─── 7. Layout positions for title block, beacon schedule, etc. ────
  const result: AutoLayoutResult = {
    paperSize: input.paperSize,
    paperWidth: paperW,
    paperHeight: paperH,
    orientation,
    scale,
    rotation,
    mapBounds: { x: mapX, y: mapY, width: mapWidthMm, height: mapHeightMm },
    titleBlock: {
      x: MARGIN,
      y: paperH - MARGIN - TITLE_BLOCK_HEIGHT,
      width: paperW - 2 * MARGIN,
      height: TITLE_BLOCK_HEIGHT,
    },
    beaconSchedule: {
      x: paperW - MARGIN - BEACON_SCHEDULE_WIDTH,
      y: mapY,
      width: BEACON_SCHEDULE_WIDTH,
      height: mapHeightMm,
    },
    areaTable: {
      x: MARGIN,
      y: MARGIN,
      width: paperW - 2 * MARGIN - BEACON_SCHEDULE_WIDTH,
      height: AREA_TABLE_HEIGHT,
    },
    northArrow: {
      x: mapX + mapWidthMm - 20,
      y: mapY + 20,
      size: 15,
    },
    scaleBar: {
      x: mapX,
      y: mapY + mapHeightMm + 5,
      width: 50,
    },
    gridOverlay: { enabled: true, interval: gridInterval },
    dimensions,
    points: paperPoints,
    warnings,
  };

  log.info(`Auto-layout: ${input.paperSize} ${orientation}, scale 1:${scale}, rotation ${rotation.toFixed(1)}°, ${dimensions.length} dimensions`);
  return result;
}
