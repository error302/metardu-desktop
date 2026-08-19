/**
 * Project Templates — pre-built configurations for common Kenya survey types.
 *
 * Each template defines:
 *   - Default name, description, country code
 *   - Which views to pre-configure
 *   - Default parameters for each view (template options, scale, etc.)
 *   - Suggested workflow steps
 *
 * Surveyors pick a template when creating a new project; the app
 * pre-fills the relevant views with sensible defaults for that
 * survey type.
 */

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  countryCode: string;
  surveyType: string;
  /** Views that should be pre-configured, in suggested order. */
  workflowSteps: string[];
  /** Default parameters for the template. */
  defaults: Record<string, unknown>;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "subdivision",
    name: "Subdivision",
    description: "Subdivide a parent parcel into smaller lots with new beacons, boundary re-establishment, and Form 3 deed plans.",
    icon: "✂️",
    countryCode: "KE",
    surveyType: "subdivision",
    workflowSteps: ["fieldbook", "traverse", "cogo", "subdivision", "deedplan", "signing", "export"],
    defaults: {
      traverseMode: "ls-distance",
      adjustmentCountry: "KE",
      deedPlanScale: "1:1000",
      includeBeaconSchedule: true,
    },
  },
  {
    id: "boundary",
    name: "Boundary Re-establishment",
    description: "Verify and re-establish existing boundary beacons with traverse closure and misclosure checks.",
    icon: "📐",
    countryCode: "KE",
    surveyType: "boundary",
    workflowSteps: ["fieldbook", "traverse", "lsa", "deedplan", "signing", "export"],
    defaults: {
      traverseMode: "bowditch",
      angularMisclosureTolerance: "3",
      linearMisclosureTolerance: "1:5000",
    },
  },
  {
    id: "topographic",
    name: "Topographic Survey",
    description: "Collect field points, generate TIN, extract contours, and produce a topographic plan.",
    icon: "🏔️",
    countryCode: "KE",
    surveyType: "topographic",
    workflowSteps: ["fieldbook", "topo", "map", "export"],
    defaults: {
      contourInterval: 0.5,
      spotHeightEvery: 2,
      mapSheetSize: "A1",
      mapScale: "1:1000",
    },
  },
  {
    id: "road-corridor",
    name: "Road Corridor Survey",
    description: "Longitudinal profile, cross-sections, mass-haul earthworks, and setting-out for road construction.",
    icon: "🛣️",
    countryCode: "KE",
    surveyType: "road-corridor",
    workflowSteps: ["fieldbook", "traverse", "roaddesign", "engineering", "stakeout", "export"],
    defaults: {
      carriagewayWidth: 7.0,
      shoulderWidth: 1.5,
      camber: -2.5,
      cutSlope: "1:1.5",
      fillSlope: "1:2.0",
      chainageInterval: 20,
    },
  },
  {
    id: "cadastral",
    name: "Cadastral Survey",
    description: "Full cadastral survey with control traverse, detail, and statutory deed plan for land registration.",
    icon: "🗺️",
    countryCode: "KE",
    surveyType: "cadastral",
    workflowSteps: ["fieldbook", "traverse", "lsa", "cogo", "deedplan", "signing", "export"],
    defaults: {
      traverseMode: "ls-distance",
      includeGnssBaselines: true,
      deedPlanScale: "1:500",
      statutoryForm: "Form 3",
    },
  },
  {
    id: "setting-out",
    name: "Construction Setting-Out",
    description: "Set out building corners, road centerlines, or infrastructure from design coordinates.",
    icon: "🎯",
    countryCode: "KE",
    surveyType: "setting-out",
    workflowSteps: ["stakeout", "fieldbook", "asbuilt", "export"],
    defaults: {
      stakeoutMethod: "polar",
      asbuiltTolerance: 0.05,
    },
  },
  {
    id: "lulc",
    name: "Land Use Classification",
    description: "Classify land parcels using Kenya LULC categories with satellite/drone imagery.",
    icon: "🌾",
    countryCode: "KE",
    surveyType: "lulc",
    workflowSteps: ["lulc", "map", "export"],
    defaults: {
      classificationCategories: ["residential", "agricultural", "forest", "water", "grassland"],
    },
  },
  {
    id: "gnss-control",
    name: "GNSS Control Network",
    description: "Establish a control network with GNSS baselines, least-squares adjustment, and error ellipse analysis.",
    icon: "📡",
    countryCode: "KE",
    surveyType: "gnss-control",
    workflowSteps: ["gnss", "lsa", "map", "export"],
    defaults: {
      adjustmentMode: "ls-mixed",
      includeErrorEllipses: true,
      confidenceLevel: 0.95,
    },
  },
];
