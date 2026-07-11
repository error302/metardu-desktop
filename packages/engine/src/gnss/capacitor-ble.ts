/**
 * Capacitor Bluetooth LE — Total Station & GNSS Integration
 * ────────────────────────────────────────────────────────────
 * Real implementation that uses @capacitor-community/bluetooth-le
 * when running natively (Android/iOS), and falls back to Web
 * Bluetooth API when in a browser context.
 *
 * Supported device types:
 *   - Leica total stations (GSI format over BLE)
 *   - Trimble receivers (NMEA over BLE)
 *   - Topcon / Sokkia / South instruments (generic NMEA)
 *   - Any GNSS receiver broadcasting NMEA 0183 over BLE
 *
 * The BLE UART service (Nordic UART Service / NUS) is the de facto
 * standard for surveying instruments that stream serial data over
 * Bluetooth LE. This module scans for NUS-compatible devices,
 * connects, and streams parsed NMEA/GSI data into the existing
 * instrument connection infrastructure.
 */

import { parseNMEA, type NMEAPosition } from './nmea-parser';
import { type GNSSDevice, type PositionCallback, type ConnectionCallback } from './bluetooth';

export interface CapacitorGNSSDevice {
  deviceId: string;
  name: string;
  rssi?: number;
  type?: 'total-station' | 'gnss' | 'unknown';
}

// ─── BLE Service / Characteristic UUIDs ────────────────────────────────────
// Nordic UART Service (NUS) — used by most BLE surveying instruments
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // device → phone
const NUS_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // phone → device

// Standard Location + NMEA service (some GNSS receivers use this instead of NUS)
const LOCATION_SERVICE_UUID = '00001819-0000-1000-8000-00805f9b34fb';
const NMEA_CHARACTERISTIC_UUID = '00002a67-0000-1000-8000-00805f9b34fb';

// Device name patterns for auto-classification
const TOTAL_STATION_PATTERNS = [
  /leica/i, /ts\d{2}/i, /tcrm/i, /viva/i, /nova/i,
  /topcon/i, /os-\d/i, /ds-\d/i,
  /sokkia/i, /cx-\d/i, /fx-\d/i,
  /trimble/i, /s\d$/i, /s7/i,
  /south/i, /hi-target/i,
];
const GNSS_PATTERNS = [
  /gnss/i, /rtk/i, /receiver/i, /r\d{2}/i,
  /trimble r/i, /leica gs/i, /topcon hi-per/i,
];

function classifyDevice(name: string): 'total-station' | 'gnss' | 'unknown' {
  for (const p of TOTAL_STATION_PATTERNS) {
    if (p.test(name)) return 'total-station';
  }
  for (const p of GNSS_PATTERNS) {
    if (p.test(name)) return 'gnss';
  }
  return 'unknown';
}

/**
 * Dynamically import the Capacitor BLE plugin. Returns null if not
 * available (browser context or plugin not installed).
 */
async function getBLEPlugin() {
  try {
    const mod = await import('@capacitor-community/bluetooth-le');
    return mod.BleClient;
  } catch {
    return null;
  }
}

export class CapacitorBLEGNSS {
  private deviceId: string | null = null;
  private positionCallbacks: PositionCallback[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];
  private buffer: string = '';
  private scanning = false;

  // ─── Reconnection resilience ────────────────────────────
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelayMs = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyDisconnected = false;
  private lastConnectedDeviceId: string | null = null;
  private isReconnecting = false;

  /**
   * Configure reconnection behaviour.
   * Call before connect() to customise backoff parameters.
   */
  setReconnectConfig(opts: { maxAttempts?: number; baseDelayMs?: number }): void {
    if (opts.maxAttempts !== undefined) this.maxReconnectAttempts = opts.maxAttempts;
    if (opts.baseDelayMs !== undefined) this.baseReconnectDelayMs = opts.baseDelayMs;
  }

  /** Whether the service is currently in a reconnection cycle. */
  getIsReconnecting(): boolean {
    return this.isReconnecting;
  }

  /** Number of reconnection attempts made so far. */
  getReconnectAttemptCount(): number {
    return this.reconnectAttempts;
  }

  /** Cancel any pending reconnection attempt. */
  cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Exponential backoff delay: 2s → 4s → 8s → 16s → 30s cap.
   * Jitter ±20% to avoid thundering herd on multi-device setups.
   */
  private getReconnectDelay(): number {
    const base = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    const capped = Math.min(base, 30000);
    const jitter = capped * (0.8 + Math.random() * 0.4); // ±20%
    return Math.round(jitter);
  }

  /**
   * Internal auto-reconnect on unexpected disconnect.
   * Called from the BLE disconnect callback only when the
   * disconnect was NOT initiated by the user.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.intentionallyDisconnected) return;
    if (!this.lastConnectedDeviceId) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.isReconnecting = false;
      this.notifyConnection(false, `Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = this.getReconnectDelay();

    // Notify subscribers that we're reconnecting
    this.notifyConnection(false, `Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})…`);

    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(resolve, delay);
    });

    // Check if cancelReconnect was called during the wait
    if (this.intentionallyDisconnected || !this.lastConnectedDeviceId) {
      this.isReconnecting = false;
      return;
    }

    try {
      await this.connect(this.lastConnectedDeviceId);
      // Success — reset counters
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
    } catch {
      // Failed — schedule next attempt
      this.attemptReconnect();
    }
  }

  /**
   * Check whether Capacitor BLE is available on this platform.
   * Returns true only when running natively with the BLE plugin.
   */
  static async isAvailable(): Promise<boolean> {
    const BleClient = await getBLEPlugin();
    if (!BleClient) return false;
    try {
      await BleClient.initialize({ androidNeverForLocation: false });
      return true;
    } catch {
      return false;
    }
  }

  /** Request Bluetooth permissions (Android 12+ requires explicit permission). */
  static async requestPermissions(): Promise<boolean> {
    const BleClient = await getBLEPlugin();
    if (!BleClient) return false;
    try {
      await BleClient.initialize({ androidNeverForLocation: false });
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    const BleClient = await getBLEPlugin();
    if (!BleClient) {
      throw new Error('Capacitor Bluetooth LE not available. Use Web Bluetooth in browser.');
    }
    await BleClient.initialize({ androidNeverForLocation: false });
  }

  /**
   * Scan for BLE surveying instruments.
   * Looks for devices advertising NUS or Location+NMEA services.
   */
  async scanForDevices(durationMs = 5000): Promise<CapacitorGNSSDevice[]> {
    const BleClient = await getBLEPlugin();
    if (!BleClient) {
      throw new Error('Capacitor Bluetooth LE not available');
    }

    const devices: Map<string, CapacitorGNSSDevice> = new Map();

    await BleClient.requestLEScan(
      {
        services: [NUS_SERVICE_UUID, LOCATION_SERVICE_UUID],
        allowDuplicates: true,
      },
      (result: { device: { deviceId: string; name?: string }; rssi?: number }) => {
        const id = result.device.deviceId;
        const name = result.device.name || `BLE-${id.slice(0, 8)}`;
        if (!devices.has(id)) {
          devices.set(id, {
            deviceId: id,
            name,
            rssi: result.rssi,
            type: classifyDevice(name),
          });
        }
      },
    );

    // Scan for the requested duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await BleClient.stopLEScan();
    this.scanning = false;

    return Array.from(devices.values()).sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100));
  }

  /**
   * Connect to a BLE device by ID and start streaming data.
   * Tries NUS first (most common for surveying instruments),
   * then falls back to the standard Location+NMEA service.
   */
  async connect(deviceId: string): Promise<void> {
    const BleClient = await getBLEPlugin();
    if (!BleClient) {
      throw new Error('Capacitor Bluetooth LE not available');
    }

    this.intentionallyDisconnected = false;

    await BleClient.connect(deviceId, (disconnectedDeviceId: string) => {
      if (disconnectedDeviceId === this.deviceId) {
        this.deviceId = null;
        this.buffer = '';

        if (!this.intentionallyDisconnected) {
          // Unexpected disconnect — trigger auto-reconnect
          this.attemptReconnect();
        } else {
          this.notifyConnection(false, 'Device disconnected');
        }
      }
    });

    this.deviceId = deviceId;
    this.lastConnectedDeviceId = deviceId;
    this.buffer = '';
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    // Try NUS first — most surveying instruments use this
    let connected = false;
    try {
      await BleClient.startNotifications(
        deviceId,
        NUS_SERVICE_UUID,
        NUS_TX_CHAR_UUID,
        (value: DataView) => {
          this.handleBLEData(value);
        },
      );
      connected = true;
    } catch {
      // NUS not available — try standard Location+NMEA service
      try {
        await BleClient.startNotifications(
          deviceId,
          LOCATION_SERVICE_UUID,
          NMEA_CHARACTERISTIC_UUID,
          (value: DataView) => {
            this.handleBLEData(value);
          },
        );
        connected = true;
      } catch {
        await BleClient.disconnect(deviceId);
        this.deviceId = null;
        throw new Error('No compatible BLE service found on this device. Supported: Nordic UART Service or Location+NMEA.');
      }
    }

    if (connected) {
      this.notifyConnection(true);
    }
  }

  /**
   * Send a command to the total station via BLE UART.
   * Used for triggering measurements, changing modes, etc.
   */
  async sendCommand(command: string): Promise<void> {
    const BleClient = await getBLEPlugin();
    if (!BleClient || !this.deviceId) return;

    const encoder = new TextEncoder();
    const data = encoder.encode(command + '\r\n');
    // Capacitor BLE write expects DataView, not Uint8Array
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

    try {
      await BleClient.write(
        this.deviceId,
        NUS_SERVICE_UUID,
        NUS_RX_CHAR_UUID,
        dataView,
      );
    } catch (err) {
      console.warn('BLE command send failed:', err);
    }
  }

  /**
   * Request a single measurement from a connected total station.
   * Sends the standard GSI "measure and send" command or NMEA request.
   */
  async requestMeasurement(): Promise<void> {
    // GSI command: request measurement
    await this.sendCommand('GET/M/WI1/WI2/WI3/WI51/WI81/WI82');
  }

  async disconnect(): Promise<void> {
    // Mark as intentional to suppress auto-reconnect
    this.intentionallyDisconnected = true;
    this.cancelReconnect();

    if (this.deviceId) {
      const BleClient = await getBLEPlugin();
      if (BleClient) {
        try {
          await BleClient.stopNotifications(this.deviceId, NUS_SERVICE_UUID, NUS_TX_CHAR_UUID);
        } catch { /* may already be stopped */ }
        try {
          await BleClient.stopNotifications(this.deviceId, LOCATION_SERVICE_UUID, NMEA_CHARACTERISTIC_UUID);
        } catch { /* may already be stopped */ }
        try {
          await BleClient.disconnect(this.deviceId);
        } catch { /* may already be disconnected */ }
      }
    }
    this.deviceId = null;
    this.buffer = '';
    this.notifyConnection(false);
  }

  onPosition(callback: PositionCallback): () => void {
    this.positionCallbacks.push(callback);
    return () => {
      this.positionCallbacks = this.positionCallbacks.filter(cb => cb !== callback);
    };
  }

  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.push(callback);
    return () => {
      this.connectionCallbacks = this.connectionCallbacks.filter(cb => cb !== callback);
    };
  }

  isConnected(): boolean {
    return this.deviceId !== null;
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Handle incoming BLE data from the UART characteristic.
   * Accumulates bytes into a line buffer and parses complete NMEA
   * or GSI sentences.
   */
  private handleBLEData(value: DataView): void {
    const decoder = new TextDecoder();
    const chunk = decoder.decode(value);
    this.buffer += chunk;

    // Process complete lines (NMEA and GSI both end with \r\n)
    const lines = this.buffer.split(/\r?\n/);
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try NMEA parsing
      if (trimmed.startsWith('$')) {
        try {
          const position = parseNMEA(trimmed);
          if (position) {
            this.notifyPosition(position);
          }
        } catch {
          // Invalid NMEA — skip
        }
      }

      // GSI lines start with a word index pattern like "110001+0000..."
      // We store raw GSI for the serial parser to handle
      if (/^\d{2}\d{2}/.test(trimmed) || /\+\d{7}/.test(trimmed)) {
        // Expose GSI data via a synthetic NMEAPosition-like structure
        // The InstrumentSerialConnection handles GSI parsing; here we
        // just signal that data arrived
        this.notifyRawGSIData(trimmed);
      }
    }

    // Prevent buffer from growing unbounded
    if (this.buffer.length > 4096) {
      this.buffer = this.buffer.slice(-2048);
    }
  }

  private notifyPosition(position: NMEAPosition): void {
    for (const callback of this.positionCallbacks) {
      try { callback(position); } catch { /* subscriber error */ }
    }
  }

  private notifyRawGSIData(line: string): void {
    // Parse basic GSI word to extract coordinate-like data
    // GSI format: WI + value (e.g., 81..00+0275640.1234 = Easting)
    try {
      const easting = this.extractGSIValue(line, 81);
      const northing = this.extractGSIValue(line, 82);
      const elevation = this.extractGSIValue(line, 83);
      const slopeDist = this.extractGSIValue(line, 31);
      const hzAngle = this.extractGSIValue(line, 21);
      const vaAngle = this.extractGSIValue(line, 22);

      if (easting !== null || northing !== null) {
        // Synthesize an NMEAPosition-like object for consistency
        const position = {
          latitude: northing ?? 0,
          longitude: easting ?? 0,
          altitude: elevation ?? 0,
          timestamp: new Date(),
          fixQuality: 1,
          satellites: 0,
          hdop: 0,
          // Extended data for total station readings
          _gsi: { easting, northing, elevation, slopeDist, hzAngle, vaAngle },
        } as unknown as NMEAPosition;
        this.notifyPosition(position);
      }
    } catch {
      // GSI parse failure — skip
    }
  }

  /** Extract a numeric value from a GSI line for a given word index. */
  private extractGSIValue(line: string, wordIndex: number): number | null {
    // GSI word format: WW..SS+VVVVVVVVV  (WW=word index, SS=sign, VV=value)
    const pattern = new RegExp(`${wordIndex}\\.\\.\\d+([+-]\\d+\\.\\d+)`);
    const match = line.match(pattern);
    if (match) {
      return parseFloat(match[1]);
    }
    return null;
  }

  private notifyConnection(connected: boolean, error?: string): void {
    for (const callback of this.connectionCallbacks) {
      try { callback(connected, error); } catch { /* subscriber error */ }
    }
  }
}
