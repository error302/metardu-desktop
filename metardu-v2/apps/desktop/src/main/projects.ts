/**
 * MetaRDU Desktop — main-process project store (metardu:projects:*).
 *
 * Now backed by SQLite (metardu.db) instead of a JSON file. Features:
 *
 *   - All mutations are logged to the operation_log table for undo/redo
 *   - Auto-save: dirty flag + debounced flush (though SQLite writes are
 *     already synchronous and durable via WAL)
 *   - JSON import: one-time migration from projects.json on first launch
 *   - Broadcasts every mutation to the renderer so the toolbar + views
 *     stay live without polling
 *
 * IPC channels:
 *   metardu:projects:list          → ProjectStoreState
 *   metardu:projects:create        → StoredProject
 *   metardu:projects:update        → StoredProject | null
 *   metardu:projects:delete        → { ok }
 *   metardu:projects:setActive     → { ok }
 *   metardu:projects:getActive     → StoredProject | null
 *   metardu:projects:get           → StoredProject | null
 *   metardu:projects:undo          → UndoRedoResult
 *   metardu:projects:redo          → UndoRedoResult
 *   metardu:projects:canUndo       → boolean
 *   metardu:projects:canRedo       → boolean
 *   metardu:projects:changed       (broadcast → renderer)
 *   metardu:projects:undoRedoState (broadcast → renderer)
 */

import { app, ipcMain, type BrowserWindow } from "electron";
import * as path from "node:path";
import {
  getDatabase,
  closeDatabase,
  listProjects,
  getActiveProjectId,
  getProject,
  createProjectInDb,
  updateProjectInDb,
  deleteProjectFromDb,
  setActiveProjectId,
  importFromJson,
  type ProjectStoreState,
  type CreateProjectInput,
  type UpdateProjectInput,
  type StoredProject,
} from "./database.js";
import { UndoRedoManager } from "./undo-redo.js";

let undoRedo: UndoRedoManager | null = null;

function getUndoRedo(): UndoRedoManager {
  if (!undoRedo) undoRedo = new UndoRedoManager();
  return undoRedo;
}

// ─── Auto-save dirty flag ────────────────────────────────────────
// SQLite writes via better-sqlite3 are synchronous and already durable
// (WAL mode), so there's no async flush needed. The "auto-save" here
// means: every mutation immediately persists to SQLite and broadcasts
// to the renderer. No separate timer required.

// ─── Broadcast helper ────────────────────────────────────────────

function broadcastChanged(getWindow: () => BrowserWindow | null): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    const db = getDatabase();
    const state: ProjectStoreState = {
      projects: listProjects(db),
      activeProjectId: getActiveProjectId(db),
    };
    win.webContents.send("metardu:projects:changed", state);
    // Also broadcast undo/redo state.
    const urState = getUndoRedo().getState();
    win.webContents.send("metardu:projects:undoRedoState", urState);
  }
}

// ─── One-time JSON migration ─────────────────────────────────────

function migrateJsonIfNeeded(): void {
  const db = getDatabase();
  const jsonPath = path.join(app.getPath("userData"), "projects.json");
  const count = importFromJson(db, jsonPath);
  if (count > 0) {
    console.log(`[projects] imported ${count} projects from projects.json`);
    getUndoRedo().resetPointer();
  }
}

// ─── IPC handler registration ────────────────────────────────────

export function registerProjectIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // Initialize database and run JSON migration.
  getDatabase();
  migrateJsonIfNeeded();

  // ── Read operations ──────────────────────────────────────────

  ipcMain.handle("metardu:projects:list", () => {
    const db = getDatabase();
    return {
      projects: listProjects(db),
      activeProjectId: getActiveProjectId(db),
    } satisfies ProjectStoreState;
  });

  ipcMain.handle("metardu:projects:getActive", () => {
    const db = getDatabase();
    const id = getActiveProjectId(db);
    return id ? getProject(db, id) : null;
  });

  ipcMain.handle("metardu:projects:get", (_event, id: string) => {
    const db = getDatabase();
    return getProject(db, id);
  });

  ipcMain.handle("metardu:projects:canUndo", () => {
    return getUndoRedo().getState().canUndo;
  });

  ipcMain.handle("metardu:projects:canRedo", () => {
    return getUndoRedo().getState().canRedo;
  });

  // ── Write operations ─────────────────────────────────────────

  ipcMain.handle("metardu:projects:create", (_event, input: CreateProjectInput) => {
    const db = getDatabase();
    const ur = getUndoRedo();

    // Snapshot the active project before creation (for undo).
    // Create the project (also sets it active).
    const created = createProjectInDb(db, input);

    // Log the operation with a synthetic "old state" for setActive.
    ur.recordOperation("create", created.id, null, created);

    broadcastChanged(getWindow);
    return created;
  });

  ipcMain.handle("metardu:projects:update", (_event, input: UpdateProjectInput) => {
    const db = getDatabase();
    const ur = getUndoRedo();

    // Snapshot before update.
    const oldState = getProject(db, input.id);
    if (!oldState) return null;

    const updated = updateProjectInDb(db, input);
    if (!updated) return null;

    ur.recordOperation("update", input.id, oldState, updated);

    broadcastChanged(getWindow);
    return updated;
  });

  ipcMain.handle("metardu:projects:delete", (_event, id: string) => {
    const db = getDatabase();
    const ur = getUndoRedo();

    // Snapshot before deletion.
    const oldState = getProject(db, id);

    const result = deleteProjectFromDb(db, id);

    if (result.ok && oldState) {
      ur.recordOperation("delete", id, oldState, null);
    }

    broadcastChanged(getWindow);
    return { ok: result.ok };
  });

  ipcMain.handle("metardu:projects:setActive", (_event, id: string) => {
    const db = getDatabase();
    const ur = getUndoRedo();

    const prevActiveId = getActiveProjectId(db);
    if (prevActiveId === id) return { ok: true };

    setActiveProjectId(db, id);

    // For setActive, we store a minimal "state" with just the activeProjectId
    // so undo can restore the previous active project.
    const setActiveState = { activeProjectId: id } as unknown as StoredProject;
    const setActiveOldState = { activeProjectId: prevActiveId } as unknown as StoredProject;

    ur.recordOperation("setActive", id, setActiveOldState, setActiveState);

    broadcastChanged(getWindow);
    return { ok: true };
  });

  // ── Undo / Redo ─────────────────────────────────────────────

  ipcMain.handle("metardu:projects:undo", () => {
    const ur = getUndoRedo();
    const result = ur.undo();
    broadcastChanged(getWindow);
    return result;
  });

  ipcMain.handle("metardu:projects:redo", () => {
    const ur = getUndoRedo();
    const result = ur.redo();
    broadcastChanged(getWindow);
    return result;
  });

  ipcMain.handle("metardu:projects:undoRedoState", () => {
    return getUndoRedo().getState();
  });

  // ── Lifecycle ───────────────────────────────────────────────

  // Close the database on app quit.
  app.on("before-quit", () => {
    closeDatabase();
  });
}
