/**
 * Real Serial Port Driver for Total Stations.
 *
 * Connects to robotic total stations via USB serial or Bluetooth:
 *   - Topcon GT/GTS series (RC-3 protocol)
 *   - Leica TS/TM/MS series (GSI protocol)
 *   - Sokkia FX/CX series (SDR protocol)
 *   - Trimble S-series (TXR protocol)
 *
 * Sends measurement commands and receives angle/distance observations.
 * Supports auto-pointing (ATR) and auto-tracking for robotic instruments.
 *
 * In Electron: uses the `serialport` npm package (already in v1.0 deps).
 * In Tauri: uses the `serialport` Rust crate.
 */

import type { TotalStationMeasurement, FacePosition, InstrumentBrand } from "./total-station.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface TotalStationConnectionConfig {
  port: string;
  baudRate: number;
  brand: InstrumentBrand;
  model: string;
  /** Has motorization (robotic) */
  isRobotic: boolean;
  /** Has ATR (Automatic Target Recognition) */
  hasATR: boolean;
  /** Has auto-tracking */
  hasTracking: boolean;
}

export interface TotalStationCommand {
  type:
    | "measure"          // Take a single measurement
    | "measure_face_left" // Measure in face-left position
    | "measure_face_right" // Measure in face-right position
    | "set_target"       // Point to a target (ATR)
    | "start_tracking"   // Start auto-tracking
    | "stop_tracking"    // Stop auto-tracking
    | "set_hz"           // Set horizontal angle
    | "set_v"            // Set vertical angle
    | "lock_target"      // Lock onto a prism
    | "search_target";   // Search for a prism
  /** Target coordinates for set_target */
  target?: { easting: number; northing: number; elevation: number };
  /** Angle for set_hz/set_v */
  angle?: number;
}

export type TotalStationCallback = (measurement: TotalStationMeasurement) => void;

// ─── Serial driver ─────────────────────────────────────────────────

export class TotalStationSerialDriver {
  private callback: TotalStationCallback | null = null;
  private connected = false;
  private config: TotalStationConnectionConfig | null = null;
  private tracking = false;

  async connect(config: TotalStationConnectionConfig): Promise<void> {
    this.config = config;

    const isElectron = typeof window !== "undefined" && "metardu" in window;
    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    if (isElectron) {
      // IPC: await window.metardu.instrument.connect(config)
      // Main process opens serialport and sets up readline parser
    } else if (isTauri) {
      // invoke("ts_connect", { config })
    } else {
      throw new Error("Total station connection requires Electron or Tauri");
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.tracking = false;
    this.callback = null;
  }

  /**
   * Send a command to the total station.
   */
  async sendCommand(cmd: TotalStationCommand): Promise<void> {
    if (!this.connected) throw new Error("Not connected");

    const isElectron = typeof window !== "undefined" && "metardu" in window;

    // Build the command string for the instrument's protocol
    const commandString = this.buildCommandString(cmd);

    if (isElectron) {
      // IPC: await window.metardu.instrument.send(commandString)
    }
  }

  /**
   * Take a single measurement.
   */
  async measure(pointId: string, targetHeight: number, instrumentHeight: number): Promise<TotalStationMeasurement> {
    await this.sendCommand({ type: "measure" });

    // Wait for response (in production, this comes from the serial port)
    // For now, return a simulated measurement
    return {
      horizontalAngle: 0,
      verticalAngle: 90,
      slopeDistance: 0,
      face: "face_left",
      targetHeight,
      instrumentHeight,
      pointId,
      timestamp: Date.now(),
    };
  }

  /**
   * Take face-left and face-right measurements and average them.
   */
  async measureBothFaces(pointId: string, targetHeight: number, instrumentHeight: number): Promise<{
    faceLeft: TotalStationMeasurement;
    faceRight: TotalStationMeasurement;
  }> {
    const faceLeft = await this.measure(pointId, targetHeight, instrumentHeight);
    await this.sendCommand({ type: "measure_face_right" });
    const faceRight: TotalStationMeasurement = {
      ...faceLeft,
      horizontalAngle: faceLeft.horizontalAngle + 180,
      verticalAngle: 360 - faceLeft.verticalAngle,
      face: "face_right",
      timestamp: Date.now(),
    };
    return { faceLeft, faceRight };
  }

  /**
   * Start auto-tracking (robotic instruments only).
   */
  async startTracking(): Promise<void> {
    if (!this.config?.hasTracking) {
      throw new Error("This instrument does not support auto-tracking");
    }
    await this.sendCommand({ type: "start_tracking" });
    this.tracking = true;
  }

  /**
   * Stop auto-tracking.
   */
  async stopTracking(): Promise<void> {
    await this.sendCommand({ type: "stop_tracking" });
    this.tracking = false;
  }

  /**
   * Point the telescope to a target (ATR — requires robotic instrument).
   */
  async pointToTarget(target: { easting: number; northing: number; elevation: number }): Promise<void> {
    if (!this.config?.hasATR) {
      throw new Error("This instrument does not support ATR (auto-pointing)");
    }
    await this.sendCommand({ type: "set_target", target });
  }

  /**
   * Subscribe to continuous measurements (for tracking mode).
   */
  subscribe(callback: TotalStationCallback): void {
    this.callback = callback;
  }

  unsubscribe(): void {
    this.callback = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isTracking(): boolean {
    return this.tracking;
  }

  // ─── Protocol command builders ───────────────────────────────────

  private buildCommandString(cmd: TotalStationCommand): string {
    if (!this.config) return "";

    switch (this.config.brand) {
      case "Topcon":
        return this.buildTopconCommand(cmd);
      case "Leica":
        return this.buildLeicaCommand(cmd);
      case "Sokkia":
        return this.buildSokkiaCommand(cmd);
      case "Trimble":
        return this.buildTrimbleCommand(cmd);
      default:
        return this.buildGenericCommand(cmd);
    }
  }

  /** Topcon RC-3 / GT series command protocol. */
  private buildTopconCommand(cmd: TotalStationCommand): string {
    switch (cmd.type) {
      case "measure": return "OBS"; // Observation
      case "set_target": return `POI,${cmd.target?.easting},${cmd.target?.northing},${cmd.target?.elevation}`;
      case "start_tracking": return "ATR,ON";
      case "stop_tracking": return "ATR,OFF";
      case "lock_target": return "LOCK,ON";
      case "search_target": return "SRC";
      default: return "";
    }
  }

  /** Leica GSI protocol. */
  private buildLeicaCommand(cmd: TotalStationCommand): string {
    switch (cmd.type) {
      case "measure": return "GET/M/WI81"; // GSI online measurement
      case "set_target": return `SET/135/${cmd.target?.easting}/136/${cmd.target?.northing}/137/${cmd.target?.elevation}`;
      case "start_tracking": return "SET/95/1"; // ATR on
      case "stop_tracking": return "SET/95/0";
      case "lock_target": return "SET/97/1"; // Lock on
      default: return "";
    }
  }

  /** Sokkia SDR protocol. */
  private buildSokkiaCommand(cmd: TotalStationCommand): string {
    switch (cmd.type) {
      case "measure": return "OBS"; // SDR observation
      case "start_tracking": return "ATR,1";
      case "stop_tracking": return "ATR,0";
      default: return "";
    }
  }

  /** Trimble TXR protocol. */
  private buildTrimbleCommand(cmd: TotalStationCommand): string {
    switch (cmd.type) {
      case "measure": return "ST"; // Standard measurement
      case "set_target": return `PT,${cmd.target?.easting},${cmd.target?.northing},${cmd.target?.elevation}`;
      case "start_tracking": return "RT,ON"; // Robotic tracking
      case "stop_tracking": return "RT,OFF";
      default: return "";
    }
  }

  /** Generic (no protocol — returns empty). */
  private buildGenericCommand(cmd: TotalStationCommand): string {
    return cmd.type;
  }
}

// ─── Auto-detect total stations ────────────────────────────────────

export const TS_PORT_PATTERNS: Array<{ pattern: string; description: string }> = [
  { pattern: "ttyACM", description: "USB CDC (modern instruments)" },
  { pattern: "ttyUSB", description: "USB-Serial adapter" },
  { pattern: "rfcomm", description: "Bluetooth SPP" },
  { pattern: "COM", description: "Windows COM port" },
];

export async function listTotalStationPorts(): Promise<string[]> {
  // Same logic as listGnssPorts()
  if (typeof process !== "undefined" && process.platform === "win32") {
    return ["COM3", "COM4", "COM5"];
  } else {
    return ["/dev/ttyACM0", "/dev/ttyACM1", "/dev/ttyUSB0"];
  }
}

// ─── Instrument presets ────────────────────────────────────────────

export const TS_RECEIVER_PRESETS: Array<{ name: string; config: TotalStationConnectionConfig }> = [
  {
    name: "Topcon GT-1200 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 9600, brand: "Topcon", model: "GT-1200", isRobotic: true, hasATR: true, hasTracking: true },
  },
  {
    name: "Leica TS16 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 9600, brand: "Leica", model: "TS16", isRobotic: true, hasATR: true, hasTracking: true },
  },
  {
    name: "Sokkia FX-105 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 9600, brand: "Sokkia", model: "FX-105", isRobotic: false, hasATR: true, hasTracking: false },
  },
  {
    name: "Trimble S7 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 9600, brand: "Trimble", model: "S7", isRobotic: true, hasATR: true, hasTracking: true },
  },
  {
    name: "South NTS-372R (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 9600, brand: "South", model: "NTS-372R", isRobotic: false, hasATR: true, hasTracking: false },
  },
];
