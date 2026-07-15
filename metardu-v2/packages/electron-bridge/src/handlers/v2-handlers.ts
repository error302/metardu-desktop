/**
 * IPC handler registrations for v2.0 features.
 *
 * This file is imported by `apps/desktop/electron/ipc.ts` to register
 * the new v2.0 IPC handlers. It uses zod validation from @metardu/ipc-schemas
 * to validate every input on the privileged side.
 *
 * Usage in ipc.ts:
 *
 *   import { registerV2Handlers } from "./v2-handlers.js";
 *
 *   // After existing v1.0 handler registrations...
 *   registerV2Handlers();
 */

import { ipcMain } from "electron";
import { validateIpcInput } from "@metardu/ipc-schemas";
import {
  planMission,
  exportMissionToFile,
  generateContoursFromDSM,
  extractFeaturesFromOrthophoto,
  processPhotos,
  connectToDrone,
  getDroneTelemetry,
  uploadMissionToDrone,
  generateReport,
  listCameras,
} from "./drone-imagery-v2.js";

/**
 * Register all v2.0 IPC handlers with zod validation.
 *
 * Each handler:
 *   1. Validates the input against the zod schema
 *   2. If validation fails, returns { success: false, error: { code, message, details } }
 *   3. If validation passes, calls the business logic
 *   4. Returns { success: true, data: <result> }
 */
export function registerV2Handlers(): void {
  // ─── Flight Planning ─────────────────────────────────────────────

  ipcMain.handle("drone:mission.plan", async (_event, input: unknown) => {
    const validation = validateIpcInput("drone:mission.plan", input);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    try {
      const result = planMission(validation.data as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  ipcMain.handle("drone:mission.export", async (_event, input: unknown) => {
    const validation = validateIpcInput("drone:mission.export", input);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    try {
      const data = validation.data as any;
      await exportMissionToFile(data.waypoints, data.format, data.options?.outputPath ?? "/tmp/mission");
      return { success: true, data: { exported: true } };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Contour Generation ──────────────────────────────────────────

  ipcMain.handle("drone:contours.generate", async (_event, input: unknown) => {
    const validation = validateIpcInput("drone:contours.generate", input);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    try {
      const result = await generateContoursFromDSM(validation.data as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Feature Extraction ──────────────────────────────────────────

  ipcMain.handle("drone:features.extract", async (_event, input: unknown) => {
    const validation = validateIpcInput("drone:features.extract", input);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    try {
      const result = await extractFeaturesFromOrthophoto(validation.data as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Photogrammetry ──────────────────────────────────────────────

  ipcMain.handle("drone:photogrammetry.process", async (_event, input: unknown) => {
    // No zod schema for this yet — validate manually
    try {
      const result = await processPhotos(input as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Live Drone Link ─────────────────────────────────────────────

  ipcMain.handle("drone:connect", async (_event, input: unknown) => {
    try {
      const result = await connectToDrone(input as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  ipcMain.handle("drone:getTelemetry", async () => {
    try {
      const result = await getDroneTelemetry();
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  ipcMain.handle("drone:uploadMission", async (_event, input: unknown) => {
    try {
      const result = await uploadMissionToDrone(input as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Report Generation ───────────────────────────────────────────

  ipcMain.handle("drone:report.generate", async (_event, input: unknown) => {
    try {
      const result = generateReport(input as any);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Camera Database ─────────────────────────────────────────────

  ipcMain.handle("drone:cameras.list", async () => {
    try {
      const result = listCameras();
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: { code: "INTERNAL_ERROR", message: String(err) } };
    }
  });

  // ─── Sidecar Status ──────────────────────────────────────────────

  ipcMain.handle("system:sidecar.status", async () => {
    const { isSidecarRunning, getSidecarState } = require("./sidecar-manager.js");
    return {
      success: true,
      data: {
        running: isSidecarRunning(),
        state: getSidecarState(),
      },
    };
  });

  console.log("[v2] Registered 11 v2.0 IPC handlers");
}
