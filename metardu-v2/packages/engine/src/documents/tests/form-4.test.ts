/**
 * Tests for Form 4 (Mutation Plan) renderer.
 *
 * Covers ~12 cases: happy + validation (<3 beacons, bad ISK, non-finite,
 * empty strings, invalid SRID), PDF metadata via pdf-lib, DRAFT flag + HK
 * count, ASCII-only, area cross-check, DXF companion layers.
 */

import { describe, it, expect } from "vitest";
import {
  generateForm4Pdf,
  generateForm4Dxf,
  type Form4Input,
} from "../form-4.js";
import { PDFDocument } from "pdf-lib";

const validBeaconsParent = [
  { label: "B1", position: { easting: 257100, northing: 9857700 }, description: "Concrete pillar" },
  { label: "B2", position: { easting: 257200, northing: 9857700 }, description: "Concrete pillar" },
  { label: "B3", position: { easting: 257200, northing: 9857800 }, description: "Iron pin" },
  { label: "B4", position: { easting: 257100, northing: 9857800 }, description: "Iron pin" },
];

const validBeaconsNew1 = [
  { label: "B1", position: { easting: 257100, northing: 9857700 }, description: "Concrete pillar" },
  { label: "B5", position: { easting: 257150, northing: 9857700 }, description: "Iron pin" },
  { label: "B6", position: { easting: 257150, northing: 9857800 }, description: "Iron pin" },
  { label: "B4", position: { easting: 257100, northing: 9857800 }, description: "Iron pin" },
];

const validBeaconsNew2 = [
  { label: "B5", position: { easting: 257150, northing: 9857700 }, description: "Concrete pillar" },
  { label: "B2", position: { easting: 257200, northing: 9857700 }, description: "Concrete pillar" },
  { label: "B3", position: { easting: 257200, northing: 9857800 }, description: "Iron pin" },
  { label: "B6", position: { easting: 257150, northing: 9857800 }, description: "Iron pin" },
];

const validForm4Input: Form4Input = {
  county: "KIAMBU",
  subCounty: "KIAMBU",
  parentParcel: { lrNumber: "LR 12345/67", beacons: validBeaconsParent },
  newParcels: [
    { lrNumber: "LR 12345/68", beacons: validBeaconsNew1 },
    { lrNumber: "LR 12345/69", beacons: validBeaconsNew2 },
  ],
  mutationReason: "Subdivision for inheritance",
  areaHaByParcel: {
    "LR 12345/68": 0.5,
    "LR 12345/69": 0.5,
  },
  srid: 21037,
  surveyor: { name: "Jane Wanjiru", iskRegNo: "LS/1234", dateOfSurvey: "2026-07-19" },
};

describe("Form 4 renderer", () => {
  it("generates valid PDF with DRAFT watermark and HK count", async () => {
    const out = await generateForm4Pdf(validForm4Input);
    expect(out.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.hasDraftWatermark).toBe(true);
    expect(out.hkItemCount).toBeGreaterThan(0);
    expect(out.hkItemCount).toBe(10);
    const header = Buffer.from(out.pdfBytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("PDF metadata is correct via pdf-lib reload", async () => {
    const out = await generateForm4Pdf(validForm4Input);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    expect(reloaded.getTitle()).toContain("LR 12345/67");
    expect(reloaded.getAuthor()).toBe("Jane Wanjiru");
    expect(reloaded.getSubject()).toContain("Form No. 4");
  });

  it("area cross-check passes when new areas sum to parent (within 0.01 ha)", async () => {
    const out = await generateForm4Pdf(validForm4Input);
    // Parent: 100m x 100m = 1.0 ha; new total 1.0 ha
    expect(out.areasCrossChecked).toBe(true);
  });

  it("area cross-check fails when new areas do not sum to parent", async () => {
    const input: Form4Input = {
      ...validForm4Input,
      areaHaByParcel: { "LR 12345/68": 0.2, "LR 12345/69": 0.2 }, // total 0.4 vs 1.0
    };
    const out = await generateForm4Pdf(input);
    expect(out.areasCrossChecked).toBe(false);
  });

  it("rejects parent with <3 beacons", async () => {
    const input: Form4Input = {
      ...validForm4Input,
      parentParcel: { lrNumber: "LR 12345/67", beacons: validBeaconsParent.slice(0, 2) },
    };
    await expect(generateForm4Pdf(input)).rejects.toThrow(/at least 3 beacons/i);
  });

  it("rejects new parcel with <3 beacons", async () => {
    const input: Form4Input = {
      ...validForm4Input,
      newParcels: [{ lrNumber: "LR 12345/68", beacons: validBeaconsNew1.slice(0, 2) }],
      areaHaByParcel: { "LR 12345/68": 0.5 },
    };
    await expect(generateForm4Pdf(input)).rejects.toThrow(/at least 3 beacons/i);
  });

  it("rejects bad ISK registration number", async () => {
    const input: Form4Input = { ...validForm4Input, surveyor: { ...validForm4Input.surveyor, iskRegNo: "BAD/123" } };
    await expect(generateForm4Pdf(input)).rejects.toThrow(/ISK|registration/i);
  });

  it("accepts LS/ prefix case-insensitive with 3-5 digits", async () => {
    for (const reg of ["LS/123", "ls/1234", "Ls/12345"]) {
      const input: Form4Input = { ...validForm4Input, surveyor: { ...validForm4Input.surveyor, iskRegNo: reg } };
      const out = await generateForm4Pdf(input);
      expect(out.pdfBytes.length).toBeGreaterThan(1000);
    }
  });

  it("rejects non-finite coordinates", async () => {
    const bad = structuredClone(validForm4Input) as Form4Input;
    (bad.parentParcel.beacons[0]!.position as unknown as Record<string, number>).easting = Infinity;
    await expect(generateForm4Pdf(bad)).rejects.toThrow(/finite|NaN/i);
  });

  it("rejects empty county / subCounty / mutationReason", async () => {
    await expect(generateForm4Pdf({ ...validForm4Input, county: "   " })).rejects.toThrow(/county/i);
    await expect(generateForm4Pdf({ ...validForm4Input, subCounty: "" })).rejects.toThrow(/subCounty|sub-county/i);
    await expect(generateForm4Pdf({ ...validForm4Input, mutationReason: "" })).rejects.toThrow(/mutationReason/i);
  });

  it("rejects invalid SRID (non-integer or out of range)", async () => {
    await expect(generateForm4Pdf({ ...validForm4Input, srid: 999999 as unknown as number })).rejects.toThrow(/SRID|srid/i);
    await expect(generateForm4Pdf({ ...validForm4Input, srid: NaN })).rejects.toThrow(/SRID|srid|finite/i);
  });

  it("rejects missing areaHaByParcel entry for a new parcel", async () => {
    const input: Form4Input = { ...validForm4Input, areaHaByParcel: { "LR 12345/68": 0.5 } };
    await expect(generateForm4Pdf(input)).rejects.toThrow(/areaHaByParcel/i);
  });

  it("PDF is ASCII-only in metadata (sanitized)", async () => {
    const out = await generateForm4Pdf(validForm4Input);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const title = reloaded.getTitle() ?? "";
    const author = reloaded.getAuthor() ?? "";
    for (const s of [title, author]) {
      for (let i = 0; i < s.length; i++) {
        expect(s.charCodeAt(i)).toBeLessThan(128);
      }
    }
  });

  it("DXF companion has correct layers (BOUNDARY-OLD, BOUNDARY-NEW, BEACON-*)", async () => {
    const dxf = generateForm4Dxf(validForm4Input);
    expect(dxf).toContain("BOUNDARY-OLD");
    expect(dxf).toContain("BOUNDARY-NEW");
    expect(dxf).toContain("BEACON-EXISTING");
    expect(dxf).toContain("BEACON-NEW");
    expect(dxf).toContain("TEXT-AREA");
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("EOF");
    // DXF is ASCII
    for (let i = 0; i < dxf.length; i++) expect(dxf.charCodeAt(i)).toBeLessThan(128);
  });

  it("handles single new parcel subdivision", async () => {
    const input: Form4Input = {
      ...validForm4Input,
      newParcels: [{ lrNumber: "LR 12345/68", beacons: validBeaconsParent }],
      areaHaByParcel: { "LR 12345/68": 1.0 },
    };
    const out = await generateForm4Pdf(input);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.areasCrossChecked).toBe(true);
  });
});
