/**
 * useUndoRedo — React hook for the SQLite-backed undo/redo system.
 *
 * Subscribes to the main-process UndoRedoManager via the preload bridge.
 * Provides:
 *   - canUndo / canRedo booleans (for button disabled state)
 *   - undoDescription / redoDescription (for tooltips)
 *   - undo() / redo() actions (call the main process)
 *   - lastOperation (the description of the last undo/redo, for toast)
 *
 * Keyboard shortcuts (Ctrl+Z / Ctrl+Y) are wired in the AppShell component
 * that consumes this hook.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

interface UndoRedoResult {
  success: boolean;
  project?: unknown | null;
  projectId?: string;
  activeProjectId?: string | null;
  state: UndoRedoState;
  description: string;
}

interface UseUndoRedoReturn {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
  undo: () => Promise<UndoRedoResult | null>;
  redo: () => Promise<UndoRedoResult | null>;
  /** Description of the last operation performed (for toast display). */
  lastOperation: string | null;
  /** Clear the last operation toast. */
  clearLastOperation: () => void;
}

function getApis() {
  return (window as unknown as {
    metardu?: {
      projects?: {
        undo?: () => Promise<UndoRedoResult>;
        redo?: () => Promise<UndoRedoResult>;
        getUndoRedoState?: () => Promise<UndoRedoState>;
        onUndoRedoState?: (cb: (state: UndoRedoState) => void) => () => void;
      };
    };
  }).metardu?.projects;
}

export function useUndoRedo(): UseUndoRedoReturn {
  const [state, setState] = useState<UndoRedoState>({
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
  });
  const [lastOperation, setLastOperation] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to live undo/redo state from the main process.
  useEffect(() => {
    const apis = getApis();
    if (!apis?.onUndoRedoState) return;

    // Fetch initial state.
    apis.getUndoRedoState?.().then(setState).catch(() => {});

    // Subscribe to live updates (broadcast after every mutation).
    const unsubscribe = apis.onUndoRedoState(setState);
    return unsubscribe;
  }, []);

  const undo = useCallback(async (): Promise<UndoRedoResult | null> => {
    const apis = getApis();
    if (!apis?.undo) return null;
    try {
      const result = await apis.undo();
      if (result.success) {
        setLastOperation(result.description);
        // Auto-clear after 4 seconds.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLastOperation(null), 4000);
      }
      return result;
    } catch {
      return null;
    }
  }, []);

  const redo = useCallback(async (): Promise<UndoRedoResult | null> => {
    const apis = getApis();
    if (!apis?.redo) return null;
    try {
      const result = await apis.redo();
      if (result.success) {
        setLastOperation(result.description);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLastOperation(null), 4000);
      }
      return result;
    } catch {
      return null;
    }
  }, []);

  const clearLastOperation = useCallback(() => {
    setLastOperation(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undoDescription: state.undoDescription,
    redoDescription: state.redoDescription,
    undo,
    redo,
    lastOperation,
    clearLastOperation,
  };
}
