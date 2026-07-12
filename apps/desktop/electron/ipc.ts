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

  // ─── Traverse handlers (M2) ───────────────────────────────────────────
  // Computes a Bowditch/Transit adjustment using the engine's traverse module,
  // saves the traverse + legs + stations to SQLite, and returns the traverse id.

  ipcMain.handle('traverse:compute', async (_evt, input: import('./database.js').TraverseComputeInput) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');

    // Lazy-import the engine's traverse module (avoid bundling it in main bundle)
    const { bowditchAdjustment, transitAdjustment, evaluateTraverseClosure, TRAVERSE_PRECISION_STANDARDS } =
      await import('@metardu/engine');

    // Build the engine input shape
    const points = [{ name: input.start_point?.point_number ?? 'A', easting: input.start_point?.easting ?? 0, northing: input.start_point?.northing ?? 0 }];
    const distances: number[] = [];
    const bearings: number[] = [];
    for (const leg of input.legs) {
      points.push({ name: leg.to_point_number, easting: 0, northing: 0 });
      distances.push(leg.observed_distance);
      bearings.push(leg.observed_bearing);
    }

    const method = input.adjustment_method ?? 'bowditch';
    const result = method === 'bowditch'
      ? bowditchAdjustment({ points, distances, bearings, closingPoint: input.closing_point })
      : method === 'transit'
        ? transitAdjustment({ points, distances, bearings, closingPoint: input.closing_point })
        : bowditchAdjustment({ points, distances, bearings, closingPoint: input.closing_point });

    // Evaluate precision against Kenya Survey Regulations 1994
    // TraverseResult uses linearError (in metres) and totalDistance (perimeter in metres)
    const surveyType = (input.survey_type ?? 'cadastral') as keyof typeof TRAVERSE_PRECISION_STANDARDS;
    const evalResult = evaluateTraverseClosure(result.linearError, result.totalDistance, surveyType);

    // Build adjusted legs with lat/dep
    const adjustedLegs = result.legs.map((leg: any, i: number) => ({
      from_point_number: input.legs[i].from_point_number,
      to_point_number: input.legs[i].to_point_number,
      observed_distance: input.legs[i].observed_distance,
      observed_bearing: input.legs[i].observed_bearing,
      adjusted_distance: leg.distance,
      adjusted_bearing: leg.bearing,
      latitude: leg.adjDeltaN ?? leg.rawDeltaN ?? 0,
      departure: leg.adjDeltaE ?? leg.rawDeltaE ?? 0,
    }));

    // Build stations list with adjusted coordinates
    // For a closed traverse, compute adjusted station coordinates by accumulating deltas
    const stations: Array<{ point_number: string; easting: number; northing: number; correction_easting?: number; correction_northing?: number }> = [];
    let runningE = input.start_point?.easting ?? 0;
    let runningN = input.start_point?.northing ?? 0;
    stations.push({ point_number: input.start_point?.point_number ?? 'A', easting: runningE, northing: runningN });
    for (let i = 0; i < result.legs.length; i++) {
      const leg = result.legs[i];
      runningE += leg.adjDeltaE ?? leg.rawDeltaE ?? 0;
      runningN += leg.adjDeltaN ?? leg.rawDeltaN ?? 0;
      stations.push({
        point_number: input.legs[i].to_point_number,
        easting: runningE,
        northing: runningN,
        correction_easting: leg.correctionE,
        correction_northing: leg.correctionN,
      });
    }

    const traverseId = db.saveTraverse(input, {
      perimeter: result.totalDistance,
      linear_misclosure: result.linearError,
      precision_ratio: evalResult.ratio,
      precision_passes: evalResult.passes,
      adjusted_legs: adjustedLegs,
      stations: stations,
    });

    return {
      traverse_id: traverseId,
      perimeter: result.totalDistance,
      linear_misclosure: result.linearError,
      precision_ratio: evalResult.ratio,
      precision_passes: evalResult.passes,
      precision_minimum: evalResult.minimum,
      adjusted_legs: adjustedLegs,
      stations: stations,
    };
  });

  ipcMain.handle('traverse:list', (_evt, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const targetProjectId = projectId ?? getSingleProjectId(db);
    return db.listTraverses(targetProjectId);
  });

  ipcMain.handle('traverse:get', (_evt, traverseId: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.getTraverse(traverseId);
  });

  // ─── Parcel handlers (M2) ─────────────────────────────────────────────

  ipcMain.handle('parcel:create', (_evt, data: {
    parcel_number: string; lr_number?: string; registry?: string;
    area_sqm?: number; perimeter_m?: number; survey_type?: string;
    traverse_id?: string;
    points?: Array<{ point_number: string; easting: number; northing: number }>;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const projectId = getSingleProjectId(db);
    const parcelId = db.createParcel(projectId, data);
    return { parcel_id: parcelId };
  });

  ipcMain.handle('parcel:list', (_evt, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.listParcels(projectId ?? getSingleProjectId(db));
  });

  ipcMain.handle('parcel:getPoints', (_evt, parcelId: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.getParcelPoints(parcelId);
  });

  // ─── Beacon handlers (M2) ─────────────────────────────────────────────

  ipcMain.handle('beacon:create', (_evt, data: {
    beacon_number: string; beacon_type?: string;
    easting: number; northing: number; elevation?: number;
    placed_date?: string; placed_by?: string; description?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const projectId = getSingleProjectId(db);
    const beaconId = db.createBeacon(projectId, data);
    return { beacon_id: beaconId };
  });

  ipcMain.handle('beacon:list', (_evt, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.listBeacons(projectId ?? getSingleProjectId(db));
  });

  ipcMain.handle('beacon:update', (_evt, beaconId: string, updates: Record<string, unknown>) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const changes = db.updateBeacon(beaconId, updates);
    return { changes };
  });

  ipcMain.handle('beacon:delete', (_evt, beaconId: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const changes = db.deleteBeacon(beaconId);
    return { changes };
  });

  // ─── Deed plan handlers (M2) ──────────────────────────────────────────
  // Generates a PDF using the engine's deed-plan template and saves it to disk.

  ipcMain.handle('deedPlan:generate', async (_evt, opts: {
    parcel_id?: string;
    traverse_id?: string;
    points: Array<{ number: string; easting: number; northing: number; is_beacon?: boolean }>;
    title_data: {
      lrNumber: string;
      area: string;
      scale: number;
      surveyorName: string;
      surveyorLicense: string;
      date: string;
      county: string;
      subCounty?: string;
      registryMapSheet?: string;
      deedPlanNumber?: string;
      projection?: string;
      datum?: string;
    };
    paper_size?: 'A1' | 'A2' | 'A3' | 'A4';
    output_dir?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');

    // Lazy-import the deed plan template
    const { DEED_PLAN_TEMPLATE } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const crypto = await import('node:crypto');

    // Build points/boundaries for the template
    // DeedPlanPoint requires: easting, northing, label, beaconType ('control'|'beacon'|'benchmark')
    const templatePoints = opts.points.map((p) => ({
      easting: p.easting,
      northing: p.northing,
      label: p.number,
      beaconType: 'beacon' as const,
      description: p.is_beacon ? 'Beacon' : 'Point',
    }));
    // DeedPlanBoundary requires: fromIndex, toIndex, type ('scheme'|'parcel'|'road'|'river'|'dimension')
    const boundaries = opts.points.map((_, i) => ({
      fromIndex: i,
      toIndex: (i + 1) % opts.points.length,
      type: 'parcel' as const,
    }));

    // Generate PDF buffer
    const pdfBuffer = await DEED_PLAN_TEMPLATE.generate({
      points: templatePoints,
      boundaries,
      paperSize: opts.paper_size ?? 'A1',
      scale: opts.title_data.scale,
      titleData: opts.title_data,
      metadata: {
        title: `Deed Plan — ${opts.title_data.lrNumber}`,
        subject: 'Kenya Survey Department Deed Plan',
        creator: 'METARDU Desktop',
      } as any,  // DocumentMetadata type may not include 'author'; cast for now
    });

    // Write to disk
    const outputDir = opts.output_dir ?? path.join(process.cwd(), 'deed-plans');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `deed-plan-${opts.title_data.lrNumber.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.pdf`;
    const pdfPath = path.join(outputDir, fileName);
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Compute SHA-256 hash
    const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    // Save to database
    const projectId = getSingleProjectId(db);
    const deedPlanId = db.saveDeedPlan(projectId, {
      parcel_id: opts.parcel_id,
      traverse_id: opts.traverse_id,
      lr_number: opts.title_data.lrNumber,
      paper_size: opts.paper_size ?? 'A1',
      scale: opts.title_data.scale,
      surveyor_name: opts.title_data.surveyorName,
      surveyor_license: opts.title_data.surveyorLicense,
      county: opts.title_data.county,
      sub_county: opts.title_data.subCounty,
      survey_date: opts.title_data.date,
      area_text: opts.title_data.area,
      pdf_path: pdfPath,
      pdf_hash: hash,
    });

    return { deed_plan_id: deedPlanId, pdf_path: pdfPath, pdf_hash: hash };
  });

  ipcMain.handle('deedPlan:list', (_evt, projectId?: string) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    return db.listDeedPlans(projectId ?? getSingleProjectId(db));
  });

  ipcMain.handle('deedPlan:seal', (_evt, deedPlanId: string, sealPayload: {
    surveyor_name: string;
    surveyor_license: string;
    firm_name?: string;
    certificate_text: string;
    public_key?: string;
    signature?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    // Get the deed plan to retrieve its hash
    const dp = db.query('SELECT pdf_hash FROM deed_plans WHERE id = ?', [deedPlanId]) as { pdf_hash: string }[];
    if (dp.length === 0) throw new Error(`Deed plan not found: ${deedPlanId}`);
    const certId = db.sealDeedPlan(deedPlanId, {
      ...sealPayload,
      document_hash: dp[0].pdf_hash,
    });
    return { certificate_id: certId };
  });

  log.info('IPC handlers registered (M2: traverse + parcel + beacon + deedPlan)');
}

function getSingleProjectId(db: MetarduDatabase): string {
  const projects = db.query('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1') as { id: string }[];
  if (projects.length === 0) {
    // Auto-create a default project if none exists
    return db.initProject('Default Project');
  }
  return projects[0].id;
}
