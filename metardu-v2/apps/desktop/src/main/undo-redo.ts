/**
 * MetaRDU Desktop — undo/redo manager.
 *
 * Backed by the SQLite operation_log table. Every project mutation
 * (create, update, delete, setActive) is logged with the full old and
 * new project state. Undo replays the inverse operation; redo replays
 * the forward operation.
 *
 * Architecture:
 *   - The manager maintains a `pointer` (the ID of the last applied
 *     operation). Operations with ID > pointer are "redo-able";
 *     operations with ID <= pointer are "undo-able".
 *   - Undo: find the operation at `pointer`, apply its inverse.
 *   - Redo: find the next operation after `pointer`, apply it.
 *   - Any new mutation clears the redo branch (truncates operations
 *     after pointer, then logs the new operation).
 *
 * The manager is a singleton — the main process creates one instance
 * and exposes it via IPC.
 */

import type BetterSqlite3 from "better-sqlite3";
import {
  getDatabase,
  getLatestOperationId,
  logOperation,
  getOperationLog,
  createProjectInDb,
  updateProjectInDb,
  deleteProjectFromDb,
  setActiveProjectId,
  type StoredProject,
  type OperationKind,
} from "./database.js";

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  /** Description of the next undo operation, or null. */
  undoDescription: string | null;
  /** Description of the next redo operation, or null. */
  redoDescription: string | null;
}

export interface UndoRedoResult {
  success: boolean;
  /** The project that was affected (for the renderer to update its state). */
  project?: StoredProject | null;
  /** The ID of the project that was affected. */
  projectId?: string;
  /** New active project ID after the operation. */
  activeProjectId?: string | null;
  /** Current undo/redo state. */
  state: UndoRedoState;
  /** Human-readable description of what was undone/redone. */
  description: string;
}

export class UndoRedoManager {
  private db: BetterSqlite3.Database;
  /** The ID of the last applied operation (our position in the log). */
  private pointer: number = 0;

  constructor() {
    this.db = getDatabase();
    this.pointer = getLatestOperationId(this.db);
  }

  /**
   * Get the current undo/redo state.
   */
  getState(): UndoRedoState {
    const ops = getOperationLog(this.db, 200);
    const maxId = ops.length > 0 ? ops[0]!.id : 0;

    const canUndo = this.pointer > 0;
    const canRedo = this.pointer < maxId;

    let undoDescription: string | null = null;
    let redoDescription: string | null = null;

    if (canUndo) {
      const op = ops.find((o) => o.id === this.pointer);
      if (op) undoDescription = describeOperation(op.kind, op.projectId, op.oldState, op.newState);
    }

    if (canRedo) {
      const nextOp = ops.find((o) => o.id === this.pointer + 1);
      if (nextOp)
        redoDescription = describeOperation(nextOp.kind, nextOp.projectId, nextOp.oldState, nextOp.newState);
    }

    return { canUndo, canRedo, undoDescription, redoDescription };
  }

  /**
   * Undo the last operation. Returns the affected project state.
   */
  undo(): UndoRedoResult {
    if (this.pointer <= 0) {
      return { success: false, state: this.getState(), description: "Nothing to undo" };
    }

    // Find the operation to undo.
    const ops = getOperationLog(this.db, 200);
    const op = ops.find((o) => o.id === this.pointer);
    if (!op) {
      return { success: false, state: this.getState(), description: "Operation not found" };
    }

    const description = describeOperation(op.kind, op.projectId, op.oldState, op.newState);

    // Apply the inverse operation.
    switch (op.kind) {
      case "create": {
        // Inverse of create = delete.
        const result = deleteProjectFromDb(this.db, op.projectId);
        this.pointer--;
        return {
          success: true,
          projectId: op.projectId,
          activeProjectId: result.newActiveId,
          state: this.getState(),
          description: `Undid: ${description}`,
        };
      }
      case "delete": {
        // Inverse of delete = re-create with the old state.
        if (op.oldState) {
          const recreated = createProjectInDb(this.db, {
            name: op.oldState.name,
            description: op.oldState.description,
            countryCode: op.oldState.countryCode,
            surveyType: op.oldState.surveyType,
            sourceView: op.oldState.sourceView,
            output: op.oldState.output,
            planSheet: op.oldState.planSheet,
          });
          // Override the ID and timestamps to match the original.
          this.db
            .prepare("UPDATE projects SET id = ?, createdAt = ?, updatedAt = ?, version = ? WHERE id = ?")
            .run(op.oldState.id, op.oldState.createdAt, op.oldState.updatedAt, op.oldState.version, recreated.id);
          // Also restore the ID in the recreated project.
          recreated.id = op.oldState.id;
          this.pointer--;
          return {
            success: true,
            project: op.oldState,
            projectId: op.oldState.id,
            state: this.getState(),
            description: `Undid: ${description}`,
          };
        }
        this.pointer--;
        return {
          success: true,
          projectId: op.projectId,
          state: this.getState(),
          description: `Undid: ${description} (partial — old state missing)`,
        };
      }
      case "update": {
        // Inverse of update = restore old state.
        if (op.oldState) {
          const restored = updateProjectInDb(this.db, {
            id: op.oldState.id,
            name: op.oldState.name,
            description: op.oldState.description,
            countryCode: op.oldState.countryCode,
            surveyType: op.oldState.surveyType,
            sourceView: op.oldState.sourceView,
            output: op.oldState.output,
            planSheet: op.oldState.planSheet,
          });
          this.pointer--;
          return {
            success: true,
            project: restored,
            projectId: op.projectId,
            state: this.getState(),
            description: `Undid: ${description}`,
          };
        }
        this.pointer--;
        return {
          success: true,
          projectId: op.projectId,
          state: this.getState(),
          description: `Undid: ${description} (partial — old state missing)`,
        };
      }
      case "setActive": {
        // Inverse of setActive = restore old active project.
        if (op.oldState) {
          // The oldState for setActive is the previously active project ID.
          const oldActiveId = (op.oldState as unknown as { activeProjectId?: string })
            .activeProjectId;
          setActiveProjectId(this.db, oldActiveId ?? null);
          this.pointer--;
          return {
            success: true,
            activeProjectId: oldActiveId ?? null,
            state: this.getState(),
            description: `Undid: ${description}`,
          };
        }
        this.pointer--;
        return {
          success: true,
          state: this.getState(),
          description: `Undid: ${description} (partial)`,
        };
      }
    }
  }

  /**
   * Redo the next operation. Returns the affected project state.
   */
  redo(): UndoRedoResult {
    const ops = getOperationLog(this.db, 200);
    const maxId = ops.length > 0 ? ops[0]!.id : 0;

    if (this.pointer >= maxId) {
      return { success: false, state: this.getState(), description: "Nothing to redo" };
    }

    const nextOp = ops.find((o) => o.id === this.pointer + 1);
    if (!nextOp) {
      return { success: false, state: this.getState(), description: "Operation not found" };
    }

    const description = describeOperation(nextOp.kind, nextOp.projectId, nextOp.oldState, nextOp.newState);

    // Apply the forward operation.
    switch (nextOp.kind) {
      case "create": {
        if (nextOp.newState) {
          const recreated = createProjectInDb(this.db, {
            name: nextOp.newState.name,
            description: nextOp.newState.description,
            countryCode: nextOp.newState.countryCode,
            surveyType: nextOp.newState.surveyType,
            sourceView: nextOp.newState.sourceView,
            output: nextOp.newState.output,
            planSheet: nextOp.newState.planSheet,
          });
          this.db
            .prepare("UPDATE projects SET id = ?, createdAt = ?, updatedAt = ?, version = ? WHERE id = ?")
            .run(
              nextOp.newState.id,
              nextOp.newState.createdAt,
              nextOp.newState.updatedAt,
              nextOp.newState.version,
              recreated.id,
            );
          this.pointer++;
          return {
            success: true,
            project: nextOp.newState,
            projectId: nextOp.newState.id,
            state: this.getState(),
            description: `Redid: ${description}`,
          };
        }
        this.pointer++;
        return {
          success: true,
          projectId: nextOp.projectId,
          state: this.getState(),
          description: `Redid: ${description} (partial)`,
        };
      }
      case "delete": {
        deleteProjectFromDb(this.db, nextOp.projectId);
        this.pointer++;
        return {
          success: true,
          projectId: nextOp.projectId,
          state: this.getState(),
          description: `Redid: ${description}`,
        };
      }
      case "update": {
        if (nextOp.newState) {
          const updated = updateProjectInDb(this.db, {
            id: nextOp.newState.id,
            name: nextOp.newState.name,
            description: nextOp.newState.description,
            countryCode: nextOp.newState.countryCode,
            surveyType: nextOp.newState.surveyType,
            sourceView: nextOp.newState.sourceView,
            output: nextOp.newState.output,
            planSheet: nextOp.newState.planSheet,
          });
          this.pointer++;
          return {
            success: true,
            project: updated,
            projectId: nextOp.projectId,
            state: this.getState(),
            description: `Redid: ${description}`,
          };
        }
        this.pointer++;
        return {
          success: true,
          projectId: nextOp.projectId,
          state: this.getState(),
          description: `Redid: ${description} (partial)`,
        };
      }
      case "setActive": {
        if (nextOp.newState) {
          const newActiveId = (nextOp.newState as unknown as { activeProjectId?: string })
            .activeProjectId;
          setActiveProjectId(this.db, newActiveId ?? null);
          this.pointer++;
          return {
            success: true,
            activeProjectId: newActiveId ?? null,
            state: this.getState(),
            description: `Redid: ${description}`,
          };
        }
        this.pointer++;
        return {
          success: true,
          state: this.getState(),
          description: `Redid: ${description} (partial)`,
        };
      }
    }
  }

  /**
   * Called when a new mutation happens. Clears the redo branch
   * (truncates operations after pointer) and logs the new operation.
   */
  recordOperation(
    kind: OperationKind,
    projectId: string,
    oldState: StoredProject | null,
    newState: StoredProject | null,
  ): void {
    // Clear redo branch: delete operations after pointer.
    if (this.pointer > 0) {
      this.db
        .prepare("DELETE FROM operation_log WHERE id > ?")
        .run(this.pointer);
    }

    // Log the new operation.
    const id = logOperation(this.db, kind, projectId, oldState, newState);
    this.pointer = id;
  }

  /**
   * Reset the undo/redo pointer (e.g., after importing from JSON).
   */
  resetPointer(): void {
    this.pointer = getLatestOperationId(this.db);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function describeOperation(
  kind: OperationKind,
  projectId: string,
  oldState: StoredProject | null,
  newState: StoredProject | null,
): string {
  switch (kind) {
    case "create":
      return `Create project "${newState?.name ?? projectId}"`;
    case "delete":
      return `Delete project "${oldState?.name ?? projectId}"`;
    case "update":
      return `Update project "${newState?.name ?? oldState?.name ?? projectId}"`;
    case "setActive":
      return `Switch active project`;
    default:
      return `${kind} on ${projectId}`;
  }
}
