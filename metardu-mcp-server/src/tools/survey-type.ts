import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Survey type definitions ────────────────────────────────────

interface SurveyType {
  type: string;
  label: string;
  description: string;
  keywords: string[];
 typical_deliverables: string[];
}

const SURVEY_TYPES: SurveyType[] = [
  {
    type: "cadastral",
    label: "Cadastral / Boundary Survey",
    description: "Parcel subdivision, boundary re-establishment, mutation, or title survey",
    keywords: ["cadastral", "boundary", "parcel", "subdivision", "mutation", "title", "beacon", "LR", "plot", "allotment", "grant", "lease", "easement"],
    typical_deliverables: ["Deed Plan", "Beacon Certificate", "Form 3 Mutation Form", "DXF Export"],
  },
  {
    type: "topographic",
    label: "Topographic Survey",
    description: "Terrain mapping with contours, spot heights, and feature coding",
    keywords: ["topographic", "topo", "contour", "terrain", "spot height", "TIN", "relief", "DEM", "DSM", "elevation", "feature coding"],
    typical_deliverables: ["Contour Map", "TIN Model", "Cross-sections", "Volume Computation"],
  },
  {
    type: "engineering",
    label: "Engineering / Road Survey",
    description: "Road design, earthworks, alignment, and construction survey",
    keywords: ["road", "alignment", "horizontal curve", "vertical curve", "earthwork", "cut", "fill", "mass haul", "grade", "cross-section", "chainage", "road reserve"],
    typical_deliverables: ["Longitudinal Profile", "Cross-sections", "Mass-haul Diagram", "Earthwork Volumes"],
  },
  {
    type: "control",
    label: "Control / GNSS Network Survey",
    description: "Geodetic control network establishment using GNSS observations",
    keywords: ["control", "GNSS", "GPS", "baseline", "network", "adjustment", "least squares", "reference mark", "trig point", "KenCORS", "RTK", "static"],
    typical_deliverables: ["Network Adjustment Report", "Error Ellipses", "Control Point Schedule"],
  },
  {
    type: "hydrographic",
    label: "Hydrographic / Bathymetric Survey",
    description: "Water body depth mapping and shoreline survey",
    keywords: ["hydrographic", "bathymetric", "depth", "sonar", "river", "lake", "reservoir", "shoreline", "flood", "bathymetry"],
    typical_deliverables: ["Bathymetric Map", "Depth Contours", "Shoreline Plan"],
  },
  {
    type: "mining",
    label: "Mining / Quarry Survey",
    description: "Mine survey, volumetric stockpile measurement, and pit design",
    keywords: ["mining", "quarry", "stockpile", "volume", "pit", "dump", "rehabilitation", "grade control", "blast pattern"],
    typical_deliverables: ["Volumetric Report", "Pit Design Plan", "Stockpile Map"],
  },
  {
    type: "settlement",
    label: "Settlement / Land Adjudication Survey",
    description: "Community land mapping, adjudication, and registration",
    keywords: ["settlement", "adjudication", "community land", "CLRO", "register", "adjudication", "demarcation", "community", "group ranch"],
    typical_deliverables: ["Adjudication Map", "Community Land Register", "Parcel Index"],
  },
  {
    type: "construction",
    label: "Construction Setting-Out",
    description: "Building and infrastructure setting-out with as-built verification",
    keywords: ["setting out", "stakeout", "as-built", "construction", "foundation", "column", "setback", "building line", "plinth"],
    typical_deliverables: ["Setting-Out Plan", "As-Built Report", "Tolerance Report"],
  },
  {
    type: "drone",
    label: "Drone / Photogrammetry Survey",
    description: "Aerial survey using UAVs for mapping, orthomosaics, and 3D models",
    keywords: ["drone", "UAV", "photogrammetry", "orthomosaic", "GSD", "flight plan", "DEM", "DSM", "point cloud", "DJI", "Pix4D", "Metashape"],
    typical_deliverables: ["Orthomosaic", "DSM/DTM", "3D Point Cloud", "Flight Report"],
  },
  {
    type: "sectional",
    label: "Sectional Title / Strata Survey",
    description: "Multi-unit building survey for sectional title registration",
    keywords: ["sectional", "strata", "unit", "common property", "participation quota", "building", "floor", "sectional plan"],
    typical_deliverables: ["Sectional Plan", "Unit Schedule", "Participation Quota Calculation"],
  },
];

export function registerSurveyTypeTools(server: McpServer): void {
  server.registerTool(
    "metardu_survey_detect_type",
    {
      title: "Detect Survey Type",
      description:
        "Classify a survey project from a text description. Returns the most likely survey type with confidence score and recommended deliverables.",
      inputSchema: {
        description: z
          .string()
          .min(10)
          .max(2000)
          .describe("Text description of the survey project (e.g. scope, objectives, site name)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ description }) => {
      const lower = description.toLowerCase();
      const results = SURVEY_TYPES.map((st) => {
        let score = 0;
        for (const kw of st.keywords) {
          if (lower.includes(kw.toLowerCase())) {
            score += 1;
          }
        }
        return { type: st.type, label: st.label, description: st.description, score, deliverables: st.typical_deliverables };
      })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                detected: false,
                message: "No matching survey type found. Try adding more specific keywords (e.g. 'boundary', 'contour', 'road', 'GNSS').",
                available_types: SURVEY_TYPES.map((st) => ({ type: st.type, label: st.label, keywords: st.keywords.slice(0, 5) })),
              }),
            },
          ],
        };
      }

      const topScore = results[0]!.score;
      const matches = results
        .filter((r) => r.score >= topScore * 0.5)
        .map((r) => ({
          type: r.type,
          label: r.label,
          description: r.description,
          confidence: Math.min(1, r.score / Math.max(topScore, 3)),
          deliverables: r.deliverables,
        }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ detected: true, matches }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "metardu_survey_list_types",
    {
      title: "List Survey Types",
      description: "List all supported survey types with their keywords and typical deliverables.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const types = SURVEY_TYPES.map((st) => ({
        type: st.type,
        label: st.label,
        description: st.description,
        keywords: st.keywords,
        deliverables: st.typical_deliverables,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(types, null, 2) }],
      };
    },
  );
}
