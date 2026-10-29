import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileInput, Layers3, Ruler, ShieldCheck } from "lucide-react";
import type {
  PointCloudHeaderDetails,
  PointCloudRecordInspectionJobStatus,
  PointCloudRecordInspection,
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
    title: "Validate complete LAS/LAZ structure",
    description: "Check record boundaries, compression chunks, EVLRs, and trailing data beyond the header-declared point range.",
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

function inspectionProgressPercent(decodedPointCount: string, declaredPointCount: string): number | null {
  try {
    const decoded = BigInt(decodedPointCount);
    const declared = BigInt(declaredPointCount);
    if (declared <= 0n) return null;
    return Math.max(0, Math.min(99, Number((decoded * 100n) / declared)));
  } catch {
    return null;
  }
}

function formatHeaderValue(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function HeaderDetails({
  header,
  recordInspection,
}: {
  header: PointCloudHeaderDetails;
  recordInspection: PointCloudRecordInspection | null;
}): React.ReactElement {
  const warnings = recordInspection
    ? header.warnings.filter((warning) => !warning.includes("point records and whole-file integrity were not checked"))
    : header.warnings;
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

      {warnings.map((warning, index) => (
        <div key={`${index}-${warning}`} style={{ padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
          {warning}
        </div>
      ))}
    </>
  );
}

function RecordInspectionDetails({ inspection }: { inspection: PointCloudRecordInspection }): React.ReactElement {
  const countStatus = inspection.headerCountMatchesDecoded
    ? "Decoded count matches the header-declared count"
    : "Decoded count differs from the header-declared count";
  const returnStatus = inspection.returnCountsMatchHeader
    ? "Decoded return counts match the header"
    : "Decoded return counts differ from the header";
  const statusColor = inspection.headerCountMatchesDecoded && inspection.returnCountsMatchHeader
    ? "var(--status-success, #22C55E)"
    : "var(--status-warning, #D97706)";

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12, border: "1px solid var(--border-default)", borderRadius: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline" }}>
        <strong style={{ color: statusColor, fontSize: 12 }}>Record inspection: {countStatus}</strong>
        <span style={{ color: "var(--text-tertiary)", fontSize: 10 }}>{inspection.readerVersion} · {new Date(inspection.inspectedAt).toLocaleString()}</span>
      </div>
      <div style={{ overflowWrap: "anywhere", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
        Report source SHA-256: {inspection.sourceSha256}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
        Decoded {formatCount(inspection.decodedPointCount)} of {formatCount(inspection.headerDeclaredPointCount)} header-declared records · {returnStatus}.
      </div>
      {inspection.fileStructure && (
        <div style={{ padding: 9, border: "1px solid var(--border-subtle)", borderRadius: 3, color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.5 }}>
          <strong style={{ color: inspection.fileStructure.layoutStatus === "bounded" ? "var(--status-success, #22C55E)" : "var(--status-warning, #D97706)" }}>
            File layout: {inspection.fileStructure.layoutStatus === "bounded" ? "declared extents bounded" : "partially checked"}
          </strong>
          <div>{inspection.fileStructure.validationScope}</div>
          {inspection.fileStructure.variableLengthRecords && (
            <>
              <div style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                VLRs: {formatCount(String(inspection.fileStructure.variableLengthRecords.declaredCount))} · bytes {inspection.fileStructure.variableLengthRecords.sequenceStartByte} to {inspection.fileStructure.variableLengthRecords.sequenceEndByte}
              </div>
              {BigInt(inspection.fileStructure.variableLengthRecords.unclassifiedBytesBeforePointData) > 0n ? (
                <div>
                  Unclassified bytes between VLRs and points: {formatCount(inspection.fileStructure.variableLengthRecords.unclassifiedBytesBeforePointData)} ({inspection.fileStructure.variableLengthRecords.gapBytesAllZero === true ? "all zero; meaning not validated" : "contains nonzero bytes; contents not interpreted"}).
                </div>
              ) : (
                <div>No unclassified gap bytes occur between the declared VLR sequence and point data.</div>
              )}
            </>
          )}
          <div style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
            Points: byte {inspection.fileStructure.pointDataStartByte} to {inspection.fileStructure.pointDataEndByte ?? "unknown"}
            {inspection.fileStructure.chunkTableStartByte && ` · Chunk table: ${inspection.fileStructure.chunkTableStartByte} to ${inspection.fileStructure.chunkTableEndByte ?? "unknown"}`}
            {inspection.fileStructure.firstEvlrStartByte && ` · EVLRs: ${inspection.fileStructure.firstEvlrStartByte} to ${inspection.fileStructure.evlrSequenceEndByte ?? "unknown"}`}
          </div>
          {inspection.fileStructure.pointDataRegionEndByte && inspection.fileStructure.pointDataRegionByteCount && (
            <div>
              Enclosing point-data region: byte {inspection.fileStructure.pointDataStartByte} to {inspection.fileStructure.pointDataRegionEndByte} ({formatCount(inspection.fileStructure.pointDataRegionByteCount)} bytes; boundary at {inspection.fileStructure.pointDataRegionBoundary === "first_evlr" ? "first EVLR" : "end of file"}). Pointwise LAZ has no stream end marker, so this is not the exact decoder end.
            </div>
          )}
          {inspection.fileStructure.unclassifiedBytesBeforeEvlrs !== null && BigInt(inspection.fileStructure.unclassifiedBytesBeforeEvlrs) > 0n && (
            <div>Unclassified bytes before EVLRs: {formatCount(inspection.fileStructure.unclassifiedBytesBeforeEvlrs)}</div>
          )}
          {inspection.fileStructure.unclassifiedBytesAfterKnownData !== null && BigInt(inspection.fileStructure.unclassifiedBytesAfterKnownData) > 0n && (
            <div>Unclassified bytes after known data: {formatCount(inspection.fileStructure.unclassifiedBytesAfterKnownData)}</div>
          )}
        </div>
      )}
      <div style={{ color: "var(--text-primary)", fontSize: 11, lineHeight: 1.6 }}>
        <strong>Existing source classification codes</strong>
        {inspection.classificationCounts.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)" }}>No point records were decoded.</div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {inspection.classificationCounts.map(({ code, count }) => (
              <span key={code} style={{ padding: "2px 6px", border: "1px solid var(--border-subtle)", borderRadius: 3 }}>
                Class {code}: {formatCount(count)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
        Returns: {inspection.returnCounts.length === 0
          ? "none recorded"
          : inspection.returnCounts.map(({ returnNumber, count }) => `R${returnNumber}: ${formatCount(count)}`).join(" · ")}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
        Decoded coordinates after source scale/offset: X {formatHeaderValue(inspection.decodedBounds.min.x)} to {formatHeaderValue(inspection.decodedBounds.max.x)}, Y {formatHeaderValue(inspection.decodedBounds.min.y)} to {formatHeaderValue(inspection.decodedBounds.max.y)}, Z {formatHeaderValue(inspection.decodedBounds.min.z)} to {formatHeaderValue(inspection.decodedBounds.max.z)}.
        {" "}CRS, units, epoch, and vertical reference are not interpreted.
      </div>
      {(BigInt(inspection.invalidReturnMetadataPointCount) > 0n || BigInt(inspection.nonFiniteCoordinatePointCount) > 0n) && (
        <div style={{ color: "var(--status-warning, #D97706)", fontSize: 11 }}>
          Invalid return metadata: {formatCount(inspection.invalidReturnMetadataPointCount)} · Non-finite coordinate records: {formatCount(inspection.nonFiniteCoordinatePointCount)}.
        </div>
      )}
      {inspection.warnings.map((warning, index) => (
        <div key={`${index}-${warning}`} style={{ padding: 7, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.5 }}>
          {warning}
        </div>
      ))}
    </section>
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
  inspecting,
  scanBusy,
  onInspect,
}: {
  source: PointCloudSourceSummary;
  storageStatus: PointCloudSourceIntegrityStatus;
  verifying: boolean;
  onVerify: () => void;
  inspecting: boolean;
  scanBusy: boolean;
  onInspect: () => void;
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
        <button onClick={onVerify} disabled={verifying || scanBusy}>
          {verifying ? "Verifying full file…" : "Verify stored copy"}
        </button>
        <button onClick={onInspect} disabled={scanBusy}>
          {inspecting ? "Reading point records…" : source.recordInspection ? "Inspect records again" : "Inspect point records"}
        </button>
      </div>
      {source.recordInspection && (
        <>
          {storageStatus !== "verified" && (
            <div role="status" style={{ padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              This saved report is bound to its recorded source SHA-256. The current managed file has not been verified in this session; verify it before relying on this report. An integrity mismatch means the report describes the imported bytes, not the current file.
            </div>
          )}
          <RecordInspectionDetails inspection={source.recordInspection} />
        </>
      )}
      <details>
        <summary style={{ cursor: "pointer", color: "var(--accent-primary)", fontSize: 11 }}>Header evidence and full source hash</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
          <div style={{ overflowWrap: "anywhere", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
            SHA-256 recorded during import: {source.contentSha256}
          </div>
          <HeaderDetails header={source.header} recordInspection={source.recordInspection} />
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
  const [inspectionJob, setInspectionJob] = useState<{
    jobId: string;
    sourceId: string;
    status: "running" | "cancelling";
    decodedPointCount: string;
    declaredPointCount: string;
  } | null>(null);
  const inspectingSourceId = inspectionJob?.sourceId ?? null;
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

  useEffect(() => {
    const jobId = inspectionJob?.jobId;
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof window.setTimeout> | undefined;

    const poll = async () => {
      try {
        const status: PointCloudRecordInspectionJobStatus =
          await window.metardu.pointCloud.recordInspectionStatus(jobId);
        if (stopped) return;
        if (status.status === "running" || status.status === "cancelling") {
          setInspectionJob((current) => current?.jobId === jobId ? {
            ...current,
            status: status.status,
            decodedPointCount: status.decodedPointCount,
            declaredPointCount: status.declaredPointCount,
          } : current);
          timer = window.setTimeout(() => { void poll(); }, 500);
          return;
        }
        if (status.status === "completed") {
          setSources((current) => current.map((source) => source.id === status.source.id ? status.source : source));
          setVerificationBySourceId((current) => ({ ...current, [status.source.id]: "verified" }));
          setNotice(
            `Read ${formatCount(status.source.recordInspection?.decodedPointCount ?? "0")} header-declared point records from ${status.source.fileName}. Existing class codes were counted; no classifier was run.`,
          );
        } else if (status.status === "cancelled") {
          setNotice("Point-record inspection was cancelled. No partial report was saved.");
        } else {
          setError(status.message);
        }
        setInspectionJob((current) => current?.jobId === jobId ? null : current);
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setInspectionJob((current) => current?.jobId === jobId ? null : current);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void window.metardu.pointCloud.cancelRecordInspection(jobId).catch(() => undefined);
    };
  }, [inspectionJob?.jobId]);

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

  const inspectSourceRecords = async (sourceId: string) => {
    setError(null);
    setNotice(null);
    try {
      const job = await window.metardu.pointCloud.startRecordInspection(sourceId);
      setInspectionJob({
        jobId: job.jobId,
        sourceId,
        status: "running",
        decodedPointCount: "0",
        declaredPointCount: job.declaredPointCount,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancelRecordInspection = async () => {
    if (!inspectionJob || inspectionJob.status === "cancelling") return;
    try {
      const result = await window.metardu.pointCloud.cancelRecordInspection(inspectionJob.jobId);
      if (result.accepted) {
        setInspectionJob((current) => current?.jobId === inspectionJob.jobId
          ? { ...current, status: "cancelling" }
          : current);
        setNotice("Cancellation requested. METARDU will finish the current bounded batch before stopping.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
            <strong>Source inspection now reports progress and supports cancellation. Classification is not available.</strong>
          <span>
            METARDU preserves a copied source, verifies its hash before and after an explicit scan, and can decode the point records declared by its LAS/LAZ header in bounded batches with progress and cooperative cancellation. It reports existing numeric class codes, return counts, and decoded bounds; it does not interpret class-code lookup tables, run a classifier, validate all trailing bytes or full-file conformance, interpret CRS or units, create a portable project bundle, or generate a DTM or survey result.
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
          <button className="primary" onClick={importSource} disabled={busy || loadingSources || !hasActiveProject || inspectingSourceId !== null}>
              {busy ? "Copying and inspecting header…" : "Import LAS / LAZ source"}
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

        {inspectingSourceId && (
          <div role="status" aria-live="polite" style={{ padding: 10, border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8 }}>
            <span>
              {inspectionJob?.status === "cancelling" ? "Stopping after the current bounded batch…" : "Reading source point records in bounded batches. The full source hash is checked before and after; point data stays out of the renderer."}
            </span>
            <span>
              Decoded {formatCount(inspectionJob?.decodedPointCount ?? "0")} of {formatCount(inspectionJob?.declaredPointCount ?? "0")} header-declared points.
            </span>
            {inspectionJob && inspectionProgressPercent(inspectionJob.decodedPointCount, inspectionJob.declaredPointCount) !== null && (
              <progress
                aria-label="Point-record inspection progress against the header-declared count"
                max={100}
                value={inspectionProgressPercent(inspectionJob.decodedPointCount, inspectionJob.declaredPointCount) ?? 0}
              />
            )}
            <button onClick={() => { void cancelRecordInspection(); }} disabled={inspectionJob?.status === "cancelling"}>
              {inspectionJob?.status === "cancelling" ? "Cancelling…" : "Cancel inspection"}
            </button>
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
                inspecting={inspectingSourceId === source.id}
                scanBusy={inspectingSourceId !== null}
                onInspect={() => { void inspectSourceRecords(source.id); }}
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
