import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import {
  closeDatabase,
  configureDatabasePath,
  createProjectInDb,
  getDatabase,
  getProject,
  importFromJson,
  listProjects,
  migrateDatabase,
  updateProjectInDb,
} from "../main/database.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

afterEach(() => {
  closeDatabase();
  configureDatabasePath(":memory:");
});

describe("durable project CRS metadata", () => {
  it("migrates a v1 project table to the current schema without changing legacy project rows", () => {
    const db = new Database(":memory:") as BetterSqlite3.Database;
    try {
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (1);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          countryCode TEXT NOT NULL DEFAULT '', surveyType TEXT NOT NULL DEFAULT '',
          sourceView TEXT NOT NULL DEFAULT '', output TEXT, planSheet TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO projects (id, name, countryCode, surveyType, sourceView, output, createdAt, updatedAt, version)
        VALUES ('legacy-1', 'Legacy Project', '', 'topographic', 'TopographicView', '{}', '2026-01-01', '2026-01-01', 4);
      `);

      migrateDatabase(db);

      const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "crsSrid")).toBe(true);
      expect(columns.some((column) => column.name === "coordinateContext")).toBe(true);
      expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(6);
      const pointCloudColumns = db.prepare("PRAGMA table_info(point_cloud_sources)").all() as Array<{ name: string }>;
      expect(pointCloudColumns.some((column) => column.name === "coordinateContext")).toBe(true);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_cloud_sources'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_cloud_inspections'").get()).toBeTruthy();
      expect(getProject(db, "legacy-1")).toMatchObject({
        id: "legacy-1",
        name: "Legacy Project",
        countryCode: "",
        version: 4,
      });
      expect(getProject(db, "legacy-1")?.crsSrid).toBeUndefined();
      expect(getProject(db, "legacy-1")?.coordinateContext).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("persists an explicit CRS across database close and reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "metardu-project-crs-"));
    const databasePath = join(root, "metardu.db");
    try {
      configureDatabasePath(databasePath);
      const created = createProjectInDb(getDatabase(), {
        name: "Global field project",
        countryCode: "",
        crsSrid: 32756,
        coordinateContext: {
          schemaVersion: 1,
          horizontalUnit: "metre",
          coordinateEpoch: 2020.25,
          verticalReference: { kind: "orthometric", name: "Local benchmark datum", unit: "metre" },
          evidenceStatus: "user_declared_unverified",
        },
        surveyType: "topographic",
        sourceView: "TopographicView",
        output: { points: [{ easting: 334368.6, northing: 6250948.3 }] },
      });
      expect(getProject(getDatabase(), created.id)).toMatchObject({
        crsSrid: 32756,
        coordinateContext: {
          schemaVersion: 1,
          horizontalUnit: "metre",
          coordinateEpoch: 2020.25,
          verticalReference: { kind: "orthometric", name: "Local benchmark datum", unit: "metre" },
          evidenceStatus: "user_declared_unverified",
        },
      });

      closeDatabase();
      configureDatabasePath(databasePath);

      const reopenedProjects = listProjects(getDatabase());
      expect(reopenedProjects).toHaveLength(1);
      expect(reopenedProjects[0]).toMatchObject({
        id: created.id,
        crsSrid: 32756,
        countryCode: "",
        coordinateContext: {
          horizontalUnit: "metre",
          coordinateEpoch: 2020.25,
          verticalReference: { kind: "orthometric", name: "Local benchmark datum", unit: "metre" },
        },
        output: { points: [{ easting: 334368.6, northing: 6250948.3 }] },
      });

      const updated = updateProjectInDb(getDatabase(), { id: created.id, crsSrid: 32633 });
      expect(updated?.crsSrid).toBe(32633);
      expect(getProject(getDatabase(), created.id)?.crsSrid).toBe(32633);

      const contextUpdated = updateProjectInDb(getDatabase(), {
        id: created.id,
        coordinateContext: {
          schemaVersion: 1,
          horizontalUnit: "us_survey_foot",
          coordinateEpoch: null,
          verticalReference: null,
          evidenceStatus: "user_declared_unverified",
        },
      });
      expect(contextUpdated?.coordinateContext?.horizontalUnit).toBe("us_survey_foot");
      expect(getProject(getDatabase(), created.id)?.coordinateContext?.horizontalUnit).toBe("us_survey_foot");
      expect(updateProjectInDb(getDatabase(), { id: created.id, coordinateContext: null })?.coordinateContext).toBeUndefined();
    } finally {
      closeDatabase();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains malformed legacy coordinate declarations when unrelated project fields change", () => {
    const root = mkdtempSync(join(tmpdir(), "metardu-coordinate-context-import-"));
    const jsonPath = join(root, "projects.json");
    const rawContext = { schemaVersion: 1, horizontalUnit: "metre", coordinateEpoch: "unknown" };
    const projectId = "imported-invalid-coordinate-context";
    writeFileSync(jsonPath, JSON.stringify({
      projects: [{
        id: projectId,
        name: "Imported project",
        countryCode: "",
        coordinateContext: rawContext,
        surveyType: "topographic",
        sourceView: "TopographicView",
        output: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 0,
      }],
      activeProjectId: projectId,
    }));

    try {
      const db = getDatabase();
      expect(importFromJson(db, jsonPath)).toBe(1);
      expect(getProject(db, projectId)).toMatchObject({ coordinateContextStatus: "invalid" });
      const renamed = updateProjectInDb(db, { id: projectId, name: "Imported project, renamed" });

      expect(renamed).toMatchObject({
        name: "Imported project, renamed",
        coordinateContextStatus: "invalid",
      });
      expect(db.prepare("SELECT coordinateContext FROM projects WHERE id = ?").get(projectId)).toEqual({ coordinateContext: JSON.stringify(rawContext) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
