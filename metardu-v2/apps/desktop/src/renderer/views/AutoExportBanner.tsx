/**
 * AutoExportBanner — shows the auto-export status after a workflow run.
 *
 * When a cadastral/topographic/engineering/sectional/setting-out view
 * finishes a run, SurveyStateContext fires `metardu:map:autoExport` and
 * the statutory plan is written to userData/auto-exports/ with no
 * ExportPanel visit. This banner surfaces that outcome inline so the
 * surveyor knows exactly where the filing-ready plan landed.
 *
 * Renders nothing in browser mode (no auto-export bridge) and nothing
 * until a run actually completes.
 */

import React from "react";
import { useSurveyState } from "../SurveyStateContext.js";

export const AutoExportBanner: React.FC = () => {
  const { autoExportStatus, dismissAutoExportStatus } = useSurveyState();
  if (!autoExportStatus) return null;

  const { status, message, directory, kind, pageCount, reportFile } = autoExportStatus;

  const palette =
    status === "running"
      ? { bg: "rgba(45,212,191,0.08)", border: "var(--status-info)", icon: "⏳" }
      : status === "done"
        ? { bg: "rgba(16,185,129,0.08)", border: "var(--status-success)", icon: "✓" }
        : { bg: "rgba(239,68,68,0.08)", border: "var(--status-error)", icon: "✗" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "8px 12px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--text-sm)",
        color: "var(--text-primary)",
      }}
    >
      <span style={{ fontSize: "13px", lineHeight: "18px" }}>{palette.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{message}</div>
        {directory && status === "done" && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              wordBreak: "break-all",
              marginTop: "2px",
            }}
            title={directory}
          >
            {kind === "booklet"
              ? `📕 ${pageCount ?? ""} pages · ${directory}`
              : `🖼 300 DPI plan · ${directory}`}
          </div>
        )}
        {reportFile && status === "done" && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              wordBreak: "break-all",
              marginTop: "2px",
            }}
            title={reportFile.path}
          >
            📄 Statutory report PDF ({(reportFile.bytes / 1024).toFixed(1)} KB) · {reportFile.path}
          </div>
        )}
        {status === "running" && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "2px" }}>
            Writing statutory plan sheet to the auto-exports folder…
          </div>
        )}
      </div>
      {status !== "running" && (
        <button
          onClick={dismissAutoExportStatus}
          title="Dismiss"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-tertiary)",
            fontSize: "14px",
            lineHeight: 1,
            padding: "2px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};
