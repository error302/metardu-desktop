/**
 * Tests for modules 5-8 and 12: Leveling, Road Alignment, Feature Coding,
 * Cross-Section, As-built Comparison.
 */

import { describe, it, expect } from "vitest";
import {
  computeRiseAndFall,
  computeHeightOfCollimation,
  twoPegTest,
  parseLevelCsv,
  adjustLevelNetwork,
} from "../leveling.js";
import {
  centerlineAtChainage,
  offsetPoint,
  generateStakeoutTable,
  elevationAtChainage,
} from "../road-alignment.js";
import {
  FEATURE_CODES,
  FEATURE_CODE_MAP,
  fieldToFinish,
  generateDxfLayerTable,
  type CodedPoint,
} from "../feature-coding.js";
import {
  computeSectionArea,
  recordCrossSection,
  applyDesignTemplate,
  endAreaVolume,
  totalEarthworkVolume,
  renderCrossSectionSvg,
} from "../cross-section.js";
import {
  comparePoints,
  renderComparisonSvg,
  DEFAULT_COMPARISON_TOLERANCE,
} from "../as-built.js";

// ═══ Leveling ═══

describe("Leveling", () => {
  const observations = [
    { station: "BM1", foresightStation: "TP1", backsight: 1.524, foresight: 0.876, backsightDistance: 30, foresightDistance: 30 },
    { station: "TP1", foresightStation: "TP2", backsight: 2.134, foresight: 1.567, backsightDistance: 35, foresightDistance: 35 },
    { station: "TP2", foresightStation: "BM2", backsight: 0.987, foresight: 1.234, backsightDistance: 25, foresightDistance: 25 },
  ];

  it("should compute rise and fall", () => {
    const line = computeRiseAndFall(observations, "BM1", 1700.000, 1699.854);
    expect(line.setupCount).toBe(3);
    expect(line.method).toBe("rise_fall");
    expect(line.adjustedPoints.length).toBe(4); // BM1 + 3 TPs/BMs
    expect(line.totalLength).toBe(180); // 30+30+35+35+25+25
  });

  it("should compute misclosure for closed loop", () => {
    const line = computeRiseAndFall(observations, "BM1", 1700.000, 1700.000);
    expect(line.misclosure).not.toBe(0); // Should have misclosure
    expect(line.tolerance).toBeCloseTo(10 * Math.sqrt(0.18), 2); // 10 × √0.18
  });

  it("should compute height of collimation", () => {
    const line = computeHeightOfCollimation(observations, "BM1", 1700.000);
    expect(line.method).toBe("height_of_collimation");
    expect(line.collimations).toBeDefined();
    expect(line.collimations!.length).toBe(3);
  });

  it("should apply corrections for closed loop", () => {
    const line = computeRiseAndFall(observations, "BM1", 1700.000, 1700.000);
    // After adjustment, first and last points should be same elevation
    expect(line.adjustedPoints[0]!.elevation).toBeCloseTo(line.adjustedPoints[line.adjustedPoints.length - 1]!.elevation, 2);
  });

  it("should perform two-peg test", () => {
    const result = twoPegTest({
      distance: 60,
      reading1A: 1.500,
      reading1B: 1.200,
      reading2A: 0.300,
      reading2B: 0.000,
    });
    expect(result.trueDiff).toBeCloseTo(0.300, 3);
    expect(result.apparentDiffFar).toBeCloseTo(-0.300, 3);
    expect(result.error).toBeCloseTo(-600, 0); // Large error (simulated bad readings)
  });

  it("should parse level CSV", () => {
    const csv = "station,fs_station,bs,fs,bs_dist,fs_dist\nBM1,TP1,1.524,0.876,30,30\nTP1,TP2,2.134,1.567,35,35";
    const obs = parseLevelCsv(csv);
    expect(obs.length).toBe(2);
    expect(obs[0]!.backsight).toBe(1.524);
    expect(obs[1]!.foresight).toBe(1.567);
  });

  it("should adjust level network", () => {
    const network = adjustLevelNetwork(observations, "BM1", 1700.000, 1700.000);
    expect(network.lines.length).toBe(1);
    expect(network.adjustedElevations.size).toBe(4);
  });
});

// ═══ Road Alignment ═══

describe("Road Alignment", () => {
  const elements = [
    { type: "straight" as const, startChainage: 0, endChainage: 100, bearing: 0 },
    { type: "circular" as const, startChainage: 100, endChainage: 200, radius: 500, deflection: 10, bearingIn: 0 },
    { type: "straight" as const, startChainage: 200, endChainage: 300, bearing: 10 },
  ];

  it("should compute centerline on straight", () => {
    const cl = centerlineAtChainage(elements, 1000, 2000, 0, 50);
    expect(cl).not.toBeNull();
    expect(cl!.northing).toBeCloseTo(2050, 1);
    expect(cl!.element).toBe("straight");
  });

  it("should compute centerline on circular curve", () => {
    const cl = centerlineAtChainage(elements, 1000, 2000, 0, 150);
    expect(cl).not.toBeNull();
    expect(cl!.element).toBe("circular");
    expect(cl!.curvature).toBeCloseTo(1 / 500, 5);
  });

  it("should compute offset point", () => {
    const cl = centerlineAtChainage(elements, 1000, 2000, 0, 50)!;
    const pt = offsetPoint(cl, 7.5); // 7.5m right
    expect(pt.offset).toBe(7.5);
    expect(pt.easting).toBeCloseTo(1007.5, 1); // Due east
  });

  it("should generate stakeout table", () => {
    const table = generateStakeoutTable(
      elements, 1000, 2000, 0, 0, 300, 50, [-7.5, 0, 7.5]
    );
    expect(table.length).toBeGreaterThan(5);
    expect(table[0]!.offset).toBe(-7.5);
    expect(table.some(p => p.offset === 0)).toBe(true);
  });

  it("should compute vertical alignment elevation", () => {
    const vAlign = [
      { type: "grade" as const, startChainage: 0, endChainage: 100, startElevation: 1700, grade1: 1.0 },
    ];
    const elev = elevationAtChainage(vAlign, 50);
    expect(elev).toBeCloseTo(1700.5, 2); // 1% grade over 50m = 0.5m rise
  });
});

// ═══ Feature Coding ═══

describe("Feature Coding", () => {
  it("should have 44+ feature codes", () => {
    expect(FEATURE_CODES.length).toBeGreaterThanOrEqual(44);
  });

  it("should find code by ID", () => {
    const code = FEATURE_CODE_MAP["BLD"];
    expect(code).toBeDefined();
    expect(code!.geometry).toBe("polygon");
    expect(code!.autoConnect).toBe(true);
  });

  it("should process point features", () => {
    const points: CodedPoint[] = [
      { pointNumber: "1", easting: 1000, northing: 2000, elevation: 1700, code: "TREE" },
      { pointNumber: "2", easting: 1010, northing: 2010, elevation: 1701, code: "TREE" },
    ];
    const features = fieldToFinish(points);
    expect(features.length).toBe(2); // Two separate tree points
  });

  it("should connect line features", () => {
    const points: CodedPoint[] = [
      { pointNumber: "1", easting: 1000, northing: 2000, elevation: 1700, code: "FL" },
      { pointNumber: "2", easting: 1010, northing: 2000, elevation: 1700, code: "FL" },
      { pointNumber: "3", easting: 1020, northing: 2000, elevation: 1700, code: "FL" },
    ];
    const features = fieldToFinish(points);
    expect(features.length).toBe(1); // One connected line
    expect(features[0]!.coordinates.length).toBe(3);
  });

  it("should generate DXF layer table", () => {
    const table = generateDxfLayerTable();
    expect(table).toContain("LAYER");
    expect(table).toContain("CONTROL-POINTS");
    expect(table).toContain("BUILDING-OUTLINE");
  });
});

// ═══ Cross-Section ═══

describe("Cross-Section", () => {
  it("should record a cross-section", () => {
    const section = recordCrossSection(250, 1700, [
      { offset: -7.5, elevation: 1699.5 },
      { offset: 0, elevation: 1700.0 },
      { offset: 7.5, elevation: 1699.8 },
    ]);
    expect(section.chainage).toBe(250);
    expect(section.points.length).toBe(3);
    expect(section.points[0]!.offset).toBe(-7.5); // Sorted
  });

  it("should apply design template and compute cut/fill", () => {
    const section = recordCrossSection(250, 1700, [
      { offset: -7.5, elevation: 1699.5 },
      { offset: 0, elevation: 1700.0 },
      { offset: 7.5, elevation: 1699.8 },
    ]);
    const template = [
      { offset: -7.5, elevation: 1700.2 },
      { offset: 0, elevation: 1700.5 },
      { offset: 7.5, elevation: 1700.2 },
    ];
    const result = applyDesignTemplate(section, template);
    expect(result.points[0]!.designElevation).toBe(1700.2);
    expect(result.points[0]!.cutFill).toBeCloseTo(0.7, 1); // fill 0.7m
    expect(result.area).toBeDefined();
  });

  it("should compute end-area volume", () => {
    const section1: any = { chainage: 0, centerlineElevation: 1700, points: [], area: { cut: 5, fill: 2, net: 3 } };
    const section2: any = { chainage: 50, centerlineElevation: 1701, points: [], area: { cut: 3, fill: 4, net: -1 } };
    const vol = endAreaVolume(section1, section2);
    expect(vol.cutVolume).toBeCloseTo(200, 0); // (5+3)/2 × 50 = 200
    expect(vol.fillVolume).toBeCloseTo(150, 0); // (2+4)/2 × 50 = 150
  });

  it("should compute total earthwork volume", () => {
    const sections = [
      { chainage: 0, centerlineElevation: 1700, points: [], area: { cut: 5, fill: 2, net: 3 } } as any,
      { chainage: 50, centerlineElevation: 1701, points: [], area: { cut: 3, fill: 4, net: -1 } } as any,
      { chainage: 100, centerlineElevation: 1702, points: [], area: { cut: 2, fill: 1, net: 1 } } as any,
    ];
    const result = totalEarthworkVolume(sections);
    expect(result.totalCut).toBeCloseTo(325, 0); // 200 + 125
    expect(result.totalFill).toBeCloseTo(275, 0); // 150 + 25
    expect(result.segments.length).toBe(2);
  });

  it("should generate cross-section SVG", () => {
    const section = recordCrossSection(250, 1700, [
      { offset: -7.5, elevation: 1699.5 },
      { offset: 0, elevation: 1700.0 },
      { offset: 7.5, elevation: 1699.8 },
    ]);
    const svg = renderCrossSectionSvg(section);
    expect(svg).toContain("<svg");
    expect(svg).toContain("250.000");
  });
});

// ═══ As-built Comparison ═══

describe("As-built Comparison", () => {
  const design = [
    { id: "P1", easting: 1000.000, northing: 2000.000, elevation: 1700.000 },
    { id: "P2", easting: 1010.000, northing: 2000.000, elevation: 1700.000 },
    { id: "P3", easting: 1020.000, northing: 2000.000, elevation: 1700.000 },
  ];

  const surveyed = [
    { id: "P1", easting: 1000.005, northing: 2000.003, elevation: 1700.002 }, // OK (within 20mm)
    { id: "P2", easting: 1010.015, northing: 2000.010, elevation: 1700.008 }, // Warning
    { id: "P3", easting: 1020.030, northing: 2000.020, elevation: 1700.025 }, // Fail
  ];

  it("should compare points and compute deltas", () => {
    const summary = comparePoints(design, surveyed, { horizontal: 20, vertical: 20, warningThreshold: 0.5 });
    expect(summary.totalPoints).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBeGreaterThanOrEqual(0);
  });

  it("should compute RMS", () => {
    const summary = comparePoints(design, surveyed);
    expect(summary.horizontalRms).toBeGreaterThan(0);
    expect(summary.verticalRms).toBeGreaterThan(0);
  });

  it("should sort results by worst first", () => {
    const summary = comparePoints(design, surveyed);
    expect(summary.sortedResults[0]!.horizontalDiff).toBeGreaterThanOrEqual(
      summary.sortedResults[summary.sortedResults.length - 1]!.horizontalDiff
    );
  });

  it("should find max difference point", () => {
    const summary = comparePoints(design, surveyed);
    expect(summary.maxHorizontalPoint).toBe("P3"); // Worst point
    expect(summary.maxHorizontal).toBeGreaterThan(20); // Exceeds 20mm
  });

  it("should generate comparison SVG", () => {
    const summary = comparePoints(design, surveyed);
    const svg = renderComparisonSvg(summary, DEFAULT_COMPARISON_TOLERANCE);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Pass");
    expect(svg).toContain("Warning");
    expect(svg).toContain("Fail");
  });

  it("should handle 100% pass rate", () => {
    const perfect = [
      { id: "P1", easting: 1000.001, northing: 2000.001, elevation: 1700.001 },
    ];
    const summary = comparePoints([design[0]!], perfect);
    expect(summary.passRate).toBe(100);
    expect(summary.failed).toBe(0);
  });
});
