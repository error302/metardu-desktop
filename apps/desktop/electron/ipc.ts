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

  log.info('IPC handlers registered');
}

function getSingleProjectId(db: MetarduDatabase): string {
  const projects = db.query('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1') as { id: string }[];
  if (projects.length === 0) {
    // Auto-create a default project if none exists
    return db.initProject('Default Project');
  }
  return projects[0].id;
}
