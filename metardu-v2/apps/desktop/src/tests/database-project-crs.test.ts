import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import {
  closeDatabase,
  configureDatabasePath,
  createProjectInDb,
  getDatabase,
  getProject,
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
  it("migrates a v1 project table without changing legacy project rows", () => {
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
      expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(2);
      expect(getProject(db, "legacy-1")).toMatchObject({
        id: "legacy-1",
        name: "Legacy Project",
        countryCode: "",
        version: 4,
      });
      expect(getProject(db, "legacy-1")?.crsSrid).toBeUndefined();
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
        surveyType: "topographic",
        sourceView: "TopographicView",
        output: { points: [{ easting: 334368.6, northing: 6250948.3 }] },
      });
      expect(getProject(getDatabase(), created.id)?.crsSrid).toBe(32756);

      closeDatabase();
      configureDatabasePath(databasePath);

      const reopenedProjects = listProjects(getDatabase());
      expect(reopenedProjects).toHaveLength(1);
      expect(reopenedProjects[0]).toMatchObject({
        id: created.id,
        crsSrid: 32756,
        countryCode: "",
        output: { points: [{ easting: 334368.6, northing: 6250948.3 }] },
      });

      const updated = updateProjectInDb(getDatabase(), { id: created.id, crsSrid: 32633 });
      expect(updated?.crsSrid).toBe(32633);
      expect(getProject(getDatabase(), created.id)?.crsSrid).toBe(32633);
    } finally {
      closeDatabase();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
