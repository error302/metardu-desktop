/**
 * Development renderer entry point.
 *
 * Matches the production renderer — uses React.lazy for code-splitting.
 * Served by Vite at http://localhost:5173.
 */

import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { AppShell } from "../packages/ui-components/src/index.js";
import "../packages/ui-components/src/styles/metardu-theme.css";
import "../packages/ui-components/src/styles/enterprise-layout.css";

const LOGO_URL = new URL("../apps/desktop/src/renderer/assets/metardu-logo.jpeg", import.meta.url).href;

// Lazy-loaded views — Vite resolves .js → .tsx automatically in dev mode.
const TopographicView = lazy(() => import("../apps/desktop/src/renderer/views/TopographicView.js").then(m => ({ default: m.TopographicView })));
const EngineeringView = lazy(() => import("../apps/desktop/src/renderer/views/EngineeringView.js").then(m => ({ default: m.EngineeringView })));
const SettingOutView = lazy(() => import("../apps/desktop/src/renderer/views/SettingOutView.js").then(m => ({ default: m.SettingOutView })));
const SectionalView = lazy(() => import("../apps/desktop/src/renderer/views/SectionalView.js").then(m => ({ default: m.SectionalView })));

const ViewLoading: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
    Loading view…
  </div>
);

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

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppShell
        renderView={(viewId) => {
          const view = (() => {
            switch (viewId) {
              case "topo": return <TopographicView />;
              case "engineering": return <EngineeringView />;
              case "stakeout": return <SettingOutView />;
              case "sectional": return <SectionalView />;
              default: return null;
            }
          })();
          return view ? <Suspense fallback={<ViewLoading />}>{view}</Suspense> : null;
        }}
      />
    </ErrorBoundary>
  </React.StrictMode>,
);
