/**
 * React hooks for MetaRDU Desktop v2.0.
 *
 * These hooks bridge the React UI to the platform API (window.metardu),
 * which works in both Electron and Tauri via the compatibility shim.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Platform detection ────────────────────────────────────────────

export function usePlatform(): "electron" | "tauri" | "browser" {
  const [platform, setPlatform] = useState<"electron" | "tauri" | "browser">("browser");

  useEffect(() => {
    if (typeof window !== "undefined") {
      if ("__TAURI_INTERNALS__" in window) setPlatform("tauri");
      else if ("metardu" in window) setPlatform("electron");
    }
  }, []);

  return platform;
}

// ─── API accessor ──────────────────────────────────────────────────

export function useApi() {
  const [api, setApi] = useState<any>(null);
  const platform = usePlatform();

  useEffect(() => {
    if (typeof window !== "undefined" && "metardu" in window) {
      setApi((window as any).metardu);
    }
  }, [platform]);

  return api;
}

// ─── Flight planning ───────────────────────────────────────────────

export interface FlightPlanState {
  cameraId: string;
  altitudeM: number;
  frontOverlap: number;
  sideOverlap: number;
  area: { coordinates: Array<{ lat: number; lng: number }> };
}

export function useFlightPlanning() {
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const plan = useCallback(async (params: FlightPlanState) => {
    if (!api) { setError("API not available"); return; }
    setLoading(true);
    setError(null);
    try {
      // In Tauri: engine runs directly in renderer
      // In Electron: goes through IPC
      if (api.drone?.missionPlan) {
        const res = await api.drone.missionPlan(params);
        setResult(res);
      } else {
        // Fallback: import engine directly
        const { planMission } = await import("@metardu/engine-v2");
        setResult(planMission(params));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const exportMission = useCallback(async (waypoints: any[], format: string, outputPath: string) => {
    if (!api) { setError("API not available"); return; }
    setLoading(true);
    try {
      if (api.drone?.missionExport) {
        await api.drone.missionExport(waypoints, format, outputPath);
      } else {
        const { exportMissionToFile } = await import("@metardu/engine-v2");
        await exportMissionToFile(waypoints, format as any, outputPath);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  return { plan, exportMission, result, loading, error };
}

// ─── Stakeout ──────────────────────────────────────────────────────

export function useStakeout(designPoints: any[], tolerance?: any) {
  const api = useApi();
  const [guidance, setGuidance] = useState<any>(null);
  const [active, setActive] = useState(false);
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    // Create a stakeout session (engine runs in renderer)
    import("@metardu/engine-v2").then(({ createStakeoutSession }) => {
      sessionRef.current = createStakeoutSession(designPoints, tolerance);
    });
  }, [designPoints, tolerance]);

  const update = useCallback((position: { easting: number; northing: number; elevation: number; heading?: number }) => {
    if (sessionRef.current) {
      const g = sessionRef.current.update(position);
      setGuidance(g);
      if (g.isStaked && g.target) {
        sessionRef.current.markStaked(g.target.id);
      }
    }
  }, []);

  const start = useCallback(() => setActive(true), []);
  const stop = useCallback(() => setActive(false), []);
  const skipPoint = useCallback(() => {
    if (sessionRef.current && guidance?.target) {
      sessionRef.current.removePoint(guidance.target.id);
    }
  }, [guidance]);

  return { guidance, active, start, stop, update, skipPoint, progress: sessionRef.current?.getProgress() ?? 0 };
}

// ─── GNSS telemetry ────────────────────────────────────────────────

export function useGnssTelemetry(pollIntervalMs: number = 1000) {
  const api = useApi();
  const [telemetry, setTelemetry] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !api) return;

    const interval = setInterval(async () => {
      try {
        if (api.drone?.getTelemetry) {
          // Sidecar-based telemetry (MAVLink drone)
          const tel = await api.drone.getTelemetry();
          setTelemetry(tel);
        } else if (api.gnss?.parseNMEA) {
          // Direct NMEA parsing (GNSS rover over serial)
          // In production, this would read from a serial port
          // For now, telemetry stays null until a serial reader is implemented
        }
      } catch (err) {
        setError(String(err));
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [connected, api, pollIntervalMs]);

  const connect = useCallback(async (connectionUrl?: string) => {
    if (!api) { setError("API not available"); return; }
    try {
      if (api.drone?.connect) {
        await api.drone.connect(connectionUrl ?? "udp://:14540");
      }
      setConnected(true);
    } catch (err) {
      setError(String(err));
    }
  }, [api]);

  const disconnect = useCallback(async () => {
    if (!api) return;
    try {
      if (api.drone?.disconnect) {
        await api.drone.disconnect();
      }
      setConnected(false);
      setTelemetry(null);
    } catch (err) {
      setError(String(err));
    }
  }, [api]);

  return { telemetry, connected, error, connect, disconnect };
}

// ─── Drone control ─────────────────────────────────────────────────

export function useDroneControl() {
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadMission = useCallback(async (waypoints: any[]) => {
    if (!api?.drone?.uploadMission) { setError("Drone API not available"); return; }
    setLoading(true);
    try {
      await api.drone.uploadMission(waypoints);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const startMission = useCallback(async () => {
    if (!api?.drone?.startMission) return;
    setLoading(true);
    try { await api.drone.startMission(); }
    catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [api]);

  const arm = useCallback(async () => {
    if (!api?.drone?.arm) return;
    try { await api.drone.arm(); }
    catch (err) { setError(String(err)); }
  }, [api]);

  const rtl = useCallback(async () => {
    if (!api?.drone?.rtl) return;
    try { await api.drone.rtl(); }
    catch (err) { setError(String(err)); }
  }, [api]);

  return { uploadMission, startMission, arm, rtl, loading, error };
}

// ─── As-built comparison ───────────────────────────────────────────

export function useAsBuiltComparison() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const compare = useCallback(async (
    designPoints: Array<{ id: string; easting: number; northing: number; elevation: number }>,
    surveyedPoints: Array<{ id: string; easting: number; northing: number; elevation: number }>,
    tolerance?: { horizontal: number; vertical: number },
  ) => {
    setLoading(true);
    try {
      const { comparePoints, DEFAULT_COMPARISON_TOLERANCE } = await import("@metardu/engine-v2");
      const result = comparePoints(
        designPoints,
        surveyedPoints,
        tolerance ?? DEFAULT_COMPARISON_TOLERANCE,
      );
      setSummary(result);
    } finally {
      setLoading(false);
    }
  }, []);

  return { summary, compare, loading };
}

// ─── Cross-section ─────────────────────────────────────────────────

export function useCrossSection() {
  const [sections, setSections] = useState<any[]>([]);
  const [volume, setVolume] = useState<any>(null);

  const addSection = useCallback((chainage: number, centerlineElev: number, observations: any[]) => {
    const { recordCrossSection } = require("@metardu/engine-v2");
    const section = recordCrossSection(chainage, centerlineElev, observations);
    setSections(prev => [...prev, section]);
  }, []);

  const computeVolumes = useCallback(() => {
    if (sections.length < 2) return;
    const { totalEarthworkVolume } = require("@metardu/engine-v2");
    setVolume(totalEarthworkVolume(sections));
  }, [sections]);

  return { sections, volume, addSection, computeVolumes };
}

// ─── LULC workflow ─────────────────────────────────────────────────

export function useLulcWorkflow() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (params: any) => {
    setLoading(true);
    setError(null);
    try {
      const { runLulcWorkflow } = await import("@metardu/engine-v2");
      const res = runLulcWorkflow(params);
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, run, loading, error };
}
