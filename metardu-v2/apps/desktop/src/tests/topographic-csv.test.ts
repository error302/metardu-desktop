import { describe, expect, it } from "vitest";
import { parseTopographicCsv } from "../renderer/topographic-csv.js";

describe("parseTopographicCsv", () => {
  it("parses explicit metric coordinate rows and optional feature codes", () => {
    expect(parseTopographicCsv("P1,500000,4500000,102.35,ROAD\nP2,500010,4500000,102.6")).toEqual([
      { id: "P1", easting: 500000, northing: 4500000, elevation: 102.35, code: "ROAD" },
      { id: "P2", easting: 500010, northing: 4500000, elevation: 102.6 },
    ]);
  });

  it.each([
    "P1,,4500000,102.35",
    "P1,500000,4500000,",
    "P1,500000x,4500000,102.35",
    "P1,Infinity,4500000,102.35",
    "P1,500000,4500000,102.35,ROAD,EXTRA",
    ",500000,4500000,102.35",
  ])("rejects invalid row %s instead of substituting zero", (input) => {
    expect(() => parseTopographicCsv(input)).toThrow(/CSV row/i);
  });

  it("rejects an empty file", () => {
    expect(() => parseTopographicCsv("\n  \n")).toThrow(/at least three field point rows/i);
  });
});
