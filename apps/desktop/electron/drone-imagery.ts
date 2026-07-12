/**
 * Drone Imagery Module — Import & manage drone/satellite outputs
 *
 * METARDU doesn't process drone photos (that's OpenDroneMap/Pix4D's job).
 * Instead, METARDU takes the OUTPUTS of those tools and turns them into
 * statutory survey deliverables.
 *
 * Supported imports:
 *   - GeoTIFF orthophotos (from ODM, Pix4D, Agisoft)
 *   - GeoTIFF DSM/DTM (Digital Surface Model / Terrain Model)
 *   - LAZ/LAS point clouds (LiDAR or photogrammetric)
 *   - ODM project manifest (task output)
 *   - Pix4D quality report
 *
 * Each imported dataset is registered with metadata:
 *   - Source (ODM/Pix4D/Agisoft/manual)
 *   - Capture date
 *   - Ground Sample Distance (GSD)
 *   - Coordinate reference system
 *   - Spatial extent (bounding box)
 *   - Number of images used
 *   - Processing software version
 *   - GCP residuals (if georeferenced)
 *
 * The aerial-to-statutory pipeline:
 *   1. Import orthophoto + DSM + point cloud
 *   2. Verify GCP residuals (from Phase 2 GCP Manager)
 *   3. Generate contours from DSM
 *   4. Extract features (building footprints, road edges)
 *   5. Digitize parcel boundaries on orthophoto
 *   6. Compute volumes (Phase 3)
 *   7. Generate statutory deliverables (topo sheet, deed plan, volume report)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';
import { app } from 'electron';

// ─── Types ─────────────────────────────────────────────────────────────

export type DroneDataSource = 'odm' | 'pix4d' | 'agisoft' | 'manual' | 'sentinel2' | 'landsat' | 'planet' | 'maxar';

export type DroneDatasetType = 'orthophoto' | 'dsm' | 'dtm' | 'point_cloud' | 'mesh' | 'panorama';

export interface DroneDataset {
  id: string;
  name: string;
  type: DroneDatasetType;
  source: DroneDataSource;
  filePath: string;
  // Spatial metadata
  crs: string;                    // e.g. 'EPSG:21037'
  extent: BoundingBox;
  groundSampleDistanceM: number;  // GSD in metres
  // Capture metadata
  captureDate: string;            // ISO date
  captureArea: number;            // hectares
  numberOfImages?: number;
  flightAltitudeM?: number;
  // Processing metadata
  processingSoftware?: string;
  processingDate?: string;
  processingDurationSec?: number;
  // Georeferencing
  gcpsUsed?: number;
  gcpRMSX?: number;               // metres
  gcpRMSY?: number;
  gcpRMSZ?: number;
  // Quality
  qualityReportPath?: string;
  // File info
  fileSizeBytes: number;
  // Imported at
  importedAt: string;
  // Optional thumbnail
  thumbnailPath?: string;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ─── Dataset Registry ──────────────────────────────────────────────────

const DATASETS_DIR = 'drone_datasets';
const DATASETS_FILE = 'datasets.json';

function getDatasetsDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, DATASETS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadDatasets(): Record<string, DroneDataset> {
  const filePath = path.join(getDatasetsDir(), DATASETS_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveDatasets(datasets: Record<string, DroneDataset>): void {
  const filePath = path.join(getDatasetsDir(), DATASETS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(datasets, null, 2), { mode: 0o600 });
}

// ─── Import Functions ──────────────────────────────────────────────────

export interface ImportOptions {
  name: string;
  source: DroneDataSource;
  captureDate: string;
  crs?: string;
  gsd?: number;
  numberOfImages?: number;
  flightAltitudeM?: number;
  processingSoftware?: string;
}

/**
 * Import a drone dataset (GeoTIFF orthophoto, DSM, or LAZ/LAS point cloud).
 * In production, this would use GDAL to read the GeoTIFF metadata.
 * For now, we accept the file path and register metadata.
 */
export function importDroneDataset(
  filePath: string,
  type: DroneDatasetType,
  options: ImportOptions,
): DroneDataset {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const datasetId = `drone-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // In production, read GeoTIFF metadata via GDAL
  // For now, we accept extent/GSD from options or use defaults
  const dataset: DroneDataset = {
    id: datasetId,
    name: options.name,
    type,
    source: options.source,
    filePath,
    crs: options.crs ?? 'EPSG:21037',
    extent: { minX: 0, minY: 0, maxX: 0, maxY: 0 },  // populated by GDAL in production
    groundSampleDistanceM: options.gsd ?? 0.05,  // 5cm default for drone
    captureDate: options.captureDate,
    captureArea: 0,  // computed from extent
    numberOfImages: options.numberOfImages,
    flightAltitudeM: options.flightAltitudeM,
    processingSoftware: options.processingSoftware,
    fileSizeBytes: stats.size,
    importedAt: new Date().toISOString(),
  };

  // Compute capture area from extent (if populated)
  if (dataset.extent.maxX > dataset.extent.minX) {
    const widthM = dataset.extent.maxX - dataset.extent.minX;
    const heightM = dataset.extent.maxY - dataset.extent.minY;
    dataset.captureArea = (widthM * heightM) / 10000;  // hectares
  }

  const datasets = loadDatasets();
  datasets[datasetId] = dataset;
  saveDatasets(datasets);

  log.info(`Imported drone dataset: ${dataset.name} (${type}, ${dataset.source}, ${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  return dataset;
}

export function listDroneDatasets(): DroneDataset[] {
  return Object.values(loadDatasets()).sort((a, b) =>
    new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
  );
}

export function getDroneDataset(id: string): DroneDataset | null {
  return loadDatasets()[id] ?? null;
}

export function deleteDroneDataset(id: string): boolean {
  const datasets = loadDatasets();
  if (!datasets[id]) return false;
  delete datasets[id];
  saveDatasets(datasets);
  return true;
}

export function updateDroneDataset(id: string, updates: Partial<DroneDataset>): DroneDataset | null {
  const datasets = loadDatasets();
  const dataset = datasets[id];
  if (!dataset) return null;
  const updated = { ...dataset, ...updates };
  // Recompute capture area if extent was updated
  if (updates.extent && updates.extent.maxX > updates.extent.minX) {
    const widthM = updates.extent.maxX - updates.extent.minX;
    const heightM = updates.extent.maxY - updates.extent.minY;
    updated.captureArea = (widthM * heightM) / 10000;
  }
  datasets[id] = updated;
  saveDatasets(datasets);
  return updated;
}

// ─── ODM Project Import ────────────────────────────────────────────────

export interface ODMProjectManifest {
  projectName: string;
  captureDate: string;
  numberOfImages: number;
  processingDate: string;
  processingDurationSec: number;
  gsd: number;
  crs: string;
  extent: BoundingBox;
  gcpCount: number;
  gcpRMS: { x: number; y: number; z: number };
  outputs: {
    orthophotoPath?: string;
    dsmPath?: string;
    dtmPath?: string;
    pointCloudPath?: string;
    textureMeshPath?: string;
  };
}

/**
 * Import an OpenDroneMap project.
 * ODM outputs are in a predictable directory structure:
 *   <project>/odm_orthophoto/odm_orthophoto.tif
 *   <project>/odm_dem/dsm.tif
 *   <project>/odm_dem/dtm.tif
 *   <project>/odm_georeferencing/odm_georeferenced_model.laz
 */
export function importODMProject(projectDir: string, manifest: ODMProjectManifest): DroneDataset[] {
  if (!fs.existsSync(projectDir)) {
    throw new Error(`ODM project directory not found: ${projectDir}`);
  }

  const datasets: DroneDataset[] = [];
  const baseOptions: ImportOptions = {
    name: manifest.projectName,
    source: 'odm',
    captureDate: manifest.captureDate,
    crs: manifest.crs,
    gsd: manifest.gsd,
    numberOfImages: manifest.numberOfImages,
    processingSoftware: `OpenDroneMap`,
  };

  // Orthophoto
  if (manifest.outputs.orthophotoPath && fs.existsSync(manifest.outputs.orthophotoPath)) {
    datasets.push(importDroneDataset(manifest.outputs.orthophotoPath, 'orthophoto', {
      ...baseOptions,
      name: `${manifest.projectName} — Orthophoto`,
    }));
  }

  // DSM
  if (manifest.outputs.dsmPath && fs.existsSync(manifest.outputs.dsmPath)) {
    datasets.push(importDroneDataset(manifest.outputs.dsmPath, 'dsm', {
      ...baseOptions,
      name: `${manifest.projectName} — DSM`,
    }));
  }

  // DTM
  if (manifest.outputs.dtmPath && fs.existsSync(manifest.outputs.dtmPath)) {
    datasets.push(importDroneDataset(manifest.outputs.dtmPath, 'dtm', {
      ...baseOptions,
      name: `${manifest.projectName} — DTM`,
    }));
  }

  // Point cloud
  if (manifest.outputs.pointCloudPath && fs.existsSync(manifest.outputs.pointCloudPath)) {
    datasets.push(importDroneDataset(manifest.outputs.pointCloudPath, 'point_cloud', {
      ...baseOptions,
      name: `${manifest.projectName} — Point Cloud`,
    }));
  }

  // Update GCP residuals on all datasets from this project
  const updatedDatasets: DroneDataset[] = [];
  for (const ds of datasets) {
    const updated = updateDroneDataset(ds.id, {
      gcpsUsed: manifest.gcpCount,
      gcpRMSX: manifest.gcpRMS.x,
      gcpRMSY: manifest.gcpRMS.y,
      gcpRMSZ: manifest.gcpRMS.z,
      processingDate: manifest.processingDate,
      processingDurationSec: manifest.processingDurationSec,
      extent: manifest.extent,
      captureArea: ((manifest.extent.maxX - manifest.extent.minX) * (manifest.extent.maxY - manifest.extent.minY)) / 10000,
    });
    if (updated) updatedDatasets.push(updated);
  }

  log.info(`Imported ODM project "${manifest.projectName}": ${updatedDatasets.length} datasets`);
  return updatedDatasets;
}

// ─── Pix4D Project Import ──────────────────────────────────────────────

export interface Pix4DQualityReport {
  projectName: string;
  captureDate: string;
  numberOfImages: number;
  processingDate: string;
  gsd: number;
  crs: string;
  gcpCount: number;
  gcpRMS: { x: number; y: number; z: number };
  outputs: {
    orthophotoPath?: string;
    dsmPath?: string;
    pointCloudPath?: string;
    qualityReportPath?: string;
  };
}

export function importPix4DProject(report: Pix4DQualityReport): DroneDataset[] {
  const datasets: DroneDataset[] = [];
  const baseOptions: ImportOptions = {
    name: report.projectName,
    source: 'pix4d',
    captureDate: report.captureDate,
    crs: report.crs,
    gsd: report.gsd,
    numberOfImages: report.numberOfImages,
    processingSoftware: 'Pix4Dmapper',
  };

  if (report.outputs.orthophotoPath && fs.existsSync(report.outputs.orthophotoPath)) {
    datasets.push(importDroneDataset(report.outputs.orthophotoPath, 'orthophoto', {
      ...baseOptions, name: `${report.projectName} — Orthophoto`,
    }));
  }
  if (report.outputs.dsmPath && fs.existsSync(report.outputs.dsmPath)) {
    datasets.push(importDroneDataset(report.outputs.dsmPath, 'dsm', {
      ...baseOptions, name: `${report.projectName} — DSM`,
    }));
  }
  if (report.outputs.pointCloudPath && fs.existsSync(report.outputs.pointCloudPath)) {
    datasets.push(importDroneDataset(report.outputs.pointCloudPath, 'point_cloud', {
      ...baseOptions, name: `${report.projectName} — Point Cloud`,
    }));
  }

  // Attach quality report
  const updatedDatasets: DroneDataset[] = [];
  for (const ds of datasets) {
    const updated = updateDroneDataset(ds.id, {
      gcpsUsed: report.gcpCount,
      gcpRMSX: report.gcpRMS.x,
      gcpRMSY: report.gcpRMS.y,
      gcpRMSZ: report.gcpRMS.z,
      processingDate: report.processingDate,
      qualityReportPath: report.outputs.qualityReportPath,
    });
    if (updated) updatedDatasets.push(updated);
  }

  log.info(`Imported Pix4D project "${report.projectName}": ${updatedDatasets.length} datasets`);
  return updatedDatasets;
}

// ─── Quality Assessment ────────────────────────────────────────────────

export interface DatasetQualityAssessment {
  datasetId: string;
  // GSD assessment
  gsdM: number;
  gsdRating: 'excellent' | 'good' | 'acceptable' | 'poor';
  // Georeferencing quality
  gcpCount: number;
  rmsX: number;
  rmsY: number;
  rmsZ: number;
  rmsTotal: number;
  georeferencingRating: 'excellent' | 'good' | 'acceptable' | 'poor' | 'unverified';
  // Coverage
  captureAreaHa: number;
  // Overall
  overallRating: 'excellent' | 'good' | 'acceptable' | 'poor';
  recommendations: string[];
  // Compliance
  suitableForCadastral: boolean;
  suitableForEngineering: boolean;
  suitableForTopographical: boolean;
}

export function assessDatasetQuality(dataset: DroneDataset): DatasetQualityAssessment {
  const recommendations: string[] = [];

  // GSD rating
  let gsdRating: DatasetQualityAssessment['gsdRating'];
  if (dataset.groundSampleDistanceM <= 0.02) gsdRating = 'excellent';      // ≤2cm
  else if (dataset.groundSampleDistanceM <= 0.05) gsdRating = 'good';      // ≤5cm
  else if (dataset.groundSampleDistanceM <= 0.10) gsdRating = 'acceptable'; // ≤10cm
  else gsdRating = 'poor';

  if (gsdRating === 'poor') {
    recommendations.push(`GSD ${dataset.groundSampleDistanceM * 100}cm is poor — fly lower or use a better camera for survey-grade work`);
  }

  // Georeferencing
  const rmsTotal = dataset.gcpRMSX != null && dataset.gcpRMSY != null
    ? Math.sqrt(dataset.gcpRMSX ** 2 + dataset.gcpRMSY ** 2)
    : 0;
  let georefRating: DatasetQualityAssessment['georeferencingRating'];
  if (!dataset.gcpsUsed || dataset.gcpsUsed === 0) {
    georefRating = 'unverified';
    recommendations.push('No GCPs used — dataset is not ground-verified. Add GCPs before using for statutory survey');
  } else if (rmsTotal <= 0.02) georefRating = 'excellent';      // ≤2cm
  else if (rmsTotal <= 0.05) georefRating = 'good';              // ≤5cm
  else if (rmsTotal <= 0.10) georefRating = 'acceptable';        // ≤10cm
  else georefRating = 'poor';

  if (georefRating === 'poor') {
    recommendations.push(`GCP RMS ${rmsTotal * 100}cm is poor — check GCP targeting and measurement accuracy`);
  }

  // Overall
  let overallRating: DatasetQualityAssessment['overallRating'];
  if (gsdRating === 'excellent' && georefRating === 'excellent') overallRating = 'excellent';
  else if ((gsdRating === 'excellent' || gsdRating === 'good') && (georefRating === 'excellent' || georefRating === 'good')) overallRating = 'good';
  else if (gsdRating !== 'poor' && georefRating !== 'poor') overallRating = 'acceptable';
  else overallRating = 'poor';

  // Suitability per survey type
  const suitableForCadastral = gsdRating !== 'poor' && georefRating !== 'poor' && georefRating !== 'unverified' && dataset.groundSampleDistanceM <= 0.05;
  const suitableForEngineering = gsdRating !== 'poor' && georefRating !== 'poor' && georefRating !== 'unverified';
  const suitableForTopographical = gsdRating !== 'poor';

  if (!suitableForCadastral) {
    recommendations.push('Not suitable for cadastral survey — requires GCPs with ≤5cm RMS and GSD ≤5cm');
  }

  return {
    datasetId: dataset.id,
    gsdM: dataset.groundSampleDistanceM,
    gsdRating,
    gcpCount: dataset.gcpsUsed ?? 0,
    rmsX: dataset.gcpRMSX ?? 0,
    rmsY: dataset.gcpRMSY ?? 0,
    rmsZ: dataset.gcpRMSZ ?? 0,
    rmsTotal,
    georeferencingRating: georefRating as any,
    captureAreaHa: dataset.captureArea,
    overallRating,
    recommendations,
    suitableForCadastral,
    suitableForEngineering,
    suitableForTopographical,
  };
}

// ─── Contour Generation from DSM ───────────────────────────────────────

export interface ContourGenerationOptions {
  intervalM: number;
  indexInterval?: number;     // every Nth contour is index
  smooth?: boolean;
  minArea?: number;           // minimum contour polygon area (m²)
}

export interface ContourResult {
  contours: Array<{
    elevation: number;
    isIndex: boolean;
    points: Array<[number, number]>;
  }>;
  intervalM: number;
  minElevation: number;
  maxElevation: number;
  generatedAt: string;
}

/**
 * Generate contours from a DSM.
 * In production, this uses GDAL's gdal_contour or a marching-squares algorithm.
 * For now, we return a placeholder structure.
 */
export function generateContoursFromDSM(
  dsmDatasetId: string,
  options: ContourGenerationOptions,
): ContourResult {
  const dataset = getDroneDataset(dsmDatasetId);
  if (!dataset) throw new Error(`Dataset not found: ${dsmDatasetId}`);
  if (dataset.type !== 'dsm' && dataset.type !== 'dtm') {
    throw new Error(`Dataset must be a DSM or DTM, got ${dataset.type}`);
  }

  // In production, this calls GDAL gdal_contour
  // For now, generate synthetic contours
  const minElevation = 1800;
  const maxElevation = 1850;
  const contours: any[] = [];
  const indexInterval = options.indexInterval ?? 5;

  for (let elev = minElevation; elev <= maxElevation; elev += options.intervalM) {
    const isIndex = Math.round((elev - minElevation) / options.intervalM) % indexInterval === 0;
    // Generate a synthetic contour ring
    const points: [number, number][] = [];
    const numPoints = 100;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const r = 50 + (elev - minElevation) * 2;
      points.push([
        (dataset.extent.minX + dataset.extent.maxX) / 2 + r * Math.cos(angle),
        (dataset.extent.minY + dataset.extent.maxY) / 2 + r * Math.sin(angle),
      ]);
    }
    contours.push({ elevation: elev, isIndex, points });
  }

  return {
    contours,
    intervalM: options.intervalM,
    minElevation,
    maxElevation,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Feature Extraction from Orthophoto ────────────────────────────────

export interface ExtractedFeature {
  type: 'building' | 'road_edge' | 'road_centerline' | 'parcel_boundary' | 'vegetation' | 'water';
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, any>;
  confidence: number;  // 0-1
}

export interface FeatureExtractionResult {
  datasetId: string;
  features: ExtractedFeature[];
  extractionMethod: string;
  extractedAt: string;
  summary: {
    buildings: number;
    roadEdges: number;
    roadCenterlines: number;
    parcelBoundaries: number;
    vegetation: number;
    water: number;
  };
}

/**
 * Extract features from an orthophoto.
 * In production, this uses:
 *   - OSM building footprints (Pyrosm) as a starting point
 *   - Segmentation models (U-Net, Mask R-CNN) for building/road extraction
 *   - Or contour-based extraction from DSM (buildings have flat roofs)
 *
 * For now, returns a placeholder structure.
 */
export function extractFeaturesFromOrthophoto(
  orthophotoId: string,
  options: { extractBuildings?: boolean; extractRoads?: boolean; extractVegetation?: boolean; extractWater?: boolean } = {},
): FeatureExtractionResult {
  const dataset = getDroneDataset(orthophotoId);
  if (!dataset) throw new Error(`Dataset not found: ${orthophotoId}`);
  if (dataset.type !== 'orthophoto') {
    throw new Error(`Dataset must be an orthophoto, got ${dataset.type}`);
  }

  const features: ExtractedFeature[] = [];
  const extractBuildings = options.extractBuildings ?? true;
  const extractRoads = options.extractRoads ?? true;
  const extractVegetation = options.extractVegetation ?? false;
  const extractWater = options.extractWater ?? false;

  // In production, this runs ML models or OSM overlay
  // For now, generate synthetic features
  if (extractBuildings) {
    for (let i = 0; i < 10; i++) {
      features.push({
        type: 'building',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [dataset.extent.minX + i * 10, dataset.extent.minY + i * 10],
            [dataset.extent.minX + i * 10 + 8, dataset.extent.minY + i * 10],
            [dataset.extent.minX + i * 10 + 8, dataset.extent.minY + i * 10 + 6],
            [dataset.extent.minX + i * 10, dataset.extent.minY + i * 10 + 6],
            [dataset.extent.minX + i * 10, dataset.extent.minY + i * 10],
          ]],
        },
        properties: { area_sqm: 48, source: 'auto_extracted' },
        confidence: 0.85 + Math.random() * 0.1,
      });
    }
  }

  if (extractRoads) {
    features.push({
      type: 'road_centerline',
      geometry: {
        type: 'LineString',
        coordinates: [
          [dataset.extent.minX, (dataset.extent.minY + dataset.extent.maxY) / 2],
          [dataset.extent.maxX, (dataset.extent.minY + dataset.extent.maxY) / 2],
        ],
      },
      properties: { width_m: 7, class: 'class_B' },
      confidence: 0.92,
    });
  }

  const summary = {
    buildings: features.filter(f => f.type === 'building').length,
    roadEdges: features.filter(f => f.type === 'road_edge').length,
    roadCenterlines: features.filter(f => f.type === 'road_centerline').length,
    parcelBoundaries: features.filter(f => f.type === 'parcel_boundary').length,
    vegetation: features.filter(f => f.type === 'vegetation').length,
    water: features.filter(f => f.type === 'water').length,
  };

  return {
    datasetId: orthophotoId,
    features,
    extractionMethod: 'ML-based segmentation (placeholder)',
    extractedAt: new Date().toISOString(),
    summary,
  };
}
