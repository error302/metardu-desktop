/**
 * Tests for the LULC (Land Use Land Cover) workflow module.
 */

import { describe, it, expect } from "vitest";
import {
  ESRIC_LULC_CLASSES,
  ESRIC_DEFAULT_RECLASS,
  importRaster,
  clipRaster,
  reclassifyValue,
  reclassifyRaster,
  calculateClassAreas,
  generateBarChartSvg,
  generatePieChartSvg,
  generatePrintLayoutSvg,
  runLulcWorkflow,
  type RasterDataset,
  type ReclassifyMapping,
} from "../lulc.js";

describe("ESRIC_LULC_CLASSES", () => {
  it("should have 11 classes (0=No Data + 1-10)", () => {
    expect(ESRIC_LULC_CLASSES.length).toBe(11);
  });

  it("every class should have id, name, color, and description", () => {
    for (const cls of ESRIC_LULC_CLASSES) {
      expect(cls.id).toBeGreaterThanOrEqual(0);
      expect(cls.name).toBeTruthy();
      expect(cls.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(cls.description).toBeTruthy();
    }
  });

  it("class IDs should be unique and sequential (0-10)", () => {
    const ids = ESRIC_LULC_CLASSES.map(c => c.id);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("importRaster", () => {
  it("should create a RasterDataset with correct metadata", () => {
    const raster = importRaster(
      "/data/landcover.tif",
      {
        width: 1000,
        height: 800,
        bands: 1,
        dataType: "uint8",
        geoTransform: [36.8, 0.0001, 0, -1.28, 0, -0.0001],
        crsEpsg: 4326,
        noDataValue: 0,
      },
      "Esri Living Atlas"
    );
    expect(raster.path).toBe("/data/landcover.tif");
    expect(raster.width).toBe(1000);
    expect(raster.source).toBe("Esri Living Atlas");
  });
});

describe("clipRaster", () => {
  it("should generate a gdalwarp command with cutline", () => {
    const raster: RasterDataset = {
      path: "/data/input.tif",
      width: 1000, height: 800, bands: 1, dataType: "uint8",
      geoTransform: [36.8, 0.0001, 0, -1.28, 0, -0.0001],
      crsEpsg: 4326, noDataValue: 0, source: "test",
    };
    const result = clipRaster({
      raster,
      boundary: [
        { lat: -1.28, lng: 36.81 },
        { lat: -1.27, lng: 36.81 },
        { lat: -1.27, lng: 36.82 },
        { lat: -1.28, lng: 36.82 },
        { lat: -1.28, lng: 36.81 },
      ],
      outputPath: "/data/clipped.tif",
    });
    expect(result.gdalCommand).toContain("gdalwarp");
    expect(result.gdalCommand).toContain("-cutline");
    expect(result.gdalCommand).toContain("/data/input.tif");
    expect(result.gdalCommand).toContain("/data/clipped.tif");
  });
});

describe("reclassifyValue", () => {
  it("should return the same value for identity mapping (Esri default)", () => {
    expect(reclassifyValue(1, ESRIC_DEFAULT_RECLASS)).toBe(1);
    expect(reclassifyValue(7, ESRIC_DEFAULT_RECLASS)).toBe(7);
  });

  it("should return 0 for values outside all mapping ranges", () => {
    expect(reclassifyValue(99, ESRIC_DEFAULT_RECLASS)).toBe(0);
  });

  it("should handle custom mapping (0-50 → class 2, 51-100 → class 7)", () => {
    const custom: ReclassifyMapping[] = [
      { from: 0, to: 50, targetClass: 2 },
      { from: 51, to: 100, targetClass: 7 },
      { from: 101, to: 150, targetClass: 8 },
    ];
    expect(reclassifyValue(25, custom)).toBe(2);
    expect(reclassifyValue(75, custom)).toBe(7);
    expect(reclassifyValue(125, custom)).toBe(8);
    expect(reclassifyValue(200, custom)).toBe(0);
  });
});

describe("reclassifyRaster", () => {
  it("should reclassify an array of pixels", () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]);
    const result = reclassifyRaster(pixels, ESRIC_DEFAULT_RECLASS);
    expect(result[0]).toBe(1);
    expect(result[6]).toBe(7);
    expect(result[10]).toBe(0); // 99 is outside mapping → 0
  });
});

describe("calculateClassAreas", () => {
  it("should calculate correct areas for a known pixel distribution", () => {
    // 100 pixels: 50 Water (1), 30 Trees (2), 20 Built Area (7)
    const pixels = new Uint8Array(100);
    for (let i = 0; i < 50; i++) pixels[i] = 1;
    for (let i = 50; i < 80; i++) pixels[i] = 2;
    for (let i = 80; i < 100; i++) pixels[i] = 7;

    // Pixel size: 10m × 10m = 100m² per pixel
    const stats = calculateClassAreas(pixels, 10);

    expect(stats.length).toBe(3); // 3 classes present

    // Water: 50 pixels × 100m² = 5000m² = 0.005km² = 0.5ha = 50%
    expect(stats[0]!.classId).toBe(1);
    expect(stats[0]!.pixelCount).toBe(50);
    expect(stats[0]!.areaSqKm).toBeCloseTo(0.005, 5);
    expect(stats[0]!.areaHectares).toBeCloseTo(0.5, 3);
    expect(stats[0]!.percentage).toBeCloseTo(50, 1);

    // Trees: 30 pixels = 30%
    expect(stats[1]!.classId).toBe(2);
    expect(stats[1]!.percentage).toBeCloseTo(30, 1);

    // Built Area: 20 pixels = 20%
    expect(stats[2]!.classId).toBe(7);
    expect(stats[2]!.percentage).toBeCloseTo(20, 1);
  });

  it("should sort by area descending", () => {
    const pixels = new Uint8Array([7, 7, 7, 1, 1, 2]);
    const stats = calculateClassAreas(pixels, 1);
    expect(stats[0]!.classId).toBe(7); // 3 pixels
    expect(stats[1]!.classId).toBe(1); // 2 pixels
    expect(stats[2]!.classId).toBe(2); // 1 pixel
  });

  it("should handle all-zero pixels (no-data only)", () => {
    const pixels = new Uint8Array([0, 0, 0, 0]);
    const stats = calculateClassAreas(pixels, 10);
    // All classes should have 0 pixels (class 0 is excluded from stats)
    for (const s of stats) {
      expect(s.pixelCount).toBe(0);
      expect(s.percentage).toBe(0);
    }
  });
});

describe("generateBarChartSvg", () => {
  it("should generate a valid SVG with correct colors", () => {
    const stats = [
      { classId: 1, className: "Water", color: "#419BDF", pixelCount: 50, areaSqKm: 0.5, areaHectares: 50, percentage: 50 },
      { classId: 7, className: "Built Area", color: "#C4281B", pixelCount: 50, areaSqKm: 0.5, areaHectares: 50, percentage: 50 },
    ];
    const svg = generateBarChartSvg(stats);
    expect(svg).toContain("<svg");
    expect(svg).toContain("#419BDF"); // Water color
    expect(svg).toContain("#C4281B"); // Built Area color
    expect(svg).toContain("0.50"); // Area value
  });
});

describe("generatePieChartSvg", () => {
  it("should generate a valid SVG with pie slices", () => {
    const stats = [
      { classId: 1, className: "Water", color: "#419BDF", pixelCount: 50, areaSqKm: 0.5, areaHectares: 50, percentage: 50 },
      { classId: 2, className: "Trees", color: "#397D49", pixelCount: 30, areaSqKm: 0.3, areaHectares: 30, percentage: 30 },
      { classId: 7, className: "Built Area", color: "#C4281B", pixelCount: 20, areaSqKm: 0.2, areaHectares: 20, percentage: 20 },
    ];
    const svg = generatePieChartSvg(stats);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path"); // Pie slice paths
    expect(svg).toContain("50.0%"); // Percentage label
  });
});

describe("generatePrintLayoutSvg", () => {
  it("should generate an A3 landscape print layout", () => {
    const stats = [
      { classId: 1, className: "Water", color: "#419BDF", pixelCount: 50, areaSqKm: 0.5, areaHectares: 50, percentage: 50 },
      { classId: 7, className: "Built Area", color: "#C4281B", pixelCount: 50, areaSqKm: 0.5, areaHectares: 50, percentage: 50 },
    ];
    const svg = generatePrintLayoutSvg({
      mapSvg: "<svg><!-- map --></svg>",
      stats,
      barChartSvg: "<svg><!-- bar --></svg>",
      pieChartSvg: "<svg><!-- pie --></svg>",
      title: "LULC Map — Nairobi",
      surveyorName: "Test Surveyor",
      scaleDenominator: 50000,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("LULC Map — Nairobi");
    expect(svg).toContain("Test Surveyor");
    expect(svg).toContain("1:50000");
    // A3 landscape: 420mm × 297mm
    expect(svg).toContain("420mm");
    expect(svg).toContain("297mm");
  });
});

describe("runLulcWorkflow", () => {
  it("should run the complete 11-step workflow", () => {
    // Create test data: 1000 pixels with mixed LULC classes
    const pixels = new Uint8Array(1000);
    for (let i = 0; i < 400; i++) pixels[i] = 2;       // Trees (40%)
    for (let i = 400; i < 600; i++) pixels[i] = 5;     // Crops (20%)
    for (let i = 600; i < 800; i++) pixels[i] = 7;     // Built Area (20%)
    for (let i = 800; i < 1000; i++) pixels[i] = 8;    // Bare Ground (20%)

    const result = runLulcWorkflow({
      rasterPath: "/data/landcover.tif",
      rasterMetadata: {
        width: 50, height: 20, bands: 1, dataType: "uint8",
        geoTransform: [36.8, 10, 0, -1.28, 0, -10], // 10m pixels
        crsEpsg: 32737, noDataValue: 0,
      },
      pixels,
      boundary: [
        { lat: -1.28, lng: 36.81 },
        { lat: -1.27, lng: 36.81 },
        { lat: -1.27, lng: 36.82 },
        { lat: -1.28, lng: 36.82 },
        { lat: -1.28, lng: 36.81 },
      ],
      outputDir: "/tmp/lulc_output",
      studyAreaName: "Nairobi Test Area",
      surveyorName: "Test Surveyor",
      scaleDenominator: 25000,
    });

    // Step 1: Raster imported
    expect(result.raster.path).toBe("/data/landcover.tif");

    // Step 2: Clip command generated
    expect(result.clipCommand).toContain("gdalwarp");

    // Step 3: Pixels reclassified
    expect(result.reclassifiedPixels.length).toBe(1000);

    // Step 4: Classes applied
    expect(result.classes.length).toBe(11);

    // Step 5: Area statistics computed
    expect(result.stats.length).toBeGreaterThan(0);
    expect(result.stats[0]!.className).toBeTruthy();

    // Step 8: Charts generated
    expect(result.barChartSvg).toContain("<svg");
    expect(result.pieChartSvg).toContain("<svg");

    // Step 10: Print layout generated
    expect(result.printLayoutSvg).toContain("<svg");
    expect(result.printLayoutSvg).toContain("Nairobi Test Area");

    // Verify area percentages sum to ~100%
    const totalPct = result.stats.reduce((sum, s) => sum + s.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });
});
