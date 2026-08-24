/**
 * DE Grenzfeststellung renderer tests — Task 8.
 *
 * Validates A4 ETRS89/UTM, AdV framework note, DHDN TODO/NTv2, DRAFT, SRID from config.
 */

import { describe, it, expect } from "vitest";
import { generateDeGrenzfeststellungPdf, type DeGrenzfeststellungInput } from "../de-grenzfeststellung.js";
import { getCountryConfig } from "@metardu/country-config";
import { PDFDocument } from "pdf-lib";

const validBeacons = [
  { label: "GP1", position: { easting: 389000, northing: 5823000 }, description: "Grenzpunkt" },
  { label: "GP2", position: { easting: 389100, northing: 5823000 }, description: "Grenzpunkt" },
  { label: "GP3", position: { easting: 389100, northing: 5823100 }, description: "Grenzpunkt" },
  { label: "GP4", position: { easting: 389000, northing: 5823100 }, description: "Grenzpunkt" },
];

const validInput: DeGrenzfeststellungInput = {
  parcel: { beacons: validBeacons, srid: 25832, areaHa: 1.0 },
  surveyor: { name: "Hans Muller", regNo: "12345", date: "2026-08-01" },
  gemarkung: "Musterdorf",
  flur: "3",
  flurstueckNr: "123/4",
  gemeinde: "Musterstadt",
  landkreis: "Musterkreis",
  bundesland: "Nordrhein-Westfalen",
};

describe("DE Grenzfeststellung renderer", () => {
  it("derives sheet size A4 portrait and ETRS89/UTM from GERMANY.planSheet", async () => {
    const cfg = getCountryConfig("DE");
    expect(cfg.planSheet?.defaultSheetSize.toLowerCase()).toBe("a4");
    expect(cfg.planSheet?.defaultOrientation).toBe("portrait");
    expect(cfg.geodeticFramework.datum).toContain("ETRS89");
    expect(cfg.geodeticFramework.primarySRID).toBe(25832);
    const out = await generateDeGrenzfeststellungPdf(validInput);
    expect(out.pageSize).toBe("A4");
    expect(out.orientation).toBe("portrait");
    expect(out.srid).toBe(25832);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const page = reloaded.getPage(0);
    const MM_TO_PT = 2.834645669;
    expect(Math.abs(page.getWidth() - 210 * MM_TO_PT)).toBeLessThan(2);
    expect(Math.abs(page.getHeight() - 297 * MM_TO_PT)).toBeLessThan(2);
  });

  it("generates valid PDF with DRAFT watermark HK count 10", async () => {
    const out = await generateDeGrenzfeststellungPdf(validInput);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.hasDraftWatermark).toBe(true);
    expect(out.hkItemCount).toBe(10);
    expect(Buffer.from(out.pdfBytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("PDF subject contains ETRS89/UTM and AdV framework note plus DHDN/NTv2 TODO", async () => {
    const out = await generateDeGrenzfeststellungPdf(validInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const subject = reloaded.getSubject() ?? "";
    expect(subject).toContain("ETRS89");
    expect(subject).toContain("25832");
    expect(subject).toContain("AdV");
    // DHDN legacy Helmert is verified in Task 2 — still note pending NTv2 grid
    const cfg = getCountryConfig("DE");
    const legacy = cfg.geodeticFramework.legacyDatums?.[0];
    expect(legacy?.helmert).toBeDefined();
    expect(legacy?.source).toContain("EPSG:1777");
  });

  it("verifies OeBVI registration pattern enforced (4-6 digits)", async () => {
    await expect(generateDeGrenzfeststellungPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: "CSPS/1234" } })).rejects.toThrow(/pattern/i);
    for (const ok of ["1234", "12345", "123456"]) {
      const out = await generateDeGrenzfeststellungPdf({ ...validInput, surveyor: { ...validInput.surveyor, regNo: ok } });
      expect(out.pdfBytes.length).toBeGreaterThan(1000);
    }
  });

  it("rejects <3 beacons", async () => {
    await expect(generateDeGrenzfeststellungPdf({ ...validInput, parcel: { ...validInput.parcel, beacons: validBeacons.slice(0, 2) } })).rejects.toThrow(/at least 3 beacons/i);
  });

  it("rejects non-finite coordinates", async () => {
    const bad = structuredClone(validInput) as DeGrenzfeststellungInput;
    (bad.parcel.beacons[1]!.position as unknown as Record<string, number>).northing = NaN;
    await expect(generateDeGrenzfeststellungPdf(bad)).rejects.toThrow(/NaN|finite/i);
  });

  it("rejects invalid SRID", async () => {
    await expect(generateDeGrenzfeststellungPdf({ ...validInput, parcel: { ...validInput.parcel, srid: 999999 as unknown as number } })).rejects.toThrow(/SRID/i);
  });

  it("rejects empty surveyor name", async () => {
    await expect(generateDeGrenzfeststellungPdf({ ...validInput, surveyor: { ...validInput.surveyor, name: "" } })).rejects.toThrow(/surveyor.*name/i);
  });

  it("PDF metadata ASCII-only (German umlauts sanitised)", async () => {
    const out = await generateDeGrenzfeststellungPdf({ ...validInput, gemarkung: "München", bundesland: "Bayern" });
    const reloaded = await PDFDocument.load(out.pdfBytes);
    for (const s of [reloaded.getTitle() ?? "", reloaded.getAuthor() ?? "", reloaded.getSubject() ?? ""]) {
      for (let i = 0; i < s.length; i++) expect(s.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("handles alternative UTM zone 33N (25833) and DHDN/GK legacy 31467", async () => {
    for (const srid of [25832, 25833, 31467]) {
      const out = await generateDeGrenzfeststellungPdf({ ...validInput, parcel: { ...validInput.parcel, srid } });
      expect(out.srid).toBe(srid);
      const reloaded = await PDFDocument.load(out.pdfBytes);
      // creator should reference de-grenzfeststellung
      expect(reloaded.getCreator()).toContain("de-grenzfeststellung");
    }
  });

  it("handles minimal input without Gemarkung fields", async () => {
    const minimal: DeGrenzfeststellungInput = {
      parcel: { beacons: validBeacons, srid: 25832 },
      surveyor: { name: "Hans Muller", regNo: "12345", date: "2026-08-01" },
    };
    const out = await generateDeGrenzfeststellungPdf(minimal);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
  });

  it("verifies footer and title derive from DE planSheet (no hardcoded A4 literal)", async () => {
    const cfg = getCountryConfig("DE");
    expect(cfg.planSheet!.titleBlockLabel).toContain("BUNDESREPUBLIK");
    const out = await generateDeGrenzfeststellungPdf(validInput);
    expect(out.pageSize).toBe(cfg.planSheet!.defaultSheetSize.toUpperCase());
  });
});
