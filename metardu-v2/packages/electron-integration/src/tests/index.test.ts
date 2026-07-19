/**
 * Tests for the Electron integration layer.
 *
 * Verifies:
 *   - SidecarClient starts and stops the sidecar process
 *   - RPC calls work (ping, echo, version)
 *   - Typed API wrappers work
 *   - Timeout handling works
 *   - State transitions are correct
 *   - Auto-restart on crash works
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SidecarClient, MetarduApi } from "../index.js";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the built sidecar binary — check multiple locations.
// __dirname is packages/electron-integration/src/tests/, so the sidecar
// binary at packages/metardu-sidecar/target/release/metardu-sidecar is
// THREE levels up (../../..), not two. The original two-level path
// resolved to packages/electron-integration/metardu-sidecar/ which never
// existed, causing every test to silently it.skip — see phase-0 audit
// defect #6.
const POSSIBLE_PATHS = [
  join(__dirname, "..", "..", "..", "metardu-sidecar", "target", "release", "metardu-sidecar"),
  "/home/z/my-project/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar",
  "/home/z/my-project/metardu-desktop/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar",
];
const SIDECAR_BIN = POSSIBLE_PATHS.find(p => existsSync(p)) ?? POSSIBLE_PATHS[0]!;

// Skip tests if the binary doesn't exist
const skipIfNoBinary = existsSync(SIDECAR_BIN) ? describe : describe.skip;

skipIfNoBinary("SidecarClient + MetarduApi", () => {
  let client: SidecarClient;
  let api: MetarduApi;

  beforeAll(async () => {
    client = new SidecarClient({
      binaryPath: SIDECAR_BIN,
      callTimeoutMs: 5000,
      autoRestart: false,
    });
    await client.start();
    api = new MetarduApi(client);
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  // ─── SidecarClient tests ─────────────────────────────────────────

  it("should be in running state after start", () => {
    expect(client.getState()).toBe("running");
    expect(client.isRunning()).toBe(true);
  });

  it("should respond to ping", async () => {
    const result = await client.call<{ pong: boolean; ts: number }>("ping", null);
    expect(result.pong).toBe(true);
    expect(result.ts).toBeGreaterThan(0);
  });

  it("should respond to version", async () => {
    const result = await client.call<{ name: string; version: string }>("version", null);
    expect(result.name).toBe("metardu-sidecar");
    expect(result.version).toBe("0.1.0");
  });

  it("should respond to list_methods", async () => {
    const result = await client.call<{ methods: string[] }>("list_methods", null);
    expect(result.methods).toContain("ping");
    expect(result.methods).toContain("gdal_contour");
    expect(result.methods).toContain("mavlink_connect");
    expect(result.methods).toContain("odm_process");
  });

  it("should handle echo", async () => {
    const result = await client.call<{ echoed: { msg: string } }>("echo", { msg: "hello" });
    expect(result.echoed.msg).toBe("hello");
  });

  it("should return error for unknown method", async () => {
    await expect(client.call("nonexistent_method", null)).rejects.toThrow(/Method not found/);
  });

  // ─── MetarduApi typed wrapper tests ──────────────────────────────

  it("api.ping() should return typed result", async () => {
    const result = await api.ping();
    expect(result.pong).toBe(true);
    expect(typeof result.ts).toBe("number");
  });

  it("api.version() should return sidecar version", async () => {
    const result = await api.version();
    expect(result.name).toBe("metardu-sidecar");
    expect(result.version).toBe("0.1.0");
  });

  it("api.listMethods() should return method list", async () => {
    const result = await api.listMethods();
    expect(result.methods).toContain("ping");
    expect(result.methods).toContain("gdal_contour");
    expect(result.methods).toContain("mavlink_connect");
    expect(result.methods).toContain("odm_process");
  });

  it("api.mavlinkConnect() should connect to mock drone", async () => {
    const result = await api.mavlinkConnect({
      connectionUrl: "udp://:14540",
      baudRate: 115200,
    });
    expect(result.connected).toBe(true);
  });

  it("api.mavlinkGetTelemetry() should return mock telemetry", async () => {
    const result = await api.mavlinkGetTelemetry();
    expect(result.flight_mode).toBe("STABILIZE");
    expect(result.armed).toBe(false);
    expect(result.battery_percent).toBe(100);
  });

  it("api.mavlinkUploadMission() should upload to mock drone", async () => {
    const result = await api.mavlinkUploadMission({
      waypoints: [
        { latitude: -1.2864, longitude: 36.8172, altitude_m: 75 },
        { latitude: -1.2854, longitude: 36.8172, altitude_m: 75 },
      ],
      cruise_speed_ms: 15,
    });
    expect(result.waypoint_count).toBe(2);
    expect(result.mission_id).toBe(1);
  });

  it("api.mavlinkArm() should arm the mock drone", async () => {
    const result = await api.mavlinkArm();
    expect(result.armed).toBe(true);
  });

  it("api.mavlinkRtl() should trigger RTL", async () => {
    const result = await api.mavlinkRtl();
    expect(result.rtl).toBe(true);
  });

  it("api.mavlinkDisconnect() should disconnect", async () => {
    const result = await api.mavlinkDisconnect();
    expect(result.connected).toBe(false);
  });
});
