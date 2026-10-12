/**
 * Desktop license status. Account and offline-lease flows remain unavailable
 * until a real issuer and verifiable offline credential format are connected.
 */

import React from "react";
import { useLicense } from "@metardu/ui-components";
import { AlertCircle, Laptop, Lock, ShieldCheck } from "lucide-react";

export const LicensingView: React.FC = () => {
  const { license } = useLicense();

  const statusColor = license.isAuthenticated ? "#22C55E" : "#EAB308";
  const statusLabel = license.isAuthenticated ? license.status : "NOT VERIFIED";

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", height: "100%", overflow: "auto" }}>
      <div style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: "10px" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
          METARDU Account & Subscription
        </h2>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          A qualifying paid METARDU Web subscription will include Desktop access.
        </div>
      </div>

      <section style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "4px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ShieldCheck size={18} color={statusColor} />
          <h3 style={{ margin: 0, fontSize: "14px", fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>
            Subscription Verification
          </h3>
          <span style={{ marginLeft: "auto", fontSize: "10px", fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: "3px", fontWeight: "bold", color: statusColor, background: "rgba(234, 179, 8, 0.12)", border: `1px solid ${statusColor}` }}>
            {statusLabel}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
          <div style={{ padding: "12px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)", fontSize: "11px" }}><Laptop size={13} /> Device registration</div>
            <div style={{ marginTop: "6px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-primary)" }}>Not verified</div>
          </div>
          <div style={{ padding: "12px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)", fontSize: "11px" }}><Lock size={13} /> Signed entitlement</div>
            <div style={{ marginTop: "6px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-primary)" }}>Not present</div>
          </div>
        </div>
      </section>

      <div role="status" style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid #EAB308", borderRadius: "4px", fontSize: "12px", color: "var(--text-primary)", display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <AlertCircle size={16} color="#EAB308" style={{ flexShrink: 0, marginTop: "1px" }} />
        <div>
          <strong>Shared subscription verification is not connected in this build.</strong>
          <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
            Desktop will check the same METARDU account and subscription used on the Web app. No credentials are accepted or saved here, and no account or subscription has been verified yet.
          </div>
        </div>
      </div>

      <section style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: "4px", padding: "14px" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: "12px", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Feature availability</h3>
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          The shared access rule is set, but its server verification is not connected. This status panel does not enable or disable survey tools. Availability depends on functionality implemented in this build and on the project data and reference evidence required by each workflow.
        </p>
      </section>
    </div>
  );
};
