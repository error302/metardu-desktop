/**
 * map-geometry — pure extraction tests.
 *
 * Pins the normalizer that turns any survey workflow output shape into the
 * MapGeometry the MapView renders. Pure function — no Electron, no React,
 * no ol — so these run headless in the desktop vitest suite.
 */

import { describe, it, expect } from "vitest";
import {
  detectAutoExportKind,
  extractMapGeometry,
  summarizeGeometry,
  emptyMapGeometry,
  splitGeometryIntoParcels,
  type MapGeometry,
} from "../renderer/map-geometry.js";

describe("extractMapGeometry", () => {
  it("returns empty geometry for null / non-object / unrecognized input", () => {
    expect(extractMapGeometry(null)).toEqual(emptyMapGeometry());
    expect(extractMapGeometry(undefined)).toEqual(emptyMapGeometry());
    expect(extractMapGeometry(42)).toEqual(emptyMapGeometry());
    expect(extractMapGeometry("nope")).toEqual(emptyMapGeometry());
    expect(extractMapGeometry([1, 2, 3])).toEqual(emptyMapGeometry());
    expect(extractMapGeometry({ random: { stuff: 1 } })).toEqual(emptyMapGeometry());
  });

  it("extracts cadastral beacons from allBeacons (label + position)", () => {
    const output = {
      form3: { pdfBytes: [] },
      allBeacons: [
        { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "Concrete pillar" },
        { label: "B2", position: { easting: 257150.0, northing: 9857700.0 }, description: "Concrete pillar" },
        { label: "B3", position: { easting: 257150.0, northing: 9857750.0 }, description: "Concrete pillar" },
        { label: "B4", position: { easting: 257100.0, northing: 9857750.0 }, description: "Concrete pillar" },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons).toHaveLength(4);
    expect(geo.beacons[0]).toEqual({ label: "B1", easting: 257100.0, northing: 9857700.0 });
    expect(geo.beacons.map((b) => b.label)).toEqual(["B1", "B2", "B3", "B4"]);
  });

  it("builds a closed parcel ring through ≥3 cadastral beacons when no explicit boundary exists", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 10, northing: 0 } },
        { label: "B3", position: { easting: 10, northing: 10 } },
        { label: "B4", position: { easting: 0, northing: 10 } },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.boundaries).toHaveLength(1);
    const ring = geo.boundaries[0]!;
    expect(ring.label).toBe("Parcel");
    // Closed ring: last vertex === first.
    expect(ring.vertices[ring.vertices.length - 1]).toEqual(ring.vertices[0]);
    expect(ring.vertices).toHaveLength(5);
  });

  it("dedupes beacons when allBeacons and parcel.beacons carry the same set", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 10, northing: 0 } },
      ],
      parcel: {
        beacons: [
          { label: "B1", position: { easting: 0, northing: 0 } },
          { label: "B2", position: { easting: 10, northing: 0 } },
        ],
      },
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons).toHaveLength(2);
    expect(geo.beacons.map((b) => b.label)).toEqual(["B1", "B2"]);
  });

  it("prefers an explicit parcel.boundary.vertices over the beacon ring", () => {
    const output = {
      parcel: {
        surveyNumber: "LR/12345",
        boundary: {
          vertices: [
            { easting: 1, northing: 1 },
            { easting: 2, northing: 1 },
            { easting: 2, northing: 2 },
            { easting: 1, northing: 2 },
          ],
        },
        beacons: [
          { label: "B1", position: { easting: 100, northing: 100 } },
          { label: "B2", position: { easting: 200, northing: 100 } },
        ],
      },
    };
    const geo = extractMapGeometry(output);
    // Boundary comes from parcel.boundary, not a beacon ring.
    expect(geo.boundaries).toHaveLength(1);
    expect(geo.boundaries[0]!.vertices[0]).toEqual({ label: "V1", easting: 1, northing: 1 });
    // Beacons still extracted from parcel.beacons.
    expect(geo.beacons.map((b) => b.label)).toEqual(["B1", "B2"]);
  });

  it("does not build a ring from fewer than 3 beacons", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 10, northing: 0 } },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.boundaries).toHaveLength(0);
    expect(geo.beacons).toHaveLength(2);
  });

  it("extracts topographic field points from tin.vertices and spotHeights", () => {
    const output = {
      tin: {
        vertices: [
          { easting: 100, northing: 200, elevation: 10.0 },
          { easting: 101, northing: 200, elevation: 10.5 },
          { easting: 100, northing: 201, elevation: 11.0 },
        ],
      },
      spotHeights: [{ easting: 105, northing: 205, elevation: 12.0 }],
    };
    const geo = extractMapGeometry(output);
    expect(geo.fieldPoints).toHaveLength(4);
    expect(geo.fieldPoints[0]).toEqual({ label: "T1", easting: 100, northing: 200 });
    expect(geo.fieldPoints[3]).toEqual({ label: "S1", easting: 105, northing: 205 });
    expect(geo.beacons).toHaveLength(0);
  });

  it("extracts an engineering alignment as an open boundary polyline", () => {
    const output = {
      alignment: {
        points: [
          { chainage: 0, easting: 50, northing: 0 },
          { chainage: 50, easting: 100, northing: 0 },
          { chainage: 100, easting: 150, northing: 0 },
        ],
      },
    };
    const geo = extractMapGeometry(output);
    expect(geo.boundaries).toHaveLength(1);
    expect(geo.boundaries[0]!.label).toBe("Alignment");
    expect(geo.boundaries[0]!.vertices).toHaveLength(3);
    // Open polyline — no implicit closure.
    expect(geo.boundaries[0]!.vertices[geo.boundaries[0]!.vertices.length - 1]).toEqual(
      { label: "A3", easting: 150, northing: 0 },
    );
  });

  it("extracts one labeled boundary per explicit parcels[] entry (subdivision shape)", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 100, northing: 0 } },
      ],
      parcels: [
        {
          label: "LR 12345/1",
          boundary: {
            vertices: [
              { easting: 0, northing: 0 }, { easting: 50, northing: 0 },
              { easting: 50, northing: 50 }, { easting: 0, northing: 50 },
            ],
          },
        },
        {
          parcelNo: "LR 12345/2",
          boundary: {
            vertices: [
              { easting: 50, northing: 0 }, { easting: 100, northing: 0 },
              { easting: 100, northing: 50 }, { easting: 50, northing: 50 },
            ],
          },
        },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.boundaries.map((b) => b.label)).toEqual(["LR 12345/1", "LR 12345/2"]);
    expect(geo.boundaries[0]!.vertices).toHaveLength(4);
    expect(geo.boundaries[1]!.vertices).toHaveLength(4);
  });

  it("does not add a phantom whole-parcel ring when an explicit parcels[] list exists", () => {
    // Subdivision output: ≥3 shared beacons AND per-parcel boundaries. The
    // beacon-ring fallback must NOT fire — only the real parcel boundaries.
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 100, northing: 0 } },
        { label: "B3", position: { easting: 100, northing: 100 } },
        { label: "B4", position: { easting: 0, northing: 100 } },
      ],
      parcels: [
        {
          label: "LR 1",
          boundary: { vertices: [
            { easting: 0, northing: 0 }, { easting: 50, northing: 0 },
            { easting: 50, northing: 50 }, { easting: 0, northing: 50 },
          ] },
        },
        {
          label: "LR 2",
          boundary: { vertices: [
            { easting: 50, northing: 0 }, { easting: 100, northing: 0 },
            { easting: 100, northing: 50 }, { easting: 50, northing: 50 },
          ] },
        },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.boundaries.map((b) => b.label)).toEqual(["LR 1", "LR 2"]);
  });

  it("extracts setting-out design points (field) and control points (beacons)", () => {
    const output = {
      designPoints: [
        { id: "P1", easting: 1000, northing: 1000 },
        { id: "P2", easting: 1010, northing: 1000 },
      ],
      controlPoints: [{ id: "C1", easting: 990, northing: 990 }],
    };
    const geo = extractMapGeometry(output);
    expect(geo.fieldPoints).toHaveLength(2);
    expect(geo.beacons).toHaveLength(1);
    expect(geo.beacons[0]).toEqual({ label: "C1", easting: 990, northing: 990 });
  });

  it("ignores malformed points (NaN / missing coords) instead of crashing", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: NaN, northing: 0 } },
        { label: "B2", position: { easting: 10 } },
        { label: "B3", position: { easting: 10, northing: 10 } },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons).toHaveLength(1);
    expect(geo.beacons[0]!.label).toBe("B3");
  });

  it("attaches cadastral error ellipses from the top-level uncertainty map", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 257100, northing: 9857700 } },
        { label: "B2", position: { easting: 257200, northing: 9857700 } },
        { label: "B3", position: { easting: 257200, northing: 9857800 } },
      ],
      uncertainty: {
        B1: { adjusted: false, reason: "fixed-control" },
        B2: { adjusted: false, reason: "fixed-control" },
        B3: {
          adjusted: true,
          semiMajorAxis: 0.012,
          semiMinorAxis: 0.008,
          orientation: 45.3,
          confidenceLevel: 0.95,
          sigma_0_sq: 1.0,
        },
      },
    };
    const geo = extractMapGeometry(output);
    const byLabel = Object.fromEntries(geo.beacons.map((b) => [b.label, b]));
    // Known control points carry the flag with no ellipse.
    expect(byLabel["B1"].uncertainty).toEqual({ adjusted: false, reason: "fixed-control" });
    // Adjusted point carries the full ellipse.
    expect(byLabel["B3"].uncertainty).toEqual({
      adjusted: true,
      semiMajorAxis: 0.012,
      semiMinorAxis: 0.008,
      orientation: 45.3,
      confidenceLevel: 0.95,
      sigma_0_sq: 1.0,
    });
  });

  it("attaches pointUncertainty (topo/engineering keyed by label) to beacons", () => {
    const output = {
      designPoints: [{ id: "P1", easting: 100, northing: 100 }],
      controlPoints: [{ id: "C1", easting: 90, northing: 90 }],
      pointUncertainty: {
        C1: { adjusted: false, reason: "field-data" },
      },
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons[0]!.label).toBe("C1");
    expect(geo.beacons[0]!.uncertainty).toEqual({ adjusted: false, reason: "field-data" });
  });

  it("prefers an inline per-beacon uncertainty over the top-level map", () => {
    const output = {
      allBeacons: [
        {
          label: "B1",
          position: { easting: 0, northing: 0 },
          uncertainty: { adjusted: true, semiMajorAxis: 0.02, semiMinorAxis: 0.01, orientation: 90 },
        },
      ],
      uncertainty: {
        B1: { adjusted: false, reason: "fixed-control" },
      },
    };
    const geo = extractMapGeometry(output);
    // Inline record wins — the top-level map must not clobber it.
    expect(geo.beacons[0]!.uncertainty).toEqual({
      adjusted: true,
      semiMajorAxis: 0.02,
      semiMinorAxis: 0.01,
      orientation: 90,
    });
  });

  it("rejects malformed uncertainty records (missing adjusted flag, NaN axes)", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 10, northing: 0 } },
      ],
      uncertainty: {
        B1: { semiMajorAxis: 0.1 }, // no adjusted flag → rejected
        B2: { adjusted: true, semiMajorAxis: NaN, semiMinorAxis: 0.1 }, // NaN axis dropped
      },
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons[0]!.uncertainty).toBeUndefined();
    expect(geo.beacons[1]!.uncertainty).toEqual({ adjusted: true, semiMinorAxis: 0.1 });
  });

  it("leaves beacons without an uncertainty record unadorned", () => {
    const output = {
      allBeacons: [{ label: "B1", position: { easting: 0, northing: 0 } }],
    };
    const geo = extractMapGeometry(output);
    expect(geo.beacons[0]).toEqual({ label: "B1", easting: 0, northing: 0 });
    expect(geo.beacons[0]!.uncertainty).toBeUndefined();
  });

  it("extracts topographic contours from output.contours (pair coordinates)", () => {
    const output = {
      contours: [
        {
          elevation: 100.5,
          closed: true,
          coordinates: [
            [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
          ],
        },
        {
          elevation: 101.0,
          closed: false,
          coordinates: [[0, 0], [20, 5]],
        },
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.contours).toHaveLength(2);
    expect(geo.contours[0]).toEqual({
      elevation: 100.5,
      closed: true,
      vertices: [
        { label: "C100.5", easting: 0, northing: 0 },
        { label: "C100.5", easting: 10, northing: 0 },
        { label: "C100.5", easting: 10, northing: 10 },
        { label: "C100.5", easting: 0, northing: 10 },
        { label: "C100.5", easting: 0, northing: 0 },
      ],
    });
    expect(geo.contours[1]!.closed).toBe(false);
    expect(geo.contours[1]!.elevation).toBe(101.0);
  });

  it("falls back to output.tin.contours and object-shaped vertices", () => {
    const output = {
      tin: {
        vertices: [{ easting: 0, northing: 0, elevation: 100 }],
        contours: [
          {
            elevation: 99.5,
            coordinates: [
              { easting: 5, northing: 5 },
              { easting: 15, northing: 5 },
            ],
          },
        ],
      },
    };
    const geo = extractMapGeometry(output);
    expect(geo.contours).toHaveLength(1);
    expect(geo.contours[0]!.elevation).toBe(99.5);
    expect(geo.contours[0]!.vertices[0]).toEqual({ label: "C99.5", easting: 5, northing: 5 });
  });

  it("skips malformed contours (missing elevation, <2 coords, bad vertices)", () => {
    const output = {
      contours: [
        { coordinates: [[0, 0], [1, 1]] },                    // no elevation
        { elevation: 10, coordinates: [[0, 0]] },             // too few vertices
        { elevation: 11, coordinates: [[0, 0], ["x", 1]] },  // malformed vertex
        { elevation: 12, coordinates: [[0, 0], [1, 1]] },     // valid
      ],
    };
    const geo = extractMapGeometry(output);
    expect(geo.contours).toHaveLength(1);
    expect(geo.contours[0]!.elevation).toBe(12);
  });

  it("treats a contours-only topographic output as plottable (not 'skip')", () => {
    const output = {
      contours: [
        { elevation: 100, coordinates: [[0, 0], [10, 0], [10, 10]] },
      ],
    };
    expect(detectAutoExportKind(output)).toBe("png");
  });
});

describe("splitGeometryIntoParcels", () => {
  it("splits an explicit parcels[] array into one plan per parcel (with shared beacons)", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 100, northing: 0 } },
        { label: "B3", position: { easting: 100, northing: 100 } },
      ],
      parcels: [
        {
          label: "LR 12345/1",
          boundary: { vertices: [
            { easting: 0, northing: 0 }, { easting: 50, northing: 0 },
            { easting: 50, northing: 50 }, { easting: 0, northing: 50 },
          ] },
        },
        {
          label: "LR 12345/2",
          boundary: { vertices: [
            { easting: 50, northing: 0 }, { easting: 100, northing: 0 },
            { easting: 100, northing: 50 }, { easting: 50, northing: 50 },
          ] },
        },
      ],
    };
    const geometry = extractMapGeometry(output);
    const parcels = splitGeometryIntoParcels(output, geometry);
    expect(parcels).toHaveLength(2);
    expect(parcels.map((p) => p.label)).toEqual(["LR 12345/1", "LR 12345/2"]);
    // Each plan keeps the shared beacon set.
    expect(parcels[0]!.geometry.beacons).toHaveLength(3);
    expect(parcels[1]!.geometry.beacons).toHaveLength(3);
    // Each plan carries only its own boundary ring.
    expect(parcels[0]!.geometry.boundaries).toHaveLength(1);
    expect(parcels[0]!.geometry.boundaries[0]!.label).toBe("LR 12345/1");
    expect(parcels[1]!.geometry.boundaries[0]!.label).toBe("LR 12345/2");
  });

  it("splits ≥2 closed rings in the geometry into one plan per ring", () => {
    const geometry: MapGeometry = {
      beacons: [{ label: "B1", easting: 0, northing: 0 }],
      boundaries: [
        {
          label: "Parcel 1",
          vertices: [
            { label: "V1", easting: 0, northing: 0 }, { label: "V2", easting: 10, northing: 0 },
            { label: "V3", easting: 10, northing: 10 }, { label: "V4", easting: 0, northing: 10 },
            { label: "V1", easting: 0, northing: 0 },
          ],
        },
        {
          label: "Parcel 2",
          vertices: [
            { label: "V1", easting: 20, northing: 0 }, { label: "V2", easting: 30, northing: 0 },
            { label: "V3", easting: 30, northing: 10 }, { label: "V4", easting: 20, northing: 10 },
            { label: "V1", easting: 20, northing: 0 },
          ],
        },
      ],
      fieldPoints: [],
      contours: [],
    };
    const parcels = splitGeometryIntoParcels({}, geometry);
    expect(parcels.map((p) => p.label)).toEqual(["Parcel 1", "Parcel 2"]);
  });

  it("returns a single plan for single-parcel / open-polyline geometry", () => {
    const single: MapGeometry = {
      beacons: [{ label: "B1", easting: 0, northing: 0 }],
      boundaries: [],
      fieldPoints: [],
      contours: [],
    };
    expect(splitGeometryIntoParcels({}, single)).toHaveLength(1);

    // Engineering alignment (open polyline) must never be split.
    const alignment: MapGeometry = {
      beacons: [],
      boundaries: [
        {
          label: "Alignment",
          vertices: [
            { label: "A1", easting: 0, northing: 0 },
            { label: "A2", easting: 100, northing: 0 },
          ],
        },
      ],
      fieldPoints: [],
      contours: [],
    };
    const parcels = splitGeometryIntoParcels({}, alignment);
    expect(parcels).toHaveLength(1);
    expect(parcels[0]!.label).toBe("Parcel");
    expect(parcels[0]!.geometry.boundaries[0]!.label).toBe("Alignment");
  });
});

describe("detectAutoExportKind", () => {
  it("returns 'skip' for outputs with nothing plottable", () => {
    expect(detectAutoExportKind(null)).toBe("skip");
    expect(detectAutoExportKind({})).toBe("skip");
    expect(detectAutoExportKind({ random: { stuff: 1 } })).toBe("skip");
  });

  it("returns 'png' for a single cadastral parcel (beacon ring)", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 10, northing: 0 } },
        { label: "B3", position: { easting: 10, northing: 10 } },
        { label: "B4", position: { easting: 0, northing: 10 } },
      ],
    };
    expect(detectAutoExportKind(output)).toBe("png");
  });

  it("returns 'png' for topographic TIN-only output (field points, no parcels)", () => {
    const output = {
      tin: {
        vertices: [
          { easting: 100, northing: 200, elevation: 10.0 },
          { easting: 101, northing: 200, elevation: 10.5 },
          { easting: 100, northing: 201, elevation: 11.0 },
        ],
      },
    };
    expect(detectAutoExportKind(output)).toBe("png");
  });

  it("returns 'png' for an engineering alignment (open polyline, never split)", () => {
    const output = {
      alignment: {
        points: [
          { chainage: 0, easting: 50, northing: 0 },
          { chainage: 50, easting: 100, northing: 0 },
        ],
      },
    };
    expect(detectAutoExportKind(output)).toBe("png");
  });

  it("returns 'booklet' for a subdivision with ≥2 explicit parcels", () => {
    const output = {
      allBeacons: [
        { label: "B1", position: { easting: 0, northing: 0 } },
        { label: "B2", position: { easting: 100, northing: 0 } },
      ],
      parcels: [
        {
          label: "LR 12345/1",
          boundary: { vertices: [
            { easting: 0, northing: 0 }, { easting: 50, northing: 0 },
            { easting: 50, northing: 50 }, { easting: 0, northing: 50 },
          ] },
        },
        {
          label: "LR 12345/2",
          boundary: { vertices: [
            { easting: 50, northing: 0 }, { easting: 100, northing: 0 },
            { easting: 100, northing: 50 }, { easting: 50, northing: 50 },
          ] },
        },
      ],
    };
    expect(detectAutoExportKind(output)).toBe("booklet");
  });

  it("returns 'booklet' for ≥2 closed rings in the extracted geometry", () => {
    // Two closed rings via the shapes extractMapGeometry actually reads:
    // a parcel.boundary ring and a top-level boundary ring.
    const output = {
      parcel: {
        boundary: {
          vertices: [
            { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
            { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            { easting: 0, northing: 0 },
          ],
        },
      },
      boundary: {
        vertices: [
          { easting: 20, northing: 0 }, { easting: 30, northing: 0 },
          { easting: 30, northing: 10 }, { easting: 20, northing: 10 },
          { easting: 20, northing: 0 },
        ],
      },
    };
    expect(detectAutoExportKind(output)).toBe("booklet");
  });
});

describe("summarizeGeometry", () => {
  it("renders a human-readable summary", () => {
    const geo: MapGeometry = {
      beacons: [{ label: "B1", easting: 0, northing: 0 }],
      boundaries: [
        { label: "Parcel", vertices: [{ label: "V1", easting: 0, northing: 0 }] },
      ],
      fieldPoints: [
        { label: "T1", easting: 1, northing: 1 },
        { label: "T2", easting: 2, northing: 2 },
      ],
      contours: [
        {
          elevation: 10.5,
          vertices: [{ label: "C10.5", easting: 0, northing: 0 }],
          closed: false,
        },
      ],
    };
    expect(summarizeGeometry(geo)).toBe("1 beacon · 1 boundary · 2 field points · 1 contour");
  });

  it("handles the empty geometry honestly", () => {
    expect(summarizeGeometry(emptyMapGeometry())).toBe("no plottable geometry");
  });
});
