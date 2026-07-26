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
  // Tier 1 #3 — RINEX epoch parsing lives in the sidecar per ADR-0005 A1.
  "import.rinex_epochs",
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
  /** Instrument data import (Tier 1 #3) — Leica GSI, Sokkia SDR, Trimble DC/JOB, RINEX. */
  import: {
    /**
     * Open the OS file picker and read the chosen instrument file as UTF-8.
     * @returns `{ canceled, filename, content }`. If canceled, filename="" and content="".
     */
    pickAndRead: (): Promise<{ canceled: boolean; filename: string; content: string }> =>
      ipcRenderer.invoke("metardu:import:pickAndRead"),
    /**
     * Parse the given instrument file content and return observations.
     * For RINEX files, the main process wires the sidecar's
     * `import.rinex_epochs` handler to parse epoch records; if the sidecar
     * is unavailable the engine falls back to header-only parse with a warning.
     * @param filename Used for format auto-detection (extension sniffing).
     * @param content Raw text content of the instrument file.
     * @returns The ImportResult from the engine (observations, warnings, errors, format, pointCount).
     */
    fieldData: async (
      filename: string,
      content: string,
    ): Promise<{
      observations: Array<{ pointId: string; type: string }>;
      warnings: string[];
      errors: string[];
      format: string;
      pointCount: number;
    }> => ipcRenderer.invoke("metardu:import:fieldData", filename, content),
  },
  /** Digital signature + seal (Tier 1 #4). */
  signing: {
    signPdf: (
      pdfBytesBase64: string,
      privateKeyBase64: string,
      surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string },
    ): Promise<{
      surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string; publicKeyBase64: string; keyCreatedAt: string };
      algorithm: string;
      signatureBase64: string;
      contentHashBase64: string;
      signedAt: string;
      signedContent: string;
    }> => ipcRenderer.invoke("metardu:signing:sign", pdfBytesBase64, privateKeyBase64, surveyor),
    verifyPdf: (
      pkcs7Base64: string,
      pdfBytesBase64: string,
    ): Promise<{
      valid: boolean;
      surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string; publicKeyBase64: string; keyCreatedAt: string };
      signedAt: string;
      contentHashMatches: boolean;
      signatureValid: boolean;
      error?: string;
    }> => ipcRenderer.invoke("metardu:signing:verify", pkcs7Base64, pdfBytesBase64),
  },
};

// Expose the API on window.metardu. The renderer imports it via
// `declare global { interface Window { metardu: typeof metarduApi } }`
// (see apps/desktop/src/renderer/preload.d.ts).
contextBridge.exposeInMainWorld("metardu", metarduApi);

export type MetarduApi = typeof metarduApi;
