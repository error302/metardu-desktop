/**
 * Command Palette — Cmd+K / Ctrl+K global search and quick navigation.
 *
 * Features:
 *   - View navigation with fuzzy matching on labels and shortcuts
 *   - Recent project search
 *   - Survey point lookup (from any loaded survey data)
 *   - Action items (undo, redo, export, import)
 *   - Keyboard-driven: ↑↓ to navigate, Enter to select, Esc to close
 *   - Fuzzy highlighting of matched characters in results
 *
 * Design: modal overlay with a centered search box and scrollable results,
 * matching the MetaRDU dark theme (navy background, orange accent).
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────────────── */

export type CommandPaletteViewId =
  | "projects" | "map" | "flight" | "stakeout" | "gnss" | "drone"
  | "lulc" | "crosssection" | "asbuilt"
  | "traverse" | "cogo" | "deedplan" | "subdivision" | "fieldbook" | "lsa" | "roaddesign" | "officemgmt"
  | "topo" | "engineering" | "sectional" | "export" | "import" | "signing" | "sync" | "history";

export interface CommandPaletteNavItem {
  id: CommandPaletteViewId;
  label: string;
  category: string;
  shortcut: string;
}

export interface CommandPalettePoint {
  id: string;
  easting: number;
  northing: number;
  elevation?: number;
  source?: string;
}

export interface CommandPaletteProject {
  id: string;
  name: string;
  surveyType?: string;
}

interface CommandItem {
  id: string;
  type: "view" | "project" | "point" | "action";
  label: string;
  sublabel?: string;
  shortcut?: string;
  icon?: string;
  /** The view to navigate to when selected. */
  viewId?: CommandPaletteViewId;
  /** Arbitrary payload for actions. */
  payload?: unknown;
}

/* ── Fuzzy match ──────────────────────────────────────────────── */

function fuzzyMatch(query: string, text: string): { match: boolean; indices: Set<number> } {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices = new Set<number>();

  // Exact substring match
  const idx = t.indexOf(q);
  if (idx !== -1) {
    for (let i = idx; i < idx + q.length; i++) indices.add(i);
    return { match: true, indices };
  }

  // Fuzzy: every query char must appear in order
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.add(ti);
      qi++;
    }
  }
  return { match: qi === q.length, indices };
}

function highlightFuzzy(text: string, indices: Set<number>): React.ReactNode {
  if (indices.size === 0) return text;
  const chars = text.split("");
  return chars.map((ch, i) =>
    indices.has(i)
      ? React.createElement("span", { key: i, style: { color: "var(--accent-primary)", fontWeight: 600 } }, ch)
      : ch
  );
}

/* ── Constants ─────────────────────────────────────────────────── */

const ACTIONS: Array<{ id: string; label: string; icon: string; shortcut?: string; action: string }> = [
  { id: "action:undo", label: "Undo last change", icon: "⟲", shortcut: "Ctrl+Z", action: "undo" },
  { id: "action:redo", label: "Redo last change", icon: "⟳", shortcut: "Ctrl+Y", action: "redo" },
  { id: "action:export", label: "Export survey data", icon: "↓", action: "export" },
  { id: "action:import", label: "Import data file", icon: "↑", action: "import" },
  { id: "action:sidebar", label: "Toggle sidebar", icon: "◧", shortcut: "Ctrl+\\", action: "sidebar" },
  { id: "action:new-project", label: "Create new project", icon: "+", action: "new-project" },
];

/* ── Component ─────────────────────────────────────────────────── */

export interface CommandPaletteProps {
  /** Whether the palette is open. */
  open: boolean;
  /** Close the palette. */
  onClose: () => void;
  /** Navigate to a view. */
  onNavigate: (viewId: CommandPaletteViewId) => void;
  /** Execute a named action (undo, redo, export, import, sidebar, new-project). */
  onAction?: (action: string) => void;
  /** Available views to search. */
  views: CommandPaletteNavItem[];
  /** Recent projects. */
  projects?: CommandPaletteProject[];
  /** Survey points from the current survey state. */
  points?: CommandPalettePoint[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open, onClose, onNavigate, onAction, views, projects = [], points = [],
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build command items from all sources
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Views
    for (const v of views) {
      items.push({
        id: `view:${v.id}`,
        type: "view",
        label: v.label,
        sublabel: v.category,
        shortcut: v.shortcut,
        viewId: v.id,
      });
    }

    // Projects
    for (const p of projects) {
      items.push({
        id: `project:${p.id}`,
        type: "project",
        label: p.name,
        sublabel: p.surveyType ?? "Project",
      });
    }

    // Points
    for (const pt of points) {
      items.push({
        id: `point:${pt.id}`,
        type: "point",
        label: pt.id,
        sublabel: `E ${pt.easting.toFixed(3)}  N ${pt.northing.toFixed(3)}${pt.elevation != null ? `  Z ${pt.elevation.toFixed(3)}` : ""}`,
      });
    }

    // Actions
    for (const a of ACTIONS) {
      items.push({
        id: a.id,
        type: "action",
        label: a.label,
        icon: a.icon,
        shortcut: a.shortcut,
        payload: a.action,
      });
    }

    return items;
  }, [views, projects, points]);

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    return allItems
      .map((item) => {
        const { match, indices } = fuzzyMatch(query, item.label);
        if (match) return { item, labelIndices: indices };
        // Also match sublabel
        const sub = fuzzyMatch(query, item.sublabel ?? "");
        if (sub.match) return { item, labelIndices: new Set<number>() };
        // Match shortcut
        const sc = fuzzyMatch(query, item.shortcut ?? "");
        if (sc.match) return { item, labelIndices: new Set<number>() };
        // Match type
        const ty = fuzzyMatch(query, item.type);
        if (ty.match) return { item, labelIndices: new Set<number>() };
        return null;
      })
      .filter((x): x is { item: CommandItem; labelIndices: Set<number> } => x !== null)
      .map((x) => ({ ...x.item, _labelIndices: x.labelIndices }));
  }, [query, allItems]);

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Slight delay so the DOM is ready
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (!item) return;
      if (item.type === "view" && item.viewId) {
        onNavigate(item.viewId);
        onClose();
      } else if (item.type === "action" && onAction) {
        onAction(item.payload as string);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [filtered, selectedIndex, onNavigate, onAction, onClose]);

  if (!open) return null;

  const typeIcons: Record<string, string> = {
    view: "◆",
    project: "📁",
    point: "📍",
    action: "⚡",
  };

  const typeColors: Record<string, string> = {
    view: "var(--accent-primary)",
    project: "var(--text-secondary)",
    point: "var(--status-success)",
    action: "var(--text-tertiary)",
  };

  // Group results by type for display
  const grouped: Array<{ type: string; items: typeof filtered }> = [];
  const seen = new Set<string>();
  for (const item of filtered) {
    if (!seen.has(item.type)) {
      seen.add(item.type);
      grouped.push({ type: item.type, items: filtered.filter((f) => f.type === item.type) });
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "560px", maxHeight: "70vh",
          background: "var(--bg-primary, #1a1a2e)",
          border: "1px solid var(--border-default, #333)",
          borderRadius: "12px",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,149,0,0.1)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          animation: "cmdPaletteIn 0.12s ease-out",
        }}
      >
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-default, #333)" }}>
          <span style={{ fontSize: "18px", marginRight: "10px", color: "var(--text-tertiary)" }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search views, projects, points…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: "15px", fontFamily: "var(--font-mono, monospace)",
              color: "var(--text-primary, #fff)",
            }}
          />
          <span style={{
            fontSize: "11px", color: "var(--text-disabled, #555)",
            fontFamily: "var(--font-mono, monospace)",
            padding: "2px 6px", borderRadius: "4px",
            border: "1px solid var(--border-default, #333)",
          }}>
            esc
          </span>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: "auto", flex: 1, padding: "6px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
              No results for "{query}"
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.type}>
              <div style={{
                padding: "6px 16px", fontSize: "10px", fontFamily: "var(--font-mono)",
                color: "var(--text-disabled, #555)", textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}>
                {group.type === "view" ? "Views" : group.type === "project" ? "Projects" : group.type === "point" ? "Survey Points" : "Actions"}
              </div>
              {group.items.map((item) => {
                const globalIdx = filtered.indexOf(item);
                const isSelected = globalIdx === selectedIndex;
                const indices = (item as any)._labelIndices as Set<number> | undefined;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.type === "view" && item.viewId) {
                        onNavigate(item.viewId);
                        onClose();
                      } else if (item.type === "action" && onAction) {
                        onAction(item.payload as string);
                        onClose();
                      }
                    }}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    style={{
                      display: "flex", alignItems: "center", width: "100%",
                      padding: "8px 16px", gap: "10px",
                      background: isSelected ? "var(--bg-tertiary, #2a2a4a)" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left",
                      fontFamily: "var(--font-mono, monospace)", fontSize: "13px",
                    }}
                  >
                    <span style={{ fontSize: "14px", width: "20px", textAlign: "center", color: typeColors[item.type] }}>
                      {typeIcons[item.type]}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isSelected ? "var(--text-primary, #fff)" : "var(--text-secondary, #aaa)" }}>
                        {indices && indices.size > 0 ? highlightFuzzy(item.label, indices) : item.label}
                      </div>
                      {item.sublabel && (
                        <div style={{ fontSize: "11px", color: "var(--text-tertiary, #666)", marginTop: "1px" }}>
                          {item.sublabel}
                        </div>
                      )}
                    </div>
                    {item.shortcut && (
                      <span style={{
                        fontSize: "11px", color: "var(--text-disabled, #555)",
                        padding: "2px 6px", borderRadius: "4px",
                        border: "1px solid var(--border-default, #333)",
                        whiteSpace: "nowrap",
                      }}>
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div style={{
          display: "flex", gap: "16px", padding: "8px 16px",
          borderTop: "1px solid var(--border-default, #333)",
          fontSize: "11px", color: "var(--text-disabled, #555)",
          fontFamily: "var(--font-mono, monospace)",
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>{filtered.length} results</span>
        </div>
      </div>

      {/* Keyframe animation */}
      <style>{`
        @keyframes cmdPaletteIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
};
