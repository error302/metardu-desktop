import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileInput, Layers3, Ruler, ShieldCheck } from "lucide-react";
import { PointCloudPreviewCanvas } from "../components/PointCloudPreviewCanvas.js";
import type {
  PointCloudCoordinateContext,
  PointCloudHeaderDetails,
  PointCloudRecordInspectionJobStatus,
  PointCloudRecordInspection,
  PointCloudPreviewResult,
  PointCloudPreviewStatus,
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
    title: "Add project-aware analysis tools",
    description: "Let reviewed tools consume bounded source chunks while keeping file paths and full clouds out of the renderer.",
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
            {inspection.classificationCounts.map(({ code, count, standardMeaning, interpretation, sourceDescription }) => {
              const fallbackMeaning = interpretation === "user_defined"
                ? "User-defined"
                : interpretation === "profile_dependent"
                  ? "Base-reserved code; domain profile not validated"
                  : interpretation === "reserved"
                    ? "Reserved in base LAS table"
                    : null;
              return (
                <span key={code} style={{ padding: "2px 6px", border: "1px solid var(--border-subtle)", borderRadius: 3 }}>
                  Class {code}{(standardMeaning || fallbackMeaning) && ` · ${standardMeaning ?? fallbackMeaning}`}: {formatCount(count)}
                  {sourceDescription && <span style={{ color: "var(--text-secondary)" }}> · Source label: {sourceDescription}</span>}
                </span>
              );
            })}
          </div>
        )}
        <div style={{ color: "var(--text-tertiary)", fontSize: 10, marginTop: 5 }}>
          {inspection.classificationInterpretation?.standardScheme
            ? `${inspection.classificationInterpretation.standardScheme} meanings are selected by point format. Source lookup descriptions are shown as supplied; domain profiles and classification correctness are not validated.`
            : inspection.version === "1.4"
              ? "This saved report has no version-aware class meaning metadata; numeric codes remain as stored."
              : "Class meanings are not applied for this LAS version; numeric codes remain as stored."}
          {" "}These are existing source labels; no new classification was run.
        </div>
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
      <div style={{
        color: inspection.headerBoundsMatchDecodedExtrema === false
          ? "var(--status-warning, #D97706)"
          : inspection.headerBoundsMatchDecodedExtrema === true
            ? "var(--status-success, #22C55E)"
            : "var(--text-secondary)",
        fontSize: 11,
      }}>
        Header min/max versus decoded extrema: {inspection.headerBoundsMatchDecodedExtrema === undefined
          ? "not recorded by this older report"
          : inspection.headerBoundsMatchDecodedExtrema === null
            ? "inconclusive for this scan"
            : inspection.headerBoundsMatchDecodedExtrema
              ? "match"
              : "mismatch"}.
        {" "}The comparison allows a small floating-point representation difference; it is not a positional-accuracy check.
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

function horizontalUnitLabel(unit: PointCloudCoordinateContext["horizontalUnit"]): string {
  switch (unit) {
    case "metre": return "metre";
    case "international_foot": return "international foot";
    case "us_survey_foot": return "US survey foot";
    case "degree": return "degree";
    case "unknown": return "unknown";
  }
}

function SourceCoordinateContextEditor({
  source,
  saving,
  onSave,
}: {
  source: PointCloudSourceSummary;
  saving: boolean;
  onSave: (context: PointCloudCoordinateContext | null) => Promise<void>;
}): React.ReactElement {
  const [horizontalCrsLabel, setHorizontalCrsLabel] = useState("");
  const [horizontalUnit, setHorizontalUnit] = useState<PointCloudCoordinateContext["horizontalUnit"]>("unknown");
  const [coordinateEpoch, setCoordinateEpoch] = useState("");
  const [verticalKind, setVerticalKind] = useState<"" | NonNullable<PointCloudCoordinateContext["verticalReference"]>["kind"]>("");
  const [verticalName, setVerticalName] = useState("");
  const [verticalUnit, setVerticalUnit] = useState<NonNullable<PointCloudCoordinateContext["verticalReference"]>["unit"]>("unknown");
  const [formError, setFormError] = useState<string | null>(null);
  const context = source.coordinateContext;

  useEffect(() => {
    setHorizontalCrsLabel(context?.horizontalCrsLabel ?? "");
    setHorizontalUnit(context?.horizontalUnit ?? "unknown");
    setCoordinateEpoch(context?.coordinateEpoch === null || context?.coordinateEpoch === undefined ? "" : String(context.coordinateEpoch));
    setVerticalKind(context?.verticalReference?.kind ?? "");
    setVerticalName(context?.verticalReference?.name ?? "");
    setVerticalUnit(context?.verticalReference?.unit ?? "unknown");
    setFormError(null);
  }, [source.id, context]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const epochText = coordinateEpoch.trim();
    const epoch = epochText ? Number(epochText) : null;
    if (epoch !== null && (!Number.isFinite(epoch) || epoch <= 0)) {
      setFormError("Coordinate epoch must be a positive decimal year or left blank.");
      return;
    }
    const name = verticalName.trim();
    if ((verticalKind && !name) || (!verticalKind && name)) {
      setFormError("Choose a vertical reference type and enter its exact name, or leave both blank.");
      return;
    }
    await onSave({
      schemaVersion: 1,
      horizontalCrsLabel: horizontalCrsLabel.trim() || null,
      horizontalUnit,
      coordinateEpoch: epoch,
      verticalReference: verticalKind
        ? { kind: verticalKind, name, unit: verticalUnit }
        : null,
      evidenceStatus: "user_declared_unverified",
    });
  };

  const clear = async () => {
    setFormError(null);
    await onSave(null);
  };

  return (
    <details style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 9 }}>
      <summary style={{ cursor: "pointer", color: "var(--accent-primary)", fontSize: 11 }}>
        Source coordinate context: {source.coordinateContextStatus === "invalid"
          ? "invalid stored declaration"
          : context ? "user-declared · unverified" : "not declared"}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 10, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>
          Declare this file's context separately from the project. METARDU does not copy values from the project or interpret the LAS CRS record here. This declaration does not validate or transform coordinates and does not enable classification.
        </p>
        {source.coordinateContextStatus === "invalid" && (
          <div role="status" style={{ padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)" }}>
            The saved declaration is invalid and its stored value has been preserved. Save a replacement or clear it; no partial values are being shown.
          </div>
        )}
        {context && source.coordinateContextStatus !== "invalid" && (
          <div>
            Stored declaration: {context.horizontalCrsLabel ?? "horizontal CRS not recorded"} · {horizontalUnitLabel(context.horizontalUnit)}
            {context.coordinateEpoch !== null && ` · epoch ${context.coordinateEpoch}`}
            {context.verticalReference && ` · ${context.verticalReference.kind}: ${context.verticalReference.name} (${context.verticalReference.unit})`}
            {" · "}{context.evidenceStatus.replaceAll("_", " ")}.
          </div>
        )}
        <form onSubmit={(event) => { void save(event); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Horizontal CRS label or identifier
            <input value={horizontalCrsLabel} maxLength={256} onChange={(event) => setHorizontalCrsLabel(event.target.value)} placeholder="EPSG code or local grid name" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Horizontal coordinate unit
            <select value={horizontalUnit} onChange={(event) => setHorizontalUnit(event.target.value as PointCloudCoordinateContext["horizontalUnit"])}>
              <option value="unknown">Unknown / not declared</option>
              <option value="metre">Metre</option>
              <option value="international_foot">International foot</option>
              <option value="us_survey_foot">US survey foot</option>
              <option value="degree">Degree</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Coordinate epoch (decimal year)
            <input inputMode="decimal" value={coordinateEpoch} onChange={(event) => setCoordinateEpoch(event.target.value)} placeholder="Optional" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Vertical reference type
            <select value={verticalKind} onChange={(event) => setVerticalKind(event.target.value as typeof verticalKind)}>
              <option value="">Not declared</option>
              <option value="ellipsoidal">Ellipsoidal</option>
              <option value="orthometric">Orthometric</option>
              <option value="local">Local</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Exact vertical reference name
            <input value={verticalName} maxLength={200} onChange={(event) => setVerticalName(event.target.value)} placeholder="Optional" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            Vertical unit
            <select value={verticalUnit} onChange={(event) => setVerticalUnit(event.target.value as NonNullable<PointCloudCoordinateContext["verticalReference"]>["unit"])}>
              <option value="unknown">Unknown</option>
              <option value="metre">Metre</option>
              <option value="international_foot">International foot</option>
              <option value="us_survey_foot">US survey foot</option>
            </select>
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save source declaration"}</button>
            <button type="button" onClick={() => { void clear(); }} disabled={saving || (!context && source.coordinateContextStatus !== "invalid")}>
              Clear declaration
            </button>
          </div>
        </form>
        {formError && <div role="alert" style={{ color: "var(--status-error, #EF4444)" }}>{formError}</div>}
      </div>
    </details>
  );
}

function SourceCard({
  source,
  storageStatus,
  verifying,
  onVerify,
  inspecting,
  scanBusy,
  onInspect,
  previewing,
  previewBusy,
  onPreview,
  savingContext,
  onSaveContext,
}: {
  source: PointCloudSourceSummary;
  storageStatus: PointCloudSourceIntegrityStatus;
  verifying: boolean;
  onVerify: () => void;
  inspecting: boolean;
  scanBusy: boolean;
  onInspect: () => void;
  previewing: boolean;
  previewBusy: boolean;
  onPreview: () => void;
  savingContext: boolean;
  onSaveContext: (context: PointCloudCoordinateContext | null) => Promise<void>;
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
        <button onClick={onPreview} disabled={previewBusy || scanBusy}>
          {previewing ? "Building point preview…" : "Open class-colored preview"}
        </button>
      </div>
      <SourceCoordinateContextEditor source={source} saving={savingContext} onSave={onSaveContext} />
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
  const [savingContextSourceId, setSavingContextSourceId] = useState<string | null>(null);
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
  const [openingPreviewSourceId, setOpeningPreviewSourceId] = useState<string | null>(null);
  const [previewJob, setPreviewJob] = useState<{
    jobId: string;
    sourceId: string;
    status: "running" | "cancelling";
    decodedPointCount: string;
    declaredPointCount: string;
    selectedPointCount: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ sourceId: string; result: PointCloudPreviewResult } | null>(null);
  const previewingSourceId = previewJob?.sourceId ?? openingPreviewSourceId;
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
    return window.metardu.projects.onChanged(() => {
      setPreview(null);
      void refreshSources();
    });
  }, [refreshSources]);

  useEffect(() => {
    const jobId = inspectionJob?.jobId;
    if (!jobId) return;
    let stopped = false;
    let timer: number | undefined;

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
        } else if (status.status === "failed") {
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

  useEffect(() => {
    const jobId = previewJob?.jobId;
    if (!jobId) return;
    let stopped = false;
    let settled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status: PointCloudPreviewStatus = await window.metardu.pointCloud.previewStatus(jobId);
        if (stopped) return;
        if (status.status === "running" || status.status === "cancelling") {
          setPreviewJob((current) => current?.jobId === jobId ? {
            ...current,
            status: status.status,
            decodedPointCount: status.decodedPointCount,
            declaredPointCount: status.declaredPointCount,
            selectedPointCount: status.selectedPointCount,
          } : current);
          timer = window.setTimeout(() => { void poll(); }, 500);
          return;
        }

        settled = true;
        if (status.status === "completed") {
          setPreview({ sourceId: status.result.sourceId, result: status.result });
          setVerificationBySourceId((current) => ({ ...current, [status.result.sourceId]: "verified" }));
          setNotice(
            `Previewed ${formatCount(status.result.renderedPointCount.toString())} sampled points from ${status.result.sourceFileName}. The full ${formatCount(status.result.decodedPointCount)}-point source scan completed and its hash matched at both ends.`,
          );
        } else if (status.status === "cancelled") {
          setNotice("Point-cloud preview cancelled. The partial sample was discarded.");
        } else if (status.status === "failed") {
          setError(status.message);
        }
        setPreviewJob((current) => current?.jobId === jobId ? null : current);
      } catch (cause) {
        if (stopped) return;
        settled = true;
        setError(cause instanceof Error ? cause.message : String(cause));
        setPreviewJob((current) => current?.jobId === jobId ? null : current);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (!settled) void window.metardu.pointCloud.cancelPreview(jobId).catch(() => undefined);
    };
  }, [previewJob?.jobId]);

  useEffect(() => {
    const jobId = previewJob?.jobId;
    if (!jobId) return;
    return window.metardu.projects.onChanged(() => {
      setPreview(null);
      void window.metardu.pointCloud.cancelPreview(jobId).catch(() => undefined);
    });
  }, [previewJob?.jobId]);

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
      if (result.status !== "verified") {
        setPreview((current) => current?.sourceId === sourceId ? null : current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVerifyingSourceId(null);
    }
  };

  const saveSourceCoordinateContext = async (
    sourceId: string,
    coordinateContext: PointCloudCoordinateContext | null,
  ) => {
    setSavingContextSourceId(sourceId);
    setError(null);
    try {
      const result = await window.metardu.pointCloud.setSourceCoordinateContext(sourceId, coordinateContext);
      setSources((current) => current.map((source) => source.id === result.sourceId
        ? {
            ...source,
            coordinateContext: result.coordinateContext ?? undefined,
            coordinateContextStatus: undefined,
          }
        : source));
      setNotice(result.coordinateContext
        ? `Saved the user-declared, unverified coordinate context for ${sources.find((source) => source.id === sourceId)?.fileName ?? "the source"}.`
        : "Cleared the source coordinate declaration.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingContextSourceId(null);
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

  const startPreview = async (sourceId: string) => {
    setOpeningPreviewSourceId(sourceId);
    setPreview(null);
    setError(null);
    setNotice("Verifying the stored copy, then reading its point records in bounded batches to build the preview sample.");
    try {
      const job = await window.metardu.pointCloud.startPreview(sourceId);
      setPreviewJob({
        jobId: job.jobId,
        sourceId,
        status: "running",
        decodedPointCount: "0",
        declaredPointCount: job.declaredPointCount,
        selectedPointCount: 0,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpeningPreviewSourceId(null);
    }
  };

  const cancelPreview = async () => {
    if (!previewJob || previewJob.status === "cancelling") return;
    try {
      const result = await window.metardu.pointCloud.cancelPreview(previewJob.jobId);
      if (result.accepted) {
        setPreviewJob((current) => current?.jobId === previewJob.jobId
          ? { ...current, status: "cancelling" }
          : current);
        setNotice("Cancellation requested. The current bounded point batch will finish, then the preview sample will be discarded.");
      }
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
          Preserve LAS/LAZ sources in a survey project, inspect their class summaries, and open a bounded, hash-verified visual preview.
        </p>
      </header>

      <section role="status" aria-live="polite" style={{ ...panelStyle, display: "flex", gap: 12, borderColor: "var(--status-warning, #D97706)", background: "rgba(217, 119, 6, 0.08)" }}>
        <AlertTriangle size={20} color="var(--status-warning, #D97706)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--text-primary)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
            <strong>Source inspection reports existing class labels; classification algorithms and derived outputs are not available.</strong>
          <span>
            METARDU preserves a copied source, verifies its hash before and after an explicit scan, and can decode the point records declared by its LAS/LAZ header in bounded batches with progress and cooperative cancellation. It reports existing numeric class codes, LAS 1.4 base meanings by point format, validated source lookup descriptions, return counts, and decoded bounds. It does not run a classifier, validate class correctness or domain profiles, validate all trailing bytes or full-file conformance, interpret CRS or units, create a portable project bundle, or generate a DTM or survey result.
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
          <button className="primary" onClick={importSource} disabled={busy || loadingSources || !hasActiveProject || inspectingSourceId !== null || previewingSourceId !== null}>
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
        {previewJob && (
          <div role="status" aria-live="polite" style={{ padding: 10, border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8 }}>
            <span>
              {previewJob.status === "cancelling"
                ? "Stopping after the current bounded batch; the partial sample will be discarded…"
                : "Reading the complete header-declared point range to build a systematic sample and verify the source hash at EOF."}
            </span>
            <span>
              Decoded {formatCount(previewJob.decodedPointCount)} of {formatCount(previewJob.declaredPointCount)} points · selected {previewJob.selectedPointCount.toLocaleString()} of at most 25,000 preview points.
            </span>
            {inspectionProgressPercent(previewJob.decodedPointCount, previewJob.declaredPointCount) !== null && (
              <progress
                aria-label="Point-cloud preview scan progress against the header-declared count"
                max={100}
                value={inspectionProgressPercent(previewJob.decodedPointCount, previewJob.declaredPointCount) ?? 0}
              />
            )}
            <button onClick={() => { void cancelPreview(); }} disabled={previewJob.status === "cancelling"}>
              {previewJob.status === "cancelling" ? "Cancelling preview…" : "Cancel preview"}
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
                scanBusy={inspectingSourceId !== null || previewingSourceId !== null}
                onInspect={() => { void inspectSourceRecords(source.id); }}
                previewing={previewingSourceId === source.id}
                previewBusy={previewingSourceId !== null}
                onPreview={() => { void startPreview(source.id); }}
                savingContext={savingContextSourceId === source.id}
                onSaveContext={(context) => saveSourceCoordinateContext(source.id, context)}
              />
            ))}
          </div>
        )}
      </section>

      {preview && sources.some((source) => source.id === preview.sourceId) && (
        <section style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
          <header style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 230 }}>
              <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 15 }}>Class-colored point preview</h2>
              <p style={{ margin: "5px 0 0", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
                {preview.result.sourceFileName} · {preview.result.format} {preview.result.version} · point format {preview.result.pointFormatId} · source SHA-256 verified during this read.
              </p>
            </div>
            <button onClick={() => setPreview(null)}>Close preview</button>
          </header>
          <div style={{ padding: 9, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.5 }}>
            Displaying {preview.result.renderedPointCount.toLocaleString()} finite points sampled every {formatCount(preview.result.samplingStride)} source records from {formatCount(preview.result.decodedPointCount)}. This view is for visual inspection only. It is not a DTM, coordinate transformation, measurement surface, or classification result.
          </div>
          <PointCloudPreviewCanvas
            key={`${preview.result.sourceId}:${preview.result.sourceSha256}`}
            preview={preview.result}
            classLabels={sources.find((source) => source.id === preview.sourceId)?.recordInspection?.sourceSha256 === preview.result.sourceSha256
              ? sources.find((source) => source.id === preview.sourceId)?.recordInspection?.classificationCounts.map(({ code, standardMeaning }) => ({ code, meaning: standardMeaning })) ?? []
              : []}
          />
          <div style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 9, overflowWrap: "anywhere" }}>
            Preview source SHA-256 · {preview.result.sourceSha256}
          </div>
        </section>
      )}

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
