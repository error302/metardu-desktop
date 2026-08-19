/**
 * Export Panel — Integration & Export (ADR-0005)
 *
 * Lists the 7 available export formats and lets the surveyor export
 * survey data to a file. Shows a "Save As" dialog via the main process.
 *
 * For the MVP, this panel generates a demo cadastral survey output
 * (the same fixture from the engine tests) so the export pipeline is
 * functional end-to-end. The real wiring (connecting actual survey
 * views to this panel) is a follow-up task.
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
  const [countryCode, setCountryCode] = useState("KE");
  const [outputWgs84, setOutputWgs84] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ filePath: string; bytes: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Project metadata fields
  const [projectName, setProjectName] = useState("Demo Survey — Kasarani");
  const [surveyorName, setSurveyorName] = useState("Jane Wanjiru");
  const [licenseNumber, setLicenseNumber] = useState("LS/1234");
  const [surveyDate, setSurveyDate] = useState("2026-07-24");

  // Statutory print-plan section (300 DPI PNG + parcel booklet PDF)
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
    const profile = getPlanSheet(countryCode);
    // Saved settings win where present; unset fields fall back to the
    // selected country's statutory profile (e.g. ZA → A1, US → letter).
    setPlanSheetSize(ps?.sheetSize ?? profile.defaultSheetSize);
    setPlanOrientation(ps?.orientation ?? profile.defaultOrientation);
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
    w.metardu?.export?.list?.().then(setExporters).catch(() => {
      // In browser mode (no Electron), show a static list.
      setExporters([
        { format: "geojson", description: "GeoJSON with CRS + uncertainty", fileExtension: "geojson" },
        { format: "geopackage", description: "OGC GeoPackage (binary, multi-layer)", fileExtension: "gpkg" },
        { format: "pyqgis-script", description: "PyQGIS loader script", fileExtension: "py" },
        { format: "gcp", description: "GCP file (Pix4D/Metashape/Agisoft)", fileExtension: "csv" },
        { format: "qgs-project", description: "QGIS project file (.qgs)", fileExtension: "qgs" },
        { format: "osm-changeset", description: "OSM changeset XML (JOSM)", fileExtension: "osm" },
        { format: "dxf", description: "DXF (AutoCAD, country-correct layers)", fileExtension: "dxf" },
        { format: "landxml", description: "LandXML 1.2 (NLIMS/ArdhiSasa submission)", fileExtension: "xml" },
      ]);
    });
  }, []);

  /**
   * Resolve the survey output to export: active project → in-memory survey
   * state → demo cadastral fixture (the same ladder handleExport uses).
   */
  const resolveSurveyOutput = useCallback((): { output: unknown; country: string } => {
    if (activeProject && activeProject.output !== null && activeProject.output !== undefined) {
      return { output: activeProject.output, country: activeProject.countryCode ?? countryCode };
    }
    if (surveyState) {
      return { output: surveyState.output, country: surveyState.countryCode || countryCode };
    }
    // Demo fallback — 4-beacon cadastral survey (matches handleExport).
    return {
      country,
      output: {
        form3: {
          pdfBytes: new Uint8Array(0), pageCount: 0, scale: 0,
          coordinateSystemLabel: "Demo", hasDraftWatermark: false,
        },
        allBeacons: [
          { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "Concrete pillar" },
          { label: "B2", position: { easting: 257150.0, northing: 9857700.0 }, description: "Concrete pillar" },
          { label: "B3", position: { easting: 257150.0, northing: 9857750.0 }, description: "Concrete pillar" },
          { label: "B4", position: { easting: 257100.0, northing: 9857750.0 }, description: "Concrete pillar" },
        ],
        residuals: {},
        sigma_0_sq: 1.0,
        passesCadastralTolerance: true,
      },
    };
  }, [activeProject, surveyState, countryCode]);

  // Statutory plan-sheet export — 300 DPI PNG of the active project's plan
  // (per-country title block + footer come from the main process planSheet).
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
      const { output, country } = resolveSurveyOutput();
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

  // Statutory report PDF — the full filing-ready report (A4 cover + the
  // exact 300 DPI plan sheet embedded as the survey-map page) in one
  // click. Same exportReport path MapView's print preview uses, so the
  // embedded map matches what the surveyor would have previewed — no
  // separate Map View step needed. The country's plan-sheet profile
  // (title block, layout, footer) is resolved in main from countryCode.
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
        setPlanError("Statutory report export not available — run in the Electron app.");
        return;
      }
      const { output, country } = resolveSurveyOutput();
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
          `Saved statutory report (${(result.bytes / 1024).toFixed(1)} KB, map page ${result.widthPx}×${result.heightPx}px @ 300 DPI, scale 1:${result.scaleDenominator}) → ${result.filePath}`,
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
      const { output, country } = resolveSurveyOutput();
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

      // Use the real survey output from the shared state if available.
      // Fall back to demo data only if no survey has been run yet.
      const options: Record<string, unknown> = {
        countryCode,
        outputWgs84,
        projectMetadata: {
          projectName,
          surveyorName,
          licenseNumber,
          surveyDate,
          adjustmentRunId: `export-${Date.now()}`,
        },
      };

      let surveyOutput: unknown;
      // Prefer the persisted active project (ProjectStore), then the
      // in-memory survey state, then demo data.
      if (activeProject && activeProject.output !== null && activeProject.output !== undefined) {
        surveyOutput = activeProject.output;
        if (activeProject.countryCode) {
          options.countryCode = activeProject.countryCode;
        }
      } else if (surveyState) {
        surveyOutput = surveyState.output;
        // Override country code from the survey state if set.
        if (surveyState.countryCode) {
          options.countryCode = surveyState.countryCode;
        }
      } else {
        // Demo fallback — 4-beacon cadastral survey.
        surveyOutput = {
          form3: {
            pdfBytes: new Uint8Array(0), pageCount: 0, scale: 0,
            coordinateSystemLabel: "Demo", hasDraftWatermark: false,
          },
          allBeacons: [
            { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "Concrete pillar" },
            { label: "B2", position: { easting: 257150.0, northing: 9857700.0 }, description: "Concrete pillar" },
            { label: "B3", position: { easting: 257150.0, northing: 9857750.0 }, description: "Concrete pillar" },
            { label: "B4", position: { easting: 257100.0, northing: 9857750.0 }, description: "Concrete pillar" },
          ],
          residuals: {},
          sigma_0_sq: 1.0,
          passesCadastralTolerance: true,
          uncertainty: {
            B1: { adjusted: false, reason: "fixed-control" as const },
            B2: { adjusted: false, reason: "fixed-control" as const },
            B3: { adjusted: true, semiMajorAxis: 0.012, semiMinorAxis: 0.008, orientation: 45.3, confidenceLevel: 0.95 },
            B4: { adjusted: true, semiMajorAxis: 0.015, semiMinorAxis: 0.010, orientation: 30.0, confidenceLevel: 0.95 },
          },
        };
      }

      // For GCP exporter, pass GcpInput instead of SurveyOutput.
      if (selectedFormat === "gcp") {
        // Extract points from the survey output if it has beacons/points.
        const anyOutput = surveyOutput as Record<string, unknown>;
        const beacons = (anyOutput.allBeacons ?? anyOutput.tin?.vertices ?? []) as Array<{
          position?: { easting: number; northing: number };
          easting?: number; northing?: number; label?: string; id?: string;
        }>;
        const gcpInput = {
          points: beacons.map((b, i) => ({
            label: b.label ?? b.id ?? `GCP${i + 1}`,
            easting: b.position?.easting ?? b.easting ?? 0,
            northing: b.position?.northing ?? b.northing ?? 0,
            elevation: 0,
            accuracyXY: 0.015,
          })),
        };
        const gcpOptions = { ...options, format: "pix4d" };
        const res = await w.metardu.export.survey(selectedFormat, gcpInput, gcpOptions);
        setResult(res);
      } else if (selectedFormat === "osm-changeset") {
        // OSM needs WGS84 nodes or projectedCoords + callback.
        // For demo: convert beacons to approximate WGS84 lat/lon.
        const anyOutput = surveyOutput as Record<string, unknown>;
        const beacons = (anyOutput.allBeacons ?? []) as Array<{
          label?: string; position?: { easting: number; northing: number };
        }>;
        const osmInput = {
          nodes: beacons.map((b, i) => ({
            id: -(i + 1),
            lat: -1.22 + i * 0.0005,
            lon: 36.90 + i * 0.0005,
            tags: { man_made: "survey_point", name: b.label ?? `P${i + 1}` },
          })),
          ways: beacons.length >= 3 ? [{
            id: -101,
            nodeRefs: beacons.map((_, i) => -(i + 1)).concat([-1]),
            tags: { boundary: "administrative", admin_level: "8", area: "yes" },
          }] : [],
          inputSrid: 4326,
        };
        const res = await w.metardu.export.survey(selectedFormat, osmInput, options);
        setResult(res);
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
          Export your survey to GIS, CAD, or photogrammetry formats. Per ADR-0005, metardu-desktop
          is a survey-grade source of truth that feeds downstream tools.
        </p>
      </div>

      {/* Survey state indicator */}
      {activeProject || surveyState ? (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text-primary)" }}>Active project:</strong> {activeProject?.name ?? `${surveyState?.surveyType} from ${surveyState?.sourceView}`}
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
          No survey output yet. Run a workflow (e.g., Topographic) first, then come back to export. Demo data will be used as fallback.
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
        <Field label="License Number" value={licenseNumber} onChange={setLicenseNumber} />
        <Field label="Survey Date" value={surveyDate} onChange={setSurveyDate} />
      </div>

      {/* Country + WGS84 toggle */}
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
            Country
          </label>
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px" }}
          >
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

      {/* LandXML submission guidance */}
      {selectedFormat === "landxml" && (
        <div style={{
          padding: "12px 16px", borderRadius: "8px",
          background: "var(--bg-tertiary)", border: "1px solid var(--accent-primary)",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent-primary)", marginBottom: "4px" }}>
            📋 LandXML 1.2 — Digital Submission Format
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {countryCode === "KE" && (
              <>Upload the exported .xml file to <strong>National Land Information Management System (NLIMS)</strong> or <strong>ArdhiSasa</strong> for digital cadastral plan submission. The file contains parcel coordinates in Arc 1960 / UTM 37S (EPSG:21037) compatible with Kenya's land registry system.</>
            )}
            {countryCode === "AU" && (
              <>Submit to your state's Land Registry Service (e.g. NSW LRS, Vic LRS) for electronic plan lodgment. Coordinates in GDA2020 / MGA projection.</>
            )}
            {countryCode === "GB" && (
              <>Submit to HM Land Registry for digital plan registration. Coordinates in OSGB36 / British National Grid (EPSG:27700).</>
            )}
            {countryCode === "ZA" && (
              <>Submit to the Surveyor-General via the Deeds Office for SG Diagram lodgment. Coordinates in Hartebeesthoek94 / Lo projection.</>
            )}
            {countryCode === "GH" && (
              <>Submit to the Lands Commission — Survey and Mapping Division for cadastral survey plan lodgment. Coordinates in Leigon / Ghana Metre Grid (EPSG:25000).</>
            )}
            {!["KE", "AU", "GB", "ZA", "GH"].includes(countryCode) && (
              <>LandXML 1.2 format — compatible with most land registry systems. Check your local registry's submission requirements.</>
            )}
          </div>
        </div>
      )}

      {/* Export button */}
      <div>
        <button
          onClick={handleExport}
          disabled={exporting}
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
        {activeProject || surveyState
          ? `Exporting real survey data from ${activeProject?.sourceView ?? surveyState?.sourceView} (${activeProject?.surveyType ?? surveyState?.surveyType} type).`
          : "No survey output in context — exporting demo cadastral data (4 beacons, Kasarani). Run a workflow view first."}
      </div>

      {/* Statutory print plan (300 DPI PNG + parcel booklet PDF) */}
      <div style={{
        padding: "16px", borderRadius: "8px", border: "1px solid var(--border-default)",
        background: "var(--bg-secondary)", display: "flex", flexDirection: "column", gap: "12px",
      }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Printer size={16} strokeWidth={1.75} /> Statutory Print Plan
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            300 DPI plan sheet with the {getPlanSheet(countryCode).titleBlockLabel || "country"} title block — sized for {getPlanSheet(countryCode).defaultSheetSize.toUpperCase()} ({getPlanSheet(countryCode).defaultOrientation}).
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
            title="Full statutory report: A4 cover + the exact 300 DPI plan sheet embedded as the survey-map page — one click, no Map View step"
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              borderRadius: "6px", border: "1px solid var(--accent-primary)",
              background: "transparent", color: "var(--accent-primary)", fontSize: "13px", fontWeight: 600,
              cursor: reportExporting ? "wait" : "pointer",
            }}
          >
            <FileText size={14} />
            {reportExporting ? "Building report…" : "Statutory Report (PDF)"}
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
