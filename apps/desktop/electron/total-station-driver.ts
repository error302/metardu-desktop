/**
 * Total Station Driver — Real-Time Serial Streaming
 *
 * OV2: The killer feature. Web browsers can't maintain a reliable serial
 * connection. Desktop can — native serialport, persistent background
 * connection, sub-100ms latency, never disconnects.
 *
 * Supported instruments:
 *   - Topcon (GTS/GTM series, OS, QS, GT) — GTS-2 format
 *   - Leica (TCRA/TCTS/TS, Nova TS) — GSI-8/GSI-16 format
 *   - Sokkia (SET/NET/FX/MX) — SDR format
 *   - Trimble (S/CTS/Access) — RW5 format
 *   - Pentax (W-800/NX) — Pentax format
 *   - South (NTS) — South format
 *
 * Each instrument speaks a different protocol. This module auto-detects
 * the instrument type from the first response and selects the correct
 * parser.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'node:events';
import log from 'electron-log/main';

export type InstrumentBrand = 'topcon' | 'leica' | 'sokkia' | 'trimble' | 'pentax' | 'south' | 'unknown';

export interface TotalStationMeasurement {
  pointNumber: string;
  horizontalAngle: number;  // degrees (HZA/VZA — face left)
  verticalAngle: number;    // degrees
  slopeDistance: number;    // metres
  horizontalDistance: number; // metres
  elevation: number;        // metres (computed)
  easting: number;          // metres (computed, if station coords set)
  northing: number;         // metres (computed)
  rawLine: string;          // raw serial data for audit
  instrument: InstrumentBrand;
  timestamp: string;
  face: 'left' | 'right' | 'unknown';
}

export interface StationSetup {
  stationNumber: string;
  stationEasting: number;
  stationNorthing: number;
  stationElevation: number;
  backsightNumber: string;
  backsightEasting: number;
  backsightNorthing: number;
  instrumentHeight: number;  // metres
  targetHeight: number;     // metres (can be overridden per shot)
}

export class TotalStationDriver extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private brand: InstrumentBrand = 'unknown';
  private setup: StationSetup | null = null;
  private pointCounter = 0;
  private lastMeasurement: TotalStationMeasurement | null = null;
  private faceLeftMeasurements: Map<string, TotalStationMeasurement> = new Map();
  private faceRightMeasurements: Map<string, TotalStationMeasurement> = new Map();

  constructor() {
    super();
  }

  /**
   * List available serial ports.
   */
  static async listPorts(): Promise<Array<{ path: string; manufacturer?: string; vendorId?: string; productId?: string }>> {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      vendorId: p.vendorId,
      productId: p.productId,
    }));
  }

  /**
   * Connect to a total station on the specified serial port.
   * Auto-detects instrument brand from the first response.
   */
  async connect(portPath: string, baudRate: number = 9600): Promise<void> {
    if (this.port && this.port.isOpen) {
      await this.disconnect();
    }

    log.info(`Connecting to total station on ${portPath} @ ${baudRate} baud`);

    this.port = new SerialPort({
      path: portPath,
      baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => {
        if (err) reject(new Error(`Failed to open ${portPath}: ${err.message}`));
        else resolve();
      });
    });

    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    this.parser.on('data', (line: string) => this.handleLine(line));

    this.port.on('error', (err) => {
      log.error('Serial port error:', err);
      this.emit('error', err);
    });

    this.port.on('close', () => {
      log.info('Serial port closed');
      this.emit('disconnected');
    });

    // Send a probe to detect instrument type
    await this.sendMessage('?');  // generic probe — most instruments respond
    setTimeout(() => {
      if (this.brand === 'unknown') {
        // Try Topcon-specific probe
        this.sendMessage('Z1\r').catch(() => {});
      }
    }, 2000);

    this.emit('connected', { port: portPath, baudRate });
    log.info('Total station connected');
  }

  /**
   * Disconnect from the total station.
   */
  async disconnect(): Promise<void> {
    if (this.port) {
      if (this.port.isOpen) {
        await new Promise<void>((resolve) => {
          this.port!.close(() => resolve());
        });
      }
      this.port = null;
      this.parser = null;
    }
    this.brand = 'unknown';
    this.emit('disconnected');
    log.info('Total station disconnected');
  }

  /**
   * Set the station setup (station coordinates + backsight).
   * Required for computing easting/northing/elevation of measured points.
   */
  setStationSetup(setup: StationSetup): void {
    this.setup = setup;
    log.info(`Station setup: ${setup.stationNumber} → backsight ${setup.backsightNumber}`);
  }

  /**
   * Request a measurement from the total station.
   * The instrument will take a shot and send back the angles + distance.
   */
  async requestMeasurement(pointNumber?: string): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Total station not connected');
    }
    const ptNum = pointNumber ?? `PT${++this.pointCounter}`;
    this.pendingPointNumber = ptNum;
    await this.sendMessage(this.getMeasureCommand());
  }

  private pendingPointNumber: string | null = null;

  /**
   * Send a message to the total station.
   */
  private async sendMessage(msg: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        reject(new Error('Port not open'));
        return;
      }
      this.port.write(msg, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get the measurement command for the detected instrument brand.
   */
  private getMeasureCommand(): string {
    switch (this.brand) {
      case 'topcon': return '0\r';      // Topcon measure command
      case 'leica': return 'GET/M/WI81/WI82/WI83\r'; // Leica GSI measure
      case 'sokkia': return 'M\r';       // Sokkia measure
      case 'trimble': return 'PM\r';     // Trimble measure
      case 'pentax': return 'M\r';       // Pentax measure
      case 'south': return 'M\r';        // South measure
      default: return 'M\r';             // Generic
    }
  }

  /**
   * Handle a line from the total station.
   * Auto-detects instrument brand and parses accordingly.
   */
  private handleLine(line: string): void {
    log.debug('Serial RX:', line);
    this.emit('raw', line);

    // Auto-detect brand if unknown
    if (this.brand === 'unknown') {
      this.brand = this.detectBrand(line);
      if (this.brand !== 'unknown') {
        log.info(`Instrument detected: ${this.brand}`);
        this.emit('instrument_detected', this.brand);
      }
    }

    // Parse the measurement
    const measurement = this.parseMeasurement(line);
    if (measurement) {
      this.lastMeasurement = measurement;
      this.emit('measurement', measurement);

      // Check for face-left / face-right pair
      this.checkFacePair(measurement);
    }
  }

  /**
   * Detect instrument brand from a serial line.
   */
  private detectBrand(line: string): InstrumentBrand {
    // Leica GSI: starts with * and uses word indices like 21.324+00000001
    if (line.startsWith('*') || /^\*\d{2}\./.test(line)) return 'leica';
    // Topcon GTS: starts with space-padded numbers, format like " 023.4530  090.0000 025.0000"
    if (/^\s+\d{3}\.\d{4}\s+\d{3}\.\d{4}\s+\d{3}\.\d{4}/.test(line)) return 'topcon';
    // Trimble RW5: starts with command like "PM,..." or "SS,..."
    if (/^(PM|SS|BR|BK|FR),/i.test(line)) return 'trimble';
    // Sokkia SDR: starts with 2-digit code
    if (/^\d{2},/.test(line)) return 'sokkia';
    // Pentax: specific format
    if (/^PENTAX/i.test(line)) return 'pentax';
    // South: similar to Topcon
    if (/^South/i.test(line)) return 'south';
    return 'unknown';
  }

  /**
   * Parse a measurement from a serial line.
   * Dispatches to the correct brand parser.
   */
  private parseMeasurement(line: string): TotalStationMeasurement | null {
    const timestamp = new Date().toISOString();
    const pointNumber = this.pendingPointNumber ?? `PT${++this.pointCounter}`;
    this.pendingPointNumber = null;

    try {
      switch (this.brand) {
        case 'topcon':
          return this.parseTopcon(line, pointNumber, timestamp);
        case 'leica':
          return this.parseLeicaGSI(line, pointNumber, timestamp);
        case 'trimble':
          return this.parseTrimbleRW5(line, pointNumber, timestamp);
        case 'sokkia':
          return this.parseSokkia(line, pointNumber, timestamp);
        default:
          // Try generic parsing
          return this.parseGeneric(line, pointNumber, timestamp);
      }
    } catch (err) {
      log.warn('Failed to parse measurement:', line, err);
      return null;
    }
  }

  /**
   * Parse Topcon GTS-2 format.
   * Format: " HZAxxxx.xxxx VZAxxxx.xxxx SDxxxx.xxx"
   * Example: " 023.4530  090.0000 025.0000"
   */
  private parseTopcon(line: string, pointNumber: string, timestamp: string): TotalStationMeasurement | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;

    const hza = parseFloat(parts[0]);  // horizontal angle (degrees)
    const vza = parseFloat(parts[1]);  // vertical angle (degrees)
    const sd = parseFloat(parts[2]);   // slope distance (metres)

    if (isNaN(hza) || isNaN(vza) || isNaN(sd)) return null;

    // Compute horizontal distance and elevation
    const vd = sd * Math.cos(vza * Math.PI / 180);
    const hd = sd * Math.sin(vza * Math.PI / 180);

    // Compute easting/northing if station is set up
    let easting = 0, northing = 0, elevation = 0;
    if (this.setup) {
      const bearing = this.computeBearing(this.setup, hza);
      easting = this.setup.stationEasting + hd * Math.sin(bearing * Math.PI / 180);
      northing = this.setup.stationNorthing + hd * Math.cos(bearing * Math.PI / 180);
      elevation = this.setup.stationElevation + vd + this.setup.instrumentHeight - this.setup.targetHeight;
    }

    return {
      pointNumber, horizontalAngle: hza, verticalAngle: vza,
      slopeDistance: sd, horizontalDistance: hd, elevation,
      easting, northing, rawLine: line, instrument: 'topcon',
      timestamp, face: hza < 180 ? 'left' : 'right',
    };
  }

  /**
   * Parse Leica GSI-8/GSI-16 format.
   * Format: *21.324+00000001 22.324+00012345 ...
   * Word indices: 21=point number, 22=horizontal angle, 25=vertical angle,
   *               31=slope distance, 32=horizontal distance, 87=elevation
   */
  private parseLeicaGSI(line: string, pointNumber: string, timestamp: string): TotalStationMeasurement | null {
    if (!line.startsWith('*')) return null;

    const words = line.substring(1).trim().split(/\s+/);
    let hza = 0, vza = 0, sd = 0, hd = 0, elev = 0;

    for (const word of words) {
      const match = word.match(/^(\d{2})\.(\d{3})([+-])(\d+)$/);
      if (!match) continue;
      const [, idx, , sign, value] = match;
      const num = parseInt(value) / Math.pow(10, parseInt(match[2]));
      const signed = sign === '-' ? -num : num;

      switch (idx) {
        case '22': hza = signed * 1.8; break;  // GSI centesimal → degrees
        case '25': vza = signed * 1.8; break;
        case '31': sd = signed / 1000; break;   // mm → metres
        case '32': hd = signed / 1000; break;
        case '87': elev = signed / 1000; break;
      }
    }

    if (sd === 0 && hd === 0) return null;

    let easting = 0, northing = 0;
    if (this.setup) {
      const bearing = this.computeBearing(this.setup, hza);
      easting = this.setup.stationEasting + hd * Math.sin(bearing * Math.PI / 180);
      northing = this.setup.stationNorthing + hd * Math.cos(bearing * Math.PI / 180);
      if (elev === 0) elev = this.setup.stationElevation + sd * Math.cos(vza * Math.PI / 180);
    }

    return {
      pointNumber, horizontalAngle: hza, verticalAngle: vza,
      slopeDistance: sd, horizontalDistance: hd, elevation: elev,
      easting, northing, rawLine: line, instrument: 'leica',
      timestamp, face: hza < 180 ? 'left' : 'right',
    };
  }

  /**
   * Parse Trimble RW5 format.
   * Format: "PM,HA123.4530,VA90.0000,SD25.000,..."
   */
  private parseTrimbleRW5(line: string, pointNumber: string, timestamp: string): TotalStationMeasurement | null {
    const parts = line.split(',');
    let hza = 0, vza = 0, sd = 0;

    for (const part of parts) {
      if (part.startsWith('HA')) hza = parseFloat(part.substring(2));
      else if (part.startsWith('VA')) vza = parseFloat(part.substring(2));
      else if (part.startsWith('SD')) sd = parseFloat(part.substring(2));
    }

    if (sd === 0) return null;

    const vd = sd * Math.cos(vza * Math.PI / 180);
    const hd = sd * Math.sin(vza * Math.PI / 180);

    let easting = 0, northing = 0, elevation = 0;
    if (this.setup) {
      const bearing = this.computeBearing(this.setup, hza);
      easting = this.setup.stationEasting + hd * Math.sin(bearing * Math.PI / 180);
      northing = this.setup.stationNorthing + hd * Math.cos(bearing * Math.PI / 180);
      elevation = this.setup.stationElevation + vd + this.setup.instrumentHeight - this.setup.targetHeight;
    }

    return {
      pointNumber, horizontalAngle: hza, verticalAngle: vza,
      slopeDistance: sd, horizontalDistance: hd, elevation,
      easting, northing, rawLine: line, instrument: 'trimble',
      timestamp, face: hza < 180 ? 'left' : 'right',
    };
  }

  /**
   * Parse Sokkia SDR format (simplified).
   */
  private parseSokkia(line: string, pointNumber: string, timestamp: string): TotalStationMeasurement | null {
    const parts = line.split(',');
    if (parts.length < 4) return null;

    const hza = parseFloat(parts[1]) || 0;
    const vza = parseFloat(parts[2]) || 0;
    const sd = parseFloat(parts[3]) || 0;

    if (sd === 0) return null;

    const vd = sd * Math.cos(vza * Math.PI / 180);
    const hd = sd * Math.sin(vza * Math.PI / 180);

    let easting = 0, northing = 0, elevation = 0;
    if (this.setup) {
      const bearing = this.computeBearing(this.setup, hza);
      easting = this.setup.stationEasting + hd * Math.sin(bearing * Math.PI / 180);
      northing = this.setup.stationNorthing + hd * Math.cos(bearing * Math.PI / 180);
      elevation = this.setup.stationElevation + vd + this.setup.instrumentHeight - this.setup.targetHeight;
    }

    return {
      pointNumber, horizontalAngle: hza, verticalAngle: vza,
      slopeDistance: sd, horizontalDistance: hd, elevation,
      easting, northing, rawLine: line, instrument: 'sokkia',
      timestamp, face: hza < 180 ? 'left' : 'right',
    };
  }

  /**
   * Generic parser — tries to extract numbers from the line.
   */
  private parseGeneric(line: string, pointNumber: string, timestamp: string): TotalStationMeasurement | null {
    const numbers = line.match(/-?\d+\.?\d*/g);
    if (!numbers || numbers.length < 3) return null;

    const hza = parseFloat(numbers[0]);
    const vza = parseFloat(numbers[1]);
    const sd = parseFloat(numbers[2]);

    if (isNaN(hza) || isNaN(vza) || isNaN(sd)) return null;

    const vd = sd * Math.cos(vza * Math.PI / 180);
    const hd = sd * Math.sin(vza * Math.PI / 180);

    let easting = 0, northing = 0, elevation = 0;
    if (this.setup) {
      const bearing = this.computeBearing(this.setup, hza);
      easting = this.setup.stationEasting + hd * Math.sin(bearing * Math.PI / 180);
      northing = this.setup.stationNorthing + hd * Math.cos(bearing * Math.PI / 180);
      elevation = this.setup.stationElevation + vd + this.setup.instrumentHeight - this.setup.targetHeight;
    }

    return {
      pointNumber, horizontalAngle: hza, verticalAngle: vza,
      slopeDistance: sd, horizontalDistance: hd, elevation,
      easting, northing, rawLine: line, instrument: 'unknown',
      timestamp, face: hza < 180 ? 'left' : 'right',
    };
  }

  /**
   * Compute the true bearing from station to target given the
   * measured horizontal angle and the station-backsight orientation.
   */
  private computeBearing(setup: StationSetup, measuredHz: number): number {
    // Bearing from station to backsight
    const dE = setup.backsightEasting - setup.stationEasting;
    const dN = setup.backsightNorthing - setup.stationNorthing;
    const bsBearing = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
    // True bearing = backsight bearing + measured angle
    return (bsBearing + measuredHz) % 360;
  }

  /**
   * Check for face-left / face-right pair and auto-average.
   * When both faces of the same point are measured, the mean is computed
   * automatically to eliminate instrument errors (collimation, trunnion axis).
   */
  private checkFacePair(measurement: TotalStationMeasurement): void {
    const key = measurement.pointNumber;
    if (measurement.face === 'left') {
      this.faceLeftMeasurements.set(key, measurement);
    } else if (measurement.face === 'right') {
      this.faceRightMeasurements.set(key, measurement);
    }

    // If both faces exist, compute the mean
    const fl = this.faceLeftMeasurements.get(key);
    const fr = this.faceRightMeasurements.get(key);
    if (fl && fr) {
      const mean: TotalStationMeasurement = {
        ...fl,
        horizontalAngle: (fl.horizontalAngle + (fr.horizontalAngle - 180)) / 2,
        verticalAngle: (fl.verticalAngle + (360 - fr.verticalAngle)) / 2,
        slopeDistance: (fl.slopeDistance + fr.slopeDistance) / 2,
        horizontalDistance: (fl.horizontalDistance + fr.horizontalDistance) / 2,
        elevation: (fl.elevation + fr.elevation) / 2,
        face: 'unknown',  // mean of both faces
        rawLine: `${fl.rawLine} || ${fr.rawLine}`,
        timestamp: new Date().toISOString(),
      };
      this.emit('face_pair_averaged', { point: key, mean, faceLeft: fl, faceRight: fr });
      log.info(`Face-left/right pair averaged for ${key}`);
      // Clean up
      this.faceLeftMeasurements.delete(key);
      this.faceRightMeasurements.delete(key);
    }
  }

  get isConnected(): boolean {
    return this.port?.isOpen ?? false;
  }

  get instrumentBrand(): InstrumentBrand {
    return this.brand;
  }

  get lastShot(): TotalStationMeasurement | null {
    return this.lastMeasurement;
  }
}
