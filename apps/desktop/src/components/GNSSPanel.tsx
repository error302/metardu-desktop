/**
 * GNSS RTK Live Panel — Real-time rover position with fix quality
 *
 * OV-UI3: Shows the current GNSS rover position on the map with a
 * color-coded fix quality indicator (green=fixed, yellow=float,
 * orange=dgps, red=autonomous). Includes satellite skyplot data
 * and precision information.
 *
 * Listens to IPC events:
 *   gnss:position, gnss:satellite, gnss:satellites_in_view, gnss:precision
 *   ntrip:connected, ntrip:disconnected, ntrip:correction, ntrip:error
 */

import { useEffect, useState, useRef } from 'react';

interface GNSSPosition {
  latitude: number;
  longitude: number;
  elevation: number;
  fixQuality: 'fixed' | 'float' | 'dgps' | 'autonomous' | 'invalid';
  satellitesTracked: number;
  satellitesInView: number;
  hdop: number;
  vdop: number;
  pdop: number;
  timestamp: string;
  ageOfCorrections?: number;
  stationId?: string;
}

interface Satellite {
  system: string;
  prn: number;
  elevation: number;
  azimuth: number;
  snr: number;
}

const FIX_COLORS: Record<string, string> = {
  fixed: '#00ff00',
  float: '#ffff00',
  dgps: '#ff9900',
  autonomous: '#ff0000',
  invalid: '#666666',
};

const FIX_LABELS: Record<string, string> = {
  fixed: 'RTK Fixed',
  float: 'RTK Float',
  dgps: 'DGPS',
  autonomous: 'Autonomous',
  invalid: 'No Fix',
};

export function GNSSPanel() {
  const [position, setPosition] = useState<GNSSPosition | null>(null);
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [satsInView, setSatsInView] = useState(0);
  const [precision, setPrecision] = useState<{ stdLat: number; stdLon: number; stdAlt: number } | null>(null);
  const [ntripConnected, setNtripConnected] = useState(false);
  const [ntripMountpoint, setNtripMountpoint] = useState('');
  const [correctionsReceived, setCorrectionsReceived] = useState(0);
  const [rinexRecording, setRinexRecording] = useState(false);
  const [showSkyplot, setShowSkyplot] = useState(true);
  const skyplotRef = useRef<HTMLCanvasElement>(null);

  // NTRIP config form state
  const [ntripHost, setNtripHost] = useState('');
  const [ntripPort, setNtripPort] = useState('2101');
  const [ntripMount, setNtripMount] = useState('');
  const [ntripUser, setNtripUser] = useState('');
  const [ntripPass, setNtripPass] = useState('');
  const [showNtripConfig, setShowNtripConfig] = useState(false);

  // Listen to GNSS + NTRIP events
  useEffect(() => {
    const handlePosition = (_e: unknown, pos: GNSSPosition) => setPosition(pos);
    const handleSatellite = (_e: unknown, sat: Satellite) => {
      setSatellites((prev) => {
        const filtered = prev.filter((s) => s.prn !== sat.prn || s.system !== sat.system);
        return [...filtered, sat];
      });
    };
    const handleSatsInView = (_e: unknown, info: { count: number }) => setSatsInView(info.count);
    const handlePrecision = (_e: unknown, prec: any) => setPrecision(prec);
    const handleNtripConnected = (_e: unknown, info: any) => {
      setNtripConnected(true);
      setNtripMountpoint(info?.mountpoint ?? '');
    };
    const handleNtripDisconnected = () => {
      setNtripConnected(false);
      setNtripMountpoint('');
    };
    const handleNtripCorrection = (_e: unknown, size: number) => {
      setCorrectionsReceived((prev) => prev + size);
    };
    const handleNtripError = (_e: unknown, err: string) => {
      console.warn('NTRIP error:', err);
    };

    window.addEventListener('gnss:position', handlePosition as any);
    window.addEventListener('gnss:satellite', handleSatellite as any);
    window.addEventListener('gnss:satellites_in_view', handleSatsInView as any);
    window.addEventListener('gnss:precision', handlePrecision as any);
    window.addEventListener('ntrip:connected', handleNtripConnected as any);
    window.addEventListener('ntrip:disconnected', handleNtripDisconnected as any);
    window.addEventListener('ntrip:correction', handleNtripCorrection as any);
    window.addEventListener('ntrip:error', handleNtripError as any);

    return () => {
      window.removeEventListener('gnss:position', handlePosition as any);
      window.removeEventListener('gnss:satellite', handleSatellite as any);
      window.removeEventListener('gnss:satellites_in_view', handleSatsInView as any);
      window.removeEventListener('gnss:precision', handlePrecision as any);
      window.removeEventListener('ntrip:connected', handleNtripConnected as any);
      window.removeEventListener('ntrip:disconnected', handleNtripDisconnected as any);
      window.removeEventListener('ntrip:correction', handleNtripCorrection as any);
      window.removeEventListener('ntrip:error', handleNtripError as any);
    };
  }, []);

  // Draw skyplot
  useEffect(() => {
    if (!showSkyplot || !skyplotRef.current) return;
    const canvas = skyplotRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 10;

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Draw elevation rings (90° = center, 0° = edge)
    ctx.strokeStyle = '#333355';
    ctx.lineWidth = 1;
    for (let elev = 0; elev <= 90; elev += 30) {
      const ringR = r * (1 - elev / 90);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw cardinal lines
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#666688';
    ctx.font = '10px monospace';
    ctx.fillText('N', cx - 3, cy - r - 2);
    ctx.fillText('S', cx - 3, cy + r + 10);
    ctx.fillText('E', cx + r + 2, cy + 3);
    ctx.fillText('W', cx - r - 10, cy + 3);

    // Draw satellites
    for (const sat of satellites) {
      if (sat.snr === 0) continue;  // not tracked
      const ringR = r * (1 - sat.elevation / 90);
      const az = (sat.azimuth * Math.PI) / 180;
      const sx = cx + ringR * Math.sin(az);
      const sy = cy - ringR * Math.cos(az);

      // Color by SNR
      const snrColor = sat.snr > 40 ? '#00ff00' : sat.snr > 30 ? '#ffff00' : sat.snr > 20 ? '#ff9900' : '#ff0000';
      ctx.fillStyle = snrColor;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();

      // PRN label
      ctx.fillStyle = '#aaaacc';
      ctx.font = '8px monospace';
      ctx.fillText(`${sat.prn}`, sx + 5, sy + 3);
    }
  }, [satellites, showSkyplot]);

  const fixColor = position ? FIX_COLORS[position.fixQuality] : '#666';
  const fixLabel = position ? FIX_LABELS[position.fixQuality] : 'No Data';

  return (
    <div className="gnss-panel">
      <div className="gnss-header">
        <h3>GNSS RTK</h3>
        <div className="gnss-fix-indicator" style={{ color: fixColor }}>
          ● {fixLabel}
        </div>
      </div>

      {/* NTRIP Status */}
      <div className="gnss-ntrip-section">
        {ntripConnected ? (
          <div className="gnss-ntrip-connected">
            <span className="gnss-ntrip-status connected">
              ● NTRIP: {ntripMountpoint}
            </span>
            <span className="gnss-corrections">
              {(correctionsReceived / 1024).toFixed(1)} KB received
            </span>
            <button onClick={() => setRinexRecording(!rinexRecording)} className="btn btn-sm">
              {rinexRecording ? '⏹ Stop RINEX' : '● Record RINEX'}
            </button>
          </div>
        ) : (
          <div className="gnss-ntrip-disconnected">
            <button onClick={() => setShowNtripConfig(!showNtripConfig)} className="btn btn-secondary btn-sm">
              Configure NTRIP
            </button>
          </div>
        )}

        {showNtripConfig && !ntripConnected && (
          <div className="gnss-ntrip-form">
            <input placeholder="Host (e.g. cors.ardhisasa.go.ke)" value={ntripHost} onChange={(e) => setNtripHost(e.target.value)} />
            <input placeholder="Port" value={ntripPort} onChange={(e) => setNtripPort(e.target.value)} style={{ width: '60px' }} />
            <input placeholder="Mountpoint" value={ntripMount} onChange={(e) => setNtripMount(e.target.value)} />
            <input placeholder="Username (optional)" value={ntripUser} onChange={(e) => setNtripUser(e.target.value)} />
            <input placeholder="Password" type="password" value={ntripPass} onChange={(e) => setNtripPass(e.target.value)} />
            <button className="btn btn-primary btn-sm">Connect NTRIP</button>
          </div>
        )}
      </div>

      {/* Position Display */}
      {position && (
        <div className="gnss-position">
          <table>
            <tbody>
              <tr><td>Latitude</td><td>{position.latitude.toFixed(8)}°</td></tr>
              <tr><td>Longitude</td><td>{position.longitude.toFixed(8)}°</td></tr>
              <tr><td>Elevation</td><td>{position.elevation.toFixed(3)} m</td></tr>
              <tr><td>Sats tracked</td><td>{position.satellitesTracked} / {satsInView} in view</td></tr>
              <tr><td>HDOP</td><td>{position.hdop.toFixed(2)}</td></tr>
              {position.ageOfCorrections !== undefined && (
                <tr><td>Corr. age</td><td>{position.ageOfCorrections.toFixed(1)}s</td></tr>
              )}
              {position.stationId && (
                <tr><td>Base station</td><td>{position.stationId}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Precision */}
      {precision && (
        <div className="gnss-precision">
          <h4>Precision (1σ)</h4>
          <table>
            <tbody>
              <tr><td>σ Lat</td><td>±{precision.stdLat.toFixed(3)} m</td></tr>
              <tr><td>σ Lon</td><td>±{precision.stdLon.toFixed(3)} m</td></tr>
              <tr><td>σ Alt</td><td>±{precision.stdAlt.toFixed(3)} m</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Skyplot */}
      <div className="gnss-skyplot-section">
        <label>
          <input type="checkbox" checked={showSkyplot} onChange={(e) => setShowSkyplot(e.target.checked)} />
          Satellite Skyplot
        </label>
        {showSkyplot && (
          <canvas ref={skyplotRef} width={200} height={200} className="gnss-skyplot" />
        )}
      </div>

      {/* Satellite List */}
      {satellites.length > 0 && (
        <div className="gnss-sat-list">
          <h4>Satellites ({satellites.filter(s => s.snr > 0).length} tracked)</h4>
          <div className="gnss-sat-grid">
            {satellites.filter(s => s.snr > 0).sort((a, b) => b.snr - a.snr).map((sat) => (
              <div key={`${sat.system}-${sat.prn}`} className="gnss-sat-item">
                <span className="gnss-sat-prn" style={{ color: sat.snr > 40 ? '#0f0' : sat.snr > 30 ? '#ff0' : '#f90' }}>
                  {sat.system[0]}{sat.prn:02d}
                </span>
                <span className="gnss-sat-snr">{sat.snr}dB</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
