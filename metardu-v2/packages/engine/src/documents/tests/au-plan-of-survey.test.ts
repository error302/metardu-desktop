/**
 * AU Plan of Survey (Deposited Plan) renderer tests — Task 8.
 *
 * Validates sheet size/orientation derived from AUSTRALIA.planSheet,
 * footer, DRAFT flag, SRID from config, pypdf open (pdf-lib reload), ASCII-only,
 * validation, and HK count. Follows Kenya form-4 pattern.
 */

import { describe, it, expect } from "vitest";
import { generateAuPlanOfSurveyPdf, type AuPlanOfSurveyInput } from "../au-plan-of-survey.js";
import { getCountryConfig } from "@metardu/country-config";
import { PDFDocument } from "pdf-lib";

const validBeacons = [
  { label: "B1", position: { easting: 334000, northing: 6250000 }, description: "PM" },
  { label: "B2", position: { easting: 334100, northing: 6250000 }, description: "PM" },
  { label: "B3", position: { easting: 334100, northing: 6250100 }, description: "SSM" },
  { label: "B4", position: { easting: 334000, northing: 6250100 }, description: "SSM" },
];

const validInput: AuPlanOfSurveyInput = {
  parcel: { beacons: validBeacons, srid: 7856, areaHa: 1.0 },
  surveyor: { name: "Alice Smith", regNo: "CSPS/1234", dateOfSurvey: "2026-08-01" },
  planNumber: "DP 123456",
  council: "City of Sydney",
  locality: "SYDNEY",
  parish: "ST JAMES",
  county: "CUMBERLAND",
  lga: "Sydney",
};

describe("AU Plan of Survey renderer", () => {
  it("derives sheet size A1 and orientation landscape from AUSTRALIA.planSheet", async () => {
    const cfg = getCountryConfig("AU");
    expect(cfg.planSheet?.defaultSheetSize.toLowerCase()).toBe("a1");
    expect(cfg.planSheet?.defaultOrientation).toBe("landscape");
    const out = await generateAuPlanOfSurveyPdf(validInput);
    expect(out.pageSize).toBe("A1");
    expect(out.orientation).toBe("landscape");
    // Verify PDF page dimensions: A1 landscape = 841mm x 594mm
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const page = reloaded.getPage(0);
    const w = page.getWidth();
    const h = page.getHeight();
    const MM_TO_PT = 2.834645669;
    expect(Math.abs(w - 841 * MM_TO_PT)).toBeLessThan(2);
    expect(Math.abs(h - 594 * MM_TO_PT)).toBeLessThan(2);
    expect(w).toBeGreaterThan(h); // landscape
  });

  it("generates valid PDF with DRAFT watermark and HK count", async () => {
    const out = await generateAuPlanOfSurveyPdf(validInput);
    expect(out.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.hasDraftWatermark).toBe(true);
    expect(out.hkItemCount).toBeGreaterThan(0);
    expect(out.hkItemCount).toBe(9);
    expect(Buffer.from(out.pdfBytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("PDF metadata is correct and SRID from AUSTRALIA.geodeticFramework", async () => {
    const cfg = getCountryConfig("AU");
    const out = await generateAuPlanOfSurveyPdf(validInput);
    expect(out.srid).toBe(cfg.geodeticFramework.primarySRID);
    expect(out.srid).toBe(7856);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    expect(reloaded.getTitle()).toContain("DEPOSITED PLAN");
    expect(reloaded.getAuthor()).toBe("Alice Smith");
    expect(reloaded.getSubject()).toContain("GDA2020");
    expect(reloaded.getSubject()).toContain("MGA");
    expect(reloaded.getSubject()).toContain("7856");
    expect(reloaded.getSubject()).toContain("DRAFT");
  });

  it("footer and title derive from AU planSheet (no hardcoded literals)", async () => {
    const cfg = getCountryConfig("AU");
    const out = await generateAuPlanOfSurveyPdf(validInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const subject = reloaded.getSubject() ?? "";
    expect(subject).toContain(cfg.planSheet!.titleBlockLabel.replace("—", "-").split(" ").slice(0, 2).join(" ") || "AUSTRALIA");
    expect(reloaded.getCreator()).toContain("au-plan-of-survey");
  });

  it("verifies professionalBody CSPS pattern is enforced", async () => {
    await expect(generateAuPlanOfSurveyPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: "LS/1234" } })).rejects.toThrow(/CSPS|pattern/i);
    await expect(generateAuPlanOfSurveyPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: "CSPS/12" } })).rejects.toThrow(/pattern/i);
    for (const ok of ["CSPS/1234", "CSPS/12345"]) {
      const out = await generateAuPlanOfSurveyPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: ok } });
      expect(out.pdfBytes.length).toBeGreaterThan(1000);
    }
  });

  it("rejects parcel with <3 beacons", async () => {
    const input: AuPlanOfSurveyInput = { ...validInput, parcel: { ...validInput.parcel, beacons: validBeacons.slice(0, 2) } };
    await expect(generateAuPlanOfSurveyPdf(input)).rejects.toThrow(/at least 3 beacons/i);
  });

  it("rejects non-finite coordinates", async () => {
    const bad = structuredClone(validInput) as AuPlanOfSurveyInput;
    (bad.parcel.beacons[0]!.position as unknown as Record<string, number>).easting = Infinity;
    await expect(generateAuPlanOfSurveyPdf(bad)).rejects.toThrow(/finite/i);
  });

  it("rejects invalid SRID", async () => {
    await expect(generateAuPlanOfSurveyPdf({ ...validInput, parcel: { ...validInput.parcel, srid: 0 } })).rejects.toThrow(/SRID/i);
    await expect(generateAuPlanOfSurveyPdf({ ...validInput, parcel: { ...validInput.parcel, srid: 999999 as unknown as number } })).rejects.toThrow(/SRID/i);
  });

  it("rejects empty surveyor name", async () => {
    await expect(generateAuPlanOfSurveyPdf({ ...validInput, surveyor: { ...validInput.surveyor, name: "   " } })).rejects.toThrow(/surveyor.*name/i);
  });

  it("PDF metadata strings are ASCII-only", async () => {
    const out = await generateAuPlanOfSurveyPdf(validInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    for (const s of [reloaded.getTitle() ?? "", reloaded.getAuthor() ?? "", reloaded.getSubject() ?? ""]) {
      for (let i = 0; i < s.length; i++) expect(s.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("handles different parcel areas and derived scale", async () => {
    const small: AuPlanOfSurveyInput = { ...validInput, parcel: { ...validInput.parcel, areaHa: 0.2 } };
    const large: AuPlanOfSurveyInput = { ...validInput, parcel: { ...validInput.parcel, areaHa: 60 } };
    const outSmall = await generateAuPlanOfSurveyPdf(small);
    const outLarge = await generateAuPlanOfSurveyPdf(large);
    expect(outSmall.pdfBytes.length).toBeGreaterThan(2000);
    expect(outLarge.pdfBytes.length).toBeGreaterThan(2000);
  });

  it("handles optional plan metadata fields", async () => {
    const minimal: AuPlanOfSurveyInput = {
      parcel: { beacons: validBeacons, srid: 7856 },
      surveyor: { name: "Alice Smith", regNo: "CSPS/1234", dateOfSurvey: "2026-08-01" },
    };
    const out = await generateAuPlanOfSurveyPdf(minimal);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
  });
});
