import React, { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Plus, Save, Trash2 } from "lucide-react";
import {
  assessDeliverableReadiness,
  type CoordinateReferenceField,
  type DeliverableReadinessAssessment,
  type ReferenceValue,
} from "@metardu/engine-flight-planning";
import {
  PROJECT_DELIVERABLE_REVIEW_SCHEMA,
  type ProjectDeliverableReview,
} from "@metardu/ipc-schemas";
import { useSurveyState } from "../SurveyStateContext.js";

const REFERENCE_FIELDS: Array<{ id: CoordinateReferenceField; label: string }> = [
  { id: "horizontal-crs", label: "Horizontal CRS or named local grid" },
  { id: "vertical-reference", label: "Vertical reference" },
  { id: "linear-unit", label: "Linear unit" },
  { id: "coordinate-epoch", label: "Coordinate epoch" },
];

type WorkflowStarter = {
  id: string;
  name: string;
  description: string;
  referenceFields: CoordinateReferenceField[];
  features: string[];
  checks: string[];
  outputs: string[];
};

/** Editable checklists only; these names do not imply that METARDU creates each output. */
const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: "topographic-corridor",
    name: "Topographic and corridor survey",
    description: "Roads, sites, earthworks and civil design surveys.",
    referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit"],
    features: ["Kerbs and pavement edges", "Road crown and crossfall", "Drainage channels and flow paths", "Horizontal and vertical curve transitions", "Embankments and slope breaks", "Visible utilities and surface structures", "Site features required by the design brief"],
    checks: ["Control and independent check observations reviewed against project criteria", "Breaklines and grade transitions reviewed", "Feature coverage and omissions reviewed against the project brief", "Surface, contours and sections visually reviewed"],
    outputs: ["2D topographic drawing", "3D topographic drawing or surface", "Longitudinal and cross-sections", "Survey and QA report"],
  },
  {
    id: "measured-building",
    name: "Measured building survey",
    description: "Existing buildings, floor plans, elevations and coordinated models.",
    referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit"],
    features: ["Building footprint and wall faces", "Floor levels, steps and thresholds", "Doors, windows and structural openings", "Stairs, cores and significant internal features", "Roof form and external elevations", "Building services or details required by the brief"],
    checks: ["Survey control and scan-registration evidence reviewed", "Floor and room coverage reviewed for omissions", "Levels, openings and key dimensions cross-checked", "Plans, elevations and sections coordinated"],
    outputs: ["Measured floor plans", "Building elevations and sections", "Registered point-cloud dataset", "CAD or BIM exchange agreed with the recipient"],
  },
  {
    id: "uav-mapping",
    name: "UAV mapping and terrain",
    description: "Aerial mapping, orthophotos, terrain models and point-cloud handoff.",
    referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit", "coordinate-epoch"],
    features: ["Project boundary and area of interest", "Ground control and independent checkpoints", "Terrain breaklines and grade changes", "Occlusions, vegetation and excluded areas", "Surface features requested by the client"],
    checks: ["Image coverage and reconstruction status reviewed", "Control and independent checkpoints assessed against project criteria", "Coverage gaps, occlusions and exclusions reviewed", "Terrain and surface representation reviewed for breaklines and artefacts"],
    outputs: ["Orthophotography", "Digital terrain model", "Digital surface model", "Point-cloud dataset or agreed exchange"],
  },
  {
    id: "river-bathymetry",
    name: "River and bathymetric survey",
    description: "River corridors, channels, cross-sections and water-related levels.",
    referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit"],
    features: ["Banks, water edges and channel structures", "Bed observations and cross-section extents", "Longitudinal channel alignment", "Water-level observations and time context", "Outfalls, weirs and other specified structures"],
    checks: ["Vertical reference and water-level reduction evidence reviewed", "Cross-section coverage and continuity reviewed", "Longitudinal profile checked against section observations", "Unsounded, obstructed and interpolated areas identified"],
    outputs: ["River cross-sections", "Longitudinal section", "Bathymetric point set or surface", "Survey and QA report"],
  },
  {
    id: "underground-utilities",
    name: "Underground utilities survey",
    description: "Utility records, detection, surface evidence and coordinated plans.",
    referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit"],
    features: ["Utility routes by service or evidence source", "Chambers, covers, valves and visible appurtenances", "Crossings, connections and observed depths", "Uncertain, inaccessible and conflicting observations", "Surface features needed for coordination"],
    checks: ["Utility evidence sources and survey method recorded", "Coverage reviewed against the agreed search area", "Uncertain locations and inaccessible areas clearly identified", "Utility plans, profiles and schedules cross-checked"],
    outputs: ["Underground utility plan", "Utility profiles or sections", "Utility feature schedule or data exchange", "Survey and QA report"],
  },
];

function newItemId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function newProjectReview(projectId: string, projectName: string): ProjectDeliverableReview {
  return {
    profile: {
      id: `delivery-${projectId}`,
      name: `${projectName} delivery profile`.slice(0, 300),
      referenceFields: ["horizontal-crs"],
      features: [],
      checks: [],
      outputs: [],
    },
    referenceContext: { "horizontal-crs": { value: "", status: "missing" } },
    featureReviews: [],
    qualityChecks: [],
    artifacts: [],
  };
}

function assessmentFor(review: ProjectDeliverableReview): { assessment?: DeliverableReadinessAssessment; error?: string } {
  try {
    return { assessment: assessDeliverableReadiness(review) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "The profile could not be assessed." };
  }
}

const controlStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "7px 9px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  borderRadius: "4px",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  minWidth: 0,
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
};

const panelStyle: React.CSSProperties = {
  border: "1px solid var(--border-default)",
  borderRadius: "5px",
  padding: "12px",
  marginTop: "12px",
  background: "var(--bg-secondary)",
};

export const DeliveryReadinessView: React.FC = () => {
  const { projects, activeProject, setActiveProject, updateProject } = useSurveyState();
  const [draft, setDraft] = useState<ProjectDeliverableReview | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [starterId, setStarterId] = useState(WORKFLOW_STARTERS[0].id);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setDraft(null);
      setBaseline("");
      return;
    }
    const review = activeProject.deliveryReview ?? newProjectReview(activeProject.id, activeProject.name);
    setDraft(review);
    setBaseline(activeProject.deliveryReviewStatus === "invalid" ? "invalid" : JSON.stringify(review));
    setSaveMessage(null);
    setSaveError(null);
  }, [activeProject?.id, activeProject?.name, activeProject?.deliveryReview, activeProject?.deliveryReviewStatus]);

  const isDirty = !!draft && JSON.stringify(draft) !== baseline;
  const schemaResult = useMemo(
    () => draft ? PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(draft) : null,
    [draft],
  );
  const evaluation = useMemo(() => draft ? assessmentFor(draft) : null, [draft]);

  const edit = (update: (current: ProjectDeliverableReview) => ProjectDeliverableReview) => {
    setDraft((current) => current ? update(current) : current);
    setSaveMessage(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!draft || !activeProject || !schemaResult) return;
    if (!schemaResult.success) {
      setSaveError(schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      return;
    }
    if (activeProject.deliveryReviewStatus === "invalid"
      && !window.confirm("The saved review record is invalid. Replace it with this edited profile? The invalid record cannot be recovered from METARDU.")) {
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await updateProject(activeProject.id, { deliveryReview: schemaResult.data });
      setDraft(schemaResult.data);
      setBaseline(JSON.stringify(schemaResult.data));
      setSaveMessage("Project delivery profile and review saved.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save this project review.");
    } finally {
      setSaving(false);
    }
  };

  const applyStarter = () => {
    if (!draft || !activeProject) return;
    const starter = WORKFLOW_STARTERS.find((item) => item.id === starterId);
    if (!starter) return;
    if ((isDirty || !!activeProject.deliveryReview) && !window.confirm(
      "Replace the current editor draft with this workflow starter? The change is not saved until you press Save project review.",
    )) return;

    const features = starter.features.map((label) => ({ id: newItemId("feature"), label, required: true, allowNotApplicable: false }));
    const checks = starter.checks.map((label) => ({ id: newItemId("qa"), label, required: true }));
    const outputs = starter.outputs.map((label) => ({ id: newItemId("output"), label, format: "Client-defined; confirm with recipient", required: true }));
    const referenceContext = { ...draft.referenceContext };
    for (const field of starter.referenceFields) {
      referenceContext[field] ??= { value: "", status: "missing" };
    }
    edit((current) => ({
      ...current,
      profile: {
        ...current.profile,
        name: `${activeProject.name} — ${starter.name}`.slice(0, 300),
        referenceFields: starter.referenceFields,
        features,
        checks,
        outputs,
      },
      referenceContext,
      featureReviews: features.map(({ id }) => ({ requirementId: id, status: "not-started" })),
      qualityChecks: checks.map(({ id }) => ({ requirementId: id, status: "not-run" })),
      artifacts: outputs.map(({ id }) => ({ outputId: id, fileName: "", status: "draft" })),
    }));
  };

  const addFeature = () => edit((current) => {
    const id = newItemId("feature");
    return {
      ...current,
      profile: { ...current.profile, features: [...current.profile.features, { id, label: "", required: true, allowNotApplicable: false }] },
      featureReviews: [...current.featureReviews, { requirementId: id, status: "not-started" }],
    };
  });

  const removeFeature = (id: string) => edit((current) => ({
    ...current,
    profile: { ...current.profile, features: current.profile.features.filter((item) => item.id !== id) },
    featureReviews: current.featureReviews.filter((item) => item.requirementId !== id),
  }));

  const addCheck = () => edit((current) => {
    const id = newItemId("qa");
    return {
      ...current,
      profile: { ...current.profile, checks: [...current.profile.checks, { id, label: "", required: true }] },
      qualityChecks: [...current.qualityChecks, { requirementId: id, status: "not-run" }],
    };
  });

  const removeCheck = (id: string) => edit((current) => ({
    ...current,
    profile: { ...current.profile, checks: current.profile.checks.filter((item) => item.id !== id) },
    qualityChecks: current.qualityChecks.filter((item) => item.requirementId !== id),
  }));

  const addOutput = () => edit((current) => {
    const id = newItemId("output");
    return {
      ...current,
      profile: { ...current.profile, outputs: [...current.profile.outputs, { id, label: "", format: "", required: true }] },
      artifacts: [...current.artifacts, { outputId: id, fileName: "", status: "draft" }],
    };
  });

  const removeOutput = (id: string) => edit((current) => ({
    ...current,
    profile: { ...current.profile, outputs: current.profile.outputs.filter((item) => item.id !== id) },
    artifacts: current.artifacts.filter((item) => item.outputId !== id),
  }));

  if (!activeProject) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h2>Delivery QA</h2>
        <p>Select or create a project before defining its client deliverables and QA records.</p>
      </div>
    );
  }
  if (!draft) return <div role="status">Loading project delivery review…</div>;

  const assessment = evaluation?.assessment;
  const statusText = assessment?.state === "blocked"
    ? "BLOCKED"
    : assessment?.state === "review-required"
      ? "SURVEYOR REVIEW REQUIRED"
      : assessment?.state === "ready-for-surveyor-review"
        ? "READY FOR SURVEYOR REVIEW"
        : "PROFILE NEEDS ATTENTION";
  const statusColor = assessment?.state === "ready-for-surveyor-review"
    ? "var(--status-success)"
    : assessment?.state === "review-required"
      ? "var(--status-warning)"
      : "var(--status-error)";

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", paddingBottom: 28 }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardCheck size={22} color="var(--accent-primary)" />
            <h2 style={{ margin: 0 }}>Delivery QA</h2>
          </div>
          <p style={{ color: "var(--text-secondary)", margin: "6px 0 0" }}>Build a client-defined checklist for this project and review what is still missing before handoff.</p>
        </div>
        <label style={{ ...labelStyle, minWidth: 260 }}>
          Active project
          <select value={activeProject.id} onChange={(event) => void setActiveProject(event.target.value)} style={controlStyle}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      </header>

      {activeProject.deliveryReviewStatus === "invalid" && (
        <div role="alert" style={{ ...panelStyle, borderColor: "var(--status-error)", color: "var(--status-error)" }}>
          The saved delivery review record failed validation. Your edits replace it only after you press Save and confirm.
        </div>
      )}

      <section className="enterprise-panel" aria-labelledby="delivery-profile-heading">
        <div className="enterprise-panel-header"><span className="enterprise-panel-title" id="delivery-profile-heading">Client and practice profile</span></div>
        <div className="enterprise-panel-body">
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) auto", gap: 10, alignItems: "end", marginBottom: 14 }}>
            <label style={labelStyle}>
              Start with a workflow profile
              <select value={starterId} onChange={(event) => setStarterId(event.target.value)} style={controlStyle}>
                {WORKFLOW_STARTERS.map((starter) => <option key={starter.id} value={starter.id}>{starter.name}</option>)}
              </select>
              <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>{WORKFLOW_STARTERS.find((starter) => starter.id === starterId)?.description}</span>
            </label>
            <button type="button" className="secondary" onClick={applyStarter}>Load editable starter</button>
          </div>
          <label style={{ ...labelStyle, maxWidth: 560 }}>
            Profile name
            <input value={draft.profile.name} maxLength={300} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, name: event.target.value } }))} style={controlStyle} />
          </label>
          <div style={{ ...panelStyle, marginTop: 14, color: "var(--text-secondary)" }}>
            Starters provide editable coverage prompts only. Confirm requirements, tolerances, formats and acceptance criteria with the client and applicable professional rules; METARDU does not generate every listed output or supply countrywide standards.
          </div>
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="delivery-reference-heading">
        <div className="enterprise-panel-header"><span className="enterprise-panel-title" id="delivery-reference-heading">Coordinate references</span></div>
        <div className="enterprise-panel-body">
          <p style={{ marginTop: 0, color: "var(--text-secondary)" }}>A horizontal CRS or named local grid is required. Record what the project uses; a declaration is not treated as a verified transformation.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 10 }}>
            {REFERENCE_FIELDS.map(({ id, label }) => {
              const checked = draft.profile.referenceFields.includes(id);
              const reference = draft.referenceContext[id];
              const required = id === "horizontal-crs";
              return (
                <article key={id} style={panelStyle}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <input type="checkbox" checked={checked} disabled={required} onChange={(event) => edit((current) => {
                      const fields = event.target.checked
                        ? [...current.profile.referenceFields, id]
                        : current.profile.referenceFields.filter((field) => field !== id);
                      return {
                        ...current,
                        profile: { ...current.profile, referenceFields: fields },
                        referenceContext: event.target.checked && !current.referenceContext[id]
                          ? { ...current.referenceContext, [id]: { value: "", status: "missing" } }
                          : current.referenceContext,
                      };
                    })} />
                    <span>{label}{required ? " · required" : ""}</span>
                  </label>
                  {checked && (
                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={labelStyle}>
                        Value or name
                        <input value={reference?.value ?? ""} maxLength={500} onChange={(event) => edit((current) => ({ ...current, referenceContext: { ...current.referenceContext, [id]: { ...(current.referenceContext[id] ?? { value: "", status: "missing" }), value: event.target.value } } }))} style={controlStyle} />
                      </label>
                      <label style={labelStyle}>
                        Recorded status
                        <select value={reference?.status ?? "missing"} onChange={(event) => edit((current) => ({ ...current, referenceContext: { ...current.referenceContext, [id]: { ...(current.referenceContext[id] ?? { value: "", status: "missing" }), status: event.target.value as ReferenceValue["status"] } } }))} style={controlStyle}>
                          <option value="missing">Missing</option><option value="declared">Declared by project team</option><option value="verified">Reviewed by surveyor</option>
                        </select>
                      </label>
                      <label style={labelStyle}>
                        Evidence or source note
                        <input value={reference?.evidenceSummary ?? ""} maxLength={2000} onChange={(event) => edit((current) => ({ ...current, referenceContext: { ...current.referenceContext, [id]: { ...(current.referenceContext[id] ?? { value: "", status: "missing" }), evidenceSummary: event.target.value } } }))} style={controlStyle} />
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>METARDU records the review state and note; it does not verify CRS definitions, epochs, datums, or transformation grids in this screen.</p>
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="delivery-features-heading">
        <div className="enterprise-panel-header">
          <span className="enterprise-panel-title" id="delivery-features-heading">Feature classes to capture and review</span>
          <button type="button" className="secondary" onClick={addFeature} disabled={draft.profile.features.length >= 250}><Plus size={14} /> Add feature class</button>
        </div>
        <div className="enterprise-panel-body">
          {draft.profile.features.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No feature classes configured. Add the client’s required features, such as kerbs, drainage, crowns, utilities, or building details. No density threshold is inferred.</p>}
          {draft.profile.features.map((feature) => {
            const review = draft.featureReviews.find((item) => item.requirementId === feature.id);
            return (
              <article key={feature.id} style={panelStyle}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 2fr) minmax(180px, 1fr) auto", gap: 9, alignItems: "end" }}>
                  <label style={labelStyle}>Feature class<input value={feature.label} maxLength={300} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, features: current.profile.features.map((item) => item.id === feature.id ? { ...item, label: event.target.value } : item) } }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Review status<select value={review?.status ?? "not-started"} onChange={(event) => edit((current) => ({ ...current, featureReviews: current.featureReviews.map((item) => item.requirementId === feature.id ? { ...item, status: event.target.value as NonNullable<typeof review>["status"] } : item) }))} style={controlStyle}><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="reviewed">Reviewed</option><option value="not-applicable">Not applicable</option></select></label>
                  <button type="button" className="secondary" aria-label={`Remove feature ${feature.label || "class"}`} onClick={() => removeFeature(feature.id)}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap" }}>
                  <label><input type="checkbox" checked={feature.required} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, features: current.profile.features.map((item) => item.id === feature.id ? { ...item, required: event.target.checked } : item) } }))} /> Required by this profile</label>
                  <label><input type="checkbox" checked={!!feature.allowNotApplicable} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, features: current.profile.features.map((item) => item.id === feature.id ? { ...item, allowNotApplicable: event.target.checked } : item) } }))} /> Allow a reasoned not-applicable exception</label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 9, marginTop: 9 }}>
                  <label style={labelStyle}>Evidence reference<input value={review?.evidenceReferences?.[0] ?? ""} maxLength={500} onChange={(event) => edit((current) => ({ ...current, featureReviews: current.featureReviews.map((item) => item.requirementId === feature.id ? { ...item, evidenceReferences: event.target.value.trim() ? [event.target.value] : [] } : item) }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Reason or review note<input value={review?.reason ?? ""} maxLength={2000} onChange={(event) => edit((current) => ({ ...current, featureReviews: current.featureReviews.map((item) => item.requirementId === feature.id ? { ...item, reason: event.target.value } : item) }))} style={controlStyle} /></label>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="delivery-checks-heading">
        <div className="enterprise-panel-header">
          <span className="enterprise-panel-title" id="delivery-checks-heading">Quality checks</span>
          <button type="button" className="secondary" onClick={addCheck} disabled={draft.profile.checks.length >= 250}><Plus size={14} /> Add QA check</button>
        </div>
        <div className="enterprise-panel-body">
          {draft.profile.checks.length === 0 && <p style={{ color: "var(--text-secondary)" }}>At least one required QA check must be configured. Define the checks for this job; METARDU does not invent a tolerance.</p>}
          {draft.profile.checks.map((check) => {
            const record = draft.qualityChecks.find((item) => item.requirementId === check.id);
            return (
              <article key={check.id} style={panelStyle}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 2fr) minmax(160px, 1fr) auto", gap: 9, alignItems: "end" }}>
                  <label style={labelStyle}>QA check<input value={check.label} maxLength={300} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, checks: current.profile.checks.map((item) => item.id === check.id ? { ...item, label: event.target.value } : item) } }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Status<select value={record?.status ?? "not-run"} onChange={(event) => edit((current) => ({ ...current, qualityChecks: current.qualityChecks.map((item) => item.requirementId === check.id ? { ...item, status: event.target.value as NonNullable<typeof record>["status"] } : item) }))} style={controlStyle}><option value="not-run">Not run</option><option value="pass">Pass</option><option value="warning">Warning</option><option value="fail">Fail</option></select></label>
                  <button type="button" className="secondary" aria-label={`Remove QA check ${check.label || "check"}`} onClick={() => removeCheck(check.id)}><Trash2 size={14} /></button>
                </div>
                <label style={{ ...labelStyle, marginTop: 9 }}>Evidence summary or review note<input value={record?.evidenceSummary ?? ""} maxLength={2000} onChange={(event) => edit((current) => ({ ...current, qualityChecks: current.qualityChecks.map((item) => item.requirementId === check.id ? { ...item, evidenceSummary: event.target.value } : item) }))} style={controlStyle} /></label>
                <label style={{ display: "inline-flex", gap: 6, marginTop: 8 }}><input type="checkbox" checked={check.required} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, checks: current.profile.checks.map((item) => item.id === check.id ? { ...item, required: event.target.checked } : item) } }))} /> Required by this profile</label>
              </article>
            );
          })}
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="delivery-outputs-heading">
        <div className="enterprise-panel-header">
          <span className="enterprise-panel-title" id="delivery-outputs-heading">Expected outputs and package files</span>
          <button type="button" className="secondary" onClick={addOutput} disabled={draft.profile.outputs.length >= 250}><Plus size={14} /> Add output</button>
        </div>
        <div className="enterprise-panel-body">
          {draft.profile.outputs.length === 0 && <p style={{ color: "var(--text-secondary)" }}>Add at least one required output in the exact format requested by the client.</p>}
          {draft.profile.outputs.map((output) => {
            const artifact = draft.artifacts.find((item) => item.outputId === output.id);
            return (
              <article key={output.id} style={panelStyle}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.4fr) minmax(140px, 0.8fr) minmax(140px, 0.8fr) auto", gap: 9, alignItems: "end" }}>
                  <label style={labelStyle}>Expected deliverable<input value={output.label} maxLength={300} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, outputs: current.profile.outputs.map((item) => item.id === output.id ? { ...item, label: event.target.value } : item) } }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Format<input value={output.format} maxLength={300} placeholder="DXF, GeoPackage, PDF…" onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, outputs: current.profile.outputs.map((item) => item.id === output.id ? { ...item, format: event.target.value } : item) } }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Package status<select value={artifact?.status ?? "draft"} onChange={(event) => edit((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.outputId === output.id ? { ...item, status: event.target.value as NonNullable<typeof artifact>["status"] } : item) }))} style={controlStyle}><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="included">Included</option></select></label>
                  <button type="button" className="secondary" aria-label={`Remove output ${output.label || "requirement"}`} onClick={() => removeOutput(output.id)}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap" }}>
                  <label><input type="checkbox" checked={output.required} onChange={(event) => edit((current) => ({ ...current, profile: { ...current.profile, outputs: current.profile.outputs.map((item) => item.id === output.id ? { ...item, required: event.target.checked } : item) } }))} /> Required by this profile</label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 9, marginTop: 9 }}>
                  <label style={labelStyle}>Included file name<input value={artifact?.fileName ?? ""} maxLength={512} placeholder="site-topographic.dxf" onChange={(event) => edit((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.outputId === output.id ? { ...item, fileName: event.target.value } : item) }))} style={controlStyle} /></label>
                  <label style={labelStyle}>Declared SHA-256<input value={artifact?.sha256 ?? ""} maxLength={64} placeholder="64 hexadecimal characters" onChange={(event) => edit((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.outputId === output.id ? { ...item, sha256: event.target.value || undefined } : item) }))} style={controlStyle} /></label>
                </div>
              </article>
            );
          })}
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>File names only are stored. SHA-256 values are recorded and syntax-checked here; this screen does not open files or recompute their hashes.</p>
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="delivery-result-heading">
        <div className="enterprise-panel-header"><span className="enterprise-panel-title" id="delivery-result-heading">Readiness assessment</span></div>
        <div className="enterprise-panel-body">
          <div role="status" aria-live="polite" style={{ borderLeft: `4px solid ${statusColor}`, padding: "10px 12px", background: "var(--bg-tertiary)", marginBottom: 12 }}>
            <strong style={{ color: statusColor }}>{statusText}</strong>
            {assessment && <span style={{ marginLeft: 10, color: "var(--text-secondary)" }}>{assessment.blockerCount} blockers · {assessment.reviewCount} review items</span>}
          </div>
          {evaluation?.error && <p role="alert" style={{ color: "var(--status-error)" }}>{evaluation.error}</p>}
          {assessment?.issues.length ? (
            <ul style={{ display: "grid", gap: 7, paddingLeft: 20 }}>
              {assessment.issues.map((issue, index) => <li key={`${issue.code}-${issue.itemId}-${index}`}><strong style={{ color: issue.severity === "blocker" ? "var(--status-error)" : "var(--status-warning)" }}>{issue.severity === "blocker" ? "BLOCKER" : "REVIEW"}</strong> · {issue.message}</li>)}
            </ul>
          ) : assessment && <p>No configured items are blocking surveyor review.</p>}
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>This is a completeness checklist, not a geometry inspection, accuracy certificate, statutory-compliance decision, or professional approval.</p>
          {schemaResult && !schemaResult.success && (
            <details style={{ marginTop: 10 }}>
              <summary>Profile fields to fix before saving</summary>
              <ul>{schemaResult.error.issues.map((issue, index) => <li key={`${issue.path.join(".")}-${index}`}>{issue.path.join(".")}: {issue.message}</li>)}</ul>
            </details>
          )}
          {saveError && <p role="alert" style={{ color: "var(--status-error)" }}>{saveError}</p>}
          {saveMessage && <p role="status" style={{ color: "var(--status-success)" }}>{saveMessage}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="primary" onClick={() => void save()} disabled={!isDirty || !schemaResult?.success || saving}>
              <Save size={15} /> {saving ? "Saving…" : "Save project review"}
            </button>
            {isDirty && <span role="status" style={{ color: "var(--status-warning)" }}>Unsaved changes</span>}
          </div>
        </div>
      </section>
    </main>
  );
};
