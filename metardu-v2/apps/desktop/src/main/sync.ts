/**
 * MetaRDU Desktop — main-process sync bridge (metardu:sync:*).
 *
 * Holds the single SyncClient instance (the engine's offline-first sync
 * engine) and exposes it to the renderer over IPC. The renderer never
 * touches the network or the queue directly — it calls these handlers,
 * which own the SyncClient lifecycle:
 *
 *   Renderer (SyncPanel) ←→ ipcRenderer.invoke("metardu:sync:*") ←→ SyncClient ←→ metardu web REST API
 *
 * Status propagation: after every mutating call the current SyncStatus
 * is pushed to the renderer over the "metardu:sync:status" channel so
 * the AppShell status-bar badge stays live without polling.
 *
 * Vision alignment: this is the inflow half of the product thesis —
 * "data collected with Metardu Access / Metardu Web syncs automatically
 * to Metardu Desktop." Field projects created on the web app are pulled
 * here; local survey output is queued and pushed back.
 */

import { app, ipcMain, type BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SyncClient,
  type SyncConfig,
  type SyncProject,
  type SyncStatus,
  type SyncSnapshot,
} from "@metardu/engine-flight-planning";

let client: SyncClient | null = null;
let lastConnection: { serverUrl: string; email: string } | null = null;
let snapshotFile: string | null = null;

// Offline-first persistence: the queued changes (incl. tombstones) and
// remote-id knowledge are written to <userData>/sync-queue.json after
// every mutation, and restored when the SAME account logs back in. This
// is what makes "delete while offline, flush after restart" actually
// survive an app quit. The auth token is never persisted.
function getSnapshotFile(): string {
  if (!snapshotFile) snapshotFile = path.join(app.getPath("userData"), "sync-queue.json");
  return snapshotFile;
}

function loadSnapshot(): SyncSnapshot | null {
  try {
    if (!fs.existsSync(getSnapshotFile())) return null;
    const raw = JSON.parse(fs.readFileSync(getSnapshotFile(), "utf-8")) as SyncSnapshot;
    if (!raw || typeof raw.email !== "string" || !Array.isArray(raw.queue) || !Array.isArray(raw.remoteIds)) {
      return null;
    }
    return raw;
  } catch (err) {
    console.error("[sync] failed to load queued changes, starting fresh:", (err as Error).message);
    return null;
  }
}

function persistSnapshot(): void {
  if (!client) return;
  try {
    fs.writeFileSync(getSnapshotFile(), JSON.stringify(client.getSnapshot(), null, 2), "utf-8");
  } catch (err) {
    console.error("[sync] failed to persist queued changes:", (err as Error).message);
  }
}

function clearSnapshot(): void {
  try {
    if (fs.existsSync(getSnapshotFile())) fs.unlinkSync(getSnapshotFile());
  } catch (err) {
    console.error("[sync] failed to clear queued changes:", (err as Error).message);
  }
}

const IDLE_STATUS: SyncStatus = {
  state: "idle",
  pendingUploads: 0,
  pendingDownloads: 0,
  pendingDeletes: 0,
  conflicts: [],
};

function requireClient(): SyncClient {
  if (!client) throw new Error("Not logged in — call metardu:sync:login first");
  return client;
}

function currentStatus(): SyncStatus {
  return client ? client.getStatus() : IDLE_STATUS;
}

function broadcastStatus(getWindow: () => BrowserWindow | null): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("metardu:sync:status", currentStatus());
  }
}

/**
 * Register all metardu:sync:* IPC handlers. `getWindow` lets the module
 * push live status updates to the focused window without holding a
 * stale reference across window recreation (macOS activate, etc.).
 */
export function registerSyncIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("metardu:sync:login", async (_event, config: SyncConfig) => {
    client = new SyncClient(config);
    try {
      await client.login();
    } catch (err) {
      client = null;
      lastConnection = null;
      // Broadcast so the status-bar badge reflects the failed attempt
      // instead of showing a stale state from a previous session.
      broadcastStatus(getWindow);
      throw new Error(`Sync login failed: ${(err as Error).message}`);
    }
    // Restore offline-first state (queued changes + tombstones) from a
    // previous session — but only for the SAME account. restoreSnapshot
    // returns false on an email mismatch; discard the stale file rather
    // than flushing one user's changes to another user's server.
    const snapshot = loadSnapshot();
    if (snapshot && !client.restoreSnapshot(snapshot)) clearSnapshot();
    lastConnection = { serverUrl: config.serverUrl, email: config.email };
    broadcastStatus(getWindow);
    return { ok: true };
  });

  ipcMain.handle("metardu:sync:logout", () => {
    client?.logout();
    client = null;
    lastConnection = null;
    // Logging out must NOT carry the queue into the next account's
    // session — discard the persisted state.
    clearSnapshot();
    broadcastStatus(getWindow);
    return { ok: true };
  });

  ipcMain.handle("metardu:sync:isLoggedIn", () => (client?.isLoggedIn() ?? false));

  ipcMain.handle("metardu:sync:getConnection", () => lastConnection);

  ipcMain.handle("metardu:sync:getStatus", () => currentStatus());

  ipcMain.handle("metardu:sync:getConflicts", () => (client ? client.getConflicts() : []));

  ipcMain.handle("metardu:sync:fetchProjects", async () => {
    // Fetch replaces the remote-id knowledge — persist so tombstone
    // guards stay correct across restarts.
    const result = await requireClient().fetchProjects();
    persistSnapshot();
    return result;
  });

  ipcMain.handle("metardu:sync:uploadProject", async (_event, project: SyncProject) => {
    const result = await requireClient().uploadProject(project);
    persistSnapshot();
    broadcastStatus(getWindow);
    return result;
  });

  ipcMain.handle("metardu:sync:deleteProject", async (_event, id: string) => {
    await requireClient().deleteProject(id);
    persistSnapshot();
    broadcastStatus(getWindow);
    return { ok: true };
  });

  ipcMain.handle("metardu:sync:queueChange", (_event, project: SyncProject, operation: "create" | "update" | "delete") => {
    requireClient().queueChange(project, operation);
    persistSnapshot();
    broadcastStatus(getWindow);
    return { ok: true };
  });

  // Offline-first tombstone: called by ProjectsPanel after a local
  // project delete. Only queues a remote delete for projects the client
  // knows exist on the server — never-pushed projects are skipped
  // (queued: false), so flushQueue never spins on pointless requests
  // against a real backend.
  ipcMain.handle("metardu:sync:queueDelete", async (_event, projectId: string) => {
    if (!client) return { ok: true, queued: false, reason: "not-logged-in" }; // nothing to tombstone
    let queued = client.queueDelete(projectId);
    let reason: string | undefined;
    // Session-scope gap: remoteIds starts empty each login, so a project
    // synced in a PREVIOUS session isn't known yet. Best-effort fetch to
    // learn about it before deciding:
    //   - fetch succeeds and id appears   → queue (known remotely)
    //   - fetch succeeds, id absent       → verified never-pushed, skip
    //   - fetch throws (offline)          → can't verify, but offline-
    //     first means we queue anyway (force); the engine's idempotent
    //     404 delete makes a wrong guess harmless.
    if (!queued) {
      try {
        await client.fetchProjects();
        queued = client.queueDelete(projectId);
        if (!queued) reason = "not-seen";
      } catch {
        queued = client.queueDelete(projectId, true);
        reason = "offline";
      }
    }
    // Only persist when the queue actually changed (a no-op not-seen
    // refusal doesn't need a disk write).
    if (queued) persistSnapshot();
    broadcastStatus(getWindow);
    return { ok: true, queued, reason };
  });

  ipcMain.handle("metardu:sync:flushQueue", async () => {
    const result = await requireClient().flushQueue();
    persistSnapshot();
    broadcastStatus(getWindow);
    return result;
  });

  ipcMain.handle("metardu:sync:sync", async (_event, localProjects: SyncProject[]) => {
    const result = await requireClient().sync(localProjects);
    persistSnapshot();
    broadcastStatus(getWindow);
    return result;
  });

  ipcMain.handle("metardu:sync:resolveConflict", (_event, projectId: string, choice: "local" | "remote") => {
    requireClient().resolveConflict(projectId, choice);
    broadcastStatus(getWindow);
    return { ok: true };
  });
}
