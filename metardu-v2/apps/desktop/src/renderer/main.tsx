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

// Loading fallback for lazy views — small spinner, not a full-screen blocker.
const ViewLoading: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
    Loading view…
  </div>
);

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <AppShell
      renderView={(viewId) => {
        const view = (() => {
          switch (viewId) {
            case "topo":         return <TopographicView />;
            case "engineering":  return <EngineeringView />;
            case "stakeout":     return <SettingOutView />;
            case "sectional":    return <SectionalView />;
            case "map":          return <MapView />;
            default:             return null;
          }
        })();
        // Wrap in Suspense so lazy-loaded views show a fallback while loading.
        return view ? <Suspense fallback={<ViewLoading />}>{view}</Suspense> : null;
      }}
    />
  </React.StrictMode>,
);
