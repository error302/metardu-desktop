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

import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import * as path from "node:path";
import {
  PROJECT_BUNDLE_CANCEL_INPUT_SCHEMA,
  PROJECT_BUNDLE_CANCEL_RESULT_SCHEMA,
  PROJECT_BUNDLE_EXPORT_INPUT_SCHEMA,
  PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA,
  PROJECT_BUNDLE_IMPORT_INPUT_SCHEMA,
  PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA,
  PROJECT_BUNDLE_PROGRESS_SCHEMA,
  type ProjectBundleProgress,
} from "@metardu/ipc-schemas";
import {
  getDatabase,
  configureDatabasePath,
  closeDatabase,
  listProjects,
  getActiveProjectId,
  getProject,
  createProjectInDb,
  updateProjectInDb,
  deleteProjectFromDb,
  setActiveProjectId,
  importFromJson,
  getProjectBundleSnapshot,
  restoreProjectBundleSnapshot,
  type ProjectStoreState,
  type CreateProjectInput,
  type UpdateProjectInput,
  type StoredProject,
} from "./database.js";
import { pointCloudObjectPath, publishPointCloudObject } from "./point-cloud-store.js";
import {
  exportProjectBundleDirectory,
  removeProjectBundleStaging,
  stageProjectBundleDirectory,
} from "./project-bundle.js";
import type { PointCloudHeaderDetails } from "../shared/point-cloud.js";
import { UndoRedoManager } from "./undo-redo.js";

let undoRedo: UndoRedoManager | null = null;
const projectBundleOperations = new Map<string, AbortController>();

function parseBundleInput<T>(schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } } }, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error(parsed.error?.issues.map((issue) => issue.message).join("; ") || "Project bundle request is invalid.");
  }
  return parsed.data;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("cancelled"));
}

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

export function registerProjectIpcHandlers(
  getWindow: () => BrowserWindow | null,
  onActiveProjectChanged?: () => void | Promise<void>,
  inspectPointCloudHeader?: (sourcePath: string) => Promise<PointCloudHeaderDetails>,
): void {
  configureDatabasePath(path.join(app.getPath("userData"), "metardu.db"));
  console.log("[projects] Initializing database...");
  try {
    getDatabase();
    console.log("[projects] Database ready, migrating JSON if needed...");
    migrateJsonIfNeeded();
    console.log("[projects] Migration check complete");
  } catch (err) {
    console.warn("[projects] Project DB init warning:", (err as Error).message);
  }

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
    const previousActiveProjectId = getActiveProjectId(db);

    // Snapshot the active project before creation (for undo).
    // Create the project (also sets it active).
    const created = createProjectInDb(db, input);
    if (getActiveProjectId(db) !== previousActiveProjectId) void onActiveProjectChanged?.();

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
    const previousActiveProjectId = getActiveProjectId(db);

    // Snapshot before deletion.
    const oldState = getProject(db, id);

    const result = deleteProjectFromDb(db, id);
    if (getActiveProjectId(db) !== previousActiveProjectId) void onActiveProjectChanged?.();

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
    void onActiveProjectChanged?.();

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
    const db = getDatabase();
    const previousActiveProjectId = getActiveProjectId(db);
    const result = ur.undo();
    if (getActiveProjectId(db) !== previousActiveProjectId) void onActiveProjectChanged?.();
    broadcastChanged(getWindow);
    return result;
  });

  ipcMain.handle("metardu:projects:redo", () => {
    const ur = getUndoRedo();
    const db = getDatabase();
    const previousActiveProjectId = getActiveProjectId(db);
    const result = ur.redo();
    if (getActiveProjectId(db) !== previousActiveProjectId) void onActiveProjectChanged?.();
    broadcastChanged(getWindow);
    return result;
  });

  ipcMain.handle("metardu:projects:undoRedoState", () => {
    return getUndoRedo().getState();
  });

  // ── Portable project backup and recovery ──────────────────────

  const sendBundleProgress = (progress: ProjectBundleProgress): void => {
    const validated = PROJECT_BUNDLE_PROGRESS_SCHEMA.parse(progress);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("metardu:projects:bundleProgress", validated);
  };

  ipcMain.handle("metardu:projects:bundleExport", async (_event, untrustedInput: unknown) => {
    const input = parseBundleInput(PROJECT_BUNDLE_EXPORT_INPUT_SCHEMA, untrustedInput);
    if (projectBundleOperations.has(input.operationId)) throw new Error("A project bundle operation with this identifier is already running.");
    if (!inspectPointCloudHeader) throw new Error("Point-cloud header inspection is unavailable; start the local survey sidecar and try again.");
    const controller = new AbortController();
    projectBundleOperations.set(input.operationId, controller);
    try {
      const project = getProject(getDatabase(), input.projectId);
      if (!project) throw new Error("The selected project no longer exists.");
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error("The Desktop window is not available.");
      const selected = await dialog.showOpenDialog(window, {
        title: `Choose a folder for the ${project.name} project bundle`,
        properties: ["openDirectory", "createDirectory"],
      });
      if (selected.canceled || !selected.filePaths[0] || controller.signal.aborted) {
        return PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA.parse({ canceled: true });
      }

      const result = await exportProjectBundleDirectory({
        operationId: input.operationId,
        signal: controller.signal,
        onProgress: sendBundleProgress,
        destinationParent: selected.filePaths[0],
        snapshot: getProjectBundleSnapshot(getDatabase(), input.projectId),
        getCurrentSnapshot: () => getProjectBundleSnapshot(getDatabase(), input.projectId),
        resolveSourcePath: (storageKey) => pointCloudObjectPath(app.getPath("userData"), storageKey),
        inspectHeader: inspectPointCloudHeader,
      });
      // The final directory is already published; stop accepting cancellation now.
      projectBundleOperations.delete(input.operationId);
      return PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA.parse({ canceled: false, ...result });
    } catch (error) {
      if (isAbortError(error)) return PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA.parse({ canceled: true });
      throw error;
    } finally {
      projectBundleOperations.delete(input.operationId);
    }
  });

  ipcMain.handle("metardu:projects:bundleImport", async (_event, untrustedInput: unknown) => {
    const input = parseBundleInput(PROJECT_BUNDLE_IMPORT_INPUT_SCHEMA, untrustedInput);
    if (projectBundleOperations.has(input.operationId)) throw new Error("A project bundle operation with this identifier is already running.");
    if (!inspectPointCloudHeader) throw new Error("Point-cloud header inspection is unavailable; start the local survey sidecar and try again.");
    const controller = new AbortController();
    projectBundleOperations.set(input.operationId, controller);
    let stagedBundle: Awaited<ReturnType<typeof stageProjectBundleDirectory>> | null = null;
    try {
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error("The Desktop window is not available.");
      const selected = await dialog.showOpenDialog(window, {
        title: "Select a METARDU Desktop project bundle folder",
        properties: ["openDirectory"],
      });
      if (selected.canceled || !selected.filePaths[0] || controller.signal.aborted) {
        return PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA.parse({ canceled: true });
      }

      stagedBundle = await stageProjectBundleDirectory({
        operationId: input.operationId,
        signal: controller.signal,
        onProgress: sendBundleProgress,
        bundlePath: selected.filePaths[0],
        userDataPath: app.getPath("userData"),
        inspectHeader: inspectPointCloudHeader,
      });

      const totalSourceBytes = BigInt(stagedBundle.totalBytes);
      const totalWorkBytes = (totalSourceBytes * 2n).toString();
      const sourceCount = stagedBundle.stagedSources.length;
      let publishedSourceBytes = 0n;
      const sourcesByKey = new Map(stagedBundle.stagedSources.map((source) => [
        `${source.contentSha256}.${source.sourceExtension}`,
        source,
      ]));
      for (let index = 0; index < stagedBundle.snapshot.pointCloudSources.length; index += 1) {
        if (controller.signal.aborted) throw Object.assign(new Error("Project bundle operation was cancelled."), { name: "AbortError" });
        const source = stagedBundle.snapshot.pointCloudSources[index]!;
        const staged = sourcesByKey.get(source.storageKey);
        if (!staged) throw new Error("A verified point-cloud source is missing from the bundle staging set.");
        const published = await publishPointCloudObject(staged, app.getPath("userData"));
        if (published.storageKey !== source.storageKey) throw new Error("Published source key differs from the verified bundle manifest.");
        publishedSourceBytes += BigInt(source.fileSizeBytes);
        sendBundleProgress({
          operationId: input.operationId,
          operation: "import",
          phase: "publishing",
          completedBytes: (totalSourceBytes + publishedSourceBytes).toString(),
          totalBytes: totalWorkBytes,
          completedFiles: index + 1,
          totalFiles: sourceCount,
        });
      }
      if (controller.signal.aborted) throw Object.assign(new Error("Project bundle operation was cancelled."), { name: "AbortError" });

      // All bytes are verified and published. Once SQLite restore begins, cancellation is no longer accepted.
      projectBundleOperations.delete(input.operationId);
      const database = getDatabase();
      const previousActiveProjectId = getActiveProjectId(database);
      const restoredProject = restoreProjectBundleSnapshot(database, stagedBundle.snapshot);
      // The generic project undo log cannot safely delete and recreate linked source rows.
      // Record the active-project switch so undo never targets an older unrelated action.
      getUndoRedo().recordOperation(
        "setActive",
        restoredProject.id,
        { activeProjectId: previousActiveProjectId } as unknown as StoredProject,
        { activeProjectId: restoredProject.id } as unknown as StoredProject,
      );
      await onActiveProjectChanged?.();
      broadcastChanged(getWindow);
      sendBundleProgress({
        operationId: input.operationId,
        operation: "import",
        phase: "complete",
        completedBytes: totalWorkBytes,
        totalBytes: totalWorkBytes,
        completedFiles: sourceCount,
        totalFiles: sourceCount,
      });
      return PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA.parse({
        canceled: false,
        project: { id: restoredProject.id, name: restoredProject.name },
        sourceCount,
        totalBytes: stagedBundle.totalBytes,
      });
    } catch (error) {
      if (isAbortError(error)) return PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA.parse({ canceled: true });
      throw error;
    } finally {
      if (stagedBundle) {
        await removeProjectBundleStaging(stagedBundle.stagingDirectory, app.getPath("userData")).catch(() => undefined);
      }
      projectBundleOperations.delete(input.operationId);
    }
  });

  ipcMain.handle("metardu:projects:bundleCancel", (_event, untrustedInput: unknown) => {
    const input = parseBundleInput(PROJECT_BUNDLE_CANCEL_INPUT_SCHEMA, untrustedInput);
    const controller = projectBundleOperations.get(input.operationId);
    if (controller) controller.abort();
    return PROJECT_BUNDLE_CANCEL_RESULT_SCHEMA.parse({ accepted: Boolean(controller) });
  });

  // ── Lifecycle ───────────────────────────────────────────────

  // Close the database on app quit.
  app.on("before-quit", () => {
    closeDatabase();
  });
}
