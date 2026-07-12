/**
 * Total Station Live Panel — Real-time point plotting
 *
 * OV-UI1: As shots stream in from the total station over serial, they
 * appear on the map instantly. Shows connection status, instrument brand,
 * last measurement, and a running point count.
 *
 * This component listens to IPC events from the main process:
 *   ts:connected, ts:disconnected, ts:instrument_detected,
 *   ts:measurement, ts:face_pair_averaged, ts:raw
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { SurveyPoint } from '../types.js';

interface TotalStationMeasurement {
  pointNumber: string;
  horizontalAngle: number;
  verticalAngle: number;
  slopeDistance: number;
  horizontalDistance: number;
  elevation: number;
  easting: number;
  northing: number;
  instrument: string;
  timestamp: string;
  face: string;
}

interface StationSetup {
  stationNumber: string;
  stationEasting: number;
  stationNorthing: number;
  stationElevation: number;
  backsightNumber: string;
  backsightEasting: number;
  backsightNorthing: number;
  instrumentHeight: number;
  targetHeight: number;
}

export function TotalStationPanel() {
  const [connected, setConnected] = useState(false);
  const [brand, setBrand] = useState<string>('unknown');
  const [ports, setPorts] = useState<Array<{ path: string; manufacturer?: string }>>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(9600);
  const [measurements, setMeasurements] = useState<TotalStationMeasurement[]>([]);
  const [lastShot, setLastShot] = useState<TotalStationMeasurement | null>(null);
  const [setup, setSetup] = useState<StationSetup | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Listen to total station events
  useEffect(() => {
    const handlers: Array<{ channel: string; handler: (...args: any[]) => void }> = [];
    
    // These will be wired via window.metardu.menu event listeners
    // For now we use a custom event approach since preload doesn't expose ts: events directly
    const handleConnected = (_event: unknown, info: any) => {
      setConnected(true);
      console.log('TS connected:', info);
    };
    const handleDisconnected = () => {
      setConnected(false);
      setBrand('unknown');
    };
    const handleDetected = (_event: unknown, b: string) => {
      setBrand(b);
    };
    const handleMeasurement = (_event: unknown, m: TotalStationMeasurement) => {
      setMeasurements((prev) => [...prev, m]);
      setLastShot(m);
    };
    const handleRaw = (_event: unknown, line: string) => {
      setRawLog((prev) => [...prev.slice(-100), line]); // keep last 100 lines
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    };

    // In a real implementation, these would be ipcRenderer.on listeners
    // exposed via preload. For now we simulate with window events.
    window.addEventListener('ts:connected', handleConnected as any);
    window.addEventListener('ts:disconnected', handleDisconnected as any);
    window.addEventListener('ts:instrument_detected', handleDetected as any);
    window.addEventListener('ts:measurement', handleMeasurement as any);
    window.addEventListener('ts:raw', handleRaw as any);

    return () => {
      window.removeEventListener('ts:connected', handleConnected as any);
      window.removeEventListener('ts:disconnected', handleDisconnected as any);
      window.removeEventListener('ts:instrument_detected', handleDetected as any);
      window.removeEventListener('ts:measurement', handleMeasurement as any);
      window.removeEventListener('ts:raw', handleRaw as any);
    };
  }, []);

  const handleListPorts = useCallback(async () => {
    // In production this calls window.metardu.ts.listPorts()
    // For now we simulate
    setPorts([
      { path: '/dev/ttyUSB0', manufacturer: 'Prolific Technology Inc.' },
      { path: '/dev/ttyUSB1', manufacturer: 'FTDI' },
    ]);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!selectedPort) return;
    // In production: await window.metardu.ts.connect(selectedPort, baudRate)
    setConnected(true);
  }, [selectedPort, baudRate]);

  const handleDisconnect = useCallback(async () => {
    // In production: await window.metardu.ts.disconnect()
    setConnected(false);
    setBrand('unknown');
  }, []);

  const handleMeasure = useCallback(async () => {
    // In production: await window.metardu.ts.measure()
    // The measurement comes back via the ts:measurement event
  }, []);

  const handleSetStation = useCallback((s: StationSetup) => {
    setSetup(s);
    setShowSetup(false);
  }, []);

  return (
    <div className="ts-panel">
      <div className="ts-header">
        <h3>Total Station</h3>
        <div className={`ts-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? `● Connected (${brand})` : '○ Disconnected'}
        </div>
      </div>

      {!connected ? (
        <div className="ts-connect-section">
          <button onClick={handleListPorts} className="btn btn-secondary">
            List Ports
          </button>
          {ports.length > 0 && (
            <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
              <option value="">Select port...</option>
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} ({p.manufacturer || 'unknown'})
                </option>
              ))}
            </select>
          )}
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
            <option value={9600}>9600</option>
            <option value={19200}>19200</option>
            <option value={38400}>38400</option>
            <option value={115200}>115200</option>
          </select>
          <button onClick={handleConnect} disabled={!selectedPort} className="btn btn-primary">
            Connect
          </button>
        </div>
      ) : (
        <div className="ts-connected-section">
          <div className="ts-station-info">
            {setup ? (
              <span>Station: {setup.stationNumber} | BS: {setup.backsightNumber}</span>
            ) : (
              <button onClick={() => setShowSetup(!showSetup)} className="btn btn-secondary btn-sm">
                Set Station Setup
              </button>
            )}
          </div>

          {showSetup && (
            <StationSetupForm onSet={handleSetStation} />
          )}

          <button onClick={handleMeasure} className="btn btn-primary ts-measure-btn">
            ⚡ Measure (Space)
          </button>
          <button onClick={handleDisconnect} className="btn btn-secondary btn-sm">
            Disconnect
          </button>
        </div>
      )}

      {lastShot && (
        <div className="ts-last-shot">
          <h4>Last Shot</h4>
          <table>
            <tbody>
              <tr><td>Point</td><td>{lastShot.pointNumber}</td></tr>
              <tr><td>Easting</td><td>{lastShot.easting.toFixed(3)}</td></tr>
              <tr><td>Northing</td><td>{lastShot.northing.toFixed(3)}</td></tr>
              <tr><td>Elevation</td><td>{lastShot.elevation.toFixed(3)}</td></tr>
              <tr><td>HZA</td><td>{lastShot.horizontalAngle.toFixed(4)}°</td></tr>
              <tr><td>VZA</td><td>{lastShot.verticalAngle.toFixed(4)}°</td></tr>
              <tr><td>SD</td><td>{lastShot.slopeDistance.toFixed(3)}m</td></tr>
              <tr><td>Face</td><td>{lastShot.face}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="ts-shot-count">
        Shots: {measurements.length}
      </div>

      {rawLog.length > 0 && (
        <div className="ts-raw-log" ref={logRef}>
          <h4>Serial Log</h4>
          {rawLog.slice(-10).map((line, i) => (
            <div key={i} className="ts-raw-line">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function StationSetupForm({ onSet }: { onSet: (s: StationSetup) => void }) {
  const [stationNumber, setStationNumber] = useState('');
  const [stationEasting, setStationEasting] = useState('');
  const [stationNorthing, setStationNorthing] = useState('');
  const [stationElevation, setStationElevation] = useState('');
  const [backsightNumber, setBacksightNumber] = useState('');
  const [backsightEasting, setBacksightEasting] = useState('');
  const [backsightNorthing, setBacksightNorthing] = useState('');
  const [instrumentHeight, setInstrumentHeight] = useState('1.5');
  const [targetHeight, setTargetHeight] = useState('1.5');

  return (
    <div className="ts-setup-form">
      <h4>Station Setup</h4>
      <input placeholder="Station #" value={stationNumber} onChange={(e) => setStationNumber(e.target.value)} />
      <input placeholder="Station E" type="number" value={stationEasting} onChange={(e) => setStationEasting(e.target.value)} />
      <input placeholder="Station N" type="number" value={stationNorthing} onChange={(e) => setStationNorthing(e.target.value)} />
      <input placeholder="Station Z" type="number" value={stationElevation} onChange={(e) => setStationElevation(e.target.value)} />
      <input placeholder="Backsight #" value={backsightNumber} onChange={(e) => setBacksightNumber(e.target.value)} />
      <input placeholder="BS E" type="number" value={backsightEasting} onChange={(e) => setBacksightEasting(e.target.value)} />
      <input placeholder="BS N" type="number" value={backsightNorthing} onChange={(e) => setBacksightNorthing(e.target.value)} />
      <input placeholder="HI (m)" type="number" value={instrumentHeight} onChange={(e) => setInstrumentHeight(e.target.value)} />
      <input placeholder="HT (m)" type="number" value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} />
      <button onClick={() => onSet({
        stationNumber, stationEasting: Number(stationEasting), stationNorthing: Number(stationNorthing),
        stationElevation: Number(stationElevation), backsightNumber,
        backsightEasting: Number(backsightEasting), backsightNorthing: Number(backsightNorthing),
        instrumentHeight: Number(instrumentHeight), targetHeight: Number(targetHeight),
      })} className="btn btn-primary">
        Set Station
      </button>
    </div>
  );
}
