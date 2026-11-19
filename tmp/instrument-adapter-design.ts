/**
 * useInstrumentConnection — the hook interface.
 *
 * Sits between the sidecar IPC bridge (backend) and the view-specific
 * data interpretation (frontend). Encapsulates the connection lifecycle
 * and raw observation stream. Views consume the stream and apply their
 * own business logic.
 *
 * What sits BEHIND the seam (in the sidecar Rust process):
 *   - Serial port enumeration (tokio-serial)
 *   - BLE discovery (btleplug)
 *   - NTRIP client connection
 *   - NMEA 0183 parsing (GGA, GSA, GSV, RMC, etc.)
 *   - Leica GSI / Sokkia SDR parsing
 *   - Instrument protocol auto-detection
 *   - Heartbeat / keepalive
 *
 * What sits IN FRONT of the seam (in the React renderer):
 *   - TraverseView: GGA → ENU, auto-record legs, live fix
 *   - InstrumentMonitorView: skyplot, DOP gauges, raw feed
 *   - FieldBookView: record observations to field book
 *   - Future views: stakeout guidance, RTK logging, etc.
 */

// ─── Types ───────────────────────────────────────────────────────

export type ConnectionType = "serial" | "bluetooth" | "ntrip";

export interface SerialPortInfo {
  port_name: string;
  display_name: string;
  is_usb: boolean;
  manufacturer?: string;
}

export interface BleDeviceInfo {
  name: string;
  address: string;
  rssi: number;
  service_uuids: string[];
}

export interface ConnectionState {
  /** Whether any connection is active. */
  connected: boolean;
  /** The connection ID (used for disconnect). */
  connectionId: string | null;
  /** Connection error message, if any. */
  error: string | null;
  /** Whether a connect/disconnect operation is in progress. */
  pending: boolean;
}

/** Raw observation from the sidecar NMEA parser. */
export interface RawObservation {
  talker: string;
  sentence_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Connection status from the sidecar. */
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
  // ── State ──
  state: ConnectionState;
  serialPorts: SerialPortInfo[];
  bleDevices: BleDeviceInfo[];
  connections: ConnectionStatus[];
  observationCount: number;

  // ── Actions ──
  /** List available serial ports (calls sidecar, updates serialPorts). */
  refreshPorts: () => Promise<void>;
  /** Scan for BLE devices (calls sidecar, updates bleDevices). */
  scanBle: () => Promise<void>;
  /** Connect to an instrument. Updates state on success. */
  connect: (params: ConnectParams) => Promise<void>;
  /** Disconnect by connection ID. Updates state on success. */
  disconnect: (connectionId: string) => Promise<void>;

  // ── Stream ──
  /**
   * Subscribe to raw observations. Returns an unsubscribe function.
   * The callback receives every NMEA sentence / GSI record from the
   * sidecar. View-specific code interprets the data.
   *
   * Usage:
   *   useEffect(() => {
   *     return onObservation((obs) => {
   *       if (obs.sentence_type === "GGA") { ... }
   *     });
   *   }, []);
   */
  onObservation: (callback: (obs: RawObservation) => void) => () => void;

  /**
   * Subscribe to connection status changes. Returns an unsubscribe function.
   */
  onStatusUpdate: (callback: (status: ConnectionStatus[]) => void) => () => void;

  /** Clear the current error. */
  clearError: () => void;
}

// ─── The Hook ────────────────────────────────────────────────────

/**
 * useInstrumentConnection
 *
 * Encapsulates the full instrument connection lifecycle:
 *   - Port enumeration
 *   - BLE scanning
 *   - Connect / disconnect
 *   - Observation stream subscription
 *   - Status polling
 *
 * Cleanup is automatic: subscriptions are torn down on unmount.
 *
 * This hook is the SEAM. Everything behind it is sidecar IPC.
 * Everything in front is view-specific data interpretation.
 */
export function useInstrumentConnection(): UseInstrumentConnectionReturn {
  // Implementation would live in:
  //   packages/ui-components/src/hooks/useInstrumentConnection.ts
  //
  // It wraps window.metardu.instrument.* calls and manages
  // the shared state (serialPorts, connected, connectionId, error, etc.)
  //
  // Key design decisions:
  //   1. The hook owns the api reference (no `(window as any).metardu` in views)
  //   2. The hook owns the polling lifecycle (startPolling/stopPolling)
  //   3. The hook owns the subscription lifecycle (onObservation/onStatusUpdate)
  //   4. Views never call sidecar.instrument.* directly
  //   5. The hook returns unsubscribe functions, not manages subscriptions

  throw new Error("Not implemented — design document only");
}

// ─── How views use it ────────────────────────────────────────────

/*
 * TraverseView usage:
 *
 *   const {
 *     state, serialPorts, observationCount,
 *     refreshPorts, connect, disconnect,
 *     onObservation, onStatusUpdate,
 *   } = useInstrumentConnection();
 *
 *   // Auto-record traverse legs from observations
 *   useEffect(() => {
 *     return onObservation((obs) => {
 *       if (obs.sentence_type !== "GGA") return;
 *       const d = obs.data;
 *       if (d.latitude == null || d.longitude == null) return;
 *       // ... ENU conversion, auto-record logic ...
 *     });
 *   }, [autoRecord, pointsText]);
 *
 *   // No connect/disconnect/polling/port logic needed — hook handles it all.
 *
 *
 * InstrumentMonitorView usage:
 *
 *   const {
 *     state, serialPorts, bleDevices, connections, observationCount,
 *     refreshPorts, scanBle, connect, disconnect,
 *     onObservation, onStatusUpdate,
 *   } = useInstrumentConnection();
 *
 *   // Parse NMEA for skyplot, DOP, raw feed
 *   useEffect(() => {
 *     return onObservation((obs) => {
 *       if (obs.sentence_type === "GSV") { /* update satellites */ }
 *       if (obs.sentence_type === "GSA") { /* update DOP */ }
 *       setObservations((prev) => [obs, ...prev].slice(0, 100));
 *     });
 *   }, []);
 *
 *   // Connection form UI still lives in the view —
 *   // the hook provides the connect() action, not the form.
 */

// ─── What sits behind the seam ───────────────────────────────────

/*
 * Sidecar (Rust) instrument module:
 *
 *   instrument.list_ports       → Vec<SerialPortInfo>
 *   instrument.list_ble_devices → Vec<BleDeviceInfo>
 *   instrument.connect          → ConnectionId
 *   instrument.disconnect       → ()
 *   instrument.start_polling    → spawns background task
 *   instrument.stop_polling     → cancels background task
 *   instrument.on_observation   → IPC notification stream
 *   instrument.on_status        → IPC notification stream
 *
 * The sidecar owns:
 *   - tokio-serial for serial port I/O
 *   - btleplug for BLE discovery/connection
 *   - NTRIP client for correction streams
 *   - NMEA 0183 parser (GGA, GSA, GSV, RMC, VTG, etc.)
 *   - Leica GSI format parser
 *   - Sokkia SDR format parser
 *   - Protocol auto-detection (NMEA vs GSI vs SDR)
 *   - Heartbeat / connection health monitoring
 *
 * The renderer never parses raw bytes — it receives structured
 * observations from the sidecar.
 */
