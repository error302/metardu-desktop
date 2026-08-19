import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for MetaRDU Desktop.
 *
 * Tests run against the Vite dev server (port 5173) in a headless
 * Chromium browser. The renderer has no direct Electron imports —
 * it uses `window.metardu` via optional chaining with browser fallbacks.
 *
 * Usage:
 *   npx playwright test              # Run all E2E tests
 *   npx playwright test --ui         # Open Playwright UI
 *   npx playwright show-report       # View HTML report
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Start Vite dev server before running tests. */
  webServer: {
    command: "npx vite --port 5173 --host",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    cwd: "../..",
  },
});
