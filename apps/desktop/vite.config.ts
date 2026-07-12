import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// METARDU Desktop Vite config
// Builds the React renderer for Electron to load via loadFile (production)
// or via Vite dev server (development).
export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',  // Electron loads via file:// protocol — relative paths required
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@metardu/engine': resolve(__dirname, '../../packages/engine/src/index.ts'),
    },
  },
  // OpenLayers ships some Node-only polyfills; tell Vite to leave them alone
  optimizeDeps: {
    include: ['ol', 'react', 'react-dom'],
  },
});
