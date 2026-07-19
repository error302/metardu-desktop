/**
 * Development renderer entry point.
 *
 * Served by Vite at http://localhost:5173 — the Electron main process
 * loads this URL when METARDU_DEV=1 is set. In production, Vite builds
 * the renderer bundle to apps/desktop/src/renderer/ and the main process
 * loads index.html from disk.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { AppShell } from "../packages/ui-components/src/index.js";
import "../packages/ui-components/src/styles/metardu-theme.css";
import "../packages/ui-components/src/styles/enterprise-layout.css";

const loading = document.getElementById("loading");
if (loading) loading.remove();

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
