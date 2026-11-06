import React from "react";
import { AlertTriangle, Shield } from "lucide-react";

/**
 * Signing remains unavailable until METARDU has a reviewed key-custody,
 * certificate-validation, and jurisdiction acceptance workflow.
 */
export const SigningPanel: React.FC = () => (
  <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
        Digital Signing
      </h2>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
        Signatures must establish document integrity and a trusted signer identity under the rules that apply to the project.
      </p>
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
        <strong style={{ color: "var(--text-primary)" }}>Signing is unavailable in this build</strong>
        <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
          METARDU does not yet verify professional identity, protect signing keys, or confirm a signature is accepted by a regulator. No document will be signed or reported as verified here.
        </p>
      </div>
    </section>

    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-tertiary)" }}>
      <Shield size={14} aria-hidden="true" />
      Use your organization’s approved signing service until a reviewed signing workflow is available.
    </div>
  </div>
);
