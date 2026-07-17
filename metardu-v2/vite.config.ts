import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()], root: ".", base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: true },
  server: { port: 5173, strictPort: true },
  resolve: { alias: {
    "@metardu/engine-v2": "/packages/engine/src/index.ts",
    "@metardu/ui-components": "/packages/ui-components/src/index.ts",
  }},
  optimizeDeps: { include: ["react", "react-dom"] },
});
