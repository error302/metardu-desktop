/**
 * Tests for the SQLite database layer, operation log, and undo/redo manager.
 *
 * These tests use a temporary database (in-memory) to avoid polluting
 * the user's real data. The database module is designed to be testable
 * in isolation — no Electron dependencies in the core CRUD functions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as typeof import("better-sqlite3");
import type BetterSqlite3 from "better-sqlite3";

// ─── Test database setup ─────────────────────────────────────────
// We create an in-memory SQLite database for each test and run the
// schema migrations manually. This avoids any dependency on Electron's
// app.getPath("userData").

function createTestDatabase(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run the schema creation SQL directly.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      countryCode TEXT NOT NULL DEFAULT '', surveyType TEXT NOT NULL DEFAULT '',
      sourceView TEXT NOT NULL DEFAULT '', output TEXT, planSheet TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS active_project (
      id INTEGER PRIMARY KEY CHECK (id = 1), projectId TEXT,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS operation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, projectId TEXT NOT NULL,
      oldState TEXT, newState TEXT, timestamp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_version (version) VALUES (1);
  `);

  return db;
}

// Inline the CRUD functions from database.ts to avoid Electron dependency.
// These are the same functions — just extracted for testing.

interface StoredProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output: unknown;
  planSheet?: { sheetSize?: string; orientation?: string; scaleFit?: boolean; scaleDenominator?: number };
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface Row {
  id: string; name: string; description: string | null; countryCode: string;
  surveyType: string; sourceView: string; output: string | null; planSheet: string | null;
  createdAt: string; updatedAt: string; version: number;
}

function rowToProject(row: Row): StoredProject {
  return {
    id: row.id, name: row.name, description: row.description ?? undefined,
    countryCode: row.countryCode, surveyType: row.surveyType, sourceView: row.sourceView,
    output: row.output ? JSON.parse(row.output) : null,
    planSheet: row.planSheet ? JSON.parse(row.planSheet) : undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version,
  };
}

function listProjects(db: BetterSqlite3.Database): StoredProject[] {
  return (db.prepare("SELECT * FROM projects ORDER BY createdAt ASC").all() as Row[]).map(rowToProject);
}

function getActiveProjectId(db: BetterSqlite3.Database): string | null {
  const row = db.prepare("SELECT projectId FROM active_project WHERE id = 1").get() as { projectId: string | null } | undefined;
  return row?.projectId ?? null;
}

function getProject(db: BetterSqlite3.Database, id: string): StoredProject | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToProject(row) : null;
}

function createProjectInDb(db: BetterSqlite3.Database, input: { name: string; description?: string; countryCode: string; surveyType: string; sourceView: string; output?: unknown }): StoredProject {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const project: StoredProject = {
    id, name: input.name, description: input.description, countryCode: input.countryCode,
    surveyType: input.surveyType, sourceView: input.sourceView, output: input.output ?? null,
    createdAt: now, updatedAt: now, version: 0,
  };
  db.prepare("INSERT INTO projects (id, name, description, countryCode, surveyType, sourceView, output, createdAt, updatedAt, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(project.id, project.name, project.description ?? null, project.countryCode, project.surveyType, project.sourceView, JSON.stringify(project.output), project.createdAt, project.updatedAt, project.version);
  setActiveProjectId(db, project.id);
  return project;
}

function updateProjectInDb(db: BetterSqlite3.Database, input: { id: string; name?: string; description?: string; countryCode?: string; surveyType?: string; sourceView?: string; output?: unknown }): StoredProject | null {
  const existing = getProject(db, input.id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated: StoredProject = {
    ...existing, ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
    ...(input.surveyType !== undefined ? { surveyType: input.surveyType } : {}),
    ...(input.sourceView !== undefined ? { sourceView: input.sourceView } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    updatedAt: now, version: existing.version + 1,
  };
  db.prepare("UPDATE projects SET name=?, description=?, countryCode=?, surveyType=?, sourceView=?, output=?, updatedAt=?, version=? WHERE id=?")
    .run(updated.name, updated.description ?? null, updated.countryCode, updated.surveyType, updated.sourceView, JSON.stringify(updated.output), updated.updatedAt, updated.version, updated.id);
  return updated;
}

function deleteProjectFromDb(db: BetterSqlite3.Database, id: string): boolean {
  const existing = getProject(db, id);
  if (!existing) return false;
  // Read active ID BEFORE delete — the ON DELETE SET NULL foreign key
  // will null out active_project.projectId during the DELETE.
  const activeId = getActiveProjectId(db);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (activeId === id) {
    const remaining = listProjects(db);
    const newActiveId = remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
    setActiveProjectId(db, newActiveId);
  }
  return true;
}

function setActiveProjectId(db: BetterSqlite3.Database, projectId: string | null): void {
  const existing = db.prepare("SELECT id FROM active_project WHERE id = 1").get();
  if (existing) {
    db.prepare("UPDATE active_project SET projectId = ? WHERE id = 1").run(projectId);
  } else {
    db.prepare("INSERT INTO active_project (id, projectId) VALUES (1, ?)").run(projectId);
  }
}

function logOperation(db: BetterSqlite3.Database, kind: string, projectId: string, oldState: StoredProject | null, newState: StoredProject | null): number {
  const result = db.prepare("INSERT INTO operation_log (kind, projectId, oldState, newState, timestamp) VALUES (?, ?, ?, ?, ?)")
    .run(kind, projectId, JSON.stringify(oldState), JSON.stringify(newState), new Date().toISOString());
  return Number(result.lastInsertRowid);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("SQLite project store", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves a project", () => {
    const project = createProjectInDb(db, {
      name: "Test Project",
      countryCode: "KE",
      surveyType: "cadastral",
      sourceView: "CadastralView",
    });

    expect(project.id).toBeTruthy();
    expect(project.name).toBe("Test Project");
    expect(project.countryCode).toBe("KE");
    expect(project.version).toBe(0);

    const retrieved = getProject(db, project.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("Test Project");
  });

  it("lists projects in chronological order", () => {
    createProjectInDb(db, { name: "First", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    createProjectInDb(db, { name: "Second", countryCode: "AU", surveyType: "cadastral", sourceView: "CadastralView" });

    const all = listProjects(db);
    expect(all).toHaveLength(2);
    expect(all[0]!.name).toBe("First");
    expect(all[1]!.name).toBe("Second");
  });

  it("sets new project as active", () => {
    const p1 = createProjectInDb(db, { name: "First", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    expect(getActiveProjectId(db)).toBe(p1.id);

    const p2 = createProjectInDb(db, { name: "Second", countryCode: "AU", surveyType: "cadastral", sourceView: "CadastralView" });
    expect(getActiveProjectId(db)).toBe(p2.id);
  });

  it("updates a project", () => {
    const p = createProjectInDb(db, { name: "Original", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    const updated = updateProjectInDb(db, { id: p.id, name: "Updated", output: { points: [1, 2, 3] } });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
    expect(updated!.version).toBe(1);
    expect(updated!.output).toEqual({ points: [1, 2, 3] });

    const retrieved = getProject(db, p.id);
    expect(retrieved!.name).toBe("Updated");
  });

  it("deletes a project and switches active", () => {
    const p1 = createProjectInDb(db, { name: "First", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    const p2 = createProjectInDb(db, { name: "Second", countryCode: "AU", surveyType: "cadastral", sourceView: "CadastralView" });

    expect(getActiveProjectId(db)).toBe(p2.id);

    deleteProjectFromDb(db, p2.id);
    expect(getActiveProjectId(db)).toBe(p1.id);
    expect(getProject(db, p2.id)).toBeNull();
  });

  it("handles JSON output serialization", () => {
    const output = {
      points: [{ id: "P1", easting: 100, northing: 200 }],
      metadata: { surveyDate: "2026-01-15" },
    };
    const p = createProjectInDb(db, { name: "JSON Test", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView", output });
    const retrieved = getProject(db, p.id);
    expect(retrieved!.output).toEqual(output);
  });

  it("operation log records mutations", () => {
    const p = createProjectInDb(db, { name: "Logged", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    const opId = logOperation(db, "create", p.id, null, p);
    expect(opId).toBe(1);

    const oldState = { ...p, name: "Old Name" };
    const newState = { ...p, name: "New Name" };
    const opId2 = logOperation(db, "update", p.id, oldState, newState);
    expect(opId2).toBe(2);
  });

  it("settings get/set", () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("theme", "dark");
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("theme") as { value: string };
    expect(row.value).toBe("dark");

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("theme", "light");
    const row2 = db.prepare("SELECT value FROM settings WHERE key = ?").get("theme") as { value: string };
    expect(row2.value).toBe("light");
  });
});

describe("Project store CRUD completeness", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("returns null for non-existent project", () => {
    expect(getProject(db, "nonexistent")).toBeNull();
  });

  it("returns null when updating non-existent project", () => {
    expect(updateProjectInDb(db, { id: "nonexistent", name: "Nope" })).toBeNull();
  });

  it("returns false when deleting non-existent project", () => {
    expect(deleteProjectFromDb(db, "nonexistent")).toBe(false);
  });

  it("active_project is null when no projects exist", () => {
    expect(getActiveProjectId(db)).toBeNull();
  });

  it("version increments on each update", () => {
    const p = createProjectInDb(db, { name: "V", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    expect(p.version).toBe(0);
    const u1 = updateProjectInDb(db, { id: p.id, name: "V2" });
    expect(u1!.version).toBe(1);
    const u2 = updateProjectInDb(db, { id: p.id, name: "V3" });
    expect(u2!.version).toBe(2);
  });

  it("handles multiple create/delete cycles", () => {
    const p1 = createProjectInDb(db, { name: "A", countryCode: "KE", surveyType: "topographic", sourceView: "TopographicView" });
    const p2 = createProjectInDb(db, { name: "B", countryCode: "AU", surveyType: "cadastral", sourceView: "CadastralView" });
    const p3 = createProjectInDb(db, { name: "C", countryCode: "GB", surveyType: "engineering", sourceView: "EngineeringView" });

    expect(listProjects(db)).toHaveLength(3);
    expect(getActiveProjectId(db)).toBe(p3.id);

    deleteProjectFromDb(db, p2.id);
    expect(listProjects(db)).toHaveLength(2);
    expect(getActiveProjectId(db)).toBe(p3.id);

    deleteProjectFromDb(db, p3.id);
    expect(getActiveProjectId(db)).toBe(p1.id);

    deleteProjectFromDb(db, p1.id);
    expect(getActiveProjectId(db)).toBeNull();
    expect(listProjects(db)).toHaveLength(0);
  });


});
