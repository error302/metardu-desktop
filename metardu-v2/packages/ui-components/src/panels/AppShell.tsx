import React, { useState, useEffect, useRef } from "react";
import "../styles/metardu-theme.css";
import "../styles/enterprise-layout.css";

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

export const AppShell: React.FC<{children?: React.ReactNode}> = ({children}) => {
  const [view, setView] = useState<ViewId>("map");
  const [sidebar, setSidebar] = useState(true);
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
        <div style={{padding:"12px",borderBottom:"1px solid var(--border-default)"}}>
          <div style={{fontFamily:"var(--font-mono)",fontSize:"14px",fontWeight:600,color:"var(--accent-primary)"}}>MetaRDU</div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:"10px",color:"var(--text-tertiary)"}}>Desktop v2.1</div>
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
          <span>platform: browser</span>
          <span>sidecar: stopped</span>
          <div style={{flex:1}}/>
          <span className="mono" style={{color:"var(--text-tertiary)"}}>MetaRDU Desktop v2.1</span>
        </div>
      </div>
    </div>
  );
};
