/**
 * Sidecar lifecycle manager for the metardu-desktop Electron main process.
 *
 * This file is dropped into `apps/desktop/electron/main.ts` and called during
 * app startup to spawn the Rust sidecar, and during app shutdown to stop it.
 *
 * Usage in main.ts:
 *
 *   import { startSidecar, stopSidecar, getApi } from "./sidecar-manager.js";
 *
 *   app.whenReady().then(async () => {
 *     await startSidecar();
 *     createWindow();
 *   });
 *
 *   app.on("before-quit", async () => {
 *     await stopSidecar();
 *   });
 */

import { SidecarClient, MetarduApi } from "@metardu/electron-integration";
import path from "node:path";
import { app } from "electron";

let client: SidecarClient | null = null;
let api: MetarduApi | null = null;

/**
 * Start the Rust sidecar process.
 *
 * Must be called during app.whenReady() before any IPC handlers that
 * depend on the sidecar are invoked.
 *
 * The binary path is resolved based on the environment:
 *   - Development: packages/metardu-sidecar/target/release/metardu-sidecar
 *   - Production: process.resourcesPath/metardu-sidecar
 */
export async function startSidecar(): Promise<void> {
  if (client) {
    console.warn("[sidecar] Already started");
    return;
  }

  // Resolve the binary path
  const isDev = !app.isPackaged;
  const binaryPath = isDev
    ? path.join(app.getAppPath(), "..", "..", "packages", "metardu-sidecar", "target", "release", "metardu-sidecar")
    : path.join(process.resourcesPath, "metardu-sidecar");

  console.log(`[sidecar] Starting from: ${binaryPath}`);

  client = new SidecarClient({
    binaryPath,
    callTimeoutMs: 60_000, // 60s for long-running operations like ODM
    autoRestart: true,
    maxRestarts: 3,
  });

  // Forward sidecar logs to the Electron console
  client.on("stderr", (data: string) => {
    console.log(`[sidecar:stderr] ${data.trim()}`);
  });

  client.on("state", (state: string) => {
    console.log(`[sidecar] State: ${state}`);
  });

  client.on("error", (err: Error) => {
    console.error(`[sidecar] Error: ${err.message}`);
  });

  try {
    await client.start();
    api = new MetarduApi(client);
    console.log("[sidecar] Started successfully");
  } catch (err) {
    console.error("[sidecar] Failed to start:", err);
    // Don't crash the app — the renderer can still use the engine directly
    // for flight planning. Only sidecar-dependent features (GDAL, MAVLink,
    // ODM, ML) will be unavailable.
    client = null;
    api = null;
  }
}

/**
 * Stop the sidecar process.
 *
 * Must be called during app.on("before-quit") to ensure clean shutdown.
 */
export async function stopSidecar(): Promise<void> {
  if (!client) return;
  console.log("[sidecar] Stopping...");
  await client.stop();
  client = null;
  api = null;
  console.log("[sidecar] Stopped");
}

/**
 * Get the MetarduApi instance for making typed calls to the sidecar.
 *
 * Returns null if the sidecar is not running. Callers should check for null
 * and fall back to the TypeScript engine (for flight planning) or show an
 * error to the user (for sidecar-only features like MAVLink/ODM/ML).
 */
export function getApi(): MetarduApi | null {
  return api;
}

/**
 * Check if the sidecar is running.
 */
export function isSidecarRunning(): boolean {
  return client?.isRunning() ?? false;
}

/**
 * Get the sidecar state for the UI to display.
 */
export function getSidecarState(): string {
  return client?.getState() ?? "stopped";
}
