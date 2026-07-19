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

import { app, BrowserWindow, ipcMain, BrowserWindowConstructorOptions } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SidecarClient } from "@metardu/electron-integration";

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
