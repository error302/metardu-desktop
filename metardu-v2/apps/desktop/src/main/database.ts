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

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ───────────────────────────────────────────────────────

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  /** Explicit EPSG horizontal CRS. Absent means no project CRS was assigned. */
  crsSrid?: number;
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
  crsSrid?: number;
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
  crsSrid?: number | null;
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

/** Database metadata for a project-linked point-cloud source. Paths never cross IPC. */
export interface StoredPointCloudSource {
  id: string;
  projectId: string | null;
  fileName: string;
  storageKey: string;
  contentSha256: string;
  fileSizeBytes: string;
  sourceExtension: "las" | "laz";
  format: "LAS" | "LAZ";
  headerJson: string;
  importedAt: string;
  latestRecordInspectionJson?: string | null;
  latestRecordInspectionId?: string | null;
  latestRecordInspectionSha256?: string | null;
  latestRecordInspectionReaderVersion?: string | null;
  latestRecordInspectionAt?: string | null;
}

export interface CreatePointCloudSourceInput {
  projectId: string;
  fileName: string;
  storageKey: string;
  contentSha256: string;
  fileSizeBytes: string;
  sourceExtension: "las" | "laz";
  format: "LAS" | "LAZ";
  headerJson: string;
}

export interface CreatePointCloudInspectionInput {
  sourceId: string;
  sourceSha256: string;
  readerVersion: string;
  inspectionJson: string;
}

export interface StoredPointCloudInspection {
  id: string;
  sourceId: string;
  sourceSha256: string;
  readerVersion: string;
  inspectionJson: string;
  inspectedAt: string;
}

// ─── Schema ──────────────────────────────────────────────────────

const SCHEMA_VERSION = 4;

const POINT_CLOUD_SOURCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS point_cloud_sources (
    id             TEXT PRIMARY KEY,
    projectId      TEXT,
    fileName       TEXT NOT NULL,
    storageKey     TEXT NOT NULL,
    contentSha256  TEXT NOT NULL CHECK (length(contentSha256) = 64),
    fileSizeBytes  TEXT NOT NULL,
    sourceExtension TEXT NOT NULL CHECK (sourceExtension IN ('las', 'laz')),
    format         TEXT NOT NULL CHECK (format IN ('LAS', 'LAZ')),
    headerJson     TEXT NOT NULL,
    importedAt     TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE (projectId, storageKey)
  );
  CREATE INDEX IF NOT EXISTS idx_point_cloud_sources_project
    ON point_cloud_sources(projectId, importedAt DESC);
`;

const POINT_CLOUD_INSPECTION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS point_cloud_inspections (
    id             TEXT PRIMARY KEY,
    sourceId       TEXT NOT NULL,
    sourceSha256   TEXT NOT NULL CHECK (length(sourceSha256) = 64),
    readerVersion  TEXT NOT NULL,
    inspectionJson TEXT NOT NULL,
    inspectedAt    TEXT NOT NULL,
    FOREIGN KEY (sourceId) REFERENCES point_cloud_sources(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_point_cloud_inspections_source
    ON point_cloud_inspections(sourceId, inspectedAt DESC, id DESC);
`;

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
    crsSrid     INTEGER,
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

  ${POINT_CLOUD_SOURCE_SCHEMA_SQL}
  ${POINT_CLOUD_INSPECTION_SCHEMA_SQL}
`;

// ─── Database singleton ──────────────────────────────────────────

let db: BetterSqlite3.Database | null = null;
let configuredDatabasePath: string | null = null;

/** Set the durable per-user database location before the first database read. */
export function configureDatabasePath(databasePath: string): void {
  if (!databasePath.trim()) throw new Error("A non-empty local database path is required.");
  if (db && configuredDatabasePath !== databasePath) {
    throw new Error("The project database is already open at a different path.");
  }
  configuredDatabasePath = databasePath;
}

/**
 * Open (or return the existing) SQLite database.
 * The database lives at <userData>/metardu.db.
 */
export function getDatabase(): BetterSqlite3.Database {
  if (db) return db;
  if (!configuredDatabasePath) {
    throw new Error("The local project database path must be configured before opening it.");
  }
  if (configuredDatabasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(configuredDatabasePath), { recursive: true });
  }
  db = new Database(configuredDatabasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
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

export function migrateDatabase(database: BetterSqlite3.Database): void {
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

  if (current < 2) {
    database.transaction(() => {
      const projectColumns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      if (!projectColumns.some((column) => column.name === "crsSrid")) {
        database.exec("ALTER TABLE projects ADD COLUMN crsSrid INTEGER");
      }
      database.prepare("UPDATE schema_version SET version = ?").run(2);
    })();
  }

  if (current < 3) {
    database.transaction(() => {
      database.exec(POINT_CLOUD_SOURCE_SCHEMA_SQL);
      database.prepare("UPDATE schema_version SET version = ?").run(3);
    })();
  }

  if (current < 4) {
    database.transaction(() => {
      database.exec(POINT_CLOUD_INSPECTION_SCHEMA_SQL);
      database.prepare("UPDATE schema_version SET version = ?").run(4);
    })();
  }
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

export function createPointCloudSource(
  database: BetterSqlite3.Database,
  input: CreatePointCloudSourceInput,
): StoredPointCloudSource {
  const digest = input.contentSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Point-cloud source SHA-256 is invalid.");
  if (input.storageKey !== `${digest}.${input.sourceExtension}`) {
    throw new Error("Point-cloud source storage key does not match its hash and extension.");
  }
  if (!/^\d+$/.test(input.fileSizeBytes)) throw new Error("Point-cloud source size must be an unsigned byte count.");
  if (input.format !== "LAS" && input.format !== "LAZ") throw new Error("Point-cloud source format is unsupported.");
  JSON.parse(input.headerJson);

  const existing = database
    .prepare("SELECT * FROM point_cloud_sources WHERE projectId = ? AND storageKey = ?")
    .get(input.projectId, input.storageKey) as StoredPointCloudSource | undefined;
  if (existing) {
    if (existing.contentSha256 !== digest || existing.fileSizeBytes !== input.fileSizeBytes) {
      throw new Error("Existing project source metadata conflicts with the verified content object.");
    }
    return existing;
  }

  const source: StoredPointCloudSource = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    fileName: input.fileName,
    storageKey: input.storageKey,
    contentSha256: digest,
    fileSizeBytes: input.fileSizeBytes,
    sourceExtension: input.sourceExtension,
    format: input.format,
    headerJson: input.headerJson,
    importedAt: new Date().toISOString(),
  };
  database
    .prepare(
      `INSERT INTO point_cloud_sources
        (id, projectId, fileName, storageKey, contentSha256, fileSizeBytes, sourceExtension, format, headerJson, importedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      source.projectId,
      source.fileName,
      source.storageKey,
      source.contentSha256,
      source.fileSizeBytes,
      source.sourceExtension,
      source.format,
      source.headerJson,
      source.importedAt,
    );
  return source;
}

export function listProjectPointCloudSources(
  database: BetterSqlite3.Database,
  projectId: string,
): StoredPointCloudSource[] {
  return database
    .prepare(
      `SELECT source.*,
         (SELECT inspection.inspectionJson
          FROM point_cloud_inspections AS inspection
          WHERE inspection.sourceId = source.id
          ORDER BY inspection.inspectedAt DESC, inspection.id DESC
          LIMIT 1) AS latestRecordInspectionJson,
         (SELECT inspection.id
          FROM point_cloud_inspections AS inspection
          WHERE inspection.sourceId = source.id
          ORDER BY inspection.inspectedAt DESC, inspection.id DESC
          LIMIT 1) AS latestRecordInspectionId,
         (SELECT inspection.sourceSha256
          FROM point_cloud_inspections AS inspection
          WHERE inspection.sourceId = source.id
          ORDER BY inspection.inspectedAt DESC, inspection.id DESC
          LIMIT 1) AS latestRecordInspectionSha256,
         (SELECT inspection.readerVersion
          FROM point_cloud_inspections AS inspection
          WHERE inspection.sourceId = source.id
          ORDER BY inspection.inspectedAt DESC, inspection.id DESC
          LIMIT 1) AS latestRecordInspectionReaderVersion,
         (SELECT inspection.inspectedAt
          FROM point_cloud_inspections AS inspection
          WHERE inspection.sourceId = source.id
          ORDER BY inspection.inspectedAt DESC, inspection.id DESC
          LIMIT 1) AS latestRecordInspectionAt
       FROM point_cloud_sources AS source
       WHERE source.projectId = ?
       ORDER BY source.importedAt DESC, source.id ASC`,
    )
    .all(projectId) as StoredPointCloudSource[];
}

export function createPointCloudInspection(
  database: BetterSqlite3.Database,
  input: CreatePointCloudInspectionInput,
): StoredPointCloudInspection {
  const digest = input.sourceSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Point-cloud inspection SHA-256 is invalid.");
  if (!input.readerVersion.trim()) throw new Error("Point-cloud inspection reader version is required.");
  const inspection = JSON.parse(input.inspectionJson) as Record<string, unknown>;
  if (inspection.readerVersion !== input.readerVersion) {
    throw new Error("Point-cloud inspection reader version does not match its report.");
  }

  const source = database
    .prepare("SELECT contentSha256 FROM point_cloud_sources WHERE id = ?")
    .get(input.sourceId) as { contentSha256: string } | undefined;
  if (!source) throw new Error("Point-cloud inspection source does not exist.");
  if (source.contentSha256 !== digest) {
    throw new Error("Point-cloud inspection digest does not match its retained source.");
  }

  const stored: StoredPointCloudInspection = {
    id: crypto.randomUUID(),
    sourceId: input.sourceId,
    sourceSha256: digest,
    readerVersion: input.readerVersion,
    inspectionJson: input.inspectionJson,
    inspectedAt: new Date().toISOString(),
  };
  database
    .prepare(
      `INSERT INTO point_cloud_inspections
        (id, sourceId, sourceSha256, readerVersion, inspectionJson, inspectedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      stored.id,
      stored.sourceId,
      stored.sourceSha256,
      stored.readerVersion,
      stored.inspectionJson,
      stored.inspectedAt,
    );
  return stored;
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
    crsSrid: input.crsSrid,
    surveyType: input.surveyType,
    sourceView: input.sourceView,
    output: input.output ?? null,
    planSheet: input.planSheet,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };

  const insert = database.prepare(`
    INSERT INTO projects (id, name, description, countryCode, crsSrid, surveyType, sourceView, output, planSheet, createdAt, updatedAt, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    project.id,
    project.name,
    project.description ?? null,
    project.countryCode,
    project.crsSrid ?? null,
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
    ...(input.crsSrid !== undefined ? { crsSrid: input.crsSrid ?? undefined } : {}),
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
        name = ?, description = ?, countryCode = ?, crsSrid = ?, surveyType = ?, sourceView = ?,
        output = ?, planSheet = ?, updatedAt = ?, version = ?
      WHERE id = ?`,
    )
    .run(
      updated.name,
      updated.description ?? null,
      updated.countryCode,
      updated.crsSrid ?? null,
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
            `INSERT OR IGNORE INTO projects (id, name, description, countryCode, crsSrid, surveyType, sourceView, output, planSheet, createdAt, updatedAt, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            p.id,
            p.name,
            p.description ?? null,
            p.countryCode,
            p.crsSrid ?? null,
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
  crsSrid: number | null;
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
    crsSrid: row.crsSrid ?? undefined,
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
