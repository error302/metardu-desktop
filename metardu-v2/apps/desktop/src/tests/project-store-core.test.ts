/**
 * ProjectStore core — pure CRUD unit tests.
 *
 * The core (project-store-core.ts) is deliberately free of Electron and
 * fs imports so it can be tested in isolation. The disk/IPC wiring in
 * main/projects.ts is exercised end-to-end via the desktop app; here we
 * pin the invariants that matter for the sync pipeline:
 *
 *   1. Create → project becomes active, version 0, ISO timestamps.
 *   2. Update → version bumps (so SyncPanel re-pushes are genuine PUTs),
 *      unknown id is a no-op.
 *   3. Delete → active project moves to the most recent remaining.
 *   4. setActive → only existing ids; activeProjectOf/findProject lookup.
 */

import { describe, it, expect } from "vitest";
import {
  emptyProjectStore,
  createProject,
  updateProject,
  deleteProject,
  setActiveProject,
  activeProjectOf,
  findProject,
  type ProjectStoreState,
  type CreateProjectInput,
} from "../main/project-store-core.js";

function makeInput(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    name: "Kasarani Cadastral",
    countryCode: "KE",
    surveyType: "cadastral",
    sourceView: "TopographicView",
    output: { points: 42 },
    ...overrides,
  };
}

describe("project-store-core", () => {
  it("empty store has no projects and no active project", () => {
    const s = emptyProjectStore();
    expect(s.projects).toEqual([]);
    expect(s.activeProjectId).toBeNull();
    expect(activeProjectOf(s)).toBeNull();
  });

  it("create appends a project, makes it active, stamps ISO timestamps, version 0", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    expect(s1.projects).toHaveLength(1);
    const p = s1.projects[0]!;
    expect(s1.activeProjectId).toBe(p.id);
    expect(p.version).toBe(0);
    expect(p.name).toBe("Kasarani Cadastral");
    expect(p.countryCode).toBe("KE");
    expect(p.surveyType).toBe("cadastral");
    expect(p.sourceView).toBe("TopographicView");
    expect(p.output).toEqual({ points: 42 });
    expect(new Date(p.createdAt).getTime()).not.toBeNaN();
    expect(new Date(p.updatedAt).getTime()).not.toBeNaN();
    expect(activeProjectOf(s1)?.id).toBe(p.id);
  });

  it("create is immutable — the input state is untouched", () => {
    const s0 = emptyProjectStore();
    createProject(s0, makeInput());
    expect(s0.projects).toHaveLength(0);
  });

  it("update bumps version and applies partial fields, preserving the rest", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const id = s1.projects[0]!.id;
    const s2 = updateProject(s1, { id, name: "Rename", output: { points: 99 } });
    const p = s2.projects[0]!;
    expect(p.version).toBe(1);
    expect(p.name).toBe("Rename");
    expect(p.output).toEqual({ points: 99 });
    // Untouched fields preserved:
    expect(p.countryCode).toBe("KE");
    expect(p.surveyType).toBe("cadastral");
    expect(p.sourceView).toBe("TopographicView");
    expect(activeProjectOf(s2)?.id).toBe(id);
  });

  it("update with an unknown id is a no-op (same state reference)", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const s2 = updateProject(s1, { id: "does-not-exist", name: "X" });
    expect(s2).toBe(s1);
  });

  it("each update bumps version monotonically (PUT-eligible on sync)", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const id = s1.projects[0]!.id;
    const s2 = updateProject(s1, { id, output: { a: 1 } });
    const s3 = updateProject(s2, { id, output: { a: 2 } });
    expect(s3.projects[0]!.version).toBe(2);
  });

  it("delete removes the project and moves the active pointer to the most recent remaining", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput({ name: "P1" }));
    const id1 = s1.projects[0]!.id;
    const s2 = createProject(s1, makeInput({ name: "P2" }));
    const id2 = s2.projects.find((p) => p.name === "P2")!.id;
    // Active is now P2. Deleting it should fall back to P1.
    const s3 = deleteProject(s2, id2);
    expect(s3.projects.map((p) => p.name)).toEqual(["P1"]);
    expect(s3.activeProjectId).toBe(id1);
    // Deleting the last project clears active.
    const s4 = deleteProject(s3, id1);
    expect(s4.projects).toHaveLength(0);
    expect(s4.activeProjectId).toBeNull();
  });

  it("setActiveProject only accepts existing ids and switches the pointer", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const id = s1.projects[0]!.id;
    const s2 = setActiveProject(s1, "nope");
    expect(s2.activeProjectId).toBe(id); // unchanged — unknown id
    // Two projects — switch active between them.
    const s3 = createProject(s1, makeInput({ name: "P2" }));
    const id2 = s3.projects.find((p) => p.name === "P2")!.id;
    expect(s3.activeProjectId).toBe(id2); // create made P2 active
    const s4 = setActiveProject(s3, id);
    expect(s4.activeProjectId).toBe(id);
  });

  it("findProject returns the project or null", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const id = s1.projects[0]!.id;
    expect(findProject(s1, id)?.name).toBe("Kasarani Cadastral");
    expect(findProject(s1, "missing")).toBeNull();
  });

  it("activeProjectOf survives a state with no active id", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const stale: ProjectStoreState = { projects: s1.projects, activeProjectId: "gone" };
    expect(activeProjectOf(stale)).toBeNull();
  });

  it("create carries planSheet settings (per-project print choices)", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput({
      planSheet: { sheetSize: "a1", orientation: "portrait", scaleFit: false, scaleDenominator: 500 },
    }));
    expect(s1.projects[0]!.planSheet).toEqual({
      sheetSize: "a1", orientation: "portrait", scaleFit: false, scaleDenominator: 500,
    });
  });

  it("update sets planSheet and bumps version (PUT-eligible on sync)", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput());
    const id = s1.projects[0]!.id;
    const s2 = updateProject(s1, { id, planSheet: { sheetSize: "a3", orientation: "landscape" } });
    const p = s2.projects[0]!;
    expect(p.planSheet).toEqual({ sheetSize: "a3", orientation: "landscape" });
    expect(p.version).toBe(1);
    // Untouched fields preserved.
    expect(p.name).toBe("Kasarani Cadastral");
    expect(p.countryCode).toBe("KE");
  });

  it("update preserves an existing planSheet when not provided", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput({
      planSheet: { sheetSize: "a4", orientation: "portrait" },
    }));
    const id = s1.projects[0]!.id;
    const s2 = updateProject(s1, { id, name: "Rename only" });
    expect(s2.projects[0]!.planSheet).toEqual({ sheetSize: "a4", orientation: "portrait" });
  });

  it("update can replace planSheet wholesale (fixed-scale change)", () => {
    const s0 = emptyProjectStore();
    const s1 = createProject(s0, makeInput({
      planSheet: { sheetSize: "a4", orientation: "portrait", scaleFit: true },
    }));
    const id = s1.projects[0]!.id;
    const s2 = updateProject(s1, {
      id,
      planSheet: { sheetSize: "letter", orientation: "portrait", scaleFit: false, scaleDenominator: 1000 },
    });
    expect(s2.projects[0]!.planSheet).toEqual({
      sheetSize: "letter", orientation: "portrait", scaleFit: false, scaleDenominator: 1000,
    });
    expect(s2.projects[0]!.version).toBe(1);
  });
});
