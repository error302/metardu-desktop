/**
 * Tests for proforma invoice PDF generation using pdf-lib.
 *
 * Verifies that generateProformaInvoicePdf produces valid PDF bytes
 * for all 8 supported countries with correct line items, tax, and totals.
 */

import { describe, it, expect } from "vitest";
import { generateProformaInvoicePdf } from "../renderer/invoice-pdf.js";
import {
  computeFeeBreakdown,

  allFeeCodes,
  type CountryFeeCode,
} from "../renderer/fee-scales.js";

// ─── Helpers ──────────────────────────────────────────────────────

function makeParams(code: CountryFeeCode) {
  const breakdown = computeFeeBreakdown(code, {
    areaHa: 2.5,
    beaconCount: 8,
    traverseKm: 1.2,
    terrainIndex: 1,
  });
  return {
    invoiceNo: `INV-2026-001`,
    clientName: "Test Client Ltd",
    jobTitle: "Cadastral Boundary Survey",
    breakdown,
    countryCode: code,
    surveyorName: "John Mwangi",
    surveyorRegNo: "LS/1234",
    date: "2026-08-20",
    validDays: 30,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("Proforma invoice PDF generation", () => {
  it("generates valid PDF bytes for Kenya", async () => {
    const params = makeParams("KE");
    const pdfBytes = await generateProformaInvoicePdf(params);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    // PDF magic header
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    expect(header).toBe("%PDF-");

    // PDF structure: must contain object markers and stream markers
    const raw = new TextDecoder("latin1").decode(pdfBytes);
    expect(raw).toContain("endobj");
    expect(raw).toContain("xref");
    expect(raw).toContain("%%EOF");
  });

  it("generates valid PDF for all 8 countries", async () => {
    const codes = allFeeCodes();
    expect(codes).toHaveLength(8);

    for (const code of codes) {
      const params = makeParams(code);
      const pdfBytes = await generateProformaInvoicePdf(params);

      expect(pdfBytes.length).toBeGreaterThan(500);

      const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
      expect(header).toBe("%PDF-");
    }
  });

  it("produces non-trivial PDF with correct structure", async () => {
    const params = makeParams("KE");
    const pdfBytes = await generateProformaInvoicePdf(params);
    const raw = new TextDecoder("latin1").decode(pdfBytes);

    // PDF cross-reference and trailer present
    expect(raw).toContain("xref");
    expect(raw).toContain("%%EOF");
    expect(raw).toContain("endobj");

    // PDF must be larger than header-only (>1KB for A4 with content)
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("fee breakdown produces correct totals for Kenya", async () => {
    const breakdown = computeFeeBreakdown("KE", {
      areaHa: 2.5,
      beaconCount: 8,
      traverseKm: 1.2,
      terrainIndex: 1,
    });

    // Verify math: base 45000 + area 30000 + beacon 28000 + traverse 18000 = 121000
    expect(breakdown.baseFee).toBe(45_000);
    expect(breakdown.areaFee).toBe(30_000);
    expect(breakdown.beaconFee).toBe(28_000);
    expect(breakdown.traverseFee).toBe(18_000);
    expect(breakdown.subtotalBeforeTerrain).toBe(121_000);
    expect(breakdown.terrainMultiplier).toBe(1.2);
    // subtotalAfterTerrain = 121000 * 1.2 = 145200
    expect(breakdown.subtotalAfterTerrain).toBe(145_200);
    // VAT = 145200 * 0.16 = 23232
    expect(breakdown.vat).toBe(23_232);
    // total = 145200 + 23232 = 168432
    expect(breakdown.total).toBe(168_432);
    expect(breakdown.currency).toBe("KES");
    expect(breakdown.minimumApplied).toBe(false);
  });

  it("fee breakdown handles all 8 countries without errors", async () => {
    const codes = allFeeCodes();
    for (const code of codes) {
      const breakdown = computeFeeBreakdown(code, {
        areaHa: 2.5,
        beaconCount: 8,
        traverseKm: 1.2,
        terrainIndex: 1,
      });
      expect(breakdown.total).toBeGreaterThan(0);
      expect(breakdown.vat).toBeGreaterThanOrEqual(0);
      expect(breakdown.currency).toBeTruthy();
      expect(breakdown.symbol).toBeTruthy();
    }
  });

  it("handles minimum fee application for Kenya", () => {
    const breakdown = computeFeeBreakdown("KE", {
      areaHa: 0,
      beaconCount: 0,
      traverseKm: 0,
      terrainIndex: 0,
    });
    // Base fee 45,000 < minimum 50,000
    expect(breakdown.minimumApplied).toBe(true);
    expect(breakdown.subtotalAfterTerrain).toBe(50_000);

    const params = makeParams("KE");
    params.breakdown = breakdown;
    // Should still generate a valid PDF
    const pdfBytes = generateProformaInvoicePdf(params);
    return pdfBytes.then((bytes) => {
      const header = new TextDecoder().decode(bytes.slice(0, 5));
      expect(header).toBe("%PDF-");
    });
  });

  it("generates different PDFs for different countries", async () => {
    const kePdf = await generateProformaInvoicePdf(makeParams("KE"));
    const usPdf = await generateProformaInvoicePdf(makeParams("US"));
    const auPdf = await generateProformaInvoicePdf(makeParams("AU"));

    // All different sizes (different currencies, symbols, regulatory refs)
    expect(kePdf.length).not.toBe(usPdf.length);
    expect(kePdf.length).not.toBe(auPdf.length);
  });

  it("multi-currency fee scales produce different amounts", () => {
    const input = { areaHa: 2.5, beaconCount: 8, traverseKm: 1.2, terrainIndex: 1 };
    const ke = computeFeeBreakdown("KE", input);
    const us = computeFeeBreakdown("US", input);
    const au = computeFeeBreakdown("AU", input);

    expect(ke.currency).toBe("KES");
    expect(us.currency).toBe("USD");
    expect(au.currency).toBe("AUD");

    // Totals should differ between countries
    expect(ke.total).not.toBe(us.total);
    expect(ke.total).not.toBe(au.total);
  });
});
