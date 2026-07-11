/**
 * Web Bluetooth GNSS Service
 * Connects to external GNSS receivers via Bluetooth
 * Works in Chrome desktop and Chrome Android (HTTPS required)
 */

import { parseNMEA, type NMEAPosition } from './nmea-parser';

export interface GNSSDevice {
  id: string;
  name: string;
  type: 'trimble' | 'leica' | 'topcon' | 'south' | 'generic';
}

export interface GNSSConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  connected: boolean;
}

export type PositionCallback = (position: NMEAPosition) => void;
export type ConnectionCallback = (connected: boolean, error?: string) => void;

const GNSS_SERVICE_UUIDS = [
  '0000180d-0000-1000-8000-00805f9b34fb',
  '00001819-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '00001101-0000-1000-8000-00805f9b34fb',
];

const NMEA_CHARACTERISTIC_UUID = '00002a67-0000-1000-8000-00805f9b34fb';

export class WebBluetoothGNSS {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private positionCallbacks: PositionCallback[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];
  private buffer: string = '';
  private isConnecting: boolean = false;
  private boundNotificationHandler: ((event: Event) => void) | null = null;

  static isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async scanForDevices(): Promise<GNSSDevice[]> {
    if (!WebBluetoothGNSS.isAvailable()) {
      throw new Error('Web Bluetooth not available. Use Chrome or Edge.');
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { services: [GNSS_SERVICE_UUIDS[0]] },
          { services: [GNSS_SERVICE_UUIDS[1]] },
          { namePrefix: 'Trimble' },
          { namePrefix: 'Leica' },
          { namePrefix: 'Topcon' },
          { namePrefix: 'South' },
          { namePrefix: 'GNSS' },
          { namePrefix: 'GPS' },
          { namePrefix: 'SOKKIA' },
          { namePrefix: 'HI-TARGET' },
        ],
        optionalServices: GNSS_SERVICE_UUIDS,
      });

      return [{
        id: device.id,
        name: device.name || 'Unknown GNSS',
        type: this.detectDeviceType(device.name || ''),
      }];
    } catch (error) {
      if ((error as Error).name === 'NotFoundError') {
        throw new Error('No GNSS device found. Make sure Bluetooth is enabled and device is paired.');
      }
      throw error;
    }
  }

  async connect(deviceId?: string): Promise<void> {
    if (this.isConnecting) {
      throw new Error('Already connecting');
    }

    this.isConnecting = true;
    this.buffer = '';

    try {
      if (deviceId) {
        const devices = await (navigator as any).bluetooth.getDevices();
        this.device = devices.find((d: BluetoothDevice) => d.id === deviceId) || null;
      }

      if (!this.device) {
        const devices = await this.scanForDevices();
        this.device = await (navigator as any).bluetooth.requestDevice({
          filters: [{ namePrefix: devices[0].name.substring(0, 7) }],
          optionalServices: GNSS_SERVICE_UUIDS,
        });
      }

      const server = await this.device!.gatt?.connect();
      if (!server) {
        throw new Error('Failed to connect to GATT server');
      }

      let service: BluetoothRemoteGATTService | null = null;
      for (const uuid of GNSS_SERVICE_UUIDS) {
        try {
          service = await server.getPrimaryService(uuid);
          if (service) break;
        } catch {
          continue;
        }
      }

      if (!service) {
        throw new Error('GNSS service not found on device');
      }

      this.characteristic = await service.getCharacteristic(NMEA_CHARACTERISTIC_UUID);

      await this.characteristic.startNotifications();
      this.boundNotificationHandler = this.handleNotification.bind(this);
      this.characteristic.addEventListener('characteristicvaluechanged', this.boundNotificationHandler!);

      this.notifyConnection(true);
    } catch (error) {
      this.notifyConnection(false, (error as Error).message);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private handleNotification(event: Event): void {
    const characteristic = event.target as unknown as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    
    if (!value) return;

    const decoder = new TextDecoder('utf-8');
    const data = decoder.decode(value);
    
    this.buffer += data;
    
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('$')) {
        const position = parseNMEA(line);
        if (position) {
          this.notifyPosition(position);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.characteristic) {
      try {
        if (this.boundNotificationHandler) {
          this.characteristic.removeEventListener('characteristicvaluechanged', this.boundNotificationHandler);
          this.boundNotificationHandler = null;
        }
        await this.characteristic.stopNotifications();
      } catch {
        // Ignore
      }
      this.characteristic = null;
    }

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.device = null;
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

  private notifyPosition(position: NMEAPosition): void {
    for (const callback of this.positionCallbacks) {
      try {
        callback(position);
      } catch (error) {
        console.error('Error in position callback:', error);
      }
    }
  }

  private notifyConnection(connected: boolean, error?: string): void {
    for (const callback of this.connectionCallbacks) {
      try {
        callback(connected, error);
      } catch (err) {
        console.error('Error in connection callback:', err);
      }
    }
  }

  private detectDeviceType(name: string): GNSSDevice['type'] {
    const lower = name.toLowerCase();
    if (lower.includes('trimble')) return 'trimble';
    if (lower.includes('leica')) return 'leica';
    if (lower.includes('topcon')) return 'topcon';
    if (lower.includes('south')) return 'south';
    return 'generic';
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  getConnectedDevice(): GNSSDevice | null {
    if (!this.device) return null;
    return {
      id: this.device.id,
      name: this.device.name || 'Unknown',
      type: this.detectDeviceType(this.device.name || ''),
    };
  }
}