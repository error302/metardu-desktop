/**
 * IPC handler registry.
 *
 * Per ADR-004: all renderer→main communication goes through contextBridge IPC.
 * Channels follow the naming convention: <namespace>:<verb>
 *
 *   db:query       — read-only SQL query
 *   db:execute     — write SQL statement
 *   fs:newProject  — create a new .metardu file
 *   fs:openProject — open an existing .metardu file
 *   fs:importCsv   — parse CSV file → insert as points
 *   app:version    — return app version
 *   app:platform   — return process.platform
 *
 * Security: every handler validates its arguments. No raw SQL from renderer
 * for fs:* handlers; only db:query and db:execute accept SQL (and they
 * will be tightened to a safe subset in v1.0).
 */

import { ipcMain, app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';
import { MetarduDatabase, type SurveyPoint } from './database.js';
import { parseCsvPoints } from './csv-importer.js';

type DbGetter = () => MetarduDatabase | null;
type DbSetter = (db: MetarduDatabase | null) => void;

export function registerIpcHandlers(getDb: DbGetter, setDb: DbSetter) {
  // -------- app:* --------
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:platform', () => process.platform);

  // -------- fs:newProject --------
  ipcMain.handle('fs:newProject', async (_evt, opts: { filePath: string; name: string; countryPack?: string }) => {
    if (!opts?.filePath || !opts?.name) {
      throw new Error('filePath and name are required');
    }
    // Make sure the file ends in .metardu
    const filePath = opts.filePath.endsWith('.metardu') ? opts.filePath : `${opts.filePath}.metardu`;
    if (fs.existsSync(filePath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    // Create an empty file first (better-sqlite3 will init it)
    fs.writeFileSync(filePath, Buffer.alloc(0));
    const db = new MetarduDatabase(filePath);
    const projectId = db.initProject(opts.name, opts.countryPack ?? 'KEN');
    setDb(db);
    log.info(`New project created: ${filePath} (id=${projectId})`);
    return { filePath, projectId };
  });

  // -------- fs:openProject --------
  ipcMain.handle('fs:openProject', async (_evt, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    // Close existing db if any
    const existing = getDb();
    if (existing) existing.close();
    const db = new MetarduDatabase(filePath);
    setDb(db);
    log.info(`Project opened: ${filePath}`);
    return { filePath };
  });

  // -------- fs:importCsv --------
  ipcMain.handle('fs:importCsv', async (_evt, filePath: string, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open. Open or create a .metardu file first.');

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath}`);
    }
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const points = parseCsvPoints(csvContent);
    if (points.length === 0) {
      throw new Error('No points found in CSV. Expected columns: point_number, easting, northing, elevation?, code?, description?');
    }
    const targetProjectId = projectId ?? getSingleProjectId(db);
    const inserted = db.insertPoints(targetProjectId, points);
    log.info(`Imported ${inserted} points from ${filePath}`);
    return { imported: inserted, projectId: targetProjectId };
  });

  // -------- db:query --------
  ipcMain.handle('db:query', (_evt, sql: string, params?: unknown[]) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    // Safety: only allow SELECT statements
    const trimmed = sql.trim().toLowerCase();
    if (!trimmed.startsWith('select') && !trimmed.startsWith('with')) {
      throw new Error('db:query only allows SELECT or WITH statements. Use db:execute for writes.');
    }
    return db.query(sql, params ?? []);
  });

  // -------- db:execute --------
  ipcMain.handle('db:execute', (_evt, sql: string, params?: unknown[]) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const result = db.execute(sql, params ?? []);
    return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
  });

  // -------- db:getPoints --------
  ipcMain.handle('db:getPoints', (_evt, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const targetProjectId = projectId ?? getSingleProjectId(db);
    return db.getPoints(targetProjectId);
  });

  // -------- db:listProjects --------
  ipcMain.handle('db:listProjects', () => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.query('SELECT id, name, country_pack, default_crs_epsg, created_at, updated_at FROM projects');
  });

  // ─── Map Standards (SoK layer registry + projections + Y717) ─────────
  ipcMain.handle('map:getLayers', async () => {
    const { SOK_LAYERS } = await import('./map-standards.js');
    return SOK_LAYERS;
  });
  ipcMain.handle('map:getProjections', async () => {
    const { KENYA_PROJECTIONS } = await import('./map-standards.js');
    return KENYA_PROJECTIONS;
  });
  ipcMain.handle('map:getMapSheets', async () => {
    const { Y717_MAP_SHEETS } = await import('./map-standards.js');
    return Y717_MAP_SHEETS;
  });
  ipcMain.handle('map:getGridConfigs', async () => {
    const { GRID_CONFIGS } = await import('./map-standards.js');
    return GRID_CONFIGS;
  });
  ipcMain.handle('map:getBeaconSymbology', async () => {
    const { BEACON_SYMBOLOGY } = await import('./map-standards.js');
    return BEACON_SYMBOLOGY;
  });
  ipcMain.handle('map:getControlSymbology', async () => {
    const { CONTROL_SYMBOLOGY } = await import('./map-standards.js');
    return CONTROL_SYMBOLOGY;
  });
  ipcMain.handle('map:getPapStatusColors', async () => {
    const { PAP_STATUS_COLORS } = await import('./map-standards.js');
    return PAP_STATUS_COLORS;
  });
  ipcMain.handle('map:measureDistance', async (_evt, points: any) => {
    const { measureDistance } = await import('./map-standards.js');
    return measureDistance(points);
  });
  ipcMain.handle('map:measureArea', async (_evt, points: any) => {
    const { measureArea } = await import('./map-standards.js');
    return measureArea(points);
  });
  ipcMain.handle('map:measureBearing', async (_evt, p1: any, p2: any) => {
    const { measureBearing } = await import('./map-standards.js');
    return measureBearing(p1, p2);
  });
  ipcMain.handle('map:generateScaleBar', async (_evt, scaleDenominator: number, paperWidthMM?: number) => {
    const { generateScaleBar } = await import('./map-standards.js');
    return generateScaleBar(scaleDenominator, paperWidthMM);
  });
  ipcMain.handle('map:getLayersForSurveyType', async (_evt, surveyType: string) => {
    const { getLayersForSurveyType } = await import('./map-standards.js');
    return getLayersForSurveyType(surveyType as any);
  });

  // ─── Drone Imagery (Phase 1: Import & Display) ──────────────────────
  ipcMain.handle('drone:import', async (_evt, filePath: string, type: string, options: any) => {
    const { importDroneDataset } = await import('./drone-imagery.js');
    return importDroneDataset(filePath, type as any, options);
  });
  ipcMain.handle('drone:importODM', async (_evt, projectDir: string, manifest: any) => {
    const { importODMProject } = await import('./drone-imagery.js');
    return importODMProject(projectDir, manifest);
  });
  ipcMain.handle('drone:importPix4D', async (_evt, report: any) => {
    const { importPix4DProject } = await import('./drone-imagery.js');
    return importPix4DProject(report);
  });
  ipcMain.handle('drone:list', async () => {
    const { listDroneDatasets } = await import('./drone-imagery.js');
    return listDroneDatasets();
  });
  ipcMain.handle('drone:get', async (_evt, id: string) => {
    const { getDroneDataset } = await import('./drone-imagery.js');
    return getDroneDataset(id);
  });
  ipcMain.handle('drone:delete', async (_evt, id: string) => {
    const { deleteDroneDataset } = await import('./drone-imagery.js');
    return deleteDroneDataset(id);
  });
  ipcMain.handle('drone:assessQuality', async (_evt, id: string) => {
    const { getDroneDataset, assessDatasetQuality } = await import('./drone-imagery.js');
    const dataset = getDroneDataset(id);
    if (!dataset) throw new Error(`Dataset not found: ${id}`);
    return assessDatasetQuality(dataset);
  });
  ipcMain.handle('drone:generateContours', async (_evt, dsmId: string, options: any) => {
    const { generateContoursFromDSM } = await import('./drone-imagery.js');
    return generateContoursFromDSM(dsmId, options);
  });
  ipcMain.handle('drone:extractFeatures', async (_evt, orthophotoId: string, options: any) => {
    const { extractFeaturesFromOrthophoto } = await import('./drone-imagery.js');
    return extractFeaturesFromOrthophoto(orthophotoId, options);
  });

  // ─── GCP Manager (Phase 2: Ground Control Points) ───────────────────
  ipcMain.handle('gcp:create', async (_evt, input: any) => {
    const { createGCP } = await import('./gcp-manager.js');
    return createGCP(input);
  });
  ipcMain.handle('gcp:list', async () => {
    const { listGCPs } = await import('./gcp-manager.js');
    return listGCPs();
  });
  ipcMain.handle('gcp:get', async (_evt, id: string) => {
    const { getGCP } = await import('./gcp-manager.js');
    return getGCP(id);
  });
  ipcMain.handle('gcp:update', async (_evt, id: string, updates: any) => {
    const { updateGCP } = await import('./gcp-manager.js');
    return updateGCP(id, updates);
  });
  ipcMain.handle('gcp:delete', async (_evt, id: string) => {
    const { deleteGCP } = await import('./gcp-manager.js');
    return deleteGCP(id);
  });
  ipcMain.handle('gcp:convertPoints', async (_evt, surveyPoints: any, options: any) => {
    const { convertSurveyPointsToGCPs } = await import('./gcp-manager.js');
    return convertSurveyPointsToGCPs(surveyPoints, options);
  });
  ipcMain.handle('gcp:assessDistribution', async (_evt, gcps: any) => {
    const { assessGCPDistribution } = await import('./gcp-manager.js');
    return assessGCPDistribution(gcps);
  });
  ipcMain.handle('gcp:export', async (_evt, gcpIds: any, outputPath: string, format: string, options: any) => {
    const { exportGCPFile } = await import('./gcp-manager.js');
    return exportGCPFile(gcpIds, outputPath, format as any, options);
  });
  ipcMain.handle('gcp:verifyResiduals', async (_evt, residuals: any, gsdM: number) => {
    const { verifyGCPResiduals } = await import('./gcp-manager.js');
    return verifyGCPResiduals(residuals, gsdM);
  });
  ipcMain.handle('gcp:recommendTargetSize', async (_evt, gsdM: number) => {
    const { recommendTargetSize } = await import('./gcp-manager.js');
    return recommendTargetSize(gsdM);
  });

  // ─── Drone Volume (Phase 3: Volume Calculations) ────────────────────
  ipcMain.handle('drone:computeVolume', async (_evt, beforeSurface: any, afterSurface: any, cellSize?: number) => {
    const { computeSurfaceDifference } = await import('./drone-volume.js');
    return computeSurfaceDifference(beforeSurface, afterSurface, cellSize);
  });
  ipcMain.handle('drone:computeStockpile', async (_evt, dsmPoints: any, boundary: any, options: any) => {
    const { computeStockpileVolume } = await import('./drone-volume.js');
    return computeStockpileVolume(dsmPoints, boundary, options);
  });
  ipcMain.handle('drone:generateVolumeReport', async (_evt, projectName: string, surveyDate: string, surveyor: string, droneDatasetId: string, results: any, options?: any) => {
    const { generateVolumeReport } = await import('./drone-volume.js');
    return generateVolumeReport(projectName, surveyDate, surveyor, droneDatasetId, results, options);
  });
  ipcMain.handle('drone:generateMassHaul', async (_evt, chainageVolumes: any, freehaulDistance?: number) => {
    const { generateMassHaulDiagram } = await import('./drone-volume.js');
    return generateMassHaulDiagram(chainageVolumes, freehaulDistance);
  });
  ipcMain.handle('drone:getMaterialDensities', async () => {
    const { MATERIAL_DENSITIES } = await import('./drone-volume.js');
    return MATERIAL_DENSITIES;
  });

  // ─── Aerial Pipeline (End-to-end orchestration) ─────────────────────
  ipcMain.handle('pipeline:create', async (_evt, input: any) => {
    const { createPipeline } = await import('./aerial-pipeline.js');
    return createPipeline(input);
  });
  ipcMain.handle('pipeline:list', async () => {
    const { listPipelines } = await import('./aerial-pipeline.js');
    return listPipelines();
  });
  ipcMain.handle('pipeline:get', async (_evt, id: string) => {
    const { getPipeline } = await import('./aerial-pipeline.js');
    return getPipeline(id);
  });
  ipcMain.handle('pipeline:updateStage', async (_evt, pipelineId: string, stage: string, status: string, options?: any) => {
    const { updatePipelineStage } = await import('./aerial-pipeline.js');
    return updatePipelineStage(pipelineId, stage as any, status as any, options);
  });
  ipcMain.handle('pipeline:progress', async (_evt, id: string) => {
    const { getPipeline, getPipelineProgress } = await import('./aerial-pipeline.js');
    const pipeline = getPipeline(id);
    if (!pipeline) throw new Error(`Pipeline not found: ${id}`);
    return getPipelineProgress(pipeline);
  });
  ipcMain.handle('pipeline:validate', async (_evt, id: string) => {
    const { getPipeline, validatePipelineForSubmission } = await import('./aerial-pipeline.js');
    const pipeline = getPipeline(id);
    if (!pipeline) throw new Error(`Pipeline not found: ${id}`);
    return validatePipelineForSubmission(pipeline);
  });
  ipcMain.handle('pipeline:estimateCost', async (_evt, areaHa: number, application: string, processingSoftware?: string) => {
    const { estimatePipelineCost } = await import('./aerial-pipeline.js');
    return estimatePipelineCost(areaHa, application as any, processingSoftware as any);
  });
  ipcMain.handle('pipeline:getStageExecutor', async (_evt, stage: string) => {
    const { getStageExecutor } = await import('./aerial-pipeline.js');
    return getStageExecutor(stage as any);
  });
  ipcMain.handle('pipeline:delete', async (_evt, id: string) => {
    const { deletePipeline } = await import('./aerial-pipeline.js');
    return deletePipeline(id);
  });

  log.info('IPC handlers registered (all modules: forms, cadastre, engineering, topographical, wayleave, map, drone, gcp, volume, pipeline)');
}

function getSingleProjectId(db: MetarduDatabase): string {
  const projects = db.query('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1') as { id: string }[];
  if (projects.length === 0) {
    // Auto-create a default project if none exists
    return db.initProject('Default Project');
  }
  return projects[0].id;
}
