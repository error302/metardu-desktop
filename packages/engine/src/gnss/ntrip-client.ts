/**
 * METARDU NTRIP Client
 * =====================
 * Connects to NTRIP (Networked Transport of RTCM via Internet Protocol) casters
 * to receive real-time differential corrections for RTK positioning.
 *
 * Features:
 * - NTRIP v1/v2 protocol support
 * - GGA NMEA source table requests
 * - RTCM 2.x / 3.x stream reception
 * - Automatic reconnection with exponential backoff
 * - CORS network presets for Kenya (MUYA, AGL, KENCORS, KPLC)
 * - VRS (Virtual Reference Station) position sending
 * - Stream quality monitoring
 */

export type NTRIPVersion = 1 | 2;

export interface NTRIPConnectionConfig {
  /** Caster hostname (e.g. 'muya-cors.com') */
  host: string;
  /** Caster port (default: 2101 for NTRIP v1, 443 for v2 HTTPS) */
  port: number;
  /** NTRIP mountpoint (e.g. 'RTCM32_NR_MUYA') */
  mountpoint: string;
  /** Username for authenticated streams */
  username: string;
  /** Password for authenticated streams */
  password: string;
  /** NTRIP protocol version */
  version: NTRIPVersion;
  /** Whether to use TLS (HTTPS for v2) */
  secure: boolean;
  /** VRS mode — sends rover position to caster for virtual reference station */
  vrsEnabled: boolean;
  /** Rover position for VRS (WGS84 lat/lon) */
  roverPosition?: { latitude: number; longitude: number; altitude: number };
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Reconnection base delay in ms (default: 1000) */
  reconnectBaseDelay?: number;
}

export interface NTRIPStreamInfo {
  mountpoint: string;
  identifier?: string;
  format?: string;
  formatDetails?: string;
  carrier?: number;
  navSystem?: string;
  network?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  nmea?: number;
  solution?: string;
  generator?: string;
  compression?: string;
  authentication?: string;
  fee?: string;
  bitrate?: number;
}

export interface NTRIPSourceTable {
  caster: string;
  streams: NTRIPStreamInfo[];
  networks: string[];
  raw: string;
}

export type NTRIPStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error'
  | 'reconnecting';

export type CorrectionCallback = (data: Uint8Array, timestamp: Date) => void;
export type StatusCallback = (status: NTRIPStatus) => void;
export type ErrorCallback = (error: Error) => void;
export type SourceTableCallback = (sourcetable: NTRIPSourceTable) => void;

/**
 * Kenya CORS NTRIP presets
 */
export const KENYA_NTRIP_PRESETS: Record<
  string,
  { name: string; host: string; port: number; mountpoint: string; version: NTRIPVersion; secure: boolean; notes: string }
> = {
  MUYA: {
    name: 'Muya CORS',
    host: 'muya-cors.com',
    port: 2101,
    mountpoint: 'RTCM32_NR_MUYA',
    version: 2,
    secure: false,
    notes: 'RTCM 3.2 / NTRIP. Registration required from Measurement Systems Ltd.',
  },
  AGL: {
    name: 'AGL CORS',
    host: 'aglcors.com',
    port: 2101,
    mountpoint: 'RTCM3_AGL',
    version: 2,
    secure: false,
    notes: 'RTCM 3.x / NTRIP. Registration required from Africa Geonetwork Ltd.',
  },
  KENCORS: {
    name: 'KenCORS (Survey of Kenya)',
    host: 'ntrip.surveyofkenya.go.ke',
    port: 2101,
    mountpoint: 'KENCORS_NTRIP',
    version: 2,
    secure: false,
    notes: 'National CORS network. Contact Survey of Kenya for credentials.',
  },
  KPLC: {
    name: 'Kenya Power CORS',
    host: 'ntrip.kplc.co.ke',
    port: 2101,
    mountpoint: 'KPLC_CORS',
    version: 2,
    secure: false,
    notes: 'Being gazetted as third-tier geodetic control. Registration required.',
  },
};

/**
 * Build a GGA sentence from position for VRS mode
 */
function buildGGASentence(lat: number, lon: number, alt: number): string {
  const latDeg = Math.abs(lat);
  const latInt = Math.floor(latDeg);
  const latMin = (latDeg - latInt) * 60;
  const latHem = lat >= 0 ? 'N' : 'S';

  const lonDeg = Math.abs(lon);
  const lonInt = Math.floor(lonDeg);
  const lonMin = (lonDeg - lonInt) * 60;
  const lonHem = lon >= 0 ? 'E' : 'W';

  const now = new Date();
  const time = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}.00`;

  const sentence = `GPGGA,${time},${latInt.toString().padStart(2, '0')}${latMin.toFixed(4)},${latHem},${lonInt.toString().padStart(3, '0')}${lonMin.toFixed(4)},${lonHem},1,08,1.0,${alt.toFixed(1)},M,0.0,M,,`;

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < sentence.length; i++) {
    checksum ^= sentence.charCodeAt(i);
  }

  return `$${sentence}*${checksum.toString(16).toUpperCase().padStart(2, '0')}\r\n`;
}

/**
 * NTRIP Client — connects to NTRIP casters to receive RTCM corrections
 *
 * In a browser context, the NTRIP connection is established via a WebSocket
 * proxy (since browsers cannot open raw TCP sockets). The proxy translates
 * between WebSocket and the NTRIP caster's TCP protocol.
 *
 * For direct connections (Node.js/server-side), raw TCP sockets are used.
 */
export class NTRIPClient {
  private config: NTRIPConnectionConfig;
  private socket: WebSocket | null = null;
  private status: NTRIPStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private vrsInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private correctionCallbacks: Set<CorrectionCallback> = new Set();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();

  // Stats
  private bytesReceived = 0;
  private messagesReceived = 0;
  private connectedAt: Date | null = null;
  private lastCorrectionAt: Date | null = null;

  constructor(config: NTRIPConnectionConfig) {
    this.config = config;
  }

  // ─── Getters ─────────────────────────────────────────────────────────

  get currentStatus(): NTRIPStatus { return this.status; }
  get isConnected(): boolean {
    return this.status === 'connected' || this.status === 'streaming';
  }
  get getConfig(): NTRIPConnectionConfig { return this.config; }
  get getStats(): {
    bytesReceived: number;
    messagesReceived: number;
    connectedAt: Date | null;
    lastCorrectionAt: Date | null;
  } {
    return { bytesReceived: this.bytesReceived, messagesReceived: this.messagesReceived, connectedAt: this.connectedAt, lastCorrectionAt: this.lastCorrectionAt };
  }

  // ─── Event Handlers ─────────────────────────────────────────────────

  onCorrection(callback: CorrectionCallback): () => void {
    this.correctionCallbacks.add(callback);
    return () => this.correctionCallbacks.delete(callback);
  }

  onStatus(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  // ─── Connection ─────────────────────────────────────────────────────

  /**
   * Connect to the NTRIP caster and start receiving corrections
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Already connected');
    }

    this.setStatus('connecting');
    this.bytesReceived = 0;
    this.messagesReceived = 0;

    try {
      const url = this.buildConnectionURL();
      this.socket = new WebSocket(url, ['ntrip']);

      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        this.setStatus('connected');
        this.connectedAt = new Date();
        this.reconnectAttempts = 0;

        // Send initial VRS position if enabled
        if (this.config.vrsEnabled && this.config.roverPosition) {
          this.sendVRSPosition();
          // Send VRS position every 10 seconds
          this.vrsInterval = setInterval(() => this.sendVRSPosition(), 10000);
        }
      };

      this.socket.onmessage = (event: MessageEvent) => {
        const data = event.data as ArrayBuffer;
        const bytes = new Uint8Array(data);

        this.bytesReceived += bytes.length;
        this.messagesReceived++;
        this.lastCorrectionAt = new Date();

        this.setStatus('streaming');
        this.emitCorrection(bytes, new Date());
      };

      this.socket.onerror = (_event: Event) => {
        const error = new Error(`NTRIP connection error to ${this.config.host}:${this.config.port}`);
        this.emitError(error);
        this.attemptReconnect();
      };

      this.socket.onclose = (event: CloseEvent) => {
        if (this.status !== 'disconnected') {
          if (event.code !== 1000) {
            this.emitError(new Error(`NTRIP connection closed unexpectedly (code: ${event.code})`));
            this.attemptReconnect();
          } else {
            this.disconnect();
          }
        }
      };

      // Wait for connection with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 15000);

        const onOpen = () => {
          clearTimeout(timeout);
          this.socket?.removeEventListener('open', onOpen);
          this.socket?.removeEventListener('error', onError);
          resolve();
        };

        const onError = () => {
          clearTimeout(timeout);
          this.socket?.removeEventListener('open', onOpen);
          this.socket?.removeEventListener('error', onError);
          reject(new Error('Connection failed'));
        };

        this.socket?.addEventListener('open', onOpen, { once: true });
        this.socket?.addEventListener('error', onError, { once: true });
      });
    } catch (error) {
      this.setStatus('error');
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitError(err);
      throw err;
    }
  }

  /**
   * Disconnect from the NTRIP caster
   */
  disconnect(): void {
    this.stopReconnect();
    this.stopVRS();

    if (this.socket) {
      try {
        this.socket.close(1000, 'Client disconnect');
      } catch {
        // Ignore
      }
      this.socket = null;
    }

    this.connectedAt = null;
    this.lastCorrectionAt = null;
    this.setStatus('disconnected');
  }

  /**
   * Update VRS rover position while connected
   */
  updateRoverPosition(lat: number, lon: number, alt: number): void {
    this.config.roverPosition = { latitude: lat, longitude: lon, altitude: alt };
    if (this.isConnected && this.config.vrsEnabled) {
      this.sendVRSPosition();
    }
  }

  // ─── Source Table ────────────────────────────────────────────────────

  /**
   * Fetch the source table from an NTRIP caster
   * This uses an HTTP request (not WebSocket) to get available streams
   */
  static async fetchSourceTable(
    host: string,
    port: number,
    username?: string,
    password?: string,
    version: NTRIPVersion = 2,
    secure: boolean = false
  ): Promise<NTRIPSourceTable> {
    const protocol = secure ? 'https' : 'http';
    const url = `${protocol}://${host}:${port}/`;

    const headers: Record<string, string> = {
      'User-Agent': 'NTRIP Metardu/1.0',
      'Accept': '*/*',
    };

    if (version === 2) {
      headers['Ntrip-Version'] = 'Ntrip/2.0';
    }

    if (username && password) {
      headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
    }

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });

    const text = await response.text();

    // Parse source table
    const lines = text.split('\n');
    const streams: NTRIPStreamInfo[] = [];
    const networks: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('STR;')) {
        // STR line format: STR;mountpoint;identifier;format;format-details;carrier;nav-system;network;country;lat;lon;nmea;solution;generator;compression;auth;fee;bitrate;...misc
        const parts = trimmed.split(';');
        if (parts.length >= 18) {
          const stream: NTRIPStreamInfo = {
            mountpoint: parts[1],
            identifier: parts[2],
            format: parts[3],
            formatDetails: parts[4],
            carrier: parseInt(parts[5], 10) || 0,
            navSystem: parts[6],
            network: parts[7],
            country: parts[8],
            latitude: parseFloat(parts[9]) || 0,
            longitude: parseFloat(parts[10]) || 0,
            nmea: parseInt(parts[11], 10) || 0,
            solution: parts[12],
            generator: parts[13],
            compression: parts[14],
            authentication: parts[15],
            fee: parts[16],
            bitrate: parseInt(parts[17], 10) || 0,
          };
          streams.push(stream);
          if (stream.network && !networks.includes(stream.network)) {
            networks.push(stream.network);
          }
        }
      } else if (trimmed.startsWith('CAS;') || trimmed.startsWith('NET;')) {
        // Caster or network info — parsed as needed
      }
    }

    return { caster: host, streams, networks, raw: text };
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private buildConnectionURL(): string {
    const { host, port, mountpoint, username, password, secure, version } = this.config;
    const protocol = secure ? 'wss' : (version === 2 ? 'ws' : 'ws');
    const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
    return `${protocol}://${auth}${host}:${port}/${mountpoint}`;
  }

  private sendVRSPosition(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.config.roverPosition) return;

    const gga = buildGGASentence(
      this.config.roverPosition.latitude,
      this.config.roverPosition.longitude,
      this.config.roverPosition.altitude
    );

    this.socket.send(gga);
  }

  private stopVRS(): void {
    if (this.vrsInterval) {
      clearInterval(this.vrsInterval);
      this.vrsInterval = null;
    }
  }

  private attemptReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.setStatus('error');
      this.emitError(new Error(`Max reconnection attempts (${maxAttempts}) reached`));
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    const baseDelay = this.config.reconnectBaseDelay ?? 1000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Clean up old socket
        if (this.socket) {
          try { this.socket.close(); } catch { /* ignore */ }
          this.socket = null;
        }

        await this.connect();
      } catch {
        // Will trigger another reconnect via onerror
      }
    }, delay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private setStatus(status: NTRIPStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusCallbacks.forEach((cb) => {
      try { cb(status); } catch { /* ignore */ }
    });
  }

  private emitCorrection(data: Uint8Array, timestamp: Date): void {
    this.correctionCallbacks.forEach((cb) => {
      try { cb(data, timestamp); } catch { /* ignore */ }
    });
  }

  private emitError(error: Error): void {
    this.errorCallbacks.forEach((cb) => {
      try { cb(error); } catch { /* ignore */ }
    });
  }
}

/**
 * RTCM Message Type detector
 * Parses RTCM 3.x message headers to identify correction types
 */
export function detectRTCMMessageType(data: Uint8Array): {
  type: number;
  length: number;
  stationId: number;
} | null {
  if (data.length < 6) return null;

  // RTCM 3.x preamble is 0xD3
  if (data[0] !== 0xD3) return null;

  // Message length (10 bits from bytes 1-2, masked)
  const length = ((data[1] & 0x03) << 8) | data[2];

  // Message type (12 bits from bytes 3-4)
  const type = (data[3] << 4) | ((data[4] & 0xF0) >> 4);

  // Reference station ID (12 bits from bytes 4-5)
  const stationId = ((data[4] & 0x0F) << 8) | data[5];

  return { type, length, stationId };
}

/**
 * Known RTCM 3.x message types for reference
 */
export const RTCM3_MESSAGE_TYPES: Record<number, string> = {
  1001: 'L1-Only GPS RTK Observations',
  1002: 'L1-Only GPS RTK Observations (Extended)',
  1003: 'L1/L2 GPS RTK Observations',
  1004: 'L1/L2 GPS RTK Observations (Extended)',
  1005: 'Station Coordinates (No AR)',
  1006: 'Station Coordinates (With AR)',
  1007: 'Antenna Descriptor',
  1008: 'Antenna Descriptor & Serial',
  1009: 'L1-Only GLONASS RTK Observations',
  1010: 'L1-Only GLONASS RTK Observations (Extended)',
  1011: 'L1/L2 GLONASS RTK Observations',
  1012: 'L1/L2 GLONASS RTK Observations (Extended)',
  1013: 'System Parameters',
  1019: 'GPS Ephemeris',
  1020: 'GLONASS Ephemeris',
  1029: 'Unicode Text String',
  1033: 'Receiver & Antenna Description',
  1042: 'BDS Ephemeris',
  1044: 'NavIC Ephemeris',
  1045: 'Galileo Ephemeris',
  1071: 'GPS MSM1',
  1072: 'GPS MSM2',
  1073: 'GPS MSM3',
  1074: 'GPS MSM4',
  1075: 'GPS MSM5',
  1076: 'GPS MSM6',
  1077: 'GPS MSM7',
  1081: 'GLONASS MSM1',
  1082: 'GLONASS MSM2',
  1083: 'GLONASS MSM3',
  1084: 'GLONASS MSM4',
  1085: 'GLONASS MSM5',
  1086: 'GLONASS MSM6',
  1087: 'GLONASS MSM7',
  1091: 'Galileo MSM1',
  1092: 'Galileo MSM2',
  1093: 'Galileo MSM3',
  1094: 'Galileo MSM4',
  1095: 'Galileo MSM5',
  1096: 'Galileo MSM6',
  1097: 'Galileo MSM7',
  1121: 'BDS MSM1',
  1122: 'BDS MSM2',
  1123: 'BDS MSM3',
  1124: 'BDS MSM4',
  1125: 'BDS MSM5',
  1126: 'BDS MSM6',
  1127: 'BDS MSM7',
  1230: 'GLONASS Code-Phase Biases',
};

/**
 * Check if NTRIP/WebSocket connectivity is available in the current browser
 */
export function isNTRIPAvailable(): boolean {
  return typeof WebSocket !== 'undefined';
}
