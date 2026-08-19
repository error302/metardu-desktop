/**
 * Survey Office Management, Fee Estimator & Client Invoicing View.
 *
 * Multi-country fee estimation with statutory fee scales for all
 * 8 supported countries (KE, AU, GB, ZA, AE, DE, US, GH).
 * Generates real proforma invoice PDFs using pdf-lib.
 */

import React, { useState, useCallback } from "react";
import {
  getFeeScale,
  allFeeCodes,
  formatCurrency,
  computeFeeBreakdown,
  type CountryFeeCode,
  type FeeBreakdown,
} from "../fee-scales.js";
import { generateProformaInvoicePdf } from "../invoice-pdf.js";

// ─── Component ───────────────────────────────────────────────────

export const OfficeManagementView: React.FC = () => {
  const [countryCode, setCountryCode] = useState<CountryFeeCode>("KE");
  const [clientName, setClientName] = useState("Alpha Properties Ltd");
  const [jobTitle, setJobTitle] = useState("Cadastral Boundary Re-establishment & Subdivision");
  const [parcelAreaHa, setParcelAreaHa] = useState(2.5);
  const [newBeaconsCount, setNewBeaconsCount] = useState(8);
  const [traverseKm, setTraverseKm] = useState(1.2);
  const [terrainIndex, setTerrainIndex] = useState(1);
  const [surveyorName, setSurveyorName] = useState("");
  const [surveyorRegNo, setSurveyorRegNo] = useState("");
  const [invoiceCounter, setInvoiceCounter] = useState(43);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);

  const scale = getFeeScale(countryCode);
  const breakdown = computeFeeBreakdown(countryCode, {
    areaHa: parcelAreaHa,
    beaconCount: newBeaconsCount,
    traverseKm,
    terrainIndex,
  });

  const [invoices, setInvoices] = useState([
    { id: "INV-2026-042", client: "Alpha Properties Ltd", amount: 128_000, currency: "KES", status: "Pending Approval", date: "2026-08-19" },
    { id: "INV-2026-041", client: "Kiambu County Gov", amount: 280_000, currency: "KES", status: "Paid", date: "2026-08-10" },
    { id: "INV-2026-040", client: "Dr. Peter Ndungu", amount: 75_000, currency: "KES", status: "Paid", date: "2026-08-04" },
  ]);

  const handleGeneratePdf = useCallback(async () => {
    setPdfStatus("generating");
    setPdfError(null);

    try {
      const invoiceNo = `INV-2026-${String(invoiceCounter).padStart(3, "0")}`;
      const today = new Date().toISOString().split("T")[0]!;

      const pdfBytes = await generateProformaInvoicePdf({
        invoiceNo,
        clientName,
        jobTitle,
        breakdown,
        countryCode,
        surveyorName: surveyorName || "Licensed Surveyor",
        surveyorRegNo: surveyorRegNo || "LS/0000",
        date: today,
      });

      // Trigger download
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNo}_${clientName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Add to invoice list
      setInvoices((prev) => [
        {
          id: invoiceNo,
          client: clientName,
          amount: Math.round(breakdown.total),
          currency: breakdown.currency,
          status: "Sent",
          date: today,
        },
        ...prev,
      ]);
      setInvoiceCounter((c) => c + 1);
      setPdfStatus("done");
      setTimeout(() => setPdfStatus("idle"), 3000);
    } catch (e) {
      setPdfError((e as Error).message);
      setPdfStatus("error");
      setTimeout(() => setPdfStatus("idle"), 5000);
    }
  }, [clientName, jobTitle, breakdown, countryCode, surveyorName, surveyorRegNo, invoiceCounter]);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Survey Practice Management & Multi-Currency Fee Estimator
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Statutory fee scales for {allFeeCodes().length} countries. Generate proforma invoice PDFs with line items, tax, and totals.
      </p>

      {/* Country selector */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <label style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>Country:</label>
        <select
          value={countryCode}
          onChange={(e) => { setCountryCode(e.target.value as CountryFeeCode); setTerrainIndex(1); }}
          style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
        >
          {allFeeCodes().map((code) => {
            const s = getFeeScale(code);
            return <option key={code} value={code}>{code} — {s.currency} ({s.professionalBody.split("(")[0]?.trim()})</option>;
          })}
        </select>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {scale.regulatoryRef}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {/* Left: Input parameters */}
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
                <select value={terrainIndex} onChange={(e) => setTerrainIndex(parseInt(e.target.value))} style={{ width: "100%" }}>
                  {scale.terrainMultipliers.map((t, i) => (
                    <option key={i} value={i}>{t.label} ({t.multiplier}×)</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Surveyor Name</label>
                <input type="text" value={surveyorName} onChange={(e) => setSurveyorName(e.target.value)} placeholder="John Mwangi" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Registration No.</label>
                <input type="text" value={surveyorRegNo} onChange={(e) => setSurveyorRegNo(e.target.value)} placeholder="LS/1234" style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Fee breakdown */}
        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>
              Fee Breakdown ({scale.currency})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Base Lodgement & Plan:</span>
                <span>{formatCurrency(breakdown.baseFee, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Area Fee ({parcelAreaHa} Ha):</span>
                <span>{formatCurrency(breakdown.areaFee, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Beaconing ({newBeaconsCount} beacons):</span>
                <span>{formatCurrency(breakdown.beaconFee, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Control Traverse ({traverseKm} km):</span>
                <span>{formatCurrency(breakdown.traverseFee, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-default)", paddingTop: "4px" }}>
                <span>Subtotal:</span>
                <span>{formatCurrency(breakdown.subtotalBeforeTerrain, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Terrain ({breakdown.terrainMultiplier}×):</span>
                <span>{formatCurrency(breakdown.subtotalAfterTerrain, countryCode)}</span>
              </div>
              {breakdown.minimumApplied && (
                <div style={{ color: "var(--status-warning)", fontSize: "var(--text-xs)" }}>
                  ⚠ Minimum fee applied ({scale.symbol} {scale.minimumFee?.toLocaleString()})
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                <span>{breakdown.vatLabel}:</span>
                <span>{formatCurrency(breakdown.vat, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid var(--accent-primary)", paddingTop: "6px", fontSize: "var(--text-lg)", fontWeight: "bold", color: "var(--accent-primary)" }}>
                <span>Total Fee Quote:</span>
                <span>{formatCurrency(breakdown.total, countryCode)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                <span>Hourly rate:</span>
                <span>{formatCurrency(scale.hourlyRate, countryCode)}/hr</span>
              </div>
            </div>
          </div>
          <button
            className="primary"
            onClick={handleGeneratePdf}
            disabled={pdfStatus === "generating"}
            style={{
              marginTop: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              justifyContent: "center",
              opacity: pdfStatus === "generating" ? 0.7 : 1,
              cursor: pdfStatus === "generating" ? "wait" : "pointer",
            }}
          >
            {pdfStatus === "generating" ? "⏳ Generating PDF..." : pdfStatus === "done" ? "✓ PDF Downloaded!" : "📄 Generate Client Proforma Invoice PDF"}
          </button>
          {pdfError && (
            <div style={{ marginTop: "6px", fontSize: "var(--text-xs)", color: "var(--text-error)", fontFamily: "var(--font-mono)" }}>
              Error: {pdfError}
            </div>
          )}
        </div>
      </div>

      {/* Invoice history */}
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
            {invoices.map((inv, idx) => {
              const invCode = allFeeCodes().includes(inv.currency as CountryFeeCode) ? inv.currency as CountryFeeCode : countryCode;
              const invScale = getFeeScale(invCode);
              return (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{inv.id}</td>
                  <td style={{ padding: "6px 8px" }}>{inv.client}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-secondary)" }}>{inv.date}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>
                    {invScale.symbol} {inv.amount.toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px",
                      fontSize: "var(--text-xs)",
                      background: inv.status === "Paid" ? "rgba(34,197,94,0.15)" : inv.status === "Sent" ? "rgba(59,130,246,0.15)" : "rgba(255,149,0,0.15)",
                      color: inv.status === "Paid" ? "var(--status-success)" : inv.status === "Sent" ? "#3b82f6" : "var(--accent-primary)",
                    }}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
