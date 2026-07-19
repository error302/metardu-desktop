/**
 * Renderer entry point for the packaged Electron app.
 *
 * In production, this is a pre-built bundle (Vite output) that mounts the
 * shared AppShell from @metardu/ui-components. In development, the Vite
 * dev server serves the renderer from /home/z/my-project/metardu-v2/frontend/main.tsx
 * and this file is not used.
 *
 * The bundle is produced by `vite build` with the renderer config in
 * vite.config.ts. It must NOT import anything from Node's stdlib — only
 * browser-safe modules + the `window.metardu` bridge.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@metardu/ui-components";
import "../preload/index.js";  // type-only side-effect import for the d.ts

// Logo asset — bundled by Vite at build time.
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
    <AppShell />
  </React.StrictMode>,
);
