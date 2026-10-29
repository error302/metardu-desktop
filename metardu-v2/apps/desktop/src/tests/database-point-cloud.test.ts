import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";
import {
  closeDatabase,
  configureDatabasePath,
  createPointCloudSource,
  createProjectInDb,
  deleteProjectFromDb,
  getDatabase,
  listProjectPointCloudSources,
  migrateDatabase,
} from "../main/database.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

afterEach(() => {
  closeDatabase();
  configureDatabasePath(":memory:");
});

describe("point-cloud project source records", () => {
  it("migrates v2 while preserving projects and creates a source table", () => {
    const database = new Database(":memory:") as BetterSqlite3.Database;
    try {
      database.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (2);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          countryCode TEXT NOT NULL DEFAULT '', crsSrid INTEGER,
          surveyType TEXT NOT NULL DEFAULT '', sourceView TEXT NOT NULL DEFAULT '',
          output TEXT, planSheet TEXT, createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO projects (id, name, countryCode, surveyType, sourceView, output, createdAt, updatedAt, version)
        VALUES ('existing-project', 'Existing project', '', 'topographic', 'TopographicView', '{}', '2026-01-01', '2026-01-01', 7);
      `);

      migrateDatabase(database);

      expect((database.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(3);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_cloud_sources'").get()).toBeTruthy();
      expect((database.prepare("SELECT name, version FROM projects WHERE id = ?").get("existing-project") as { name: string; version: number })).toEqual({ name: "Existing project", version: 7 });
    } finally {
      database.close();
    }
  });

  it("persists and deduplicates a source per project, retaining its record when the project is deleted", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Global point-cloud project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    const input = {
      projectId: project.id,
      fileName: "terrain.laz",
      storageKey: `${"a".repeat(64)}.laz`,
      contentSha256: "a".repeat(64),
      fileSizeBytes: "9223372036854775807",
      sourceExtension: "laz" as const,
      format: "LAZ" as const,
      headerJson: JSON.stringify({ version: "1.4", headerDeclaredPointCount: "4" }),
    };

    const first = createPointCloudSource(database, input);
    const duplicate = createPointCloudSource(database, { ...input, fileName: "renamed-copy.laz" });
    expect(duplicate.id).toBe(first.id);
    expect(listProjectPointCloudSources(database, project.id)).toEqual([first]);

    expect(deleteProjectFromDb(database, project.id).ok).toBe(true);
    expect(listProjectPointCloudSources(database, project.id)).toEqual([]);
    expect(database.prepare("SELECT projectId, storageKey FROM point_cloud_sources WHERE id = ?").get(first.id)).toEqual({
      projectId: null,
      storageKey: input.storageKey,
    });
  });

  it("rejects inconsistent content keys before writing a project source row", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Invalid source project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });

    expect(() => createPointCloudSource(database, {
      projectId: project.id,
      fileName: "source.las",
      storageKey: `${"b".repeat(64)}.las`,
      contentSha256: "a".repeat(64),
      fileSizeBytes: "512",
      sourceExtension: "las",
      format: "LAS",
      headerJson: "{}",
    })).toThrow(/storage key does not match/);
    expect(listProjectPointCloudSources(database, project.id)).toEqual([]);
  });
});
