import React, { useState, useEffect, useRef, useCallback, type ComponentType } from "react";
import { CommandPalette, type CommandPaletteViewId, type CommandPaletteNavItem } from "./CommandPalette.js";
import {
  Map as MapIcon,
  Crosshair,
  Radar,
  Plane,
  Mountain,
  Layers,
  Ruler,
  FileText,
  Settings,
  Building2,
  ScanLine,
  TrendingUp,
  Compass,
  Triangle,
  Calculator,
  PenTool,
  Download,
  Upload,
  RefreshCw,
  Folder,
  Split,
  BookOpen,
  Activity,
  Milestone,
  Briefcase,
  Undo2,
  Redo2,
  Clock,
  type LucideProps,
} from "lucide-react";
import "../styles/metardu-theme.css";
import "../styles/enterprise-layout.css";
import { THEMES, applyTheme, loadPersistedTheme, type ThemeId } from "../styles/theme-toggles.js";

/**
 * MetaRDU Desktop AppShell — the top-level UI frame.
 *
 * Layout:
 *   ┌──────────┬─────────────────────────────────────┐
 *   │ brand    │ toolbar                             │
 *   │ logo     ├─────────────────────────────────────┤
 *   │ + nav    │ breadcrumb                          │
 *   │          ├─────────────────────────────────────┤
 *   │          │                                     │
 *   │          │ content (per-view)                  │
 *   │          │                                     │
 *   │          ├─────────────────────────────────────┤
 *   │          │ statusbar (sidecar state live)      │
 *   └──────────┴─────────────────────────────────────┘
 *
 * Branding: the sidebar header uses the MetaRDU logo on navy
 * background (matches the logo's deep navy `#1A1F36`). The active
 * nav item uses orange accent (`#FF9500`) — also from the logo.
 *
 * Icons: uses lucide-react (the icon library used by Cursor, Linear,
 * and shadcn/ui). No unicode symbols or emojis — every icon is a
 * crisp SVG that scales perfectly at any size.
 */

type ViewId =
  | "projects" | "map" | "flight" | "stakeout" | "gnss" | "drone"
  | "lulc" | "crosssection" | "asbuilt"
  | "traverse" | "cogo" | "deedplan" | "subdivision" | "fieldbook" | "lsa" | "roaddesign" | "officemgmt"
  | "topo" | "engineering" | "sectional" | "export" | "import" | "signing" | "sync" | "history";

interface NavItem {
  id: ViewId;
  label: string;
  icon: ComponentType<LucideProps>;
  category: string;
  shortcut: string;
}

const NAV: NavItem[] = [
  // Projects (workspace hub — create/switch/manage the projects every
  // workflow view saves into)
  { id: "projects", label: "Projects", icon: Folder, category: "Projects", shortcut: "g p" },
  // Field Work
  { id: "map", label: "Map", icon: MapIcon, category: "Field Work", shortcut: "g m" },
  { id: "stakeout", label: "Setting-Out", icon: Crosshair, category: "Field Work", shortcut: "g s" },
  { id: "gnss", label: "GNSS Monitor", icon: Radar, category: "Field Work", shortcut: "g g" },
  { id: "fieldbook", label: "Field Book", icon: BookOpen, category: "Field Work", shortcut: "g b" },
  { id: "import", label: "Import", icon: Upload, category: "Field Work", shortcut: "g i" },
  { id: "sync", label: "Sync", icon: RefreshCw, category: "Field Work", shortcut: "g u" },
  // Drone
  { id: "flight", label: "Flight Planning", icon: Plane, category: "Drone", shortcut: "g f" },
  { id: "drone", label: "Drone Dashboard", icon: Plane, category: "Drone", shortcut: "g d" },
  // Surveying
  { id: "traverse", label: "Traverse", icon: Compass, category: "Surveying", shortcut: "g v" },
  { id: "cogo", label: "COGO", icon: Calculator, category: "Surveying", shortcut: "g o" },
  { id: "subdivision", label: "Subdivision", icon: Split, category: "Surveying", shortcut: "g k" },
  { id: "lsa", label: "Network LSA", icon: Activity, category: "Surveying", shortcut: "g j" },
  { id: "deedplan", label: "Deed Plan", icon: FileText, category: "Surveying", shortcut: "g e" },
  { id: "signing", label: "Sign & Seal", icon: PenTool, category: "Surveying", shortcut: "g y" },
  // Engineering
  { id: "roaddesign", label: "Road Design", icon: Milestone, category: "Engineering", shortcut: "g r" },
  { id: "engineering", label: "Engineering", icon: Settings, category: "Engineering", shortcut: "g n" },
  { id: "crosssection", label: "Cross-Sections", icon: ScanLine, category: "Engineering", shortcut: "g c" },
  { id: "asbuilt", label: "As-Built QC", icon: TrendingUp, category: "Engineering", shortcut: "g a" },
  { id: "sectional", label: "Sectional Properties", icon: Building2, category: "Engineering", shortcut: "g q" },
  // Office & Topo
  { id: "topo", label: "Topographic", icon: Mountain, category: "Office", shortcut: "g t" },
  { id: "lulc", label: "LULC Analysis", icon: Layers, category: "Office", shortcut: "g l" },
  { id: "officemgmt", label: "Office & Billing", icon: Briefcase, category: "Office", shortcut: "g w" },
  { id: "history", label: "Version History", icon: Clock, category: "Office", shortcut: "g h" },
  // Export
  { id: "export", label: "Export", icon: Download, category: "Export", shortcut: "g x" },
];
const CATS = ["Projects", "Field Work", "Drone", "Surveying", "Engineering", "Office", "Export"];

const APP_VERSION = "0.5.0";

// ─── Undo/Redo hook (SQLite-backed operation log) ───────────────
// This hook subscribes to the main-process UndoRedoManager via the
// preload bridge. It provides canUndo/canRedo booleans, undo/redo
// actions, and a lastOperation string for toast display.

interface UndoRedoHookState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

interface UndoRedoHookResult extends UndoRedoHookState {
  undo: () => Promise<{ success: boolean; description: string } | null>;
  redo: () => Promise<{ success: boolean; description: string } | null>;
  lastOperation: string | null;
  clearLastOperation: () => void;
}

function useUndoRedo(): UndoRedoHookResult {
  const [state, setState] = useState<UndoRedoHookState>({
    canUndo: false, canRedo: false, undoDescription: null, redoDescription: null,
  });
  const [lastOperation, setLastOperation] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      metardu?: {
        projects?: {
          getUndoRedoState?: () => Promise<UndoRedoHookState>;
          onUndoRedoState?: (cb: (s: UndoRedoHookState) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.projects?.onUndoRedoState) return;
    w.metardu.projects.getUndoRedoState?.().then(setState).catch(() => {});
    return w.metardu.projects.onUndoRedoState(setState);
  }, []);

  const undo = useCallback(async () => {
    const w = window as unknown as { metardu?: { projects?: { undo?: () => Promise<{ success: boolean; description: string }> } } };
    if (!w.metardu?.projects?.undo) return null;
    try {
      const r = await w.metardu.projects.undo();
      if (r.success) {
        setLastOperation(r.description);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLastOperation(null), 4000);
      }
      return r;
    } catch { return null; }
  }, []);

  const redo = useCallback(async () => {
    const w = window as unknown as { metardu?: { projects?: { redo?: () => Promise<{ success: boolean; description: string }> } } };
    if (!w.metardu?.projects?.redo) return null;
    try {
      const r = await w.metardu.projects.redo();
      if (r.success) {
        setLastOperation(r.description);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLastOperation(null), 4000);
      }
      return r;
    } catch { return null; }
  }, []);

  const clearLastOperation = useCallback(() => {
    setLastOperation(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { ...state, undo, redo, lastOperation, clearLastOperation };
}

// Logo asset — bundled by Vite at build time.
const LOGO_URL = new URL("../../../../apps/desktop/src/renderer/assets/metardu-logo.jpeg", import.meta.url).href;

// Status bar sidecar state — read from the preload bridge if available.
type SidecarState = "stopped" | "starting" | "running" | "stopping" | "crashed" | "browser";

function useSidecarState(): SidecarState {
  const [state, setState] = useState<SidecarState>("browser");

  useEffect(() => {
    const w = window as unknown as {
      metardu?: {
        sidecar?: {
          getState?: () => Promise<string>;
          onState?: (cb: (s: string) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.sidecar?.onState) {
      setState("browser");
      return;
    }

    w.metardu.sidecar.getState?.().then((s) => setState(s as SidecarState)).catch(() => {});
    const unsubscribe = w.metardu.sidecar.onState((s: string) => {
      setState(s as SidecarState);
    });
    return unsubscribe;
  }, []);

  return state;
}

function sidecarStateClass(state: SidecarState): string {
  switch (state) {
    case "running": return "statusbar-sidecar-running";
    case "starting": return "statusbar-sidecar-starting";
    case "crashed": return "statusbar-sidecar-crashed";
    case "stopped":
    case "stopping": return "statusbar-sidecar-stopped";
    case "browser": return "statusbar-sidecar-stopped";
    default: return "statusbar-sidecar-stopped";
  }
}

// Sync status — live badge in the status bar. The SyncClient lives in
// the main process; status changes are pushed over IPC. In a plain
// browser (no Electron bridge) the badge shows "n/a". `deletes` is the
// count of queued tombstone deletes — shown distinctly so a local delete
// waiting to flush to the server is visible at a glance.
type SyncState = "idle" | "syncing" | "offline" | "error" | "n/a";

function useSyncState(): { state: SyncState; pending: number; deletes: number } {
  const [sync, setSync] = useState<{ state: SyncState; pending: number; deletes: number }>({ state: "n/a", pending: 0, deletes: 0 });

  useEffect(() => {
    const w = window as unknown as {
      metardu?: {
        sync?: {
          getStatus?: () => Promise<{ state: string; pendingUploads?: number; pendingDownloads?: number; pendingDeletes?: number }>;
          onStatus?: (cb: (s: { state: string; pendingUploads?: number; pendingDownloads?: number; pendingDeletes?: number }) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.sync?.onStatus) return; // stays "n/a"

    const apply = (s: { state: string; pendingUploads?: number; pendingDownloads?: number; pendingDeletes?: number }) => {
      // The bridge only ever reports these four states; "n/a" is reserved
      // for browser mode (no bridge) so it can never arrive here.
      const valid: ReadonlyArray<string> = ["idle", "syncing", "offline", "error"];
      setSync({
        state: valid.includes(s.state) ? s.state as SyncState : "idle",
        pending: (s.pendingUploads ?? 0) + (s.pendingDownloads ?? 0),
        deletes: s.pendingDeletes ?? 0,
      });
    };

    w.metardu.sync.getStatus?.().then(apply).catch(() => {});
    return w.metardu.sync.onStatus(apply);
  }, []);

  return sync;
}

function syncStateClass(state: SyncState): string {
  switch (state) {
    case "syncing": return "statusbar-sidecar-starting";
    case "error": return "statusbar-sidecar-crashed";
    case "offline":
    case "n/a": return "statusbar-sidecar-stopped";
    case "idle":
    default: return "statusbar-sidecar-running";
  }
}

// Active project name — live from the persisted project store (ProjectStore,
// metardu:projects:*). The store lives in the main process; changes are
// pushed over IPC. In a plain browser (no Electron bridge) the toolbar falls
// back to the original "untitled" placeholder.
function useActiveProjectName(): string {
  const [name, setName] = useState<string>("untitled");

  useEffect(() => {
    const w = window as unknown as {
      metardu?: {
        projects?: {
          list?: () => Promise<{ projects: Array<{ id: string; name: string }>; activeProjectId: string | null }>;
          onChanged?: (cb: (s: { projects: Array<{ id: string; name: string }>; activeProjectId: string | null }) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.projects?.onChanged) return; // stays "untitled"

    const apply = (s: { projects: Array<{ id: string; name: string }>; activeProjectId: string | null }) => {
      const active = s.projects.find((p) => p.id === s.activeProjectId);
      setName(active?.name ?? "untitled");
    };

    w.metardu.projects.list?.().then(apply).catch(() => {});
    return w.metardu.projects.onChanged(apply);
  }, []);

  return name;
}

// All projects — for the command palette search.
function useAllProjects(): Array<{ id: string; name: string; surveyType?: string }> {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; surveyType?: string }>>([]);

  useEffect(() => {
    const w = window as unknown as {
      metardu?: {
        projects?: {
          list?: () => Promise<{ projects: Array<{ id: string; name: string; surveyType?: string }>; activeProjectId: string | null }>;
          onChanged?: (cb: (s: { projects: Array<{ id: string; name: string; surveyType?: string }>; activeProjectId: string | null }) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.projects?.onChanged) return;
    const apply = (s: { projects: Array<{ id: string; name: string; surveyType?: string }> }) => setProjects(s.projects);
    w.metardu.projects.list?.().then(apply).catch(() => {});
    return w.metardu.projects.onChanged(apply);
  }, []);

  return projects;
}

// ─── Icon size + style helpers ───────────────────────────────────

const ICON_SIZE = 16;
const ICON_STROKE = 1.75;

function navIconStyle(active: boolean): React.CSSProperties {
  return {
    width: ICON_SIZE,
    height: ICON_SIZE,
    strokeWidth: ICON_STROKE,
    flexShrink: 0,
  };
}

export const AppShell: React.FC<{
  children?: React.ReactNode;
  renderView?: (viewId: ViewId) => React.ReactNode;
}> = ({ children, renderView }) => {
  const [view, setView] = useState<ViewId>("map");
  const [sidebar, setSidebar] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [theme, setThemeState] = useState<ThemeId>(loadPersistedTheme);
  const sidecarState = useSidecarState();
  const syncState = useSyncState();
  const projectName = useActiveProjectName();
  const allProjects = useAllProjects();
  const lastKey = useRef<string | null>(null);
  const lastTime = useRef(0);
  const undoRedo = useUndoRedo();

  // Apply persisted theme on mount
  useEffect(() => { applyTheme(theme); }, [theme]);

  const cycleTheme = useCallback(() => {
    const ids: ThemeId[] = ["dark", "light", "high-contrast"];
    const next = ids[(ids.indexOf(theme) + 1) % ids.length];
    setThemeState(next);
    applyTheme(next);
  }, [theme]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setSidebar(v => !v); return; }
      // ── Command Palette: Cmd+K / Ctrl+K ──
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(v => !v); return; }
      // ── Undo/Redo keyboard shortcuts ──
      // Ctrl+Z / Cmd+Z = Undo, Ctrl+Y / Cmd+Shift+Z / Ctrl+Shift+Z = Redo
      // These work even inside inputs/textareas (standard OS behavior).
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        undoRedo.redo();
        return;
      }
      if (e.key === "Escape") { lastKey.current = null; return; }
      if (typing) return;
      const now = Date.now();
      if (lastKey.current === "g" && now - lastTime.current < 700) {
        const m: Record<string, ViewId> = {
          p: "projects", m: "map", f: "flight", s: "stakeout", g: "gnss", d: "drone",
          l: "lulc", c: "crosssection", a: "asbuilt",
          v: "traverse", o: "cogo", e: "deedplan",
          t: "topo", n: "engineering", q: "sectional",
          x: "export", i: "import", u: "sync",
          y: "signing", h: "history",
        };
        if (m[e.key.toLowerCase()]) { e.preventDefault(); setView(m[e.key.toLowerCase()]); }
        lastKey.current = null; return;
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) { lastKey.current = "g"; lastTime.current = now; return; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undoRedo]);

  const active = NAV.find(n => n.id === view);
  const ActiveIcon = active?.icon ?? MapIcon;

  const viewContent = renderView?.(view) ?? children ?? (
    <div className="enterprise-empty-state">
      <ActiveIcon size={48} strokeWidth={1} style={{ color: "var(--text-disabled)" }} />
      <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "8px" }}>{active?.label ?? "Map"} Panel</div>
      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>This panel is ready for content. Press Ctrl+\ to toggle sidebar.</div>
    </div>
  );

  return (
    <div className={`app-shell ${sidebar ? "" : "sidebar-hidden"}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <img src={LOGO_URL} alt="MetaRDU" />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">METARDU</span>
            <span className="sidebar-brand-version">Desktop v{APP_VERSION}</span>
          </div>
        </div>
        <nav className="app-sidebar-nav">
          {CATS.map(cat => (
            <div key={cat}>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "10px",
                color: "var(--text-disabled)", textTransform: "uppercase",
                letterSpacing: "0.08em", padding: "12px 12px 4px",
              }}>{cat}</div>
              {NAV.filter(n => n.category === cat).map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`sidebar-item ${view === item.id ? "active" : ""}`}
                    onClick={() => setView(item.id)}
                    style={{
                      width: "100%", border: "none", background: "transparent",
                      cursor: "pointer", textAlign: "left", borderRadius: 0,
                    }}
                  >
                    <Icon
                      size={ICON_SIZE}
                      strokeWidth={ICON_STROKE}
                      style={{ flexShrink: 0, color: view === item.id ? "var(--accent-primary)" : "currentColor" }}
                    />
                    <span>{item.label}</span>
                    <span className="shortcut">{item.shortcut}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <div className="app-toolbar">
          <button onClick={cycleTheme} title={`Theme: ${theme} (click to cycle)`} style={{ padding: "3px 10px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "4px", cursor: "pointer" }}>
            {THEMES.find(t => t.id === theme)?.icon ?? "🌙"}
          </button>
          <button onClick={() => setCmdOpen(true)} title="Search views, projects, points (Ctrl+K)" style={{ padding: "3px 10px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "4px", cursor: "pointer" }}>
            ⌘K
          </button>
          <button onClick={() => setSidebar(v => !v)} style={{ padding: "4px 8px", minWidth: 28 }}>
            {sidebar ? "\u25C0" : "\u25B6"}
          </button>
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
            {active?.label ?? "Map"}
          </span>
          <div style={{ flex: 1 }} />
          {/* ── Undo/Redo buttons ── */}
          <button
            onClick={() => undoRedo.undo()}
            disabled={!undoRedo.canUndo}
            title={undoRedo.undoDescription ? `Undo: ${undoRedo.undoDescription} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
            style={{
              padding: "3px 6px", minWidth: 26,
              background: "transparent", border: "none",
              color: undoRedo.canUndo ? "var(--text-secondary)" : "var(--text-disabled)",
              cursor: undoRedo.canUndo ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: "4px",
            }}
          >
            <Undo2 size={14} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => undoRedo.redo()}
            disabled={!undoRedo.canRedo}
            title={undoRedo.redoDescription ? `Redo: ${undoRedo.redoDescription} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
            style={{
              padding: "3px 6px", minWidth: 26,
              background: "transparent", border: "none",
              color: undoRedo.canRedo ? "var(--text-secondary)" : "var(--text-disabled)",
              cursor: undoRedo.canRedo ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: "4px",
            }}
          >
            <Redo2 size={14} strokeWidth={1.75} />
          </button>
          <div style={{ width: 1, height: 16, background: "var(--border-default)", margin: "0 4px" }} />
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            project: <span style={{ color: "var(--text-secondary)" }}>{projectName}</span>
          </span>
        </div>
        <div className="app-breadcrumb">
          <span style={{ color: "var(--text-tertiary)" }}>Home</span>
          <span style={{ color: "var(--text-disabled)" }}>/</span>
          <span style={{ color: "var(--accent-primary)" }}>{active?.label ?? "Map"}</span>
        </div>
        <div className="app-content">
          <div className="enterprise-panel">
            <div className="enterprise-panel-header">
              <span className="enterprise-panel-title">{active?.label ?? "Map"}</span>
            </div>
            <div className="enterprise-panel-body">
              {viewContent}
            </div>
          </div>
        </div>
        {/* ── Undo/Redo toast notification ── */}
        {/* ── Command Palette ── */}
        <CommandPalette
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          onNavigate={(viewId: CommandPaletteViewId) => setView(viewId)}
          onAction={(action: string) => {
            if (action === "undo") undoRedo.undo();
            else if (action === "redo") undoRedo.redo();
            else if (action === "sidebar") setSidebar(v => !v);
            else if (action === "export") setView("export");
            else if (action === "import") setView("import");
            else if (action === "new-project") setView("projects");
          }}
          views={NAV.map((n): CommandPaletteNavItem => ({ id: n.id, label: n.label, category: n.category, shortcut: n.shortcut }))}
          projects={allProjects.map(p => ({ id: p.id, name: p.name, surveyType: p.surveyType }))}
        />
        {undoRedo.lastOperation && (
          <div
            onClick={undoRedo.clearLastOperation}
            style={{
              position: "fixed", bottom: 48, left: "50%", transform: "translateX(-50%)",
              padding: "8px 16px", borderRadius: "8px",
              background: "var(--bg-tertiary, #1e1e2e)",
              border: "1px solid var(--border-default)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              fontSize: "12px", fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
              zIndex: 9999, cursor: "pointer",
              animation: "fadeIn 0.15s ease-in",
              display: "flex", alignItems: "center", gap: "8px",
            }}
          >
            <span style={{ color: "var(--accent-primary)" }}>⟲</span>
            {undoRedo.lastOperation}
          </div>
        )}
        <div className="app-statusbar">
          <span className="mono">platform: {typeof window !== "undefined" && (window as unknown as { metardu?: unknown }).metardu ? "electron" : "browser"}</span>
          <span className={`mono ${sidecarStateClass(sidecarState)}`}>sidecar: {sidecarState}</span>
          <span className={`mono ${syncStateClass(syncState.state)}`}>
            sync: {syncState.state === "n/a" ? "n/a" : `${syncState.state}${syncState.pending > 0 ? ` (${syncState.pending})` : ""}`}
            {syncState.deletes > 0 && (
              <span title={`${syncState.deletes} project deletion${syncState.deletes === 1 ? "" : "s"} queued — will flush on next sync`} style={{ color: "var(--text-warning)" }}>
                {" "}· {syncState.deletes} del
              </span>
            )}
          </span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ color: "var(--text-tertiary)" }}>MetaRDU Desktop v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
};
