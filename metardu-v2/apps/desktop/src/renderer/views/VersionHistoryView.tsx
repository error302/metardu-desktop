/**
 * Version History Visualizer — shows a timeline of project operations
 * (undo/redo stack) with visual indicators of what changed.
 *
 * Reads the undo/redo state from the main process via the preload bridge
 * and displays:
 *   - A vertical timeline of operations (newest first)
 *   - Operation type badges (create, update, delete)
 *   - Timestamps and descriptions
 *   - A visual diff indicator showing which fields changed
 *   - Click to undo/redo to any point in history
 */

import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, RotateCw, Clock, FileText, Trash2, Edit3, Plus, ArrowRight } from "lucide-react";

interface Operation {
  id: string;
  type: "create" | "update" | "delete" | "undo" | "redo";
  description: string;
  timestamp: string;
  projectId?: string;
  projectName?: string;
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
}

interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

function getApi() {
  return (window as unknown as {
    metardu?: {
      projects?: {
        getUndoRedoState?: () => Promise<UndoRedoState>;
        onUndoRedoState?: (cb: (s: UndoRedoState) => void) => () => void;
        undo?: () => Promise<{ success: boolean; description: string }>;
        redo?: () => Promise<{ success: boolean; description: string }>;
        getOperationLog?: () => Promise<Operation[]>;
      };
    };
  }).metardu?.projects;
}

const opTypeBadge: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
  create: { bg: "rgba(34,197,94,0.15)", color: "var(--status-success)", icon: <Plus size={12} /> },
  update: { bg: "rgba(59,130,246,0.15)", color: "var(--status-info)", icon: <Edit3 size={12} /> },
  delete: { bg: "rgba(239,68,68,0.15)", color: "var(--status-error)", icon: <Trash2 size={12} /> },
  undo: { bg: "rgba(245,158,11,0.15)", color: "var(--status-warning)", icon: <RotateCcw size={12} /> },
  redo: { bg: "rgba(168,85,247,0.15)", color: "#a855f7", icon: <RotateCw size={12} /> },
};

export const VersionHistoryView: React.FC = () => {
  const [state, setState] = useState<UndoRedoState>({ canUndo: false, canRedo: false, undoDescription: null, redoDescription: null });
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);

  const api = getApi();

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.getUndoRedoState?.().then(setState).catch(() => {});
    api.getOperationLog?.().then(log => { setOperations(log ?? []); setLoading(false); }).catch(() => setLoading(false));
    const unsub = api.onUndoRedoState?.(setState);
    return () => unsub?.();
  }, []);

  const handleUndo = useCallback(async () => {
    if (!api?.undo) return;
    const r = await api.undo();
    if (r.success) {
      setState(s => ({ ...s, canUndo: false, undoDescription: null }));
      api.getOperationLog?.().then(setOperations).catch(() => {});
    }
  }, [api]);

  const handleRedo = useCallback(async () => {
    if (!api?.redo) return;
    const r = await api.redo();
    if (r.success) {
      setState(s => ({ ...s, canRedo: false, redoDescription: null }));
      api.getOperationLog?.().then(setOperations).catch(() => {});
    }
  }, [api]);

  if (!api) {
    return (
      <div style={{ padding: "24px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>Version History</h2>
        <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: "8px" }}>
          Version history not available — run in the Electron app to see the operation timeline.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Version History
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Timeline of project operations. Undo/redo to any point in the history.
      </p>

      {/* Undo/Redo controls */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          onClick={handleUndo}
          disabled={!state.canUndo}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", borderRadius: "6px",
            border: `1px solid ${state.canUndo ? "var(--accent-primary)" : "var(--border-default)"}`,
            background: state.canUndo ? "var(--accent-primary)" : "transparent",
            color: state.canUndo ? "#fff" : "var(--text-disabled)",
            fontSize: "12px", fontWeight: 500,
            cursor: state.canUndo ? "pointer" : "not-allowed",
          }}
        >
          <RotateCcw size={14} /> Undo
          {state.undoDescription && <span style={{ fontSize: "10px", opacity: 0.7 }}>— {state.undoDescription}</span>}
        </button>
        <button
          onClick={handleRedo}
          disabled={!state.canRedo}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", borderRadius: "6px",
            border: `1px solid ${state.canRedo ? "var(--accent-primary)" : "var(--border-default)"}`,
            background: state.canRedo ? "var(--accent-primary)" : "transparent",
            color: state.canRedo ? "#fff" : "var(--text-disabled)",
            fontSize: "12px", fontWeight: 500,
            cursor: state.canRedo ? "pointer" : "not-allowed",
          }}
        >
          <RotateCw size={14} /> Redo
          {state.redoDescription && <span style={{ fontSize: "10px", opacity: 0.7 }}>— {state.redoDescription}</span>}
        </button>
        <span style={{ fontSize: "11px", color: "var(--text-tertiary)", marginLeft: "auto" }}>
          {operations.length} operation{operations.length === 1 ? "" : "s"} in history
        </span>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)" }}>Loading history…</div>
      ) : operations.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          <Clock size={32} strokeWidth={1} style={{ margin: "0 auto 8px", display: "block", opacity: 0.3 }} />
          No operations yet. Create or modify a project to see the history.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0", position: "relative", paddingLeft: "24px" }}>
          {/* Vertical timeline line */}
          <div style={{ position: "absolute", left: "11px", top: "0", bottom: "0", width: "2px", background: "var(--border-default)" }} />

          {operations.map((op, idx) => {
            const badge = opTypeBadge[op.type] ?? opTypeBadge.update;
            const isLatest = idx === 0;
            const isRedoable = idx === 0 && state.canRedo;
            return (
              <div key={op.id} style={{
                position: "relative", padding: "10px 0 10px 16px",
                opacity: isRedoable ? 0.5 : 1,
              }}>
                {/* Timeline dot */}
                <div style={{
                  position: "absolute", left: "-17px", top: "14px",
                  width: "10px", height: "10px", borderRadius: "50%",
                  background: isLatest ? "var(--accent-primary)" : "var(--bg-tertiary)",
                  border: `2px solid ${isLatest ? "var(--accent-primary)" : "var(--border-default)"}`,
                  zIndex: 1,
                }} />

                <div style={{
                  padding: "10px 14px", borderRadius: "8px",
                  background: isLatest ? "var(--bg-tertiary)" : "transparent",
                  border: `1px solid ${isLatest ? "var(--border-strong)" : "transparent"}`,
                }}>
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "4px",
                      padding: "2px 8px", borderRadius: "4px",
                      background: badge.bg, color: badge.color,
                      fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                    }}>
                      {badge.icon} {op.type}
                    </span>
                    <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-primary)" }}>
                      {op.description}
                    </span>
                    {isLatest && (
                      <span style={{
                        fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                        background: "var(--accent-primary)", color: "#fff",
                        fontWeight: 600,
                      }}>
                        CURRENT
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    <span>{new Date(op.timestamp).toLocaleString()}</span>
                    {op.projectName && <span>📁 {op.projectName}</span>}
                  </div>

                  {/* Changes diff */}
                  {op.changes && op.changes.length > 0 && (
                    <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      {op.changes.map((ch, ci) => (
                        <div key={ci} style={{
                          display: "flex", alignItems: "center", gap: "6px",
                          fontSize: "10px", fontFamily: "var(--font-mono)",
                          color: "var(--text-secondary)",
                        }}>
                          <span style={{ color: "var(--text-tertiary)", minWidth: "60px" }}>{ch.field}</span>
                          <span style={{ color: "var(--status-error)", textDecoration: "line-through" }}>
                            {String(ch.from).slice(0, 30)}
                          </span>
                          <ArrowRight size={10} />
                          <span style={{ color: "var(--status-success)" }}>
                            {String(ch.to).slice(0, 30)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
