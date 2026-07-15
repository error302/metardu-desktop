/**
 * Survey Report Generator — RDM 1.1 compliant.
 *
 * Generates a complete survey report containing:
 *   - Project metadata (name, location, surveyor, date)
 *   - Control point summary (coordinates, method, accuracy)
 *   - Traverse computation sheet (observed/adjusted bearings, distances, coords)
 *   - Leveling computation sheet (BS/FS, rise/fall, adjusted elevations)
 *   - Area computation sheet (shoelace, coordinates)
 *   - Coordinate schedule (all points with E/N/H)
 *   - Accuracy analysis (misclosures, precision ratios, error ellipses)
 *   - Equipment used (total station, GNSS, level)
 *   - Compliance check (RDM 1.1 / Cap. 299 tolerances)
 *   - Surveyor's certificate (with RSA-2048 seal)
 *
 * Output: JSON structure (consumed by the PDF renderer)
 *
 * References:
 *   - RDM 1.1 (Kenya Roads Design Manual, 2025) — Survey Report format
 *   - Survey Act Cap. 299 — Statutory requirements
 *   - ISK Practice Notes — Professional survey reporting
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface SurveyReportInput {
  // Project metadata
  projectName: string;
  projectRef?: string;
  surveyType: "cadastral" | "engineering" | "topographic" | "control" | "drone";
  location: string;
  county?: string;
  country: string;
  surveyDate: string;
  surveyorName: string;
  surveyorLicense?: string;
  firmName?: string;
  // CRS
  crsEpsg: number;
  crsName: string;
  // Equipment
  equipment: EquipmentUsed[];
  // Control points
  controlPoints: ControlPointInfo[];
  // Traverse
  traverse?: TraverseSheet;
  // Leveling
  leveling?: LevelingSheet;
  // Area
  area?: AreaSheet;
  // Coordinate schedule
  coordinates: CoordinateEntry[];
  // Accuracy
  accuracy: AccuracyReport;
  // Compliance
  compliance: ComplianceCheck;
}

export interface EquipmentUsed {
  type: "total_station" | "gnss_rtk" | "gnss_ppk" | "digital_level" | "drone" | "eddm";
  make: string;
  model: string;
  serialNumber: string;
  calibrationDate?: string;
}

export interface ControlPointInfo {
  pointId: string;
  easting: number;
  northing: number;
  elevation: number;
  method: "gnss_rtk" | "gnss_ppk" | "traverse" | "known";
  accuracyClass: "1st" | "2nd" | "3rd" | "secondary";
}

export interface TraverseSheet {
  name: string;
  method: "bowditch" | "transit" | "lsa";
  legs: TraverseLegEntry[];
  misclosure: { linear: number; angular: number };
  precision: string; // "1:10000"
  passesTolerance: boolean;
}

export interface TraverseLegEntry {
  fromStation: string;
  toStation: string;
  observedBearing: number;
  observedDistance: number;
  adjustedBearing: number;
  adjustedDistance: number;
  latitude: number;
  departure: number;
}

export interface LevelingSheet {
  lineName: string;
  method: "rise_fall" | "height_of_collimation";
  observations: LevelEntry[];
  misclosure: number; // mm
  tolerance: number;  // mm
  passes: boolean;
}

export interface LevelEntry {
  station: string;
  backsight: number;
  foresight: number;
  rise: number;
  fall: number;
  reducedLevel: number;
  adjustedRL: number;
}

export interface AreaSheet {
  parcelName: string;
  method: "shoelace" | "coordinate" | "trapezoidal";
  vertices: Array<{ pointId: string; easting: number; northing: number }>;
  areaSqM: number;
  areaHectares: number;
  perimeter: number;
}

export interface CoordinateEntry {
  pointId: string;
  easting: number;
  northing: number;
  elevation: number;
  code: string;
  description?: string;
}

export interface AccuracyReport {
  horizontalRms: number;
  verticalRms: number;
  maxErrorEllipse: number;
  precisionRatio: string;
  meetsTolerance: boolean;
}

export interface ComplianceCheck {
  standard: string;
  requirements: Array<{
    name: string;
    required: string;
    achieved: string;
    passes: boolean;
  }>;
  overallPass: boolean;
}

export interface SurveyReport {
  metadata: {
    generatedAt: string;
    version: string;
  };
  project: SurveyReportInput;
  summary: {
    totalPoints: number;
    totalTraverses: number;
    totalLevelLines: number;
    areaComputed: boolean;
    overallPass: boolean;
  };
}

// ─── Report generation ─────────────────────────────────────────────

export function generateSurveyReport(input: SurveyReportInput): SurveyReport {
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: "2.0.0",
    },
    project: input,
    summary: {
      totalPoints: input.coordinates.length,
      totalTraverses: input.traverse ? 1 : 0,
      totalLevelLines: input.leveling ? 1 : 0,
      areaComputed: input.area !== undefined,
      overallPass: input.compliance.overallPass,
    },
  };
}

// ─── RDM 1.1 compliance template ──────────────────────────────────

export function rdmComplianceTemplate(surveyType: string): ComplianceCheck {
  const requirements = {
    cadastral: [
      { name: "Angular misclosure", required: "15″ × √N", achieved: "", passes: false },
      { name: "Linear misclosure (urban)", required: "1:10,000", achieved: "", passes: false },
      { name: "Linear misclosure (rural)", required: "1:5,000", achieved: "", passes: false },
      { name: "Levelling closure", required: "10√K mm", achieved: "", passes: false },
      { name: "Beacon placement", required: "Per Cap. 299 §14", achieved: "", passes: false },
      { name: "Form No. 4 generated", required: "Yes", achieved: "", passes: false },
      { name: "RSA-2048 seal applied", required: "Yes", achieved: "", passes: false },
    ],
    engineering: [
      { name: "Horizontal accuracy", required: "±10mm (precise)", achieved: "", passes: false },
      { name: "Vertical accuracy", required: "±5mm (precise)", achieved: "", passes: false },
      { name: "Levelling closure", required: "10√K mm", achieved: "", passes: false },
      { name: "Curve set-out checked", required: "TS/SC/CS/ST", achieved: "", passes: false },
      { name: "Cross-sections computed", required: "Per RDM 1.1 §9", achieved: "", passes: false },
      { name: "Mass-haul diagram", required: "Per RDM 1.1 §8", achieved: "", passes: false },
    ],
    topographic: [
      { name: "Spot density", required: "Per survey type", achieved: "", passes: false },
      { name: "Contour interval", required: "0.5m or 1.0m", achieved: "", passes: false },
      { name: "Feature coding", required: "SoK standard codes", achieved: "", passes: false },
      { name: "Breaklines captured", required: "Yes", achieved: "", passes: false },
      { name: "DTM generated", required: "TIN with breaklines", achieved: "", passes: false },
    ],
    control: [
      { name: "1st order horizontal", required: "1:100,000", achieved: "", passes: false },
      { name: "1st order vertical", required: "2√K mm", achieved: "", passes: false },
      { name: "GNSS baseline ratio", required: "< 1:100,000", achieved: "", passes: false },
      { name: "LSA performed", required: "Yes", achieved: "", passes: false },
      { name: "Error ellipses computed", required: "95% confidence", achieved: "", passes: false },
    ],
    drone: [
      { name: "GCP distribution", required: "1 per 5ha, quadrant coverage", achieved: "", passes: false },
      { name: "GCP residual (horizontal)", required: "≤ 2× GSD", achieved: "", passes: false },
      { name: "GCP residual (vertical)", required: "≤ 3× GSD", achieved: "", passes: false },
      { name: "Front overlap", required: "≥ 75%", achieved: "", passes: false },
      { name: "Side overlap", required: "≥ 65%", achieved: "", passes: false },
      { name: "ASPRS class achieved", required: "Class I or II", achieved: "", passes: false },
    ],
  };

  const reqs = requirements[surveyType as keyof typeof requirements] ?? requirements.topographic;

  return {
    standard: `RDM 1.1 / Survey Act Cap. 299 — ${surveyType} survey`,
    requirements: reqs.map(r => ({ ...r, achieved: r.achieved || "—" })),
    overallPass: reqs.every(r => r.passes),
  };
}
