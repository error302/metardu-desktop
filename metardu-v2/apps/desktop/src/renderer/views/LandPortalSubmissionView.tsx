import React from "react";
import { AlertTriangle, Building2 } from "lucide-react";
import { useSurveyState } from "../SurveyStateContext.js";

/**
 * Registry submission is unavailable until a jurisdiction-specific connector,
 * source-backed checklist, and regulator review are implemented.
 */
export const LandPortalSubmissionView: React.FC = () => {
  const { activeProject } = useSurveyState();

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Building2 size={20} color="var(--accent-primary)" aria-hidden="true" />
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
            Registry Interoperability
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
            {activeProject ? `Project: ${activeProject.name}` : "No active project"}
          </p>
        </div>
      </div>

      <section
        role="status"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "16px",
          border: "1px solid var(--border-warning, #D97706)",
          borderRadius: "8px",
          background: "var(--bg-tertiary)",
        }}
      >
        <AlertTriangle size={18} color="var(--status-warning, #D97706)" aria-hidden="true" />
        <div>
          <strong style={{ color: "var(--text-primary)" }}>Direct submission is unavailable</strong>
          <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
            This build has no connected land registry, regulator-approved submission package, or verified statutory checklist. It will not send a submission, generate a tracking number, or claim that a survey passed legal review.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
            Use the available data export for review, then submit through the regulator’s official process. Each jurisdiction needs its current source documents and a reviewed implementation before METARDU can claim support.
          </p>
        </div>
      </section>
    </div>
  );
};
