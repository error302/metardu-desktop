/**
 * Export Panel — Integration & Export (ADR-0005)
 *
 * Lists the 7 available export formats and lets the surveyor export
 * survey data to a file. Shows a "Save As" dialog via the main process.
 *
 * Only an actual project or workflow result may be exported. Unsupported
 * source data and unverified statutory requirements remain unavailable.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Download, FileText, FileSpreadsheet, FileCode, Map, Globe, FileBox, Printer, FolderArchive, FileJson } from "lucide-react";
import { useSurveyState } from "../SurveyStateContext.js";
import { COUNTRY_OPTIONS, getPlanSheet } from "../countries.js";
import { SHEET_SIZES_PT } from "../map-svg.js";

interface ExporterInfo {
  format: string;
  description: string;
  fileExtension: string;
}

const COUNTRIES = COUNTRY_OPTIONS.map((o) => ({ code: o.code, name: o.name }));

const FORMAT_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  "geojson": Globe,
  "geopackage": FileBox,
  "pyqgis-script": FileCode,
  "gcp": Map,
  "qgs-project": FileText,
  "osm-changeset": Globe,
  "dxf": FileSpreadsheet,
  "landxml": FileJson,
};

export const ExportPanel: React.FC = () => {
  const { state: surveyState, activeProject, updateProject } = useSurveyState();
  const [exporters, setExporters] = useState<ExporterInfo[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("geojson");
  const [countryCode, setCountryCode] = useState("");
  const [outputWgs84, setOutputWgs84] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ filePath: string; bytes: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Project metadata fields
  const [projectName, setProjectName] = useState("");
  const [surveyorName, setSurveyorName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [surveyDate, setSurveyDate] = useState("");

  // Draft print-plan exports (300 DPI PNG + parcel booklet PDF)
  const [planSheetSize, setPlanSheetSize] = useState("a4");
  const [planOrientation, setPlanOrientation] = useState<"landscape" | "portrait">("landscape");
  const [planExporting, setPlanExporting] = useState(false);
  const [bookletExporting, setBookletExporting] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [planResult, setPlanResult] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  // Dirty flag: set when the user changes a plan control; cleared after a
  // persist write or a project switch, so opening the panel never bumps
  // the project version (and thus never triggers a spurious sync re-push).
  const planSheetDirtyRef = React.useRef(false);

  // Load the ACTIVE PROJECT's remembered plan-sheet choices (sheet size +
  // orientation) so every project keeps its own print settings across
  // restarts and sync. When the project has none saved, seed from the
  // selected country's statutory plan-sheet profile (e.g. ZA → A1, US → letter).
  useEffect(() => {
    const ps = activeProject?.planSheet;
    const profile = countryCode ? getPlanSheet(countryCode) : null;
    // Saved settings win where present; unset fields fall back to the
    // selected country's statutory profile (e.g. ZA → A1, US → letter).
    setPlanSheetSize(ps?.sheetSize ?? profile?.defaultSheetSize ?? "a4");
    setPlanOrientation(ps?.orientation ?? profile?.defaultOrientation ?? "landscape");
    planSheetDirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.planSheet, countryCode]);

  // Persist plan-sheet choices back to the active project, debounced, ONLY
  // when the user changed something. Sheet + orientation are merged into
  // the project's existing planSheet so a fixed scale chosen in the MapView
  // print preview is never clobbered by an ExportPanel change.
  useEffect(() => {
    if (!activeProject || !planSheetDirtyRef.current) return;
    const timer = window.setTimeout(() => {
      planSheetDirtyRef.current = false;
      void updateProject(activeProject.id, {
        planSheet: {
          ...(activeProject.planSheet ?? {}),
          sheetSize: planSheetSize,
          orientation: planOrientation,
        },
      });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, planSheetSize, planOrientation, updateProject]);

  useEffect(() => {
    // Fetch available exporters from the main process.
    const w = window as unknown as {
      metardu?: {
        export?: {
          list?: () => Promise<ExporterInfo[]>;
        };
      };
    };
    const listFormats = w.metardu?.export?.list;
    if (!listFormats) {
      setExporters([]);
      setError("Export format registry is unavailable. Run METARDU Desktop to load supported formats.");
      return;
    }
    listFormats().then(setExporters).catch((cause: unknown) => {
      setExporters([]);
      setError(`Could not load export formats: ${cause instanceof Error ? cause.message : "unknown error"}`);
    });
  }, []);

  /** Resolve only an actual active-project or current workflow result. */
  const resolveSurveyOutput = useCallback((): { output: unknown; country: string } | null => {
    if (activeProject && activeProject.output !== null && activeProject.output !== undefined) {
      return { output: activeProject.output, country: activeProject.countryCode ?? countryCode };
    }
    if (surveyState) {
      if (surveyState.output === null || surveyState.output === undefined) return null;
      return { output: surveyState.output, country: surveyState.countryCode || countryCode };
    }
    return null;
  }, [activeProject, surveyState, countryCode]);
  const resolvedSurveyOutput = resolveSurveyOutput();
  const effectiveCountryCode = activeProject?.countryCode || surveyState?.countryCode || countryCode;

  // Draft plan-sheet export. It does not establish statutory compliance.
  const exportPlanPng = async () => {
    setPlanExporting(true);
    setPlanResult(null);
    setPlanError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportPng?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
        }) => Promise<{ canceled: true } | { canceled: false; filePath: string; widthPx: number; heightPx: number; scaleDenominator: number; summary: string }> } };
      };
      const api = w.metardu?.map?.exportPng;
      if (!api) {
        setPlanError("Plan export not available — run in the Electron app.");
        return;
      }
      const resolved = resolveSurveyOutput();
      if (!resolved) throw new Error("There is no survey output to export. Run a workflow and save its real result to a project first.");
      const { output, country } = resolved;
      if (!country) throw new Error("Select a jurisdiction for the draft plan export.");
      const result = await api({
        surveyOutput: output,
        projectName: projectName || "Survey Plan",
        countryCode: country,
        surveyorName: surveyorName,
        sheetSize: planSheetSize,
        orientation: planOrientation,
      });
      if (result.canceled) {
        setPlanResult("Export cancelled.");
      } else {
        setPlanResult(`Saved 300 DPI plan (${result.widthPx}×${result.heightPx}px, scale 1:${result.scaleDenominator}, ${result.summary}) → ${result.filePath}`);
      }
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanExporting(false);
    }
  };

  // Draft report PDF with a plan image. Regulatory acceptance is not asserted.
  const exportPlanReport = async () => {
    setReportExporting(true);
    setPlanResult(null);
    setPlanError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportReport?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
          scaleDenominator?: number;
        }) => Promise<{ canceled: true } | { canceled: false; filePath: string; bytes: number; widthPx: number; heightPx: number; scaleDenominator: number; fitsSheet: boolean; summary: string }> } };
      };
      const api = w.metardu?.map?.exportReport;
      if (!api) {
        setPlanError("Draft report export not available — run in the Electron app.");
        return;
      }
      const resolved = resolveSurveyOutput();
      if (!resolved) throw new Error("There is no survey output to export. Run a workflow and save its real result to a project first.");
      const { output, country } = resolved;
      if (!country) throw new Error("Select a jurisdiction for the draft report export.");
      const result = await api({
        surveyOutput: output,
        projectName: projectName || "Survey Plan",
        countryCode: country,
        surveyorName: surveyorName,
        sheetSize: planSheetSize,
        orientation: planOrientation,
      });
      if (result.canceled) {
        setPlanResult("Export cancelled.");
      } else {
        setPlanResult(
          `Saved draft report (${(result.bytes / 1024).toFixed(1)} KB, map page ${result.widthPx}×${result.heightPx}px @ 300 DPI, scale 1:${result.scaleDenominator}) → ${result.filePath}`,
        );
      }
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setReportExporting(false);
    }
  };

  // Batch parcel booklet — one 300 DPI plan + booklet PDF (index + one plan
  // page per parcel) when the project carries multiple parcels/sections.
  const exportPlanBooklet = async () => {
    setBookletExporting(true);
    setPlanResult(null);
    setPlanError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportBooklet?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
        }) => Promise<{ canceled: true } | { canceled: false; bookletPath: string; pageCount: number; pngFiles: Array<{ label: string; path: string; bytes: number }>; reportFiles: Array<{ label: string; path: string; bytes: number }> }> } };
      };
      const api = w.metardu?.map?.exportBooklet;
      if (!api) {
        setPlanError("Booklet export not available — run in the Electron app.");
        return;
      }
      const resolved = resolveSurveyOutput();
      if (!resolved) throw new Error("There is no survey output to export. Run a workflow and save its real result to a project first.");
      const { output, country } = resolved;
      if (!country) throw new Error("Select a jurisdiction for the draft plan booklet export.");
      const result = await api({
        surveyOutput: output,
        projectName: projectName || "Survey Plan Booklet",
        countryCode: country,
        surveyorName: surveyorName,
        sheetSize: planSheetSize,
        orientation: planOrientation,
      });
      if (result.canceled) {
        setPlanResult("Export cancelled.");
      } else {
        setPlanResult(
          `Booklet (${result.pageCount} pages, index page) → ${result.bookletPath}. ` +
          `${result.reportFiles.length} per-parcel statutory reports: ${result.reportFiles.map((f) => f.path).join(", ")}. ` +
          `Individual 300 DPI plans: ${result.pngFiles.map((f) => f.path).join(", ")}`,
        );
      }
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setBookletExporting(false);
    }
  };

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    setResult(null);

    try {
      const w = window as unknown as {
        metardu?: {
          export?: {
            survey?: (
              format: string,
              surveyOutput: unknown,
              options: Record<string, unknown>,
            ) => Promise<{ filePath: string; bytes: number; warnings: string[] }>;
          };
        };
      };

      if (!w.metardu?.export?.survey) {
        throw new Error("Export not available — running in browser mode. Launch the Electron app to export.");
      }

      const resolved = resolveSurveyOutput();
      if (!resolved) throw new Error("There is no survey output to export. Run a workflow and save its real result to a project first.");
      if (!resolved.country) throw new Error("Select the jurisdiction for this project before exporting.");
      const options: Record<string, unknown> = {
        countryCode: resolved.country,
        outputWgs84,
        projectMetadata: {
          projectName,
          surveyorName,
          licenseNumber,
          surveyDate,
        },
      };

      const surveyOutput = resolved.output;

      // For GCP exporter, pass GcpInput instead of SurveyOutput.
      if (selectedFormat === "gcp") {
        // Extract points from the survey output if it has beacons/points.
        const anyOutput = surveyOutput as Record<string, unknown>;
        const rawTin = anyOutput.tin;
        const tinVertices = rawTin && typeof rawTin === "object" && "vertices" in rawTin && Array.isArray(rawTin.vertices)
          ? rawTin.vertices
          : [];
        const rawBeacons = Array.isArray(anyOutput.allBeacons) ? anyOutput.allBeacons : [];
        const beacons = (rawBeacons.length > 0 ? rawBeacons : tinVertices) as Array<{
          position?: { easting: number; northing: number };
          easting?: number; northing?: number; label?: string; id?: string;
        }>;
        if (beacons.length === 0 || beacons.some((b) =>
          !Number.isFinite(b.position?.easting ?? b.easting) ||
          !Number.isFinite(b.position?.northing ?? b.northing)
        )) {
          throw new Error("GCP export requires real point coordinates. No complete GCP point set is available in this result.");
        }
        throw new Error("GCP export is unavailable until each point has a verified elevation, image coordinate, and stated accuracy.");
      } else if (selectedFormat === "osm-changeset") {
        throw new Error("OSM changeset export is unavailable until the project has verified WGS84 coordinates and explicit feature/tag choices.");
      } else {
        const res = await w.metardu.export.survey(selectedFormat, surveyOutput, options);
        setResult(res);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }, [selectedFormat, countryCode, outputWgs84, projectName, surveyorName, licenseNumber, surveyDate]);

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
          Export Survey Data
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Export the active project result to available file formats. An export does not validate its CRS, uncertainty, statutory compliance, or acceptance by another system.
        </p>
      </div>

      {/* Survey state indicator */}
      {resolvedSurveyOutput ? (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text-primary)" }}>Export source:</strong> {activeProject?.name ?? `${surveyState?.surveyType} workflow result`}
          <span style={{ color: "var(--text-tertiary)", marginLeft: "8px" }}>
            {activeProject
              ? `(${activeProject.surveyType}, ${activeProject.countryCode}, v${activeProject.version})`
              : surveyState
                ? `(${new Date(surveyState.timestamp).toLocaleTimeString()}, country: ${surveyState.countryCode})`
                : ""}
          </span>
        </div>
      ) : (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-secondary)", border: "1px solid var(--border-default)", fontSize: "12px", color: "var(--text-tertiary)" }}>
          No survey output is available. Run a workflow and save its real result before exporting.
        </div>
      )}

      {/* Format selector */}
      <div>
        <label style={{ display: "block", fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Format
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
          {exporters.map((exp) => {
            const Icon = FORMAT_ICONS[exp.format] ?? FileText;
            const isSelected = selectedFormat === exp.format;
            return (
              <button
                key={exp.format}
                onClick={() => setSelectedFormat(exp.format)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px",
                  padding: "12px", borderRadius: "8px", border: `1px solid ${isSelected ? "var(--accent-primary)" : "var(--border-default)"}`,
                  background: isSelected ? "var(--bg-hover)" : "transparent", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Icon size={16} strokeWidth={1.75} />
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{exp.format}</span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{exp.description}</span>
                <span style={{ fontSize: "10px", color: "var(--text-disabled)", fontFamily: "var(--font-mono)" }}>.{exp.fileExtension}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Project metadata */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="Project Name" value={projectName} onChange={setProjectName} />
        <Field label="Surveyor Name" value={surveyorName} onChange={setSurveyorName} />
        <Field label="Registration Number (metadata only)" value={licenseNumber} onChange={setLicenseNumber} />
        <Field label="Survey Date" value={surveyDate} onChange={setSurveyDate} />
      </div>

      {/* Country + WGS84 toggle */}
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
            Country
          </label>
          <select
            value={effectiveCountryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px" }}
          >
            <option value="">Select jurisdiction</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", paddingBottom: "6px" }}>
          <input
            type="checkbox"
            checked={outputWgs84}
            onChange={(e) => setOutputWgs84(e.target.checked)}
            style={{ accentColor: "var(--accent-primary)" }}
          />
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Output as WGS84 (auto-convert via sidecar)
          </span>
        </label>
      </div>

      {selectedFormat === "landxml" && (
        <div role="note" style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-tertiary)", border: "1px solid var(--accent-primary)", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          LandXML is an interchange format. This export is not a regulator-approved filing, and this panel does not validate the project CRS or local submission profile. Confirm format and coordinate requirements with your receiving organization.
        </div>
      )}
      {/* Export button */}
      <div>
        <button
          onClick={handleExport}
          disabled={exporting || !resolvedSurveyOutput || exporters.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "10px 20px", borderRadius: "8px", border: "none",
            background: exporting ? "var(--bg-hover)" : "var(--accent-primary)",
            color: "#fff", fontSize: "14px", fontWeight: 500, cursor: exporting ? "wait" : "pointer",
          }}
        >
          <Download size={16} strokeWidth={2} />
          {exporting ? "Exporting…" : `Export as .${exporters.find((e) => e.format === selectedFormat)?.fileExtension ?? "?"}`}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)" }}>
          <div style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 500 }}>
            Exported {result.bytes.toLocaleString()} bytes to:
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
            {result.filePath}
          </div>
          {result.warnings.length > 0 && (
            <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "8px" }}>
              Warnings: {result.warnings.join("; ")}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)" }}>
          <div style={{ fontSize: "13px", color: "var(--text-error)" }}>{error}</div>
        </div>
      )}

      {/* Data source notice */}
      <div style={{ fontSize: "11px", color: "var(--text-disabled)", fontStyle: "italic" }}>
        {resolvedSurveyOutput
          ? "Using the available project or workflow result. Review provenance, CRS, units, and quality status before sharing."
          : "No survey output is available; export is blocked until a workflow result exists."}
      </div>

      {/* Draft plan output (300 DPI PNG + parcel booklet PDF) */}
      <div style={{
        padding: "16px", borderRadius: "8px", border: "1px solid var(--border-default)",
        background: "var(--bg-secondary)", display: "flex", flexDirection: "column", gap: "12px",
      }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Printer size={16} strokeWidth={1.75} /> Draft Plan Sheet
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Draft 300 DPI plan output. Layout choices do not establish regulatory compliance or acceptance.
          </p>
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
              Sheet
            </label>
            <select
              value={planSheetSize}
              onChange={(e) => { setPlanSheetSize(e.target.value); planSheetDirtyRef.current = true; }}
              style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px" }}
            >
              {Object.keys(SHEET_SIZES_PT).map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
              Orientation
            </label>
            <select
              value={planOrientation}
              onChange={(e) => { setPlanOrientation(e.target.value as "landscape" | "portrait"); planSheetDirtyRef.current = true; }}
              style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px" }}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <button
            onClick={exportPlanPng}
            disabled={planExporting || bookletExporting || reportExporting}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              borderRadius: "6px", border: "1px solid var(--accent-primary)", background: "transparent",
              color: "var(--accent-primary)", fontSize: "13px", fontWeight: 500,
              cursor: planExporting ? "wait" : "pointer",
            }}
          >
            <Download size={14} />
            {planExporting ? "Exporting plan…" : "Export 300 DPI PNG"}
          </button>
          <button
            onClick={exportPlanBooklet}
            disabled={planExporting || bookletExporting || reportExporting}
            title="Multi-parcel projects: one plan per parcel + a booklet PDF with an index page"
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              borderRadius: "6px", border: "none", background: "var(--accent-primary)",
              color: "#fff", fontSize: "13px", fontWeight: 500,
              cursor: bookletExporting ? "wait" : "pointer",
            }}
          >
            <FolderArchive size={14} />
            {bookletExporting ? "Building booklet…" : "Export Parcel Booklet (PDF)"}
          </button>
          <button
            onClick={exportPlanReport}
            disabled={planExporting || bookletExporting || reportExporting}
            title="Draft report with a 300 DPI map page; regulator acceptance is not asserted"
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              borderRadius: "6px", border: "1px solid var(--accent-primary)",
              background: "transparent", color: "var(--accent-primary)", fontSize: "13px", fontWeight: 600,
              cursor: reportExporting ? "wait" : "pointer",
            }}
          >
            <FileText size={14} />
            {reportExporting ? "Building report…" : "Draft Plan Report (PDF)"}
          </button>
        </div>

        {planResult && (
          <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            ✓ {planResult}
          </div>
        )}
        {planError && (
          <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)", fontSize: "12px", color: "var(--text-error)" }}>
            ✗ {planError}
          </div>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div>
    <label style={{ display: "block", fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
      {label}
    </label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: "6px 10px", borderRadius: "6px",
        border: "1px solid var(--border-default)", background: "var(--bg-secondary)",
        color: "var(--text-primary)", fontSize: "13px",
      }}
    />
  </div>
);
