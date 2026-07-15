import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["dist/**", "**/*.test.ts", "**/__tests__/**", "src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
    property: {
      // Increase from default 100 to catch edge cases
      numRuns: 200,
      // Mark tests as failed if they hit an edge case that should be handled
      endOnFailure: true,
    },
  },
});
