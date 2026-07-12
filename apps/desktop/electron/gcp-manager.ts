/**
 * GCP Manager — Ground Control Points for drone photogrammetry
 *
 * THE value-add of METARDU for drone surveyors.
 *
 * Every drone survey needs 5-15 GCPs (Ground Control Points) with known
 * coordinates to georeference the orthophoto. Surveyors create them in
 * METARDU (total station or GNSS), export as GCP file for ODM/Pix4D,
 * then import the georeferenced orthophoto back into METARDU to verify
 * GCP residuals.
 *
 * This closes the loop:
 *   METARDU survey points → GCP file → drone processing → orthophoto
 *   → back to METARDU for feature extraction + statutory deliverables
 *
 * Supported GCP file formats:
 *   - ODM: gcp_list.txt (space-separated: easting northing elevation pixel_x pixel_y image_name)
 *   - Pix4D: .csv (comma-separated with header)
 *   - Agisoft Metashape: .xml (XML format with markers)
 *   - Generic: .csv (easting, northing, elevation, name)
 *
 * GCP placement best practices (per Pix4D documentation):
 *   - Minimum 5 GCPs for small sites (<10 ha)
 *   - 1 GCP per 5 hectares for larger sites
 *   - Distribute GCPs evenly across the site and at edges
 *   - Include check points (not used for processing, only for QA)
 *   - Target size: 60×60cm for 5cm GSD, 100×100cm for 10cm GSD
 *
 * Residual verification:
 *   After drone processing, compare the GCP's known position to its
 *   position in the orthophoto. Residuals should be:
 *     - Horizontal: < 2× GSD (e.g. < 10mm for 5cm GSD)
 *     - Vertical: < 3× GSD (e.g. < 15mm for 5cm GSD)
 *   If residuals exceed these, the GCPs or processing may be faulty.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';
import { app } from 'electron';

// ─── Types ─────────────────────────────────────────────────────────────

export interface GCP {
  id: string;
  name: string;
  // Known coordinates (from METARDU total station / GNSS)
  easting: number;
  northing: number;
  elevation: number;
  // Coordinate reference system
  crs: string;
  // Targeting
  targetType: 'checkerboard' | 'cross' | 'circle' | 'natural_feature';
  targetSizeM: number;        // physical target size
  // Image coordinates (filled after drone processing)
  imageCoordinates?: Array<{
    imageName: string;
    pixelX: number;
    pixelY: number;
  }>;
  // Residuals (filled after drone processing + verification)
  residuals?: {
    deltaX: number;            // metres
    deltaY: number;
    deltaZ: number;
    horizontalDelta: number;   // sqrt(dx² + dy²)
    rmsHorizontal: number;     // running RMS
  };
  // Status
  status: 'measured' | 'exported' | 'processing' | 'verified' | 'failed';
  // Metadata
  measuredAt: string;
  measuredWith: 'total_station' | 'gnss_static' | 'gnss_rtk' | 'manual';
  isCheckPoint: boolean;       // check points are not used for processing
  notes?: string;
}

export interface GCPFile {
  gcpIds: string[];
  projectName: string;
  crs: string;
  verticalDatum: string;
  exportFormat: 'odm' | 'pix4d' | 'agisoft' | 'generic_csv';
  exportedAt: string;
  outputPath: string;
  gcpCount: number;
  checkPointCount: number;
}

// ─── GCP Registry ──────────────────────────────────────────────────────

const GCP_DIR = 'gcps';
const GCP_FILE = 'gcps.json';

function getGCPDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, GCP_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadGCPs(): Record<string, GCP> {
  const filePath = path.join(getGCPDir(), GCP_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveGCPs(gcps: Record<string, GCP>): void {
  const filePath = path.join(getGCPDir(), GCP_FILE);
  fs.writeFileSync(filePath, JSON.stringify(gcps, null, 2), { mode: 0o600 });
}

// ─── GCP CRUD ──────────────────────────────────────────────────────────

export function createGCP(input: Omit<GCP, 'id' | 'measuredAt' | 'status'>): GCP {
  const id = `gcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const gcp: GCP = {
    ...input,
    id,
    measuredAt: new Date().toISOString(),
    status: 'measured',
  };
  const gcps = loadGCPs();
  gcps[id] = gcp;
  saveGCPs(gcps);
  log.info(`GCP created: ${gcp.name} (${gcp.easting}, ${gcp.northing})`);
  return gcp;
}

export function listGCPs(): GCP[] {
  return Object.values(loadGCPs()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getGCP(id: string): GCP | null {
  return loadGCPs()[id] ?? null;
}

export function updateGCP(id: string, updates: Partial<GCP>): GCP | null {
  const gcps = loadGCPs();
  if (!gcps[id]) return null;
  gcps[id] = { ...gcps[id], ...updates };
  saveGCPs(gcps);
  return gcps[id];
}

export function deleteGCP(id: string): boolean {
  const gcps = loadGCPs();
  if (!gcps[id]) return false;
  delete gcps[id];
  saveGCPs(gcps);
  return true;
}

/**
 * Convert existing METARDU survey points to GCPs.
 * This is the primary workflow — surveyors mark existing points as GCPs.
 */
export function convertSurveyPointsToGCPs(
  surveyPoints: Array<{ point_number: string; easting: number; northing: number; elevation: number }>,
  options: { crs: string; targetType?: GCP['targetType']; targetSizeM?: number; measuredWith?: GCP['measuredWith']; isCheckPoint?: boolean },
): GCP[] {
  const gcps: GCP[] = [];
  for (const sp of surveyPoints) {
    const gcp = createGCP({
      name: sp.point_number,
      easting: sp.easting,
      northing: sp.northing,
      elevation: sp.elevation,
      crs: options.crs,
      targetType: options.targetType ?? 'checkerboard',
      targetSizeM: options.targetSizeM ?? 0.6,
      measuredWith: options.measuredWith ?? 'gnss_rtk',
      isCheckPoint: options.isCheckPoint ?? false,
    });
    gcps.push(gcp);
  }
  log.info(`Converted ${surveyPoints.length} survey points to GCPs`);
  return gcps;
}

// ─── GCP Distribution Validator ─────────────────────────────────────────

export interface GCPDistributionAssessment {
  totalGCPs: number;
  checkPoints: number;
  controlPoints: number;
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;  // hectares
  recommendedCount: number;
  densityRating: 'excellent' | 'good' | 'acceptable' | 'insufficient';
  distributionRating: 'excellent' | 'good' | 'acceptable' | 'poor';
  issues: string[];
  recommendations: string[];
}

/**
 * Assess GCP distribution for a given site.
 * Best practices:
 *   - Minimum 5 GCPs for small sites (<10 ha)
 *   - 1 GCP per 5 hectares for larger sites
 *   - Even distribution across site + at edges
 *   - ~20% should be check points (not used for processing)
 */
export function assessGCPDistribution(gcps: GCP[]): GCPDistributionAssessment {
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (gcps.length === 0) {
    return {
      totalGCPs: 0, checkPoints: 0, controlPoints: 0,
      extent: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      area: 0, recommendedCount: 5,
      densityRating: 'insufficient', distributionRating: 'poor',
      issues: ['No GCPs defined'],
      recommendations: ['Create at least 5 GCPs using total station or GNSS'],
    };
  }

  const controlPoints = gcps.filter(g => !g.isCheckPoint);
  const checkPoints = gcps.filter(g => g.isCheckPoint);

  // Compute extent
  const xs = gcps.map(g => g.easting);
  const ys = gcps.map(g => g.northing);
  const extent = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const widthM = extent.maxX - extent.minX;
  const heightM = extent.maxY - extent.minY;
  const area = (widthM * heightM) / 10000;  // hectares

  // Recommended count: 1 per 5 ha, min 5
  const recommendedCount = Math.max(5, Math.ceil(area / 5));

  // Density rating
  let densityRating: GCPDistributionAssessment['densityRating'];
  if (controlPoints.length >= recommendedCount * 1.5) densityRating = 'excellent';
  else if (controlPoints.length >= recommendedCount) densityRating = 'good';
  else if (controlPoints.length >= Math.ceil(recommendedCount * 0.7)) densityRating = 'acceptable';
  else densityRating = 'insufficient';

  if (densityRating === 'insufficient') {
    issues.push(`Only ${controlPoints.length} control points — recommend at least ${recommendedCount} for ${area.toFixed(1)} ha area`);
    recommendations.push(`Add ${recommendedCount - controlPoints.length} more GCPs to meet density requirement`);
  }

  // Check point ratio
  const checkRatio = gcps.length > 0 ? checkPoints.length / gcps.length : 0;
  if (checkRatio < 0.15) {
    issues.push(`Only ${(checkRatio * 100).toFixed(0)}% check points — recommend ~20%`);
    recommendations.push(`Mark ${Math.ceil(gcps.length * 0.2) - checkPoints.length} GCPs as check points for independent QA`);
  }

  // Distribution: check if GCPs are spread across the site
  // Simple check: divide site into 4 quadrants, count GCPs in each
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  const quadrants = [0, 0, 0, 0];  // NW, NE, SW, SE
  for (const gcp of controlPoints) {
    if (gcp.easting < midX && gcp.northing > midY) quadrants[0]++;
    else if (gcp.easting >= midX && gcp.northing > midY) quadrants[1]++;
    else if (gcp.easting < midX && gcp.northing <= midY) quadrants[2]++;
    else quadrants[3]++;
  }
  const emptyQuadrants = quadrants.filter(q => q === 0).length;
  let distributionRating: GCPDistributionAssessment['distributionRating'];
  if (emptyQuadrants === 0) distributionRating = 'excellent';
  else if (emptyQuadrants === 1) distributionRating = 'good';
  else if (emptyQuadrants === 2) distributionRating = 'acceptable';
  else distributionRating = 'poor';

  if (emptyQuadrants > 0) {
    issues.push(`${emptyQuadrants} quadrant(s) of the site have no GCPs`);
    recommendations.push(`Add GCPs in the empty quadrant(s) for even distribution`);
  }

  // Edge coverage
  const edgeGCPs = controlPoints.filter(g =>
    g.easting <= extent.minX + widthM * 0.1 ||
    g.easting >= extent.maxX - widthM * 0.1 ||
    g.northing <= extent.minY + heightM * 0.1 ||
    g.northing >= extent.maxY - heightM * 0.1
  );
  if (edgeGCPs.length < 2) {
    issues.push('Insufficient GCPs at site edges — edges will have higher residuals');
    recommendations.push('Place at least 2 GCPs at opposite corners of the site');
  }

  return {
    totalGCPs: gcps.length,
    checkPoints: checkPoints.length,
    controlPoints: controlPoints.length,
    extent,
    area,
    recommendedCount,
    densityRating,
    distributionRating,
    issues,
    recommendations,
  };
}

// ─── GCP File Export ───────────────────────────────────────────────────

export function exportGCPFile(
  gcpIds: string[],
  outputPath: string,
  format: 'odm' | 'pix4d' | 'agisoft' | 'generic_csv',
  options: { projectName: string; crs: string; verticalDatum: string; includeCheckPoints?: boolean },
): GCPFile {
  const gcps = loadGCPs();
  const selectedGCPs = gcpIds
    .map(id => gcps[id])
    .filter(g => g != null && (options.includeCheckPoints ?? true ? true : !g.isCheckPoint));

  let content = '';
  const controlGCPs = selectedGCPs.filter(g => !g.isCheckPoint);
  const checkGCPs = selectedGCPs.filter(g => g.isCheckPoint);

  switch (format) {
    case 'odm':
      // ODM gcp_list.txt format:
      // <crs> <easting> <northing> <elevation> <pixel_x> <pixel_y> <image_name>
      content = `<crs>\n${options.crs}\n`;
      content += `# GCP file generated by METARDU Desktop\n`;
      content += `# Project: ${options.projectName}\n`;
      content += `# Total GCPs: ${controlGCPs.length} control + ${checkGCPs.length} check\n`;
      content += `# Format: easting northing elevation pixel_x pixel_y image_name\n\n`;
      for (const gcp of selectedGCPs) {
        // ODM expects image coordinates — if not yet processed, use 0 0
        const px = gcp.imageCoordinates?.[0]?.pixelX ?? 0;
        const py = gcp.imageCoordinates?.[0]?.pixelY ?? 0;
        const img = gcp.imageCoordinates?.[0]?.imageName ?? 'UNKNOWN.jpg';
        content += `${gcp.easting.toFixed(4)} ${gcp.northing.toFixed(4)} ${gcp.elevation.toFixed(4)} ${px.toFixed(0)} ${py.toFixed(0)} ${img}\n`;
      }
      break;

    case 'pix4d':
      // Pix4D GCP format: CSV with header
      content = `# Pix4D GCP file generated by METARDU Desktop\n`;
      content += `# Project: ${options.projectName}\n`;
      content += `# CRS: ${options.crs}\n`;
      content += `# Vertical Datum: ${options.verticalDatum}\n\n`;
      content += `GCP Label,Geographic Coordinate System,Easting,Northing,Elevation (m),Horizontal Accuracy (m),Vertical Accuracy (m),Image Coordinates\n`;
      for (const gcp of selectedGCPs) {
        const hAcc = 0.010;  // 10mm
        const vAcc = 0.015;  // 15mm
        const imgCoords = gcp.imageCoordinates
          ? gcp.imageCoordinates.map(ic => `${ic.imageName} ${ic.pixelX.toFixed(0)} ${ic.pixelY.toFixed(0)}`).join('; ')
          : '';
        content += `${gcp.name},${options.crs},${gcp.easting.toFixed(4)},${gcp.northing.toFixed(4)},${gcp.elevation.toFixed(4)},${hAcc},${vAcc},${imgCoords}\n`;
      }
      break;

    case 'agisoft':
      // Agisoft Metashape XML format
      content = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      content += `<document version="1.5.0">\n`;
      content += `  <chunk>\n`;
      content += `    <markers>\n`;
      for (const gcp of selectedGCPs) {
        content += `      <marker name="${gcp.name}" enabled="true">\n`;
        content += `        <location x="${gcp.easting}" y="${gcp.northing}" z="${gcp.elevation}"/>\n`;
        content += `      </marker>\n`;
      }
      content += `    </markers>\n`;
      content += `  </chunk>\n`;
      content += `</document>\n`;
      break;

    case 'generic_csv':
      content = `# GCP file generated by METARDU Desktop\n`;
      content += `# Project: ${options.projectName}\n`;
      content += `# CRS: ${options.crs}\n\n`;
      content += `name,easting,northing,elevation,type,is_check_point\n`;
      for (const gcp of selectedGCPs) {
        content += `${gcp.name},${gcp.easting.toFixed(4)},${gcp.northing.toFixed(4)},${gcp.elevation.toFixed(4)},${gcp.targetType},${gcp.isCheckPoint}\n`;
      }
      break;
  }

  fs.writeFileSync(outputPath, content);

  // Mark GCPs as exported
  for (const id of gcpIds) {
    if (gcps[id]) {
      gcps[id].status = 'exported';
    }
  }
  saveGCPs(gcps);

  const result: GCPFile = {
    gcpIds,
    projectName: options.projectName,
    crs: options.crs,
    verticalDatum: options.verticalDatum,
    exportFormat: format,
    exportedAt: new Date().toISOString(),
    outputPath,
    gcpCount: controlGCPs.length,
    checkPointCount: checkGCPs.length,
  };

  log.info(`Exported ${selectedGCPs.length} GCPs to ${outputPath} (${format} format)`);
  return result;
}

// ─── Residual Verification ─────────────────────────────────────────────

export interface ResidualVerificationResult {
  totalGCPs: number;
  verifiedGCPs: number;
  failedGCPs: number;
  rmsX: number;             // metres
  rmsY: number;
  rmsZ: number;
  rmsHorizontal: number;
  maxHorizontalResidual: number;
  maxVerticalResidual: number;
  // Threshold check
  gsdM: number;
  horizontalThreshold: number;  // 2× GSD
  verticalThreshold: number;    // 3× GSD
  passesHorizontal: boolean;
  passesVertical: boolean;
  overallPass: boolean;
  perGCP: Array<{
    gcpId: string;
    gcpName: string;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    horizontalDelta: number;
    passesHorizontal: boolean;
    passesVertical: boolean;
  }>;
  recommendations: string[];
}

/**
 * Verify GCP residuals after drone processing.
 * After ODM/Pix4D processes the drone photos using the GCP file, the
 * orthophoto has a known position for each GCP. Compare this to the
 * known coordinates to compute residuals.
 *
 * Thresholds (per Pix4D best practices):
 *   - Horizontal: < 2× GSD (e.g. < 10mm for 5cm GSD)
 *   - Vertical: < 3× GSD (e.g. < 15mm for 5cm GSD)
 */
export function verifyGCPResiduals(
  gcpResiduals: Array<{
    gcpId: string;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
  }>,
  gsdM: number,
): ResidualVerificationResult {
  const gcps = loadGCPs();
  let sumX2 = 0, sumY2 = 0, sumZ2 = 0;
  let maxH = 0, maxV = 0;
  let verified = 0, failed = 0;
  const horizontalThreshold = 2 * gsdM;
  const verticalThreshold = 3 * gsdM;
  const perGCP: any[] = [];

  for (const res of gcpResiduals) {
    const gcp = gcps[res.gcpId];
    if (!gcp) continue;
    const horizontalDelta = Math.sqrt(res.deltaX ** 2 + res.deltaY ** 2);
    const passesH = horizontalDelta <= horizontalThreshold;
    const passesV = Math.abs(res.deltaZ) <= verticalThreshold;
    if (passesH && passesV) verified++;
    else failed++;
    sumX2 += res.deltaX ** 2;
    sumY2 += res.deltaY ** 2;
    sumZ2 += res.deltaZ ** 2;
    if (horizontalDelta > maxH) maxH = horizontalDelta;
    if (Math.abs(res.deltaZ) > maxV) maxV = Math.abs(res.deltaZ);

    // Update GCP with residual
    updateGCP(res.gcpId, {
      residuals: {
        deltaX: res.deltaX,
        deltaY: res.deltaY,
        deltaZ: res.deltaZ,
        horizontalDelta,
        rmsHorizontal: 0,  // computed below
      },
      status: passesH && passesV ? 'verified' : 'failed',
    });

    perGCP.push({
      gcpId: res.gcpId,
      gcpName: gcp.name,
      deltaX: res.deltaX,
      deltaY: res.deltaY,
      deltaZ: res.deltaZ,
      horizontalDelta,
      passesHorizontal: passesH,
      passesVertical: passesV,
    });
  }

  const n = gcpResiduals.length;
  const rmsX = Math.sqrt(sumX2 / n);
  const rmsY = Math.sqrt(sumY2 / n);
  const rmsZ = Math.sqrt(sumZ2 / n);
  const rmsHorizontal = Math.sqrt(rmsX ** 2 + rmsY ** 2);

  // Update RMS on all GCPs
  for (const p of perGCP) {
    updateGCP(p.gcpId, {
      residuals: {
        deltaX: p.deltaX, deltaY: p.deltaY, deltaZ: p.deltaZ,
        horizontalDelta: p.horizontalDelta, rmsHorizontal,
      },
    });
  }

  const passesHorizontal = rmsHorizontal <= horizontalThreshold;
  const passesVertical = rmsZ <= verticalThreshold;
  const overallPass = passesHorizontal && passesVertical;

  const recommendations: string[] = [];
  if (!passesHorizontal) {
    recommendations.push(`Horizontal RMS ${(rmsHorizontal * 100).toFixed(1)}cm exceeds threshold ${(horizontalThreshold * 100).toFixed(1)}cm (2× GSD)`);
  }
  if (!passesVertical) {
    recommendations.push(`Vertical RMS ${(rmsZ * 100).toFixed(1)}cm exceeds threshold ${(verticalThreshold * 100).toFixed(1)}cm (3× GSD)`);
  }
  if (failed > 0) {
    recommendations.push(`${failed} GCP(s) failed — investigate targeting, measurement, or processing quality`);
  }
  if (overallPass) {
    recommendations.push('All GCPs within tolerance — dataset is suitable for statutory survey work');
  }

  return {
    totalGCPs: n,
    verifiedGCPs: verified,
    failedGCPs: failed,
    rmsX, rmsY, rmsZ, rmsHorizontal,
    maxHorizontalResidual: maxH,
    maxVerticalResidual: maxV,
    gsdM,
    horizontalThreshold,
    verticalThreshold,
    passesHorizontal,
    passesVertical,
    overallPass,
    perGCP,
    recommendations,
  };
}

// ─── Target Size Recommendation ────────────────────────────────────────

export interface TargetRecommendation {
  recommendedSizeM: number;
  reason: string;
}

export function recommendTargetSize(gsdM: number): TargetRecommendation {
  // Target should be at least 10× GSD for reliable detection
  const minSize = gsdM * 10;
  // Round up to standard sizes
  if (minSize <= 0.3) {
    return { recommendedSizeM: 0.3, reason: `30cm target sufficient for ${(gsdM * 100).toFixed(1)}cm GSD (min required: ${(minSize * 100).toFixed(0)}cm)` };
  } else if (minSize <= 0.6) {
    return { recommendedSizeM: 0.6, reason: `60cm target recommended for ${(gsdM * 100).toFixed(1)}cm GSD (min required: ${(minSize * 100).toFixed(0)}cm)` };
  } else if (minSize <= 1.0) {
    return { recommendedSizeM: 1.0, reason: `1m target recommended for ${(gsdM * 100).toFixed(1)}cm GSD (min required: ${(minSize * 100).toFixed(0)}cm)` };
  } else {
    return { recommendedSizeM: 1.5, reason: `1.5m target recommended for ${(gsdM * 100).toFixed(1)}cm GSD (min required: ${(minSize * 100).toFixed(0)}cm)` };
  }
}
