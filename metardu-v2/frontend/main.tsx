/**
 * Development renderer entry point.
 *
 * Served by Vite at http://localhost:5173 — the Electron main process
 * loads this URL when METARDU_DEV=1 is set. In production, Vite builds
 * the renderer bundle to apps/desktop/renderer-build/ and the main process
 * loads index.html from disk.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { AppShell } from "../packages/ui-components/src/index.js";
import "../packages/ui-components/src/styles/metardu-theme.css";
import "../packages/ui-components/src/styles/enterprise-layout.css";

// Dev-mode view components — import from the desktop renderer's views dir.
// In production these are bundled by Vite from apps/desktop/src/renderer/views/.
import { TopographicView } from "../apps/desktop/src/renderer/views/TopographicView.js";
import { EngineeringView } from "../apps/desktop/src/renderer/views/EngineeringView.js";
import { SettingOutView } from "../apps/desktop/src/renderer/views/SettingOutView.js";
import { SectionalView } from "../apps/desktop/src/renderer/views/SectionalView.js";

const LOGO_URL = new URL("../apps/desktop/src/renderer/assets/metardu-logo.jpeg", import.meta.url).href;

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
          switch (viewId) {
            case "topo":         return <TopographicView />;
            case "engineering":  return <EngineeringView />;
            case "stakeout":     return <SettingOutView />;
            case "sectional":    return <SectionalView />;
            default:             return null;
          }
        }}
      />
    </ErrorBoundary>
  </React.StrictMode>,
);
