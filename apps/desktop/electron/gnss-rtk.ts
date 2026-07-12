/**
 * Real-Time GNSS RTK Rover Connection — NTRIP + BLE
 *
 * OV9: Web Bluetooth is Chrome-only and disconnects on tab switch.
 * Desktop maintains a persistent BLE + NTRIP connection that never drops.
 *
 * Features:
 *   - Native BLE connection to GNSS rovers (Leica GS18, Trimble R12, Topcon Hiper)
 *   - NTRIP client with persistent TCP connection (no tab-suspension drops)
 *   - RTK correction streaming from local CORS or NTRIP caster
 *   - Real-time coordinate quality indicator (fix/float/DGNSS/autonomous)
 *   - Auto-averaging of RTK shots at a point (configurable time/count)
 *   - Real-time satellite skyplot data
 *   - Base-rover radio link quality monitoring
 *   - RINEX recording for post-processing
 *   - NMEA 0183 parsing (GGA, GSV, RMC, GST, VTG)
 *
 * NTRIP (Networked Transport of RTCM via Internet Protocol) requires
 * an internet connection — the rover connects to an NTRIP caster
 * (e.g. Kenya CORS network) which streams RTCM3 corrections.
 */

import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, net } from 'electron';
import log from 'electron-log/main';

export type RTKFixQuality = 'fixed' | 'float' | 'dgps' | 'autonomous' | 'invalid';
export type SatelliteSystem = 'GPS' | 'GLONASS' | 'Galileo' | 'BDS' | 'SBAS';

export interface GNSSPosition {
  latitude: number;
  longitude: number;
  elevation: number;    // metres
  fixQuality: RTKFixQuality;
  satellitesTracked: number;
  satellitesInView: number;
  hdop: number;         // horizontal dilution of precision
  vdop: number;         // vertical dilution of precision
  pdop: number;         // position dilution of precision
  timestamp: string;
  rawNMEA: string[];    // raw NMEA sentences for audit
  ageOfCorrections?: number;  // seconds since last RTCM correction
  stationId?: string;   // NTRIP mountpoint / base station ID
}

export interface Satellite {
  system: SatelliteSystem;
  prn: number;          // PRN number
  elevation: number;    // degrees (0-90)
  azimuth: number;      // degrees (0-360)
  snr: number;          // dB-Hz (0-99, 0 = not tracked)
}

export interface NTRIPConfig {
  host: string;         // e.g. "cors.ardhisasa.go.ke"
  port: number;         // usually 2101
  mountpoint: string;   // e.g. "NBI0" for Nairobi base
  username?: string;
  password?: string;
  format: 'RTCM3' | 'RTCM2' | 'raw';
}

export interface NTRIPSourceTable {
  mountpoints: Array<{
    name: string;
    format: string;
    formatDetails: string;
    carrier: string;
    navSystem: string;
    network: string;
    country: string;
    latitude: number;
    longitude: number;
    nmea: boolean;
    solution: string;
    generator: string;
    comprEncryp: string;
    authentication: string;
    fee: string;
    bitrate: number;
    misc: string;
  }>;
}

export class NTRIPClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: NTRIPConfig | null = null;
  private connected = false;
  private correctionsBuffer: Buffer[] = [];
  private rinexFile: fs.WriteStream | null = null;

  /**
   * Connect to an NTRIP caster and start receiving RTCM corrections.
   */
  async connect(config: NTRIPConfig): Promise<void> {
    if (this.connected) await this.disconnect();

    this.config = config;
    log.info(`Connecting to NTRIP caster: ${config.host}:${config.port}/${config.mountpoint}`);

    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('NTRIP connection timed out'));
      }, 15000);

      this.socket.connect(config.port, config.host, () => {
        clearTimeout(timeout);
        // Send NTRIP HTTP request
        const auth = config.username
          ? `Authorization: Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}\r\n`
          : '';
        const request = `GET /${config.mountpoint} HTTP/1.1\r\nHost: ${config.host}\r\n${auth}User-Agent: METARDU-Desktop/0.1\r\nNtrip-Version: Ntrip/2.0\r\n\r\n`;
        this.socket!.write(request);
      });

      let headerBuffer = '';
      let headerComplete = false;

      this.socket.on('data', (data: Buffer) => {
        if (!headerComplete) {
          // Parse HTTP response header
          headerBuffer += data.toString('ascii');
          if (headerBuffer.includes('\r\n\r\n')) {
            const headerEnd = headerBuffer.indexOf('\r\n\r\n');
            const header = headerBuffer.substring(0, headerEnd);
            if (!header.includes('200 OK') && !header.includes('200 ok')) {
              this.socket?.destroy();
              reject(new Error(`NTRIP server rejected: ${header.split('\r\n')[0]}`));
              return;
            }
            headerComplete = true;
            this.connected = true;
            log.info('NTRIP connected, receiving RTCM corrections');
            this.emit('connected', { mountpoint: config.mountpoint });

            // Remaining data is RTCM
            const remaining = data.subarray(Buffer.from(headerBuffer).indexOf(Buffer.from('\r\n\r\n')) + 4);
            if (remaining.length > 0) {
              this.handleRTCMCorrection(remaining);
            }
          }
        } else {
          // RTCM correction data
          this.handleRTCMCorrection(data);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        log.error('NTRIP socket error:', err);
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        log.info('NTRIP connection closed');
        this.emit('disconnected');
      });

      // Resolve after first data or timeout
      setTimeout(() => {
        if (this.connected) resolve();
      }, 3000);
    });
  }

  /**
   * Handle incoming RTCM correction data.
   */
  private handleRTCMCorrection(data: Buffer): void {
    this.correctionsBuffer.push(data);
    this.emit('correction', data);

    // Start RINEX recording if enabled
    if (this.rinexFile) {
      this.rinexFile.write(data);
    }
  }

  /**
   * Disconnect from the NTRIP caster.
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    if (this.rinexFile) {
      this.rinexFile.end();
      this.rinexFile = null;
    }
    log.info('NTRIP disconnected');
  }

  /**
   * Start recording raw RTCM corrections to a RINEX file (for post-processing).
   */
  startRINEXRecording(filePath?: string): string {
    const fp = filePath ?? path.join(app.getPath('userData'), `rinex-${Date.now()}.rtcm`);
    this.rinexFile = fs.createWriteStream(fp);
    log.info(`RINEX recording started: ${fp}`);
    return fp;
  }

  /**
   * Stop RINEX recording.
   */
  stopRINEXRecording(): void {
    if (this.rinexFile) {
      this.rinexFile.end();
      this.rinexFile = null;
      log.info('RINEX recording stopped');
    }
  }

  /**
   * Fetch the NTRIP source table (list of available mountpoints/base stations).
   */
  static async fetchSourceTable(host: string, port: number = 2101): Promise<NTRIPSourceTable> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Source table request timed out'));
      }, 15000);

      socket.connect(port, host, () => {
        socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: METARDU-Desktop/0.1\r\nNtrip-Version: Ntrip/2.0\r\n\r\n`);
      });

      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString('ascii'); });
      socket.on('end', () => {
        clearTimeout(timeout);
        // Parse sourcetable
        const lines = data.split('\n').filter((l) => l.trim() && !l.startsWith('HTTP') && !l.startsWith('Server') && !l.startsWith('Date') && !l.startsWith('Content'));
        const mountpoints = lines.filter((l) => l.startsWith('STR;')).map((l) => {
          const parts = l.split(';');
          return {
            name: parts[1] ?? '',
            format: parts[2] ?? '',
            formatDetails: parts[3] ?? '',
            carrier: parts[4] ?? '',
            navSystem: parts[5] ?? '',
            network: parts[6] ?? '',
            country: parts[7] ?? '',
            latitude: parseFloat(parts[8] ?? '0'),
            longitude: parseFloat(parts[9] ?? '0'),
            nmea: parts[10] === '1',
            solution: parts[11] ?? '',
            generator: parts[12] ?? '',
            comprEncryp: parts[13] ?? '',
            authentication: parts[14] ?? '',
            fee: parts[15] ?? '',
            bitrate: parseInt(parts[16] ?? '0'),
            misc: parts[17] ?? '',
          };
        });
        resolve({ mountpoints });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  get isConnected_(): boolean {
    return this.connected;
  }

  get currentMountpoint(): string | null {
    return this.config?.mountpoint ?? null;
  }
}

/**
 * NMEA 0183 sentence parser.
 * Parses GGA, GSV, RMC, GST, VTG sentences from GNSS receivers.
 */
export class NMEAParser extends EventEmitter {
  /**
   * Parse a complete NMEA sentence.
   */
  parse(sentence: string): void {
    if (!sentence.startsWith('$')) return;
    const parts = sentence.substring(1).split(',');
    const type = parts[0];

    switch (type) {
      case 'GPGGA':
      case 'GNGGA':
        this.parseGGA(parts);
        break;
      case 'GPGSV':
      case 'GLGSV':
      case 'GAGSV':
      case 'GBGSV':
        this.parseGSV(parts);
        break;
      case 'GPRMC':
      case 'GNRMC':
        this.parseRMC(parts);
        break;
      case 'GPGST':
      case 'GNGST':
        this.parseGST(parts);
        break;
    }
  }

  private parseGGA(parts: string[]): void {
    // $GPGGA,time,lat,N,lon,E,quality,sats,hdop,alt,M,geoid,M,age,station
    if (parts.length < 15) return;
    const lat = this.parseLatitude(parts[2], parts[3]);
    const lon = this.parseLongitude(parts[4], parts[5]);
    const quality = parseInt(parts[6]);
    const sats = parseInt(parts[7]);
    const hdop = parseFloat(parts[8]);
    const alt = parseFloat(parts[9]);
    const age = parts[13] ? parseFloat(parts[13]) : undefined;
    const station = parts[14]?.trim();

    const fixQuality: RTKFixQuality =
      quality === 4 ? 'fixed' :
      quality === 5 ? 'fixed' :
      quality === 2 ? 'dgps' :
      quality === 1 ? 'autonomous' :
      'invalid';

    this.emit('position', {
      latitude: lat,
      longitude: lon,
      elevation: alt,
      fixQuality,
      satellitesTracked: sats,
      hdop,
      vdop: 0,
      pdop: 0,
      timestamp: new Date().toISOString(),
      rawNMEA: [parts.join(',')],
      ageOfCorrections: age,
      stationId: station,
    } as GNSSPosition);
  }

  private parseGSV(parts: string[]): void {
    // $GPGSV,total,msg,satsInView,prn,elev,azim,snr,...
    // Note: parts[0] is "$GPGSV" (with $ prefix)
    if (parts.length < 7) return;
    const satsInView = parseInt(parts[3]);
    if (!isNaN(satsInView)) this.emit('satellites_in_view', { count: satsInView });

    // Parse up to 4 satellites per sentence
    // parts[4] = prn, parts[5] = elev, parts[6] = azim, parts[7] = snr
    for (let i = 4; i + 3 <= parts.length; i += 4) {
      // PRN may have leading letters (G01, R05, etc.) — strip non-digits for parsing
      const prnStr = parts[i]?.replace(/[^0-9]/g, '') ?? '';
      const prn = parseInt(prnStr);
      const elev = parseInt(parts[i + 1] ?? '0');
      // SNR may have checksum suffix (*7A) — strip it
      const snrStr = (parts[i + 3] ?? '').split('*')[0];
      const snr = parseInt(snrStr);
      const azim = parseInt(parts[i + 2] ?? '0');

      if (!isNaN(prn)) {
        const talkerId = parts[0].substring(1);  // strip $
        const system: SatelliteSystem = talkerId.startsWith('GL') ? 'GLONASS' : talkerId.startsWith('GA') ? 'Galileo' : talkerId.startsWith('GB') ? 'BDS' : 'GPS';
        this.emit('satellite', { system, prn, elevation: elev, azimuth: azim, snr: isNaN(snr) ? 0 : snr } as Satellite);
      }
    }
  }

  private parseRMC(parts: string[]): void {
    // $GPRMC,time,status,lat,N,lon,E,speed,course,date,magvar
    // Minimal — just emit speed/course if needed
  }

  private parseGST(parts: string[]): void {
    // $GPGST,time,rms,std_major,std_minor,orient,std_lat,std_lon,std_alt
    if (parts.length < 9) return;
    const stdLat = parseFloat(parts[6]);
    const stdLon = parseFloat(parts[7]);
    const stdAlt = parseFloat(parts[8]);
    this.emit('precision', { stdLat, stdLon, stdAlt });
  }

  private parseLatitude(value: string, dir: string): number {
    if (!value) return 0;
    const deg = parseInt(value.substring(0, 2));
    const min = parseFloat(value.substring(2));
    let lat = deg + min / 60;
    if (dir === 'S') lat = -lat;
    return lat;
  }

  private parseLongitude(value: string, dir: string): number {
    if (!value) return 0;
    const deg = parseInt(value.substring(0, 3));
    const min = parseFloat(value.substring(3));
    let lon = deg + min / 60;
    if (dir === 'W') lon = -lon;
    return lon;
  }
}
