/**
 * MetaRDU Desktop — Instrument connection IPC handlers.
 *
 * Handles live serial, Bluetooth LE, and NTRIP connections for
 * surveying instruments. The sidecar spawns background tasks for
 * each connection that push Notification structs through the broadcast
 * channel. This module forwards those notifications to the renderer
 * via IPC events.
 *
 * Architecture:
 *   Renderer → IPC → Main process → sidecar.call("instrument.connect") → sidecar starts stream
 *   Sidecar stream → Notification → stdout → Main process demux → IPC event → Renderer
 *
 * Security invariants (same as rest of preload bridge):
 *   - Renderer never touches serial ports, BLE, or network directly.
 *   - All instrument operations go through the main process.
 *   - The sidecar's method allowlist (preload) gates what the renderer can call.
 */

import { ipcMain, BrowserWindow } from "electron";
import type { SidecarClient } from "@metardu/electron-integration";

/**
 * Register instrument IPC handlers.
 *
 * @param getWindow - Callback to get the current BrowserWindow (may be null during startup).
 * @param getSidecar - Callback to get the current SidecarClient (may be null if sidecar failed to start).
 */
export function registerInstrumentIpcHandlers(
  getWindow: () => BrowserWindow | null,
  getSidecar?: () => SidecarClient | null,
): void {
  // ─── List serial ports ─────────────────────────────────────────────
  // The renderer calls this to populate the serial port dropdown.
  // Delegates to the sidecar's instrument.list_ports handler.
  ipcMain.handle("metardu:instrument:listPorts", async () => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      return { ports: [], error: "Sidecar not running" };
    }
    try {
      return await sidecar.call<{ ports: Array<{ port_name: string; display_name: string; is_usb: boolean; manufacturer?: string; product?: string }> }>(
        "instrument.list_ports",
        {},
      );
    } catch (err) {
      console.error("[instrument] list_ports failed:", (err as Error).message);
      return { ports: [], error: (err as Error).message };
    }
  });

  // ─── Scan BLE devices ──────────────────────────────────────────────
  // Starts a 3-second BLE scan and returns discovered devices.
  ipcMain.handle("metardu:instrument:listBleDevices", async () => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      return { devices: [], error: "Sidecar not running" };
    }
    try {
      return await sidecar.call<{ devices: Array<{ name: string; address: string; rssi: number; service_uuids: string[] }> }>(
        "instrument.list_ble_devices",
        {},
      );
    } catch (err) {
      console.error("[instrument] BLE scan failed:", (err as Error).message);
      return { devices: [], error: (err as Error).message };
    }
  });

  // ─── Connect to instrument ─────────────────────────────────────────
  // Opens a serial, BLE, or NTRIP connection and starts streaming.
  // Returns a connection_id that the renderer uses for status/disconnect.
  ipcMain.handle("metardu:instrument:connect", async (
    _event,
    params: {
      connection_type: "serial" | "bluetooth" | "ntrip";
      // Serial params
      port?: string;
      baud_rate?: number;
      protocol?: string;
      // BLE params
      device_name?: string;
      device_address?: string;
      service_uuid?: string;
      characteristic_uuid?: string;
      // NTRIP params
      caster_url?: string;
      mountpoint?: string;
      username?: string;
      password?: string;
      nmea_position?: string;
      // Common
      instrument_name?: string;
    },
  ) => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      throw new Error("Sidecar is not running");
    }

    const win = getWindow();
    try {
      const result = await sidecar.call<{ connection_id: string; status: string }>(
        "instrument.connect",
        params,
      );

      console.log(`[instrument] connected: ${result.connection_id} (${params.connection_type})`);

      // Notify the renderer about the new connection
      if (win && !win.isDestroyed()) {
        win.webContents.send("metardu:instrument:connected", {
          connection_id: result.connection_id,
          connection_type: params.connection_type,
          port: params.port ?? params.device_name ?? params.caster_url ?? "",
          instrument_name: params.instrument_name ?? "",
          status: result.status,
        });
      }

      return result;
    } catch (err) {
      console.error("[instrument] connect failed:", (err as Error).message);
      throw err;
    }
  });

  // ─── Disconnect from instrument ────────────────────────────────────
  ipcMain.handle("metardu:instrument:disconnect", async (_event, connectionId: string) => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      throw new Error("Sidecar is not running");
    }

    const win = getWindow();
    try {
      const result = await sidecar.call<{ disconnected: boolean; connection_id: string }>(
        "instrument.disconnect",
        { connection_id: connectionId },
      );

      if (win && !win.isDestroyed()) {
        win.webContents.send("metardu:instrument:disconnected", {
          connection_id: connectionId,
        });
      }

      return result;
    } catch (err) {
      console.error("[instrument] disconnect failed:", (err as Error).message);
      throw err;
    }
  });

  // ─── Get connection status ─────────────────────────────────────────
  ipcMain.handle("metardu:instrument:status", async () => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      return { connections: [], count: 0 };
    }
    try {
      return await sidecar.call<{ connections: Array<unknown>; count: number }>(
        "instrument.status",
        {},
      );
    } catch (err) {
      console.error("[instrument] status failed:", (err as Error).message);
      return { connections: [], count: 0, error: (err as Error).message };
    }
  });

  // ─── GNSS baseline covariance estimation ──────────────────────────
  ipcMain.handle("metardu:gnss:estimateBaselineCovariance", async (_event, params: Record<string, unknown>) => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      throw new Error("Sidecar is not running");
    }
    try {
      return await sidecar.call<unknown>(
        "gnss.estimate_baseline_covariance",
        params,
      );
    } catch (err) {
      console.error("[gnss] estimate_baseline_covariance failed:", (err as Error).message);
      throw err;
    }
  });

  ipcMain.handle("metardu:gnss:batchEstimateCovariance", async (_event, params: Record<string, unknown>) => {
    const sidecar = getSidecar?.();
    if (!sidecar?.isRunning()) {
      throw new Error("Sidecar is not running");
    }
    try {
      return await sidecar.call<unknown>(
        "gnss.batch_estimate_covariance",
        params,
      );
    } catch (err) {
      console.error("[gnss] batch_estimate_covariance failed:", (err as Error).message);
      throw err;
    }
  });

  // ─── Sidecar notification forwarding ───────────────────────────────
  // The sidecar pushes streaming notifications (instrument.observation)
  // through stdout. The SidecarClient demuxes these and emits them as
  // events. This handler forwards them to the renderer.
  //
  // The SidecarClient needs to be updated to emit "notification" events
  // alongside the existing "state" and "stderr" events. For now, we
  // set up the forwarding pattern that the SidecarClient will call.
  setupNotificationForwarding(getWindow);
}

/**
 * Set up forwarding of sidecar notifications to the renderer.
 *
 * The SidecarClient's main loop already demuxes responses from
 * notifications. When a notification arrives (has `method` field),
 * it emits a "notification" event. This handler listens for that
 * event and forwards it to the renderer via IPC.
 *
 * For the initial implementation, the SidecarClient polls the
 * instrument.status handler periodically and sends delta events
 * to the renderer. The notification-based streaming will be
 * wired when the SidecarClient is updated.
 */
function setupNotificationForwarding(getWindow: () => BrowserWindow | null): void {
  // Periodic status poll for instrument connections (every 2 seconds).
  // This is a fallback until the SidecarClient notification forwarding
  // is fully wired. The sidecar pushes notifications via stdout;
  // the main process forwards them to the renderer.
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  ipcMain.on("metardu:instrument:startPolling", () => {
    if (pollInterval) return; // Already polling

    pollInterval = setInterval(async () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
        return;
      }

      // Forward the status to the renderer
      try {
        const sidecar = (global as unknown as { __sidecar?: SidecarClient }).__sidecar;
        if (sidecar?.isRunning()) {
          const status = await sidecar.call<{ connections: Array<unknown>; count: number }>(
            "instrument.status",
            {},
          );
          win.webContents.send("metardu:instrument:statusUpdate", status);
        }
      } catch {
        // Sidecar may have restarted; ignore
      }
    }, 2000);
  });

  ipcMain.on("metardu:instrument:stopPolling", () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
}
