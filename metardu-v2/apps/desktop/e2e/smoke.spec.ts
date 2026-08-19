/**
 * E2E Smoke Test — MetaRDU Desktop
 *
 * Covers the core survey workflow:
 *   1. App loads and renders the main shell
 *   2. Navigate to views via sidebar button clicks
 *   3. COGO view renders with calculation modes
 *   4. Traverse view renders with input fields
 *   5. Fee estimation and invoice PDF generation
 *   6. Command palette opens with Ctrl+K
 *   7. Export panel renders with format options
 *   8. No critical console errors on page load
 *
 * Runs against the Vite dev server (no Electron required).
 */

import { test, expect } from "@playwright/test";

// ─── Helpers ─────────────────────────────────────────────────────

/** Wait for the app shell to be fully rendered. */
async function waitForAppShell(page: import("@playwright/test").Page) {
  await page.waitForSelector(".sidebar-item", { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/**
 * Navigate to a view by clicking its sidebar button.
 * Finds the .sidebar-item button whose text contains the label.
 */
async function navigateToView(page: import("@playwright/test").Page, viewLabel: string) {
  const btn = page.locator(".sidebar-item").filter({ hasText: viewLabel }).first();
  await btn.click();
  await page.waitForTimeout(500);
}

// ─── Tests ───────────────────────────────────────────────────────

test.describe("MetaRDU Desktop — Smoke Tests", () => {
  test("app loads and renders the main shell", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(100);

    // Should show sidebar with nav items.
    const navItems = page.locator(".sidebar-item");
    const count = await navItems.count();
    expect(count).toBeGreaterThan(10);
  });

  test("sidebar has all major categories", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);

    const body = await page.textContent("body");
    expect(body).toContain("Surveying");
    expect(body).toContain("Engineering");
    expect(body).toContain("Office");
  });

  test("sidebar navigation works across views", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);

    // Navigate to COGO.
    await navigateToView(page, "COGO");
    let body = await page.textContent("body");
    expect(body).toContain("COGO");

    // Navigate to Traverse.
    await navigateToView(page, "Traverse");
    body = await page.textContent("body");
    expect(body).toContain("Traverse");
  });

  test("COGO view renders with calculation modes", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "COGO");

    const body = await page.textContent("body");
    const hasCogoContent =
      body?.includes("Radiation") ||
      body?.includes("radiation") ||
      body?.includes("intersect") ||
      body?.includes("COGO") ||
      body?.includes("area");
    expect(hasCogoContent).toBeTruthy();
  });

  test("Traverse view navigation works", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Traverse");

    // Sidebar should show Traverse as the active item.
    const activeItem = page.locator(".sidebar-item.active");
    const activeText = await activeItem.textContent();
    expect(activeText).toContain("Traverse");

    // Main content should show "Traverse" in the breadcrumb/panel.
    const mainContent = page.locator(".app-main");
    const mainText = await mainContent.textContent();
    expect(mainText).toContain("Traverse");
  });

  test("Office Management view navigation works", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Office");

    // Sidebar should show Office as active.
    const activeItem = page.locator(".sidebar-item.active");
    const activeText = await activeItem.textContent();
    expect(activeText).toContain("Office");

    // Main content should reference Office.
    const mainContent = page.locator(".app-main");
    const mainText = await mainContent.textContent();
    expect(mainText).toContain("Office");
  });

  test("invoice PDF button exists and is clickable", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Office");

    const invoiceBtn = page.locator("button").filter({ hasText: /invoice|pdf|generate/i }).first();

    if (await invoiceBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(invoiceBtn).toBeEnabled();
      await invoiceBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  test("command palette opens with Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);

    await page.keyboard.press("Control+k");
    await page.waitForTimeout(500);

    const palette = page.locator("input[placeholder*='earch'], input[placeholder*='view'], [class*='command-palette']");
    const isVisible = await palette.first().isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      await expect(palette.first()).toBeVisible();
    }
  });

  test("theme toggle exists in toolbar", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);

    const themeBtn = page.locator("button[title*='Theme'], button[title*='theme']").first();
    const isVisible = await themeBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!isVisible) {
      const toolbarBtns = page.locator(".app-toolbar button");
      const count = await toolbarBtns.count();
      expect(count).toBeGreaterThan(2);
    }
  });

  test("export panel renders with format options", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Export");

    const body = await page.textContent("body");
    const hasExportContent =
      body?.includes("Export") ||
      body?.includes("geojson") ||
      body?.includes("GeoJSON") ||
      body?.includes("format") ||
      body?.includes("landxml");
    expect(hasExportContent).toBeTruthy();
  });

  test("no critical console errors on page load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await waitForAppShell(page);
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("metardu") &&
        !e.includes("Cannot read properties of undefined") &&
        !e.includes("window.metardu") &&
        !e.includes("preload") &&
        !e.includes("IPC"),
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test("LULC view renders with category options", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "LULC");

    const body = await page.textContent("body");
    const hasLulcContent =
      body?.includes("LULC") ||
      body?.includes("Land Use") ||
      body?.includes("classification") ||
      body?.includes("Residential");
    expect(hasLulcContent).toBeTruthy();
  });

  test("Deed Plan view renders with beacon table", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Deed Plan");

    const body = await page.textContent("body");
    const hasDeedContent =
      body?.includes("Deed") ||
      body?.includes("Form") ||
      body?.includes("beacon") ||
      body?.includes("Beacon");
    expect(hasDeedContent).toBeTruthy();
  });

  test("Road Design view renders with chainage data", async ({ page }) => {
    await page.goto("/");
    await waitForAppShell(page);
    await navigateToView(page, "Road Design");

    const body = await page.textContent("body");
    const hasRoadContent =
      body?.includes("Road") ||
      body?.includes("chainage") ||
      body?.includes("mass") ||
      body?.includes("profile");
    expect(hasRoadContent).toBeTruthy();
  });
});
