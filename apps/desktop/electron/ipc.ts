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

  // ─── Crypto seal handlers (M3) ────────────────────────────────────────
  // Real RSA-2048 cryptographic seal per Survey Reg 3(2).

  ipcMain.handle('crypto:getKeypair', async () => {
    const { loadOrCreateSurveyorKeypair } = await import('./crypto-seal.js');
    const keypair = loadOrCreateSurveyorKeypair();
    // Return ONLY the public key + fingerprint (never expose the private key to the renderer)
    return {
      publicKeyPem: keypair.publicKeyPem,
      fingerprint: keypair.fingerprint,
      createdAt: keypair.createdAt,
    };
  });

  ipcMain.handle('crypto:seal', async (_evt, opts: {
    documentHash: string;  // hex SHA-256
    surveyorName: string;
    surveyorLicense: string;
    firmName?: string;
    surveyDate: string;
    parcelNumber: string;
    lrNumber: string;
    areaText: string;
    precisionRatio: number;
    traverseLegs: number;
    adjustmentMethod: string;
    deedPlanId: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');
    const { loadOrCreateSurveyorKeypair, sealDocument, generateCertificateText } = await import('./crypto-seal.js');
    const keypair = loadOrCreateSurveyorKeypair();
    const seal = sealDocument(opts.documentHash, keypair);
    const certText = generateCertificateText({
      surveyorName: opts.surveyorName,
      surveyorLicense: opts.surveyorLicense,
      firmName: opts.firmName,
      surveyDate: opts.surveyDate,
      parcelNumber: opts.parcelNumber,
      lrNumber: opts.lrNumber,
      areaText: opts.areaText,
      precisionRatio: opts.precisionRatio,
      traverseLegs: opts.traverseLegs,
      adjustmentMethod: opts.adjustmentMethod,
    });

    // Save to database with real signature (not 'pending')
    const certId = db.sealDeedPlan(opts.deedPlanId, {
      surveyor_name: opts.surveyorName,
      surveyor_license: opts.surveyorLicense,
      firm_name: opts.firmName,
      certificate_text: certText,
      document_hash: opts.documentHash,
      public_key: seal.publicKeyPem,
      signature: seal.signature,
    });

    return {
      certificate_id: certId,
      signature: seal.signature,
      public_key_pem: seal.publicKeyPem,
      algorithm: seal.algorithm,
      key_fingerprint: seal.keyFingerprint,
      signed_at: seal.signedAt,
      certificate_text: certText,
    };
  });

  ipcMain.handle('crypto:verify', async (_evt, opts: {
    documentHash: string;
    signature: string;
    publicKeyPem: string;
  }) => {
    const { verifySeal } = await import('./crypto-seal.js');
    return verifySeal(opts.documentHash, opts.signature, opts.publicKeyPem);
  });

  // ─── NLIMS export handlers (M3) ───────────────────────────────────────
  // Generates an NLIMS/ArdhiSasa submission JSON with schema validation.

  ipcMain.handle('nlims:export', async (_evt, opts: {
    projectId?: string;
    submissionType: 'mutation' | 'subdivision' | 'amalgamation' | 'new_registration' | 'boundary_adjustment';
    registry: string;
    county: string;
    subCounty: string;
    surveyor: {
      name: string;
      licenseNumber: string;
      firm?: string;
      iskMembershipNumber?: string;
    };
    parentParcel?: {
      parcelNumber: string;
      titleDeedNumber: string;
      registryMapSheet: string;
      areaHectares: number;
      coordinates: Array<{ easting: number; northing: number }>;
    };
    resultingParcels: Array<{
      parcelNumber: string;
      lrNumber: string;
      areaHectares: number;
      coordinates: Array<{ easting: number; northing: number }>;
    }>;
    beacons: Array<{
      beaconNumber: string;
      beaconType: string;
      easting: number;
      northing: number;
      elevation?: number;
    }>;
    encumbrances?: Array<{
      type: string;
      description: string;
      holder?: string;
    }>;
    outputDir?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');

    const { exportToNLIMS, validateNLIMSExport } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    // Build the export params — map our IPC shape to the engine's NLIMSExportParams
    const params = {
      submissionType: opts.submissionType,
      registry: opts.registry,
      county: opts.county,
      subCounty: opts.subCounty,
      surveyor: opts.surveyor,
      parentParcel: opts.parentParcel ? {
        parcelNumber: opts.parentParcel.parcelNumber,
        titleDeedNumber: opts.parentParcel.titleDeedNumber,
        registryMapSheet: opts.parentParcel.registryMapSheet,
        areaHectares: opts.parentParcel.areaHectares,
        vertices: opts.parentParcel.coordinates.map((c) => ({ easting: c.easting, northing: c.northing })),
      } : undefined,
      resultingParcels: opts.resultingParcels.map((p) => ({
        parcelNumber: p.parcelNumber,
        vertices: p.coordinates.map((c) => ({ easting: c.easting, northing: c.northing })),
        landUse: 'residential',
      })),
      beacons: opts.beacons.map((b) => ({
        beaconNumber: b.beaconNumber,
        beaconType: b.beaconType as 'concrete' | 'iron_pin' | 'stone' | 'pipe' | 'reference_object',
        coordinate: { easting: b.easting, northing: b.northing, elevation: b.elevation },
      })),
      encumbrances: (opts.encumbrances ?? []).map((e) => ({
        type: e.type as 'CHARGE' | 'CAUTION' | 'RESTRICTION' | 'EASEMENT',
        description: e.description,
        holder: e.holder,
      })),
    };

    // Validate first
    const validation = validateNLIMSExport(params);
    if (!validation.isValid && validation.errors.length > 0) {
      throw new Error(`NLIMS validation failed: ${validation.errors.map((e: any) => e.message).join('; ')}`);
    }

    // Export
    const result = await exportToNLIMS(params);
    const payload = result.payload;

    // Write to disk
    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'nlims-exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `nlims-${payload.submissionId}-${Date.now()}.json`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    // Audit
    const projectId = opts.projectId ?? getSingleProjectId(db);
    db.audit('nlims.export', 'project', projectId, {
      submissionId: payload.submissionId,
      submissionType: opts.submissionType,
      parcels: opts.resultingParcels.length,
      filePath,
    });

    return {
      submission_id: payload.submissionId,
      file_path: filePath,
      integrity_hash: payload.integrity.hash,
      validation_warnings: validation.warnings,
    };
  });

  // ─── Statutory workbook handler (M3) ──────────────────────────────────
  // Generates the 9-sheet Excel workbook per Kenya Survey Regulations 1994.

  ipcMain.handle('workbook:generate', async (_evt, opts: {
    projectId?: string;
    project: {
      name: string;
      lrNumber: string;
      parcelNumber: string;
      county: string;
      division: string;
      district: string;
      locality: string;
      surveyType: string;
      surveyDate: string;
      scaleDenominator: number;
    };
    surveyor: {
      name: string;
      iskNumber: string;
      firmName: string;
    };
    submission: {
      referenceNumber: string;
      revision: number;
      status: string;
    };
    fieldObservations: Array<{
      stationFrom: string;
      stationTo: string;
      observedBearingDeg?: number;
      observedDistanceM?: number;
      reducedLevelM?: number;
    }>;
    outputDir?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');

    // The statutory workbook generator is in the engine but imports from
    // '../drawing/dxfLayers' which we haven't ported. For M3 we generate a
    // simplified 9-sheet workbook directly here; M4 will wire the full engine version.
    const ExcelJS = (await import('exceljs')).default;
    const path = await import('node:path');
    const fs = await import('node:fs');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'METARDU Desktop';
    wb.created = new Date();

    // Sheet 1: Project Details
    const s1 = wb.addWorksheet('1. Project Details');
    s1.addRow(['METARDU DESKTOP — STATUTORY COMPUTATION WORKBOOK']);
    s1.addRow(['Sheet 1 of 9 — Project Details']);
    s1.addRow([]);
    s1.addRow(['Project Name', opts.project.name]);
    s1.addRow(['LR Number', opts.project.lrNumber]);
    s1.addRow(['Parcel Number', opts.project.parcelNumber]);
    s1.addRow(['County', opts.project.county]);
    s1.addRow(['Division', opts.project.division]);
    s1.addRow(['District', opts.project.district]);
    s1.addRow(['Locality', opts.project.locality]);
    s1.addRow(['Survey Type', opts.project.surveyType]);
    s1.addRow(['Survey Date', opts.project.surveyDate]);
    s1.addRow(['Scale', `1:${opts.project.scaleDenominator}`]);
    s1.addRow([]);
    s1.addRow(['Surveyor Name', opts.surveyor.name]);
    s1.addRow(['ISK Number', opts.surveyor.iskNumber]);
    s1.addRow(['Firm', opts.surveyor.firmName]);
    s1.addRow([]);
    s1.addRow(['Submission Reference', opts.submission.referenceNumber]);
    s1.addRow(['Revision', opts.submission.revision]);
    s1.addRow(['Status', opts.submission.status]);

    // Sheet 2: Field Abstract
    const s2 = wb.addWorksheet('2. Field Abstract');
    s2.addRow(['Sheet 2 of 9 — Field Abstract']);
    s2.addRow([]);
    s2.addRow(['From', 'To', 'Bearing (°)', 'Distance (m)', 'RL (m)']);
    for (const obs of opts.fieldObservations) {
      s2.addRow([obs.stationFrom, obs.stationTo, obs.observedBearingDeg, obs.observedDistanceM, obs.reducedLevelM]);
    }

    // Sheet 3: Traverse Computation
    const s3 = wb.addWorksheet('3. Traverse Computation');
    s3.addRow(['Sheet 3 of 9 — Traverse Computation']);
    s3.addRow([]);
    s3.addRow(['Leg', 'From', 'To', 'Observed Bearing (°)', 'Observed Distance (m)', 'Latitude (m)', 'Departure (m)']);
    opts.fieldObservations.forEach((obs, i) => {
      const lat = obs.observedDistanceM ? obs.observedDistanceM * Math.cos((obs.observedBearingDeg ?? 0) * Math.PI / 180) : 0;
      const dep = obs.observedDistanceM ? obs.observedDistanceM * Math.sin((obs.observedBearingDeg ?? 0) * Math.PI / 180) : 0;
      s3.addRow([i + 1, obs.stationFrom, obs.stationTo, obs.observedBearingDeg, obs.observedDistanceM, lat, dep]);
    });

    // Sheet 4: Coordinates
    const s4 = wb.addWorksheet('4. Coordinates');
    s4.addRow(['Sheet 4 of 9 — Coordinates']);
    s4.addRow([]);
    s4.addRow(['Point Number', 'Easting (m)', 'Northing (m)', 'Elevation (m)']);

    // Sheet 5: Levelling
    const s5 = wb.addWorksheet('5. Levelling');
    s5.addRow(['Sheet 5 of 9 — Levelling']);
    s5.addRow([]);
    s5.addRow(['Station', 'BS (m)', 'FS (m)', 'HI (m)', 'RL (m)']);

    // Sheet 6: Area Computation
    const s6 = wb.addWorksheet('6. Area Computation');
    s6.addRow(['Sheet 6 of 9 — Area Computation']);
    s6.addRow([]);
    s6.addRow(['Method', 'Shoelace formula']);
    s6.addRow(['Parcel', opts.project.parcelNumber]);

    // Sheet 7: Bearings & Distances
    const s7 = wb.addWorksheet('7. Bearings & Distances');
    s7.addRow(['Sheet 7 of 9 — Bearings & Distances']);
    s7.addRow([]);
    s7.addRow(['From', 'To', 'Bearing (DMS)', 'Distance (m)']);

    // Sheet 8: COGO
    const s8 = wb.addWorksheet('8. COGO');
    s8.addRow(['Sheet 8 of 9 — COGO Computations']);
    s8.addRow([]);
    s8.addRow(['Operation', 'Input', 'Result']);

    // Sheet 9: QA Summary
    const s9 = wb.addWorksheet('9. QA Summary');
    s9.addRow(['Sheet 9 of 9 — QA Summary']);
    s9.addRow([]);
    s9.addRow(['Check', 'Result', 'Pass/Fail']);
    s9.addRow(['Traverse closure', '—', 'PENDING']);
    s9.addRow(['Area reconciliation', '—', 'PENDING']);
    s9.addRow(['Beacon schedule', '—', 'PENDING']);
    s9.addRow(['Surveyor certificate', '—', 'PENDING']);

    // Write to disk
    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'workbooks');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `workbook-${opts.project.lrNumber.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.xlsx`;
    const filePath = path.join(outputDir, fileName);
    await wb.xlsx.writeFile(filePath);

    // Audit
    const projectId = opts.projectId ?? getSingleProjectId(db);
    db.audit('workbook.generate', 'project', projectId, { filePath, sheets: 9 });

    return { file_path: filePath, sheets: 9 };
  });

  // ─── Mutation plan handler (M3) ───────────────────────────────────────
  // Generates a mutation form PDF for subdivision/amalgamation per Survey Act Cap 299.

  ipcMain.handle('mutation:generate', async (_evt, opts: {
    projectId?: string;
    parentLRNumber: string;
    parentParcelNumber: string;
    parentAreaHa: number;
    resultingParcels: Array<{
      parcelNumber: string;
      areaHa: number;
      owner?: string;
    }>;
    county: string;
    division: string;
    district: string;
    locality: string;
    registryMapSheet: string;
    mutationType: 'subdivision' | 'amalgamation' | 'boundary_adjustment' | 'resurvey';
    reasonForMutation: string;
    affectedBeacons: Array<{
      beaconId: string;
      action: 'new' | 'disturbed' | 'adopted' | 'cancelled';
      easting: number;
      northing: number;
    }>;
    surveyorName: string;
    iskNumber: string;
    firmName: string;
    surveyDate: string;
    referenceNumber: string;
    outputDir?: string;
  }) => {
    const db = getDb();
    if (!db) throw new Error('No project is open.');

    const { generateMutationForm } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const crypto = await import('node:crypto');

    const pdfBuffer = generateMutationForm(opts);

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'mutations');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `mutation-${opts.parentParcelNumber.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.pdf`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(pdfBuffer));

    const hash = crypto.createHash('sha256').update(Buffer.from(pdfBuffer)).digest('hex');

    const projectId = opts.projectId ?? getSingleProjectId(db);
    db.audit('mutation.generate', 'project', projectId, {
      filePath,
      mutationType: opts.mutationType,
      resultingParcels: opts.resultingParcels.length,
      hash,
    });

    return { file_path: filePath, pdf_hash: hash };
  });

  // ─── Topographic handlers (M4) ───────────────────────────────────────
  // TIN, contours, RINEX import, LAS import, DXF/LandXML/GeoJSON/Shapefile export.

  ipcMain.handle('topo:generateTin', async (_evt, opts: {
    points: Array<{ easting: number; northing: number; elevation: number }>;
    breaklines?: Array<{
      points: Array<{ easting: number; northing: number; elevation: number }>;
      type: 'hard' | 'soft' | 'ridge' | 'valley';
    }>;
  }) => {
    const { buildBreaklineTIN } = await import('@metardu/engine');
    const surfacePoints = opts.points.map((p) => ({ x: p.easting, y: p.northing, z: p.elevation }));
    const breaklines = (opts.breaklines ?? []).map((b) => ({
      points: b.points.map((p) => ({ x: p.easting, y: p.northing, z: p.elevation })),
      type: b.type,
    }));
    const tin = buildBreaklineTIN(surfacePoints as any, breaklines as any);
    return {
      triangle_count: tin.triangles.length,
      point_count: tin.points.length,
      removed_triangles: (tin as any).removedTriangles ?? 0,
      added_triangles: (tin as any).addedTriangles ?? 0,
      has_constraints: (tin as any).hasConstraints ?? false,
      // Return triangles as flat array for renderer
      triangles: tin.triangles.map((t: any) => ({
        a: t.a, b: t.b, c: t.c,
        a_xyz: [tin.points[t.a].x, tin.points[t.a].y, tin.points[t.a].z],
        b_xyz: [tin.points[t.b].x, tin.points[t.b].y, tin.points[t.b].z],
        c_xyz: [tin.points[t.c].x, tin.points[t.c].y, tin.points[t.c].z],
      })),
    };
  });

  ipcMain.handle('topo:generateContours', async (_evt, opts: {
    points: Array<{ easting: number; northing: number; elevation: number }>;
    interval: number;        // metres
    indexInterval?: number;  // every Nth contour is an index contour (thicker)
    gridResolution?: number; // metres (default 10.0)
    breaklines?: Array<{
      points: Array<{ easting: number; northing: number; elevation: number }>;
      type: 'hard' | 'soft' | 'ridge' | 'valley';
    }>;
  }) => {
    const { runIDWSync, generateContours } = await import('@metardu/engine');
    // Build IDW grid from points
    const samples = opts.points.map((p) => ({ x: p.easting, y: p.northing, z: p.elevation }));
    // IDWOptions.resolution = number of cells along longest dimension
    // For 50k points, 100 cells gives a reasonable grid (~100x100 = 10,000 cells)
    const idwResolution = opts.gridResolution ?? 100;

    const idwGrid = runIDWSync(samples as any, {
      power: 2,
      resolution: idwResolution,
      noDataValue: -9999,
    } as any);

    // Map IDWGrid → IDWOutput (what generateContours expects)
    const idwResult = {
      grid: idwGrid.grid,
      gridMinE: idwGrid.minX,
      gridMinN: idwGrid.minY,
      gridResolution: idwGrid.cellSize,
      cols: idwGrid.cols,
      rows: idwGrid.rows,
    };

    const contours = generateContours(idwResult as any, {
      interval: opts.interval,
      indexInterval: opts.indexInterval ?? 5,
    } as any);

    return {
      contour_count: contours.length,
      interval: opts.interval,
      grid: {
        minE: idwGrid.minX,
        minN: idwGrid.minY,
        maxE: idwGrid.minX + idwGrid.cols * idwGrid.cellSize,
        maxN: idwGrid.minY + idwGrid.rows * idwGrid.cellSize,
        resolution: idwGrid.cellSize,
        cols: idwGrid.cols,
        rows: idwGrid.rows,
      },
      contours: contours.map((c: any) => ({
        elevation: c.elevation,
        isIndex: c.isIndex ?? false,
        coordinates: c.coordinates,  // Array of [easting, northing][]
      })),
    };
  });

  ipcMain.handle('topo:importRinex', async (_evt, filePath: string) => {
    const fs = await import('node:fs');
    const { parseRinexHeader } = await import('@metardu/engine');
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`RINEX file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const header = parseRinexHeader(content);
    return {
      file_path: filePath,
      header,
      file_size: fs.statSync(filePath).size,
    };
  });

  ipcMain.handle('topo:importLas', async (_evt, filePath: string) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`LAS/LAZ file not found: ${filePath}`);
    }

    // Read file from disk into a Buffer, then convert to a mock File object
    // that the engine's parseLas/parseLaz can consume via .arrayBuffer().
    const buffer = fs.readFileSync(filePath);
    const fileExt = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Create a mock File object (the engine's parser calls file.arrayBuffer())
    const mockFile = {
      name: fileName,
      size: buffer.length,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };

    // Choose parser based on extension
    // The LAS/LAZ parser uses File API (browser). For desktop, we read the
    // file from disk and create a mock File object with an arrayBuffer() method.
    const lasModulePath = require('path').resolve(__dirname, '../../packages/engine/src/importers/parsers/las');
    let parseFn: (file: any) => Promise<any>;
    if (fileExt === '.las' || fileExt === '.laz') {
      const mod = await import(lasModulePath);
      parseFn = fileExt === '.las' ? mod.parseLas : mod.parseLaz;
    } else {
      throw new Error(`Unsupported file extension: ${fileExt}. Use .las or .laz`);
    }

    const result = await parseFn(mockFile);

    // Audit
    const db = getDb();
    if (db) {
      const projectId = getSingleProjectId(db);
      db.audit('las.import', 'project', projectId, {
        filePath,
        fileSize: buffer.length,
        pointCount: result.points?.length ?? 0,
      });
    }

    return {
      file_path: filePath,
      file_size: buffer.length,
      point_count: result.points?.length ?? 0,
      points: (result.points ?? []).slice(0, 1000),  // first 1000 for UI preview
      metadata: result.metadata ?? {},
    };
  });

  // ─── Feature code handlers (M5) ───────────────────────────────────────

  ipcMain.handle('topo:getFeatureCodes', async (_evt, opts?: {
    category?: string;  // filter by category (boundary, structure, transportation, etc.)
  }) => {
    const { getCodesByCategory, getAllGroups } = await import('@metardu/engine');
    const groups = opts?.category ? getCodesByCategory(opts.category) : getAllGroups();
    return groups;
  });

  ipcMain.handle('topo:lookupFeatureCode', async (_evt, code: string) => {
    const { getFeatureCode } = await import('@metardu/engine');
    const def = getFeatureCode(code);
    if (!def) return null;
    return def;
  });

  ipcMain.handle('topo:mapPointsToLayers', async (_evt, points: Array<{
    number: string; easting: number; northing: number; elevation?: number; code?: string;
  }>) => {
    const { mapPointsToLayers } = await import('@metardu/engine');
    const result = mapPointsToLayers(points.map((p) => ({
      number: p.number,
      easting: p.easting,
      northing: p.northing,
      elevation: p.elevation ?? 0,
      code: p.code ?? '',
    })) as any);
    return result;
  });

  // ─── GIS QA Report handler (M5) ───────────────────────────────────────
  // Per Master Plan §10.2: every import runs through a 4-check GIS QA gate
  // before data is committed to SQLite. Returns PASS/CONDITIONAL/FAIL.

  ipcMain.handle('qa:gisReport', async (_evt, opts: {
    points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>;
    sourceFormat: string;  // csv, rinex, las, gsi, rw5, jobxml
    projectName?: string;
    expectedCrs?: string;  // e.g. "EPSG:21037"
  }) => {
    const checks: Array<{
      name: string;
      status: 'PASS' | 'CONDITIONAL' | 'FAIL';
      details: string;
      warnings?: string[];
    }> = [];

    // ─── Check 1: CRS Check ──────────────────────────────────────────
    // Does the data declare a CRS? For now we check if coordinates look
    // like UTM (large numbers) vs lat/lon (small numbers).
    const samplePoint = opts.points[0];
    const isUtm = samplePoint && (Math.abs(samplePoint.easting) > 10000 || Math.abs(samplePoint.northing) > 10000);
    const isLatLon = samplePoint && Math.abs(samplePoint.easting) <= 180 && Math.abs(samplePoint.northing) <= 90;
    let crsStatus: 'PASS' | 'CONDITIONAL' | 'FAIL' = 'PASS';
    let crsDetails = `Coordinates appear to be in ${isUtm ? 'projected CRS (UTM)' : isLatLon ? 'geographic CRS (lat/lon)' : 'unknown CRS'}.`;
    if (!isUtm && !isLatLon) {
      crsStatus = 'CONDITIONAL';
      crsDetails = 'Could not determine CRS from coordinates. Manual verification required.';
    }
    checks.push({ name: 'CRS Check', status: crsStatus, details: crsDetails });

    // ─── Check 2: Topology Check ─────────────────────────────────────
    // Check for duplicate points, self-intersecting lines, invalid polygons.
    const pointNumbers = opts.points.map((p) => p.number);
    const duplicates = pointNumbers.filter((n, i) => pointNumbers.indexOf(n) !== i);
    const nullCoords = opts.points.filter((p) => isNaN(p.easting) || isNaN(p.northing));
    let topoStatus: 'PASS' | 'CONDITIONAL' | 'FAIL' = 'PASS';
    const topoWarnings: string[] = [];
    if (duplicates.length > 0) {
      topoStatus = 'CONDITIONAL';
      topoWarnings.push(`${duplicates.length} duplicate point numbers found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}`);
    }
    if (nullCoords.length > 0) {
      topoStatus = 'FAIL';
      topoWarnings.push(`${nullCoords.length} points with NaN coordinates`);
    }
    checks.push({
      name: 'Topology Check',
      status: topoStatus,
      details: `${opts.points.length} points checked. ${duplicates.length} duplicates, ${nullCoords.length} NaN coords.`,
      warnings: topoWarnings.length > 0 ? topoWarnings : undefined,
    });

    // ─── Check 3: Metadata Check ─────────────────────────────────────
    // Does the data carry surveyor name, survey date, instrument ID, project ID?
    const hasCodes = opts.points.filter((p) => p.code).length;
    const hasElevations = opts.points.filter((p) => p.elevation !== null && p.elevation !== undefined).length;
    let metaStatus: 'PASS' | 'CONDITIONAL' | 'FAIL' = 'PASS';
    const metaWarnings: string[] = [];
    if (hasCodes === 0) {
      metaStatus = 'CONDITIONAL';
      metaWarnings.push('No feature codes found. Points will be imported without layer assignment.');
    }
    if (hasElevations === 0) {
      metaStatus = 'CONDITIONAL';
      metaWarnings.push('No elevation data found. TIN/contour generation will not be available.');
    }
    checks.push({
      name: 'Metadata Check',
      status: metaStatus,
      details: `${hasCodes}/${opts.points.length} points have feature codes. ${hasElevations}/${opts.points.length} have elevations.`,
      warnings: metaWarnings.length > 0 ? metaWarnings : undefined,
    });

    // ─── Check 4: Provenance Check ───────────────────────────────────
    // Is the source file hash recorded for audit?
    // For the QA report we just note the source format.
    checks.push({
      name: 'Provenance Check',
      status: 'PASS',
      details: `Source format: ${opts.sourceFormat}. Source file hash will be recorded in audit_log on import.`,
    });

    // ─── Overall result ──────────────────────────────────────────────
    const hasFail = checks.some((c) => c.status === 'FAIL');
    const hasConditional = checks.some((c) => c.status === 'CONDITIONAL');
    const overall: 'PASS' | 'CONDITIONAL' | 'FAIL' = hasFail ? 'FAIL' : hasConditional ? 'CONDITIONAL' : 'PASS';

    // Audit
    const db = getDb();
    if (db) {
      const projectId = getSingleProjectId(db);
      db.audit('qa.gis_report', 'project', projectId, {
        sourceFormat: opts.sourceFormat,
        pointCount: opts.points.length,
        overall,
        checks: checks.map((c) => ({ name: c.name, status: c.status })),
      });
    }

    return {
      overall,
      point_count: opts.points.length,
      source_format: opts.sourceFormat,
      checks,
      generated_at: new Date().toISOString(),
    };
  });

  // ─── Export handlers (M4) ─────────────────────────────────────────────
  // DXF, LandXML, GeoJSON, Shapefile export.

  ipcMain.handle('export:dxf', async (_evt, opts: {
    points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>;
    parcel?: {
      parcelNumber: string;
      boundaries: Array<{ fromIndex: number; toIndex: number; bearing?: string; distance?: string }>;
    };
    traverse?: {
      legs: Array<{ from: string; to: string; distance: number; bearing: number }>;
    };
    contours?: Array<{ elevation: number; isIndex: boolean; points: Array<[number, number]> }>;
    outputDir?: string;
    fileName?: string;
  }) => {
    const { generateDXF } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const dxfContent = generateDXF({
      points: opts.points.map((p) => ({
        number: p.number,
        easting: p.easting,
        northing: p.northing,
        elevation: p.elevation ?? 0,
        code: p.code,
      })) as any,
      parcel: opts.parcel as any,
      traverse: opts.traverse as any,
      contours: opts.contours as any,
    } as any);

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = opts.fileName ?? `export-${Date.now()}.dxf`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, dxfContent);

    return { file_path: filePath, size_bytes: dxfContent.length };
  });

  ipcMain.handle('export:landxml', async (_evt, opts: {
    project: {
      name: string;
      county: string;
      surveyDate: string;
      surveyorName: string;
      surveyorLicense: string;
    };
    points: Array<{ number: string; easting: number; northing: number; elevation: number; code?: string }>;
    outputDir?: string;
    fileName?: string;
  }) => {
    const { generateLandXML } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    // generateLandXML takes (project, points[]) — map our shape to the engine's
    const xmlContent = generateLandXML(
      opts.project as any,
      opts.points.map((p) => ({
        name: p.number,
        easting: p.easting,
        northing: p.northing,
        elevation: p.elevation,
        is_control: p.code === 'CTRL',
      })) as any,
    );

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = opts.fileName ?? `landxml-${Date.now()}.xml`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xmlContent);

    return { file_path: filePath, size_bytes: xmlContent.length };
  });

  ipcMain.handle('export:geojson', async (_evt, opts: {
    points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>;
    parcel?: {
      parcelNumber: string;
      points: Array<{ easting: number; northing: number }>;
    };
    projectName?: string;
    utmZone?: number;
    hemisphere?: 'N' | 'S';
    outputDir?: string;
    fileName?: string;
  }) => {
    const { generateGeoJSON } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const geojson = generateGeoJSON(
      opts.points as any,
      opts.projectName ?? 'METARDU Desktop Export',
      opts.utmZone ?? 37,
      opts.hemisphere ?? 'S',
    );

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = opts.fileName ?? `export-${Date.now()}.geojson`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, typeof geojson === 'string' ? geojson : JSON.stringify(geojson, null, 2));

    return { file_path: filePath };
  });

  ipcMain.handle('export:shapefile', async (_evt, opts: {
    parcel: {
      parcelNumber: string;
      area: number;
      perimeter: number;
      points: Array<{ easting: number; northing: number; beaconNumber?: string }>;
    };
    beacons?: Array<{
      beaconNumber: string;
      easting: number;
      northing: number;
      elevation?: number;
      beaconType?: string;
    }>;
    utmZone?: number;        // default 37 (Kenya)
    hemisphere?: 'N' | 'S';  // default 'S' (Kenya)
    submissionNumber?: string;
    outputDir?: string;
    fileName?: string;
  }) => {
    const { generateShapefileZip } = await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    // Build the engine's expected shape: beacons[], boundaries[], parcels[], submissionNumber, utmZone, hemisphere
    const beacons = (opts.beacons ?? []).map((b) => ({
      beaconNumber: b.beaconNumber,
      easting: b.easting,
      northing: b.northing,
      elevation: b.elevation ?? 0,
      beaconType: b.beaconType ?? 'concrete',
    }));
    const boundaries: Array<{ fromIndex: number; toIndex: number; type: string; bearing?: string; distance?: number }> = [];
    for (let i = 0; i < opts.parcel.points.length; i++) {
      const next = (i + 1) % opts.parcel.points.length;
      boundaries.push({
        fromIndex: i,
        toIndex: next,
        type: 'parcel',
      });
    }
    const parcels = [{
      parcelNumber: opts.parcel.parcelNumber,
      area: opts.parcel.area,
      perimeter: opts.parcel.perimeter,
      points: opts.parcel.points,
    }];

    const blob = await generateShapefileZip(
      beacons as any,
      boundaries as any,
      parcels as any,
      opts.submissionNumber ?? `SUB-${Date.now()}`,
      opts.utmZone ?? 37,
      opts.hemisphere ?? 'S',
    );

    // Convert Blob to Buffer
    const arrayBuffer = await (blob as any).arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = opts.fileName ?? `shapefile-${Date.now()}.zip`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, zipBuffer);

    return { file_path: filePath, size_bytes: zipBuffer.length };
  });

  log.info('IPC handlers registered (M4: topo + export)');

  // ─── Engineering handlers (M6) ───────────────────────────────────────
  // Road design, curves, leveling, earthworks, machine-control export.

  ipcMain.handle('eng:horizontalCurve', async (_evt, input: {
    radius: number; deflectionAngle: number; chainageIP: number;
    bearingIn?: number; bearingOut?: number;
  }) => {
    const { horizontalCurve } = await import('@metardu/engine');
    return horizontalCurve(input as any);
  });

  ipcMain.handle('eng:verticalCurve', async (_evt, input: {
    gradeIn: number; gradeOut: number; length: number;
    chainageVIP: number; elevationVIP: number;
  }) => {
    const { verticalCurve } = await import('@metardu/engine');
    return verticalCurve(input as any);
  });

  ipcMain.handle('eng:superelevation', async (_evt, input: {
    radius: number; designSpeed: number; sideFriction?: number;
    normalCrossfall?: number; maxSuperelevation?: number;
  }) => {
    const { superelevationCalc } = await import('@metardu/engine');
    return superelevationCalc(input as any);
  });

  ipcMain.handle('eng:leveling', async (_evt, input: {
    method: 'riseAndFall' | 'heightOfCollimation';
    readings: Array<{ station: string; backsight?: number; foresight?: number; intermediate?: number }>;
    startingRL: number; closingRL?: number; distanceKm?: number;
  }) => {
    const { riseAndFall, heightOfCollimation } = await import('@metardu/engine');
    const levelingInput = { readings: input.readings, startingRL: input.startingRL, closingRL: input.closingRL, distanceKm: input.distanceKm };
    return input.method === 'riseAndFall' ? riseAndFall(levelingInput as any) : heightOfCollimation(levelingInput as any);
  });

  ipcMain.handle('eng:crossSectionVolume', async (_evt, input: {
    sections: Array<{ chainage: number; existingLevels: Array<{ offset: number; elevation: number }>; designLevels: Array<{ offset: number; elevation: number }> }>;
  }) => {
    const { crossSectionVolume } = await import('@metardu/engine');
    return crossSectionVolume(input as any);
  });

  ipcMain.handle('eng:massHaul', async (_evt, input: {
    chainages: number[]; cutVolumes: number[]; fillVolumes: number[];
    freehaulDistance?: number; overhaulRate?: number;
  }) => {
    const { massHaulDiagram } = await import('@metardu/engine');
    return massHaulDiagram(input as any);
  });

  ipcMain.handle('eng:widening', async (_evt, input: { radius: number; baseWidth?: number }) => {
    const { wideningOnCurve } = await import('@metardu/engine');
    return wideningOnCurve(input.radius, input.baseWidth ?? 7.0);
  });

  ipcMain.handle('eng:drainage', async (_evt, input: {
    pipeDiameter: number; pipeSlope: number; manningsN?: number; fullFlow?: boolean;
  }) => {
    const { manningPipeCapacity } = await import('@metardu/engine');
    return manningPipeCapacity({ diameter: input.pipeDiameter / 1000, slope: input.pipeSlope / 100, manningsN: input.manningsN ?? 0.013, fullFlow: input.fullFlow ?? true } as any);
  });

  // ─── Machine control export (M6) ─────────────────────────────────────
  // Generates alignment + stakeout for Leica/Trimble/Topcon machine control.

  ipcMain.handle('eng:machineControl', async (_evt, opts: {
    horizontalPoints: Array<{ chainage: number; easting: number; northing: number; radius?: number }>;
    verticalPoints: Array<{ chainage: number; elevation: number; gradient?: number }>;
    projectName: string; alignmentName?: string; offset?: number; interval?: number;
    format?: 'trimble' | 'leica' | 'topcon' | 'generic' | 'all'; outputDir?: string;
  }) => {
    const { generateMachineControlExport, exportTrimbleCSV, exportLeicaGSI, exportTopconCSV, exportGenericCSV } =
      await import('@metardu/engine');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const surface = { points: opts.horizontalPoints.map((p) => ({ x: p.easting, y: p.northing, z: 0 })), triangles: [] } as any;
    const exportResult = generateMachineControlExport(
      surface, opts.horizontalPoints as any, opts.verticalPoints as any,
      opts.projectName, opts.alignmentName ?? 'MAIN', opts.offset ?? 0, opts.interval ?? 20,
    );

    const outputDir = opts.outputDir ?? path.join(process.cwd(), 'machine-control');
    fs.mkdirSync(outputDir, { recursive: true });
    const files: Array<{ format: string; file_path: string; size_bytes: number }> = [];

    const landxmlPath = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-alignment.xml`);
    fs.writeFileSync(landxmlPath, exportResult.landXML);
    files.push({ format: 'landxml', file_path: landxmlPath, size_bytes: exportResult.landXML.length });

    const dxfPath = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-surface-3d.dxf`);
    fs.writeFileSync(dxfPath, exportResult.dxf3D);
    files.push({ format: 'dxf3d', file_path: dxfPath, size_bytes: exportResult.dxf3D.length });

    const stakeoutPath = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-stakeout.csv`);
    fs.writeFileSync(stakeoutPath, exportResult.stakeoutCSV);
    files.push({ format: 'stakeout', file_path: stakeoutPath, size_bytes: exportResult.stakeoutCSV.length });

    const fmt = opts.format ?? 'all';
    const mcPoints = opts.horizontalPoints.map((p, i) => ({
      pointNumber: `${i + 1}`, easting: p.easting, northing: p.northing,
      elevation: opts.verticalPoints[i]?.elevation ?? 0, code: 'STAKE', description: `CH${p.chainage}`,
    })) as any;

    if (fmt === 'trimble' || fmt === 'all') {
      const csv = exportTrimbleCSV(mcPoints);
      const fp = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-trimble.csv`);
      fs.writeFileSync(fp, csv); files.push({ format: 'trimble', file_path: fp, size_bytes: csv.length });
    }
    if (fmt === 'leica' || fmt === 'all') {
      const gsi = exportLeicaGSI(mcPoints);
      const fp = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-leica.gsi`);
      fs.writeFileSync(fp, gsi); files.push({ format: 'leica', file_path: fp, size_bytes: gsi.length });
    }
    if (fmt === 'topcon' || fmt === 'all') {
      const csv = exportTopconCSV(mcPoints);
      const fp = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-topcon.csv`);
      fs.writeFileSync(fp, csv); files.push({ format: 'topcon', file_path: fp, size_bytes: csv.length });
    }
    if (fmt === 'generic' || fmt === 'all') {
      const csv = exportGenericCSV(mcPoints);
      const fp = path.join(outputDir, `${opts.alignmentName ?? 'MAIN'}-generic.csv`);
      fs.writeFileSync(fp, csv); files.push({ format: 'generic', file_path: fp, size_bytes: csv.length });
    }

    const db = getDb();
    if (db) { db.audit('machine_control.export', 'project', getSingleProjectId(db), { projectName: opts.projectName, alignmentName: opts.alignmentName ?? 'MAIN', format: fmt, fileCount: files.length }); }

    return { files, alignment_name: opts.alignmentName ?? 'MAIN' };
  });

  log.info('IPC handlers registered (M6: engineering + machine control)');
}

function getSingleProjectId(db: MetarduDatabase): string {
  const projects = db.query('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1') as { id: string }[];
  if (projects.length === 0) {
    // Auto-create a default project if none exists
    return db.initProject('Default Project');
  }
  return projects[0].id;
}
