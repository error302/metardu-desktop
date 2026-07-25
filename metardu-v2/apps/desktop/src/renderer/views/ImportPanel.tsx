/**
 * Import Panel — Instrument data import (Tier 1 #3).
 *
 * Lets the surveyor pick a raw instrument file (Leica GSI, Sokkia SDR,
 * Trimble DC/JOB, or RINEX) from disk and parse it via the main process.
 * For RINEX, the main process invokes the sidecar's `import.rinex_epochs`
 * handler to parse epoch records; for the other formats the TS engine
 * parses synchronously. Per ADR-0005 invariant A1 the heavy math (RINEX
 * epoch parsing) lives in the Rust sidecar.
 *
 * Keyboard shortcut: `g i`.
 */

import React, { useState, useCallback } from "react";
import { Upload, FileText, Radar, Mountain, Ruler } from "lucide-react";

interface ImporterInfo {
  format: string;
  description: string;
  extensions: string[];
}

interface FieldObservationLite {
  pointId: string;
  type: string;
  code?: string;
  stationId?: string;
  timestamp?: string;
  coordinates?: { easting: number; northing: number; elevation: number };
  totalStation?: {
    horizontalAngle?: number;
    verticalAngle?: number;
    slopeDistance?: number;
    horizontalDistance?: number;
    reflectorHeight?: number;
    instrumentHeight?: number;
  };
  gnss?: {
    latitude: number;
    longitude: number;
    height: number;
    fixQuality: string;
    satellites: number;
    hdop: number;
    vdop: number;
  };
  level?: {
    backsight?: number;
    foresight?: number;
    reducedLevel?: number;
  };
}

interface ImportResultLite {
  observations: FieldObservationLite[];
  warnings: string[];
  errors: string[];
  format: string;
  pointCount: number;
}

const SUPPORTED_FORMATS: ImporterInfo[] = [
  { format: "Leica GSI", description: "Leica Geo Serial Interface 8/16 — total stations + levels", extensions: ["gsi"] },
  { format: "Sokkia SDR", description: "Sokkia Standard Data Record — total stations", extensions: ["sdr"] },
  { format: "Trimble DC/JOB", description: "Trimble Business Center ASCII export — total stations + GNSS", extensions: ["dc", "job"] },
  { format: "RINEX", description: "Receiver Independent Exchange Format 2.11 / 3.04 — GNSS raw data (epochs via sidecar)", extensions: ["rinex", "obs"] },
];

const FORMAT_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  "Leica GSI": Ruler,
  "Sokkia SDR": Mountain,
  "Trimble DC/JOB": FileText,
  "RINEX": Radar,
};

export const ImportPanel: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultLite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setFilename(null);
    try {
      const w = window as unknown as {
        metardu?: {
          import?: {
            pickAndRead?: () => Promise<{ canceled: boolean; filename: string; content: string }>;
            fieldData?: (filename: string, content: string) => Promise<ImportResultLite>;
          };
        };
      };

      if (!w.metardu?.import?.pickAndRead || !w.metardu?.import?.fieldData) {
        throw new Error("Import not available — running in browser mode. Launch the Electron app to import instrument files.");
      }

      const picked = await w.metardu.import.pickAndRead();
      if (picked.canceled) {
        // User cancelled — silent no-op.
        return;
      }
      setFilename(picked.filename);
      const r = await w.metardu.import.fieldData(picked.filename, picked.content);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
          Import Instrument Data
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Read raw field data from surveying instruments. Per ADR-0005 the heavy parsing
          (RINEX epoch records) lives in the Rust sidecar.
        </p>
      </div>

      {/* Supported formats grid */}
      <div>
        <label style={{ display: "block", fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Supported Formats
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
          {SUPPORTED_FORMATS.map((f) => {
            const Icon = FORMAT_ICONS[f.format] ?? FileText;
            return (
              <div
                key={f.format}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px",
                  padding: "12px", borderRadius: "8px", border: "1px solid var(--border-default)",
                  background: "transparent", textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Icon size={16} strokeWidth={1.75} />
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{f.format}</span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{f.description}</span>
                <span style={{ fontSize: "10px", color: "var(--text-disabled)", fontFamily: "var(--font-mono)" }}>
                  .{f.extensions.join(", .")}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Import button */}
      <div>
        <button
          onClick={handleImport}
          disabled={busy}
          style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "10px 18px", borderRadius: "8px",
            border: "1px solid var(--accent-primary)",
            background: busy ? "var(--bg-hover)" : "var(--accent-primary)",
            color: busy ? "var(--text-tertiary)" : "#fff",
            fontSize: "13px", fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Upload size={16} strokeWidth={2} />
          {busy ? "Importing…" : "Pick instrument file"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)", fontSize: "12px", color: "var(--text-error)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>
              {result.format} — {result.pointCount} observation{result.pointCount === 1 ? "" : "s"}
            </strong>
            {filename && (
              <span style={{ color: "var(--text-tertiary)", marginLeft: "8px", fontFamily: "var(--font-mono)" }}>
                ({filename})
              </span>
            )}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <details style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-warning)", border: "1px solid var(--border-warning)" }}>
              <summary style={{ fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
                {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ marginTop: "8px", marginBottom: 0, paddingLeft: "20px", fontSize: "11px", color: "var(--text-tertiary)" }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          {/* Errors */}
          {result.errors.length > 0 && (
            <details style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)" }}>
              <summary style={{ fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
                {result.errors.length} parse error{result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ marginTop: "8px", marginBottom: 0, paddingLeft: "20px", fontSize: "11px", color: "var(--text-error)" }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}

          {/* Observations table */}
          {result.observations.length > 0 && (
            <div style={{ border: "1px solid var(--border-default)", borderRadius: "8px", overflow: "auto", maxHeight: "420px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-default)" }}>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Point ID</th>
                    <th style={th}>Type</th>
                    <th style={th}>Code</th>
                    <th style={th}>Station</th>
                    <th style={th}>Easting</th>
                    <th style={th}>Northing</th>
                    <th style={th}>Elev</th>
                    <th style={th}>HA</th>
                    <th style={th}>VA</th>
                    <th style={th}>SD</th>
                    <th style={th}>Sats</th>
                    <th style={th}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {result.observations.map((o, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{o.pointId}</td>
                      <td style={td}>{o.type}</td>
                      <td style={td}>{o.code ?? ""}</td>
                      <td style={td}>{o.stationId ?? ""}</td>
                      <td style={tdRight}>{o.coordinates?.easting?.toFixed(3) ?? ""}</td>
                      <td style={tdRight}>{o.coordinates?.northing?.toFixed(3) ?? ""}</td>
                      <td style={tdRight}>{o.coordinates?.elevation?.toFixed(3) ?? ""}</td>
                      <td style={tdRight}>{o.totalStation?.horizontalAngle?.toFixed(4) ?? ""}</td>
                      <td style={tdRight}>{o.totalStation?.verticalAngle?.toFixed(4) ?? ""}</td>
                      <td style={tdRight}>{o.totalStation?.slopeDistance?.toFixed(3) ?? ""}</td>
                      <td style={tdRight}>{o.gnss?.satellites ?? ""}</td>
                      <td style={td}>{o.timestamp ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const th: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "6px 10px",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
};

const tdRight: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
