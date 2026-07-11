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
    if (!versionRow.v) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
      log.info('Schema migrated to version 1 (walking skeleton)');
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
