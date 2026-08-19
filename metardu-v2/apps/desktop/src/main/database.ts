/**
 * MetaRDU Desktop — local-first SQLite database layer.
 *
 * Replaces the JSON-file project store with a proper SQLite database
 * stored at <userData>/metardu.db. Features:
 *
 *   - Schema versioning with forward-only migrations
 *   - Projects table (replaces projects.json)
 *   - Operation log for undo/redo (every mutation is an atomic transaction)
 *   - Settings key-value store
 *   - Auto-save support via dirty flag + debounced flush
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Renderer (React UI)                                │
 *   │     ↕  contextBridge (preload.ts)                   │
 *   │  Main process                                       │
 *   │     ↕  BetterSQLite3 (synchronous, in-process)      │
 *   │  metardu.db  (<userData>)                           │
 *   └─────────────────────────────────────────────────────┘
 *
 * The database is opened once at app start and closed at before-quit.
 * All mutations are synchronous (better-sqlite3 is sync) and wrapped
 * in WAL mode for concurrent reads during writes.
 */

// @ts-ignore — better-sqlite3 is CommonJS, imported via createRequire in ESM context.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

import type BetterSqlite3 from "better-sqlite3";
import * as path from "node:path";
import { app } from "electron";

// ─── Types ───────────────────────────────────────────────────────

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output: unknown;
  planSheet?: PlanSheetSettings;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PlanSheetSettings {
  sheetSize?: string;
  orientation?: "landscape" | "portrait";
  scaleFit?: boolean;
  scaleDenominator?: number;
}

export interface ProjectStoreState {
  projects: StoredProject[];
  activeProjectId: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output?: unknown;
  planSheet?: PlanSheetSettings;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  description?: string;
  countryCode?: string;
  surveyType?: string;
  sourceView?: string;
  output?: unknown;
  planSheet?: PlanSheetSettings;
}

export type OperationKind = "create" | "update" | "delete" | "setActive";

export interface OperationLogEntry {
  id: number;
  kind: OperationKind;
  projectId: string;
  oldState: StoredProject | null;
  newState: StoredProject | null;
  timestamp: string;
}

// ─── Schema ──────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  -- Projects — the core persisted data
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    countryCode TEXT NOT NULL DEFAULT '',
    surveyType  TEXT NOT NULL DEFAULT '',
    sourceView  TEXT NOT NULL DEFAULT '',
    output      TEXT,          -- JSON-serialized survey workflow output
    planSheet   TEXT,          -- JSON-serialized PlanSheetSettings
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 0
  );

  -- Active project pointer (single-row table)
  CREATE TABLE IF NOT EXISTS active_project (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    projectId TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
  );

  -- Operation log for undo/redo
  CREATE TABLE IF NOT EXISTS operation_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,       -- 'create' | 'update' | 'delete' | 'setActive'
    projectId  TEXT NOT NULL,
    oldState   TEXT,                -- JSON-serialized StoredProject | null
    newState   TEXT,                -- JSON-serialized StoredProject | null
    timestamp  TEXT NOT NULL
  );

  -- Settings key-value store
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// ─── Database singleton ──────────────────────────────────────────

let db: BetterSqlite3.Database | null = null;

/**
 * Open (or return the existing) SQLite database.
 * The database lives at <userData>/metardu.db.
 */
export function getDatabase(): BetterSqlite3.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "metardu.db");
  db = new Database(dbPath);

  // WAL mode: concurrent reads during writes, better crash resilience.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run migrations.
  migrate(db);

  return db;
}

/**
 * Close the database. Call during before-quit.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ─── Migrations ──────────────────────────────────────────────────

function migrate(database: BetterSqlite3.Database): void {
  // Check if schema_version table exists.
  const hasVersion = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get() as { name: string } | undefined;

  if (!hasVersion) {
    // Fresh database — create everything.
    database.exec(SCHEMA_SQL);
    database.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    return;
  }

  const current = (database.prepare("SELECT version FROM schema_version").get() as { version: number }).version;

  if (current >= SCHEMA_VERSION) return;

  // Forward-only migrations. Each migration is idempotent.
  if (current < 1) {
    // v0 → v1: initial schema (shouldn't happen if created fresh, but handle migration from JSON import).
    database.exec(SCHEMA_SQL);
    database.prepare("UPDATE schema_version SET version = ?").run(1);
  }

  // Future migrations go here:
  // if (current < 2) { ... database.prepare("UPDATE schema_version SET version = ?").run(2); }
}

// ─── Project CRUD ────────────────────────────────────────────────

export function listProjects(database: BetterSqlite3.Database): StoredProject[] {
  const rows = database.prepare("SELECT * FROM projects ORDER BY createdAt ASC").all() as Row[];
  return rows.map(rowToProject);
}

export function getActiveProjectId(database: BetterSqlite3.Database): string | null {
  const row = database.prepare("SELECT projectId FROM active_project WHERE id = 1").get() as
    | { projectId: string | null }
    | undefined;
  return row?.projectId ?? null;
}

export function getProject(database: BetterSqlite3.Database, id: string): StoredProject | null {
  const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToProject(row) : null;
}

export function createProjectInDb(
  database: BetterSqlite3.Database,
  input: CreateProjectInput,
): StoredProject {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const project: StoredProject = {
    id,
    name: input.name,
    description: input.description,
    countryCode: input.countryCode,
    surveyType: input.surveyType,
    sourceView: input.sourceView,
    output: input.output ?? null,
    planSheet: input.planSheet,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };

  const insert = database.prepare(`
    INSERT INTO projects (id, name, description, countryCode, surveyType, sourceView, output, planSheet, createdAt, updatedAt, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    project.id,
    project.name,
    project.description ?? null,
    project.countryCode,
    project.surveyType,
    project.sourceView,
    JSON.stringify(project.output),
    project.planSheet ? JSON.stringify(project.planSheet) : null,
    project.createdAt,
    project.updatedAt,
    project.version,
  );

  // New project becomes active.
  setActiveProjectId(database, project.id);

  return project;
}

export function updateProjectInDb(
  database: BetterSqlite3.Database,
  input: UpdateProjectInput,
): StoredProject | null {
  const existing = getProject(database, input.id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated: StoredProject = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
    ...(input.surveyType !== undefined ? { surveyType: input.surveyType } : {}),
    ...(input.sourceView !== undefined ? { sourceView: input.sourceView } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    ...(input.planSheet !== undefined ? { planSheet: input.planSheet } : {}),
    updatedAt: now,
    version: existing.version + 1,
  };

  database
    .prepare(
      `UPDATE projects SET
        name = ?, description = ?, countryCode = ?, surveyType = ?, sourceView = ?,
        output = ?, planSheet = ?, updatedAt = ?, version = ?
      WHERE id = ?`,
    )
    .run(
      updated.name,
      updated.description ?? null,
      updated.countryCode,
      updated.surveyType,
      updated.sourceView,
      JSON.stringify(updated.output),
      updated.planSheet ? JSON.stringify(updated.planSheet) : null,
      updated.updatedAt,
      updated.version,
      updated.id,
    );

  return updated;
}

export function deleteProjectFromDb(
  database: BetterSqlite3.Database,
  id: string,
): { ok: boolean; newActiveId: string | null } {
  const deleted = getProject(database, id);
  if (!deleted) return { ok: false, newActiveId: null };

  // Read active ID BEFORE delete — the ON DELETE SET NULL foreign key
  // will null out active_project.projectId during the DELETE.
  const activeId = getActiveProjectId(database);
  database.prepare("DELETE FROM projects WHERE id = ?").run(id);

  // If this was the active project, switch to the most recent.
  let newActiveId = activeId;
  if (activeId === id) {
    const remaining = listProjects(database);
    newActiveId = remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
    setActiveProjectId(database, newActiveId);
  }

  return { ok: true, newActiveId };
}

export function setActiveProjectId(
  database: BetterSqlite3.Database,
  projectId: string | null,
): void {
  const existing = database.prepare("SELECT id FROM active_project WHERE id = 1").get();
  if (existing) {
    database.prepare("UPDATE active_project SET projectId = ? WHERE id = 1").run(projectId);
  } else {
    database.prepare("INSERT INTO active_project (id, projectId) VALUES (1, ?)").run(projectId);
  }
}

// ─── Operation log (undo/redo) ──────────────────────────────────

export function logOperation(
  database: BetterSqlite3.Database,
  kind: OperationKind,
  projectId: string,
  oldState: StoredProject | null,
  newState: StoredProject | null,
): number {
  const result = database
    .prepare(
      "INSERT INTO operation_log (kind, projectId, oldState, newState, timestamp) VALUES (?, ?, ?, ?, ?)",
    )
    .run(kind, projectId, JSON.stringify(oldState), JSON.stringify(newState), new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function getOperationLog(
  database: BetterSqlite3.Database,
  limit: number = 100,
): OperationLogEntry[] {
  const rows = database
    .prepare("SELECT * FROM operation_log ORDER BY id DESC LIMIT ?")
    .all(limit) as OpLogRow[];
  return rows.map(rowToOpEntry);
}

export function getLatestOperationId(database: BetterSqlite3.Database): number {
  const row = database.prepare("SELECT MAX(id) as maxId FROM operation_log").get() as
    | { maxId: number | null }
    | undefined;
  return row?.maxId ?? 0;
}

export function clearOperationLog(database: BetterSqlite3.Database): void {
  database.prepare("DELETE FROM operation_log").run();
}

export function truncateOperationLog(database: BetterSqlite3.Database, keepLast: number = 200): void {
  database
    .prepare("DELETE FROM operation_log WHERE id NOT IN (SELECT id FROM operation_log ORDER BY id DESC LIMIT ?)")
    .run(keepLast);
}

// ─── Settings ────────────────────────────────────────────────────

export function getSetting(database: BetterSqlite3.Database, key: string): string | null {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(database: BetterSqlite3.Database, key: string, value: string): void {
  database
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

// ─── JSON import (migration from projects.json) ──────────────────

/**
 * Import projects from the legacy JSON file format into SQLite.
 * Called once on first launch after the migration. The JSON file is
 * renamed to projects.json.bak so it's not re-imported.
 */
export function importFromJson(
  database: BetterSqlite3.Database,
  jsonPath: string,
): number {
  const fs = require("node:fs") as typeof import("node:fs");
  if (!fs.existsSync(jsonPath)) return 0;

  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
      projects?: StoredProject[];
      activeProjectId?: string;
    };

    if (!Array.isArray(raw.projects) || raw.projects.length === 0) return 0;

    const insertMany = database.transaction((projects: StoredProject[]) => {
      for (const p of projects) {
        database
          .prepare(
            `INSERT OR IGNORE INTO projects (id, name, description, countryCode, surveyType, sourceView, output, planSheet, createdAt, updatedAt, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            p.id,
            p.name,
            p.description ?? null,
            p.countryCode,
            p.surveyType,
            p.sourceView,
            JSON.stringify(p.output),
            p.planSheet ? JSON.stringify(p.planSheet) : null,
            p.createdAt,
            p.updatedAt,
            p.version,
          );
      }
    });

    insertMany(raw.projects);

    if (raw.activeProjectId) {
      setActiveProjectId(database, raw.activeProjectId);
    }

    // Rename JSON file to .bak so we don't re-import.
    fs.renameSync(jsonPath, jsonPath + ".bak");

    return raw.projects.length;
  } catch (err) {
    console.error("[db] failed to import from JSON:", (err as Error).message);
    return 0;
  }
}

// ─── Internal helpers ────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
  description: string | null;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output: string | null;
  planSheet: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface OpLogRow {
  id: number;
  kind: string;
  projectId: string;
  oldState: string | null;
  newState: string | null;
  timestamp: string;
}

function rowToProject(row: Row): StoredProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    countryCode: row.countryCode,
    surveyType: row.surveyType,
    sourceView: row.sourceView,
    output: row.output ? JSON.parse(row.output) : null,
    planSheet: row.planSheet ? JSON.parse(row.planSheet) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function rowToOpEntry(row: OpLogRow): OperationLogEntry {
  return {
    id: row.id,
    kind: row.kind as OperationKind,
    projectId: row.projectId,
    oldState: row.oldState ? JSON.parse(row.oldState) : null,
    newState: row.newState ? JSON.parse(row.newState) : null,
    timestamp: row.timestamp,
  };
}
