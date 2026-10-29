/**
 * MetaRDU Desktop — Electron main process entry point.
 *
 * Architecture (master plan Section 2):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Renderer (React UI — Vite-served in dev, file:// in prod)
 *   │     ↕  contextBridge (preload.ts — strict, zod-validated)
 *   │  Main process (THIS FILE)
 *   │     ↕  stdin/stdout length-prefixed JSON
 *   │  Rust sidecar (compute: adjustment, COGO, GDAL, imports)
 *   └─────────────────────────────────────────────────────────┘
 *
 * The main process is the ONLY path from the renderer to the filesystem,
 * network, or sidecar. The renderer never sees Node APIs directly — every
 * privileged operation goes through the preload bridge, which exposes only
 * zod-validated IPC channels.
 *
 * Hard invariants restated from docs/invariants.md:
 *   - Sidecar is the source of truth for all numerically sensitive work.
 *   - The engine (TypeScript) orchestrates but never reimplements geodesy.
 *   - The renderer has no `require`, no `process`, no `fs`. Only `window.metardu`.
 *   - Offline-first: no network call is required to start or use the app.
 */

import { app, BrowserWindow, ipcMain, dialog, BrowserWindowConstructorOptions } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SidecarClient } from "@metardu/electron-integration";
import { findExporter, listExportFormats, importFieldDataAsync, signPdf, verifyPdf, importPrivateKeyBase64, generateForm3Pdf, type RinexEpochResult, type SurveyorIdentity, type DigitalSignature, type VerificationResult, type Form3Input, generateForm4Pdf, generateLra27Pdf, generateBeaconCertificatePdf, generateAuPlanOfSurveyPdf, generateZaSgDiagramPdf, generateGbMeasuredSurveyReportPdf, generateDeGrenzfeststellungPdf, type Form4Input, type Lra27Input, type BeaconCertificateInput, type AuPlanOfSurveyInput, type ZaSgDiagramInput, type GbMeasuredSurveyReportInput, type DeGrenzfeststellungInput } from "@metardu/engine-flight-planning";
import { getCountryConfig, crsLabelForCountry, type CountryCode, type TitleBlockLayout } from "@metardu/country-config";
import { registerSyncIpcHandlers } from "./sync.js";
import { registerProjectIpcHandlers } from "./projects.js";
import { registerInstrumentIpcHandlers } from "./instrument.js";
import {
  createPointCloudInspection,
  createPointCloudSource,
  getActiveProjectId,
  getDatabase,
  getProject,
  listProjectPointCloudSources,
  type StoredPointCloudSource,
} from "./database.js";
import {
  pointCloudObjectPath,
  publishPointCloudObject,
  removeStagedPointCloudSource,
  stagePointCloudSource,
  verifyPointCloudObject,
} from "./point-cloud-store.js";
import type {
  PointCloudHeaderDetails,
  PointCloudImportResult,
  PointCloudProjectSourceList,
  PointCloudRecordInspection,
  PointCloudRecordInspectionJobStart,
  PointCloudRecordInspectionJobStatus,
  PointCloudSourceSummary,
  PointCloudSourceVerification,
} from "../shared/point-cloud.js";
import { makeProjectToWgs84 } from "./geodesy.js";
import {
  PLUGIN_RUN_INPUT_SCHEMA,
  POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
  type PluginRunInput,
} from "@metardu/ipc-schemas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

// ─── Sidecar binary resolution ────────────────────────────────────
// In development: the sidecar binary lives at
//   packages/metardu-sidecar/target/release/metardu-sidecar
// In production (packaged): the binary is copied into resources/ by
// electron-builder and we read it from process.resourcesPath.
function resolveSidecarBinary(): string | null {
  const possiblePaths: string[] = [];
  const platformExt = process.platform === "win32" ? ".exe" : "";

  // Production: packaged app
  if (process.resourcesPath) {
    possiblePaths.push(
      path.join(process.resourcesPath, "metardu-sidecar" + platformExt),
    );
  }

  // Development: walk up from apps/desktop/dist/main/ to find the repo root.
  const devRoot = path.resolve(__dirname, "..", "..", "..");
  possiblePaths.push(
    path.join(devRoot, "packages", "metardu-sidecar", "target", "release", "metardu-sidecar" + platformExt),
  );
  possiblePaths.push(
    path.join(devRoot, "packages", "metardu-sidecar", "target", "debug", "metardu-sidecar" + platformExt),
  );

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  console.warn(
    "[main] Sidecar binary not found. Running in standalone desktop mode.",
  );
  return null;
}

// ─── Window state ─────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarClient | null = null;

function pointCloudSourceSummary(
  source: StoredPointCloudSource,
  storageStatus: PointCloudSourceSummary["storageStatus"] = "notChecked",
  recordInspection?: PointCloudRecordInspection | null,
): PointCloudSourceSummary {
  const persistedInspection = source.latestRecordInspectionJson
    ? JSON.parse(source.latestRecordInspectionJson) as Omit<PointCloudRecordInspection, "id" | "sourceSha256" | "inspectedAt">
    : null;
  const latestRecordInspection = recordInspection === undefined
    ? persistedInspection && source.latestRecordInspectionId && source.latestRecordInspectionSha256
      && source.latestRecordInspectionReaderVersion && source.latestRecordInspectionAt
      ? {
          ...persistedInspection,
          id: source.latestRecordInspectionId,
          sourceSha256: source.latestRecordInspectionSha256,
          readerVersion: source.latestRecordInspectionReaderVersion,
          inspectedAt: source.latestRecordInspectionAt,
        }
      : null
    : recordInspection;
  return {
    id: source.id,
    fileName: path.basename(source.fileName),
    fileSizeBytes: source.fileSizeBytes,
    contentSha256: source.contentSha256,
    format: source.format,
    importedAt: source.importedAt,
    storageStatus,
    header: JSON.parse(source.headerJson) as PointCloudHeaderDetails,
    recordInspection: latestRecordInspection,
  };
}

const MAX_PLUGIN_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_PLUGIN_MODULES = 5;
const PLUGIN_MODULE_TTL_MS = 15 * 60 * 1000;
const MAX_POINT_CLOUD_INSPECTION_JOBS = 16;
const POINT_CLOUD_INSPECTION_JOB_TTL_MS = 30 * 60 * 1000;
interface SelectedPluginModule {
  bytes: Buffer;
  expiresAt: number;
}
const selectedPluginModules = new Map<string, SelectedPluginModule>();

type MainPointCloudInspectionJobState =
  | "running"
  | "cancelling"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "failed";

function isTerminalPointCloudInspectionJobState(state: MainPointCloudInspectionJobState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

interface MainPointCloudInspectionJob {
  id: string;
  sidecarJobId: string;
  projectId: string;
  sourceId: string;
  state: MainPointCloudInspectionJobState;
  decodedPointCount: string;
  declaredPointCount: string;
  createdAt: number;
  source?: PointCloudSourceSummary;
  message?: string;
}

const pointCloudInspectionJobs = new Map<string, MainPointCloudInspectionJob>();
let pointCloudInspectionStartInFlight = false;

function requirePointCloudSourceId(value: unknown): string {
  const parsed = POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud source identifier is invalid.");
  return parsed.data.toLowerCase();
}

function requirePointCloudInspectionJobId(value: unknown): string {
  const parsed = POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud inspection job identifier is invalid.");
  return parsed.data.toLowerCase();
}

function prunePointCloudInspectionJobs(now = Date.now()): void {
  for (const [id, job] of pointCloudInspectionJobs) {
    if (job.state !== "running" && job.state !== "cancelling" && job.state !== "finalizing"
      && now - job.createdAt >= POINT_CLOUD_INSPECTION_JOB_TTL_MS) {
      pointCloudInspectionJobs.delete(id);
    }
  }
  while (pointCloudInspectionJobs.size >= MAX_POINT_CLOUD_INSPECTION_JOBS) {
    const oldestTerminal = [...pointCloudInspectionJobs.values()]
      .filter((job) => job.state === "completed" || job.state === "cancelled" || job.state === "failed")
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (!oldestTerminal) return;
    pointCloudInspectionJobs.delete(oldestTerminal.id);
  }
}

function pointCloudInspectionJobStatus(job: MainPointCloudInspectionJob): PointCloudRecordInspectionJobStatus {
  if (job.state === "completed" && job.source) return { jobId: job.id, status: "completed", source: job.source };
  if (job.state === "cancelled") return { jobId: job.id, status: "cancelled" };
  if (job.state === "failed") {
    return {
      jobId: job.id,
      status: "failed",
      message: job.message ?? "Point-cloud inspection failed. No report was saved.",
    };
  }
  return {
    jobId: job.id,
    status: job.state === "cancelling" ? "cancelling" : "running",
    decodedPointCount: job.decodedPointCount,
    declaredPointCount: job.declaredPointCount,
  };
}

function monitorPointCloudCancellation(job: MainPointCloudInspectionJob): void {
  void (async () => {
    while (job.state === "cancelling") {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      if (job.state !== "cancelling") return;
      const activeSidecar = sidecar;
      if (!activeSidecar || !activeSidecar.isRunning()) {
        job.state = "failed";
        job.message = "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.";
        return;
      }
      try {
        const state = await activeSidecar.call<{ status: string }>(
          "pointcloud.record_inspection_status",
          { jobId: job.sidecarJobId },
        );
        if (job.state !== "cancelling") return;
        if (state.status === "cancelled" || state.status === "completed") {
          // Once cancellation was accepted, never publish a report even if a
          // worker reports completion at the same boundary.
          job.state = "cancelled";
          return;
        }
        if (state.status === "failed") {
          job.state = "failed";
          job.message = "Point-cloud inspection failed while stopping. No report was saved.";
          return;
        }
      } catch {
        job.state = "failed";
        job.message = "The point-cloud inspection status could not be recovered. No report was saved.";
        return;
      }
    }
  })();
}

function pruneSelectedPluginModules(now = Date.now()): void {
  for (const [token, module] of selectedPluginModules) {
    if (module.expiresAt <= now) selectedPluginModules.delete(token);
  }
}

function createWindow(): BrowserWindow {
  const logoPath = path.resolve(__dirname, "..", "..", "src", "renderer", "assets", "metardu-logo.jpeg");

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#1A1F36",  // METARDU navy — matches the logo background
    title: "MetaRDU Desktop",
    icon: fs.existsSync(logoPath) ? logoPath : undefined,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };

  const win = new BrowserWindow(windowOptions);

  const isDev = process.env.METARDU_DEV === "1";
  if (isDev) {
    const loadDev = async () => {
      try {
        await win.loadURL("http://localhost:5173");
      } catch {
        // If Vite is still spinning up, retry after 500ms
        setTimeout(loadDev, 500);
      }
    };
    loadDev();
  } else {
    const indexHtml = path.resolve(__dirname, "..", "..", "renderer-build", "index.html");
    win.loadFile(indexHtml);
  }

  return win;
}

// ─── Sidecar lifecycle ────────────────────────────────────────────
async function startSidecar(): Promise<SidecarClient | null> {
  const binaryPath = resolveSidecarBinary();
  if (!binaryPath) return null;

  const client = new SidecarClient({
    binaryPath,
    callTimeoutMs: 60_000,
    autoRestart: true,
    maxRestarts: 5,
  });

  client.on("state", (state: string) => {
    console.log(`[sidecar] state → ${state}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("metardu:sidecar:state", state);
    }
  });

  client.on("stderr", (chunk: string) => {
    process.stderr.write(chunk);
  });

  client.on("error", (err: Error) => {
    console.error("[sidecar] error:", err.message);
  });

  try {
    await client.start();
    const pong = await client.call<{ pong: boolean; ts: number }>("ping", null);
    if (!pong.pong) {
      throw new Error("sidecar ping returned pong=false");
    }
    console.log(`[sidecar] healthy, version check…`);
    const ver = await client.call<{ name: string; version: string }>("version", null);
    console.log(`[sidecar] ${ver.name} v${ver.version}`);
  } catch (err) {
    await client.stop().catch(() => {});
    console.warn(`[sidecar] Sidecar check failed: ${(err as Error).message}. Running in standalone mode.`);
    return null;
  }

  return client;
}

// ─── IPC handlers ─────────────────────────────────────────────────
// Every IPC handler is a thin wrapper around a sidecar RPC call. The
// preload bridge exposes these as `window.metardu.sidecar.call(method, params)`.
// All inputs are zod-validated in the preload layer before they reach here.

function registerIpcHandlers(): void {
  ipcMain.handle("metardu:sidecar:call", async (_event, method: string, params: unknown) => {
    if (!sidecar || !sidecar.isRunning()) {
      throw new Error("Sidecar is not running");
    }
    // The sidecar's own dispatcher validates params per method; we just
    // forward. The preload layer is responsible for zod-validating the
    // method name and params shape before they get here.
    return sidecar.call(method, params);
  });

  ipcMain.handle("metardu:sidecar:state", () => {
    return sidecar ? sidecar.getState() : "stopped";
  });

  ipcMain.handle("metardu:app:version", () => {
    return app.getVersion();
  });

  // Community tools can run only against JSON explicitly supplied in the
  // UI. The selected Wasm bytes stay in a bounded, expiring main-process
  // cache; no project path or file handle is forwarded to the extension.
  ipcMain.handle("metardu:plugins:pickModule", async () => {
    if (!mainWindow) throw new Error("Desktop window is not available");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select a community WebAssembly module",
      buttonLabel: "Select module",
      properties: ["openFile"],
      filters: [{ name: "WebAssembly modules", extensions: ["wasm"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    const filename = path.basename(result.filePaths[0]!);
    const file = await fs.promises.open(result.filePaths[0]!, "r");
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 8 || stat.size > MAX_PLUGIN_MODULE_BYTES) {
        throw new Error(`WebAssembly module must be a regular file between 8 bytes and ${MAX_PLUGIN_MODULE_BYTES} bytes.`);
      }
      const boundedRead = Buffer.allocUnsafe(MAX_PLUGIN_MODULE_BYTES + 1);
      let bytesReadTotal = 0;
      while (bytesReadTotal < boundedRead.length) {
        const { bytesRead } = await file.read(boundedRead, bytesReadTotal, boundedRead.length - bytesReadTotal, bytesReadTotal);
        if (bytesRead === 0) break;
        bytesReadTotal += bytesRead;
      }
      if (bytesReadTotal > MAX_PLUGIN_MODULE_BYTES) {
        throw new Error(`WebAssembly module exceeds the ${MAX_PLUGIN_MODULE_BYTES}-byte limit.`);
      }
      bytes = Buffer.from(boundedRead.subarray(0, bytesReadTotal));
    } finally {
      await file.close();
    }
    if (bytes.length < 8 || bytes.length > MAX_PLUGIN_MODULE_BYTES || bytes.subarray(0, 4).toString("hex") !== "0061736d") {
      throw new Error("Selected file is not a valid-sized WebAssembly module.");
    }

    pruneSelectedPluginModules();
    let evictedPreviousSelection = false;
    if (selectedPluginModules.size >= MAX_CACHED_PLUGIN_MODULES) {
      const oldest = [...selectedPluginModules.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) {
        selectedPluginModules.delete(oldest[0]);
        evictedPreviousSelection = true;
      }
    }

    const token = randomUUID();
    const expiresAt = Date.now() + PLUGIN_MODULE_TTL_MS;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    selectedPluginModules.set(token, { bytes, expiresAt });
    const expiryTimer = setTimeout(() => {
      const cached = selectedPluginModules.get(token);
      if (cached && cached.expiresAt <= Date.now()) selectedPluginModules.delete(token);
    }, PLUGIN_MODULE_TTL_MS);
    expiryTimer.unref();
    return { canceled: false, token, filename, sizeBytes: bytes.length, sha256, expiresAt, evictedPreviousSelection };
  });

  ipcMain.handle("metardu:plugins:run", async (_event, input: unknown) => {
    const parsed = PLUGIN_RUN_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid community plugin request: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    const request: PluginRunInput = parsed.data;
    pruneSelectedPluginModules();
    const selected = selectedPluginModules.get(request.moduleToken);
    if (!selected) throw new Error("Selected module is no longer available. Select it again and retry.");
    if (!sidecar || !sidecar.isRunning()) throw new Error("Rust sidecar is not running; plugin execution is unavailable.");

    return sidecar.call("plugin.run", {
      plugin_id: request.pluginId,
      plugin_version: request.version,
      module_base64: selected.bytes.toString("base64"),
      input: request.input,
    });
  });

  // ─── Integration & Export handlers (ADR-0005) ───────────────────
  // The renderer calls these to export survey data to files. The main
  // process owns the filesystem + "Save As" dialog + sidecar bridge.

  ipcMain.handle("metardu:export:list", () => {
    return listExportFormats();
  });

  ipcMain.handle("metardu:export:survey", async (_event, format: string, surveyOutput: unknown, options: Record<string, unknown>) => {
    const exporter = findExporter(format);

    // Wire the projectToWgs84 callback to the sidecar if outputWgs84 is
    // requested. Per ADR-0005 invariant A1: the projection math lives in
    // the sidecar (Rust) — this callback is the bridge, never in-engine
    // math. Shared with the map overlay via makeProjectToWgs84.
    if (options.outputWgs84) {
      const sourceSrid = typeof options.crsSrid === "number" ? options.crsSrid : undefined;
      const toWgs84 = makeProjectToWgs84(
        typeof options.countryCode === "string" ? options.countryCode : undefined,
        sidecar,
        sourceSrid,
      );
      if (!toWgs84) {
        throw new Error(
          `WGS84 export is unavailable for project CRS '${String(options.crsSrid ?? options.countryCode)}'. ` +
          "An explicit supported WGS84 CRS and a running Rust sidecar are required; export in the native CRS instead.",
        );
      }
      options.projectToWgs84 = toWgs84;
    }

    // Call the exporter.
    const result = await exporter.export(surveyOutput as any, options as any);

    // Show "Save As" dialog.
    const defaultName = `metardu-survey.${exporter.fileExtension}`;
    const saveResult = await dialog.showSaveDialog(mainWindow!, {
      title: `Export as ${exporter.format}`,
      defaultPath: defaultName,
      filters: [
        { name: exporter.format.toUpperCase(), extensions: [exporter.fileExtension] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { filePath: "", bytes: 0, warnings: ["Export cancelled by user."] };
    }

    // Write bytes to file.
    const buf = Buffer.from(result.bytes);
    fs.writeFileSync(saveResult.filePath, buf);

    console.log(`[export] wrote ${buf.length} bytes to ${saveResult.filePath}`);

    return {
      filePath: saveResult.filePath,
      bytes: buf.length,
      warnings: result.warnings,
    };
  });

  // ─── Instrument data import (Tier 1 #3) ────────────────────────────
  // The renderer calls these to import raw field data from surveying
  // instruments. The main process owns the filesystem + "Open File" dialog
  // and wires the sidecar bridge for RINEX epoch parsing.

  ipcMain.handle("metardu:import:pickAndRead", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import instrument data",
      properties: ["openFile"],
      filters: [
        { name: "Instrument files", extensions: ["gsi", "sdr", "dc", "job", "rinex", "obs", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filename: "", content: "" };
    }
    const filePath = result.filePaths[0]!;
    const content = fs.readFileSync(filePath, "utf-8");
    const filename = path.basename(filePath);
    return { canceled: false, filename, content };
  });

  ipcMain.handle("metardu:import:fieldData", async (_event, filename: string, content: string) => {
    // Wire the sidecar bridge for RINEX epoch parsing per ADR-0005 invariant A1
    // (heavy math in Rust). When the sidecar is unavailable, the engine
    // gracefully falls back to the TS RINEX header-only parse with a warning.
    const parseRinexEpochs = (sidecar && sidecar.isRunning())
      ? async (rinexContent: string) => {
          return sidecar!.call<RinexEpochResult>("import.rinex_epochs", { content: rinexContent });
        }
      : undefined;
    return importFieldDataAsync(filename, content, { parseRinexEpochs });
  });

  // The native picker and managed source store keep all absolute paths in main.
  // Only a typed, project-linked source summary crosses the preload bridge.
  ipcMain.handle("metardu:pointcloud:importToActiveProject", async (): Promise<PointCloudImportResult> => {
    const database = getDatabase();
    const activeProjectId = getActiveProjectId(database);
    const project = activeProjectId ? getProject(database, activeProjectId) : null;
    if (!project) throw new Error("Create or activate a survey project before importing a point cloud.");
    if (!sidecar || !sidecar.isRunning()) {
      throw new Error("Rust sidecar is not running; point-cloud header inspection is unavailable.");
    }
    if (!mainWindow) throw new Error("Desktop window is not available");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Import a LAS or LAZ source into ${project.name}`,
      buttonLabel: "Import source",
      properties: ["openFile"],
      filters: [{ name: "LAS / LAZ point clouds", extensions: ["las", "laz"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true as const };

    const staged = await stagePointCloudSource(result.filePaths[0]!, app.getPath("userData"));
    try {
      // Validate the managed staging copy, not the mutable original path. A malformed
      // source never becomes a project record or a published source object.
      const header = await sidecar.call<PointCloudHeaderDetails>("pointcloud.inspect_header", {
        path: staged.stagingPath,
      });
      const published = await publishPointCloudObject(staged, app.getPath("userData"));
      const stored = createPointCloudSource(database, {
        projectId: project.id,
        fileName: staged.fileName,
        storageKey: published.storageKey,
        contentSha256: staged.contentSha256,
        fileSizeBytes: staged.fileSizeBytes,
        sourceExtension: staged.sourceExtension,
        format: header.format,
        headerJson: JSON.stringify(header),
      });
      return {
        canceled: false,
        projectName: project.name,
        source: pointCloudSourceSummary(stored, "verified"),
      };
    } finally {
      await removeStagedPointCloudSource(staged.stagingPath).catch((error) => {
        console.warn("[point-cloud] Could not remove staging file:", (error as Error).message);
      });
    }
  });

  ipcMain.handle("metardu:pointcloud:listActiveProjectSources", (): PointCloudProjectSourceList => {
    const database = getDatabase();
    const projectId = getActiveProjectId(database);
    const project = projectId ? getProject(database, projectId) : null;
    if (!project) return { activeProjectName: null, sources: [] };
    return {
      activeProjectName: project.name,
      sources: listProjectPointCloudSources(database, project.id).map((source) => pointCloudSourceSummary(source)),
    };
  });

  ipcMain.handle("metardu:pointcloud:verifyActiveProjectSource", async (_event, sourceId: unknown): Promise<PointCloudSourceVerification> => {
    const validatedSourceId = requirePointCloudSourceId(sourceId);
    const database = getDatabase();
    const projectId = getActiveProjectId(database);
    const source = projectId
      ? listProjectPointCloudSources(database, projectId).find((candidate) => candidate.id === validatedSourceId)
      : undefined;
    if (!source) throw new Error("Point-cloud source is not attached to the active project.");

    const verification = await verifyPointCloudObject(
      app.getPath("userData"),
      source.storageKey,
      source.contentSha256,
      source.fileSizeBytes,
    );
    return {
      sourceId: validatedSourceId,
      status: verification.status,
      recordedSha256: source.contentSha256,
      actualSha256: verification.actualSha256,
      recordedSizeBytes: source.fileSizeBytes,
      actualSizeBytes: verification.actualSizeBytes,
    };
  });

  ipcMain.handle("metardu:pointcloud:startActiveProjectRecordInspection", async (_event, sourceId: unknown): Promise<PointCloudRecordInspectionJobStart> => {
    const validatedSourceId = requirePointCloudSourceId(sourceId);
    const database = getDatabase();
    const projectId = getActiveProjectId(database);
    const project = projectId ? getProject(database, projectId) : null;
    const source = projectId
      ? listProjectPointCloudSources(database, projectId).find((candidate) => candidate.id === validatedSourceId)
      : undefined;
    if (!project || !source) throw new Error("Point-cloud source is not attached to the active project.");
    if (!sidecar || !sidecar.isRunning()) {
      throw new Error("Rust sidecar is not running; point-record inspection is unavailable.");
    }

    prunePointCloudInspectionJobs();
    const hasActiveJob = [...pointCloudInspectionJobs.values()].some((job) =>
      job.state === "running" || job.state === "cancelling" || job.state === "finalizing");
    if (pointCloudInspectionStartInFlight || hasActiveJob) {
      throw new Error("A point-cloud record inspection is already running.");
    }

    pointCloudInspectionStartInFlight = true;
    try {
      const userDataPath = app.getPath("userData");
      const integrity = await verifyPointCloudObject(
        userDataPath,
        source.storageKey,
        source.contentSha256,
        source.fileSizeBytes,
      );
      if (integrity.status !== "verified") {
        throw new Error(`Point-record inspection stopped because the stored source is ${integrity.status}.`);
      }

      const sidecarStart = await sidecar.call<{ jobId: string }>("pointcloud.start_record_inspection", {
        path: pointCloudObjectPath(userDataPath, source.storageKey),
      });
      const sidecarJobId = requirePointCloudInspectionJobId(sidecarStart.jobId);
      if (getActiveProjectId(database) !== project.id) {
        await sidecar.call("pointcloud.cancel_record_inspection", { jobId: sidecarJobId }).catch(() => undefined);
        throw new Error("The active project changed before point-record inspection started.");
      }

      const job: MainPointCloudInspectionJob = {
        id: randomUUID(),
        sidecarJobId,
        projectId: project.id,
        sourceId: source.id,
        state: "running",
        decodedPointCount: "0",
        declaredPointCount: pointCloudSourceSummary(source).header.headerDeclaredPointCount,
        createdAt: Date.now(),
      };
      prunePointCloudInspectionJobs();
      pointCloudInspectionJobs.set(job.id, job);
      return { jobId: job.id, declaredPointCount: job.declaredPointCount };
    } finally {
      pointCloudInspectionStartInFlight = false;
    }
  });

  ipcMain.handle("metardu:pointcloud:activeProjectRecordInspectionStatus", async (_event, jobId: unknown): Promise<PointCloudRecordInspectionJobStatus> => {
    const validatedJobId = requirePointCloudInspectionJobId(jobId);
    const job = pointCloudInspectionJobs.get(validatedJobId);
    if (!job) throw new Error("Point-cloud inspection job is unknown or expired.");
    if (job.state === "completed" || job.state === "cancelled" || job.state === "failed") {
      return pointCloudInspectionJobStatus(job);
    }
    if (!sidecar || !sidecar.isRunning()) {
      job.state = "failed";
      job.message = "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.";
      return pointCloudInspectionJobStatus(job);
    }

    if (getActiveProjectId(getDatabase()) !== job.projectId && job.state === "running") {
      try {
        const cancellation = await sidecar.call<{ accepted: boolean }>("pointcloud.cancel_record_inspection", {
          jobId: job.sidecarJobId,
        });
        if (cancellation.accepted) {
          job.state = "cancelling";
          monitorPointCloudCancellation(job);
        }
      } catch {
        job.state = "failed";
        job.message = "The point-cloud inspection stopped after the active project changed. No report was saved.";
        return pointCloudInspectionJobStatus(job);
      }
    }

    let sidecarState: {
      status: string;
      decodedPointCount?: string;
      declaredPointCount?: string;
      report?: Omit<PointCloudRecordInspection, "id" | "sourceSha256" | "inspectedAt">;
      message?: string;
    };
    try {
      sidecarState = await sidecar.call("pointcloud.record_inspection_status", { jobId: job.sidecarJobId });
    } catch {
      job.state = "failed";
      job.message = "The point-cloud inspection status could not be recovered. No report was saved.";
      return pointCloudInspectionJobStatus(job);
    }
    if (job.state === "finalizing" || isTerminalPointCloudInspectionJobState(job.state)) {
      return pointCloudInspectionJobStatus(job);
    }
    if (job.state === "cancelling" && sidecarState.status !== "running" && sidecarState.status !== "cancelling") {
      job.state = sidecarState.status === "failed" ? "failed" : "cancelled";
      if (job.state === "failed") job.message = "Point-cloud inspection failed while stopping. No report was saved.";
      return pointCloudInspectionJobStatus(job);
    }

    if (sidecarState.status === "running" || sidecarState.status === "cancelling") {
      if (job.state !== "cancelling") job.state = sidecarState.status;
      if (typeof sidecarState.decodedPointCount === "string") job.decodedPointCount = sidecarState.decodedPointCount;
      if (typeof sidecarState.declaredPointCount === "string" && sidecarState.declaredPointCount !== "0") {
        job.declaredPointCount = sidecarState.declaredPointCount;
      }
      return pointCloudInspectionJobStatus(job);
    }
    if (sidecarState.status === "cancelled") {
      job.state = "cancelled";
      return pointCloudInspectionJobStatus(job);
    }
    if (sidecarState.status === "failed") {
      job.state = "failed";
      job.message = sidecarState.message ?? "Point-cloud inspection failed. No report was saved.";
      return pointCloudInspectionJobStatus(job);
    }
    if (sidecarState.status !== "completed" || !sidecarState.report) {
      job.state = "failed";
      job.message = "The point-cloud inspection returned an invalid job state. No report was saved.";
      return pointCloudInspectionJobStatus(job);
    }

    job.state = "finalizing";
    try {
      const database = getDatabase();
      if (getActiveProjectId(database) !== job.projectId || !getProject(database, job.projectId)) {
        throw new Error("The active project changed during point-record inspection.");
      }
      const source = listProjectPointCloudSources(database, job.projectId)
        .find((candidate) => candidate.id === job.sourceId);
      if (!source) throw new Error("The inspected source is no longer attached to its project.");
      const integrity = await verifyPointCloudObject(
        app.getPath("userData"),
        source.storageKey,
        source.contentSha256,
        source.fileSizeBytes,
      );
      if (integrity.status !== "verified") {
        throw new Error("The retained source digest no longer matches its project record.");
      }
      if (getActiveProjectId(database) !== job.projectId) {
        throw new Error("The active project changed while the retained source was being rechecked.");
      }
      if (typeof sidecarState.report.readerVersion !== "string"
        || typeof sidecarState.report.decodedPointCount !== "string") {
        throw new Error("The sidecar inspection report is incomplete.");
      }

      const storedInspection = createPointCloudInspection(database, {
        sourceId: source.id,
        sourceSha256: source.contentSha256,
        readerVersion: sidecarState.report.readerVersion,
        inspectionJson: JSON.stringify(sidecarState.report),
      });
      const refreshedSource = listProjectPointCloudSources(database, job.projectId)
        .find((candidate) => candidate.id === source.id);
      if (!refreshedSource) throw new Error("The inspected source is no longer attached to its project.");
      const recordInspection: PointCloudRecordInspection = {
        ...sidecarState.report,
        id: storedInspection.id,
        sourceSha256: storedInspection.sourceSha256,
        inspectedAt: storedInspection.inspectedAt,
      };
      job.source = pointCloudSourceSummary(refreshedSource, "verified", recordInspection);
      job.state = "completed";
    } catch (error) {
      job.state = "failed";
      job.message = `${error instanceof Error ? error.message : String(error)} No report was saved.`;
    }
    return pointCloudInspectionJobStatus(job);
  });

  ipcMain.handle("metardu:pointcloud:cancelActiveProjectRecordInspection", async (_event, jobId: unknown): Promise<{ accepted: boolean }> => {
    const validatedJobId = requirePointCloudInspectionJobId(jobId);
    const job = pointCloudInspectionJobs.get(validatedJobId);
    if (!job) throw new Error("Point-cloud inspection job is unknown or expired.");
    if (job.state === "cancelling") return { accepted: true };
    if (job.state !== "running") return { accepted: false };
    if (!sidecar || !sidecar.isRunning()) {
      job.state = "failed";
      job.message = "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.";
      return { accepted: false };
    }
    try {
      const result = await sidecar.call<{ accepted: boolean }>("pointcloud.cancel_record_inspection", {
        jobId: job.sidecarJobId,
      });
      if (result.accepted) {
        job.state = "cancelling";
        monitorPointCloudCancellation(job);
      }
      return { accepted: result.accepted };
    } catch {
      job.state = "failed";
      job.message = "The point-cloud inspection could not be cancelled because the sidecar is unavailable. No report was saved.";
      return { accepted: false };
    }
  });

  // ─── Digital signature + seal (Tier 1 #4) ─────────────────────────
  // Signing uses Web Crypto in the main process (never in the renderer
  // so the private key never enters the V8 sandbox of the renderer).
  // Per ADR-0005 invariant A1: no sidecar involvement for signing.

  ipcMain.handle("metardu:signing:sign", async (
    _event,
    pdfBytesBase64: string,
    privateKeyBase64: string,
    surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string },
  ): Promise<DigitalSignature> => {
    const pdfBytes = Uint8Array.from(atob(pdfBytesBase64), (c) => c.charCodeAt(0));
    const privateKey = await importPrivateKeyBase64(privateKeyBase64);
    const pubSpki = await crypto.subtle.exportKey("spki", privateKey);
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(pubSpki)));
    const identity: SurveyorIdentity = {
      name: surveyor.name,
      registrationNumber: surveyor.registrationNumber,
      professionalBody: surveyor.professionalBody,
      country: surveyor.country,
      publicKeyBase64,
      keyCreatedAt: new Date().toISOString(),
    };
    return signPdf(pdfBytes, privateKeyBase64, identity);
  });

  ipcMain.handle("metardu:signing:verify", async (
    _event,
    pkcs7Base64: string,
    pdfBytesBase64: string,
  ): Promise<VerificationResult> => {
    // Reconstruct the DigitalSignature from the pkcs7Base64 string.
    // In this tier (v0.2.0-alpha) pkcs7Base64 is the serialized DigitalSignature JSON.
    const signature: DigitalSignature = JSON.parse(atob(pkcs7Base64));
    const pdfBytes = Uint8Array.from(atob(pdfBytesBase64), (c) => c.charCodeAt(0));
    return verifyPdf(pdfBytes, signature);
  });

  // ─── Geo helpers (projected → WGS84 for map overlays) ────────────────
  // The MapView converts the active project's projected coordinates
  // (easting/northing in the country's primary SRID) to WGS84 lat/lon for
  // display on the OpenLayers basemap. Same sidecar dispatch as export.
  ipcMain.handle("metardu:geo:projectToWgs84", async (
    _event,
    countryCode: string | undefined,
    points: Array<{ easting: number; northing: number }>,
    sourceSrid?: number,
  ): Promise<Array<{ lat: number; lon: number }>> => {
    let resolvedSrid = sourceSrid;
    if (resolvedSrid === undefined && countryCode?.trim()) {
      try {
        resolvedSrid = getCountryConfig(countryCode.trim().toUpperCase() as CountryCode)
          .geodeticFramework.primarySRID;
      } catch {
        // Projects without a configured jurisdiction must provide an explicit CRS.
      }
    }
    if (typeof resolvedSrid !== "number" || !Number.isSafeInteger(resolvedSrid)) {
      throw new Error("Map reprojection requires an explicit project EPSG CRS or a configured jurisdiction profile.");
    }

    const toWgs84 = makeProjectToWgs84(countryCode, sidecar, resolvedSrid);
    if (!toWgs84) {
      throw new Error(
        `WGS84 map reprojection is unavailable for EPSG:${resolvedSrid}. ` +
        "A running Rust sidecar and a verified supported WGS84 coordinate operation are required.",
      );
    }
    const results = await Promise.all(points.map((p) => toWgs84(p.easting, p.northing, resolvedSrid)));
    return results.map((r) => ({ lat: r.lat, lon: r.lon }));
  });

  // ─── 300 DPI map export (survey plan → PNG via sharp) ───────────────
  // The renderer sends the active project's survey output; the main process
  // extracts the plan geometry, builds a point-sized SVG, rasterizes it at
  // 300 DPI with sharp, and (for exportPng) shows a Save-As dialog. The
  // renderer never touches sharp/fs — invariants preserved.
  // Full CRS name for the plan title strip / {{crs}} token — shared
  // datum-deduped source of truth (crsLabelForCountry in country-config),
  // so the US SPCS ZONE field never double-prints the datum. The try/catch
  // keeps unknown codes returning undefined (same contract as before).
  const resolveCrsLabel = (countryCode?: string): string | undefined => {
    if (!countryCode) return undefined;
    try {
      return crsLabelForCountry(countryCode as CountryCode);
    } catch {
      return undefined;
    }
  };

  // Per-country statutory plan-sheet profile (from the config's planSheet
  // field) — drives title-block text + footer disclaimer on the 300 DPI
  // plan sheets and the ExportPanel defaults.
  const resolvePlanSheet = (countryCode?: string): {
    titleBlockLabel: string | undefined;
    planTypeLabel: string | undefined;
    footerNote: string | undefined;
    titleBlockLayout: TitleBlockLayout | undefined;
  } => {
    if (!countryCode) return { titleBlockLabel: undefined, planTypeLabel: undefined, footerNote: undefined, titleBlockLayout: undefined };
    try {
      const ps = getCountryConfig(countryCode as CountryCode).planSheet;
      if (!ps) return { titleBlockLabel: undefined, planTypeLabel: undefined, footerNote: undefined, titleBlockLayout: undefined };
      return {
        titleBlockLabel: ps.titleBlockLabel,
        planTypeLabel: ps.planTypeLabel,
        footerNote: ps.footerNote,
        titleBlockLayout: ps.titleBlockLayout,
      };
    } catch {
      return { titleBlockLabel: undefined, planTypeLabel: undefined, footerNote: undefined, titleBlockLayout: undefined };
    }
  };

  ipcMain.handle("metardu:map:renderPng", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { renderSurveyMapPng } = await import("./map-export.js");
    const result = await renderSurveyMapPng({
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      ...resolvePlanSheet(input.countryCode),
    });
    return {
      pngBase64: Buffer.from(result.pngBytes).toString("base64"),
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      scaleDenominator: result.scaleDenominator,
      fitsSheet: result.fitsSheet,
      summary: result.summary,
    };
  });

  ipcMain.handle("metardu:map:exportPng", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { exportSurveyMapPng } = await import("./map-export.js");
    const result = await exportSurveyMapPng(mainWindow, {
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      ...resolvePlanSheet(input.countryCode),
    });
    if (!result) {
      return { canceled: true };
    }
    return {
      canceled: false,
      filePath: result.filePath,
      bytes: result.pngBytes.length,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      scaleDenominator: result.scaleDenominator,
      fitsSheet: result.fitsSheet,
      summary: result.summary,
    };
  });

  // ─── Single-page plan sheet PDF export (print grade, no report wrapper) ─
  // Renders the exact plan sheet (same SVG builder + 300 DPI rasterization
  // as exportPng) into a single-page PDF sized to the sheet, then shows a
  // Save-As dialog. Surveyors get the filing-grade plan without the
  // flight-plan report wrapper.
  ipcMain.handle("metardu:map:exportPdf", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { exportSurveyMapPdf } = await import("./map-export.js");
    const result = await exportSurveyMapPdf(mainWindow, {
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      ...resolvePlanSheet(input.countryCode),
    });
    if (!result) {
      return { canceled: true };
    }
    return {
      canceled: false,
      filePath: result.filePath,
      bytes: result.pdfBytes.length,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      scaleDenominator: result.scaleDenominator,
      fitsSheet: result.fitsSheet,
      summary: result.summary,
    };
  });

  // ─── Statutory survey report PDF (cover + survey-map page) ─────────
  // Renders the exact plan sheet (same SVG builder + 300 DPI rasterization
  // as exportPng, honouring the print-preview's sheet/orientation/scale
  // choices) and embeds it full-bleed as the survey-map page of a
  // statutory report (A4 cover + plan sheet), then shows a Save-As dialog.
  // The report's map page is therefore pixel-identical to the preview.
  ipcMain.handle("metardu:map:exportReport", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { exportStatutoryReport } = await import("./map-export.js");
    const result = await exportStatutoryReport(mainWindow, {
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      ...resolvePlanSheet(input.countryCode),
    });
    if (!result) {
      return { canceled: true };
    }
    return {
      canceled: false,
      filePath: result.filePath,
      bytes: result.pdfBytes.length,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      scaleDenominator: result.scaleDenominator,
      fitsSheet: result.fitsSheet,
      summary: result.summary,
    };
  });

  // ─── Auto-export on workflow completion (no dialog) ──────────────────
  // Fired by the renderer the moment a workflow run finishes. Writes the
  // statutory plan (single 300 DPI PNG, or a booklet for multi-parcel
  // outputs) into userData/auto-exports/<slug>-<stamp>/ — the country's
  // plan-sheet profile (title block, layout, footer) is resolved here
  // exactly as the dialog exporters use it, so the sheet is identical to
  // a manual export without requiring the ExportPanel visit.
  ipcMain.handle("metardu:map:autoExport", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { autoExportSurveyPlan } = await import("./map-export.js");
    const planSheet = resolvePlanSheet(input.countryCode);
    const countrySheet = (() => {
      if (!input.countryCode) return undefined;
      try {
        return getCountryConfig(input.countryCode as CountryCode).planSheet;
      } catch {
        return undefined;
      }
    })();
    return autoExportSurveyPlan({
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date ?? new Date().toISOString().split("T")[0],
      // Renderer may pass the project's remembered sheet choices; fall
      // back to the country's statutory defaults when absent.
      sheetSize: input.sheetSize ?? countrySheet?.defaultSheetSize,
      orientation: input.orientation ?? countrySheet?.defaultOrientation,
      scaleDenominator: input.scaleDenominator,
      ...planSheet,
    });
  });

  // ─── Batch parcel booklet export (multi-parcel projects) ────────────
  // Splits the output into one plan per parcel, rasterizes each at 300 DPI,
  // compiles a booklet PDF (cover/index + one plan page per parcel), and
  // writes the individual PNGs beside the PDF.
  ipcMain.handle("metardu:map:exportBooklet", async (
    _event,
    input: {
      surveyOutput: unknown;
      projectName: string;
      countryCode?: string;
      surveyorName?: string;
      date?: string;
      sheetSize?: string;
      orientation?: "landscape" | "portrait";
      scaleDenominator?: number;
    },
  ) => {
    const { exportParcelBooklet } = await import("./map-export.js");
    const result = await exportParcelBooklet(mainWindow, {
      surveyOutput: input.surveyOutput,
      projectName: input.projectName,
      coordinateSystemLabel: resolveCrsLabel(input.countryCode),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      ...resolvePlanSheet(input.countryCode),
    });
    if (!result) {
      return { canceled: true };
    }
    return {
      canceled: false,
      bookletPath: result.bookletPath,
      pageCount: result.pageCount,
      pngFiles: result.pngFiles,
      reportFiles: result.reportFiles,
    };
  });

  // ─── Multi-project scheme booklet (ProjectsPanel batch export) ───────
  // Every parcel of every selected project gets a 300 DPI plan sheet using
  // that project's own country plan-sheet profile; all sheets compile into
  // one booklet with a master index grouped by project.
  ipcMain.handle("metardu:map:exportProjectsBooklet", async (
    _event,
    input: {
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
    },
  ) => {
    const { exportProjectsBooklet } = await import("./map-export.js");
    const result = await exportProjectsBooklet(mainWindow, {
      projects: input.projects.map((p) => ({
        name: p.name,
        surveyOutput: p.surveyOutput,
        coordinateSystemLabel: resolveCrsLabel(p.countryCode),
        ...resolvePlanSheet(p.countryCode),
      })),
      surveyorName: input.surveyorName,
      date: input.date,
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
    });
    if (!result) {
      return { canceled: true };
    }
    return {
      canceled: false,
      bookletPath: result.bookletPath,
      pageCount: result.pageCount,
      pngFiles: result.pngFiles,
      reportFiles: result.reportFiles,
    };
  });

  // ─── Generate Form 3 PDF (for signing) ───────────────────────────────────────
  ipcMain.handle("metardu:form3:generate", async (
    _event,
    input: Form3Input,
  ): Promise<{ pdfBytesBase64: string }> => {
    const output = await generateForm3Pdf(input);
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(output.pdfBytes)));
    return { pdfBytesBase64: pdfBase64 };
  });

  // ─── Statutory DRAFT renderers (Tasks 7-8) ─────────────────────────────────
  // Each returns base64 PDF + DRAFT watermark flag + HK item count so the UI can
  // surface the verification status. All four non-Kenya renderers ship DRAFT
  // until their source specimens are filed (invariant B1).
  const toStatutoryResult = (out: { pdfBytes: Uint8Array; hasDraftWatermark: boolean; hkItemCount: number }) => ({
    pdfBytesBase64: btoa(String.fromCharCode(...new Uint8Array(out.pdfBytes))),
    hasDraftWatermark: out.hasDraftWatermark,
    hkItemCount: out.hkItemCount,
  });

  ipcMain.handle("metardu:form4:generate", async (_event, input: Form4Input) =>
    toStatutoryResult(await generateForm4Pdf(input)));
  ipcMain.handle("metardu:lra27:generate", async (_event, input: Lra27Input) =>
    toStatutoryResult(await generateLra27Pdf(input)));
  ipcMain.handle("metardu:beaconcert:generate", async (_event, input: BeaconCertificateInput) =>
    toStatutoryResult(await generateBeaconCertificatePdf(input)));
  ipcMain.handle("metardu:au:generate", async (_event, input: AuPlanOfSurveyInput) =>
    toStatutoryResult(await generateAuPlanOfSurveyPdf(input)));
  ipcMain.handle("metardu:za:generate", async (_event, input: ZaSgDiagramInput) =>
    toStatutoryResult(await generateZaSgDiagramPdf(input)));
  ipcMain.handle("metardu:gb:generate", async (_event, input: GbMeasuredSurveyReportInput) =>
    toStatutoryResult(await generateGbMeasuredSurveyReportPdf(input)));
  ipcMain.handle("metardu:de:generate", async (_event, input: DeGrenzfeststellungInput) =>
    toStatutoryResult(await generateDeGrenzfeststellungPdf(input)));

  // ─── Instrument connection (live serial, BLE, NTRIP streaming) ───────────
  console.log("[main] Registering instrument IPC...");
  registerInstrumentIpcHandlers(() => mainWindow, () => sidecar);

  // ─── Sync with metardu web (vision: Access/Web field data syncs to Desktop) ─
  console.log("[main] Registering sync IPC...");
  registerSyncIpcHandlers(() => mainWindow);

  // ─── Project store (persisted local layer that sync reconciles) ──────────
  console.log("[main] Registering project IPC...");
  registerProjectIpcHandlers(() => mainWindow);
  console.log("[main] All IPC handlers registered successfully");
}


// ─── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log("[main] Electron app is ready");
  try {
    sidecar = await startSidecar();
  } catch (err) {
    console.warn("[main] Sidecar not started:", (err as Error).message);
  }

  console.log("[main] Registering IPC handlers...");
  registerIpcHandlers();
  console.log("[main] Creating main window...");
  mainWindow = createWindow();
  console.log("[main] Main window initialized");
});

// macOS: re-create window when dock icon is clicked and no windows are open.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

// Clean shutdown: stop the sidecar before the app exits, otherwise the
// child process can be orphaned and hold file locks / sockets open.
app.on("window-all-closed", async () => {
  if (sidecar) {
    try {
      await sidecar.stop();
    } catch (err) {
      console.error("[main] sidecar stop failed:", (err as Error).message);
    }
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (sidecar && sidecar.isRunning()) {
    event.preventDefault();
    try {
      await sidecar.stop();
    } catch (err) {
      console.error("[main] sidecar stop failed on before-quit:", (err as Error).message);
    } finally {
      app.quit();
    }
  }
});
