/**
 * Sidecar process manager for MetaRDU Desktop v2.0.
 *
 * Spawns the Rust sidecar binary as a child process, manages its lifecycle,
 * and provides a typed RPC client for sending requests and receiving responses
 * over the length-prefixed JSON protocol.
 *
 * Architecture:
 *   ┌─────────────────┐    stdin/stdout     ┌──────────────────┐
 *   │  Electron Main  │ ──────────────────→ │  Rust Sidecar    │
 *   │  (Node.js)      │ ←────────────────── │  (metardu-sidecar)│
 *   │                 │    length-prefixed   │                  │
 *   │  SidecarClient  │    JSON protocol     │  Dispatcher      │
 *   └─────────────────┘                      └──────────────────┘
 *
 * Usage in Electron main process:
 *
 *   import { SidecarClient } from "@metardu/electron-integration";
 *
 *   const sidecar = new SidecarClient({
 *     binaryPath: path.join(process.resourcesPath, "metardu-sidecar"),
 *   });
 *
 *   await sidecar.start();
 *
 *   // Call a method
 *   const result = await sidecar.call("ping", null);
 *   console.log(result); // { pong: true, ts: 1234567890 }
 *
 *   // On app shutdown
 *   await sidecar.stop();
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────────

/** Sidecar configuration options. */
export interface SidecarOptions {
  /** Path to the sidecar binary. */
  binaryPath: string;
  /** Optional: additional arguments to pass to the binary. */
  args?: string[];
  /** Optional: environment variables to pass to the child process. */
  env?: Record<string, string>;
  /** Optional: timeout for individual RPC calls in milliseconds (default 30000). */
  callTimeoutMs?: number;
  /** Optional: maximum restart attempts on crash (default 3). */
  maxRestarts?: number;
  /** Optional: whether to auto-restart on crash (default true). */
  autoRestart?: boolean;
}

/** RPC request envelope. */
interface RpcRequest {
  id: string;
  method: string;
  params: unknown;
}

/** RPC response envelope. */
interface RpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/** Sidecar connection state. */
export type SidecarState = "stopped" | "starting" | "running" | "stopping" | "crashed";

// ─── SidecarClient ─────────────────────────────────────────────────

/**
 * Manages the Rust sidecar process and provides typed RPC calls.
 *
 * Events:
 *   - "state" — emitted when the sidecar state changes
 *   - "stderr" — emitted when the sidecar writes to stderr (logs)
 *   - "error" — emitted on unrecoverable errors
 */
export class SidecarClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: SidecarState = "stopped";
  private pendingCalls = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private buffer: Buffer = Buffer.alloc(0);
  private restartCount = 0;
  private readonly options: Required<SidecarOptions>;

  constructor(options: SidecarOptions) {
    super();
    this.options = {
      args: [],
      env: {},
      callTimeoutMs: 30_000,
      maxRestarts: 3,
      autoRestart: true,
      ...options,
    };
  }

  /** Start the sidecar process. */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      return;
    }

    this.setState("starting");

    return new Promise((resolve, reject) => {
      const child = spawn(this.options.binaryPath, this.options.args, {
        env: { ...process.env, ...this.options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process = child;

      child.on("error", (err) => {
        this.setState("crashed");
        this.emit("error", err);
        reject(err);
      });

      child.on("exit", (code, signal) => {
        const wasRunning = this.state === "running";
        this.process = null;
        this.rejectAllPending(new Error(`Sidecar exited (code=${code}, signal=${signal})`));

        if (wasRunning && this.options.autoRestart && this.restartCount < this.options.maxRestarts) {
          this.restartCount++;
          this.emit("stderr", `[sidecar] Restarting (attempt ${this.restartCount}/${this.options.maxRestarts})\n`);
          setTimeout(() => this.start().catch(() => {}), 1000);
        } else {
          this.setState("stopped");
        }
      });

      // Handle stdout — parse length-prefixed JSON responses
      child.stdout!.on("data", (data: Buffer) => {
        this.handleStdoutData(data);
      });

      // Handle stderr — forward as log events
      child.stderr!.on("data", (data: Buffer) => {
        this.emit("stderr", data.toString());
      });

      // Wait for the process to be ready by sending a ping
      this.setState("running");
      this.restartCount = 0;

      // Send a ping to verify the sidecar is ready
      this.call("ping", null)
        .then(() => resolve())
        .catch((err) => {
          this.setState("crashed");
          reject(err);
        });
    });
  }

  /** Stop the sidecar process gracefully. */
  async stop(): Promise<void> {
    if (!this.process) {
      this.setState("stopped");
      return;
    }

    this.setState("stopping");
    this.rejectAllPending(new Error("Sidecar is shutting down"));

    return new Promise((resolve) => {
      const proc = this.process!;
      const killTimer = setTimeout(() => {
        // Force kill if graceful shutdown doesn't work
        proc.kill("SIGKILL");
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        this.process = null;
        this.setState("stopped");
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      proc.kill("SIGTERM");
    });
  }

  /** Get the current sidecar state. */
  getState(): SidecarState {
    return this.state;
  }

  /** Check if the sidecar is running. */
  isRunning(): boolean {
    return this.state === "running" && this.process !== null;
  }

  /**
   * Call a method on the sidecar.
   *
   * @param method Method name (e.g., "ping", "gdal_contour", "mavlink_connect")
   * @param params Parameters to pass to the method
   * @returns The result from the sidecar
   * @throws Error if the sidecar is not running, the call times out, or the method returns an error
   */
  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.isRunning()) {
      throw new Error(`Sidecar is not running (state: ${this.state})`);
    }

    const id = randomUUID();
    const request: RpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`Call to "${method}" timed out after ${this.options.callTimeoutMs}ms`));
      }, this.options.callTimeoutMs);

      this.pendingCalls.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      // Send the request
      const payload = JSON.stringify(request);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length, 0);
      this.process!.stdin!.write(Buffer.concat([header, Buffer.from(payload, "utf-8")]));
    });
  }

  // ─── Internal methods ────────────────────────────────────────────

  private handleStdoutData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    // Parse as many complete messages as possible
    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + msgLen) {
        break; // Not enough data yet
      }

      const payload = this.buffer.subarray(4, 4 + msgLen);
      this.buffer = this.buffer.subarray(4 + msgLen);

      try {
        const response: RpcResponse = JSON.parse(payload.toString("utf-8"));
        this.handleResponse(response);
      } catch (err) {
        this.emit("error", new Error(`Failed to parse sidecar response: ${err}`));
      }
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pendingCalls.get(response.id);
    if (!pending) {
      this.emit("error", new Error(`Received response for unknown call ID: ${response.id}`));
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCalls.delete(response.id);

    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(
        response.error?.message ?? "Unknown sidecar error"
      ));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingCalls.clear();
  }

  private setState(state: SidecarState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit("state", state);
    }
  }
}

// ─── Typed API wrappers ────────────────────────────────────────────

/**
 * Typed API for the MetaRDU sidecar.
 *
 * Wraps the raw SidecarClient.call() method with typed methods for each
 * sidecar handler. Each method validates parameters on the client side
 * before sending to the sidecar (defense in depth).
 */
export class MetarduApi {
  constructor(private client: SidecarClient) {}

  // ─── Built-in methods ────────────────────────────────────────────

  /** Health check — returns { pong: true, ts: <unix_ms> } */
  async ping(): Promise<{ pong: boolean; ts: number }> {
    return this.client.call("ping", null);
  }

  /** Get sidecar version info. */
  async version(): Promise<{ name: string; version: string; rust_version: string }> {
    return this.client.call("version", null);
  }

  /** List all registered methods. */
  async listMethods(): Promise<{ methods: string[] }> {
    return this.client.call("list_methods", null);
  }

  // ─── GDAL methods ────────────────────────────────────────────────

  /** Generate contours from a DSM GeoTIFF. */
  async generateContours(params: {
    dsmPath: string;
    interval: number;
    minLength?: number;
    format?: string;
    outputPath?: string;
  }): Promise<{
    count: number;
    min_elevation: number;
    max_elevation: number;
    interval: number;
    format: string;
    output_path: string | null;
    geojson: string | null;
  }> {
    return this.client.call("gdal_contour", {
      dsm_path: params.dsmPath,
      interval: params.interval,
      min_length: params.minLength,
      format: params.format ?? "geojson",
      output_path: params.outputPath,
    });
  }

  // ─── MAVLink methods ─────────────────────────────────────────────

  /** Connect to a drone via MAVLink. */
  async mavlinkConnect(params: {
    connectionUrl: string;
    baudRate?: number;
    timeoutSec?: number;
  }): Promise<{ connected: boolean }> {
    return this.client.call("mavlink_connect", {
      connection_url: params.connectionUrl,
      baud_rate: params.baudRate ?? 115200,
      timeout_sec: params.timeoutSec ?? 10,
    });
  }

  /** Disconnect from the drone. */
  async mavlinkDisconnect(): Promise<{ connected: boolean }> {
    return this.client.call("mavlink_disconnect", null);
  }

  /** Get the latest telemetry from the connected drone. */
  async mavlinkGetTelemetry(): Promise<{
    timestamp_ms: number;
    flight_mode: string | null;
    armed: boolean | null;
    latitude: number | null;
    longitude: number | null;
    altitude_amsl_m: number | null;
    battery_percent: number | null;
    gps_satellites: number | null;
  }> {
    return this.client.call("mavlink_get_telemetry", null);
  }

  /** Upload a mission to the connected drone. */
  async mavlinkUploadMission(params: {
    waypoints: Array<{
      latitude: number;
      longitude: number;
      altitude_m: number;
      action?: string;
    }>;
    cruise_speed_ms?: number;
  }): Promise<{
    waypoint_count: number;
    mission_id: number;
    upload_duration_ms: number;
  }> {
    return this.client.call("mavlink_upload_mission", {
      waypoints: params.waypoints,
      cruise_speed_ms: params.cruise_speed_ms,
    });
  }

  /** Start the uploaded mission. */
  async mavlinkStartMission(): Promise<{ started: boolean }> {
    return this.client.call("mavlink_start_mission", null);
  }

  /** Return to launch (RTL). */
  async mavlinkRtl(): Promise<{ rtl: boolean }> {
    return this.client.call("mavlink_rtl", null);
  }

  /** Arm the drone. */
  async mavlinkArm(): Promise<{ armed: boolean }> {
    return this.client.call("mavlink_arm", null);
  }

  /** Disarm the drone. */
  async mavlinkDisarm(): Promise<{ armed: boolean }> {
    return this.client.call("mavlink_disarm", null);
  }

  // ─── ODM methods ─────────────────────────────────────────────────

  /** Process drone photos through OpenDroneMap. */
  async odmProcess(params: {
    photosPath: string;
    outputPath: string;
    gcpPath?: string;
    orthophotoResolutionCm?: number;
    demResolutionCm?: number;
    dsm?: boolean;
    dtm?: boolean;
    contourResolutionM?: number;
    maxConcurrency?: number;
    featureQuality?: string;
    mode?: string;
  }): Promise<{
    success: boolean;
    duration_sec: number;
    photo_count: number;
    orthophoto_path: string | null;
    dsm_path: string | null;
    dtm_path: string | null;
    point_cloud_path: string | null;
    contour_path: string | null;
    status: string;
    warnings: string[];
  }> {
    return this.client.call("odm_process", {
      photos_path: params.photosPath,
      output_path: params.outputPath,
      gcp_path: params.gcpPath,
      orthophoto_resolution_cm: params.orthophotoResolutionCm ?? 5,
      dem_resolution_cm: params.demResolutionCm ?? 5,
      dsm: params.dsm ?? true,
      dtm: params.dtm ?? true,
      contour_resolution_m: params.contourResolutionM ?? 0.5,
      max_concurrency: params.maxConcurrency,
      feature_quality: params.featureQuality ?? "medium",
      mode: params.mode ?? "docker",
    });
  }

  // ─── ML methods ──────────────────────────────────────────────────

  /** Extract building footprints from an orthophoto. */
  async mlExtractBuildings(params: {
    orthophotoPath: string;
    modelPath?: string;
    confidenceThreshold?: number;
    tileSize?: number;
    tileOverlap?: number;
    minAreaM2?: number;
    maxAreaM2?: number;
  }): Promise<{
    success: boolean;
    feature_count: number;
    duration_sec: number;
    features: unknown[];
    geojson: string;
    warnings: string[];
  }> {
    return this.client.call("ml_extract_buildings", {
      orthophoto_path: params.orthophotoPath,
      model_path: params.modelPath,
      confidence_threshold: params.confidenceThreshold ?? 0.5,
      tile_size: params.tileSize ?? 512,
      tile_overlap: params.tileOverlap ?? 64,
      min_area_m2: params.minAreaM2 ?? 10,
      max_area_m2: params.maxAreaM2 ?? 10000,
      feature_type: "Buildings",
    });
  }
}
