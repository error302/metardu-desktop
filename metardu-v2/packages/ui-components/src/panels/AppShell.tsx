import React, { useState, useEffect, useRef } from "react";
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
 * See docs/plan/RECOVERY-AND-PRODUCTION-PLAN.md Section 2 for the
 * full brand spec.
 *
 * Status bar: live sidecar state via `window.metardu.sidecar.onState()`
 * when the preload bridge is available (Electron production). Falls
 * back to "browser" mode when running under Vite dev or in tests.
 */

type ViewId = "map"|"flight"|"stakeout"|"gnss"|"drone"|"lulc"|"crosssection"|"asbuilt"|"traverse"|"cogo"|"deedplan";
interface NavItem { id: ViewId; label: string; icon: string; category: string; shortcut: string; }
const NAV: NavItem[] = [
  {id:"map",label:"Map",icon:"\u25A6",category:"Field Work",shortcut:"g m"},
  {id:"stakeout",label:"Stakeout",icon:"\u25C9",category:"Field Work",shortcut:"g s"},
  {id:"gnss",label:"GNSS Monitor",icon:"\u25D3",category:"Field Work",shortcut:"g g"},
  {id:"flight",label:"Flight Planning",icon:"\u2708",category:"Drone",shortcut:"g f"},
  {id:"drone",label:"Drone Dashboard",icon:"\u25B3",category:"Drone",shortcut:"g d"},
  {id:"lulc",label:"LULC Analysis",icon:"\u25D0",category:"Office",shortcut:"g l"},
  {id:"crosssection",label:"Cross-Sections",icon:"\u2317",category:"Office",shortcut:"g c"},
  {id:"asbuilt",label:"As-Built QC",icon:"\u2713",category:"Office",shortcut:"g a"},
  {id:"traverse",label:"Traverse",icon:"\u25B3",category:"Surveying",shortcut:"g t"},
  {id:"cogo",label:"COGO",icon:"\u25BD",category:"Surveying",shortcut:"g o"},
  {id:"deedplan",label:"Deed Plan",icon:"\u25A3",category:"Surveying",shortcut:"g e"},
];
const CATS = ["Field Work","Drone","Office","Surveying"];

const APP_VERSION = "0.2.0";

// Logo asset — bundled by Vite at build time. The asset URL is resolved
// relative to the package entry, so this works in both dev (Vite) and
// production (file:// loader in Electron).
const LOGO_URL = new URL("../../../../apps/desktop/src/renderer/assets/metardu-logo.jpeg", import.meta.url).href;

// Status bar sidecar state — read from the preload bridge if available.
type SidecarState = "stopped"|"starting"|"running"|"stopping"|"crashed"|"browser";

function useSidecarState(): SidecarState {
  const [state, setState] = useState<SidecarState>("browser");

  useEffect(() => {
    // window.metardu is only defined in the Electron production build.
    // In Vite dev or in tests, it's undefined — fall back to "browser".
    const w = window as unknown as {
      metardu?: {
        sidecar?: {
          getState?: () => Promise<string>;
          onState?: (cb: (s: string) => void) => () => void;
        };
      };
    };
    if (!w.metardu?.sidecar?.onState) {
      // Browser mode — no sidecar to monitor.
      setState("browser");
      return;
    }

    // Fetch initial state, then subscribe to changes.
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
    case "running":  return "statusbar-sidecar-running";
    case "starting": return "statusbar-sidecar-starting";
    case "crashed":  return "statusbar-sidecar-crashed";
    case "stopped":
    case "stopping": return "statusbar-sidecar-stopped";
    case "browser":  return "statusbar-sidecar-stopped";
    default:         return "statusbar-sidecar-stopped";
  }
}

export const AppShell: React.FC<{children?: React.ReactNode}> = ({children}) => {
  const [view, setView] = useState<ViewId>("map");
  const [sidebar, setSidebar] = useState(true);
  const sidecarState = useSidecarState();
  const lastKey = useRef<string|null>(null);
  const lastTime = useRef(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName==="INPUT"||t.tagName==="TEXTAREA";
      if((e.metaKey||e.ctrlKey)&&e.key==="\\"){e.preventDefault();setSidebar(v=>!v);return;}
      if(e.key==="Escape"){lastKey.current=null;return;}
      if(typing)return;
      const now=Date.now();
      if(lastKey.current==="g"&&now-lastTime.current<700){
        const m:Record<string,ViewId>={m:"map",f:"flight",s:"stakeout",g:"gnss",d:"drone",l:"lulc",c:"crosssection",a:"asbuilt",t:"traverse",o:"cogo",e:"deedplan"};
        if(m[e.key.toLowerCase()]){e.preventDefault();setView(m[e.key.toLowerCase()]);}
        lastKey.current=null;return;
      }
      if(e.key==="g"&&!e.metaKey&&!e.ctrlKey){lastKey.current="g";lastTime.current=now;return;}
    };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[]);

  const active = NAV.find(n=>n.id===view);

  return (
    <div className={`app-shell ${sidebar?"":"sidebar-hidden"}`}>
      <aside className="app-sidebar">
        {/* Brand header — MetaRDU logo on navy background */}
        <div className="sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_URL} alt="MetaRDU" />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">METARDU</span>
            <span className="sidebar-brand-version">Desktop v{APP_VERSION}</span>
          </div>
        </div>
        <nav className="app-sidebar-nav">
          {CATS.map(cat=>(
            <div key={cat}>
              <div style={{fontFamily:"var(--font-mono)",fontSize:"10px",color:"var(--text-disabled)",textTransform:"uppercase",letterSpacing:"0.08em",padding:"12px 12px 4px"}}>{cat}</div>
              {NAV.filter(n=>n.category===cat).map(item=>(
                <button key={item.id} className={`sidebar-item ${view===item.id?"active":""}`} onClick={()=>setView(item.id)} style={{width:"100%",border:"none",background:"transparent",cursor:"pointer",textAlign:"left"}}>
                  <span style={{width:16,textAlign:"center"}}>{item.icon}</span>
                  <span>{item.label}</span>
                  <span className="shortcut">{item.shortcut}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <div className="app-toolbar">
          <button onClick={()=>setSidebar(v=>!v)} style={{padding:"4px 8px",minWidth:28}}>{sidebar?"\u25C0":"\u25B6"}</button>
          <span className="mono" style={{fontSize:"var(--text-xs)",color:"var(--text-tertiary)",textTransform:"uppercase"}}>{active?.label??"Map"}</span>
          <div style={{flex:1}}/>
          <span className="mono" style={{fontSize:"var(--text-xs)",color:"var(--text-tertiary)"}}>project: <span style={{color:"var(--text-secondary)"}}>untitled</span></span>
        </div>
        <div className="app-breadcrumb">
          <span style={{color:"var(--text-tertiary)"}}>Home</span>
          <span style={{color:"var(--text-disabled)"}}>/</span>
          <span style={{color:"var(--accent-primary)"}}>{active?.label??"Map"}</span>
        </div>
        <div className="app-content">
          <div className="enterprise-panel">
            <div className="enterprise-panel-header">
              <span className="enterprise-panel-title">{active?.label??"Map"}</span>
            </div>
            <div className="enterprise-panel-body">
              {children ?? <div className="enterprise-empty-state">
                <div style={{fontSize:"48px",color:"var(--text-disabled)"}}>{active?.icon??"\u25A6"}</div>
                <div style={{fontSize:"14px",color:"var(--text-secondary)"}}>{active?.label??"Map"} Panel</div>
                <div style={{fontSize:"11px",color:"var(--text-tertiary)"}}>This panel is ready for content. Press Ctrl+\ to toggle sidebar.</div>
              </div>}
            </div>
          </div>
        </div>
        <div className="app-statusbar">
          <span className="mono">platform: {typeof window!=="undefined" && (window as unknown as {metardu?: unknown}).metardu ? "electron" : "browser"}</span>
          <span className={`mono ${sidecarStateClass(sidecarState)}`}>sidecar: {sidecarState}</span>
          <div style={{flex:1}}/>
          <span className="mono" style={{color:"var(--text-tertiary)"}}>MetaRDU Desktop v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
};
