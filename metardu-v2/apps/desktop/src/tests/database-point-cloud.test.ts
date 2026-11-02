import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";
import {
  closeDatabase,
  configureDatabasePath,
  createPointCloudInspection,
  createPointCloudSource,
  createProjectInDb,
  deleteProjectFromDb,
  getDatabase,
  listProjectPointCloudSources,
  migrateDatabase,
  setPointCloudSourceCoordinateContext,
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

      expect((database.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(6);
      expect((database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).some((column) => column.name === "coordinateContext")).toBe(true);
      expect((database.prepare("PRAGMA table_info(point_cloud_sources)").all() as Array<{ name: string }>).some((column) => column.name === "coordinateContext")).toBe(true);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_cloud_sources'").get()).toBeTruthy();
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_cloud_inspections'").get()).toBeTruthy();
      expect((database.prepare("SELECT name, version FROM projects WHERE id = ?").get("existing-project") as { name: string; version: number })).toEqual({ name: "Existing project", version: 7 });
    } finally {
      database.close();
    }
  });

  it("adds source context to an existing v5 point-cloud table without changing its source row", () => {
    const database = new Database(":memory:") as BetterSqlite3.Database;
    const digest = "9".repeat(64);
    const storageKey = `${digest}.las`;
    try {
      database.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (5);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          countryCode TEXT NOT NULL DEFAULT '', crsSrid INTEGER, coordinateContext TEXT,
          surveyType TEXT NOT NULL DEFAULT '', sourceView TEXT NOT NULL DEFAULT '',
          output TEXT, planSheet TEXT, createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE point_cloud_sources (
          id TEXT PRIMARY KEY, projectId TEXT, fileName TEXT NOT NULL,
          storageKey TEXT NOT NULL, contentSha256 TEXT NOT NULL,
          fileSizeBytes TEXT NOT NULL, sourceExtension TEXT NOT NULL,
          format TEXT NOT NULL, headerJson TEXT NOT NULL, importedAt TEXT NOT NULL,
          FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL,
          UNIQUE (projectId, storageKey)
        );
        INSERT INTO projects (id, name, countryCode, surveyType, sourceView, createdAt, updatedAt)
        VALUES ('v5-project', 'Existing v5 project', '', 'topographic', 'PointCloudView', '2026-01-01', '2026-01-01');
      `);
      database.prepare(`
        INSERT INTO point_cloud_sources
          (id, projectId, fileName, storageKey, contentSha256, fileSizeBytes, sourceExtension, format, headerJson, importedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("v5-source", "v5-project", "existing.las", storageKey, digest, "2048", "las", "LAS", "{\"version\":\"1.4\"}", "2026-01-01");

      migrateDatabase(database);

      expect((database.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(6);
      expect((database.prepare("PRAGMA table_info(point_cloud_sources)").all() as Array<{ name: string }>).some((column) => column.name === "coordinateContext")).toBe(true);
      expect(database.prepare("SELECT id, projectId, fileName, storageKey, contentSha256, fileSizeBytes, coordinateContext FROM point_cloud_sources WHERE id = ?").get("v5-source")).toEqual({
        id: "v5-source",
        projectId: "v5-project",
        fileName: "existing.las",
        storageKey,
        contentSha256: digest,
        fileSizeBytes: "2048",
        coordinateContext: null,
      });
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

    const report = { readerVersion: "las-rs 0.11.2", decodedPointCount: "2" };
    const inspection = createPointCloudInspection(database, {
      sourceId: first.id,
      sourceSha256: first.contentSha256,
      readerVersion: "las-rs 0.11.2",
      inspectionJson: JSON.stringify(report),
    });
    expect(JSON.parse(inspection.inspectionJson)).toEqual(report);
    expect(listProjectPointCloudSources(database, project.id)[0]?.latestRecordInspectionJson).toBe(JSON.stringify(report));
    expect(listProjectPointCloudSources(database, project.id)).toHaveLength(1);
    expect(listProjectPointCloudSources(database, project.id)[0]).toMatchObject(first);

    expect(deleteProjectFromDb(database, project.id).ok).toBe(true);
    expect(listProjectPointCloudSources(database, project.id)).toEqual([]);
    expect(database.prepare("SELECT projectId, storageKey FROM point_cloud_sources WHERE id = ?").get(first.id)).toEqual({
      projectId: null,
      storageKey: input.storageKey,
    });
    expect(database.prepare("SELECT sourceId, sourceSha256 FROM point_cloud_inspections WHERE id = ?").get(inspection.id)).toEqual({
      sourceId: first.id,
      sourceSha256: first.contentSha256,
    });
  });

  it("rejects an inspection digest that does not match the retained source", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Inspection digest project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    const digest = "c".repeat(64);
    const source = createPointCloudSource(database, {
      projectId: project.id,
      fileName: "source.las",
      storageKey: `${digest}.las`,
      contentSha256: digest,
      fileSizeBytes: "512",
      sourceExtension: "las",
      format: "LAS",
      headerJson: "{}",
    });

    expect(() => createPointCloudInspection(database, {
      sourceId: source.id,
      sourceSha256: "d".repeat(64),
      readerVersion: "las-rs 0.11.2",
      inspectionJson: JSON.stringify({ readerVersion: "las-rs 0.11.2" }),
    })).toThrow(/does not match its retained source/);
    expect(database.prepare("SELECT COUNT(*) AS count FROM point_cloud_inspections").get()).toEqual({ count: 0 });
  });

  it("persists and clears source context only through the linked project while preserving the source digest", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Source context project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    const otherProject = createProjectInDb(database, {
      name: "Unrelated project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    const digest = "e".repeat(64);
    const source = createPointCloudSource(database, {
      projectId: project.id,
      fileName: "control.laz",
      storageKey: `${digest}.laz`,
      contentSha256: digest,
      fileSizeBytes: "8192",
      sourceExtension: "laz",
      format: "LAZ",
      headerJson: JSON.stringify({ version: "1.4" }),
    });
    expect(source.coordinateContextJson).toBeNull();

    const context = {
      schemaVersion: 1 as const,
      horizontalCrsLabel: "EPSG:unknown; local control grid",
      horizontalUnit: "us_survey_foot" as const,
      coordinateEpoch: 2022.5,
      verticalReference: { kind: "orthometric" as const, name: "Local benchmark adjustment 2022", unit: "metre" as const },
      evidenceStatus: "user_declared_unverified" as const,
    };
    expect(() => setPointCloudSourceCoordinateContext(database, otherProject.id, source.id, context))
      .toThrow(/not attached to the active project/);
    const updated = setPointCloudSourceCoordinateContext(database, project.id, source.id, context);
    expect(JSON.parse(updated.coordinateContextJson ?? "null")).toEqual(context);
    expect(updated.contentSha256).toBe(digest);
    expect(listProjectPointCloudSources(database, project.id)[0]?.coordinateContextJson).toBe(JSON.stringify(context));

    const cleared = setPointCloudSourceCoordinateContext(database, project.id, source.id, null);
    expect(cleared.coordinateContextJson).toBeNull();
    expect(cleared.contentSha256).toBe(digest);
  });

  it("keeps malformed stored source context raw for deliberate replacement", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Malformed source context project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    const digest = "f".repeat(64);
    const source = createPointCloudSource(database, {
      projectId: project.id,
      fileName: "legacy.las",
      storageKey: `${digest}.las`,
      contentSha256: digest,
      fileSizeBytes: "512",
      sourceExtension: "las",
      format: "LAS",
      headerJson: "{}",
    });
    const malformed = "{\"schemaVersion\":99,\"horizontalUnit\":\"metre\"}";
    database.prepare("UPDATE point_cloud_sources SET coordinateContext = ? WHERE id = ?").run(malformed, source.id);

    expect(listProjectPointCloudSources(database, project.id)[0]?.coordinateContextJson).toBe(malformed);
    const replacement = {
      schemaVersion: 1 as const,
      horizontalCrsLabel: null,
      horizontalUnit: "unknown" as const,
      coordinateEpoch: null,
      verticalReference: null,
      evidenceStatus: "user_declared_unverified" as const,
    };
    const updated = setPointCloudSourceCoordinateContext(database, project.id, source.id, replacement);
    expect(JSON.parse(updated.coordinateContextJson ?? "null")).toEqual(replacement);
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
