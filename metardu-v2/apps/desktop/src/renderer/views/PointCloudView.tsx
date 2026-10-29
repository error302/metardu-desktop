import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileInput, Layers3, Ruler, ShieldCheck } from "lucide-react";
import type {
  PointCloudHeaderDetails,
  PointCloudSourceIntegrityStatus,
  PointCloudSourceSummary,
} from "../../shared/point-cloud.js";

const panelStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: 16,
};

const roadmap = [
  {
    icon: FileInput,
    title: "Inspect every point record",
    description: "Stream actual LAS/LAZ dimensions and class counts, compare them with the header, and report malformed or unsupported records.",
  },
  {
    icon: Layers3,
    title: "Build project-aware chunk access",
    description: "Let trusted tools request bounded source chunks without exposing file paths or serializing large clouds through JSON.",
  },
  {
    icon: Ruler,
    title: "Classify with a named method",
    description: "Run a declared, versioned filter with explicit parameters and unit requirements; preserve the imported source unchanged.",
  },
  {
    icon: ShieldCheck,
    title: "Review and deliver derived data",
    description: "Validate a separate output, record method and source provenance, then export only after the surveyor reviews its limits.",
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

function HeaderDetails({ header }: { header: PointCloudHeaderDetails }): React.ReactElement {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Header-declared points</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{formatCount(header.headerDeclaredPointCount)}</strong></div>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Format / version</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{header.format} {header.version} · point format {header.pointFormatId}</strong></div>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>COPC info record</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{header.copcInfoRecordPresent ? "Present (not opened)" : "Not detected"}</strong></div>
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
            <tr><th style={{ padding: 6, textAlign: "left" }}>Minimum bound</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.min.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.min.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.min.z)}</td></tr>
            <tr><th style={{ padding: 6, textAlign: "left" }}>Maximum bound</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.max.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.max.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.bounds.max.z)}</td></tr>
            <tr><th style={{ padding: 6, textAlign: "left" }}>Scale</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateScale.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateScale.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateScale.z)}</td></tr>
            <tr><th style={{ padding: 6, textAlign: "left" }}>Offset</th><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateOffset.x)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateOffset.y)}</td><td style={{ padding: 6, textAlign: "right" }}>{formatHeaderValue(header.coordinateOffset.z)}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, color: "var(--text-secondary)", fontSize: 11 }}>
        <span>GPS time: {header.pointRecordAttributes.gpsTime ? "in point format" : "not in point format"}</span>
        <span>· RGB: {header.pointRecordAttributes.rgb ? "in point format" : "not in point format"}</span>
        <span>· NIR: {header.pointRecordAttributes.nearInfrared ? "in point format" : "not in point format"}</span>
        <span>· Waveform: {header.pointRecordAttributes.waveform ? "in point format" : "not in point format"}</span>
        <span>· Extra bytes per point: {header.pointRecordAttributes.extraBytes}</span>
      </div>

      <div style={{ padding: 10, border: "1px solid var(--border-default)", borderRadius: 4, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
        <strong style={{ color: "var(--text-primary)" }}>CRS records: {header.crsEvidence.hasAnyCrsRecord ? "present" : "not found"}.</strong>{" "}
        Record presence is not verification of the project CRS, coordinate units, epoch, or vertical reference.
        {header.crsEvidence.wktCrs && (
          <details style={{ marginTop: 7 }}>
            <summary style={{ cursor: "pointer", color: "var(--accent-primary)" }}>View WKT text as supplied (not interpreted)</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", padding: 8, background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>{header.crsEvidence.wktCrs}</pre>
          </details>
        )}
      </div>

      {header.warnings.map((warning, index) => (
        <div key={`${index}-${warning}`} style={{ padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
          {warning}
        </div>
      ))}
    </>
  );
}

function integrityStatusLabel(status: PointCloudSourceIntegrityStatus): string {
  switch (status) {
    case "verified": return "File size and SHA-256 match";
    case "notChecked": return "Not rechecked since this project was opened";
    case "missing": return "Managed source file is missing";
    case "sizeMismatch": return "File size differs from the import record";
    case "hashMismatch": return "SHA-256 differs from the import record";
    case "unreadable": return "Managed source could not be read";
  }
}

function SourceCard({
  source,
  storageStatus,
  verifying,
  onVerify,
}: {
  source: PointCloudSourceSummary;
  storageStatus: PointCloudSourceIntegrityStatus;
  verifying: boolean;
  onVerify: () => void;
}): React.ReactElement {
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 11, padding: 12, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Project source</div><strong style={{ color: "var(--text-primary)", fontSize: 12, overflowWrap: "anywhere" }}>{source.fileName}</strong></div>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Stored format / size</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{source.format} · {formatBytes(source.fileSizeBytes)}</strong></div>
        <div><div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Imported</div><strong style={{ color: "var(--text-primary)", fontSize: 12 }}>{new Date(source.importedAt).toLocaleString()}</strong></div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span role="status" style={{ color: storageStatus === "verified" ? "var(--status-success, #22C55E)" : "var(--status-warning, #D97706)", fontSize: 11 }}>
          Integrity: {integrityStatusLabel(storageStatus)}
        </span>
        <button onClick={onVerify} disabled={verifying}>
          {verifying ? "Verifying full file…" : "Verify stored copy"}
        </button>
      </div>
      <details>
        <summary style={{ cursor: "pointer", color: "var(--accent-primary)", fontSize: 11 }}>Header evidence and full source hash</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
          <div style={{ overflowWrap: "anywhere", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
            SHA-256 recorded during import: {source.contentSha256}
          </div>
          <HeaderDetails header={source.header} />
        </div>
      </details>
    </article>
  );
}

export const PointCloudView: React.FC = () => {
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
  const [sources, setSources] = useState<PointCloudSourceSummary[]>([]);
  const [verificationBySourceId, setVerificationBySourceId] = useState<Record<string, PointCloudSourceIntegrityStatus>>({});
  const [verifyingSourceId, setVerifyingSourceId] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const result = await window.metardu.pointCloud.listActiveProjectSources();
      setActiveProjectName(result.activeProjectName);
      setSources(result.sources);
      setVerificationBySourceId({});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
    return window.metardu.projects.onChanged(() => { void refreshSources(); });
  }, [refreshSources]);

  const importSource = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.metardu.pointCloud.importSource();
      if (!result.canceled) {
        setActiveProjectName(result.projectName);
        setNotice(`${result.source.fileName} was copied into the local source store and linked to ${result.projectName}.`);
        setSources((current) => [result.source, ...current.filter((source) => source.id !== result.source.id)]);
        setVerificationBySourceId((current) => ({ ...current, [result.source.id]: "verified" }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const verifySource = async (sourceId: string) => {
    setVerifyingSourceId(sourceId);
    setError(null);
    try {
      const result = await window.metardu.pointCloud.verifySource(sourceId);
      setVerificationBySourceId((current) => ({ ...current, [sourceId]: result.status }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVerifyingSourceId(null);
    }
  };

  const hasActiveProject = activeProjectName !== null;

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
          Preserve LAS/LAZ sources in a survey project, inspect their declared headers, and build toward validated point-cloud workflows.
        </p>
      </header>

      <section role="status" aria-live="polite" style={{ ...panelStyle, display: "flex", gap: 12, borderColor: "var(--status-warning, #D97706)", background: "rgba(217, 119, 6, 0.08)" }}>
        <AlertTriangle size={20} color="var(--status-warning, #D97706)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--text-primary)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
          <strong>Stored source and header inspection only. Classification is not available.</strong>
          <span>
            METARDU preserves a copied source and its hash, then reads the file header. It does not yet read or validate every point record, verify whole-file LAS/LAZ integrity, interpret coordinate systems or units, save a portable project bundle, or run a classifier. No DTM or survey result is generated.
          </span>
        </div>
      </section>

      <section style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 14 }}>Project source files</h2>
            <p style={{ margin: "5px 0 0", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              Active project: <strong>{loadingSources ? "Loading…" : activeProjectName ?? "None"}</strong>. METARDU copies the selected file into this Desktop installation; your original is not changed. The copy is linked to this project but is not yet part of a portable project bundle.
            </p>
          </div>
          <button className="primary" onClick={importSource} disabled={busy || loadingSources || !hasActiveProject}>
            {busy ? "Copying and inspecting…" : "Import LAS / LAZ source"}
          </button>
        </div>

        {!loadingSources && !hasActiveProject && (
          <div role="status" style={{ padding: 10, border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: 12 }}>
            Create or activate a survey project before importing a point cloud.
          </div>
        )}
        {notice && <div role="status" style={{ color: "var(--status-success, #22C55E)", fontSize: 12 }}>{notice}</div>}
        {error && (
          <div role="alert" style={{ padding: 10, border: "1px solid var(--status-error, #EF4444)", color: "var(--status-error, #EF4444)", fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {sources.length === 0 && !loadingSources ? (
          <div style={{ padding: 18, border: "1px dashed var(--border-default)", color: "var(--text-tertiary)", textAlign: "center", fontSize: 12 }}>
            No LAS/LAZ source files are attached to this project.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                storageStatus={verificationBySourceId[source.id] ?? source.storageStatus}
                verifying={verifyingSourceId === source.id}
                onVerify={() => { void verifySource(source.id); }}
              />
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <h2 style={{ margin: "0 0 12px", color: "var(--text-primary)", fontSize: 14 }}>Next survey workflow gates</h2>
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
