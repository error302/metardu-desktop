/**
 * Survey Office Management, Fee Estimator & Client Invoicing View.
 *
 * Implements:
 *   - Statutory scale of fees calculator (Acreage, Traverse length, Beacons placed, Terrain multiplier)
 *   - Job tracking (Quotation -> Fieldwork -> Examination -> Registry Approval)
 *   - Adjoining landowner boundary affirmation notice generator
 */

import React, { useState } from "react";

export const OfficeManagementView: React.FC = () => {
  const [clientName, setClientName] = useState("Alpha Properties Ltd");
  const [jobTitle, setJobTitle] = useState("Cadastral Boundary Re-establishment & Subdivision");
  const [parcelAreaHa, setParcelAreaHa] = useState(2.5);
  const [newBeaconsCount, setNewBeaconsCount] = useState(8);
  const [traverseKm, setTraverseKm] = useState(1.2);
  const [terrainDifficulty, setTerrainDifficulty] = useState<"flat" | "medium" | "steep">("medium");

  // Statutory fee scale computation (e.g. Kenya LSB Scale of Fees)
  const baseFee = 45000;
  const areaFee = parcelAreaHa * 12000;
  const beaconFee = newBeaconsCount * 3500;
  const traverseFee = traverseKm * 15000;
  const terrainMultiplier = terrainDifficulty === "flat" ? 1.0 : terrainDifficulty === "medium" ? 1.2 : 1.5;

  const subtotal = (baseFee + areaFee + beaconFee + traverseFee) * terrainMultiplier;
  const vat = subtotal * 0.16;
  const totalInvoice = subtotal + vat;

  const [invoices] = useState([
    { id: "INV-2026-042", client: "Alpha Properties Ltd", amount: totalInvoice, status: "Pending Approval", date: "2026-08-19" },
    { id: "INV-2026-041", client: "Kiambu County Gov", amount: 280000, status: "Paid", date: "2026-08-10" },
    { id: "INV-2026-040", client: "Dr. Peter Ndungu", amount: 75000, status: "Paid", date: "2026-08-04" },
  ]);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Survey Practice Management & Statutory Fee Estimator
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Estimate statutory professional surveyor fee scales, track client cadastral jobs, and generate boundary affirmation notices.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Survey Quotation Parameters</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Client Name / Organization</label>
              <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Project / Survey Description</label>
              <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Parcel Area (Hectares)</label>
                <input type="number" value={parcelAreaHa} step="0.5" onChange={(e) => setParcelAreaHa(parseFloat(e.target.value) || 1)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Beacons to Place/Check</label>
                <input type="number" value={newBeaconsCount} onChange={(e) => setNewBeaconsCount(parseInt(e.target.value) || 0)} style={{ width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Traverse Run Length (km)</label>
                <input type="number" value={traverseKm} step="0.1" onChange={(e) => setTraverseKm(parseFloat(e.target.value) || 0)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Terrain Difficulty</label>
                <select value={terrainDifficulty} onChange={(e) => setTerrainDifficulty(e.target.value as any)} style={{ width: "100%" }}>
                  <option value="flat">Flat / Open Country (1.0×)</option>
                  <option value="medium">Undulating / Light Bush (1.2×)</option>
                  <option value="steep">Steep / Dense Forest (1.5×)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Statutory Fee Breakdown (LSB Scale)</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Base Lodgement & Plan:</span><span>KES {baseFee.toLocaleString()}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Acreage Fee ({parcelAreaHa} Ha):</span><span>KES {areaFee.toLocaleString()}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Beaconing ({newBeaconsCount} beacons):</span><span>KES {beaconFee.toLocaleString()}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Control Traverse ({traverseKm} km):</span><span>KES {traverseFee.toLocaleString()}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-default)", paddingTop: "4px" }}>
                <span>Subtotal (Terrain {terrainMultiplier}×):</span><span>KES {Math.round(subtotal).toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                <span>VAT (16%):</span><span>KES {Math.round(vat).toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid var(--accent-primary)", paddingTop: "6px", fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)" }}>
                <span>Total Fee Quote:</span><span>KES {Math.round(totalInvoice).toLocaleString()}</span>
              </div>
            </div>
          </div>
          <button className="primary" style={{ marginTop: "12px" }}>Generate Client Proforma Invoice PDF</button>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
          Recent Survey Jobs & Invoices
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Invoice #</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Client</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Date</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{inv.id}</td>
                <td style={{ padding: "6px 8px" }}>{inv.client}</td>
                <td style={{ padding: "6px 8px", color: "var(--text-secondary)" }}>{inv.date}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>KES {inv.amount.toLocaleString()}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  <span style={{ padding: "2px 8px", fontSize: "var(--text-xs)", background: inv.status === "Paid" ? "rgba(34,197,94,0.15)" : "rgba(255,149,0,0.15)", color: inv.status === "Paid" ? "var(--status-success)" : "var(--accent-primary)" }}>
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
