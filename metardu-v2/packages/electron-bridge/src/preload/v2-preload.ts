/**
 * Preload bridge for v2.0 API.
 *
 * This file is added to `apps/desktop/electron/preload.ts` to expose
 * the v2.0 API to the renderer via contextBridge.
 *
 * Usage in preload.ts:
 *
 *   import { exposeV2Api } from "./v2-preload.js";
 *
 *   // After existing v1.0 contextBridge.exposeInMainWorld...
 *   exposeV2Api();
 */

import { contextBridge, ipcRenderer } from "electron";

/**
 * The v2.0 API exposed to the renderer.
 *
 * Every method returns a Promise that resolves to:
 *   { success: true, data: <result> }
 * or:
 *   { success: false, error: { code, message, details } }
 */
export interface MetarduV2Api {
  drone: {
    mission: {
      plan: (input: unknown) => Promise<unknown>;
      export: (input: unknown) => Promise<unknown>;
    };
    contours: {
      generate: (input: unknown) => Promise<unknown>;
    };
    features: {
      extract: (input: unknown) => Promise<unknown>;
    };
    photogrammetry: {
      process: (input: unknown) => Promise<unknown>;
    };
    connect: (input: unknown) => Promise<unknown>;
    getTelemetry: () => Promise<unknown>;
    uploadMission: (input: unknown) => Promise<unknown>;
    report: {
      generate: (input: unknown) => Promise<unknown>;
    };
    cameras: {
      list: () => Promise<unknown>;
    };
  };
  system: {
    sidecar: {
      status: () => Promise<{ running: boolean; state: string }>;
    };
  };
}

/**
 * Expose the v2.0 API to the renderer.
 *
 * Call this once during preload.ts initialization.
 */
export function exposeV2Api(): void {
  const api: MetarduV2Api = {
    drone: {
      mission: {
        plan: (input) => ipcRenderer.invoke("drone:mission.plan", input),
        export: (input) => ipcRenderer.invoke("drone:mission.export", input),
      },
      contours: {
        generate: (input) => ipcRenderer.invoke("drone:contours.generate", input),
      },
      features: {
        extract: (input) => ipcRenderer.invoke("drone:features.extract", input),
      },
      photogrammetry: {
        process: (input) => ipcRenderer.invoke("drone:photogrammetry.process", input),
      },
      connect: (input) => ipcRenderer.invoke("drone:connect", input),
      getTelemetry: () => ipcRenderer.invoke("drone:getTelemetry"),
      uploadMission: (input) => ipcRenderer.invoke("drone:uploadMission", input),
      report: {
        generate: (input) => ipcRenderer.invoke("drone:report.generate", input),
      },
      cameras: {
        list: () => ipcRenderer.invoke("drone:cameras.list"),
      },
    },
    system: {
      sidecar: {
        status: () => ipcRenderer.invoke("system:sidecar.status"),
      },
    },
  };

  contextBridge.exposeInMainWorld("metarduV2", api);
  console.log("[v2] Exposed v2.0 API to renderer via contextBridge");
}
