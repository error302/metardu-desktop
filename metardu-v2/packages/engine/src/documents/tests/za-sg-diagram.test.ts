/**
 * ZA SG Diagram renderer tests — Task 8.
 */

import { describe, it, expect } from "vitest";
import { generateZaSgDiagramPdf, type ZaSgDiagramInput } from "../za-sg-diagram.js";
import { getCountryConfig } from "@metardu/country-config";
import { PDFDocument } from "pdf-lib";

const validBeacons = [
  { label: "B1", position: { easting: 0, northing: 0 }, description: "Iron peg" },
  { label: "B2", position: { easting: 100, northing: 0 }, description: "Iron peg" },
  { label: "B3", position: { easting: 100, northing: 100 }, description: "Concrete monument" },
  { label: "B4", position: { easting: 0, northing: 100 }, description: "Concrete monument" },
];

const validInput: ZaSgDiagramInput = {
  parcel: { beacons: validBeacons, srid: 2053, areaHa: 1.0 },
  surveyor: { name: "Jacob Mokoena", regNo: "PLATO/1234", dateOfSurvey: "2026-08-01" },
  sgDiagramNo: "SG 123/2026",
  farmName: "RIETFONTEIN 123",
  registrationDivision: "JR",
  province: "Gauteng",
};

describe("ZA SG Diagram renderer", () => {
  it("derives sheet size A1 portrait from SOUTH_AFRICA.planSheet Hartebeesthoek94/Lo", async () => {
    const cfg = getCountryConfig("ZA");
    expect(cfg.planSheet?.defaultSheetSize.toLowerCase()).toBe("a1");
    expect(cfg.planSheet?.defaultOrientation).toBe("portrait");
    expect(cfg.geodeticFramework.datum).toContain("Hartebeesthoek94");
    const out = await generateZaSgDiagramPdf(validInput);
    expect(out.pageSize).toBe("A1");
    expect(out.orientation).toBe("portrait");
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const page = reloaded.getPage(0);
    const w = page.getWidth();
    const h = page.getHeight();
    const MM_TO_PT = 2.834645669;
    expect(Math.abs(w - 594 * MM_TO_PT)).toBeLessThan(2);
    expect(Math.abs(h - 841 * MM_TO_PT)).toBeLessThan(2);
    expect(h).toBeGreaterThan(w);
  });

  it("generates valid PDF with DRAFT watermark and HK count", async () => {
    const out = await generateZaSgDiagramPdf(validInput);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.hasDraftWatermark).toBe(true);
    expect(out.hkItemCount).toBe(10);
    expect(Buffer.from(out.pdfBytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("PDF metadata contains Hartebeesthoek94 / Lo and SRID from config", async () => {
    const cfg = getCountryConfig("ZA");
    const out = await generateZaSgDiagramPdf(validInput);
    expect(out.srid).toBe(cfg.geodeticFramework.primarySRID);
    expect(out.srid).toBe(2053);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    expect(reloaded.getSubject()).toContain("Hartebeesthoek94");
    expect(reloaded.getSubject()).toContain("Lo");
    expect(reloaded.getSubject()).toContain("2053");
    expect(reloaded.getSubject()).toContain("DRAFT");
    expect(reloaded.getAuthor()).toBe("Jacob Mokoena");
  });

  it("verifies SAGC/PLATO pattern enforced", async () => {
    await expect(generateZaSgDiagramPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: "CSPS/1234" } })).rejects.toThrow(/PLATO|pattern/i);
    for (const ok of ["PLATO/1234", "PLATO/12345"]) {
      const out = await generateZaSgDiagramPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: ok } });
      expect(out.pdfBytes.length).toBeGreaterThan(1000);
    }
  });

  it("rejects <3 beacons", async () => {
    await expect(generateZaSgDiagramPdf({ ...validInput, parcel: { ...validInput.parcel, beacons: validBeacons.slice(0, 2) } })).rejects.toThrow(/at least 3 beacons/i);
  });

  it("rejects non-finite coordinates", async () => {
    const bad = structuredClone(validInput) as ZaSgDiagramInput;
    (bad.parcel.beacons[0]!.position as unknown as Record<string, number>).easting = NaN;
    await expect(generateZaSgDiagramPdf(bad)).rejects.toThrow(/NaN|finite/i);
  });

  it("rejects invalid SRID", async () => {
    await expect(generateZaSgDiagramPdf({ ...validInput, parcel: { ...validInput.parcel, srid: 0 } })).rejects.toThrow(/SRID/i);
  });

  it("rejects empty surveyor name", async () => {
    await expect(generateZaSgDiagramPdf({ ...validInput, surveyor: { ...validInput.surveyor, name: "" } })).rejects.toThrow(/surveyor.*name/i);
  });

  it("PDF metadata ASCII-only", async () => {
    const out = await generateZaSgDiagramPdf(validInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    for (const s of [reloaded.getTitle() ?? "", reloaded.getAuthor() ?? "", reloaded.getSubject() ?? ""]) {
      for (let i = 0; i < s.length; i++) expect(s.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("footer derives from ZA planSheet (no hardcoded sheet literals)", async () => {
    const cfg = getCountryConfig("ZA");
    const out = await generateZaSgDiagramPdf(validInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    expect(reloaded.getCreator()).toContain("za-sg-diagram");
    expect(cfg.planSheet!.titleBlockLabel).toContain("SOUTH AFRICA");
  });

  it("handles different Lo zones (2051, 2053, 2055)", async () => {
    for (const srid of [2051, 2053, 2055]) {
      const out = await generateZaSgDiagramPdf({ ...validInput, parcel: { ...validInput.parcel, srid } });
      expect(out.srid).toBe(srid);
      const reloaded = await PDFDocument.load(out.pdfBytes);
      expect(reloaded.getSubject()).toContain(String(srid));
    }
  });

  it("handles minimal input without optional farm fields", async () => {
    const minimal: ZaSgDiagramInput = {
      parcel: { beacons: validBeacons, srid: 2053 },
      surveyor: { name: "Jacob Mokoena", regNo: "PLATO/1234", dateOfSurvey: "2026-08-01" },
    };
    const out = await generateZaSgDiagramPdf(minimal);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
  });
});
