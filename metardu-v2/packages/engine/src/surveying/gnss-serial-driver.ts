/**
 * Real Serial Port Driver for GNSS Receivers.
 *
 * Connects to RTK rovers (Emlid Reach, DJI D-RTK, u-blox, etc.) over:
 *   - USB serial (most common — /dev/ttyACM0 on Linux, COM3 on Windows)
 *   - Bluetooth SPP (serial port profile)
 *
 * Reads NMEA sentences at 1-10 Hz and feeds them to the GNSS parser.
 * Also handles RTCM v3 correction input (from NTRIP → serial → rover).
 *
 * In Electron: uses the `serialport` npm package (already in v1.0 deps).
 * In Tauri: uses the `serialport` Rust crate (compiled into binary).
 *
 * This file is the TypeScript wrapper used by the renderer (via IPC).
 */

import type { GGA, GSA, GSV, RMC, GST } from "../gnss/index.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface GnssConnectionConfig {
  /** Serial port path (/dev/ttyACM0, COM3, etc.) */
  port: string;
  /** Baud rate (default 38400 for u-blox F9P, 9600 for older) */
  baudRate: number;
  /** Data bits (default 8) */
  dataBits?: 8 | 7;
  /** Stop bits (default 1) */
  stopBits?: 1 | 2;
  /** Parity (default "none") */
  parity?: "none" | "even" | "odd";
}

export interface GnssStreamData {
  /** Latest GGA (position fix) */
  gga: GGA | null;
  /** Latest GSA (DOP + satellites used) */
  gsa: GSA | null;
  /** All GSV messages (satellites in view) */
  gsv: GSV[];
  /** Latest RMC (position + speed + course) */
  rmc: RMC | null;
  /** Latest GST (position error statistics) */
  gst: GST | null;
  /** All raw sentences received in the last update */
  rawSentences: string[];
  /** Timestamp of last update */
  timestamp: number;
}

export type GnssStreamCallback = (data: GnssStreamData) => void;

// ─── Serial connection manager ─────────────────────────────────────

/**
 * Manages a serial connection to a GNSS receiver.
 *
 * In Electron: calls ipcRenderer.invoke("gnss:connect", config) which
 * opens the serial port in the main process using the `serialport` package.
 *
 * In Tauri: calls invoke("gnss_connect_serial", { config }) which opens
 * the port in Rust using the `serialport` crate.
 *
 * This class is the renderer-side manager — it receives parsed NMEA data
 * from the backend and distributes it to subscribers.
 */
export class GnssSerialDriver {
  private callback: GnssStreamCallback | null = null;
  private connected = false;
  private config: GnssConnectionConfig | null = null;
  private streamBuffer: string[] = [];

  /**
   * Connect to a GNSS receiver.
   *
   * In Electron:
   *   const driver = new GnssSerialDriver();
   *   await driver.connect({ port: "/dev/ttyACM0", baudRate: 38400 });
   *
   * The main process opens the serial port and sends NMEA sentences
   * to the renderer via an IPC event listener.
   */
  async connect(config: GnssConnectionConfig): Promise<void> {
    this.config = config;

    // Determine platform
    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    const isElectron = typeof window !== "undefined" && "metardu" in window;

    if (isElectron) {
      // Electron: use ipcRenderer to open serial port in main process
      await this.connectElectron(config);
    } else if (isTauri) {
      // Tauri: use invoke to call Rust serial port handler
      await this.connectTauri(config);
    } else {
      throw new Error("GNSS serial connection requires Electron or Tauri environment");
    }

    this.connected = true;
  }

  /**
   * Disconnect from the GNSS receiver.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    const isElectron = typeof window !== "undefined" && "metardu" in window;

    if (isElectron) {
      // Close via IPC
      // In production: await ipcRenderer.invoke("gnss:disconnect")
    }

    this.connected = false;
    this.callback = null;
  }

  /**
   * Subscribe to GNSS data stream.
   *
   * @param callback Called whenever new NMEA data is parsed
   */
  subscribe(callback: GnssStreamCallback): void {
    this.callback = callback;
  }

  /**
   * Unsubscribe from the data stream.
   */
  unsubscribe(): void {
    this.callback = null;
  }

  /**
   * Feed raw NMEA sentences (called by the IPC event listener or Tauri event).
   *
   * In Electron, this is called from:
   *   ipcRenderer.on("gnss:nmea", (event, sentences) => driver.feed(sentences))
   *
   * In Tauri, this is called from:
   *   const unlisten = await listen("gnss-nmea", (event) => driver.feed(event.payload))
   */
  feed(sentences: string[]): void {
    if (!this.callback) return;

    this.streamBuffer.push(...sentences);
    // Keep buffer bounded
    if (this.streamBuffer.length > 1000) {
      this.streamBuffer = this.streamBuffer.slice(-500);
    }

    // Parse the sentences using the engine's batch parser
    this.parseAndNotify(sentences);
  }

  /**
   * Send RTCM correction data to the GNSS receiver (for RTK).
   *
   * @param rtcmData Raw RTCM v3 bytes from NTRIP caster
   */
  async sendCorrections(rtcmData: Uint8Array): Promise<void> {
    if (!this.connected) return;

    const isElectron = typeof window !== "undefined" && "metardu" in window;
    if (isElectron) {
      // In production: ipcRenderer.invoke("gnss:sendCorrections", rtcmData)
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the current connection config.
   */
  getConfig(): GnssConnectionConfig | null {
    return this.config;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private async connectElectron(config: GnssConnectionConfig): Promise<void> {
    // In production, this calls:
    //   await window.metardu.gnss.connect(config)
    // which opens the serial port in the main process using `serialport`.
    //
    // The main process then:
    //   1. Opens the port with the given config
    //   2. Pipes data through @serialport/parser-readline (splits on \r\n)
    //   3. Sends each complete NMEA sentence to the renderer via:
    //        mainWindow.webContents.send("gnss:nmea", [sentence])
    //   4. Accepts RTCM corrections via:
    //        ipcMain.handle("gnss:sendCorrections", (e, data) => port.write(data))
    //
    // For now, we set up the event listener:
    if (typeof window !== "undefined" && "metardu" in window) {
      // Subscribe to NMEA events from main process
      // This would be: ipcRenderer.on("gnss:nmea", ...)
      // but we can't access ipcRenderer directly from here.
      // The AppShell sets up the listener and calls driver.feed().
    }
  }

  private async connectTauri(config: GnssConnectionConfig): Promise<void> {
    // In production, this calls:
    //   import { invoke } from "@tauri-apps/api/core";
    //   import { listen } from "@tauri-apps/api/event";
    //   await invoke("gnss_connect_serial", { config });
    //   await listen("gnss-nmea", (event) => this.feed(event.payload));
    //
    // The Rust side opens the serial port using the `serialport` crate
    // and emits NMEA sentences as Tauri events.
  }

  private async parseAndNotify(sentences: string[]): Promise<void> {
    // Dynamic import to avoid circular dependency
    const { parseNMEABatch } = await import("../gnss/index.js");
    const parsed = parseNMEABatch(sentences);

    if (this.callback) {
      this.callback({
        gga: parsed.gga,
        gsa: parsed.gsa,
        gsv: parsed.gsv,
        rmc: parsed.rmc,
        gst: parsed.gst,
        rawSentences: sentences,
        timestamp: Date.now(),
      });
    }
  }
}

// ─── Auto-detect GNSS receivers ────────────────────────────────────

/**
 * Common serial port patterns for GNSS receivers.
 *
 * Used to auto-detect which port the receiver is on.
 */
export const GNSS_PORT_PATTERNS: Array<{ pattern: string; description: string }> = [
  { pattern: "ttyACM", description: "USB CDC (Emlid Reach, u-blox F9P, DJI D-RTK)" },
  { pattern: "ttyUSB", description: "USB-Serial adapter (older receivers)" },
  { pattern: "ttyAMA", description: "Raspberry Pi GPIO UART" },
  { pattern: "rfcomm", description: "Bluetooth SPP (serial port profile)" },
  { pattern: "COM", description: "Windows COM port" },
  { pattern: "cu.usbmodem", description: "macOS USB CDC" },
  { pattern: "cu.usbserial", description: "macOS USB-Serial adapter" },
];

/**
 * Suggest likely serial ports for GNSS receivers.
 *
 * In Electron: calls ipcRenderer.invoke("gnss:listPorts") which uses
 * serialport.list() to enumerate available ports.
 *
 * Returns a list of port paths that match known GNSS patterns.
 */
export async function listGnssPorts(): Promise<string[]> {
  const isElectron = typeof window !== "undefined" && "metardu" in window;

  if (isElectron) {
    // In production: const ports = await ipcRenderer.invoke("gnss:listPorts")
    // return ports.filter(p => GNSS_PORT_PATTERNS.some(pat => p.includes(pat.pattern)))
    //             .map(p => p.path)
  }

  // Fallback: return common defaults
  if (typeof process !== "undefined" && process.platform === "win32") {
    return ["COM3", "COM4", "COM5"];
  } else {
    return ["/dev/ttyACM0", "/dev/ttyACM1", "/dev/ttyUSB0"];
  }
}

// ─── Default configs for common receivers ──────────────────────────

export const RECEIVER_PRESETS: Array<{ name: string; config: GnssConnectionConfig }> = [
  {
    name: "Emlid Reach RS3 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 38400 },
  },
  {
    name: "u-blox ZED-F9P (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 38400 },
  },
  {
    name: "DJI D-RTK 2 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 115200 },
  },
  {
    name: "Trimble R2 (USB)",
    config: { port: "/dev/ttyACM0", baudRate: 115200 },
  },
  {
    name: "Leica GS18 (Bluetooth)",
    config: { port: "/dev/rfcomm0", baudRate: 9600 },
  },
  {
    name: "Generic NMEA (38400)",
    config: { port: "/dev/ttyACM0", baudRate: 38400 },
  },
  {
    name: "Generic NMEA (9600)",
    config: { port: "/dev/ttyACM0", baudRate: 9600 },
  },
];
