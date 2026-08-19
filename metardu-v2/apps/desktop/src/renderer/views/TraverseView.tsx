/**
 * Traverse & Network Adjustment view with live instrument integration.
 *
 * Four adjustment modes:
 *   1. Bowditch / Transit — classic traverse closure
 *   2. Least Squares (Distance) — LS with distance observations
 *   3. Mixed Network (Distance + GNSS) — LS with traverse legs + GNSS baselines
 *
 * NEW: Live instrument panel that connects to total stations or GNSS receivers
 * via serial/BLE and auto-populates traverse legs from streaming observations.
 *
 * Observation types supported:
 *   - Total station distance + bearing → direct traverse legs
 *   - GNSS GGA positions → distance/bearing between consecutive fixes
 *   - GNSS RTK-fixed positions → GNSS baselines for mixed network
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyLine } from "@metardu/ui-components";
import { useSurveyState, type CrossImportPayload } from "../SurveyStateContext.js";
import { COUNTRY_OPTIONS } from "../countries.js";
import { AutoExportBanner } from "./AutoExportBanner.js";
import { Radio, Wifi, Bluetooth, Plug, Unplug, CircleDot, Target, Plus, Trash2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────

type AdjustMode = "bowditch" | "transit" | "ls-distance" | "ls-mixed" | "ls-angles";

interface PointDef { id: string; easting: number; northing: number; fixed: boolean; }
interface LegDef { from: string; to: string; distance: number; bearing: number; sigma: number; }
interface DirectionDef { station: string; target: string; direction: number; sigma: number; }
interface AngleDef { station: string; leftTarget: string; rightTarget: string; angle: number; sigma: number; }
interface AzimuthDef { from: string; to: string; azimuth: number; sigma: number; }
interface BaselineDef { from: string; to: string; dE: number; dN: number; dH: number; sigmaE: number; sigmaN: number; sigmaH: number; correlationEN: number; }

interface LsResult {
  adjusted: Array<{ id: string; easting: number; northing: number; height: number | null }>;
  residuals: Array<{ from: string; to: string; kind: string; residual: number; redundancy: number; wStatistic: number }>;
  sigma0Squared: number; chiSquare: number; chiSquarePasses: boolean; degreesOfFreedom: number; iterations: number;
}

interface BowditchResult {
  stations: Array<{ id: string; easting: number; northing: number; adjE: number; adjN: number }>;
  perimeter: number; linearMisclosure: number; precisionRatio: number; precisionPasses: boolean;
}

interface LiveFix {
  timestamp: string;
  latitude: number;
  longitude: number;
  easting: number;
  northing: number;
  fixQuality: number;
  hdop: number;
  satelliteCount: number;
  altitude: number;
}

interface RecordedLeg {
  id: string;
  from: string;
  to: string;
  distance: number;
  bearing: number;
  fromE: number; fromN: number; toE: number; toN: number;
  sigma: number;
  source: "live" | "manual";
}

// ─── Sidecar call ─────────────────────────────────────────────────

async function callSidecar(method: string, params: Record<string, unknown>): Promise<unknown> {
  return (window as any).metardu?.sidecar?.call?.(method, params) ?? null;
}

// ─── ENU projection (simple equirectangular for short distances) ──

function latLonToEn(lat: number, lon: number, refLat: number, refLon: number): { e: number; n: number } {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((refLat * Math.PI) / 180);
  return {
    e: (lon - refLon) * mPerDegLon,
    n: (lat - refLat) * mPerDegLat,
  };
}

function computeDistanceBearing(e1: number, n1: number, e2: number, n2: number): { distance: number; bearing: number } {
  const de = e2 - e1;
  const dn = n2 - n1;
  const distance = Math.sqrt(de * de + dn * dn);
  let bearing = (Math.atan2(de, dn) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;
  return { distance, bearing };
}

function fixQualityToSigma(quality: number): number {
  if (quality === 4) return 0.005;  // RTK Fixed: 5mm
  if (quality === 5) return 0.050;  // RTK Float: 50mm
  if (quality === 2) return 0.500;  // DGPS: 500mm
  if (quality === 1) return 3.000;  // SPP: 3m
  return 10.0; // Unknown
}

// ─── Main component ──────────────────────────────────────────────

export const TraverseView: React.FC = () => {
  const { setSurveyOutput, crossImport, setCrossImport } = useSurveyState();
  const [countryCode, setCountryCode] = useState("KE");
  const [mode, setMode] = useState<AdjustMode>("ls-mixed");
  const [crossImportNotice, setCrossImportNotice] = useState<string | null>(null);

  // ── Cross-import: receive COGO points as stations ──────────────────
  useEffect(() => {
    if (crossImport?.type === "cogo_points" && crossImport.points.length >= 2) {
      const pts = crossImport.points;
      // Add imported points to the points CSV
      const newPts = pts.map((p) => `${p.id},${p.easting.toFixed(3)},${p.northing.toFixed(3)},false`).join("\n");
      setPointsText((prev) => {
        const existingIds = new Set(prev.trim().split("\n").map((l) => l.split(",")[0]?.trim()));
        const uniqueNew = pts.filter((p) => !existingIds.has(p.id));
        if (uniqueNew.length === 0) return prev;
        const additions = uniqueNew.map((p) => `${p.id},${p.easting.toFixed(3)},${p.northing.toFixed(3)},false`).join("\n");
        return prev ? prev + "\n" + additions : additions;
      });
      setCrossImportNotice(`Imported ${pts.length} points from COGO as stations.`);
      setCrossImport(null);
    }
  }, [crossImport, setCrossImport]);

  // ── Push LS results to COGO for area verification ─────────────────
  const pushToCogo = useCallback(() => {
    if (!lsResult) return;
    const payload: CrossImportPayload = {
      type: "traverse_results",
      adjusted: lsResult.adjusted,
      residuals: lsResult.residuals,
      sigma0Squared: lsResult.sigma0Squared,
      timestamp: new Date().toISOString(),
    };
    setCrossImport(payload);
    setCrossImportNotice(`Pushed ${lsResult.adjusted.length} adjusted coordinates to COGO area calculator.`);
  }, [lsResult, setCrossImport]);

  // Points / legs / baselines (CSV text)
  const [pointsText, setPointsText] = useState(
    "STN1,257000.0,9857000.0,true\nSTN2,257100.0,9857100.0,false\nSTN3,257050.0,9857250.0,false\nSTN4,256950.0,9857200.0,false"
  );
  const [legsText, setLegsText] = useState(
    "STN1,STN2,125.450,45.2500,0.005\nSTN2,STN3,180.200,135.5000,0.005\nSTN3,STN4,140.650,225.1200,0.005\nSTN4,STN1,165.100,314.8500,0.005"
  );
  const [baselinesText, setBaselinesText] = useState(
    "STN1,STN3,-50.123,250.456,15.2,0.015,0.015,0.030,0.6\nSTN2,STN4,48.789,98.654,8.5,0.015,0.015,0.030,0.6"
  );

  // Angular observations
  const [directionsText, setDirectionsText] = useState(
    "STN1,STN2,45.2500,5\nSTN1,STN3,128.7650,5\nSTN1,STN4,215.1200,5\nSTN2,STN1,225.2500,5\nSTN2,STN3,135.5000,5\nSTN2,STN4,45.8000,5"
  );
  const [azimuthText, setAzimuthText] = useState(
    "STN1,STN2,45.2500,3"
  );

  const [bowditchResult, setBowditchResult] = useState<BowditchResult | null>(null);
  const [lsResult, setLsResult] = useState<LsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  // ── Live instrument state ───────────────────────────────────────
  const [connType, setConnType] = useState<"serial" | "bluetooth" | "ntrip">("serial");
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [casterUrl, setCasterUrl] = useState("");
  const [mountpoint, setMountpoint] = useState("");
  const [connName, setConnName] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [liveFix, setLiveFix] = useState<LiveFix | null>(null);
  const [obsCount, setObsCount] = useState(0);
  const [recordedLegs, setRecordedLegs] = useState<RecordedLeg[]>([]);
  const [autoRecord, setAutoRecord] = useState(false);
  const [instrumentError, setInstrumentError] = useState<string | null>(null);
  const [serialPorts, setSerialPorts] = useState<Array<{ port_name: string; display_name: string }>>([]);
  const lastFixRef = useRef<LiveFix | null>(null);
  const legCounterRef = useRef(1);

  const api = (window as any).metardu;

  // ── Load serial ports on mount ──────────────────────────────────
  useEffect(() => {
    if (!api?.instrument) return;
    api.instrument.listPorts().then((r: any) => {
      if (r?.ports) {
        setSerialPorts(r.ports);
        if (r.ports.length > 0 && !selectedPort) setSelectedPort(r.ports[0].port_name);
      }
    }).catch(() => {});
  }, []);

  // ── Subscribe to live observations ──────────────────────────────
  useEffect(() => {
    if (!api?.instrument) return;

    const unsubObs = api.instrument.onObservation((data: any) => {
      const obs = data?.observation;
      if (!obs?.data) return;

      setObsCount((c) => c + 1);

      // GGA: position fix
      if (obs.sentence_type === "GGA" && obs.data) {
        const d = obs.data;
        if (d.latitude !== undefined && d.longitude !== undefined) {
          // Convert lat/lon to local ENU (using first fix as reference)
          const refLat = lastFixRef.current?.latitude ?? d.latitude;
          const refLon = lastFixRef.current?.longitude ?? d.longitude;
          const en = latLonToEn(d.latitude, d.longitude, refLat, refLon);

          // Use initial approximate E/N from the first point as reference
          const pts = pointsText.trim().split("\n").filter((l) => l.trim());
          const firstPt = pts[0]?.split(",").map((s) => s.trim());
          const baseE = firstPt ? parseFloat(firstPt[1]) : 257000;
          const baseN = firstPt ? parseFloat(firstPt[2]) : 9857000;

          const fix: LiveFix = {
            timestamp: obs.timestamp || new Date().toISOString(),
            latitude: d.latitude,
            longitude: d.longitude,
            easting: baseE + en.e,
            northing: baseN + en.n,
            fixQuality: d.fix_quality ?? 0,
            hdop: d.hdop ?? 99,
            satelliteCount: d.satellite_count ?? 0,
            altitude: d.altitude_m ?? 0,
          };

          setLiveFix(fix);

          // Auto-record traverse leg if enabled and we have a previous fix
          if (autoRecord && lastFixRef.current) {
            const prev = lastFixRef.current;
            const { distance, bearing } = computeDistanceBearing(prev.easting, prev.northing, fix.easting, fix.northing);

            // Only record if distance > 0.5m (filter noise)
            if (distance > 0.5) {
              const fromId = `LIVE${legCounterRef.current}`;
              const toId = `LIVE${legCounterRef.current + 1}`;
              const sigma = fixQualityToSigma(fix.fixQuality);

              const leg: RecordedLeg = {
                id: `leg${legCounterRef.current}`,
                from: fromId,
                to: toId,
                distance,
                bearing,
                fromE: prev.easting, fromN: prev.northing,
                toE: fix.easting, toN: fix.northing,
                sigma,
                source: "live",
              };

              setRecordedLegs((prev) => [...prev, leg]);
              legCounterRef.current += 1;
            }
          }

          lastFixRef.current = fix;
        }
      }
    });

    const unsubStatus = api.instrument.onStatusUpdate((data: any) => {
      if (data?.connections) {
        const hasConn = data.connections.length > 0;
        setConnected(hasConn);
        if (hasConn) setConnectionId(data.connections[0].id);
      }
    });

    api.instrument.startPolling();

    return () => { unsubObs(); unsubStatus(); api.instrument.stopPolling(); };
  }, [autoRecord, pointsText]);

  // ── Connect / Disconnect ────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    if (!api?.instrument) return;
    setInstrumentError(null);
    try {
      const params: any = { connection_type: connType, instrument_name: connName || undefined };
      if (connType === "serial") { params.port = selectedPort; params.baud_rate = baudRate; }
      else if (connType === "ntrip") { params.caster_url = casterUrl; params.mountpoint = mountpoint; }
      const result = await api.instrument.connect(params);
      setConnectionId(result.connection_id);
      setConnected(true);
    } catch (e) {
      setInstrumentError((e as Error).message);
    }
  }, [connType, selectedPort, baudRate, casterUrl, mountpoint, connName]);

  const handleDisconnect = useCallback(async () => {
    if (!api?.instrument || !connectionId) return;
    try {
      await api.instrument.disconnect(connectionId);
      setConnected(false);
      setConnectionId(null);
    } catch (e) {
      setInstrumentError((e as Error).message);
    }
  }, [connectionId]);

  // ── Record current fix as a manual leg ──────────────────────────
  const recordCurrentFix = useCallback(() => {
    if (!liveFix) return;
    const pts = pointsText.trim().split("\n").filter((l) => l.trim());
    const lastRecorded = recordedLegs.length > 0 ? recordedLegs[recordedLegs.length - 1] : null;

    if (lastRecorded) {
      const { distance, bearing } = computeDistanceBearing(lastRecorded.toE, lastRecorded.toN, liveFix.easting, liveFix.northing);
      if (distance > 0.5) {
        const fromId = lastRecorded.to;
        const toId = `PT${pts.length + recordedLegs.length + 1}`;
        setRecordedLegs((prev) => [...prev, {
          id: `leg${Date.now()}`, from: fromId, to: toId, distance, bearing,
          fromE: lastRecorded.toE, fromN: lastRecorded.toN, toE: liveFix.easting, toN: liveFix.northing,
          sigma: fixQualityToSigma(liveFix.fixQuality), source: "manual",
        }]);
      }
    } else {
      // First manual leg: use the first point as start
      const firstPt = pts[0]?.split(",").map((s) => s.trim());
      if (firstPt) {
        const fromE = parseFloat(firstPt[1]);
        const fromN = parseFloat(firstPt[2]);
        const { distance, bearing } = computeDistanceBearing(fromE, fromN, liveFix.easting, liveFix.northing);
        if (distance > 0.5) {
          setRecordedLegs([{
            id: `leg${Date.now()}`, from: firstPt[0], to: `PT${pts.length + 1}`, distance, bearing,
            fromE, fromN, toE: liveFix.easting, toN: liveFix.northing,
            sigma: fixQualityToSigma(liveFix.fixQuality), source: "manual",
          }]);
        }
      }
    }
  }, [liveFix, pointsText, recordedLegs]);

  // ── Apply recorded legs to the CSV text ─────────────────────────
  const applyRecordedLegs = useCallback(() => {
    if (recordedLegs.length === 0) return;

    // Append recorded legs to the legs CSV
    const newLegs = recordedLegs.map((l) => `${l.from},${l.to},${l.distance.toFixed(3)},${l.bearing.toFixed(4)},${l.sigma.toFixed(4)}`).join("\n");
    setLegsText((prev) => prev ? prev + "\n" + newLegs : newLegs);

    // Add any new points from recorded legs
    const existingPts = new Set(pointsText.split("\n").filter((l) => l.trim()).map((l) => l.split(",")[0].trim()));
    const newPoints: string[] = [];
    for (const leg of recordedLegs) {
      if (!existingPts.has(leg.from)) {
        newPoints.push(`${leg.from},${leg.fromE.toFixed(1)},${leg.fromN.toFixed(1)},false`);
        existingPts.add(leg.from);
      }
      if (!existingPts.has(leg.to)) {
        newPoints.push(`${leg.to},${leg.toE.toFixed(1)},${leg.toN.toFixed(1)},false`);
        existingPts.add(leg.to);
      }
    }
    if (newPoints.length > 0) {
      setPointsText((prev) => prev + "\n" + newPoints.join("\n"));
    }

    setRecordedLegs([]);
    legCounterRef.current = 1;
  }, [recordedLegs, pointsText]);

  // ── Clear recorded legs ─────────────────────────────────────────
  const clearRecordedLegs = useCallback(() => {
    setRecordedLegs([]);
    legCounterRef.current = 1;
  }, []);

  // ── Parse helpers ───────────────────────────────────────────────

  const parsePoints = useCallback((): PointDef[] => {
    return pointsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [id, e, n, f] = line.split(",").map((s) => s.trim());
      return { id, easting: parseFloat(e), northing: parseFloat(n), fixed: f === "true" };
    });
  }, [pointsText]);

  const parseLegs = useCallback((): LegDef[] => {
    return legsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from, to, dist, brg, sig] = line.split(",").map((s) => s.trim());
      return { from, to, distance: parseFloat(dist), bearing: parseFloat(brg), sigma: sig ? parseFloat(sig) : 0.005 };
    });
  }, [legsText]);

  const parseDirections = useCallback((): DirectionDef[] => {
    if (!directionsText.trim()) return [];
    return directionsText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [station, target, dir, sig] = line.split(",").map((s) => s.trim());
      return { station, target, direction: parseFloat(dir), sigma: sig ? parseFloat(sig) / 3600 : 5 / 3600 };
    });
  }, [directionsText]);

  const parseAzimuths = useCallback((): AzimuthDef[] => {
    if (!azimuthText.trim()) return [];
    return azimuthText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from, to, az, sig] = line.split(",").map((s) => s.trim());
      return { from, to, azimuth: parseFloat(az), sigma: sig ? parseFloat(sig) / 3600 : 3 / 3600 };
    });
  }, [azimuthText]);

  const parseBaselines = useCallback((): BaselineDef[] => {
    if (!baselinesText.trim()) return [];
    return baselinesText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const [from, to, dE, dN, dH, sE, sN, sH, corr] = line.split(",").map((s) => s.trim());
      return { from, to, dE: parseFloat(dE), dN: parseFloat(dN), dH: parseFloat(dH), sigmaE: parseFloat(sE), sigmaN: parseFloat(sN), sigmaH: parseFloat(sH), correlationEN: corr ? parseFloat(corr) : 0 };
    });
  }, [baselinesText]);

  // ── Bowditch / Transit ──────────────────────────────────────────

  const computeBowditch = useCallback(() => {
    setError(null); setLsResult(null);
    try {
      const points = parsePoints(); const legs = parseLegs();
      const startPt = points.find((p) => p.fixed);
      if (!startPt) throw new Error("Need at least one fixed point");

      let totalDist = 0, sumDE = 0, sumDN = 0;
      const raw: Array<{ id: string; rawE: number; rawN: number; dE: number; dN: number; dist: number }> = [];
      let curE = startPt.easting, curN = startPt.northing;

      for (const leg of legs) {
        const rad = (leg.bearing * Math.PI) / 180;
        const dE = leg.distance * Math.sin(rad); const dN = leg.distance * Math.cos(rad);
        curE += dE; curN += dN; totalDist += leg.distance; sumDE += dE; sumDN += dN;
        raw.push({ id: leg.to, rawE: curE, rawN: curN, dE, dN, dist: leg.distance });
      }

      const misclosure = Math.sqrt(sumDE * sumDE + sumDN * sumDN);
      const precisionRatio = misclosure > 0 ? Math.round(totalDist / misclosure) : 999999;
      const isTransit = mode === "transit";
      let cumDist = 0, adjE = startPt.easting, adjN = startPt.northing;
      const stations: BowditchResult["stations"] = [{ id: startPt.id, easting: startPt.easting, northing: startPt.northing, adjE, adjN }];

      for (const u of raw) {
        cumDist += u.dist;
        const corrE = -(sumDE * (cumDist / totalDist));
        const corrN = -(sumDN * (isTransit ? cumDist / totalDist : cumDist / totalDist));
        adjE = u.rawE + corrE; adjN = u.rawN + corrN;
        stations.push({ id: u.id, easting: u.rawE, northing: u.rawN, adjE, adjN });
      }

      setBowditchResult({ stations, perimeter: totalDist, linearMisclosure: misclosure, precisionRatio, precisionPasses: precisionRatio >= 10000 });
      setSurveyOutput({ type: "traverse", stations, perimeter: totalDist, linearMisclosure: misclosure, precisionRatio }, "cadastral", "TraverseView", countryCode);
    } catch (e) { setError((e as Error).message); }
  }, [mode, parsePoints, parseLegs, countryCode, setSurveyOutput]);

  // ── LS adjustment ───────────────────────────────────────────────

  const computeLs = useCallback(async () => {
    setError(null); setBowditchResult(null); setComputing(true);
    try {
      const points = parsePoints(); const legs = parseLegs(); const baselines = parseBaselines();
      const directions = parseDirections(); const azimuths = parseAzimuths();
      const isMixed = mode === "ls-mixed";
      const isAngles = mode === "ls-angles";
      const parameters = points.map((p) => ({ id: p.id, dimension: 2, fixed: p.fixed }));

      if ((isMixed || isAngles) && baselines.length > 0) {
        const gnssPts = new Set(baselines.flatMap((b) => [b.from, b.to]));
        for (const param of parameters) { if (gnssPts.has(param.id)) param.dimension = 3; }
      }

      const approximations: Record<string, number[]> = {};
      for (const p of points) {
        const dim = parameters.find((pp) => pp.id === p.id)?.dimension ?? 2;
        approximations[p.id] = dim === 3 ? [p.easting, p.northing, 0] : [p.easting, p.northing];
      }

      const observations: Array<Record<string, unknown>> = [];

      // Distance observations (from traverse legs)
      for (const leg of legs) {
        observations.push({ kind: "Distance", from: leg.from, to: leg.to, value: leg.distance, sigma: leg.sigma });
      }

      // Direction observations (measured horizontal angles from a station)
      // Each direction is referenced to an orientation parameter at the station
      for (const d of directions) {
        observations.push({ kind: "Direction", station: d.station, target: d.target, value: d.direction, sigma: d.sigma });
      }

      // Azimuth control observations (known azimuth constraining orientation)
      for (const a of azimuths) {
        observations.push({ kind: "AzimuthControl", from: a.from, to: a.to, value: a.azimuth, sigma: a.sigma });
      }

      // GNSS baselines (mixed network mode)
      if (isMixed || isAngles) {
        for (const b of baselines) {
          observations.push({ kind: "GnssBaseline", from: b.from, to: b.to, value: [b.dE, b.dN, b.dH], covariance: [
            b.sigmaE * b.sigmaE, b.correlationEN * b.sigmaE * b.sigmaN, 0,
            b.correlationEN * b.sigmaE * b.sigmaN, b.sigmaN * b.sigmaN, 0,
            0, 0, b.sigmaH * b.sigmaH,
          ]});
        }
      }

      // Orientation parameters: one per station that has direction observations
      const orientationStations = [...new Set(directions.map((d) => d.station))];
      const orientationParameters = orientationStations.map((sid) => ({ id: `orient_${sid}`, stationId: sid }));

      const result = await callSidecar("adjustment.run", { parameters, approximations, observations, orientation_parameters: orientationParameters, config: { max_iterations: 50, convergence_threshold: 1e-6, blunder_detection: true, blunder_threshold: 3.5, confidence_level: 0.95 } });
      if (!result || !(result as any).success) throw new Error((result as any)?.error ?? "Adjustment failed");
      setLsResult((result as any).result as LsResult);
    } catch (e) { setError((e as Error).message); } finally { setComputing(false); }
  }, [mode, parsePoints, parseLegs, parseBaselines]);

  const handleCompute = useCallback(() => {
    if (mode === "bowditch" || mode === "transit") computeBowditch(); else computeLs();
  }, [mode, computeBowditch, computeLs]);

  // ── Canvas data ─────────────────────────────────────────────────

  const canvasData = (() => {
    const pts: SurveyPoint[] = [];
    const lines: SurveyLine[] = [];

    // Draw recorded live legs
    for (const leg of recordedLegs) {
      pts.push({ easting: leg.fromE, northing: leg.fromN, label: leg.from });
      pts.push({ easting: leg.toE, northing: leg.toN, label: leg.to });
      lines.push({ from: { easting: leg.fromE, northing: leg.fromN }, to: { easting: leg.toE, northing: leg.toN }, color: "#22c55e", width: 2, dashed: true });
    }

    // Draw live fix
    if (liveFix && !recordedLegs.find((l) => Math.abs(l.toE - liveFix.easting) < 0.01 && Math.abs(l.toN - liveFix.northing) < 0.01)) {
      pts.push({ easting: liveFix.easting, northing: liveFix.northing, label: "LIVE" });
    }

    if (lsResult) {
      for (const p of lsResult.adjusted) pts.push({ easting: p.easting, northing: p.northing, label: p.id, color: "#3B82F6" });
    } else if (bowditchResult) {
      for (const s of bowditchResult.stations) pts.push({ easting: s.adjE, northing: s.adjN, label: s.id, color: "#10B981" });
    }

    return { points: pts, lines };
  })();

  const showBaselineInputs = mode === "ls-mixed" || mode === "ls-angles";
  const showAngularInputs = mode === "ls-angles";
  const fixQualityLabel = liveFix ? (liveFix.fixQuality === 4 ? "RTK Fixed" : liveFix.fixQuality === 5 ? "RTK Float" : liveFix.fixQuality === 2 ? "DGPS" : `Q${liveFix.fixQuality}`) : "---";
  const fixQualityColor = liveFix ? (liveFix.fixQuality >= 4 ? "#22c55e" : liveFix.fixQuality >= 2 ? "#f59e0b" : "#ef4444") : "var(--text-tertiary)";

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Traverse & Network Adjustment
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Bowditch/Transit closures, least-squares adjustment, and mixed distance+GNSS network adjustments with live instrument integration.
      </p>

      {/* Live Instrument Panel */}
      <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <Radio size={14} style={{ color: connected ? "#22c55e" : "var(--text-tertiary)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: "bold" }}>Live Instrument</span>
          {connected && (
            <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(34,197,94,0.15)", color: "#22c55e", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
              CONNECTED
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {!connected ? (
            <>
              <select value={connType} onChange={(e) => setConnType(e.target.value as any)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                <option value="serial">Serial</option>
                <option value="bluetooth">Bluetooth</option>
                <option value="ntrip">NTRIP</option>
              </select>
              {connType === "serial" && (
                <>
                  <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", minWidth: "120px" }}>
                    {serialPorts.length === 0 && <option value="">No ports</option>}
                    {serialPorts.map((p) => <option key={p.port_name} value={p.port_name}>{p.display_name}</option>)}
                  </select>
                  <select value={baudRate} onChange={(e) => setBaudRate(+e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                    {[9600, 19200, 38400, 57600, 115200, 230400].map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </>
              )}
              {connType === "ntrip" && (
                <>
                  <input placeholder="Caster URL" value={casterUrl} onChange={(e) => setCasterUrl(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", width: "180px" }} />
                  <input placeholder="Mountpoint" value={mountpoint} onChange={(e) => setMountpoint(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", width: "100px" }} />
                </>
              )}
              <button className="primary" onClick={handleConnect} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "var(--text-xs)" }}>
                <Plug size={12} /> Connect
              </button>
            </>
          ) : (
            <>
              <button onClick={handleDisconnect} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "var(--text-xs)", color: "var(--status-error)" }}>
                <Unplug size={12} /> Disconnect
              </button>
              <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                {obsCount} obs
              </span>
              {liveFix && (
                <>
                  <span style={{ padding: "2px 6px", borderRadius: "4px", background: `${fixQualityColor}20`, color: fixQualityColor, fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
                    {fixQualityLabel}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {liveFix.satelliteCount} sats | HDOP {liveFix.hdop.toFixed(1)}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    E:{liveFix.easting.toFixed(3)} N:{liveFix.northing.toFixed(3)}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Recording controls */}
        {connected && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", borderTop: "1px solid var(--border-subtle)", paddingTop: "8px" }}>
            <label style={{ fontSize: "var(--text-xs)", display: "flex", alignItems: "center", gap: "4px", fontFamily: "var(--font-mono)" }}>
              <input type="checkbox" checked={autoRecord} onChange={(e) => setAutoRecord(e.target.checked)} />
              Auto-record legs
            </label>
            <button onClick={recordCurrentFix} disabled={!liveFix} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px", fontSize: "var(--text-xs)" }}>
              <Target size={12} /> Record Point
            </button>
            {recordedLegs.length > 0 && (
              <>
                <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>
                  {recordedLegs.length} leg{recordedLegs.length !== 1 ? "s" : ""} recorded
                </span>
                <button onClick={applyRecordedLegs} className="primary" style={{ padding: "3px 8px", fontSize: "var(--text-xs)" }}>
                  Apply to Traverse
                </button>
                <button onClick={clearRecordedLegs} style={{ padding: "3px 8px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}

        {instrumentError && (
          <div style={{ marginTop: "6px", padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            {instrumentError}
          </div>
        )}
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <label style={{ marginRight: "6px" }}>Country:</label>
          <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ minWidth: "140px" }}>
            {COUNTRY_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ marginRight: "6px" }}>Mode:</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as AdjustMode)}>
            <option value="bowditch">Bowditch (Compass Rule)</option>
            <option value="transit">Transit Rule</option>
            <option value="ls-distance">Least Squares (Distance)</option>
            <option value="ls-mixed">Mixed Network (Distance + GNSS)</option>
            <option value="ls-angles">Angular Network (Directions + Azimuths)</option>
          </select>
        </div>
        <button className="primary" onClick={handleCompute} disabled={computing} style={{ marginTop: "4px" }}>
          {computing ? "Computing..." : "Run Adjustment"}
        </button>
      </div>

      {/* Input panels */}
      <div style={{ display: "grid", gridTemplateColumns: showBaselineInputs ? (showAngularInputs ? "1fr 1fr 1fr" : "1fr 1fr 1fr") : "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>Points (ID, E, N, fixed)</label>
          <textarea value={pointsText} onChange={(e) => setPointsText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>Traverse Legs (From, To, Dist, Bearing, Sigma)</label>
          <textarea value={legsText} onChange={(e) => setLegsText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
        </div>
        {showBaselineInputs && (
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>GNSS Baselines (From, To, dE, dN, dH, sE, sN, sH, corr)</label>
            <textarea value={baselinesText} onChange={(e) => setBaselinesText(e.target.value)} style={{ width: "100%", height: "140px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
          </div>
        )}
      </div>

      {/* Angular observation panels (shown in ls-angles mode) */}
      {showAngularInputs && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              Directions (Station, Target, Direction°, Sigma″)
              <span style={{ fontWeight: "normal", color: "var(--text-tertiary)", marginLeft: 8, fontSize: "var(--text-xs)">Measured horizontal angles from station</span>
            </label>
            <textarea value={directionsText} onChange={(e) => setDirectionsText(e.target.value)} style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              {parseDirections().length} directions · {new Set(parseDirections().map((d) => d.station)).size} stations
            </div>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              Azimuth Controls (From, To, Azimuth°, Sigma″)
              <span style={{ fontWeight: "normal", color: "var(--text-tertiary)", marginLeft: 8, fontSize: "var(--text-xs)">Known azimuth constraining orientation</span>
            </label>
            <textarea value={azimuthText} onChange={(e) => setAzimuthText(e.target.value)} style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} />
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              {parseAzimuths().length} azimuth controls
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {crossImportNotice && (
        <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          {crossImportNotice}
        </div>
      )}

      <AutoExportBanner />

      {/* Bowditch results */}
      {bowditchResult && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: "Perimeter", value: `${bowditchResult.perimeter.toFixed(3)} m` },
              { label: "Misclosure", value: `${bowditchResult.linearMisclosure.toFixed(4)} m` },
              { label: "Precision", value: `1:${bowditchResult.precisionRatio.toLocaleString()}` },
              { label: "Status", value: bowditchResult.precisionPasses ? "PASS" : "FAIL", color: bowditchResult.precisionPasses ? "var(--status-success)" : "var(--status-error)" },
            ].map((item) => (
              <div key={item.label} style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{item.label}</div>
                <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Station</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Raw E</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Raw N</th>
              <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--accent-primary)" }}>Adj E</th>
              <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--accent-primary)" }}>Adj N</th>
            </tr></thead>
            <tbody>{bowditchResult.stations.map((s, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{s.id}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{s.easting.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{s.northing.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{s.adjE.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{s.adjN.toFixed(3)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* LS results */}
      {lsResult && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: "sigma_0^2", value: lsResult.sigma0Squared.toFixed(6) },
              { label: "Chi-Square", value: `${lsResult.chiSquare.toFixed(4)} (${lsResult.degreesOfFreedom} dof)` },
              { label: "Chi-Square Test", value: lsResult.chiSquarePasses ? "PASS" : "FAIL", color: lsResult.chiSquarePasses ? "var(--status-success)" : "var(--status-error)" },
              { label: "Iterations", value: String(lsResult.iterations) },
              { label: "Observations", value: String(lsResult.residuals.length) },
            ].map((item) => (
              <div key={item.label} style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{item.label}</div>
                <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: (item as any).color }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <button onClick={pushToCogo}
              style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 12px", fontSize: "var(--text-xs)", border: "1px solid var(--accent-primary)", color: "var(--accent-primary)" }}>
              Send to COGO Area Calculator
            </button>
          </div>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Adjusted Coordinates</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", marginBottom: "16px" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Station</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj E</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Adj N</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Height</th>
            </tr></thead>
            <tbody>{lsResult.adjusted.map((p, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{p.id}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.easting.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.northing.toFixed(3)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.height?.toFixed(3) ?? "-"}</td>
              </tr>
            ))}</tbody>
          </table>
          <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>Observation Diagnostics</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead><tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>From</th><th style={{ padding: "6px 8px", textAlign: "left" }}>To</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Kind</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Residual</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Redundancy</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Baarda w</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>Flag</th>
            </tr></thead>
            <tbody>{lsResult.residuals.map((r, i) => {
              const isBlunder = r.wStatistic > 3.5;
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: isBlunder ? "rgba(239,68,68,0.08)" : undefined }}>
                  <td style={{ padding: "6px 8px" }}>{r.from}</td><td style={{ padding: "6px 8px" }}>{r.to}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-secondary)" }}>{r.kind}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.residual.toFixed(4)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.redundancy.toFixed(3)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: isBlunder ? "var(--status-error)" : "var(--text-primary)" }}>{r.wStatistic.toFixed(3)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", color: isBlunder ? "var(--status-error)" : undefined }}>{isBlunder ? "BLUNDER" : "OK"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {/* Canvas */}
      {canvasData.points.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas height={320} title="Adjusted Network" points={canvasData.points} lines={canvasData.lines} showPointLabels={true} showNorthArrow={true} showScaleBar={true} />
        </div>
      )}
    </div>
  );
};
