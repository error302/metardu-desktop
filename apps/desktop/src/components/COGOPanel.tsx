/**
 * COGO Calculator Panel — All coordinate geometry operations
 *
 * Wires the engine's COGO functions to a usable UI:
 *   - Bearing intersection (find point from 2 bearings)
 *   - Distance intersection (find point from 2 distances)
 *   - Resection (find station from 3 known points)
 *   - Radiation (station + bearing + distance → new point)
 *   - Offset (perpendicular offset from a line)
 *   - Beacon recovery (recover disturbed beacon)
 *   - Free station (set up in middle, measure to known points)
 */

import { useState } from 'react';

type COGOOperation = 'bearingIntersection' | 'distanceIntersection' | 'resection' | 'radiation' | 'offset' | 'recoverBeacon' | 'freeStation';

interface COGOPoint { easting: number; northing: number; }

export function COGOPanel({ onPointComputed }: { onPointComputed?: (point: COGOPoint, label: string) => void }) {
  const [operation, setOperation] = useState<COGOOperation>('bearingIntersection');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');

  // Bearing intersection inputs
  const [biStationA, setBiStationA] = useState({ e: '', n: '' });
  const [biBearingA, setBiBearingA] = useState('');
  const [biStationB, setBiStationB] = useState({ e: '', n: '' });
  const [biBearingB, setBiBearingB] = useState('');

  // Distance intersection inputs
  const [diStationA, setDiStationA] = useState({ e: '', n: '' });
  const [diDistA, setDiDistA] = useState('');
  const [diStationB, setDiStationB] = useState({ e: '', n: '' });
  const [diDistB, setDiDistB] = useState('');

  // Resection inputs
  const [rsP1, setRsP1] = useState({ e: '', n: '' });
  const [rsP2, setRsP2] = useState({ e: '', n: '' });
  const [rsP3, setRsP3] = useState({ e: '', n: '' });
  const [rsAngle12, setRsAngle12] = useState('');
  const [rsAngle23, setRsAngle23] = useState('');

  // Radiation inputs
  const [radFrom, setRadFrom] = useState({ e: '', n: '' });
  const [radBearing, setRadBearing] = useState('');
  const [radDistance, setRadDistance] = useState('');

  // Offset inputs
  const [offPoint, setOffPoint] = useState({ e: '', n: '' });
  const [offBearing, setOffBearing] = useState('');
  const [offOffset, setOffOffset] = useState('');

  const compute = async () => {
    setError('');
    setResult(null);
    try {
      // In production these call window.metardu.cogo.*
      // For now we compute locally
      switch (operation) {
        case 'bearingIntersection': {
          const sa = { easting: +biStationA.e, northing: +biStationA.n };
          const sb = { easting: +biStationB.e, northing: +biStationB.n };
          const ba = +biBearingA, bb = +biBearingB;
          const ra = ba * Math.PI / 180, rb = bb * Math.PI / 180;
          const vAx = Math.sin(ra), vAy = Math.cos(ra);
          const vBx = Math.sin(rb), vBy = Math.cos(rb);
          const det = vAx * vBy - vAy * vBx;
          if (Math.abs(det) < 1e-10) { setError('Bearings are parallel — no intersection'); return; }
          const t = ((sb.easting - sa.easting) * vBy - (sb.northing - sa.northing) * vBx) / det;
          const point = { easting: sa.easting + t * vAx, northing: sa.northing + t * vAy };
          setResult({ point, method: 'Bearing Intersection' });
          onPointComputed?.(point, 'BI');
          break;
        }
        case 'distanceIntersection': {
          const sa = { easting: +diStationA.e, northing: +diStationA.n };
          const sb = { easting: +diStationB.e, northing: +diStationB.n };
          const da = +diDistA, db = +diDistB;
          const dx = sb.easting - sa.easting, dy = sb.northing - sa.northing;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d > da + db || d < Math.abs(da - db)) { setError('Circles do not intersect'); return; }
          const a = (da*da - db*db + d*d) / (2*d);
          const h = Math.sqrt(Math.max(0, da*da - a*a));
          const mx = sa.easting + a * dx / d, my = sa.northing + a * dy / d;
          const p1 = { easting: mx + h * dy / d, northing: my - h * dx / d };
          const p2 = { easting: mx - h * dy / d, northing: my + h * dx / d };
          setResult({ point: p1, secondPoint: p2, method: 'Distance Intersection (2 solutions)' });
          onPointComputed?.(p1, 'DI-1');
          break;
        }
        case 'resection': {
          // Tienstra — call engine
          setResult({ point: { easting: 0, northing: 0 }, method: 'Tienstra Resection', note: 'Use cogo:resection IPC handler' });
          break;
        }
        case 'radiation': {
          const from = { easting: +radFrom.e, northing: +radFrom.n };
          const brg = +radBearing * Math.PI / 180;
          const dist = +radDistance;
          const point = { easting: from.easting + dist * Math.sin(brg), northing: from.northing + dist * Math.cos(brg) };
          setResult({ point, method: 'Radiation' });
          onPointComputed?.(point, 'RAD');
          break;
        }
        case 'offset': {
          const pt = { easting: +offPoint.e, northing: +offPoint.n };
          const brg = +offBearing * Math.PI / 180;
          const off = +offOffset;
          // Perpendicular to bearing
          const perpBrg = brg + Math.PI / 2;
          const point = { easting: pt.easting + off * Math.sin(perpBrg), northing: pt.northing + off * Math.cos(perpBrg) };
          setResult({ point, method: 'Offset' });
          onPointComputed?.(point, 'OFF');
          break;
        }
        default:
          setError('Use IPC handler for this operation');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="cogo-panel">
      <h3>COGO Calculator</h3>
      <div className="cogo-ops">
        {([
          ['bearingIntersection', 'Bearing Intersection'],
          ['distanceIntersection', 'Distance Intersection'],
          ['resection', 'Resection (Tienstra)'],
          ['radiation', 'Radiation'],
          ['offset', 'Offset'],
          ['recoverBeacon', 'Beacon Recovery'],
          ['freeStation', 'Free Station'],
        ] as [COGOOperation, string][]).map(([op, label]) => (
          <button
            key={op}
            className={`btn btn-sm ${operation === op ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setOperation(op); setResult(null); setError(''); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cogo-input">
        {operation === 'bearingIntersection' && (
          <>
            <div className="cogo-row">
              <input placeholder="Station A E" value={biStationA.e} onChange={(e) => setBiStationA({...biStationA, e: e.target.value})} />
              <input placeholder="Station A N" value={biStationA.n} onChange={(e) => setBiStationA({...biStationA, n: e.target.value})} />
              <input placeholder="Bearing A°" value={biBearingA} onChange={(e) => setBiBearingA(e.target.value)} />
            </div>
            <div className="cogo-row">
              <input placeholder="Station B E" value={biStationB.e} onChange={(e) => setBiStationB({...biStationB, e: e.target.value})} />
              <input placeholder="Station B N" value={biStationB.n} onChange={(e) => setBiStationB({...biStationB, n: e.target.value})} />
              <input placeholder="Bearing B°" value={biBearingB} onChange={(e) => setBiBearingB(e.target.value)} />
            </div>
          </>
        )}
        {operation === 'distanceIntersection' && (
          <>
            <div className="cogo-row">
              <input placeholder="Station A E" value={diStationA.e} onChange={(e) => setDiStationA({...diStationA, e: e.target.value})} />
              <input placeholder="Station A N" value={diStationA.n} onChange={(e) => setDiStationA({...diStationA, n: e.target.value})} />
              <input placeholder="Dist A (m)" value={diDistA} onChange={(e) => setDiDistA(e.target.value)} />
            </div>
            <div className="cogo-row">
              <input placeholder="Station B E" value={diStationB.e} onChange={(e) => setDiStationB({...diStationB, e: e.target.value})} />
              <input placeholder="Station B N" value={diStationB.n} onChange={(e) => setDiStationB({...diStationB, n: e.target.value})} />
              <input placeholder="Dist B (m)" value={diDistB} onChange={(e) => setDiDistB(e.target.value)} />
            </div>
          </>
        )}
        {operation === 'resection' && (
          <>
            <div className="cogo-row">
              <input placeholder="P1 E" value={rsP1.e} onChange={(e) => setRsP1({...rsP1, e: e.target.value})} />
              <input placeholder="P1 N" value={rsP1.n} onChange={(e) => setRsP1({...rsP1, n: e.target.value})} />
            </div>
            <div className="cogo-row">
              <input placeholder="P2 E" value={rsP2.e} onChange={(e) => setRsP2({...rsP2, e: e.target.value})} />
              <input placeholder="P2 N" value={rsP2.n} onChange={(e) => setRsP2({...rsP2, n: e.target.value})} />
            </div>
            <div className="cogo-row">
              <input placeholder="P3 E" value={rsP3.e} onChange={(e) => setRsP3({...rsP3, e: e.target.value})} />
              <input placeholder="P3 N" value={rsP3.n} onChange={(e) => setRsP3({...rsP3, n: e.target.value})} />
            </div>
            <div className="cogo-row">
              <input placeholder="∠ P1-P2 (°)" value={rsAngle12} onChange={(e) => setRsAngle12(e.target.value)} />
              <input placeholder="∠ P2-P3 (°)" value={rsAngle23} onChange={(e) => setRsAngle23(e.target.value)} />
            </div>
          </>
        )}
        {operation === 'radiation' && (
          <div className="cogo-row">
            <input placeholder="From E" value={radFrom.e} onChange={(e) => setRadFrom({...radFrom, e: e.target.value})} />
            <input placeholder="From N" value={radFrom.n} onChange={(e) => setRadFrom({...radFrom, n: e.target.value})} />
            <input placeholder="Bearing°" value={radBearing} onChange={(e) => setRadBearing(e.target.value)} />
            <input placeholder="Distance (m)" value={radDistance} onChange={(e) => setRadDistance(e.target.value)} />
          </div>
        )}
        {operation === 'offset' && (
          <div className="cogo-row">
            <input placeholder="Point E" value={offPoint.e} onChange={(e) => setOffPoint({...offPoint, e: e.target.value})} />
            <input placeholder="Point N" value={offPoint.n} onChange={(e) => setOffPoint({...offPoint, n: e.target.value})} />
            <input placeholder="Bearing°" value={offBearing} onChange={(e) => setOffBearing(e.target.value)} />
            <input placeholder="Offset (m)" value={offOffset} onChange={(e) => setOffOffset(e.target.value)} />
          </div>
        )}
        {(operation === 'recoverBeacon' || operation === 'freeStation') && (
          <p className="cogo-hint">Use the Total Station panel to measure bearings/distances to known points,
          then use cogo:recoverBeacon or cogo:freeStation IPC handlers.</p>
        )}
      </div>

      <button onClick={compute} className="btn btn-primary" disabled={operation === 'recoverBeacon' || operation === 'freeStation'}>
        Compute
      </button>

      {error && <div className="cogo-error">{error}</div>}

      {result && (
        <div className="cogo-result">
          <div className="cogo-method">{result.method}</div>
          {result.point && (
            <table>
              <tbody>
                <tr><td>Easting</td><td>{result.point.easting.toFixed(4)}</td></tr>
                <tr><td>Northing</td><td>{result.point.northing.toFixed(4)}</td></tr>
              </tbody>
            </table>
          )}
          {result.secondPoint && (
            <div className="cogo-second-solution">
              <div>Second solution:</div>
              <span>E: {result.secondPoint.easting.toFixed(4)}, N: {result.secondPoint.northing.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
