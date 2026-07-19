import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
