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

const loading = document.getElementById("loading");
if (loading) loading.remove();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
