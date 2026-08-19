/**
 * Renderer entry point for the packaged Electron app.
 *
 * Uses React.lazy + dynamic imports to code-split the view components.
 * Each workflow view (Topographic, Engineering, SettingOut, Sectional)
 * is loaded on-demand when the user navigates to it, reducing the
 * initial bundle size.
 *
 * Bundle splitting:
 *   - Main chunk: AppShell + ui-components (core UI, ~50KB)
 *   - Lazy chunk 1: TopographicView (+ engine topo module, ~80KB)
 *   - Lazy chunk 2: EngineeringView (+ engine eng module, ~60KB)
 *   - Lazy chunk 3: SettingOutView (+ engine stakeout module, ~50KB)
 *   - Lazy chunk 4: SectionalView (+ engine sectional module, ~50KB)
 *   - Lazy chunk 5: MapView (+ OpenLayers, ~500KB — loaded only when
 *     the user opens the Map view)
 *
 * This pattern matches the Lazy Loading best practice from React docs
 * and is used by production apps like Linear and VS Code.
 */

import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@metardu/ui-components";
import { SurveyStateProvider } from "./SurveyStateContext.js";
import "../preload/index.js"; // type-only side-effect import for the d.ts

const LOGO_URL = new URL("./assets/metardu-logo.jpeg", import.meta.url).href;

// Replace the static loading placeholder with a branded one.
const loading = document.getElementById("loading");
if (loading) {
  loading.innerHTML = `
    <div class="loading-screen">
      <img src="${LOGO_URL}" alt="MetaRDU" />
      <div class="loading-screen-text">MetaRDU Desktop — loading…</div>
    </div>
  `;
  setTimeout(() => loading.remove(), 0);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

// ─── Lazy-loaded view components ─────────────────────────────────
// Each view is loaded on-demand via dynamic import(). This keeps the
// initial bundle small — the user only downloads the code for the
// view they're actually looking at.

const TopographicView = lazy(() => import("./views/TopographicView.js").then(m => ({ default: m.TopographicView })));
const EngineeringView = lazy(() => import("./views/EngineeringView.js").then(m => ({ default: m.EngineeringView })));
const SettingOutView = lazy(() => import("./views/SettingOutView.js").then(m => ({ default: m.SettingOutView })));
const SectionalView = lazy(() => import("./views/SectionalView.js").then(m => ({ default: m.SectionalView })));
const MapView = lazy(() => import("./views/MapView.js").then(m => ({ default: m.MapView })));
const ExportPanel = lazy(() => import("./views/ExportPanel.js").then(m => ({ default: m.ExportPanel })));
const ImportPanel = lazy(() => import("./views/ImportPanel.js").then(m => ({ default: m.ImportPanel })));
const SigningPanel = lazy(() => import("./views/SigningPanel.js").then(m => ({ default: m.SigningPanel })));
const SyncPanel = lazy(() => import("./views/SyncPanel.js").then(m => ({ default: m.SyncPanel })));
const ProjectsPanel = lazy(() => import("./views/ProjectsPanel.js").then(m => ({ default: m.ProjectsPanel })));
const TraverseView = lazy(() => import("./views/TraverseView.js").then(m => ({ default: m.TraverseView })));
const COGOView = lazy(() => import("./views/COGOView.js").then(m => ({ default: m.COGOView })));
const DeedPlanView = lazy(() => import("./views/DeedPlanView.js").then(m => ({ default: m.DeedPlanView })));
const GNSSView = lazy(() => import("./views/GNSSView.js").then(m => ({ default: m.GNSSView })));
const FlightPlanningView = lazy(() => import("./views/FlightPlanningView.js").then(m => ({ default: m.FlightPlanningView })));
const SubdivisionView = lazy(() => import("./views/SubdivisionView.js").then(m => ({ default: m.SubdivisionView })));
const FieldBookView = lazy(() => import("./views/FieldBookView.js").then(m => ({ default: m.FieldBookView })));
const LSAView = lazy(() => import("./views/LSAView.js").then(m => ({ default: m.LSAView })));
const RoadDesignView = lazy(() => import("./views/RoadDesignView.js").then(m => ({ default: m.RoadDesignView })));
const OfficeManagementView = lazy(() => import("./views/OfficeManagementView.js").then(m => ({ default: m.OfficeManagementView })));
const LULCView = lazy(() => import("./views/LULCView.js").then(m => ({ default: m.LULCView })));
const VersionHistoryView = lazy(() => import("./views/VersionHistoryView.js").then(m => ({ default: m.VersionHistoryView })));

// Loading fallback for lazy views — small spinner, not a full-screen blocker.
const ViewLoading: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
    Loading view…
  </div>
);

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <SurveyStateProvider>
      <AppShell
        renderView={(viewId) => {
          const view = (() => {
            switch (viewId) {
              case "topo":         return <TopographicView />;
              case "engineering":  return <EngineeringView />;
              case "stakeout":     return <SettingOutView />;
              case "sectional":    return <SectionalView />;
              case "map":          return <MapView />;
              case "export":       return <ExportPanel />;
              case "import":       return <ImportPanel />;
              case "signing":      return <SigningPanel />;
              case "sync":         return <SyncPanel />;
              case "projects":     return <ProjectsPanel />;
              case "traverse":     return <TraverseView />;
              case "cogo":         return <COGOView />;
              case "deedplan":     return <DeedPlanView />;
              case "gnss":         return <GNSSView />;
              case "flight":
              case "drone":        return <FlightPlanningView />;
              case "subdivision":  return <SubdivisionView />;
              case "fieldbook":    return <FieldBookView />;
              case "lsa":          return <LSAView />;
              case "roaddesign":   return <RoadDesignView />;
              case "officemgmt":   return <OfficeManagementView />;
              case "lulc":          return <LULCView />;
              case "history":       return <VersionHistoryView />;
              default:             return null;
            }
          })();
          // Wrap in Suspense so lazy-loaded views show a fallback while loading.
          return view ? <Suspense fallback={<ViewLoading />}>{view}</Suspense> : null;
        }}
      />
    </SurveyStateProvider>
  </React.StrictMode>,
);
