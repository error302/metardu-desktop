/**
 * map-svg — pure survey-plan SVG builder tests.
 *
 * Pins the print-plan renderer: point-sized SVG, correct 300 DPI pixel
 * math, grid/scale/north-arrow presence, boundary/beacon/field-point
 * drawing, and honest empty-state handling. Pure — no sharp, no electron.
 */

import { describe, it, expect } from "vitest";
import {
  buildSurveyMapSvg,
  PRINT_DPI,
  type SurveyMapSvgResult,
} from "../renderer/map-svg.js";
import type { MapGeometry } from "../renderer/map-geometry.js";

function cadastralGeometry(): MapGeometry {
  return {
    beacons: [
      { label: "B1", easting: 257100, northing: 9857700 },
      { label: "B2", easting: 257200, northing: 9857700 },
      { label: "B3", easting: 257200, northing: 9857800 },
      { label: "B4", easting: 257100, northing: 9857800 },
    ],
    boundaries: [
      {
        label: "Parcel",
        vertices: [
          { label: "B1", easting: 257100, northing: 9857700 },
          { label: "B2", easting: 257200, northing: 9857700 },
          { label: "B3", easting: 257200, northing: 9857800 },
          { label: "B4", easting: 257100, northing: 9857800 },
          { label: "B1", easting: 257100, northing: 9857700 },
        ],
      },
    ],
    fieldPoints: [
      { label: "T1", easting: 257150, northing: 9857750 },
      { label: "T2", easting: 257160, northing: 9857740 },
    ],
    contours: [],
  };
}

describe("buildSurveyMapSvg", () => {
  it("produces a point-sized SVG with a 300 DPI pixel footprint (A4 landscape)", () => {
    const result: SurveyMapSvgResult = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Kasarani Cadastral",
      coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    });
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("width=\"842\"");
    expect(result.svg).toContain("height=\"595\"");
    // 842 pt × 300/72 = 3508 px; 595 × 300/72 = 2479 px.
    expect(result.widthPx).toBe(3508);
    expect(result.heightPx).toBe(2479);
    expect(PRINT_DPI).toBe(300);
  });

  it("renders the title and CRS label into the title strip", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Kasarani <Cadastral> & Co",
      coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    });
    // HTML-escaped title.
    expect(result.svg).toContain("Kasarani &lt;Cadastral&gt; &amp; Co");
    expect(result.svg).toContain("Arc 1960 / UTM zone 37S");
  });

  it("draws the boundary path, beacon markers + labels, and field-point dots", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), { title: "Test" });
    expect(result.svg).toContain("Parcel");           // boundary label
    // Polygon path: M<x>,<y> then space-separated L<x>,<y> segments.
    expect(result.svg).toMatch(/<path d="M[\d.,]+ L[\d.,]+/);
    expect(result.svg).toContain(" Z");                 // ring closure token
    // Beacons draw labeled circles; field points draw plain dots; the
    // legend adds one sample glyph per present symbology (beacon + field
    // point): 4 + 2 + 2 = 8 circles, and B1/B2 labels present.
    expect(result.svg).toContain("B1");
    expect(result.svg).toContain("B4");
    const circleCount = (result.svg.match(/<circle /g) ?? []).length;
    expect(circleCount).toBe(8);
  });

  it("includes a north arrow and a scale bar", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), { title: "Test" });
    expect(result.svg).toContain(">N<");                // north arrow label
    expect(result.svg).toContain("polygon");            // arrow shape
    expect(result.svg).toContain("m</text>");           // scale bar unit label
    expect(result.svg).toContain("Scale 1:");           // footer scale
  });

  it("computes a sane scale denominator for a ~150m parcel", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), { title: "Test" });
    // 150m across a ~770pt map body → around 1:800–1:1200.
    expect(result.scaleDenominator).toBeGreaterThan(400);
    expect(result.scaleDenominator).toBeLessThan(2000);
  });

  it("reports the survey extent in metres", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), { title: "Test" });
    // Padding expands the raw 257100–257200 / 9857700–9857800 extent.
    expect(result.extent.minE).toBeLessThan(257100);
    expect(result.extent.maxE).toBeGreaterThan(257200);
    expect(result.extent.minN).toBeLessThan(9857700);
    expect(result.extent.maxN).toBeGreaterThan(9857800);
  });

  it("handles an empty geometry honestly (no crash, note instead of frame)", () => {
    const result = buildSurveyMapSvg(
      { beacons: [], boundaries: [], fieldPoints: [], contours: [] },
      { title: "Empty" },
    );
    expect(result.svg).toContain("No plottable geometry");
    // Still a valid SVG with the title.
    expect(result.svg).toContain("Empty");
    expect(result.widthPx).toBe(3508);
  });

  it("supports custom paper sizes and a surveyor footer", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Custom",
      surveyorName: "Jane Wanjiru",
      date: "2026-08-01",
      widthPt: 612,   // letter landscape
      heightPt: 792,
    });
    expect(result.svg).toContain("width=\"612\"");
    expect(result.svg).toContain("Surveyor: Jane Wanjiru");
    expect(result.svg).toContain("2026-08-01");
    expect(result.widthPx).toBe(Math.round((612 * PRINT_DPI) / 72));
  });

  it("resolves named ISO sheets and orientation to point dimensions", () => {
    // A3 landscape: 1190.55 × 841.89 pt → 4961 × 3508 px @ 300 DPI.
    const landscape = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Sheet",
      sheetSize: "a3",
      orientation: "landscape",
    });
    expect(landscape.svg).toContain("width=\"1190.55\"");
    expect(landscape.svg).toContain("height=\"841.89\"");
    expect(landscape.widthPx).toBe(Math.round((1190.55 * PRINT_DPI) / 72));
    expect(landscape.heightPx).toBe(Math.round((841.89 * PRINT_DPI) / 72));
    expect(landscape.fitsSheet).toBe(true);

    const portrait = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Sheet",
      sheetSize: "a4",
      orientation: "portrait",
    });
    expect(portrait.svg).toContain("width=\"595.28\"");
    expect(portrait.svg).toContain("height=\"841.89\"");
    // Portrait A4 → 2480 × 3508 px.
    expect(portrait.widthPx).toBe(Math.round((595.28 * PRINT_DPI) / 72));
    expect(portrait.heightPx).toBe(Math.round((841.89 * PRINT_DPI) / 72));
  });

  it("honours a fixed 1:denominator scale and reports it exactly in the footer", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Fixed",
      scaleMode: { mode: "fixed", denominator: 1000 },
    });
    expect(result.scaleDenominator).toBe(1000);
    // A ~116 m padded extent at 1:1000 is ~329 pt wide — fits A4's ~770 pt frame.
    expect(result.fitsSheet).toBe(true);
    expect(result.svg).toContain("Scale 1:1,000");
  });

  it("reports fitsSheet=false when a fixed scale overflows the sheet", () => {
    // 1:100 on a ~116 m extent needs ~3288 pt — far wider than A4 landscape.
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "TooBig",
      scaleMode: { mode: "fixed", denominator: 100 },
    });
    expect(result.scaleDenominator).toBe(100);
    expect(result.fitsSheet).toBe(false);
    // Still a well-formed plan (centred, clipped) — not a crash.
    expect(result.svg).toContain("Scale 1:100");
  });

  it("falls back to auto-fit for a degenerate fixed denominator", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "BadScale",
      scaleMode: { mode: "fixed", denominator: 0 },
    });
    expect(result.scaleDenominator).toBeGreaterThan(0);
    expect(result.fitsSheet).toBe(true);
  });

  it("renders the per-country statutory title block and plan-type prefix", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Kasarani Parcel",
      titleBlockLabel: "REPUBLIC OF KENYA",
      planTypeLabel: "DEED PLAN",
    });
    expect(result.svg).toContain("DEED PLAN — Kasarani Parcel");
    expect(result.svg).toContain("REPUBLIC OF KENYA");
    expect(result.svg).toContain('text-anchor="middle"'); // centered statutory header
  });

  it("renders the statutory footer disclaimer", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Kasarani Parcel",
      footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
    });
    expect(result.svg).toContain("Survey Act Cap. 299");
    expect(result.svg).toContain("EPSG:21037");
  });

  it("supports ANSI letter/legal sheets (US SPCS plans)", () => {
    const letter = buildSurveyMapSvg(cadastralGeometry(), {
      title: "US Plan",
      sheetSize: "letter",
      orientation: "portrait",
    });
    expect(letter.svg).toContain("width=\"612\"");
    expect(letter.svg).toContain("height=\"792\"");
    expect(letter.widthPx).toBe(Math.round((612 * PRINT_DPI) / 72));
    expect(letter.heightPx).toBe(Math.round((792 * PRINT_DPI) / 72));

    const legal = buildSurveyMapSvg(cadastralGeometry(), {
      title: "US Legal",
      sheetSize: "legal",
      orientation: "landscape",
    });
    expect(legal.svg).toContain("width=\"1008\"");
    expect(legal.svg).toContain("height=\"612\"");
  });

  it("renders open polylines (engineering alignment) without a ring-closure token", () => {
    const alignment: MapGeometry = {
      beacons: [],
      boundaries: [
        {
          label: "Alignment",
          vertices: [
            { label: "A1", easting: 500, northing: 0 },
            { label: "A2", easting: 600, northing: 0 },
            { label: "A3", easting: 700, northing: 0 },
          ],
        },
      ],
      fieldPoints: [],
      contours: [],
    };
    const result = buildSurveyMapSvg(alignment, { title: "Road" });
    expect(result.svg).toContain("Alignment");
    // Open polyline: path ends with L... and no " Z" closure.
    expect(result.svg).toMatch(/<path d="M/);
    expect(result.svg).not.toMatch(/Z"/);
  });
});

describe("legend", () => {
  it("renders a legend explaining exactly the symbology present on the sheet", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), { title: "Test" });
    // Cadastral fixture has beacons + a boundary + field points → all rows.
    expect(result.svg).toContain("LEGEND");
    expect(result.svg).toContain(">Beacon</text>");
    expect(result.svg).toContain(">Boundary</text>");
    expect(result.svg).toContain(">Field point</text>");
  });

  it("omits legend rows for symbology absent from the geometry", () => {
    const onlyBoundary: MapGeometry = {
      beacons: [],
      boundaries: cadastralGeometry().boundaries,
      fieldPoints: [],
      contours: [],
    };
    const result = buildSurveyMapSvg(onlyBoundary, { title: "Test" });
    expect(result.svg).toContain("LEGEND");
    expect(result.svg).toContain(">Boundary</text>");
    // No beacons / field points on the sheet → no rows, no sample glyphs.
    expect(result.svg).not.toContain(">Beacon</text>");
    expect(result.svg).not.toContain(">Field point</text>");
  });

  it("honours a custom legend title (per-market override)", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Test",
      legendTitle: "KEY",
    });
    expect(result.svg).toContain(">KEY</text>");
    expect(result.svg).not.toContain(">LEGEND</text>");
  });

  it("renders no legend for the empty state (nothing to explain)", () => {
    const result = buildSurveyMapSvg(
      { beacons: [], boundaries: [], fieldPoints: [], contours: [] },
      { title: "Empty" },
    );
    expect(result.svg).not.toContain("LEGEND");
    expect(result.svg).not.toContain("Field point");
  });

  it("draws contour lines with elevation labels and a legend row", () => {
    const topo: MapGeometry = {
      beacons: [],
      boundaries: [],
      fieldPoints: [{ label: "T1", easting: 100, northing: 100 }],
      contours: [
        {
          elevation: 100.5,
          closed: true,
          vertices: [
            { label: "C100.5", easting: 0, northing: 0 },
            { label: "C100.5", easting: 10, northing: 0 },
            { label: "C100.5", easting: 10, northing: 10 },
            { label: "C100.5", easting: 0, northing: 10 },
            { label: "C100.5", easting: 0, northing: 0 },
          ],
        },
        {
          elevation: 101.0,
          closed: false,
          vertices: [
            { label: "C101.0", easting: 0, northing: 0 },
            { label: "C101.0", easting: 20, northing: 5 },
          ],
        },
      ],
    };
    const result = buildSurveyMapSvg(topo, { title: "Topo" });
    // Closed contour path closes with Z; open one does not.
    expect(result.svg).toMatch(/<path d="M[\d.,]+ L[\d.,]+/);
    expect(result.svg).toContain(" Z");
    // Elevation labels rendered at the first vertex.
    expect(result.svg).toContain("100.5");
    expect(result.svg).toContain("101.0");
    // Legend explains the contour symbology.
    expect(result.svg).toContain(">Contour</text>");
    expect(result.svg).toContain("LEGEND");
  });

  it("keeps the legend box fully inside the map frame", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Test",
      sheetSize: "a3",
      orientation: "landscape",
    });
    expect(result.svg).toContain("LEGEND");
    // Legend anchors bottom-left inside the frame: y = mapBottom - height - 10.
    // Extract both rects' geometry and assert the legend never crosses the
    // frame's top or bottom edge.
    const frame = result.svg.match(
      /<rect x="36" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" fill="#FBFBF9"/,
    );
    const legend = result.svg.match(
      /<rect x="46" y="([\d.]+)" width="96" height="([\d.]+)" fill="#FFFFFF"/,
    );
    expect(frame).not.toBeNull();
    expect(legend).not.toBeNull();
    const frameTop = Number(frame![1]);
    const frameBottom = Number(frame![1]) + Number(frame![2]);
    const legendTop = Number(legend![1]);
    const legendBottom = Number(legend![1]) + Number(legend![2]);
    expect(legendTop).toBeGreaterThanOrEqual(frameTop);
    expect(legendBottom).toBeLessThanOrEqual(frameBottom);
  });
});

describe("statutory title-block layout", () => {
  it("renders the ZA SG-diagram field grid + certification + seal placeholder", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Erf 123, Somerset West",
      surveyorName: "P. van der Merwe",
      date: "2026-08-01",
      coordinateSystemLabel: "Hartebeesthoek94 / Lo29",
      planTypeLabel: "GENERAL PLAN / DIAGRAM",
      titleBlockLayout: {
        variant: "sg-diagram",
        fieldRows: [
          { label: "SG DIAGRAM NO." },
          { label: "FARM NAME" },
          { label: "SCALE", value: "{{scale}}" },
          { label: "DATE OF SURVEY", value: "{{date}}" },
          { label: "SURVEYOR", value: "{{surveyor}}" },
        ],
        certification: {
          heading: "APPROVED — SURVEYOR-GENERAL",
          lines: ["Examined and approved in terms of the Land Survey Act 8 of 1997."],
        },
        seal: { position: "bottom-right", caption: "SAGC REG. NO." },
      },
    });
    expect(result.svg).toContain("SG DIAGRAM NO.");
    expect(result.svg).toContain("FARM NAME");
    // Token fill: surveyor/date/scale replaced with live values.
    expect(result.svg).toContain("P. van der Merwe");
    expect(result.svg).toContain("2026-08-01");
    expect(result.svg).toContain("Scale 1:");
    expect(result.svg).not.toContain("{{surveyor}}");
    // Certification heading + body.
    expect(result.svg).toContain("APPROVED — SURVEYOR-GENERAL");
    expect(result.svg).toContain("Land Survey Act 8 of 1997");
    // Dashed seal placeholder (honest — physical stamp lands here).
    expect(result.svg).toContain("stroke-dasharray=\"2.5,1.6\"");
    expect(result.svg).toContain("SAGC REG. NO.");
    // Blank statutory fields render a dotted underline for manual fill.
    expect(result.svg).toContain("stroke-dasharray=\"2,1.6\"");
  });

  it("fills the US SPCS zone {{crs}} token and ALTA certification block", () => {
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "1000 Commerce St",
      surveyorName: "A. Surveyor",
      date: "2026-08-01",
      coordinateSystemLabel: "NAD83(2011) / Texas South Central",
      planTypeLabel: "ALTA/NSPS LAND TITLE SURVEY",
      titleBlockLayout: {
        variant: "us-alta",
        fieldRows: [
          { label: "ALTA/NSPS SURVEY NO." },
          { label: "SPCS ZONE", value: "{{crs}}" },
          { label: "PLSS DESIGNATION" },
          { label: "SCALE", value: "{{scale}}" },
        ],
        certification: {
          heading: "CERTIFICATION OF SURVEYOR",
          lines: ["I hereby certify that this survey was performed in accordance with"],
        },
        seal: { position: "bottom-right", caption: "STATE REG. NO." },
      },
    });
    expect(result.svg).toContain("SPCS ZONE");
    expect(result.svg).toContain("NAD83(2011) / Texas South Central"); // {{crs}} filled
    expect(result.svg).toContain("CERTIFICATION OF SURVEYOR");
    expect(result.svg).toContain("performed in accordance with");
    expect(result.svg).not.toContain("{{crs}}");
  });

  it("renders the GB HMLR filed-plan block with statutory footer lines and NO seal", () => {    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Title Plan",
      date: "2026-08-01",
      coordinateSystemLabel: "OSGB36 / British National Grid",
      planTypeLabel: "TITLE PLAN / FILED PLAN",
      titleBlockLayout: {
        variant: "hmlr-title-plan",
        fieldRows: [
          { label: "TITLE NUMBER" },
          { label: "ORDNANCE SURVEY MAP REFERENCE", value: "{{crs}}" },
          { label: "SCALE", value: "{{scale}}" },
          { label: "DATE", value: "{{date}}" },
        ],
        certification: {
          heading: "GENERAL BOUNDARIES",
          lines: ["This plan shows the general position, not the exact line, of the boundaries."],
        },
        seal: { position: "none" },
        statutoryFooterLines: [
          "This map is based upon Ordnance Survey material with the permission of",
          "Ordnance Survey on behalf of the Controller of His Majesty's Stationery Office.",
        ],
      },
    });
    expect(result.svg).toContain("TITLE NUMBER");
    expect(result.svg).toContain("OSGB36 / British National Grid");
    expect(result.svg).toContain("GENERAL BOUNDARIES");
    // Statutory footer lines rendered under the footer.
    expect(result.svg).toContain("Ordnance Survey material");
    expect(result.svg).toContain("Stationery Office");
    // Registry-issued — NO surveyor seal placeholder on the sheet.
    expect(result.svg).not.toContain("stroke-dasharray=\"2.5,1.6\"");
    expect(result.svg).not.toContain("{{crs}}");
  });

  it("keeps the map frame inside the sheet when the statutory block grows", () => {
    // A tall certification block must not push the map off the sheet:
    // the footer Y stays above the sheet bottom, and the SVG stays valid.
    const result = buildSurveyMapSvg(cadastralGeometry(), {
      title: "Tall Cert",
      titleBlockLayout: {
        variant: "us-alta",
        fieldRows: Array.from({ length: 8 }, (_, i) => ({ label: `FIELD ${i + 1}` })),
        certification: {
          heading: "CERTIFICATION OF SURVEYOR",
          lines: [
            "Line one of the certification.",
            "Line two of the certification.",
            "Line three of the certification.",
            "Line four of the certification.",
            "Line five of the certification.",
            "Line six of the certification.",
          ],
        },
        seal: { position: "bottom-right", caption: "SEAL" },
      },
    });
    expect(result.svg).toContain("</svg>");
    expect(result.svg).toContain("FIELD 8");
    expect(result.svg).toContain("Line six of the certification.");
    expect(result.svg).toContain("CERTIFICATION OF SURVEYOR");
  });
});
