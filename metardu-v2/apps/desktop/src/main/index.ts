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
import { fileURLToPath } from "node:url";
import { SidecarClient } from "@metardu/electron-integration";
import { findExporter, listExportFormats, importFieldDataAsync, signPdf, verifyPdf, importPrivateKeyBase64, generateForm3Pdf, type RinexEpochResult, type SurveyorIdentity, type DigitalSignature, type VerificationResult, type Form3Input } from "@metardu/engine-flight-planning";
import { getCountryConfig, crsLabelForCountry, type CountryCode, type TitleBlockLayout } from "@metardu/country-config";
import { registerSyncIpcHandlers } from "./sync.js";
import { registerProjectIpcHandlers } from "./projects.js";
import { registerInstrumentIpcHandlers } from "./instrument.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Sidecar binary resolution ────────────────────────────────────
// In development: the sidecar binary lives at
//   packages/metardu-sidecar/target/release/metardu-sidecar
// In production (packaged): the binary is copied into resources/ by
// electron-builder and we read it from process.resourcesPath.
function resolveSidecarBinary(): string {
  const possiblePaths: string[] = [];

  // Production: packaged app
  if (process.resourcesPath) {
    const platformExt = process.platform === "win32" ? ".exe" : "";
    possiblePaths.push(
      path.join(process.resourcesPath, "metardu-sidecar" + platformExt),
    );
  }

  // Development: walk up from apps/desktop/dist/main/ to find the repo root.
  // __dirname = apps/desktop/dist/main → 4 levels up = metardu-v2 root.
  const devRoot = path.resolve(__dirname, "..", "..", "..", "..");
  possiblePaths.push(
    path.join(devRoot, "packages", "metardu-sidecar", "target", "release", "metardu-sidecar"),
  );

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // If we get here, the sidecar binary is missing. This is a hard error —
  // the app cannot function without it. We return the first candidate path
  // anyway so the SidecarClient spawn will fail with a clear error message
  // rather than a silent null deref.
  console.error(
    "[main] WARNING: sidecar binary not found at any of:\n" +
      possiblePaths.map((p) => "  - " + p).join("\n") +
      "\n[main] Run `npm run build:sidecar` first.",
  );
  return possiblePaths[0]!;
}

// ─── Window state ─────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarClient | null = null;

function createWindow(): BrowserWindow {
  // Resolve the logo asset for the window icon. In dev the JPEG is at
  // apps/desktop/src/renderer/assets/metardu-logo.jpeg; in production
  // it's bundled into the renderer-build/ directory by Vite. We use the
  // brand JPEG directly — Electron accepts JPEG, PNG, or ICO for the
  // window icon on Linux/macOS. (Windows .ico conversion is handled by
  // electron-builder in Phase 7.)
  const logoPath = path.resolve(__dirname, "..", "..", "src", "renderer", "assets", "metardu-logo.jpeg");

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#1A1F36",  // METARDU navy — matches the logo background
    title: "MetaRDU Desktop",
    // Window icon — the MetaRDU logo. Falls back silently if the file
    // isn't found (e.g. in tests where __dirname resolves differently).
    icon: fs.existsSync(logoPath) ? logoPath : undefined,
    // Disable GPU compositing in CI/headless environments. Electron's GPU
    // process crashes hard when no display server is available, which can
    // mask real errors in the main process. The renderer is a 2D React UI
    // — no WebGL, no canvas-heavy work — so software rendering is fine.
    // On real desktops we still get hardware acceleration via SwiftShader
    // for any 2D canvas work; this flag only affects the GPU process.
    show: false,
    webPreferences: {
      // preload.ts is the ONLY bridge from renderer to main. It exposes a
      // curated, zod-validated API on `window.metardu` — no `require`, no
      // `process`, no `fs` ever reaches the renderer.
      // __dirname is apps/desktop/dist/main, preload builds to apps/desktop/dist/preload
      preload: path.join(__dirname, "..", "preload", "index.js"),
      // Security: never expose Node integration to the renderer. The
      // renderer must be a pure web environment; all privileged operations
      // go through the preload bridge.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Disable remote module — it has been a recurring security liability
      // in Electron apps and we have no use for it.
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };

  const win = new BrowserWindow(windowOptions);

  // In dev, load from the Vite dev server. In production, load the built
  // index.html. We detect dev via the METARDU_DEV env var (set by `npm run dev`).
  //
  // Path math:
  //   __dirname (after tsc build) = apps/desktop/dist/main
  //   Vite outputs the renderer to apps/desktop/renderer-build/ (see vite.config.ts)
  //   So from dist/main/ we walk up to apps/desktop/ then into renderer-build/.
  const isDev = process.env.METARDU_DEV === "1";
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.resolve(__dirname, "..", "..", "renderer-build", "index.html");
    win.loadFile(indexHtml);
  }

  return win;
}

// ─── Sidecar lifecycle ────────────────────────────────────────────
async function startSidecar(): Promise<SidecarClient> {
  const binaryPath = resolveSidecarBinary();
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
    // Sidecar logs are tracing output — forward to our stderr and to the
    // renderer's dev console for visibility.
    process.stderr.write(chunk);
  });

  client.on("error", (err: Error) => {
    console.error("[sidecar] error:", err.message);
  });

  await client.start();

  // Health check: refuse to declare ready if the sidecar can't ping back.
  // This catches the case where the binary exists but is broken (missing
  // shared libs, wrong arch, etc.).
  try {
    const pong = await client.call<{ pong: boolean; ts: number }>("ping", null);
    if (!pong.pong) {
      throw new Error("sidecar ping returned pong=false");
    }
    console.log(`[sidecar] healthy, version check…`);
    const ver = await client.call<{ name: string; version: string }>("version", null);
    console.log(`[sidecar] ${ver.name} v${ver.version}`);
  } catch (err) {
    await client.stop().catch(() => {});
    throw new Error(`Sidecar health check failed: ${(err as Error).message}`);
  }

  return client;
}

// ─── Projected → WGS84 dispatch (shared by export + map overlay) ──
// Per ADR-0005 invariant A1: the actual projection math lives in the
// sidecar (Rust). This builds the inverse-projection callback for a
// country's primary SRID by dispatching on the zone's projection method:
//   - Lambert Conformal Conic (US SPCS TX/CA/NY) → geodesy.lcc_inverse
//   - Transverse Mercator (ZA Lo belts, AU MGA, GB BNG, DE GK) →
//     geodesy.tm_inverse, or geodesy.utm_inverse for UTM-named zones
// Returns null when the zone is unsupported or the sidecar is offline.
function makeProjectToWgs84(
  countryCode: string,
): ((easting: number, northing: number) => Promise<{ lat: number; lon: number }>) | null {
  if (!sidecar || !sidecar.isRunning()) return null;
  const config = getCountryConfig(countryCode as CountryCode);
  const srid = config.geodeticFramework.primarySRID;
  const zone = config.geodeticFramework.projectionZones.find((z: { srid: number }) => z.srid === srid);
  if (!zone) return null;

  if (zone.method === "Lambert Conformal Conic") {
    if (zone.standard_parallel_1_deg === undefined || zone.standard_parallel_2_deg === undefined) {
      console.error(
        `[geo] LCC zone ${zone.srid} missing standard parallels — cannot reproject to WGS84`,
      );
      return null;
    }
    return async (easting: number, northing: number) => {
      return sidecar!.call<{ lat: number; lon: number }>(
        "geodesy.lcc_inverse",
        {
          easting,
          northing,
          standard_parallel_1_deg: zone.standard_parallel_1_deg,
          standard_parallel_2_deg: zone.standard_parallel_2_deg,
          latitude_of_origin_deg: zone.latitude_of_origin_deg,
          central_meridian_deg: zone.central_meridian_deg,
          false_easting_m: zone.false_easting_m,
          false_northing_m: zone.false_northing_m,
          ellipsoid: zone.ellipsoid,
        },
      );
    };
  }

  if (zone.method === "Transverse Mercator") {
    const zoneMatch = zone.name.match(/UTM zone (\d+)([NS])/i);
    if (zoneMatch) {
      const utmZone = parseInt(zoneMatch[1]!, 10);
      const isSouthern = zoneMatch[2]!.toUpperCase() === "S";
      return async (easting: number, northing: number) => {
        return sidecar!.call<{ lat: number; lon: number }>(
          "geodesy.utm_inverse",
          { easting, northing, zone: utmZone, is_southern: isSouthern, ellipsoid: zone.ellipsoid },
        );
      };
    }
    return async (easting: number, northing: number) => {
      return sidecar!.call<{ lat: number; lon: number }>(
        "geodesy.tm_inverse",
        {
          easting,
          northing,
          central_meridian_deg: zone.central_meridian_deg,
          latitude_of_origin_deg: zone.latitude_of_origin_deg,
          false_easting_m: zone.false_easting_m,
          false_northing_m: zone.false_northing_m,
          scale_factor: zone.scale_factor,
          ellipsoid: zone.ellipsoid,
        },
      );
    };
  }

  // Unsupported projection method (e.g. Cassini-Soldner legacy zones) —
  // no automatic WGS84 reprojection.
  console.warn(
    `[geo] zone ${zone.srid} uses unsupported method '${zone.method}' — WGS84 reprojection unavailable`,
  );
  return null;
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
      const toWgs84 = makeProjectToWgs84(options.countryCode as string);
      if (toWgs84) options.projectToWgs84 = toWgs84;
    }

    // Call the exporter.
    const result = await exporter.export(surveyOutput, options);

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
    countryCode: string,
    points: Array<{ easting: number; northing: number }>,
  ): Promise<Array<{ lat: number; lon: number }>> => {
    const toWgs84 = makeProjectToWgs84(countryCode);
    if (!toWgs84) {
      throw new Error(
        `WGS84 reprojection unavailable for country '${countryCode}' — ` +
        `sidecar offline or unsupported projection method.`,
      );
    }
    const results = await Promise.all(points.map((p) => toWgs84(p.easting, p.northing)));
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

  // ─── Instrument connection (live serial, BLE, NTRIP streaming) ───────────
  registerInstrumentIpcHandlers(() => mainWindow, () => sidecar);

  // ─── Sync with metardu web (vision: Access/Web field data syncs to Desktop) ─
  // The SyncClient singleton lives in main (it owns the network + queue).
  // Status is broadcast to the renderer so the AppShell badge stays live.
  registerSyncIpcHandlers(() => mainWindow);

  // ─── Project store (persisted local layer that sync reconciles) ──────────
  // Real project objects stored to userData/projects.json; every mutation
  // broadcasts so the shell toolbar + SurveyStateContext stay live.
  registerProjectIpcHandlers(() => mainWindow);
  }


// ─── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    sidecar = await startSidecar();
  } catch (err) {
    console.error("[main] FATAL: failed to start sidecar:", (err as Error).message);
    // Don't quit — let the UI show the error and offer to retry. The
    // renderer's status bar will display "sidecar: crashed" so the user
    // knows the compute layer is unavailable.
  }

  registerIpcHandlers();
  mainWindow = createWindow();
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
