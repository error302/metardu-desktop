import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer build config.
// - Dev: `vite` serves at http://localhost:5173 with HMR. Electron loads this URL
//   when METARDU_DEV=1 is set.
// - Prod: `vite build` emits to apps/desktop/src/renderer/ — the Electron main
//   process loads index.html from there via loadFile().
//
// Code-splitting: manualChunks splits the bundle into logical chunks:
//   - vendor-react: React + ReactDOM (~140KB)
//   - vendor-ol: OpenLayers (~500KB, only loaded when MapView is opened)
//   - vendor-dxf: @tarikjabiri/dxf (~290KB, only loaded when DXF is generated)
//   - vendor-engine: @metardu/engine-flight-planning (~200KB)
//   - vendor-country-config: @metardu/country-config (~50KB)
//   - index: the main app shell (~20KB)
//
// With React.lazy() in main.tsx, each view component is also a separate
// chunk. The initial load is just vendor-react + index (~160KB), with
// view chunks loaded on-demand.
export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "apps/desktop/renderer-build",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    // Code-splitting configuration
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/ol")) {
            return "vendor-ol";
          }
          if (id.includes("node_modules/@tarikjabiri/dxf")) {
            return "vendor-dxf";
          }
          if (id.includes("node_modules/@metardu/engine-flight-planning") || id.includes("packages/engine/dist")) {
            return "vendor-engine";
          }
          if (id.includes("node_modules/@metardu/country-config") || id.includes("packages/country-config/dist")) {
            return "vendor-country-config";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
        },
      },
    },
    // Warn at 1MB (the lazy-loaded OL chunk will be ~500KB, which is fine)
    chunkSizeWarningLimit: 1000,
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
