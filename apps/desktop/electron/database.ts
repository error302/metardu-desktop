/**
 * SQLite + SpatiaLite persistence layer.
 *
 * Per ADR-002: SQLite 3 with the SpatiaLite extension, accessed via better-sqlite3.
 * A "project" is a single .metardu file (which is just a SQLite database).
 *
 * The schema is ported from metardu's 47 PostgreSQL migrations. For the walking
 * skeleton we only need 4 tables: projects, points, observations, audit_log.
 * The full schema migration will happen in M2-M3 (cadastral UI).
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';

export interface SurveyPoint {
  point_number: string;
  easting: number;
  northing: number;
  elevation: number | null;
  code: string | null;
  description: string | null;
  source: 'csv' | 'gnss' | 'total_station' | 'manual';
}

export interface TraverseLegInput {
  from_point_number: string;
  to_point_number: string;
  observed_distance: number;
  observed_bearing: number;
}

export interface TraverseComputeInput {
  project_id: string;
  name: string;
  survey_type?: string;
  adjustment_method?: 'bowditch' | 'transit' | 'none';
  legs: TraverseLegInput[];
  start_point?: { point_number: string; easting: number; northing: number };
  closing_point?: { point_number: string; easting: number; northing: number };
}

export interface TraverseComputeResult {
  perimeter: number;
  linear_misclosure: number;
  angular_misclosure?: number;
  precision_ratio: number;
  precision_passes: boolean;
  adjusted_legs: Array<{
    from_point_number: string;
    to_point_number: string;
    observed_distance: number;
    observed_bearing: number;
    adjusted_distance?: number;
    adjusted_bearing?: number;
    latitude: number;
    departure: number;
  }>;
  stations: Array<{
    point_number: string;
    easting: number;
    northing: number;
    correction_easting?: number;
    correction_northing?: number;
  }>;
}

export class MetarduDatabase {
  private db: DatabaseType;

  constructor(filePath: string) {
    log.info(`Opening database: ${filePath}`);
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country_pack TEXT NOT NULL DEFAULT 'KEN',
        default_crs_epsg INTEGER NOT NULL DEFAULT 21037,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        point_number TEXT NOT NULL,
        easting REAL NOT NULL,
        northing REAL NOT NULL,
        elevation REAL,
        code TEXT,
        description TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_point TEXT NOT NULL,
        to_point TEXT NOT NULL,
        distance REAL NOT NULL,
        bearing REAL NOT NULL,
        vertical_angle REAL,
        instrument TEXT,
        observed_at TEXT,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        actor TEXT NOT NULL DEFAULT 'system',
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_points_project ON points(project_id);
      CREATE INDEX IF NOT EXISTS idx_points_number ON points(point_number);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    `);

    const versionRow = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
    const currentVersion = versionRow.v ?? 0;
    if (currentVersion < 1) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
      log.info('Schema migrated to version 1 (walking skeleton)');
    }

    // ─── Migration v2: Cadastral tables (M2) ────────────────────────────
    // Per ADR-005: country-pack architecture. KEN pack ships in v1.0.
    // Per Master Plan §6: cadastral MVP ships in M2-M3.
    if (currentVersion < 2) {
      this.db.exec(`
        -- Traverse surveys (a closed loop of observations + adjustment)
        CREATE TABLE IF NOT EXISTS traverses (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          survey_type TEXT NOT NULL DEFAULT 'cadastral',  -- cadastral|engineering|topographic|geodetic|...
          adjustment_method TEXT NOT NULL DEFAULT 'bowditch',  -- bowditch|transit|none
          start_point_number TEXT,
          closing_point_number TEXT,
          perimeter REAL,         -- total traverse length in metres
          linear_misclosure REAL, -- in metres
          angular_misclosure REAL,-- in seconds
          precision_ratio REAL,   -- e.g. 5000 means 1:5000
          precision_passes INTEGER NOT NULL DEFAULT 0,  -- 0 = not yet evaluated; 1 = pass; -1 = fail
          status TEXT NOT NULL DEFAULT 'draft',  -- draft|adjusted|sealed|submitted
          computed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- Traverse legs (one per observed line)
        CREATE TABLE IF NOT EXISTS traverse_legs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          traverse_id TEXT NOT NULL,
          leg_index INTEGER NOT NULL,  -- 0-based ordering
          from_point_number TEXT NOT NULL,
          to_point_number TEXT NOT NULL,
          observed_distance REAL NOT NULL,    -- metres
          observed_bearing REAL NOT NULL,     -- WCB degrees
          adjusted_distance REAL,
          adjusted_bearing REAL,
          latitude REAL,        -- delta northing (adjusted)
          departure REAL,       -- delta easting (adjusted)
          FOREIGN KEY (traverse_id) REFERENCES traverses(id) ON DELETE CASCADE
        );

        -- Adjusted traverse stations (one per traverse point)
        CREATE TABLE IF NOT EXISTS traverse_stations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          traverse_id TEXT NOT NULL,
          point_number TEXT NOT NULL,
          easting REAL NOT NULL,
          northing REAL NOT NULL,
          elevation REAL,
          is_control INTEGER NOT NULL DEFAULT 0,  -- 1 if this is a known control point
          correction_easting REAL,    -- Bowditch correction applied
          correction_northing REAL,
          FOREIGN KEY (traverse_id) REFERENCES traverses(id) ON DELETE CASCADE
        );

        -- Parcels (land parcels — the unit of cadastral surveying)
        CREATE TABLE IF NOT EXISTS parcels (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parcel_number TEXT NOT NULL,        -- e.g. "LR 12345/6"
          lr_number TEXT,                     -- Land Reference number
          registry TEXT,                      -- e.g. "Registry of Titles"
          area_sqm REAL,                      -- area in square metres
          perimeter_m REAL,
          survey_type TEXT NOT NULL DEFAULT 'cadastral',
          traverse_id TEXT,                   -- the traverse that established this parcel
          status TEXT NOT NULL DEFAULT 'draft',  -- draft|surveyed|sealed|registered
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (traverse_id) REFERENCES traverses(id)
        );

        -- Parcel boundary points (ordered list defining the parcel polygon)
        CREATE TABLE IF NOT EXISTS parcel_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parcel_id TEXT NOT NULL,
          point_index INTEGER NOT NULL,  -- 0-based ordering around the parcel
          point_number TEXT NOT NULL,
          easting REAL NOT NULL,
          northing REAL NOT NULL,
          beacon_id TEXT,  -- FK to beacons table if a beacon exists at this point
          FOREIGN KEY (parcel_id) REFERENCES parcels(id) ON DELETE CASCADE
        );

        -- Beacons (physical survey markers placed at parcel corners)
        CREATE TABLE IF NOT EXISTS beacons (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          beacon_number TEXT NOT NULL,
          beacon_type TEXT NOT NULL DEFAULT 'concrete',  -- concrete|iron_pin|stone|natural
          easting REAL NOT NULL,
          northing REAL NOT NULL,
          elevation REAL,
          easting_original REAL,    -- original placed position
          northing_original REAL,
          placed_date TEXT,
          placed_by TEXT,           -- surveyor name
          condition TEXT NOT NULL DEFAULT 'good',  -- good|disturbed|destroyed|missing
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- Deed plans (generated PDF documents)
        CREATE TABLE IF NOT EXISTS deed_plans (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parcel_id TEXT,
          traverse_id TEXT,
          plan_number TEXT,           -- DP number assigned by surveyor
          lr_number TEXT,
          deed_plan_number TEXT,      -- assigned by Director of Surveys
          registry_map_sheet TEXT,    -- SoK registry map sheet reference
          paper_size TEXT NOT NULL DEFAULT 'A1',  -- A1|A2|A3|A4
          scale INTEGER NOT NULL DEFAULT 1000,    -- 1:1000
          surveyor_name TEXT,
          surveyor_license TEXT,
          county TEXT,
          sub_county TEXT,
          survey_date TEXT,
          area_text TEXT,             -- formatted area string (e.g. "0.4047 HA")
          pdf_path TEXT,              -- path to generated PDF on disk
          pdf_hash TEXT,              -- SHA-256 of PDF for integrity
          sealed INTEGER NOT NULL DEFAULT 0,  -- 0 = draft, 1 = sealed with crypto seal
          sealed_at TEXT,
          seal_payload TEXT,          -- JSON: surveyor name, license, timestamp, hash
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (parcel_id) REFERENCES parcels(id),
          FOREIGN KEY (traverse_id) REFERENCES traverses(id)
        );

        -- Surveyor certificates (crypto seals per Survey Reg 3(2))
        CREATE TABLE IF NOT EXISTS surveyor_certificates (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          deed_plan_id TEXT,
          surveyor_name TEXT NOT NULL,
          surveyor_license TEXT NOT NULL,
          firm_name TEXT,
          certificate_text TEXT NOT NULL,  -- full text of the certificate
          document_hash TEXT NOT NULL,     -- SHA-256 of the document being sealed
          seal_method TEXT NOT NULL DEFAULT 'local-rsa',  -- local-rsa|hardware-token|pending
          public_key TEXT,                 -- PEM-encoded RSA public key
          signature TEXT,                  -- base64 RSA signature
          sealed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (deed_plan_id) REFERENCES deed_plans(id)
        );

        -- Indexes for cadastral tables
        CREATE INDEX IF NOT EXISTS idx_traverses_project ON traverses(project_id);
        CREATE INDEX IF NOT EXISTS idx_traverses_status ON traverses(status);
        CREATE INDEX IF NOT EXISTS idx_traverse_legs_traverse ON traverse_legs(traverse_id);
        CREATE INDEX IF NOT EXISTS idx_traverse_stations_traverse ON traverse_stations(traverse_id);
        CREATE INDEX IF NOT EXISTS idx_parcels_project ON parcels(project_id);
        CREATE INDEX IF NOT EXISTS idx_parcels_number ON parcels(parcel_number);
        CREATE INDEX IF NOT EXISTS idx_parcel_points_parcel ON parcel_points(parcel_id);
        CREATE INDEX IF NOT EXISTS idx_beacons_project ON beacons(project_id);
        CREATE INDEX IF NOT EXISTS idx_beacons_number ON beacons(beacon_number);
        CREATE INDEX IF NOT EXISTS idx_deed_plans_project ON deed_plans(project_id);
        CREATE INDEX IF NOT EXISTS idx_deed_plans_parcel ON deed_plans(parcel_id);
        CREATE INDEX IF NOT EXISTS idx_certificates_project ON surveyor_certificates(project_id);
        CREATE INDEX IF NOT EXISTS idx_certificates_deed ON surveyor_certificates(deed_plan_id);
      `);
      this.db.prepare('INSERT INTO schema_version (version) VALUES (2)').run();
      log.info('Schema migrated to version 2 (cadastral tables)');
    }
  }

  initProject(name: string, countryPack = 'KEN', crsEpsg = 21037): string {
    const projectId = `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      'INSERT INTO projects (id, name, country_pack, default_crs_epsg) VALUES (?, ?, ?, ?)',
    ).run(projectId, name, countryPack, crsEpsg);
    this.audit('project.create', 'project', projectId, { name });
    return projectId;
  }

  insertPoints(projectId: string, points: SurveyPoint[]): number {
    const tx = this.db.transaction((pts: SurveyPoint[]) => {
      const stmt = this.db.prepare(
        `INSERT INTO points (point_number, easting, northing, elevation, code, description, source, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of pts) {
        stmt.run(p.point_number, p.easting, p.northing, p.elevation, p.code, p.description, p.source, projectId);
      }
    });
    tx(points);
    this.audit('points.import', 'point', null, { count: points.length, projectId });
    return points.length;
  }

  getPoints(projectId: string): SurveyPoint[] {
    return this.db.prepare(
      `SELECT point_number, easting, northing, elevation, code, description, source
       FROM points WHERE project_id = ? ORDER BY point_number`,
    ).all(projectId) as SurveyPoint[];
  }

  // ─── Traverse operations (M2) ─────────────────────────────────────────

  saveTraverse(input: TraverseComputeInput, result: TraverseComputeResult): string {
    const traverseId = `trv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const tx = this.db.transaction(() => {
      // Insert traverse record
      this.db.prepare(
        `INSERT INTO traverses
          (id, project_id, name, survey_type, adjustment_method, start_point_number, closing_point_number,
           perimeter, linear_misclosure, angular_misclosure, precision_ratio, precision_passes, status, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'adjusted', datetime('now'))`,
      ).run(
        traverseId, input.project_id, input.name,
        input.survey_type ?? 'cadastral',
        input.adjustment_method ?? 'bowditch',
        input.start_point?.point_number ?? null,
        input.closing_point?.point_number ?? null,
        result.perimeter,
        result.linear_misclosure,
        result.angular_misclosure ?? null,
        result.precision_ratio,
        result.precision_passes ? 1 : -1,
      );

      // Insert legs
      const legStmt = this.db.prepare(
        `INSERT INTO traverse_legs
          (traverse_id, leg_index, from_point_number, to_point_number,
           observed_distance, observed_bearing, adjusted_distance, adjusted_bearing, latitude, departure)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      result.adjusted_legs.forEach((leg, i) => {
        legStmt.run(
          traverseId, i, leg.from_point_number, leg.to_point_number,
          leg.observed_distance, leg.observed_bearing,
          leg.adjusted_distance ?? null, leg.adjusted_bearing ?? null,
          leg.latitude, leg.departure,
        );
      });

      // Insert stations (adjusted coordinates)
      const stStmt = this.db.prepare(
        `INSERT INTO traverse_stations
          (traverse_id, point_number, easting, northing, is_control, correction_easting, correction_northing)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      result.stations.forEach((s) => {
        const isControl = (input.start_point?.point_number === s.point_number || input.closing_point?.point_number === s.point_number) ? 1 : 0;
        stStmt.run(traverseId, s.point_number, s.easting, s.northing, isControl, s.correction_easting ?? null, s.correction_northing ?? null);
      });
    });
    tx();
    this.audit('traverse.compute', 'traverse', traverseId, {
      name: input.name,
      legs: result.adjusted_legs.length,
      precision: result.precision_ratio,
      passes: result.precision_passes,
    });
    return traverseId;
  }

  listTraverses(projectId: string): unknown[] {
    return this.db.prepare(
      `SELECT id, name, survey_type, adjustment_method, perimeter, linear_misclosure,
              angular_misclosure, precision_ratio, precision_passes, status, computed_at, created_at
       FROM traverses WHERE project_id = ? ORDER BY created_at DESC`,
    ).all(projectId);
  }

  getTraverse(traverseId: string): { traverse: unknown; legs: unknown[]; stations: unknown[] } {
    const traverse = this.db.prepare('SELECT * FROM traverses WHERE id = ?').get(traverseId);
    const legs = this.db.prepare(
      'SELECT * FROM traverse_legs WHERE traverse_id = ? ORDER BY leg_index',
    ).all(traverseId);
    const stations = this.db.prepare(
      'SELECT * FROM traverse_stations WHERE traverse_id = ? ORDER BY id',
    ).all(traverseId);
    return { traverse, legs, stations };
  }

  // ─── Parcel operations (M2) ───────────────────────────────────────────

  createParcel(projectId: string, data: {
    parcel_number: string;
    lr_number?: string;
    registry?: string;
    area_sqm?: number;
    perimeter_m?: number;
    survey_type?: string;
    traverse_id?: string;
    points?: Array<{ point_number: string; easting: number; northing: number }>;
  }): string {
    const parcelId = `prc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO parcels (id, project_id, parcel_number, lr_number, registry, area_sqm, perimeter_m, survey_type, traverse_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'surveyed')`,
      ).run(
        parcelId, projectId, data.parcel_number,
        data.lr_number ?? null, data.registry ?? null,
        data.area_sqm ?? null, data.perimeter_m ?? null,
        data.survey_type ?? 'cadastral', data.traverse_id ?? null,
      );
      if (data.points) {
        const stmt = this.db.prepare(
          `INSERT INTO parcel_points (parcel_id, point_index, point_number, easting, northing)
           VALUES (?, ?, ?, ?, ?)`,
        );
        data.points.forEach((p, i) => {
          stmt.run(parcelId, i, p.point_number, p.easting, p.northing);
        });
      }
    });
    tx();
    this.audit('parcel.create', 'parcel', parcelId, { parcel_number: data.parcel_number, points: data.points?.length ?? 0 });
    return parcelId;
  }

  listParcels(projectId: string): unknown[] {
    return this.db.prepare(
      `SELECT id, parcel_number, lr_number, registry, area_sqm, perimeter_m, status, created_at, updated_at
       FROM parcels WHERE project_id = ? ORDER BY created_at DESC`,
    ).all(projectId);
  }

  getParcelPoints(parcelId: string): unknown[] {
    return this.db.prepare(
      `SELECT point_index, point_number, easting, northing, beacon_id
       FROM parcel_points WHERE parcel_id = ? ORDER BY point_index`,
    ).all(parcelId);
  }

  // ─── Beacon operations (M2) ───────────────────────────────────────────

  createBeacon(projectId: string, data: {
    beacon_number: string;
    beacon_type?: string;
    easting: number;
    northing: number;
    elevation?: number;
    placed_date?: string;
    placed_by?: string;
    description?: string;
  }): string {
    const beaconId = `bcn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO beacons (id, project_id, beacon_number, beacon_type, easting, northing, elevation,
                            easting_original, northing_original, placed_date, placed_by, description, condition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'good')`,
    ).run(
      beaconId, projectId, data.beacon_number,
      data.beacon_type ?? 'concrete',
      data.easting, data.northing, data.elevation ?? null,
      data.easting, data.northing,  // original = current at creation
      data.placed_date ?? null, data.placed_by ?? null, data.description ?? null,
    );
    this.audit('beacon.create', 'beacon', beaconId, { beacon_number: data.beacon_number });
    return beaconId;
  }

  listBeacons(projectId: string): unknown[] {
    return this.db.prepare(
      `SELECT id, beacon_number, beacon_type, easting, northing, elevation, condition, placed_date, placed_by, description
       FROM beacons WHERE project_id = ? ORDER BY beacon_number`,
    ).all(projectId);
  }

  updateBeacon(beaconId: string, updates: Record<string, unknown>): number {
    const cols = Object.keys(updates).filter((k) => ['beacon_type', 'easting', 'northing', 'elevation', 'condition', 'description', 'placed_date', 'placed_by'].includes(k));
    if (cols.length === 0) return 0;
    const setClause = cols.map((c) => `${c} = ?`).join(', ');
    const params = cols.map((c) => updates[c]);
    params.push(beaconId);
    const result = this.db.prepare(
      `UPDATE beacons SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
    ).run(...params);
    this.audit('beacon.update', 'beacon', beaconId, updates);
    return result.changes;
  }

  deleteBeacon(beaconId: string): number {
    const result = this.db.prepare('DELETE FROM beacons WHERE id = ?').run(beaconId);
    this.audit('beacon.delete', 'beacon', beaconId, {});
    return result.changes;
  }

  // ─── Deed plan operations (M2) ────────────────────────────────────────

  saveDeedPlan(projectId: string, data: {
    parcel_id?: string;
    traverse_id?: string;
    plan_number?: string;
    lr_number?: string;
    paper_size?: string;
    scale?: number;
    surveyor_name?: string;
    surveyor_license?: string;
    county?: string;
    sub_county?: string;
    survey_date?: string;
    area_text?: string;
    pdf_path: string;
    pdf_hash: string;
  }): string {
    const deedPlanId = `dp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO deed_plans
        (id, project_id, parcel_id, traverse_id, plan_number, lr_number,
         paper_size, scale, surveyor_name, surveyor_license, county, sub_county,
         survey_date, area_text, pdf_path, pdf_hash, sealed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      deedPlanId, projectId,
      data.parcel_id ?? null, data.traverse_id ?? null,
      data.plan_number ?? null, data.lr_number ?? null,
      data.paper_size ?? 'A1', data.scale ?? 1000,
      data.surveyor_name ?? null, data.surveyor_license ?? null,
      data.county ?? null, data.sub_county ?? null,
      data.survey_date ?? null, data.area_text ?? null,
      data.pdf_path, data.pdf_hash,
    );
    this.audit('deed_plan.create', 'deed_plan', deedPlanId, { pdf_path: data.pdf_path });
    return deedPlanId;
  }

  sealDeedPlan(deedPlanId: string, sealPayload: {
    surveyor_name: string;
    surveyor_license: string;
    firm_name?: string;
    certificate_text: string;
    document_hash: string;
    public_key?: string;
    signature?: string;
  }): string {
    const certId = `cert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE deed_plans SET sealed = 1, sealed_at = datetime('now'), seal_payload = ?
         WHERE id = ?`,
      ).run(JSON.stringify(sealPayload), deedPlanId);
      // Get project_id from deed_plan
      const dp = this.db.prepare('SELECT project_id FROM deed_plans WHERE id = ?').get(deedPlanId) as { project_id: string };
      this.db.prepare(
        `INSERT INTO surveyor_certificates
          (id, project_id, deed_plan_id, surveyor_name, surveyor_license, firm_name,
           certificate_text, document_hash, seal_method, public_key, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        certId, dp.project_id, deedPlanId,
        sealPayload.surveyor_name, sealPayload.surveyor_license,
        sealPayload.firm_name ?? null,
        sealPayload.certificate_text, sealPayload.document_hash,
        sealPayload.signature ? 'local-rsa' : 'pending',
        sealPayload.public_key ?? null, sealPayload.signature ?? null,
      );
    });
    tx();
    this.audit('deed_plan.seal', 'deed_plan', deedPlanId, { certificate_id: certId });
    return certId;
  }

  listDeedPlans(projectId: string): unknown[] {
    return this.db.prepare(
      `SELECT id, plan_number, lr_number, paper_size, scale, surveyor_name, surveyor_license,
              county, survey_date, area_text, pdf_path, sealed, sealed_at, created_at
       FROM deed_plans WHERE project_id = ? ORDER BY created_at DESC`,
    ).all(projectId);
  }

  query(sql: string, params: unknown[] = []): unknown[] {
    return this.db.prepare(sql).all(...params);
  }

  execute(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
    return this.db.prepare(sql).run(...params);
  }

  audit(action: string, entity: string, entityId: string | null, payload: unknown) {
    this.db.prepare(
      'INSERT INTO audit_log (action, entity, entity_id, payload) VALUES (?, ?, ?, ?)',
    ).run(action, entity, entityId, JSON.stringify(payload));
  }

  close() {
    log.info('Closing database');
    this.db.close();
  }
}

export type { DatabaseType };
