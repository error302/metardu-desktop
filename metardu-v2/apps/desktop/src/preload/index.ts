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
import type { Form3Input, SyncConfig, SyncProject, SyncStatus, SyncConflict } from "@metardu/engine-flight-planning";
import type { StoredProject, ProjectStoreState, CreateProjectInput, UpdateProjectInput } from "../main/project-store-core.js";

/** Undo/redo result from the main process. */
interface UndoRedoResult {
  success: boolean;
  project?: StoredProject | null;
  projectId?: string;
  activeProjectId?: string | null;
  state: { canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null };
  description: string;
}

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
  // Instrument connection — live serial, BLE, NTRIP streaming.
  "instrument.list_ports",
  "instrument.list_ble_devices",
  "instrument.scan_ports",
  "instrument.connect",
  "instrument.disconnect",
  "instrument.status",
  // GNSS baseline covariance estimation from satellite geometry.
  "gnss.estimate_baseline_covariance",
  "gnss.batch_estimate_covariance",
  // Adjustment engine.
  "adjustment.run",
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
  // Form 3 generation (used for signing)
  form3: {
    generateForm3Pdf: (input: Form3Input): Promise<{ pdfBytesBase64: string }> => ipcRenderer.invoke("metardu:form3:generate", input),
  },
  /** 300 DPI survey map export (main-process sharp rasterizer). */
  map: {
    /**
     * Render the survey output to a 300 DPI PNG of the plan (no dialog).
     * Returns base64 PNG + dimensions + scale + a summary of what was plotted.
     * @param input surveyOutput (any workflow output), projectName, countryCode (for CRS label
     *   + per-country plan-sheet title block/footer), surveyorName, date, sheetSize (a4..a0,
     *   letter, legal), orientation (landscape/portrait), scaleDenominator (fixed 1:D or omit)
     */
    renderPng: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<{
      pngBase64: string;
      widthPx: number;
      heightPx: number;
      scaleDenominator: number;
      fitsSheet: boolean;
      summary: string;
    }> => ipcRenderer.invoke("metardu:map:renderPng", input),
    /**
     * Render the survey plan to a 300 DPI PNG and show a Save-As dialog.
     * Returns { canceled } or { canceled: false, filePath, bytes, ... }.
     */
    exportPng: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<
      | { canceled: true }
      | {
          canceled: false;
          filePath: string;
          bytes: number;
          widthPx: number;
          heightPx: number;
          scaleDenominator: number;
          fitsSheet: boolean;
          summary: string;
        }
    > => ipcRenderer.invoke("metardu:map:exportPng", input),
    /**
     * Render the exact plan sheet to a single-page, print-grade PDF (no
     * flight-plan report wrapper) and show a Save-As dialog.
     * Same input shape as exportPng; the page is sized to the sheet in
     * points with the 300 DPI PNG embedded full-bleed.
     */
    exportPdf: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<
      | { canceled: true }
      | {
          canceled: false;
          filePath: string;
          bytes: number;
          widthPx: number;
          heightPx: number;
          scaleDenominator: number;
          fitsSheet: boolean;
          summary: string;
        }
    > => ipcRenderer.invoke("metardu:map:exportPdf", input),
    /**
     * Render the statutory survey report PDF (A4 cover + the exact plan
     * sheet as the survey-map page) and show a Save-As dialog.
     * Same input shape as exportPdf — the sheet, orientation and scale
     * choices are honoured so the report's map page matches the
     * print-preview exactly (both flow through renderSurveyMapPng).
     */
    exportReport: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<
      | { canceled: true }
      | {
          canceled: false;
          filePath: string;
          bytes: number;
          widthPx: number;
          heightPx: number;
          scaleDenominator: number;
          fitsSheet: boolean;
          summary: string;
        }
    > => ipcRenderer.invoke("metardu:map:exportReport", input),
    /**
     * Auto-export on workflow completion — no dialog, no user interaction.
     * Writes the statutory plan (single 300 DPI PNG, or a booklet + per-
     * parcel PNGs for multi-parcel outputs) AND the statutory report PDF
     * (A4 cover + the plan sheet embedded as the survey-map page) into
     * userData/auto-exports/ using the country's plan-sheet profile.
     * Called automatically the moment a workflow run finishes — the full
     * report with the embedded map lands with no ExportPanel / Map View
     * visit. @returns { reportFile } when the report rendered.
     * @param input Same shape as renderPng, with optional sheet choices
     *   (falling back to the country's statutory defaults in main).
     */
    autoExport: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<{
      kind: "png" | "booklet";
      directory: string;
      files: Array<{ label: string; path: string; bytes: number }>;
      pageCount?: number;
      scaleDenominator: number;
      summary: string;
      /** Statutory report PDF (cover + embedded map) written alongside the plan. */
      reportFile?: { path: string; bytes: number };
    }> => ipcRenderer.invoke("metardu:map:autoExport", input),
    /**
     * Batch export for multi-parcel projects: split the output into one
     * 300 DPI plan PNG per parcel, compile a statutory booklet PDF
     * (cover/index + one plan page per parcel), write one statutory report
     * PDF per parcel (cover + embedded plan), and write the individual
     * PNGs + reports beside the PDF via a Save-As dialog.
     */
    exportBooklet: (input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<
      | { canceled: true }
      | {
          canceled: false;
          bookletPath: string;
          pageCount: number;
          pngFiles: Array<{ label: string; path: string; bytes: number }>;
          /** One statutory report PDF per parcel (cover + embedded plan). */
          reportFiles: Array<{ label: string; path: string; bytes: number }>;
        }
    > => ipcRenderer.invoke("metardu:map:exportBooklet", input),
    /**
     * Multi-project batch export (ProjectsPanel): every parcel of every
     * selected project becomes a 300 DPI plan sheet using that project's
     * own country plan-sheet profile; all sheets compile into one booklet
     * PDF with a master index grouped by project, and the individual PNGs
     * plus one statutory report PDF per sheet are written beside the PDF.
     */
    exportProjectsBooklet: (input: {
      projects: Array<{
        name: string;
        countryCode?: string;
        surveyOutput: unknown;
      }>;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    }): Promise<
      | { canceled: true }
      | {
          canceled: false;
          bookletPath: string;
          pageCount: number;
          pngFiles: Array<{ label: string; path: string; bytes: number }>;
          /** One statutory report PDF per sheet (cover + embedded plan). */
          reportFiles: Array<{ label: string; path: string; bytes: number }>;
        }
    > => ipcRenderer.invoke("metardu:map:exportProjectsBooklet", input),
  },
  /** Instrument connection — live serial, Bluetooth LE, NTRIP streaming. */
  instrument: {
    /** List available serial ports on the system. */
    listPorts: (): Promise<{
      ports: Array<{
        port_name: string;
        display_name: string;
        is_usb: boolean;
        manufacturer?: string;
        product?: string;
        serial_number?: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke("metardu:instrument:listPorts"),

    /** Scan for nearby Bluetooth LE devices (3-second scan). */
    listBleDevices: (): Promise<{
      devices: Array<{
        name: string;
        address: string;
        rssi: number;
        service_uuids: string[];
      }>;
      error?: string;
    }> => ipcRenderer.invoke("metardu:instrument:listBleDevices"),

    /**
     * Connect to an instrument (serial, BLE, or NTRIP).
     * Returns a connection_id for status/disconnect.
     */
    connect: (params: {
      connection_type: "serial" | "bluetooth" | "ntrip";
      port?: string;
      baud_rate?: number;
      protocol?: string;
      device_name?: string;
      device_address?: string;
      service_uuid?: string;
      characteristic_uuid?: string;
      caster_url?: string;
      mountpoint?: string;
      username?: string;
      password?: string;
      nmea_position?: string;
      instrument_name?: string;
    }): Promise<{ connection_id: string; status: string }> =>
      ipcRenderer.invoke("metardu:instrument:connect", params),

    /** Disconnect from an instrument by connection_id. */
    disconnect: (connectionId: string): Promise<{ disconnected: boolean; connection_id: string }> =>
      ipcRenderer.invoke("metardu:instrument:disconnect", connectionId),

    /** Get status of all active instrument connections. */
    status: (): Promise<{
      connections: Array<{
        id: string;
        connection_type: string;
        port: string;
        status: string;
        instrument_name?: string;
        protocol?: string;
        observation_count: number;
        connected_at?: string;
      }>;
      count: number;
      error?: string;
    }> => ipcRenderer.invoke("metardu:instrument:status"),

    /** Subscribe to live observation data from a connection. Returns unsubscribe. */
    onObservation: (callback: (data: {
      connection_id: string;
      observation: unknown;
      observation_count: number;
    }) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown): void => callback(data as any);
      ipcRenderer.on("metardu:instrument:observation", listener);
      return () => ipcRenderer.off("metardu:instrument:observation", listener);
    },

    /** Subscribe to connection status updates. Returns unsubscribe. */
    onConnected: (callback: (data: {
      connection_id: string;
      connection_type: string;
      port: string;
      instrument_name: string;
      status: string;
    }) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown): void => callback(data as any);
      ipcRenderer.on("metardu:instrument:connected", listener);
      return () => ipcRenderer.off("metardu:instrument:connected", listener);
    },

    /** Subscribe to disconnection events. Returns unsubscribe. */
    onDisconnected: (callback: (data: {
      connection_id: string;
    }) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown): void => callback(data as any);
      ipcRenderer.on("metardu:instrument:disconnected", listener);
      return () => ipcRenderer.off("metardu:instrument:disconnected", listener);
    },

    /** Subscribe to periodic status updates. Returns unsubscribe. */
    onStatusUpdate: (callback: (data: {
      connections: Array<unknown>;
      count: number;
    }) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown): void => callback(data as any);
      ipcRenderer.on("metardu:instrument:statusUpdate", listener);
      return () => ipcRenderer.off("metardu:instrument:statusUpdate", listener);
    },

    /** Start polling for instrument status (every 2s). */
    startPolling: (): void => {
      ipcRenderer.send("metardu:instrument:startPolling");
    },

    /** Stop polling for instrument status. */
    stopPolling: (): void => {
      ipcRenderer.send("metardu:instrument:stopPolling");
    },
  },

  /** GNSS baseline covariance estimation from satellite geometry. */
  gnss: {
    /**
     * Estimate a correlated 3x3 baseline covariance matrix from satellite
     * elevation/azimuth observations at two receivers. Uses PDOP-weighted
     * model with SNR weighting and elevation-dependent accuracy.
     */
    estimateBaselineCovariance: (params: {
      from_receiver: { receiver_id: string; satellites: Array<{ satellite_id: string; elevation_deg: number; azimuth_deg: number; snr_dbhz?: number }> };
      to_receiver: { receiver_id: string; satellites: Array<{ satellite_id: string; elevation_deg: number; azimuth_deg: number; snr_dbhz?: number }> };
      uere_m?: number;
      elevation_mask_deg?: number;
      iono_correction_factor?: number;
      tropo_correction_factor?: number;
      is_rtk?: boolean;
    }): Promise<{
      covariance: number[];
      pdop_from: number; pdop_to: number; pdop_avg: number;
      hdop_from: number; hdop_to: number;
      vdop_from: number; vdop_to: number;
      common_satellites: number; sats_from: number; sats_to: number;
      sigma_e: number; sigma_n: number; sigma_h: number;
      correlation_en: number; quality: string; warnings: string[];
    }> => ipcRenderer.invoke("metardu:gnss:estimateBaselineCovariance", params),

    /**
     * Batch estimate covariance for multiple baselines at once.
     * Each baseline is identified by from/to receiver IDs.
     */
    batchEstimateCovariance: (params: {
      receivers: Record<string, { receiver_id: string; satellites: Array<{ satellite_id: string; elevation_deg: number; azimuth_deg: number; snr_dbhz?: number }> }>;
      baselines: Array<[string, string]>;
      uere_m?: number;
      elevation_mask_deg?: number;
      is_rtk?: number;
    }): Promise<{ baselines: Array<{ from: string; to: string; result: unknown }> }> =>
      ipcRenderer.invoke("metardu:gnss:batchEstimateCovariance", params),
  },

  /** Coordinate helpers (projected → WGS84) for the MapView overlay. */
  geo: {
    /**
     * Convert projected coordinates (easting/northing in the country's
     * primary SRID) to WGS84 lat/lon via the sidecar. Used by the MapView
     * to place the active project's real survey geometry on the basemap.
     * @param countryCode ISO 3166-1 alpha-2 (e.g. "KE")
     * @param points Array of { easting, northing } in the country CRS
     * @returns Same-length array of { lat, lon } in WGS84 decimal degrees
     */
    projectToWgs84: (
      countryCode: string,
      points: Array<{ easting: number; northing: number }>,
    ): Promise<Array<{ lat: number; lon: number }>> =>
      ipcRenderer.invoke("metardu:geo:projectToWgs84", countryCode, points),
  },
  /** Sync with metardu web (offline-first). The SyncClient lives in the
   *  main process; these handlers proxy to it. */
  sync: {
    login: (config: SyncConfig): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:sync:login", config),
    logout: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:sync:logout"),
    isLoggedIn: (): Promise<boolean> =>
      ipcRenderer.invoke("metardu:sync:isLoggedIn"),
    getConnection: (): Promise<{ serverUrl: string; email: string } | null> =>
      ipcRenderer.invoke("metardu:sync:getConnection"),
    getStatus: (): Promise<SyncStatus> =>
      ipcRenderer.invoke("metardu:sync:getStatus"),
    getConflicts: (): Promise<SyncConflict[]> =>
      ipcRenderer.invoke("metardu:sync:getConflicts"),
    fetchProjects: (): Promise<SyncProject[]> =>
      ipcRenderer.invoke("metardu:sync:fetchProjects"),
    uploadProject: (project: SyncProject): Promise<SyncProject> =>
      ipcRenderer.invoke("metardu:sync:uploadProject", project),
    deleteProject: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:sync:deleteProject", id),
    queueChange: (project: SyncProject, operation: "create" | "update" | "delete"): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:sync:queueChange", project, operation),
    /**
     * Queue an offline-first remote delete for a project id. Returns
     * `{ ok, queued, reason? }`:
     *   - queued true  → tombstone queued (reason "offline" = forced
     *     because the server couldn't be reached, will flush later)
     *   - queued false → nothing queued; reason "not-seen" (verified
     *     never-pushed) or "not-logged-in" (no client)
     * Called by ProjectsPanel after a local project delete.
     */
    queueDelete: (projectId: string): Promise<{ ok: boolean; queued: boolean; reason?: string }> =>
      ipcRenderer.invoke("metardu:sync:queueDelete", projectId),
    flushQueue: (): Promise<{ uploaded: number; deleted: number; failed: number; errors: string[] }> =>
      ipcRenderer.invoke("metardu:sync:flushQueue"),
    sync: (localProjects: SyncProject[]): Promise<{
      downloaded: number;
      uploaded: number;
      deleted: number;
      conflicts: SyncConflict[];
      errors: string[];
    }> => ipcRenderer.invoke("metardu:sync:sync", localProjects),
    resolveConflict: (projectId: string, choice: "local" | "remote"): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:sync:resolveConflict", projectId, choice),
    /** Subscribe to live sync status changes (status-bar badge). Returns unsubscribe. */
    onStatus: (callback: (status: SyncStatus) => void): (() => void) => {
      const listener = (_event: unknown, status: SyncStatus): void => callback(status);
      ipcRenderer.on("metardu:sync:status", listener);
      return () => ipcRenderer.off("metardu:sync:status", listener);
    },
  },
  /** Project store — persisted local projects shared by every view. */
  projects: {
    list: (): Promise<ProjectStoreState> =>
      ipcRenderer.invoke("metardu:projects:list"),
    create: (input: CreateProjectInput): Promise<StoredProject | null> =>
      ipcRenderer.invoke("metardu:projects:create", input),
    update: (input: UpdateProjectInput): Promise<StoredProject | null> =>
      ipcRenderer.invoke("metardu:projects:update", input),
    delete: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:projects:delete", id),
    setActive: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("metardu:projects:setActive", id),
    getActive: (): Promise<StoredProject | null> =>
      ipcRenderer.invoke("metardu:projects:getActive"),
    get: (id: string): Promise<StoredProject | null> =>
      ipcRenderer.invoke("metardu:projects:get", id),
    /** Subscribe to project store changes (toolbar + views stay live). Returns unsubscribe. */
    onChanged: (callback: (state: ProjectStoreState) => void): (() => void) => {
      const listener = (_event: unknown, state: ProjectStoreState): void => callback(state);
      ipcRenderer.on("metardu:projects:changed", listener);
      return () => ipcRenderer.off("metardu:projects:changed", listener);
    },
    /** Undo the last project mutation. */
    undo: (): Promise<UndoRedoResult> =>
      ipcRenderer.invoke("metardu:projects:undo"),
    /** Redo the last undone mutation. */
    redo: (): Promise<UndoRedoResult> =>
      ipcRenderer.invoke("metardu:projects:redo"),
    /** Check if undo is available. */
    canUndo: (): Promise<boolean> =>
      ipcRenderer.invoke("metardu:projects:canUndo"),
    /** Check if redo is available. */
    canRedo: (): Promise<boolean> =>
      ipcRenderer.invoke("metardu:projects:canRedo"),
    /** Get the current undo/redo state. */
    getUndoRedoState: (): Promise<{ canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null }> =>
      ipcRenderer.invoke("metardu:projects:undoRedoState"),
    /** Subscribe to undo/redo state changes. Returns unsubscribe. */
    onUndoRedoState: (callback: (state: { canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null }) => void): (() => void) => {
      const listener = (_event: unknown, state: unknown): void => callback(state as any);
      ipcRenderer.on("metardu:projects:undoRedoState", listener);
      return () => ipcRenderer.off("metardu:projects:undoRedoState", listener);
    },
  },
};

// Expose the API on window.metardu. The renderer imports it via
// `declare global { interface Window { metardu: typeof metarduApi } }`
// (see apps/desktop/src/renderer/preload.d.ts).
contextBridge.exposeInMainWorld("metardu", metarduApi);

export type MetarduApi = typeof metarduApi;
