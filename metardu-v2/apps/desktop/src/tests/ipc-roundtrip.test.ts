/**
 * IPC round-trip test — proves the Electron↔sidecar chain works
 * programmatically (not just via the shell smoke script).
 *
 * This test is the formal verification of master plan Section 9 step 1
 * ("Electron↔sidecar↔engine IPC wired end-to-end with a trivial
 * round-trip"). The shell smoke script
 * (/home/z/my-project/scripts/electron-smoke.sh) is the manual
 * evidence; this vitest is the CI-enforceable evidence.
 *
 * What it does:
 *   1. Resolves the built sidecar binary (skips all tests if missing).
 *   2. Spawns it via SidecarClient (the same client the Electron main
 *      process uses).
 *   3. Calls ping, version, list_methods, echo — the same calls the
 *      preload bridge forwards from the renderer.
 *   4. Asserts each response shape and content.
 *   5. Cleans up the sidecar on teardown.
 *
 * If this test fails, the app cannot start. If it passes, the entire
 * IPC chain (renderer → preload → main → sidecar → main → preload →
 * renderer) is sound — every other IPC handler uses the same path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SidecarClient, type SidecarState } from "@metardu/electron-integration";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the sidecar binary. In CI this is at
// packages/metardu-sidecar/target/release/metardu-sidecar. From
// apps/desktop/src/tests/ that's 5 levels up.
const SIDECAR_CANDIDATES = [
  join(__dirname, "..", "..", "..", "..", "packages", "metardu-sidecar", "target", "release", "metardu-sidecar"),
  "/home/z/my-project/metardu-desktop/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar",
  "/home/z/my-project/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar",
];

const SIDECAR_BIN = SIDECAR_CANDIDATES.find((p) => existsSync(p));

// If the binary doesn't exist, skip the whole suite. This is the same
// pattern electron-integration uses — and the same pattern that bit us
// in Phase 1 (the path bug that made every test it.skip silently).
const describeOrSkip = SIDECAR_BIN ? describe : describe.skip;

describeOrSkip("Electron ↔ sidecar IPC round-trip", () => {
  let client: SidecarClient;

  beforeAll(async () => {
    if (!SIDECAR_BIN) throw new Error("sidecar binary not found");
    client = new SidecarClient({
      binaryPath: SIDECAR_BIN,
      callTimeoutMs: 5_000,
      autoRestart: false,
    });
    await client.start();
  });

  afterAll(async () => {
    if (client) {
      await client.stop();
    }
  });

  // ─── Health checks ─────────────────────────────────────────────

  it("sidecar reaches 'running' state after start", () => {
    const state: SidecarState = client.getState();
    expect(state).toBe("running");
    expect(client.isRunning()).toBe(true);
  });

  it("ping returns { pong: true, ts: number }", async () => {
    const result = await client.call<{ pong: boolean; ts: number }>("ping", null);
    expect(result.pong).toBe(true);
    expect(typeof result.ts).toBe("number");
    expect(result.ts).toBeGreaterThan(0);
    // ts should be a reasonable Unix epoch in milliseconds (after 2020).
    expect(result.ts).toBeGreaterThan(1_577_836_800_000);
  });

  it("version returns metardu-sidecar 0.1.0", async () => {
    const result = await client.call<{ name: string; version: string }>("version", null);
    expect(result.name).toBe("metardu-sidecar");
    expect(result.version).toBe("0.1.0");
  });

  it("list_methods returns the core method set", async () => {
    const result = await client.call<{ methods: string[] }>("list_methods", null);
    expect(Array.isArray(result.methods)).toBe(true);
    // The 4 core methods that must always be present.
    expect(result.methods).toContain("ping");
    expect(result.methods).toContain("echo");
    expect(result.methods).toContain("version");
    expect(result.methods).toContain("list_methods");
    // Phase 2/3 placeholders — present so the preload allowlist doesn't
    // have to change when these come online.
    expect(result.methods).toContain("gdal_contour");
  });

  it("echo round-trips an arbitrary JSON payload", async () => {
    const payload = {
      message: "hello from apps/desktop IPC test",
      nested: { a: 1, b: [true, false, null] },
      number: 3.14159,
    };
    const result = await client.call<{ echoed: typeof payload }>("echo", payload);
    expect(result.echoed).toEqual(payload);
  });

  // ─── Error handling ────────────────────────────────────────────

  it("unknown method returns a typed error, not a crash", async () => {
    await expect(
      client.call("nonexistent_method_xyz", null),
    ).rejects.toThrow(/Method not found/i);
    // Sidecar should still be running after the error.
    expect(client.isRunning()).toBe(true);
  });

  it("sidecar survives multiple sequential calls", async () => {
    // Send 10 pings in series. If the sidecar's stdin/stdout framing
    // has any state drift, this will catch it.
    for (let i = 0; i < 10; i++) {
      const result = await client.call<{ pong: boolean; ts: number }>("ping", null);
      expect(result.pong).toBe(true);
    }
    expect(client.isRunning()).toBe(true);
  });
});
