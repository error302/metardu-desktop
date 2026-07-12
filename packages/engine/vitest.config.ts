import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// METARDU Desktop — Engine Vitest configuration
//
// Per ADR-001: engine layer is framework-agnostic TypeScript, runs in Node,
// reused verbatim from metardu. Tests are ported from metardu's Jest config
// (jest.config.js) with these changes:
//   - ts-jest → Vitest's native TypeScript support (esbuild)
//   - jsdom → node (engine has no DOM dependencies)
//   - Jest's describe/it/expect globals → Vitest globals (compatible API)
//   - Test file location: src/**/__tests__/*.test.ts (matches metardu layout)
//
// Coverage targets per Master Plan §10:
//   - branches: 70%
//   - functions/lines/statements: 85%

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/engine/**/*.ts',
        'src/geo/**/*.ts',
        'src/topo/**/*.ts',
        'src/engineering/**/*.ts',
        'src/importers/**/*.ts',
        'src/export/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
        'src/**/index.ts',
      ],
      thresholds: {
        // Per Master Plan §10: branches 70%, lines/funcs/stmts 85%
        // M1 baseline (2026-07-11): branches 75% (exceeds target!),
        // functions 66%, lines 42%. As we port more test files for
        // unported source modules (cassiniSoldner/, importers/parsers/,
        // topo/breaklineTIN, etc.), we will raise these.
        branches: 70,    // ✅ already above 70% target
        functions: 60,   // raise from 50 → 60 as LSA tests now pass
        lines: 40,       // ratchet; will raise as more source gets tests
        statements: 40,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
