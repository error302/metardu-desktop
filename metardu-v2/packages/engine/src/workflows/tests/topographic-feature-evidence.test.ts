import { describe, expect, it } from "vitest";
import { summarizeTopographicPointCodes } from "../topographic-feature-evidence.js";

function outputFixture() {
  return {
    evidenceStatus: "computed-draft-unadjusted",
    tin: {
      vertices: [
        { id: "P1", easting: 10, northing: 20, elevation: 1.2, code: "KERB" },
        { id: "P2", easting: 11, northing: 21, elevation: 1.3, code: "kerb" },
        { id: "P3", easting: 12, northing: 22, elevation: 1.4 },
      ],
    },
  };
}

describe("summarizeTopographicPointCodes", () => {
  it("counts retained TIN vertex codes case-insensitively without interpreting geometry", () => {
    expect(summarizeTopographicPointCodes(outputFixture())).toEqual({
      state: "available",
      vertexCount: 3,
      codedVertexCount: 2,
      codeCounts: [{ code: "KERB", vertexCount: 2 }],
    });
  });

  it("keeps non-topographic and non-draft outputs unavailable", () => {
    expect(summarizeTopographicPointCodes(null)).toEqual({
      state: "unavailable",
      message: "This project has no retained computed topographic draft to inspect.",
    });
    expect(summarizeTopographicPointCodes({ ...outputFixture(), evidenceStatus: "approved" }).state).toBe("unavailable");
  });

  it("rejects malformed retained points rather than counting partial evidence", () => {
    const output = outputFixture();
    output.tin.vertices[2]!.northing = Number.NaN;
    expect(summarizeTopographicPointCodes(output)).toEqual({
      state: "invalid",
      message: "Retained topographic draft vertex 3 is malformed.",
    });
  });
});
