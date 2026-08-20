/**
 * project-templates.ts — Pre-configured project templates for common Kenya survey types.
 *
 * Each template defines:
 *   - Default project settings (country, survey type, description)
 *   - Recommended views in workflow order
 *   - Pre-filled view-specific parameters
 *   - Fee estimation defaults
 *   - Regulatory references
 *
 * Templates help surveyors follow statutory workflows without
 * manually configuring each view.
 */

// ─── Types ────────────────────────────────────────────────────────

export interface ViewRecommendation {
  /** View ID (matches AppShell NAV items). */
  viewId: string;
  /** Human-readable label. */
  label: string;
  /** Why this view is needed in this workflow. */
  purpose: string;
  /** Whether this view is required vs optional. */
  required: boolean;
  /** Pre-filled parameters for the view (view-specific). */
  defaults?: Record<string, unknown>;
}

export interface ProjectTemplate {
  /** Unique template ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Short description of the survey type. */
  description: string;
  /** Icon emoji for quick recognition. */
  icon: string;
  /** Country code (most templates are KE-specific but some apply globally). */
  countryCode: string;
  /** Survey type string (matches StoredProject.surveyType). */
  surveyType: string;
  /** Recommended fee estimation parameters. */
  feeDefaults: {
    areaHa: number;
    beaconCount: number;
    traverseKm: number;
    terrainIndex: number;
  };
  /** Views in recommended workflow order. */
  views: ViewRecommendation[];
  /** Regulatory reference for this survey type. */
  regulatoryRef: string;
  /** Professional body. */
  professionalBody: string;
  /** Statutory notes — what the surveyor must comply with. */
  statutoryNotes: string[];
}

// ─── Templates ────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  // ── 1. Subdivision (Kenya) ───────────────────────────────────
  {
    id: "ke-subdivision",
    name: "Subdivision",
    description: "Split a parent parcel into smaller lots with new beacons, control traverse, and statutory deed plans per the Survey Act Cap. 299.",
    icon: "✂️",
    countryCode: "KE",
    surveyType: "cadastral",
    feeDefaults: { areaHa: 2.0, beaconCount: 8, traverseKm: 1.5, terrainIndex: 1 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project with cadastral survey type", required: true },
      { viewId: "traverse", label: "Traverse", purpose: "Run control traverse to establish survey framework", required: true, defaults: { mode: "bowditch", closingErrorTolerance: "1:5000" } },
      { viewId: "cogo", label: "COGO", purpose: "Compute new parcel boundaries by radiation and intersection", required: true, defaults: { mode: "radiation" } },
      { viewId: "subdivision", label: "Subdivision", purpose: "Design lot splits with road reserves and utility corridors", required: true },
      { viewId: "fieldbook", label: "Field Book", purpose: "Record field observations for beacon placement", required: true },
      { viewId: "lsa", label: "Network LSA", purpose: "Least-squares adjustment of traverse and GNSS baselines", required: false },
      { viewId: "deedplan", label: "Deed Plan", purpose: "Generate Form 3 statutory deed plan for registry submission", required: true },
      { viewId: "signing", label: "Sign & Seal", purpose: "Digital signature and PDF export for submission", required: true },
      { viewId: "export", label: "Export", purpose: "DXF, GeoJSON, LandXML export for NLIMS/ArdhiSasa", required: false },
      { viewId: "officemgmt", label: "Office & Billing", purpose: "Generate proforma invoice for client", required: false },
    ],
    regulatoryRef: "Survey Act Cap. 299; Land Registration Act 2012; LSB Scale of Fees",
    professionalBody: "Institution of Surveyors of Kenya (ISK)",
    statutoryNotes: [
      "All new beacons must be placed within ±0.05m of computed position",
      "Traverse closing error must not exceed 1:5,000 for urban, 1:3,000 for rural",
      "Deed plan must show all adjacent parcel references and beacon coordinates",
      "Form 3 (Mutation Form) required for subdivision lodged with Land Registry",
      "RSA-2048 digital signing required for electronic submission",
    ],
  },

  // ── 2. Boundary Re-establishment (Kenya) ─────────────────────
  {
    id: "ke-boundary",
    name: "Boundary Re-establishment",
    description: "Re-establish lost or disputed boundary beacons using existing survey records, title deeds, and field measurements.",
    icon: "📍",
    countryCode: "KE",
    surveyType: "cadastral",
    feeDefaults: { areaHa: 1.5, beaconCount: 4, traverseKm: 0.8, terrainIndex: 1 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project with cadastral survey type", required: true },
      { viewId: "map", label: "Map", purpose: "Locate existing beacons and parcel boundaries on basemap", required: true },
      { viewId: "traverse", label: "Traverse", purpose: "Control traverse from known reference marks", required: true, defaults: { mode: "bowditch" } },
      { viewId: "cogo", label: "COGO", purpose: "Compute expected beacon positions from title deed bearings/distances", required: true, defaults: { mode: "radiation" } },
      { viewId: "fieldbook", label: "Field Book", purpose: "Record measurements to existing and proposed beacon positions", required: true },
      { viewId: "lsa", label: "Network LSA", purpose: "Adjust observations to find best-fit beacon positions", required: false },
      { viewId: "deedplan", label: "Deed Plan", purpose: "Generate updated deed plan showing re-established beacons", required: true },
      { viewId: "signing", label: "Sign & Seal", purpose: "Certify beacon positions with digital signature", required: true },
    ],
    regulatoryRef: "Survey Act Cap. 299; Land Registration Act 2012",
    professionalBody: "Institution of Surveyors of Kenya (ISK)",
    statutoryNotes: [
      "Must reference original survey records from Survey of Kenya archives",
      "Both adjacent parcel owners must be notified per Section 16 of the Land Act",
      "Beacon certificate (Form 16) must be filed with the Chief Government Surveyor",
      "Disputed boundaries require a boundary award under the Arbitration Act",
    ],
  },

  // ── 3. Topographic Survey (Kenya) ────────────────────────────
  {
    id: "ke-topographic",
    name: "Topographic Survey",
    description: "Detailed terrain mapping with spot heights, contours, and features for engineering design or land use planning.",
    icon: "🏔️",
    countryCode: "KE",
    surveyType: "topographic",
    feeDefaults: { areaHa: 5.0, beaconCount: 0, traverseKm: 3.0, terrainIndex: 2 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project with topographic survey type", required: true },
      { viewId: "gnss", label: "GNSS Monitor", purpose: "RTK GNSS for control and detail point collection", required: true },
      { viewId: "fieldbook", label: "Field Book", purpose: "Record spot heights and feature codes", required: true },
      { viewId: "topo", label: "Topographic", purpose: "Generate TIN, contours, and terrain model", required: true },
      { viewId: "cogo", label: "COGO", purpose: "Compute area and perimeter of mapped features", required: false },
      { viewId: "lulc", label: "LULC Analysis", purpose: "Classify land use from survey data", required: false },
      { viewId: "export", label: "Export", purpose: "Export DXF/DWG for CAD, GeoTIFF for GIS", required: true },
      { viewId: "officemgmt", label: "Office & Billing", purpose: "Generate proforma invoice", required: false },
    ],
    regulatoryRef: "Survey Act Cap. 299; National Land Commission Guidelines",
    professionalBody: "Institution of Surveyors of Kenya (ISK)",
    statutoryNotes: [
      "Contour interval must be appropriate for scale (1m for 1:1000, 2m for 1:2000)",
      "All spot heights referenced to the Kenya Vertical Datum (m above IGD)",
      "Breaklines required for ridges, valleys, and watercourses",
      "Feature coding must follow Survey of Kenya feature code list",
    ],
  },

  // ── 4. Road Corridor Survey (Kenya) ──────────────────────────
  {
    id: "ke-road",
    name: "Road Corridor Survey",
    description: "Longitudinal profile, cross-sections, and earthworks calculation for road design and construction.",
    icon: "🛣️",
    countryCode: "KE",
    surveyType: "engineering",
    feeDefaults: { areaHa: 10.0, beaconCount: 0, traverseKm: 8.0, terrainIndex: 2 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project with engineering survey type", required: true },
      { viewId: "traverse", label: "Traverse", purpose: "Run road alignment traverse with chainage", required: true, defaults: { mode: "bowditch" } },
      { viewId: "fieldbook", label: "Field Book", purpose: "Record cross-section observations at chainage intervals", required: true },
      { viewId: "roaddesign", label: "Road Design", purpose: "Longitudinal profile, vertical curves, mass-haul diagram", required: true },
      { viewId: "crosssection", label: "Cross-Sections", purpose: "Design cross-sections with cut/fill calculations", required: true },
      { viewId: "engineering", label: "Engineering", purpose: "Earthworks volume calculation and balance analysis", required: true },
      { viewId: "topo", label: "Topographic", purpose: "Terrain model for corridor mapping", required: false },
      { viewId: "lsa", label: "Network LSA", purpose: "Adjust alignment traverse for precision", required: false },
      { viewId: "export", label: "Export", purpose: "Export alignment data for road design software", required: true },
      { viewId: "officemgmt", label: "Office & Billing", purpose: "Generate proforma invoice", required: false },
    ],
    regulatoryRef: "Kenya Roads Authority Design Standards; KNH Series",
    professionalBody: "Institution of Surveyors of Kenya (ISK); Kenya Institute of Highways and Building Technology (KIHBT)",
    statutoryNotes: [
      "Road reserve width per Kenya Roads Act (typically 20m for trunk roads)",
      "Cross-sections at 20m intervals minimum, 10m on curves",
      "Mass-haul diagram must show balance points for earthworks optimization",
      "Vertical curve design per AASHTO/KRA standards (K-value constraints)",
      "All chainages referenced to project datum and road alignment station",
    ],
  },

  // ── 5. Control Network Establishment (Kenya) ─────────────────
  {
    id: "ke-control",
    name: "Control Network Establishment",
    description: "Establish geodetic control network with GNSS baselines and least-squares adjustment for survey framework.",
    icon: "📐",
    countryCode: "KE",
    surveyType: "cadastral",
    feeDefaults: { areaHa: 0, beaconCount: 6, traverseKm: 5.0, terrainIndex: 1 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project for control network", required: true },
      { viewId: "gnss", label: "GNSS Monitor", purpose: "Static/rapid-static GNSS observations for baselines", required: true },
      { viewId: "lsa", label: "Network LSA", purpose: "Least-squares adjustment of GNSS baselines with covariance", required: true },
      { viewId: "traverse", label: "Traverse", purpose: "Supplementary traverse observations", required: false },
      { viewId: "fieldbook", label: "Field Book", purpose: "Record benchmark descriptions and recovery notes", required: true },
      { viewId: "map", label: "Map", purpose: "Visualize control network geometry and error ellipses", required: true },
      { viewId: "export", label: "Export", purpose: "Export control coordinates in KenCORS format", required: true },
    ],
    regulatoryRef: "Survey Act Cap. 299; KenCORS Guidelines; ETRS89/WGS84",
    professionalBody: "Institution of Surveyors of Kenya (ISK); Survey of Kenya",
    statutoryNotes: [
      "Minimum 4 hours static observation for primary control",
      "PDOP must be ≤ 4 during observation sessions",
      "Baarda data-snooping required before accepting adjusted coordinates",
      "Control marks must be permanent (concrete pillar or deep drove)",
      "Coordinates submitted to Survey of Kenya for inclusion in national framework",
    ],
  },

  // ── 6. Cadastral Mapping (Kenya) ─────────────────────────────
  {
    id: "ke-cadastral-map",
    name: "Cadastral Mapping",
    description: "Digitize and verify existing cadastral boundaries against registry records for land information system updates.",
    icon: "🗺️",
    countryCode: "KE",
    surveyType: "cadastral",
    feeDefaults: { areaHa: 3.0, beaconCount: 0, traverseKm: 2.0, terrainIndex: 1 },
    views: [
      { viewId: "projects", label: "Projects", purpose: "Create project for cadastral mapping", required: true },
      { viewId: "map", label: "Map", purpose: "Overlay existing parcels on satellite/basemap imagery", required: true },
      { viewId: "gnss", label: "GNSS Monitor", purpose: "Collect boundary corner coordinates with RTK", required: true },
      { viewId: "cogo", label: "COGO", purpose: "Compute parcel areas and verify against registry", required: true },
      { viewId: "deedplan", label: "Deed Plan", purpose: "Generate statutory plans for each parcel", required: true },
      { viewId: "lulc", label: "LULC Analysis", purpose: "Classify land use for planning overlays", required: false },
      { viewId: "export", label: "Export", purpose: "LandXML/GeoPackage for NLIMS/ArdhiSasa submission", required: true },
    ],
    regulatoryRef: "Survey Act Cap. 299; National Land Information Management System (NLIMS)",
    professionalBody: "Institution of Surveyors of Kenya (ISK); National Land Commission",
    statutoryNotes: [
      "All coordinates must be in Arc 1960 UTM zone 37S (Kenya standard)",
      "Parcel boundaries must match title deed descriptions within ±0.1m",
      "Digital submission to ArdhiSasa requires LandXML 1.2 format",
      "Adjacent parcel boundaries must be consistent (no gaps or overlaps)",
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────

/** Get all templates for a specific country. */
export function getTemplatesForCountry(countryCode: string): ProjectTemplate[] {
  return PROJECT_TEMPLATES.filter((t) => t.countryCode === countryCode);
}

/** Get a template by ID. */
export function getTemplateById(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

/** Get all unique country codes across templates. */
export function getTemplateCountryCodes(): string[] {
  return [...new Set(PROJECT_TEMPLATES.map((t) => t.countryCode))];
}
