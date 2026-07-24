/**
 * MetaRDU Desktop — preload bridge.
 *
 * This is the ONLY surface the renderer has to the privileged world (main
 * process, sidecar, filesystem, network). It runs in an isolated context
 * with Node access, then exposes a curated API on `window.metardu` via
 * contextBridge.
 *
 * Security invariants (master plan Section 2):
 *   - contextIsolation: true (set in main/index.ts)
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - Every exposed method must validate its inputs (zod) before forwarding
 *     to ipcRenderer.invoke. Never expose ipcRenderer directly.
 */

import { contextBridge, ipcRenderer } from "electron";

// ─── Sidecar call shape ───────────────────────────────────────────
// Method names are validated against a known allowlist. Params are passed
// through to the sidecar, which has its own Serde-based validation. We
// don't re-implement zod schemas here for every method — that lives in
// @metardu/ipc-schemas and is enforced on the renderer side before this
// bridge is even called.

const ALLOWED_METHODS = new Set<string>([
  "ping",
  "echo",
  "version",
  "list_methods",
  "gdal_contour",
  // Phase 2+ placeholders — included now so the renderer can probe availability.
  "mavlink_connect",
  "odm_process",
  "ml_extract_buildings",
]);

function validateMethod(method: unknown): asserts method is string {
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    throw new Error(
      `Disallowed sidecar method: ${String(method)}. Allowed: ${[...ALLOWED_METHODS].join(", ")}`,
    );
  }
}

const metarduApi = {
  /** Invoke a sidecar RPC method. Method name is allowlisted. */
  sidecar: {
    call: async (method: string, params: unknown): Promise<unknown> => {
      validateMethod(method);
      return ipcRenderer.invoke("metardu:sidecar:call", method, params);
    },
    /** Get current sidecar state: "stopped" | "starting" | "running" | "stopping" | "crashed". */
    getState: (): Promise<string> => ipcRenderer.invoke("metardu:sidecar:state"),
    /** Subscribe to sidecar state changes. Returns an unsubscribe function. */
    onState: (callback: (state: string) => void): (() => void) => {
      const listener = (_event: unknown, state: string): void => callback(state);
      ipcRenderer.on("metardu:sidecar:state", listener);
      return () => ipcRenderer.off("metardu:sidecar:state", listener);
    },
  },
  /** App metadata. */
  app: {
    version: (): Promise<string> => ipcRenderer.invoke("metardu:app:version"),
  },
  /** Integration & Export (ADR-0005) — 7 exporters for GIS/CAD/photogrammetry. */
  export: {
    /** List available export formats. Returns array of {format, description, fileExtension}. */
    list: (): Promise<Array<{ format: string; description: string; fileExtension: string }>> =>
      ipcRenderer.invoke("metardu:export:list"),
    /**
     * Export survey data to a file. Shows a "Save As" dialog.
     * @param format Exporter format ("geojson", "geopackage", "pyqgis-script", "gcp", "qgs-project", "osm-changeset", "dxf")
     * @param surveyOutput The workflow output to export (must be serializable for IPC)
     * @param options Export options (countryCode, projectMetadata, outputWgs84, etc.)
     * @returns { filePath, bytes, warnings } or throws on error
     */
    survey: async (
      format: string,
      surveyOutput: unknown,
      options: Record<string, unknown>,
    ): Promise<{ filePath: string; bytes: number; warnings: string[] }> =>
      ipcRenderer.invoke("metardu:export:survey", format, surveyOutput, options),
  },
};

// Expose the API on window.metardu. The renderer imports it via
// `declare global { interface Window { metardu: typeof metarduApi } }`
// (see apps/desktop/src/renderer/preload.d.ts).
contextBridge.exposeInMainWorld("metardu", metarduApi);

export type MetarduApi = typeof metarduApi;
