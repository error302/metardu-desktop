import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer build config.
// - Dev: `vite` serves at http://localhost:5173 with HMR. Electron loads this URL
//   when METARDU_DEV=1 is set.
// - Prod: `vite build` emits to apps/desktop/src/renderer/ — the Electron main
//   process loads index.html from there via loadFile().
export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    // Output to apps/desktop/renderer-build/ — NOT src/renderer/, which is
    // where the source .tsx lives. Vite's emptyOutDir would otherwise
    // delete the source files on every build.
    outDir: "apps/desktop/renderer-build",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@metardu/engine-v2": "/packages/engine/src/index.ts",
      "@metardu/ui-components": "/packages/ui-components/src/index.ts",
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
});
