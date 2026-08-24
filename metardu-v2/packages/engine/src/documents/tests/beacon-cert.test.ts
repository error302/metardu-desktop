/**
 * Tests for Beacon Certificate renderer.
 *
 * Covers validation (happy, bad ISK, non-finite coords, empty beacon label,
 * empty parcelRef, invalid SRID), PDF metadata via pdf-lib, DRAFT flag +
 * HK count, ASCII-only, single-beacon certificate content.
 */

import { describe, it, expect } from "vitest";
import { generateBeaconCertificatePdf, type BeaconCertificateInput } from "../beacon-certificate.js";
import { PDFDocument } from "pdf-lib";

const validBeaconCertInput: BeaconCertificateInput = {
  beacon: {
    label: "B1",
    position: { easting: 257100.0, northing: 9857700.0 },
    markType: "Concrete pillar",
    description: "12mm iron pin in concrete, 600mm deep, witness 0.3m",
  },
  parcelRef: "LR 12345/68",
  ownerName: "John Kamau",
  srid: 21037,
  surveyor: { name: "Jane Wanjiru", iskRegNo: "LS/1234", dateOfSurvey: "2026-07-19" },
};

describe("Beacon Certificate renderer", () => {
  it("generates valid PDF with DRAFT watermark and HK count", async () => {
    const out = await generateBeaconCertificatePdf(validBeaconCertInput);
    expect(out.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
    expect(out.hasDraftWatermark).toBe(true);
    expect(out.hkItemCount).toBeGreaterThan(0);
    expect(out.hkItemCount).toBe(9);
    const header = Buffer.from(out.pdfBytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("PDF metadata is correct via pdf-lib reload", async () => {
    const out = await generateBeaconCertificatePdf(validBeaconCertInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    expect(reloaded.getTitle()).toContain("B1");
    expect(reloaded.getTitle()).toContain("LR 12345/68");
    expect(reloaded.getAuthor()).toBe("Jane Wanjiru");
    expect(reloaded.getSubject()).toContain("Beacon Certificate");
  });

  it("rejects empty beacon label", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      beacon: { ...validBeaconCertInput.beacon, label: "   " },
    })).rejects.toThrow(/beacon.*label/i);
  });

  it("rejects empty parcelRef", async () => {
    await expect(generateBeaconCertificatePdf({ ...validBeaconCertInput, parcelRef: "" })).rejects.toThrow(/parcelRef/i);
  });

  it("rejects empty markType", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      beacon: { ...validBeaconCertInput.beacon, markType: "" },
    })).rejects.toThrow(/markType/i);
  });

  it("rejects empty description", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      beacon: { ...validBeaconCertInput.beacon, description: "   " },
    })).rejects.toThrow(/description/i);
  });

  it("rejects non-finite coordinates", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      beacon: { ...validBeaconCertInput.beacon, position: { easting: NaN, northing: 9857700 } },
    })).rejects.toThrow(/finite|NaN/i);
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      beacon: { ...validBeaconCertInput.beacon, position: { easting: 100, northing: Infinity } },
    })).rejects.toThrow(/finite/i);
  });

  it("rejects invalid SRID", async () => {
    await expect(generateBeaconCertificatePdf({ ...validBeaconCertInput, srid: 0 })).rejects.toThrow(/SRID|srid/i);
    await expect(generateBeaconCertificatePdf({ ...validBeaconCertInput, srid: 999999 as unknown as number })).rejects.toThrow(/SRID|srid/i);
  });

  it("rejects bad ISK registration number", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      surveyor: { ...validBeaconCertInput.surveyor, iskRegNo: "BAD" },
    })).rejects.toThrow(/ISK|iskRegNo/i);
  });

  it("accepts LS/ pattern case-insensitive 3-5 digits", async () => {
    for (const reg of ["LS/123", "ls/9999", "Ls/12345"]) {
      const out = await generateBeaconCertificatePdf({
        ...validBeaconCertInput,
        surveyor: { ...validBeaconCertInput.surveyor, iskRegNo: reg },
      });
      expect(out.pdfBytes.length).toBeGreaterThan(1000);
    }
  });

  it("rejects empty surveyor name", async () => {
    await expect(generateBeaconCertificatePdf({
      ...validBeaconCertInput,
      surveyor: { ...validBeaconCertInput.surveyor, name: "" },
    })).rejects.toThrow(/surveyor.*name/i);
  });

  it("ownerName is optional", async () => {
    const { ownerName: _omit, ...rest } = validBeaconCertInput;
    void _omit;
    const out = await generateBeaconCertificatePdf(rest as BeaconCertificateInput);
    expect(out.pdfBytes.length).toBeGreaterThan(3000);
  });

  it("rejects empty ownerName if supplied", async () => {
    await expect(generateBeaconCertificatePdf({ ...validBeaconCertInput, ownerName: "   " })).rejects.toThrow(/ownerName/i);
  });

  it("PDF metadata strings are ASCII-only", async () => {
    const out = await generateBeaconCertificatePdf(validBeaconCertInput);
    const reloaded = await PDFDocument.load(out.pdfBytes);
    const title = reloaded.getTitle() ?? "";
    const author = reloaded.getAuthor() ?? "";
    const subject = reloaded.getSubject() ?? "";
    for (const s of [title, author, subject]) {
      for (let i = 0; i < s.length; i++) expect(s.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("handles different mark types (Stone, Iron pin, Pipe)", async () => {
    for (const markType of ["Stone", "Iron pin", "Pipe", "Concrete pillar"]) {
      const out = await generateBeaconCertificatePdf({
        ...validBeaconCertInput,
        beacon: { ...validBeaconCertInput.beacon, markType },
      });
      expect(out.pdfBytes.length).toBeGreaterThan(2000);
    }
  });
});
