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

// Logo asset — bundled by Vite at build time.
const LOGO_URL = new URL("../apps/desktop/src/renderer/assets/metardu-logo.jpeg", import.meta.url).href;

// Replace the static loading placeholder with a branded one that
// shows the MetaRDU logo centered on the navy background from the
// brand palette. The AppShell mounts immediately afterwards.
const loading = document.getElementById("loading");
if (loading) {
  loading.innerHTML = `
    <div class="loading-screen">
      <img src="${LOGO_URL}" alt="MetaRDU" />
      <div class="loading-screen-text">MetaRDU Desktop — loading…</div>
    </div>
  `;
  // Remove after the React tree has mounted (next tick).
  setTimeout(() => loading.remove(), 0);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </React.StrictMode>,
);
