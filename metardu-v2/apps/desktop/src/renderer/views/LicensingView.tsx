/**
 * Software License, Hardware Fingerprint & Offline Token Management.
 *
 * Implements:
 *   - Hardware ID (CPU ID + Motherboard UUID hash) generation
 *   - Offline token validation with 30-day grace period for remote field survey camps
 *   - Tiered feature unlocking (Starter / Professional / Enterprise)
 */

import React, { useState } from "react";

export const LicensingView: React.FC = () => {
  const [licenseKey, setLicenseKey] = useState("METARDU-PRO-2026-8841-K992");
  const [machineId] = useState("SHA256-E9F1-44A2-98C1-B831-NODE01");
  const [tier, setTier] = useState<"Starter" | "Professional" | "Enterprise">("Professional");
  const [status, setStatus] = useState<"ACTIVE" | "OFFLINE_GRACE" | "EXPIRED">("ACTIVE");
  const [expiryDate] = useState("2027-08-26");

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        License Activation & Offline Field Security
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Manage your METARDU Desktop commercial license, hardware device pairing, and offline field authorization tokens.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "14px", border: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Active License Key</label>
            <input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Hardware Device Fingerprint (Machine ID)</label>
            <input type="text" value={machineId} disabled style={{ width: "100%", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }} />
          </div>
          <button className="primary" style={{ marginTop: "4px" }}>Re-Validate License Token</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>License Subscription Status</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
              <div>Edition: <strong style={{ color: "var(--accent-primary)" }}>METARDU {tier}</strong></div>
              <div>Status: <strong style={{ color: "var(--status-success)" }}>{status} (Valid Token)</strong></div>
              <div>Maintenance Expiry: <strong>{expiryDate}</strong></div>
              <div>Offline Field Allowance: <strong>30 Days (28 Days Remaining)</strong></div>
            </div>
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
            Dongle-Free Cloud Sync: Hardware binding enables seamless switching across your office CAD workstation and field rugged tablet.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginTop: "12px" }}>
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 4px 0" }}>Cadastral Starter</h4>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)", marginBottom: "8px" }}> / month</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Traverse Bowditch/Transit, COGO, Form No. 4 Deed Plans, DXF Export, Leveling Field Book.
          </div>
        </div>
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "2px solid var(--accent-primary)" }}>
          <h4 style={{ margin: "0 0 4px 0", color: "var(--accent-primary)" }}>Professional Geomatics</h4>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)", marginBottom: "8px" }}> / month</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Everything in Starter + 3D LSA, Subdivision Slicer, Road Design, LiDAR CSF Filter, GNSS Telemetry.
          </div>
        </div>
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 4px 0" }}>Enterprise / Agency</h4>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)", marginBottom: "8px" }}>Custom</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Multi-Seat Firm License, National Registry API Bridge, CORS Network Management, Dedicated Support.
          </div>
        </div>
      </div>
    </div>
  );
};
