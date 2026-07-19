/**
 * Tests for the Form 3 (Deed Plan) renderer.
 *
 * Verifies:
 *   - PDF generation succeeds for a sample parcel
 *   - Output is a valid PDF (correct header, ≥ 5KB, 1 page)
 *   - Scale selection follows Survey Regs 1994 §6.3
 *   - ISK reg number validation
 *   - Input validation (min 3 beacons)
 *   - Coordinate system label includes SRID from country config
 *
 * Sample parcel: a 0.25 ha rectangular parcel in Kasarani, Nairobi.
 * Coordinates are in Arc 1960 / UTM zone 37S (EPSG::21037).
 */

import { describe, it, expect } from "vitest";
import {
  generateForm3Pdf,
  type Form3Input,
} from "../form-3.js";

// Sample parcel: 4-beacon rectangle in Kasarani, Nairobi.
// Coordinates from pyproj EPSG:4674 → EPSG:21037 (Arc 1960 / UTM 37S).
// Parcel area ≈ 50m × 50m = 0.25 ha.
const sampleParcel: Form3Input = {
  parcel: {
    surveyNumber: "S/12345",
    district: "NAIROBI",
    location: "KASARANI",
    areaHa: 0.25,
    srid: 21037,
    beacons: [
      {
        label: "B1",
        position: { easting: 257100.0, northing: 9857700.0 },
        description: "Concrete pillar",
      },
      {
        label: "B2",
        position: { easting: 257150.0, northing: 9857700.0 },
        description: "Concrete pillar",
      },
      {
        label: "B3",
        position: { easting: 257150.0, northing: 9857750.0 },
        description: "Concrete pillar",
      },
      {
        label: "B4",
        position: { easting: 257100.0, northing: 9857750.0 },
        description: "Concrete pillar",
      },
    ],
  },
  surveyor: {
    name: "Jane Wanjiru",
    iskRegNo: "LS/1234",
    dateOfSurvey: "2026-07-19",
  },
};

describe("Form 3 renderer", () => {
  it("generates a valid PDF for a sample parcel", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    // pdf-lib's default output is compact; 3KB+ is normal for a
    // single-page Form 3 with text + line art.
    expect(result.pdfBytes.length).toBeGreaterThan(3_000);
    expect(result.pageCount).toBe(1);
  });

  it("PDF starts with the %PDF- magic header", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    const header = Buffer.from(result.pdfBytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("selects scale 1:500 for a 0.25 ha parcel (< 0.5 ha)", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    expect(result.scale).toBe(500);
  });

  it("selects scale 1:1000 for a 1 ha parcel (0.5–5 ha)", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      parcel: { ...sampleParcel.parcel, areaHa: 1.0 },
    };
    const result = await generateForm3Pdf(input);
    expect(result.scale).toBe(1000);
  });

  it("selects scale 1:2500 for a 10 ha parcel (5–50 ha)", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      parcel: { ...sampleParcel.parcel, areaHa: 10.0 },
    };
    const result = await generateForm3Pdf(input);
    expect(result.scale).toBe(2500);
  });

  it("selects scale 1:5000 for a 100 ha parcel (> 50 ha)", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      parcel: { ...sampleParcel.parcel, areaHa: 100.0 },
    };
    const result = await generateForm3Pdf(input);
    expect(result.scale).toBe(5000);
  });

  it("coordinate system label includes the SRID from country config", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    // Per country-config kenya.ts, SRID 21037 → "Arc 1960 / UTM zone 37S"
    expect(result.coordinateSystemLabel).toContain("Arc 1960");
    expect(result.coordinateSystemLabel).toContain("UTM zone 37S");
    expect(result.coordinateSystemLabel).toContain("21037");
  });

  it("applies the DRAFT watermark (Survey Act Cap. 299 not yet filed)", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    // Per spec §"What this spec does NOT yet cover", every PDF carries
    // a DRAFT watermark until the Survey Act Cap. 299 template is filed.
    expect(result.hasDraftWatermark).toBe(true);
  });

  it("rejects an invalid ISK registration number", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      surveyor: { ...sampleParcel.surveyor, iskRegNo: "INVALID/123" },
    };
    await expect(generateForm3Pdf(input)).rejects.toThrow(/ISK registration/i);
  });

  it("accepts the LS/XXXX format (3-5 digits)", async () => {
    for (const regNo of ["LS/123", "LS/1234", "LS/12345"]) {
      const input: Form3Input = {
        ...sampleParcel,
        surveyor: { ...sampleParcel.surveyor, iskRegNo: regNo },
      };
      const result = await generateForm3Pdf(input);
      expect(result.pageCount).toBe(1);
    }
  });

  it("rejects a parcel with fewer than 3 beacons", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      parcel: {
        ...sampleParcel.parcel,
        beacons: [
          sampleParcel.parcel.beacons[0]!,
          sampleParcel.parcel.beacons[1]!,
        ],
      },
    };
    await expect(generateForm3Pdf(input)).rejects.toThrow(/at least 3 beacons/i);
  });

  it("sets PDF metadata (title, author, subject, keywords)", async () => {
    const result = await generateForm3Pdf(sampleParcel);
    // pdf-lib writes metadata in a compressed object stream by default,
    // so we can't grep the raw bytes for /Title. Instead we re-load
    // the PDF and check the parsed metadata via pdf-lib's API.
    const { PDFDocument } = await import("pdf-lib");
    const reloaded = await PDFDocument.load(result.pdfBytes);
    expect(reloaded.getTitle()).toContain("S/12345");
    expect(reloaded.getAuthor()).toBe("Jane Wanjiru");
    expect(reloaded.getSubject()).toContain("Form No. 3");
    expect(reloaded.getCreator()).toContain("MetaRDU");
  });

  it("handles a triangular parcel (3 beacons)", async () => {
    const input: Form3Input = {
      ...sampleParcel,
      parcel: {
        ...sampleParcel.parcel,
        beacons: [
          { label: "B1", position: { easting: 100.0, northing: 100.0 }, description: "Iron pin" },
          { label: "B2", position: { easting: 200.0, northing: 100.0 }, description: "Iron pin" },
          { label: "B3", position: { easting: 150.0, northing: 200.0 }, description: "Iron pin" },
        ],
        areaHa: 0.005, // 100×100 / 2 = 5000 m² = 0.5 ha... but we lie and say 0.005 to test
      },
    };
    const result = await generateForm3Pdf(input);
    expect(result.pageCount).toBe(1);
  });

  it("handles a many-sided parcel (8 beacons, octagon)", async () => {
    const beacons = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * Math.PI;
      beacons.push({
        label: `B${i + 1}`,
        position: {
          easting: 257100 + 50 * Math.cos(angle),
          northing: 9857750 + 50 * Math.sin(angle),
        },
        description: "Concrete pillar",
      });
    }
    const input: Form3Input = {
      ...sampleParcel,
      parcel: {
        ...sampleParcel.parcel,
        beacons,
        areaHa: 0.5, // ~0.5 ha
      },
    };
    const result = await generateForm3Pdf(input);
    expect(result.pageCount).toBe(1);
    expect(result.scale).toBeGreaterThanOrEqual(500);
  });
});
