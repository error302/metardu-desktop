import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerCogoTools(server: McpServer): void {
  // ─── Radiation (polar to rectangular) ─────────────────────────
  server.registerTool(
    "metardu_cogo_radiation",
    {
      title: "COGO Radiation",
      description:
        "Compute a point from station coordinates, bearing, and distance (polar to rectangular). " +
        "Returns easting and northing of the computed point.",
      inputSchema: {
        station_easting: z.number().describe("Station easting (m)"),
        station_northing: z.number().describe("Station northing (m)"),
        bearing_deg: z
          .number()
          .min(0)
          .max(360)
          .describe("Bearing from station to point (decimal degrees, clockwise from north)"),
        distance: z.number().positive().describe("Distance from station to point (m)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ station_easting, station_northing, bearing_deg, distance }) => {
      const rad = (bearing_deg * Math.PI) / 180;
      const easting = station_easting + distance * Math.sin(rad);
      const northing = station_northing + distance * Math.cos(rad);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              easting: round6(easting),
              northing: round6(northing),
              station: { easting: station_easting, northing: station_northing },
              bearing_deg,
              distance,
            }),
          },
        ],
      };
    },
  );

  // ─── Bearing-bearing intersection ─────────────────────────────
  server.registerTool(
    "metardu_cogo_bb_intersection",
    {
      title: "COGO Bearing-Bearing Intersection",
      description:
        "Compute the intersection of two bearing lines from known stations. " +
        "Returns the intersection point coordinates.",
      inputSchema: {
        station_a_easting: z.number().describe("Station A easting (m)"),
        station_a_northing: z.number().describe("Station A northing (m)"),
        bearing_a_deg: z.number().min(0).max(360).describe("Bearing from A (decimal degrees)"),
        station_b_easting: z.number().describe("Station B easting (m)"),
        station_b_northing: z.number().describe("Station B northing (m)"),
        bearing_b_deg: z.number().min(0).max(360).describe("Bearing from B (decimal degrees)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ station_a_easting, station_a_northing, bearing_a_deg, station_b_easting, station_b_northing, bearing_b_deg }) => {
      const a1 = (90 - bearing_a_deg) * (Math.PI / 180);
      const a2 = (90 - bearing_b_deg) * (Math.PI / 180);
      const det = Math.sin(a2 - a1);

      if (Math.abs(det) < 1e-10) {
        return {
          content: [{ type: "text" as const, text: "Error: Lines are parallel or coincident — no intersection exists." }],
          isError: true,
        };
      }

      const dx = station_b_easting - station_a_easting;
      const dy = station_b_northing - station_a_northing;
      const t = (dx * Math.sin(a2) - dy * Math.cos(a2)) / det;
      const easting = station_a_easting + t * Math.cos(a1);
      const northing = station_a_northing + t * Math.sin(a1);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              easting: round6(easting),
              northing: round6(northing),
              station_a: { easting: station_a_easting, northing: station_a_northing, bearing_deg: bearing_a_deg },
              station_b: { easting: station_b_easting, northing: station_b_northing, bearing_deg: bearing_b_deg },
            }),
          },
        ],
      };
    },
  );

  // ─── Distance-distance intersection ───────────────────────────
  server.registerTool(
    "metardu_cogo_dd_intersection",
    {
      title: "COGO Distance-Distance Intersection",
      description:
        "Compute the intersection of two circles (distance-distance intersection). " +
        "Returns the intersection point closest to the 'side' hint, or the northern point if no hint.",
      inputSchema: {
        center_a_easting: z.number().describe("Center A easting (m)"),
        center_a_northing: z.number().describe("Center A northing (m)"),
        radius_a: z.number().positive().describe("Radius from A (m)"),
        center_b_easting: z.number().describe("Center B easting (m)"),
        center_b_northing: z.number().describe("Center B northing (m)"),
        radius_b: z.number().positive().describe("Radius from B (m)"),
        side: z.enum(["north", "south"]).default("north").describe("Which intersection to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ center_a_easting, center_a_northing, radius_a, center_b_easting, center_b_northing, radius_b, side }) => {
      const dx = center_b_easting - center_a_easting;
      const dy = center_b_northing - center_a_northing;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d > radius_a + radius_b) {
        return { content: [{ type: "text" as const, text: "Error: Circles do not intersect — too far apart." }], isError: true };
      }
      if (d < Math.abs(radius_a - radius_b)) {
        return { content: [{ type: "text" as const, text: "Error: Circles do not intersect — one contains the other." }], isError: true };
      }
      if (d < 1e-10) {
        return { content: [{ type: "text" as const, text: "Error: Circles are coincident — infinite intersections." }], isError: true };
      }

      const aa = (radius_a * radius_a - radius_b * radius_b + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, radius_a * radius_a - aa * aa));
      const mx = center_a_easting + aa * dx / d;
      const my = center_a_northing + aa * dy / d;

      const p1 = { easting: mx + h * dy / d, northing: my - h * dx / d };
      const p2 = { easting: mx - h * dy / d, northing: my + h * dx / d };

      const result = side === "north"
        ? (p1.northing >= p2.northing ? p1 : p2)
        : (p1.northing <= p2.northing ? p1 : p2);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              easting: round6(result.easting),
              northing: round6(result.northing),
              center_a: { easting: center_a_easting, northing: center_a_northing, radius: radius_a },
              center_b: { easting: center_b_easting, northing: center_b_northing, radius: radius_b },
            }),
          },
        ],
      };
    },
  );

  // ─── Line offset ──────────────────────────────────────────────
  server.registerTool(
    "metardu_cogo_line_offset",
    {
      title: "COGO Line Offset",
      description:
        "Compute a point offset perpendicularly from a line defined by two points. " +
        "Positive offset is to the left when facing from 'from' to 'to'.",
      inputSchema: {
        from_easting: z.number().describe("Line start easting (m)"),
        from_northing: z.number().describe("Line start northing (m)"),
        to_easting: z.number().describe("Line end easting (m)"),
        to_northing: z.number().describe("Line end northing (m)"),
        offset_distance: z.number().describe("Offset distance (m), positive = left, negative = right"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ from_easting, from_northing, to_easting, to_northing, offset_distance }) => {
      const dx = to_easting - from_easting;
      const dy = to_northing - from_northing;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len < 1e-10) {
        return { content: [{ type: "text" as const, text: "Error: Zero-length line." }], isError: true };
      }

      const midE = (from_easting + to_easting) / 2;
      const midN = (from_northing + to_northing) / 2;
      const easting = midE + offset_distance * dy / len;
      const northing = midN - offset_distance * dx / len;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              easting: round6(easting),
              northing: round6(northing),
              line: { from: { easting: from_easting, northing: from_northing }, to: { easting: to_easting, northing: to_northing } },
              offset_distance,
              line_length: round6(len),
            }),
          },
        ],
      };
    },
  );

  // ─── Area computation ─────────────────────────────────────────
  server.registerTool(
    "metardu_cogo_area",
    {
      title: "COGO Polygon Area",
      description:
        "Compute the area and perimeter of a closed polygon defined by ordered vertices. " +
        "Uses the Shoelace formula. Vertices must be in order (CW or CCW).",
      inputSchema: {
        vertices: z
          .array(
            z.object({
              easting: z.number(),
              northing: z.number(),
              label: z.string().optional(),
            }),
          )
          .min(3)
          .describe("Ordered polygon vertices (at least 3)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ vertices }) => {
      // Shoelace formula
      let area = 0;
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i]!.easting * vertices[j]!.northing;
        area -= vertices[j]!.easting * vertices[i]!.northing;
      }
      area = Math.abs(area) / 2;

      // Perimeter
      let perimeter = 0;
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const de = vertices[j]!.easting - vertices[i]!.easting;
        const dn = vertices[j]!.northing - vertices[i]!.northing;
        perimeter += Math.sqrt(de * de + dn * dn);
      }

      // Bearings and distances
      const sides = vertices.map((v, i) => {
        const j = (i + 1) % vertices.length;
        const de = vertices[j]!.easting - v.easting;
        const dn = vertices[j]!.northing - v.northing;
        let brg = (Math.atan2(de, dn) * 180) / Math.PI;
        if (brg < 0) brg += 360;
        return {
          from: v.label ?? `V${i + 1}`,
          to: vertices[j]!.label ?? `V${j + 1}`,
          bearing_deg: round4(brg),
          distance: round4(Math.sqrt(de * de + dn * dn)),
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              area_sqm: round4(area),
              area_ha: round6(area / 10000),
              perimeter: round4(perimeter),
              vertex_count: vertices.length,
              sides,
            }),
          },
        ],
      };
    },
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
