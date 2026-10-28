/** Project-referenced topographic surface draft workflow. */

import React, { useState } from "react";
import { MAX_TOPOGRAPHIC_TIN_POINTS, runTopographicWorkflow, type TopoPoint, type TopoWorkflowOutput } from "@metardu/engine-flight-planning";
import { SurveyCanvas, type SurveyPoint, type SurveyContour, type SurveyTriangle } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { bus } from "../cross-import-bus.js";
import { COUNTRY_OPTIONS, isProjectCrsKnown, projectCrsLabel } from "../countries.js";
import { parseTopographicCsv } from "../topographic-csv.js";

export const TopographicView: React.FC = () => {
  const { activeProject, setSurveyDraftOutput } = useSurveyState();
  const [csvInput, setCsvInput] = useState("");
  const [contourInterval, setContourInterval] = useState("");
  const [spotHeightEvery, setSpotHeightEvery] = useState("10");
  const [verticalReference, setVerticalReference] = useState("");
  const [metricCoordinatesConfirmed, setMetricCoordinatesConfirmed] = useState(false);
  const [result, setResult] = useState<TopoWorkflowOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const crsSrid = activeProject?.crsSrid;
  const crsLabel = projectCrsLabel(crsSrid, activeProject?.countryCode);
  const crsKnown = isProjectCrsKnown(crsSrid, activeProject?.countryCode);
  const countryOption = COUNTRY_OPTIONS.find((option) => option.code === activeProject?.countryCode);
  const countryProfileMatchesCrs = Boolean(
    countryOption && crsSrid !== undefined && (
      countryOption.config.geodeticFramework.primarySRID === crsSrid ||
      countryOption.config.geodeticFramework.projectionZones.some((zone) => zone.srid === crsSrid)
    ),
  );

  const run = async () => {
    setError(null);
    setResult(null);

    if (!activeProject) {
      setError("Create or select a project before computing a surface.");
      return;
    }
    if (crsSrid === undefined || !crsKnown) {
      setError("Assign a project CRS from the bundled catalog before computing. The workflow cannot validate an unknown coordinate system.");
      return;
    }
    if (!metricCoordinatesConfirmed) {
      setError("Confirm that input coordinates and elevations are in metres before computing.");
      return;
    }
    if (!verticalReference.trim()) {
      setError("Enter the vertical reference shared by these elevations. It will be retained as user-declared and unverified.");
      return;
    }

    const interval = Number(contourInterval);
    if (!contourInterval.trim() || !Number.isFinite(interval) || interval <= 0) {
      setError("Enter a positive contour interval in metres.");
      return;
    }
    const spotEvery = Number(spotHeightEvery);
    if (!Number.isInteger(spotEvery) || spotEvery <= 0) {
      setError("Spot-height spacing must be a positive whole number of points.");
      return;
    }

    try {
      const points: TopoPoint[] = parseTopographicCsv(csvInput);
      const output = runTopographicWorkflow({
        points,
        contourInterval: interval,
        spotHeightEvery: spotEvery,
        ...(countryProfileMatchesCrs && countryOption ? { country: countryOption.config } : {}),
        coordinateContext: {
          horizontalCrsEpsg: crsSrid,
          horizontalCrsLabel: crsLabel,
          horizontalUnits: "m",
          verticalReference: verticalReference.trim(),
          referenceStatus: "user-declared-unverified",
        },
      });

      setSaving(true);
      const countryCode = activeProject.countryCode ?? "";
      await setSurveyDraftOutput(output, "topographic", "TopographicView", countryCode);
      setResult(output);
      bus.emit("topo:surface", {
        points: output.tin.vertices.map((point) => ({
          easting: point.easting,
          northing: point.northing,
          elevation: point.elevation,
        })),
        coordinateContext: output.coordinateContext,
        evidenceStatus: output.evidenceStatus,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Topographic Surface</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Build a local surface draft from field points. No project, country, coordinate, elevation, or surveyor data is prefilled.
      </p>

      <div style={{ padding: "10px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", fontSize: "var(--text-sm)" }}>
        <strong>Active project:</strong> {activeProject?.name ?? "None selected"}<br />
        <strong>Jurisdiction:</strong> {countryOption?.name ?? (activeProject?.countryCode ? `Unconfigured (${activeProject.countryCode})` : "Neutral project")}<br />
        <strong>Horizontal CRS:</strong> {activeProject ? crsLabel : "Not assigned"}
        {countryOption && !countryProfileMatchesCrs && (
          <div style={{ color: "var(--status-warning)", marginTop: "6px" }}>
            The project CRS is not linked to this jurisdiction profile. Its tolerance rule will not be applied.
          </div>
        )}
        <div style={{ color: "var(--text-tertiary)", marginTop: "6px" }}>
          Coordinates must already be in the project CRS and metres. This workflow does not transform coordinates or verify the entered vertical reference.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "4px" }}>Field points (headerless CSV: id,easting,northing,elevation[,code])</label>
          <textarea
            value={csvInput}
            onChange={(event) => setCsvInput(event.target.value)}
            placeholder={"PT001,500000,4500000,102.35,ROAD\nPT002,500010,4500000,102.60,ROAD\nPT003,500000,4500010,102.80,DITCH"}
            style={{ width: "100%", height: "150px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
          />
          <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "8px", fontSize: "var(--text-sm)" }}>
            <input
              type="checkbox"
              checked={metricCoordinatesConfirmed}
              onChange={(event) => setMetricCoordinatesConfirmed(event.target.checked)}
            />
            <span>I confirm these coordinates and elevations are in metres and already use the active project reference.</span>
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px" }}>Contour interval (m)</label>
            <input type="number" value={contourInterval} step="any" min="0" placeholder="Enter interval" onChange={(event) => setContourInterval(event.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px" }}>Vertical reference for elevations</label>
            <input value={verticalReference} onChange={(event) => setVerticalReference(event.target.value)} placeholder="e.g. named local datum or ellipsoidal" style={{ width: "100%" }} />
            <small style={{ color: "var(--text-tertiary)" }}>Saved as your declaration; not independently validated or transformed.</small>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px" }}>Spot height every Nth point</label>
            <input type="number" value={spotHeightEvery} step="1" min="1" onChange={(event) => setSpotHeightEvery(event.target.value)} style={{ width: "100%" }} />
          </div>
          <button className="primary" onClick={() => void run()} disabled={saving} style={{ marginTop: "8px" }}>
            {saving ? "Saving draft…" : "Generate surface draft"}
          </button>
        </div>
      </div>

      <div style={{ padding: "8px 12px", border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
        The current brute-force TIN is limited to {MAX_TOPOGRAPHIC_TIN_POINTS} points and does not certify near-collinear or co-circular geometry. Larger surfaces are blocked. Validate this draft independently before using it for design, setting-out, or legal delivery; no statutory plan is auto-generated.
      </div>

      {error && (
        <div role="alert" style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <div style={{ padding: "8px 12px", marginBottom: "10px", border: "1px solid var(--status-warning)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
            Computed draft · {result.coordinateContext?.horizontalCrsLabel} · vertical reference user-declared/unverified · no least-squares adjustment or residual check.
          </div>
          <SurveyCanvas
            height={350}
            title="Topographic Surface Draft"
            showPointLabels={true}
            triangles={result.tin.triangles.map((tri): SurveyTriangle => ({
              a: { easting: result.tin.vertices[tri[0]]!.easting, northing: result.tin.vertices[tri[0]]!.northing },
              b: { easting: result.tin.vertices[tri[1]]!.easting, northing: result.tin.vertices[tri[1]]!.northing },
              c: { easting: result.tin.vertices[tri[2]]!.easting, northing: result.tin.vertices[tri[2]]!.northing },
            }))}
            contours={result.contours.map((contour): SurveyContour => ({ elevation: contour.elevation, coordinates: contour.coordinates }))}
            spotHeights={result.spotHeights.map((height): SurveyPoint => ({ easting: height.easting, northing: height.northing, elevation: height.elevation }))}
          />
          <h3 style={{ fontSize: "var(--text-lg)", marginBottom: "8px", fontFamily: "var(--font-mono)", marginTop: "12px" }}>Surface summary</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "12px" }}>
            <StatCard label="Points" value={String(result.tin.vertices.length)} />
            <StatCard label="Triangles" value={String(result.triangleCount)} />
            <StatCard label="Contour segments" value={String(result.contours.length)} />
            <StatCard label="Minimum elevation" value={`${result.minElevation.toFixed(2)} m`} />
            <StatCard label="Maximum elevation" value={`${result.maxElevation.toFixed(2)} m`} />
            <StatCard label="Mean slope" value={`${result.meanSlope.toFixed(1)}°`} />
            <StatCard label="Spot heights" value={String(result.spotHeights.length)} />
            <StatCard label="Jurisdictional tolerance" value={result.topographicToleranceM === null ? "Not established" : `${(result.topographicToleranceM * 1000).toFixed(0)} mm`} />
            <StatCard label="Residual check" value={result.maxResidualM === null ? "Not computed" : `${result.maxResidualM.toFixed(3)} m`} />
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{value}</div>
  </div>
);
