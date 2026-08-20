/**
 * useProjectStore — standalone hook for SQLite-persisted project CRUD
 * with undo/redo and auto-save.
 *
 * Replaces the scattered project state across SurveyStateContext,
 * ProjectsPanel, and individual views with a single hook that:
 *
 *   1. Wraps the main-process ProjectStore via IPC bridge
 *   2. Provides optimistic CRUD with auto-persistence
 *   3. Exposes undo/redo backed by the SQLite operation log
 *   4. Subscribes to live changes broadcast from main process
 *   5. Auto-creates a project when first output is saved
 *
 * Usage:
 *   const { projects, active, save, undo, redo, canUndo, canRedo } = useProjectStore();
 *
 * This hook is framework-agnostic in its core logic — the React
 * integration is thin (useState + useEffect for subscription).
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types (mirrors project-store-core.ts, kept local to avoid bundling) ──

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output: unknown;
  planSheet?: {
    sheetSize?: string;
    orientation?: "landscape" | "portrait";
    scaleFit?: boolean;
    scaleDenominator?: number;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProjectStoreState {
  projects: StoredProject[];
  activeProjectId: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output?: unknown;
  planSheet?: StoredProject["planSheet"];
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  description?: string;
  countryCode?: string;
  surveyType?: string;
  sourceView?: string;
  output?: unknown;
  planSheet?: StoredProject["planSheet"];
}

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

// ─── IPC bridge ──────────────────────────────────────────────────

interface ProjectsApi {
  list?: () => Promise<ProjectStoreState>;
  create?: (input: CreateProjectInput) => Promise<StoredProject | null>;
  update?: (input: UpdateProjectInput) => Promise<StoredProject | null>;
  setActive?: (id: string) => Promise<{ ok: boolean }>;
  delete?: (id: string) => Promise<{ ok: boolean }>;
  onChanged?: (cb: (state: ProjectStoreState) => void) => () => void;
  getUndoRedoState?: () => Promise<UndoRedoState>;
  onUndoRedoState?: (cb: (state: UndoRedoState) => void) => () => void;
  undo?: () => Promise<{ success: boolean; description: string }>;
  redo?: () => Promise<{ success: boolean; description: string }>;
}

function getProjectsApi(): ProjectsApi {
  const api = (window as unknown as { metardu?: { projects?: ProjectsApi } }).metardu?.projects;
  return api ?? {};
}

// ─── Hook ────────────────────────────────────────────────────────

export interface UseProjectStoreReturn {
  /** All persisted projects, newest-last. */
  projects: StoredProject[];
  /** The active project, or null. */
  active: StoredProject | null;
  /** ID of the active project. */
  activeId: string | null;
  /** Whether the IPC bridge is available (false in browser mode). */
  available: boolean;

  // ── CRUD ──

  /** Create a new project and make it active. */
  create: (input: Omit<CreateProjectInput, "sourceView" | "output">) => Promise<StoredProject | null>;
  /** Update a project's fields. */
  update: (id: string, input: Partial<Pick<UpdateProjectInput, "name" | "description" | "countryCode" | "surveyType" | "planSheet">>) => Promise<void>;
  /** Delete a project. Active moves to most recent remaining. */
  remove: (id: string) => Promise<void>;
  /** Switch which project is active. */
  setActive: (id: string) => Promise<void>;

  // ── Output persistence ──

  /**
   * Save survey output into the active project (auto-creates if none).
   * This is the primary write path — every workflow view calls this.
   */
  save: (output: unknown, surveyType: string, sourceView: string, countryCode: string) => Promise<void>;

  // ── Undo/Redo ──

  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
  /** Undo the last operation. Returns description on success. */
  undo: () => Promise<string | null>;
  /** Redo the last undone operation. Returns description on success. */
  redo: () => Promise<string | null>;
}

export function useProjectStore(): UseProjectStoreReturn {
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [undoRedo, setUndoRedo] = useState<UndoRedoState>({
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
  });

  // Refs for stable callbacks
  const activeRef = useRef<StoredProject | null>(null);
  const apiRef = useRef<ProjectsApi>(getProjectsApi());

  const active = projects.find((p) => p.id === activeId) ?? null;
  activeRef.current = active;

  // ── Subscribe to live changes on mount ──────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    if (!api.list) {
      setAvailable(false);
      return;
    }
    setAvailable(true);

    // Initial load
    api.list().then((s) => {
      setProjects(s.projects);
      setActiveId(s.activeProjectId);
    }).catch(() => {});

    // Subscribe to live mutations
    const unsubChanges = api.onChanged?.((s) => {
      setProjects(s.projects);
      setActiveId(s.activeProjectId);
    });

    // Subscribe to undo/redo state
    let unsubUndo: (() => void) | undefined;
    api.getUndoRedoState?.().then(setUndoRedo).catch(() => {});
    unsubUndo = api.onUndoRedoState?.(setUndoRedo);

    return () => {
      unsubChanges?.();
      unsubUndo?.();
    };
  }, []);

  // ── CRUD ────────────────────────────────────────────────────────

  const create = useCallback(async (input: Omit<CreateProjectInput, "sourceView" | "output">): Promise<StoredProject | null> => {
    const api = apiRef.current;
    if (!api.create) return null;
    const created = await api.create({ ...input, sourceView: "Projects", output: null });
    if (created) setActiveId(created.id);
    return created;
  }, []);

  const update = useCallback(async (id: string, input: Partial<Pick<UpdateProjectInput, "name" | "description" | "countryCode" | "surveyType" | "planSheet">>) => {
    const api = apiRef.current;
    await api.update?.({ id, ...input });
  }, []);

  const remove = useCallback(async (id: string) => {
    const api = apiRef.current;
    await api.delete?.(id);
  }, []);

  const setActive = useCallback(async (id: string) => {
    setActiveId(id); // optimistic
    const api = apiRef.current;
    await api.setActive?.(id);
  }, []);

  // ── Output persistence (auto-creates project if none active) ────

  const save = useCallback(async (output: unknown, surveyType: string, sourceView: string, countryCode: string) => {
    const api = apiRef.current;
    if (!api.update || !api.create) return; // browser mode

    const current = activeRef.current;
    if (current) {
      await api.update({
        id: current.id,
        output,
        surveyType,
        sourceView,
        countryCode,
        name: current.name,
      });
    } else {
      const name = `${surveyType.replace(/([A-Z])/g, " $1").trim()} — ${new Date().toLocaleString()}`;
      const created = await api.create({ name, countryCode, surveyType, sourceView, output });
      if (created) setActiveId(created.id);
    }
  }, []);

  // ── Undo/Redo ───────────────────────────────────────────────────

  const undo = useCallback(async (): Promise<string | null> => {
    const api = apiRef.current;
    if (!api.undo) return null;
    try {
      const result = await api.undo();
      return result.success ? result.description : null;
    } catch {
      return null;
    }
  }, []);

  const redo = useCallback(async (): Promise<string | null> => {
    const api = apiRef.current;
    if (!api.redo) return null;
    try {
      const result = await api.redo();
      return result.success ? result.description : null;
    } catch {
      return null;
    }
  }, []);

  return {
    projects,
    active,
    activeId,
    available,
    create,
    update,
    remove,
    setActive,
    save,
    canUndo: undoRedo.canUndo,
    canRedo: undoRedo.canRedo,
    undoDescription: undoRedo.undoDescription,
    redoDescription: undoRedo.redoDescription,
    undo,
    redo,
  };
}
