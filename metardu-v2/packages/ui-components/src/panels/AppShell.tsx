import React, { useState, useEffect, useRef, type ComponentType } from "react";
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
  type LucideProps,
} from "lucide-react";
import "../styles/metardu-theme.css";
import "../styles/enterprise-layout.css";

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
  | "map" | "flight" | "stakeout" | "gnss" | "drone"
  | "lulc" | "crosssection" | "asbuilt"
  | "traverse" | "cogo" | "deedplan"
  | "topo" | "engineering" | "sectional";

interface NavItem {
  id: ViewId;
  label: string;
  icon: ComponentType<LucideProps>;
  category: string;
  shortcut: string;
}

const NAV: NavItem[] = [
  // Field Work
  { id: "map", label: "Map", icon: MapIcon, category: "Field Work", shortcut: "g m" },
  { id: "stakeout", label: "Setting-Out", icon: Crosshair, category: "Field Work", shortcut: "g s" },
  { id: "gnss", label: "GNSS Monitor", icon: Radar, category: "Field Work", shortcut: "g g" },
  // Drone
  { id: "flight", label: "Flight Planning", icon: Plane, category: "Drone", shortcut: "g f" },
  { id: "drone", label: "Drone Dashboard", icon: Plane, category: "Drone", shortcut: "g d" },
  // Office
  { id: "topo", label: "Topographic", icon: Mountain, category: "Office", shortcut: "g t" },
  { id: "lulc", label: "LULC Analysis", icon: Layers, category: "Office", shortcut: "g l" },
  { id: "crosssection", label: "Cross-Sections", icon: ScanLine, category: "Office", shortcut: "g c" },
  { id: "asbuilt", label: "As-Built QC", icon: TrendingUp, category: "Office", shortcut: "g a" },
  // Surveying
  { id: "traverse", label: "Traverse", icon: Compass, category: "Surveying", shortcut: "g v" },
  { id: "cogo", label: "COGO", icon: Calculator, category: "Surveying", shortcut: "g o" },
  { id: "deedplan", label: "Deed Plan", icon: FileText, category: "Surveying", shortcut: "g e" },
  // Engineering
  { id: "engineering", label: "Engineering", icon: Settings, category: "Engineering", shortcut: "g n" },
  { id: "sectional", label: "Sectional Properties", icon: Building2, category: "Engineering", shortcut: "g q" },
];
const CATS = ["Field Work", "Drone", "Office", "Surveying", "Engineering"];

const APP_VERSION = "0.5.0";

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
  const sidecarState = useSidecarState();
  const lastKey = useRef<string | null>(null);
  const lastTime = useRef(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setSidebar(v => !v); return; }
      if (e.key === "Escape") { lastKey.current = null; return; }
      if (typing) return;
      const now = Date.now();
      if (lastKey.current === "g" && now - lastTime.current < 700) {
        const m: Record<string, ViewId> = {
          m: "map", f: "flight", s: "stakeout", g: "gnss", d: "drone",
          l: "lulc", c: "crosssection", a: "asbuilt",
          v: "traverse", o: "cogo", e: "deedplan",
          t: "topo", n: "engineering", q: "sectional", p: "map",
        };
        if (m[e.key.toLowerCase()]) { e.preventDefault(); setView(m[e.key.toLowerCase()]); }
        lastKey.current = null; return;
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) { lastKey.current = "g"; lastTime.current = now; return; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

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
          <button onClick={() => setSidebar(v => !v)} style={{ padding: "4px 8px", minWidth: 28 }}>
            {sidebar ? "\u25C0" : "\u25B6"}
          </button>
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
            {active?.label ?? "Map"}
          </span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            project: <span style={{ color: "var(--text-secondary)" }}>untitled</span>
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
        <div className="app-statusbar">
          <span className="mono">platform: {typeof window !== "undefined" && (window as unknown as { metardu?: unknown }).metardu ? "electron" : "browser"}</span>
          <span className={`mono ${sidecarStateClass(sidecarState)}`}>sidecar: {sidecarState}</span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ color: "var(--text-tertiary)" }}>MetaRDU Desktop v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
};
