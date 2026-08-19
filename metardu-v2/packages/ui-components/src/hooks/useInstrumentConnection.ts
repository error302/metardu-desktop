/**
 * useInstrumentConnection — shared instrument connection hook.
 *
 * Encapsulates the connection lifecycle (port enumeration, connect,
 * disconnect, polling) and the raw observation/status streams.
 *
 * Views consume the stream and apply their own business logic:
 *   - TraverseView: GGA → ENU, auto-record legs
 *   - InstrumentMonitorView: skyplot, DOP, raw feed
 *   - FieldBookView: record to field book
 *
 * What sits BEHIND this seam (sidecar Rust process):
 *   - Serial/BLE/NTRIP hardware I/O
 *   - NMEA 0183, Leica GSI, Sokkia SDR parsing
 *   - Protocol auto-detection, heartbeat
 *
 * What sits IN FRONT (view-specific):
 *   - Data interpretation (ENU conversion, skyplot, etc.)
 *   - Connection form UI (port picker, baud rate, etc.)
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────

export type ConnectionType = "serial" | "bluetooth" | "ntrip";

export interface SerialPortInfo {
  port_name: string;
  display_name: string;
  is_usb?: boolean;
}

export interface BleDeviceInfo {
  name: string;
  address: string;
  rssi: number;
  service_uuids?: string[];
}

export interface ConnectionState {
  connected: boolean;
  connectionId: string | null;
  error: string | null;
  pending: boolean;
}

export interface RawObservation {
  talker: string;
  sentence_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ConnectionStatus {
  id: string;
  connection_type: string;
  port: string;
  status: string;
  instrument_name?: string;
  protocol?: string;
  data_rate_hz?: number;
  observation_count: number;
}

export interface ConnectParams {
  connection_type: ConnectionType;
  port?: string;
  baud_rate?: number;
  protocol?: string;
  instrument_name?: string;
  device_name?: string;
  caster_url?: string;
  mountpoint?: string;
  username?: string;
  password?: string;
}

export interface UseInstrumentConnectionReturn {
  state: ConnectionState;
  serialPorts: SerialPortInfo[];
  bleDevices: BleDeviceInfo[];
  connections: ConnectionStatus[];
  observationCount: number;
  refreshPorts: () => Promise<void>;
  scanBle: () => Promise<void>;
  connect: (params: ConnectParams) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  onObservation: (callback: (obs: RawObservation) => void) => () => void;
  onStatusUpdate: (callback: (connections: ConnectionStatus[]) => void) => () => void;
  clearError: () => void;
}

// ─── Sidecar bridge ──────────────────────────────────────────────

interface InstrumentApi {
  listPorts?: () => Promise<{ ports?: SerialPortInfo[] }>;
  listBleDevices?: () => Promise<{ devices?: BleDeviceInfo[] }>;
  connect?: (params: Record<string, unknown>) => Promise<{ connection_id: string }>;
  disconnect?: (id: string) => Promise<void>;
  startPolling?: () => void;
  stopPolling?: () => void;
  onObservation?: (cb: (data: unknown) => void) => () => void;
  onStatusUpdate?: (cb: (data: unknown) => void) => () => void;
}

function getInstrumentApi(): InstrumentApi | null {
  const w = window as unknown as { metardu?: { instrument?: InstrumentApi } };
  return w.metardu?.instrument ?? null;
}

// ─── Hook ────────────────────────────────────────────────────────

export function useInstrumentConnection(): UseInstrumentConnectionReturn {
  const [state, setState] = useState<ConnectionState>({
    connected: false,
    connectionId: null,
    error: null,
    pending: false,
  });
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [bleDevices, setBleDevices] = useState<BleDeviceInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [observationCount, setObservationCount] = useState(0);

  // Refs for stable callback identity
  const obsCallbacksRef = useRef<Set<(obs: RawObservation) => void>>(new Set());
  const statusCallbacksRef = useRef<Set<(conns: ConnectionStatus[]) => void>>(new Set());

  const api = getInstrumentApi();

  // ── Load serial ports on mount ──────────────────────────────────
  useEffect(() => {
    if (!api?.listPorts) return;
    api.listPorts().then((r) => {
      if (r?.ports) setSerialPorts(r.ports);
    }).catch(() => {});
  }, []);

  // ── Subscribe to observations and status ─────────────────────────
  useEffect(() => {
    if (!api) return;

    const unsubObs = api.onObservation?.((data: unknown) => {
      setObservationCount((c) => c + 1);
      const d = data as { observation?: { talker?: string; sentence_type?: string; timestamp?: string; data?: Record<string, unknown> } } | undefined;
      const obs = d?.observation;
      if (!obs) return;
      const raw: RawObservation = {
        talker: obs.talker ?? "",
        sentence_type: obs.sentence_type ?? "",
        timestamp: obs.timestamp ?? new Date().toISOString(),
        data: obs.data ?? {},
      };
      for (const cb of obsCallbacksRef.current) cb(raw);
    });

    const unsubStatus = api.onStatusUpdate?.((data: unknown) => {
      const d = data as { connections?: ConnectionStatus[] } | undefined;
      const conns = d?.connections ?? [];
      setConnections(conns);
      for (const cb of statusCallbacksRef.current) cb(conns);
    });

    api.startPolling?.();

    return () => {
      unsubObs?.();
      unsubStatus?.();
      api.stopPolling?.();
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────

  const refreshPorts = useCallback(async () => {
    if (!api?.listPorts) return;
    try {
      const r = await api.listPorts();
      if (r?.ports) setSerialPorts(r.ports);
    } catch {}
  }, []);

  const scanBle = useCallback(async () => {
    if (!api?.listBleDevices) return;
    try {
      const r = await api.listBleDevices();
      setBleDevices(r?.devices ?? []);
    } catch {}
  }, []);

  const connect = useCallback(async (params: ConnectParams) => {
    if (!api?.connect) return;
    setState((s) => ({ ...s, error: null, pending: true }));
    try {
      const result = await api.connect(params as Record<string, unknown>);
      setState({ connected: true, connectionId: result.connection_id, error: null, pending: false });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, pending: false }));
    }
  }, []);

  const disconnect = useCallback(async (connectionId: string) => {
    if (!api?.disconnect) return;
    try {
      await api.disconnect(connectionId);
      setState({ connected: false, connectionId: null, error: null, pending: false });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }, []);

  const onObservation = useCallback((callback: (obs: RawObservation) => void): (() => void) => {
    obsCallbacksRef.current.add(callback);
    return () => { obsCallbacksRef.current.delete(callback); };
  }, []);

  const onStatusUpdate = useCallback((callback: (conns: ConnectionStatus[]) => void): (() => void) => {
    statusCallbacksRef.current.add(callback);
    return () => { statusCallbacksRef.current.delete(callback); };
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    state,
    serialPorts,
    bleDevices,
    connections,
    observationCount,
    refreshPorts,
    scanBle,
    connect,
    disconnect,
    onObservation,
    onStatusUpdate,
    clearError,
  };
}
