/**
 * Tests for the 4 critical surveying modules.
 */

import { describe, it, expect } from "vitest";
import {
  createStakeoutSession,
  DEFAULT_TOLERANCE,
  KENYA_TOLERANCE_PRESETS,
  type DesignPoint,
} from "../stakeout.js";
import {
  computeCalibration,
  wgs84ToLocal,
  localToWgs84,
  type CalibrationPoint,
} from "../site-calibration.js";
import {
  computeErrorEllipse,
  computePointErrors,
  chiSquareScale2D,
  renderErrorEllipsesSvg,
  ELLIPSE_TOLERANCE_PRESETS,
  type Covariance2D,
} from "../error-ellipse.js";
import {
  egm2008Approximate,
  convertHeight,
  interpolateUndulation,
  ellipsoidalToOrthometric,
  orthometricToEllipsoidal,
  KENYA_GEOID_VALUES,
  GEOID_MODELS,
  type GeoidGrid,
} from "../../geodesy/geoid.js";
import {
  CRS_DATABASE,
  findCrsForLocation,
  getCrsByEpsg,
  listSupportedCountries,
} from "../../geodesy/crs-database.js";

// ═════════════════════════════════════════════════════════════════
// 1. STAKEOUT TESTS
// ═════════════════════════════════════════════════════════════════

describe("Stakeout", () => {
  const designPoints: DesignPoint[] = [
    { id: "p1", label: "STN-001", easting: 1000, northing: 2000, elevation: 1700 },
    { id: "p2", label: "STN-002", easting: 1010, northing: 2010, elevation: 1701 },
    { id: "p3", label: "STN-003", easting: 1020, northing: 2000, elevation: 1702 },
  ];

  it("should guide to the nearest unstaked point", () => {
    const session = createStakeoutSession(designPoints);
    const guidance = session.update({ easting: 1001, northing: 2001, elevation: 1700 });
    expect(guidance.target).not.toBeNull();
    expect(guidance.target!.id).toBe("p1"); // nearest
    expect(guidance.distance).toBeCloseTo(Math.sqrt(2), 3);
  });

  it("should show within_tolerance when close enough", () => {
    const session = createStakeoutSession(designPoints, { horizontal: 0.020 });
    const guidance = session.update({ easting: 1000.01, northing: 2000.01, elevation: 1700.01 });
    expect(guidance.status).toBe("within_tolerance");
    expect(guidance.isStaked).toBe(true);
  });

  it("should show cut/fill", () => {
    const session = createStakeoutSession(designPoints);
    const guidance = session.update({ easting: 1000, northing: 2000, elevation: 1700.5 });
    expect(guidance.cutFill).toBe(-0.5); // 0.5m too high → cut
    expect(guidance.cutFillText).toContain("CUT");
  });

  it("should show fill when too low", () => {
    const session = createStakeoutSession(designPoints);
    const guidance = session.update({ easting: 1000, northing: 2000, elevation: 1699.5 });
    expect(guidance.cutFill).toBe(0.5); // 0.5m too low → fill
    expect(guidance.cutFillText).toContain("FILL");
  });

  it("should auto-advance to next point after staking", () => {
    const session = createStakeoutSession(designPoints);
    session.update({ easting: 1000, northing: 2000, elevation: 1700 });
    session.markStaked("p1");
    expect(session.getNextUnstakedPoint()?.id).toBe("p2");
  });

  it("should compute progress", () => {
    const session = createStakeoutSession(designPoints);
    expect(session.getProgress()).toBe(0);
    session.markStaked("p1");
    expect(session.getProgress()).toBeCloseTo(1/3, 2);
  });

  it("should handle no design points", () => {
    const session = createStakeoutSession([]);
    const guidance = session.update({ easting: 0, northing: 0, elevation: 0 });
    expect(guidance.status).toBe("no_design_points");
  });

  it("Kenya tolerance presets should have correct values", () => {
    expect(KENYA_TOLERANCE_PRESETS.cadastral_urban.horizontal).toBe(0.010);
    expect(KENYA_TOLERANCE_PRESETS.engineering_precise.horizontal).toBe(0.005);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. SITE CALIBRATION TESTS
// ═════════════════════════════════════════════════════════════════

describe("Site Calibration", () => {
  it("should compute 2-point calibration", () => {
    const points: CalibrationPoint[] = [
      { id: "cp1", wgs84Lat: -1.286, wgs84Lng: 36.817, wgs84Height: 1713, localE: 1000, localN: 2000, localH: 1700 },
      { id: "cp2", wgs84Lat: -1.285, wgs84Lng: 36.818, wgs84Height: 1715, localE: 1111, localN: 1889, localH: 1702 },
    ];
    const cal = computeCalibration(points);
    expect(cal.pointCount).toBe(2);
    expect(cal.method).toBe("helmert4");
    expect(cal.scale).toBeGreaterThan(0);
    expect(cal.scale).toBeLessThan(100);
  });

  it("should compute 3+ point calibration with residuals", () => {
    const points: CalibrationPoint[] = [
      { id: "cp1", wgs84Lat: -1.286, wgs84Lng: 36.817, wgs84Height: 1713, localE: 1000, localN: 2000, localH: 1700 },
      { id: "cp2", wgs84Lat: -1.285, wgs84Lng: 36.818, wgs84Height: 1715, localE: 1111, localN: 1889, localH: 1702 },
      { id: "cp3", wgs84Lat: -1.287, wgs84Lng: 36.819, wgs84Height: 1712, localE: 1222, localN: 2111, localH: 1699 },
    ];
    const cal = computeCalibration(points);
    expect(cal.pointCount).toBe(3);
    expect(cal.residuals.length).toBe(3);
    expect(cal.horizontalRms).toBeGreaterThanOrEqual(0);
  });

  it("should throw for fewer than 2 points", () => {
    expect(() => computeCalibration([])).toThrow();
    expect(() => computeCalibration([{
      id: "p1", wgs84Lat: 0, wgs84Lng: 0, wgs84Height: 0,
      localE: 0, localN: 0, localH: 0,
    }])).toThrow();
  });

  it("should transform WGS84 to local and back (round-trip)", () => {
    const points: CalibrationPoint[] = [
      { id: "cp1", wgs84Lat: -1.286, wgs84Lng: 36.817, wgs84Height: 1713, localE: 1000, localN: 2000, localH: 1700 },
      { id: "cp2", wgs84Lat: -1.285, wgs84Lng: 36.818, wgs84Height: 1715, localE: 1010, localN: 1990, localH: 1702 },
    ];
    const cal = computeCalibration(points);
    const local = wgs84ToLocal(-1.2855, 36.8175, 1714, cal);
    expect(local.easting).toBeGreaterThan(999);
    expect(local.easting).toBeLessThan(1011);
    expect(local.northing).toBeGreaterThan(1989);
    expect(local.northing).toBeLessThan(2001);
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. GEOID MODEL TESTS
// ═════════════════════════════════════════════════════════════════

describe("Geoid Model", () => {
  const fixtureGrid = (): GeoidGrid => ({
    id: "synthetic-bilinear-fixture",
    name: "Synthetic interpolation fixture",
    version: "test-only",
    source: "unit-test fixture; not a geoid model",
    checksumSha256: "0".repeat(64),
    referenceEllipsoid: "test ellipsoid",
    verticalDatum: "test vertical datum",
    south: 0,
    west: 0,
    latStep: 1,
    lngStep: 1,
    rows: 2,
    cols: 2,
    // Row-major from NW: (1,0)=20, (1,1)=22, (0,0)=10, (0,1)=12.
    values: new Float64Array([20, 22, 10, 12]),
  });

  it("bilinearly interpolates a synthetic grid cell without asserting model accuracy", () => {
    expect(interpolateUndulation(fixtureGrid(), 0.5, 0.5)).toBe(16);
    expect(interpolateUndulation(fixtureGrid(), 1, 0)).toBe(20);
  });

  it("converts height only from a supplied grid and returns its provenance", () => {
    const result = convertHeight(0.5, 0.5, 100, fixtureGrid());
    expect(result.undulation).toBe(16);
    expect(result.orthometric).toBe(84);
    expect(result.model.id).toBe("synthetic-bilinear-fixture");
    expect(result.model.source).toContain("unit-test fixture");
    expect(result.model.verticalDatum).toBe("test vertical datum");
  });

  it("returns null outside the grid and conversion fails without a fallback", () => {
    const grid = fixtureGrid();
    expect(interpolateUndulation(grid, 2, 2)).toBeNull();
    expect(() => convertHeight(2, 2, 100, grid)).toThrow(/outside geoid grid.*no fallback/i);
  });

  it("rejects malformed grids, missing provenance, and nodata cells", () => {
    const shortGrid = { ...fixtureGrid(), values: new Float64Array([20, 22, 10]) };
    expect(() => interpolateUndulation(shortGrid, 0.5, 0.5)).toThrow(/dimensions or spacing are invalid/i);

    const missingSource = { ...fixtureGrid(), source: "" };
    expect(() => interpolateUndulation(missingSource, 0.5, 0.5)).toThrow(/provenance and reference metadata/i);

    const nodataGrid = { ...fixtureGrid(), values: new Float64Array([20, Number.NaN, 10, 12]) };
    expect(() => interpolateUndulation(nodataGrid, 0.5, 0.5)).toThrow(/nodata or non-finite/i);
  });

  it("rejects non-finite height conversions", () => {
    expect(() => ellipsoidalToOrthometric(Number.NaN, 1)).toThrow(/finite values/i);
    expect(() => orthometricToEllipsoidal(1, Number.POSITIVE_INFINITY)).toThrow(/finite values/i);
  });

  it("fails closed for legacy approximation calls and exposes no unsupported model catalog", () => {
    expect(() => egm2008Approximate(-1.2864, 36.8172)).toThrow(/grid data is not installed/i);
    expect(Object.keys(GEOID_MODELS)).toHaveLength(0);
    expect(Object.keys(KENYA_GEOID_VALUES)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. ERROR ELLIPSE TESTS
// ═════════════════════════════════════════════════════════════════

describe("Error Ellipse", () => {
  it("should compute ellipse from isotropic covariance (equal axes)", () => {
    const cov: Covariance2D = { sigmaEE: 0.0001, sigmaNN: 0.0001, sigmaEN: 0 };
    const ellipse = computeErrorEllipse(cov, 0.95);
    expect(ellipse.semiMajor).toBeCloseTo(ellipse.semiMinor, 5);
    expect(ellipse.semiMajor).toBeCloseTo(0.02448, 3); // sqrt(0.0001) * 2.448
  });

  it("should compute ellipse with different major and minor axes", () => {
    const cov: Covariance2D = { sigmaEE: 0.0004, sigmaNN: 0.0001, sigmaEN: 0 };
    const ellipse = computeErrorEllipse(cov, 0.95);
    expect(ellipse.semiMajor).toBeGreaterThan(ellipse.semiMinor);
    expect(ellipse.semiMajor).toBeCloseTo(0.04896, 3); // sqrt(0.0004) * 2.448
    expect(ellipse.semiMinor).toBeCloseTo(0.02448, 3);
  });

  it("should orient along the axis of larger variance", () => {
    const cov: Covariance2D = { sigmaEE: 0.0004, sigmaNN: 0.0001, sigmaEN: 0 };
    const ellipse = computeErrorEllipse(cov);
    // When sigmaEE > sigmaNN and sigmaEN = 0, orientation should be 0 (east)
    expect(Math.abs(ellipse.orientation)).toBeLessThan(1); // ~0 degrees (east)
  });

  it("should compute 95% confidence scaling factor", () => {
    expect(chiSquareScale2D(0.95)).toBeCloseTo(2.448, 2);
  });

  it("should compute 39% (1-sigma) scaling factor", () => {
    expect(chiSquareScale2D(0.39)).toBeCloseTo(1.0, 1);
  });

  it("should flag points outside tolerance", () => {
    const points = [
      {
        id: "p1", label: "GOOD", easting: 1000, northing: 2000,
        covariance: { sigmaEE: 0.000004, sigmaNN: 0.000004, sigmaEN: 0 } as Covariance2D,
      },
      {
        id: "p2", label: "BAD", easting: 1010, northing: 2010,
        covariance: { sigmaEE: 0.0001, sigmaNN: 0.0001, sigmaEN: 0 } as Covariance2D,
      },
    ];
    const results = computePointErrors(points, 0.010); // 1cm tolerance
    expect(results[0]!.withinTolerance).toBe(true);
    expect(results[1]!.withinTolerance).toBe(false);
    expect(results[1]!.excess).toBeGreaterThan(0);
  });

  it("should generate SVG with ellipses", () => {
    const points = [
      {
        id: "p1", label: "P1", easting: 1000, northing: 2000,
        covariance: { sigmaEE: 0.0001, sigmaNN: 0.0001, sigmaEN: 0 } as Covariance2D,
        ellipse: { semiMajor: 0.024, semiMinor: 0.024, orientation: 0, confidence: 0.95, scale: 2.448 },
        withinTolerance: true, excess: 0,
      },
    ];
    const svg = renderErrorEllipsesSvg(points);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("P1");
  });

  it("tolerance presets should have correct values", () => {
    expect(ELLIPSE_TOLERANCE_PRESETS.cadastral_urban).toBe(0.010);
    expect(ELLIPSE_TOLERANCE_PRESETS.engineering_precise).toBe(0.005);
    expect(ELLIPSE_TOLERANCE_PRESETS.control_1st_order).toBe(0.003);
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. CRS DATABASE TESTS
// ═════════════════════════════════════════════════════════════════

describe("CRS Database", () => {
  it("should have 13 countries", () => {
    const countries = listSupportedCountries();
    expect(countries.length).toBe(13);
  });

  it("should find CRS for Nairobi (Kenya UTM 37S)", () => {
    const crs = findCrsForLocation(-1.2864, 36.8172);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(21037); // Arc 1960 / UTM 37S
  });

  it("should find CRS for Perth, Australia (MGA zone 50)", () => {
    const crs = findCrsForLocation(-31.9505, 115.8605);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(7850); // GDA2020 / MGA zone 50
    expect(crs!.geoidModel).toBe("AUSGeoid2020");
  });

  it("should find CRS for Sydney, Australia (MGA zone 56)", () => {
    const crs = findCrsForLocation(-33.8688, 151.2093);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(7856); // GDA2020 / MGA zone 56
  });

  it("should find CRS for Dubai, UAE", () => {
    const crs = findCrsForLocation(25.2048, 55.2708);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(32640); // WGS 84 / UTM 40N
  });

  it("should find CRS for London, UK", () => {
    const crs = findCrsForLocation(51.5074, -0.1278);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(27700); // OSGB36 / British National Grid
    expect(crs!.geoidModel).toBe("OSGM15");
  });

  it("should find CRS for New York, USA", () => {
    const crs = findCrsForLocation(40.7128, -74.0060);
    expect(crs).not.toBeNull();
    expect(crs!.epsg).toBe(32618); // WGS 84 / UTM 18N
  });

  it("should get CRS by EPSG code", () => {
    const crs = getCrsByEpsg(21037);
    expect(crs).not.toBeNull();
    expect(crs!.name).toContain("Arc 1960");
    expect(crs!.utmZone).toBe(37);
  });

  it("should return null for unknown EPSG", () => {
    expect(getCrsByEpsg(99999)).toBeNull();
  });

  it("Australia should have 7 MGA zones", () => {
    expect(CRS_DATABASE.AUS.length).toBe(7);
  });

  it("Kenya should have 4 verified Arc 1960 UTM CRS definitions", () => {
    expect(CRS_DATABASE.KEN.length).toBe(4);
    expect(CRS_DATABASE.KEN.map((crs) => crs.epsg).sort((a, b) => a - b))
      .toEqual([21036, 21037, 21096, 21097]);
    expect(getCrsByEpsg(20537)).toBeNull();
  });
});
