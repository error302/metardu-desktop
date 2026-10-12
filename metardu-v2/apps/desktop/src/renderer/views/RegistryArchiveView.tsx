/**
 * Cadastral Registry Archive & Deed Mutation Chain Hub.
 *
 * Implements:
 *   - Historical land mutation chain tracking (Parent Title -> Subdivisions -> Child Parcels)
 *   - Registry Index Map (RIM) sheet search and coordinate bounds lookup
 *   - Statutory submission packet generator (Survey Report Form P + Computation Sheets + Form No. 4)
 */

import React from "react";
import { AlertTriangle, Archive } from "lucide-react";

export const RegistryArchiveView: React.FC = () => (
  <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", height: "100%", overflow: "auto" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <Archive size={20} color="var(--accent-primary)" aria-hidden="true" />
      <div>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
          Registry Archive
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
          Historical title and mutation records
        </p>
      </div>
    </div>

    <section
      role="status"
      style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "16px", border: "1px solid var(--border-warning, #D97706)", borderRadius: "8px", background: "var(--bg-tertiary)" }}
    >
      <AlertTriangle size={18} color="var(--status-warning, #D97706)" aria-hidden="true" />
      <div>
        <strong style={{ color: "var(--text-primary)" }}>Registry archive lookup is unavailable</strong>
        <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
          This build has no connected authoritative registry or licensed historical records. It cannot verify title status, parcel history, surveyor identity, RIM sheets, or lodgements.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
          Check records through the relevant registry's official process and retain the source evidence with your project.
        </p>
      </div>
    </section>
  </div>
);
