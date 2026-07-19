/**
 * Renderer entry point for the packaged Electron app.
 *
 * Mounts the shared AppShell and supplies workflow-specific view
 * components via the renderView prop. The views depend on the engine
 * and country-config packages, so they live here in the renderer
 * (NOT in ui-components, which deliberately has no engine dependency).
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@metardu/ui-components";
import { TopographicView } from "./views/TopographicView.js";
import { EngineeringView } from "./views/EngineeringView.js";
import { SettingOutView } from "./views/SettingOutView.js";
import { SectionalView } from "./views/SectionalView.js";

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

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <AppShell
      renderView={(viewId) => {
        switch (viewId) {
          case "topo":         return <TopographicView />;
          case "engineering":  return <EngineeringView />;
          case "stakeout":     return <SettingOutView />;
          case "sectional":    return <SectionalView />;
          default:             return null; // fall back to AppShell's placeholder
        }
      }}
    />
  </React.StrictMode>,
);
