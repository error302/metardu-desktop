import React, { useState } from "react";
import { AlertTriangle, FileInput, Layers3, Ruler, ShieldCheck } from "lucide-react";

type InspectedSource = Extract<
  Awaited<ReturnType<typeof window.metardu.pointCloud.inspectSource>>,
  { canceled: false }
>;

const panelStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: 16,
};

const roadmap = [
  {
    icon: FileInput,
    title: "Read and preserve source data",
    description: "Add project-managed originals, content hashes, complete point-record inspection, and explicit handling of missing CRS metadata.",
  },
  {
    icon: Ruler,
    title: "Classify with a named method",
    description: "Select and configure a supported ground classifier in the dataset's declared units, with parameters and software version recorded.",
  },
  {
    icon: Layers3,
    title: "Review and deliver derived data",
    description: "Compare class counts and surfaces, inspect warnings, then export a separate classified copy and terrain products with provenance.",
  },
  {
    icon: ShieldCheck,
    title: "Check against survey evidence",
    description: "Keep the original immutable and expose method limits, validation evidence, manual overrides, and the reviewer responsible.",
  },
];

function formatBytes(value: string): string {
  try {
    const bytes = BigInt(value);
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let amount = Number(bytes);
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex++;
    }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[unitIndex]}`;
  } catch {
    return `${value} bytes`;
  }
}

function formatCount(value: string): string {
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatHeaderValue(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export const PointCloudView: React.FC = () => {
  const [inspection, setInspection] = useState<InspectedSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspectSource = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.metardu.pointCloud.inspectSource();
      if (!result.canceled) setInspection(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, height: "100%", overflow: "auto", maxWidth: 1180, margin: "0 auto" }}>
      <header style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 12 }}>
        <div style={{ color: "var(--text-tertiary)", fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Survey data workspace
        </div>
        <h1 style={{ margin: "5px 0", fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
          Point Cloud Processing
        </h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
          Inspect LiDAR source metadata before a real project import, classification, review, and delivery workflow.
        </p>
      </header>

      <section role="status" aria-live="polite" style={{ ...panelStyle, display: "flex", gap: 12, borderColor: "var(--status-warning, #D97706)", background: "rgba(217, 119, 6, 0.08)" }}>
        <AlertTriangle size={20} color="var(--status-warning, #D97706)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--text-primary)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
          <strong>Header inspection only. Classification is not available.</strong>
          <span>
            METARDU reads LAS/LAZ header metadata but does not read or validate point records, save the file into a project, or run a ground filter. No class counts, DTM, or survey result are generated.
          </span>
        </div>
      </section>

      <section style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 230 }}>
            <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 14 }}>Inspect a LAS / LAZ source</h2>
            <p style={{ margin: "5px 0 0", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              Reads the source-declared file header only. The selected file is not copied, stored, or attached to the active project.
            </p>
          </div>
          <button className="primary" onClick={inspectSource} disabled={busy}>
            {busy ? "Reading header…" : "Choose LAS / LAZ file"}
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: 10, border: "1px solid var(--status-error, #EF4444)", color: "var(--status-error, #EF4444)", fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {inspection && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Selected file</div><strong style={{ color: "var(--text-primary)", fontSize: 12, overflowWrap: "anywhere" }}>{inspection.fileName}</strong></div>
              <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>File size at inspection</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{formatBytes(inspection.fileSizeBytes)}</strong></div>
              <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Header-declared points</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{formatCount(inspection.header.headerDeclaredPointCount)}</strong></div>
              <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Format / version</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{inspection.header.format} {inspection.header.version} · point format {inspection.header.pointFormatId}</strong></div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                <thead>
                  <tr style={{ color: "var(--text-tertiary)", textAlign: "right" }}>
                    <th style={{ padding: 6, textAlign: "left" }}>Header field</th>
                    <th style={{ padding: 6 }}>X</th><th style={{ padding: 6 }}>Y</th><th style={{ padding: 6 }}>Z</th>
                  </tr>
                </thead>
                <tbody style={{ color: "var(--text-primary)" }}>
                  <tr><th style={{ padding: 6, textAlign: "left" }}>Minimum bound</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.min.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.min.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.min.z)}</td></tr>
                  <tr><th style={{ padding: 6, textAlign: "left" }}>Maximum bound</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.max.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.max.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.bounds.max.z)}</td></tr>
                  <tr><th style={{ padding: 6, textAlign: "left" }}>Scale</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateScale.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateScale.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateScale.z)}</td></tr>
                  <tr><th style={{ padding: 6, textAlign: "left" }}>Offset</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateOffset.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateOffset.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(inspection.header.coordinateOffset.z)}</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, color: "var(--text-secondary)", fontSize: 11 }}>
              <span>GPS time: {inspection.header.pointRecordAttributes.gpsTime ? "present" : "not in point format"}</span>
              <span>· RGB: {inspection.header.pointRecordAttributes.rgb ? "present" : "not in point format"}</span>
              <span>· NIR: {inspection.header.pointRecordAttributes.nearInfrared ? "present" : "not in point format"}</span>
              <span>· Waveform: {inspection.header.pointRecordAttributes.waveform ? "present" : "not in point format"}</span>
              <span>· Extra bytes per point: {inspection.header.pointRecordAttributes.extraBytes}</span>
              <span>· COPC info record: {inspection.header.copcInfoRecordPresent ? "present" : "not detected"}</span>
            </div>

            <div style={{ padding: 10, border: "1px solid var(--border-default)", borderRadius: 4, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-primary)" }}>CRS records: {inspection.header.crsEvidence.hasAnyCrsRecord ? "present" : "not found"}.</strong>{" "}
              Their presence is not verification of the project CRS, coordinate units, epoch, or vertical reference.
              {inspection.header.crsEvidence.wktCrs && (
                <details style={{ marginTop: 7 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent-primary)" }}>View WKT text as supplied (not interpreted)</summary>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", padding: 8, background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>{inspection.header.crsEvidence.wktCrs}</pre>
                </details>
              )}
            </div>

            {inspection.header.warnings.map((warning, index) => (
              <div key={`${index}-${warning}`} style={{ padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
                {warning}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <h2 style={{ margin: "0 0 12px", color: "var(--text-primary)", fontSize: 14 }}>What a complete survey workflow still needs</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 10 }}>
          {roadmap.map(({ icon: Icon, title, description }) => (
            <article key={title} style={{ padding: 12, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon size={16} color="var(--accent-primary)" aria-hidden="true" />
                <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 12 }}>{title}</h3>
              </div>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.55 }}>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};
