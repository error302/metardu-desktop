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
import { Download, FileText, FileSpreadsheet, FileCode, Map, Globe, FileBox } from "lucide-react";

interface ExporterInfo {
  format: string;
  description: string;
  fileExtension: string;
}

const COUNTRIES = [
  { code: "KE", name: "Kenya" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia (NSW)" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "UAE (Dubai)" },
];

const FORMAT_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  "geojson": Globe,
  "geopackage": FileBox,
  "pyqgis-script": FileCode,
  "gcp": Map,
  "qgs-project": FileText,
  "osm-changeset": Globe,
  "dxf": FileSpreadsheet,
};

export const ExportPanel: React.FC = () => {
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
      ]);
    });
  }, []);

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

      // Generate a demo cadastral survey output.
      // In production, this would come from the active survey view's state.
      const demoSurveyOutput = {
        form3: {
          pdfBytes: new Uint8Array(0),
          pageCount: 0,
          scale: 0,
          coordinateSystemLabel: "Demo",
          hasDraftWatermark: false,
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

      const options: Record<string, unknown> = {
        countryCode,
        outputWgs84,
        projectMetadata: {
          projectName,
          surveyorName,
          licenseNumber,
          surveyDate,
          adjustmentRunId: `demo-${Date.now()}`,
        },
      };

      // For GCP exporter, pass GcpInput instead of SurveyOutput.
      if (selectedFormat === "gcp") {
        const gcpInput = {
          points: demoSurveyOutput.allBeacons.map((b, i) => ({
            label: `GCP${i + 1}`,
            easting: b.position.easting,
            northing: b.position.northing,
            elevation: 1795.0,
            accuracyXY: 0.015,
          })),
        };
        const gcpOptions = { ...options, format: "pix4d" };
        const res = await w.metardu.export.survey(selectedFormat, gcpInput, gcpOptions);
        setResult(res);
      } else if (selectedFormat === "osm-changeset") {
        // OSM needs WGS84 or projectedCoords + callback.
        const osmInput = {
          nodes: demoSurveyOutput.allBeacons.map((b, i) => ({
            id: -(i + 1),
            lat: -1.22 + i * 0.0005,
            lon: 36.90 + i * 0.0005,
            tags: { man_made: "survey_point", name: b.label },
          })),
          ways: [{
            id: -101,
            nodeRefs: [-1, -2, -3, -4, -1],
            tags: { boundary: "administrative", admin_level: "8", area: "yes", name: "S/12345" },
          }],
          inputSrid: 4326,
        };
        const res = await w.metardu.export.survey(selectedFormat, osmInput, options);
        setResult(res);
      } else {
        const res = await w.metardu.export.survey(selectedFormat, demoSurveyOutput, options);
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

      {/* Demo data notice */}
      <div style={{ fontSize: "11px", color: "var(--text-disabled)", fontStyle: "italic" }}>
        Note: This panel exports a demo cadastral survey (4 beacons, Kasarani, Nairobi).
        Wiring to actual survey views is a follow-up task.
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
