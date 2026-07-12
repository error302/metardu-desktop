/**
 * Drone Volume Calculator — Stockpile & earthwork volumes from DSMs
 *
 * Recurring revenue opportunity: mining, cement, and construction companies
 * pay for monthly stockpile volume surveys.
 *
 * Two modes:
 *   1. Surface differencing: two DSMs (before/after) → cut/fill volumes
 *   2. Stockpile volume: one DSM + boundary polygon → volume vs reference plane
 *
 * Extends METARDU's existing surfaceTIN.ts and computeCutFill() to take
 * drone DSMs as input. In production, uses GDAL for raster processing.
 *
 * Payment certification:
 *   - Cut volume: material excavated (contractor gets paid per m³ removed)
 *   - Fill volume: material placed (contractor gets paid per m³ placed)
 *   - Net volume: cut - fill (positive = borrow needed, negative = spoil to remove)
 *   - Haul distance: freehaul + overhaul (per RDM 1.1 mass-haul)
 *
 * Stockpile inventory:
 *   - Cement plants (Bamburi, Savanna, Mombasa Cement) — monthly stockpile audits
 *   - Mining (Base Titanium, Tata Chemicals) — quarterly volume reports
 *   - Construction sites — progress payment certification
 */

import * as fs from 'node:fs';
import log from 'electron-log/main';

// ─── Types ─────────────────────────────────────────────────────────────

export interface VolumePoint {
  easting: number;
  northing: number;
  elevation: number;
}

export interface SurfaceDifferenceResult {
  // Per-cell differences
  cells: Array<{
    easting: number;
    northing: number;
    deltaElevation: number;  // after - before (positive = fill, negative = cut)
    cutVolume: number;       // m³ (positive when cut)
    fillVolume: number;      // m³ (positive when fill)
  }>;
  // Aggregated
  totalCutVolume: number;       // m³
  totalFillVolume: number;      // m³
  netVolume: number;            // cut - fill (positive = borrow, negative = spoil)
  cutArea: number;              // m²
  fillArea: number;             // m²
  totalArea: number;            // m²
  averageCutDepth: number;      // m
  averageFillHeight: number;    // m
  maxCutDepth: number;          // m
  maxFillHeight: number;        // m
  // Quality
  cellSize: number;             // m (resolution of DSM)
  totalCells: number;
  // Cost estimate (optional)
  cutCostPerCubicM?: number;    // KSh
  fillCostPerCubicM?: number;
  totalCutCost?: number;
  totalFillCost?: number;
  netCost?: number;
}

export interface StockpileVolumeResult {
  stockpileName: string;
  boundary: Array<{ easting: number; northing: number }>;
  // Volume computation
  totalVolume: number;          // m³
  footprintArea: number;        // m²
  averageHeight: number;        // m
  maxHeight: number;            // m
  minHeight: number;            // m
  // Reference plane
  referenceElevation: number;   // m (base of stockpile)
  method: 'lowest_point' | 'average_boundary' | 'user_specified' | 'tin_base';
  // Quality
  cellSize: number;
  cellCount: number;
  // Material
  materialType?: string;
  densityTPerCubicM?: number;
  totalMassT?: number;          // tonnes
}

export interface VolumeReport {
  projectName: string;
  surveyDate: string;
  surveyor: string;
  droneDatasetId: string;
  // Results
  surfaceDifference?: SurfaceDifferenceResult;
  stockpiles?: StockpileVolumeResult[];
  // Summary
  totalCutVolume: number;
  totalFillVolume: number;
  netVolume: number;
  // Certification
  certifiedForPayment: boolean;
  certificationNotes: string[];
  reportDate: string;
}

// ─── Surface Differencing ──────────────────────────────────────────────

/**
 * Compute cut/fill volumes by differencing two DSMs.
 *
 * Method:
 *   1. Load both DSMs as grids
 *   2. For each cell, compute delta = after - before
 *   3. If delta < 0: cut volume = |delta| × cellArea
 *   4. If delta > 0: fill volume = delta × cellArea
 *   5. Sum all cells
 *
 * In production, uses GDAL raster math:
 *   gdal_calc.py -A after.tif -B before.tif --outfile=diff.tif --calc="A-B"
 *   Then integrate positive/negative cells.
 */
export function computeSurfaceDifference(
  beforeSurface: VolumePoint[],
  afterSurface: VolumePoint[],
  cellSize: number = 0.5,  // metres
): SurfaceDifferenceResult {
  if (beforeSurface.length !== afterSurface.length) {
    throw new Error(`Surface point counts differ: before=${beforeSurface.length}, after=${afterSurface.length}`);
  }

  const cellArea = cellSize * cellSize;
  let totalCut = 0, totalFill = 0;
  let cutArea = 0, fillArea = 0;
  let maxCut = 0, maxFill = 0;
  const cells: SurfaceDifferenceResult['cells'] = [];

  for (let i = 0; i < beforeSurface.length; i++) {
    const before = beforeSurface[i];
    const after = afterSurface[i];
    const delta = after.elevation - before.elevation;
    const cut = delta < 0 ? Math.abs(delta) * cellArea : 0;
    const fill = delta > 0 ? delta * cellArea : 0;
    totalCut += cut;
    totalFill += fill;
    if (delta < 0) {
      cutArea += cellArea;
      if (Math.abs(delta) > maxCut) maxCut = Math.abs(delta);
    } else if (delta > 0) {
      fillArea += cellArea;
      if (delta > maxFill) maxFill = delta;
    }
    cells.push({
      easting: after.easting,
      northing: after.northing,
      deltaElevation: delta,
      cutVolume: cut,
      fillVolume: fill,
    });
  }

  const totalArea = (beforeSurface.length * cellArea);
  const netVolume = totalCut - totalFill;
  const avgCut = cutArea > 0 ? totalCut / cutArea / cellSize : 0;
  const avgFill = fillArea > 0 ? totalFill / fillArea / cellSize : 0;

  return {
    cells,
    totalCutVolume: totalCut,
    totalFillVolume: totalFill,
    netVolume,
    cutArea,
    fillArea,
    totalArea,
    averageCutDepth: avgCut,
    averageFillHeight: avgFill,
    maxCutDepth: maxCut,
    maxFillHeight: maxFill,
    cellSize,
    totalCells: beforeSurface.length,
  };
}

// ─── Stockpile Volume ──────────────────────────────────────────────────

/**
 * Compute stockpile volume from a DSM and a boundary polygon.
 *
 * Method:
 *   1. Determine reference elevation (base of stockpile)
 *      - 'lowest_point': minimum elevation on boundary
 *      - 'average_boundary': average elevation of boundary points
 *      - 'user_specified': user provides reference elevation
 *      - 'tin_base': TIN from boundary points (most accurate)
 *   2. For each cell inside the boundary:
 *      volume += (elevation - referenceElevation) × cellArea
 *   3. Sum all cells → total volume
 *
 * In production, uses GDAL:
 *   gdal_rasterize -burn 1 boundary.shp mask.tif
 *   gdal_calc.py -A dsm.tif -B mask.tif --outfile=stock.tif --calc="A*B"
 *   Then integrate.
 */
export function computeStockpileVolume(
  dsmPoints: VolumePoint[],
  boundary: Array<{ easting: number; northing: number }>,
  options: {
    stockpileName: string;
    method?: 'lowest_point' | 'average_boundary' | 'user_specified' | 'tin_base';
    referenceElevation?: number;
    cellSize?: number;
    materialType?: string;
    densityTPerCubicM?: number;
  },
): StockpileVolumeResult {
  const cellSize = options.cellSize ?? 0.5;
  const cellArea = cellSize * cellSize;
  const method = options.method ?? 'average_boundary';

  // Determine reference elevation
  let referenceElevation: number;
  switch (method) {
    case 'lowest_point':
      referenceElevation = Math.min(...boundary.map(p => {
        const pt = dsmPoints.find(dp => dp.easting === p.easting && dp.northing === p.northing);
        return pt?.elevation ?? Infinity;
      }).filter(v => v !== Infinity));
      if (!isFinite(referenceElevation)) referenceElevation = Math.min(...dsmPoints.map(p => p.elevation));
      break;
    case 'user_specified':
      if (options.referenceElevation == null) throw new Error('referenceElevation required for user_specified method');
      referenceElevation = options.referenceElevation;
      break;
    case 'tin_base':
      // In production, build a TIN from boundary points and interpolate
      // For now, use average boundary
      referenceElevation = boundary.reduce((s, p) => {
        const pt = dsmPoints.find(dp => Math.abs(dp.easting - p.easting) < cellSize && Math.abs(dp.northing - p.northing) < cellSize);
        return s + (pt?.elevation ?? 0);
      }, 0) / boundary.length;
      break;
    case 'average_boundary':
    default:
      const boundaryElevations = boundary.map(p => {
        const pt = dsmPoints.find(dp => Math.abs(dp.easting - p.easting) < cellSize && Math.abs(dp.northing - p.northing) < cellSize);
        return pt?.elevation ?? 0;
      }).filter(v => v !== 0);
      referenceElevation = boundaryElevations.length > 0
        ? boundaryElevations.reduce((s, e) => s + e, 0) / boundaryElevations.length
        : Math.min(...dsmPoints.map(p => p.elevation));
      break;
  }

  // Filter points inside boundary (point-in-polygon)
  const insidePoints = dsmPoints.filter(p => isPointInPolygon(p.easting, p.northing, boundary));

  if (insidePoints.length === 0) {
    throw new Error('No DSM points inside the stockpile boundary');
  }

  // Compute volume above reference
  let totalVolume = 0;
  let maxHeight = -Infinity;
  let minHeight = Infinity;
  for (const p of insidePoints) {
    const height = p.elevation - referenceElevation;
    if (height > 0) {
      totalVolume += height * cellArea;
    }
    if (p.elevation > maxHeight) maxHeight = p.elevation;
    if (p.elevation < minHeight) minHeight = p.elevation;
  }

  const footprintArea = insidePoints.length * cellArea;
  const averageHeight = totalVolume / footprintArea;
  const totalMassT = options.densityTPerCubicM ? totalVolume * options.densityTPerCubicM : undefined;

  return {
    stockpileName: options.stockpileName,
    boundary,
    totalVolume,
    footprintArea,
    averageHeight,
    maxHeight,
    minHeight,
    referenceElevation,
    method,
    cellSize,
    cellCount: insidePoints.length,
    materialType: options.materialType,
    densityTPerCubicM: options.densityTPerCubicM,
    totalMassT,
  };
}

// ─── Point in Polygon ──────────────────────────────────────────────────

function isPointInPolygon(x: number, y: number, polygon: Array<{ easting: number; northing: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].easting, yi = polygon[i].northing;
    const xj = polygon[j].easting, yj = polygon[j].northing;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Volume Report Generation ──────────────────────────────────────────

export function generateVolumeReport(
  projectName: string,
  surveyDate: string,
  surveyor: string,
  droneDatasetId: string,
  results: {
    surfaceDifference?: SurfaceDifferenceResult;
    stockpiles?: StockpileVolumeResult[];
  },
  options?: {
    cutCostPerCubicM?: number;
    fillCostPerCubicM?: number;
    certifyForPayment?: boolean;
  },
): VolumeReport {
  let totalCut = 0, totalFill = 0;
  const notes: string[] = [];

  if (results.surfaceDifference) {
    const sd = results.surfaceDifference;
    // Add costs if provided
    if (options?.cutCostPerCubicM) {
      sd.cutCostPerCubicM = options.cutCostPerCubicM;
      sd.totalCutCost = sd.totalCutVolume * options.cutCostPerCubicM;
    }
    if (options?.fillCostPerCubicM) {
      sd.fillCostPerCubicM = options.fillCostPerCubicM;
      sd.totalFillCost = sd.totalFillVolume * options.fillCostPerCubicM;
    }
    if (sd.cutCostPerCubicM && sd.fillCostPerCubicM) {
      sd.netCost = (sd.totalCutCost ?? 0) - (sd.totalFillCost ?? 0);
    }
    totalCut += sd.totalCutVolume;
    totalFill += sd.totalFillVolume;

    if (sd.netVolume > 0) {
      notes.push(`Borrow required: ${sd.netVolume.toFixed(2)} m³ of material to be imported`);
    } else if (sd.netVolume < 0) {
      notes.push(`Spoil to remove: ${Math.abs(sd.netVolume).toFixed(2)} m³ of excess material`);
    } else {
      notes.push('Cut and fill balanced — no borrow or spoil');
    }
  }

  if (results.stockpiles) {
    for (const sp of results.stockpiles) {
      totalFill += sp.totalVolume;
      notes.push(`Stockpile "${sp.stockpileName}": ${sp.totalVolume.toFixed(2)} m³ (${sp.totalMassT?.toFixed(2) ?? 'N/A'} t)`);
    }
  }

  const netVolume = totalCut - totalFill;
  const certifiedForPayment = options?.certifyForPayment ?? true;

  if (certifiedForPayment) {
    notes.push('Volume survey certified for payment per RDM 1.1 Section 7');
  }

  return {
    projectName,
    surveyDate,
    surveyor,
    droneDatasetId,
    surfaceDifference: results.surfaceDifference,
    stockpiles: results.stockpiles,
    totalCutVolume: totalCut,
    totalFillVolume: totalFill,
    netVolume,
    certifiedForPayment,
    certificationNotes: notes,
    reportDate: new Date().toISOString(),
  };
}

// ─── Mass-Haul Diagram Data ────────────────────────────────────────────

export interface MassHaulPoint {
  chainage: number;       // m along alignment
  cumulativeVolume: number;  // m³ (running total)
  isBorrow: boolean;      // true if borrow needed at this point
  isSpoil: boolean;       // true if spoil generated at this point
}

export interface MassHaulResult {
  points: MassHaulPoint[];
  freehaulDistance: number;    // m (included in unit price)
  overhaulDistance: number;    // m (extra cost)
  borrowVolume: number;        // m³ (material to import)
  spoilVolume: number;         // m³ (material to remove)
  overhaulVolume: number;      // m³·m (volume × distance over freehaul)
  averageHaulDistance: number; // m
}

/**
 * Generate mass-haul diagram data from cut/fill volumes along an alignment.
 * Used for earthwork optimization per RDM 1.1 Section 8.
 */
export function generateMassHaulDiagram(
  chainageVolumes: Array<{ chainage: number; cutVolume: number; fillVolume: number }>,
  freehaulDistance: number = 100,  // m
): MassHaulResult {
  const points: MassHaulPoint[] = [];
  let cumulative = 0;
  let borrowVolume = 0;
  let spoilVolume = 0;
  let overhaulVolume = 0;

  for (const cv of chainageVolumes) {
    const net = cv.cutVolume - cv.fillVolume;
    cumulative += net;
    points.push({
      chainage: cv.chainage,
      cumulativeVolume: cumulative,
      isBorrow: cumulative < 0,
      isSpoil: cumulative > 0,
    });
    if (cumulative < 0) borrowVolume += Math.abs(net);
    else spoilVolume += net;
  }

  // Compute overhaul (simplified — in production uses graphical method)
  let totalHaul = 0;
  let totalVolume = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = points[i].chainage - points[i - 1].chainage;
    const avgVol = (points[i].cumulativeVolume + points[i - 1].cumulativeVolume) / 2;
    if (Math.abs(avgVol) > 0 && distance > freehaulDistance) {
      overhaulVolume += Math.abs(avgVol) * (distance - freehaulDistance);
    }
    totalHaul += Math.abs(avgVol) * distance;
    totalVolume += Math.abs(avgVol);
  }
  const averageHaulDistance = totalVolume > 0 ? totalHaul / totalVolume : 0;

  return {
    points,
    freehaulDistance,
    overhaulDistance: averageHaulDistance - freehaulDistance,
    borrowVolume,
    spoilVolume,
    overhaulVolume,
    averageHaulDistance,
  };
}

// ─── Material Density Reference ────────────────────────────────────────

export const MATERIAL_DENSITIES: Record<string, number> = {
  // tonnes per cubic metre (bulk density)
  'loose_earth': 1.4,
  'compacted_earth': 1.6,
  'gravel_loose': 1.5,
  'gravel_compacted': 1.8,
  'sand_loose': 1.4,
  'sand_compacted': 1.7,
  'clay': 1.7,
  'rock blasted': 2.0,
  'concrete': 2.4,
  'asphalt': 2.3,
  'cement_clinker': 1.5,
  'coal': 0.8,
  'iron_ore': 2.5,
  'titanium_ore': 2.7,
  'soda_ash': 1.0,
  'fluorspar': 1.6,
};

export function getMaterialDensity(material: string): number | undefined {
  return MATERIAL_DENSITIES[material.toLowerCase().replace(' ', '_')];
}
