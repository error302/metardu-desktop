import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  configureDatabasePath,
  createProjectInDb,
  deleteProjectFromDb,
  getDatabase,
  getProject,
  updateProjectInDb,
} from "../main/database.js";
import { UndoRedoManager } from "../main/undo-redo.js";

const contextA = {
  schemaVersion: 1 as const,
  horizontalUnit: "metre" as const,
  coordinateEpoch: 2020.25,
  verticalReference: { kind: "orthometric" as const, name: "Datum A", unit: "metre" as const },
  evidenceStatus: "user_declared_unverified" as const,
};

const contextB = {
  schemaVersion: 1 as const,
  horizontalUnit: "us_survey_foot" as const,
  coordinateEpoch: null,
  verticalReference: null,
  evidenceStatus: "user_declared_unverified" as const,
};

beforeEach(() => {
  closeDatabase();
  configureDatabasePath(":memory:");
});

afterEach(() => {
  closeDatabase();
  configureDatabasePath(":memory:");
});

describe("project coordinate context undo and redo", () => {
  it("keeps declarations and project identity when a created project is undone and redone", () => {
    const db = getDatabase();
    const undoRedo = new UndoRedoManager();
    const created = createProjectInDb(db, {
      name: "Created coordinate context project",
      countryCode: "",
      coordinateContext: contextA,
      surveyType: "topographic",
      sourceView: "TopographicView",
    });
    undoRedo.recordOperation("create", created.id, null, created);

    expect(undoRedo.undo().success).toBe(true);
    expect(getProject(db, created.id)).toBeNull();

    expect(undoRedo.redo().success).toBe(true);
    expect(getProject(db, created.id)?.coordinateContext).toEqual(contextA);
  });

  it("restores and reapplies coordinate declarations when an update is undone or redone", () => {
    const db = getDatabase();
    const original = createProjectInDb(db, {
      name: "Coordinate context project",
      countryCode: "",
      coordinateContext: contextA,
      surveyType: "topographic",
      sourceView: "TopographicView",
    });
    const undoRedo = new UndoRedoManager();

    const updated = updateProjectInDb(db, { id: original.id, coordinateContext: contextB });
    expect(updated?.coordinateContext).toEqual(contextB);
    undoRedo.recordOperation("update", original.id, original, updated);

    expect(undoRedo.undo().success).toBe(true);
    expect(getProject(db, original.id)?.coordinateContext).toEqual(contextA);

    expect(undoRedo.redo().success).toBe(true);
    expect(getProject(db, original.id)?.coordinateContext).toEqual(contextB);
  });

  it("restores coordinate declarations when a deleted project is undone", () => {
    const db = getDatabase();
    const deleted = createProjectInDb(db, {
      name: "Deleted coordinate context project",
      countryCode: "",
      coordinateContext: contextA,
      surveyType: "topographic",
      sourceView: "TopographicView",
    });
    const undoRedo = new UndoRedoManager();

    expect(deleteProjectFromDb(db, deleted.id).ok).toBe(true);
    undoRedo.recordOperation("delete", deleted.id, deleted, null);

    expect(undoRedo.undo().success).toBe(true);
    expect(getProject(db, deleted.id)?.coordinateContext).toEqual(contextA);
  });
});
