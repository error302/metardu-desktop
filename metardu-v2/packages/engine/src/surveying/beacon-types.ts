/**
 * Beacon Type Classification for MetaRDU Desktop v2.0.
 *
 * Implements Kenya Survey Regulations 1994, R.37-49:
 *   - Standard boundary beacon
 *   - Line beacon (rectilinear meets curvilinear)
 *   - River beacon (above flood level)
 *   - Indicatory beacon (inaccessible ground)
 *   - Trigonometrical station
 *   - Fundamental benchmark
 *   - Reference mark
 *
 * References:
 *   - Kenya Survey Regulations 1994, Part VI (R.37-49)
 *   - Survey Act Cap 299, S.24-29 (Preservation of Survey Marks)
 */

// ─── Types ─────────────────────────────────────────────────────────

/** All supported beacon types per Kenya Survey Regulations. */
export type BeaconType =
  | "standard"       // R.38: Standard boundary beacon
  | "line"           // R.40: Line beacon (rectilinear meets curvilinear)
  | "river"          // R.40(3): River beacon (above flood level)
  | "indicatory"     // R.44(3): Indicatory beacon (inaccessible ground)
  | "trig-station"   // R.25: Trigonometrical station
  | "benchmark"      // R.25: Fundamental benchmark
  | "reference-mark" // R.39: Underground reference mark
  | "building-corner";// R.44(1): Building corner adopted as beacon

/** Beacon material/construction type. */
export type BeaconMaterial =
  | "pillar"          // Concrete pillar with disc
  | "peg"             // Wooden/metal peg
  | "pipe"            // Steel pipe
  | "disc"            // Brass/steel disc in rock
  | "cairn"           // Cairn of stones (R.38)
  | "mound"           // Mound of earth (R.38)
  | "underground"     // Underground mark (R.39)
  | "building-corner" // Corner of permanent building (R.44(1))

export interface BeaconDefinition {
  /** Unique beacon label (e.g., "B-101", "BM-KEN-001") */
  label: string;
  /** Beacon type */
  type: BeaconType;
  /** Material/construction */
  material: BeaconMaterial;
  /** Easting in metres */
  easting: number;
  /** Northing in metres */
  northing: number;
  /** Elevation in metres (optional) */
  elevation?: number;
  /** Description of the beacon location */
  description: string;
  /** Whether the beacon is newly placed or existing */
  status: "new" | "existing" | "re-established" | "repaired" | "missing";
  /** Reference marks (for non-standard beacons) */
  referenceMarks?: ReferenceMark[];
  /** Additional notes (e.g., "above flood level", "building corner") */
  notes?: string;
  /** Date placed/re-established */
  datePlaced?: string;
  /** Surveyor who placed the beacon */
  placedBy?: string;
}

export interface ReferenceMark {
  /** Reference mark label */
  label: string;
  /** Distance from beacon in metres */
  distanceM: number;
  /** Bearing from beacon in degrees */
  bearingDeg: number;
  /** Description (e.g., "underground disc", "nearby tree") */
  description: string;
}

// ─── Validation Rules per Kenya Survey Regulations ─────────────────

export interface BeaconTypeRule {
  type: BeaconType;
  /** Regulation reference */
  regulation: string;
  /** When this beacon type should be used */
  useCase: string;
  /** Required reference marks */
  requiredReferences: number;
  /** Whether the beacon must be permanent */
  mustBePermanent: boolean;
  /** Whether the beacon must be intervisible with adjacent beacons */
  mustBeIntervisible: boolean;
  /** Special requirements */
  specialRequirements: string[];
}

/** Rules for each beacon type per Kenya Survey Regulations. */
export const BEACON_TYPE_RULES: Record<BeaconType, BeaconTypeRule> = {
  "standard": {
    type: "standard",
    regulation: "R.38",
    useCase: "Normal boundary beacon for defining property corners",
    requiredReferences: 1,
    mustBePermanent: true,
    mustBeIntervisible: true,
    specialRequirements: [
      "Surmounted by a cairn of stones or mound of earth",
      "Primary consideration is durability",
      "Fineness of mark appropriate to purpose",
    ],
  },
  "line": {
    type: "line",
    regulation: "R.40(1-2)",
    useCase: "Where rectilinear boundary intersects curvilinear boundary and beacon cannot be placed at intersection",
    requiredReferences: 1,
    mustBePermanent: true,
    mustBeIntervisible: true,
    specialRequirements: [
      "Placed on rectilinear boundary as near as practicable to intersection",
      "If rectilinear boundary continues on both sides, place on both sections",
      "Distances measured to precision required by R.88(3)",
    ],
  },
  "river": {
    type: "river",
    regulation: "R.40(3)",
    useCase: "Where curvilinear boundary falls within a river or swamp",
    requiredReferences: 1,
    mustBePermanent: true,
    mustBeIntervisible: false,
    specialRequirements: [
      "Placed ABOVE flood level",
      "Called a 'river beacon'",
      "Distances measured to precision required by R.88(3)",
    ],
  },
  "indicatory": {
    type: "indicatory",
    regulation: "R.44(3)",
    useCase: "Where plot corner falls within inaccessible ground where beacon cannot be placed",
    requiredReferences: 0,
    mustBePermanent: true,
    mustBeIntervisible: false,
    specialRequirements: [
      "Position permanently referenced by at least one indicatory beacon",
      "Placed on boundary line as near as possible to corner",
      "Details indicated on plan",
    ],
  },
  "trig-station": {
    type: "trig-station",
    regulation: "R.25, R.52",
    useCase: "Geodetic or secondary triangulation control point",
    requiredReferences: 2,
    mustBePermanent: true,
    mustBeIntervisible: true,
    specialRequirements: [
      "Controlled by Director of Surveys",
      "Normally performed by Government surveyors",
      "Site within 20 feet of centre-mark (S.25)",
      "Right-of-way to and from station",
    ],
  },
  "benchmark": {
    type: "benchmark",
    regulation: "R.25, S.25",
    useCase: "Fundamental benchmark for vertical control",
    requiredReferences: 2,
    mustBePermanent: true,
    mustBeIntervisible: false,
    specialRequirements: [
      "Site within 20 feet of pillar centre (S.25)",
      "Right-of-way to and from benchmark",
      "No blasting within reserved area (S.26)",
    ],
  },
  "reference-mark": {
    type: "reference-mark",
    regulation: "R.39",
    useCase: "Underground mark to re-establish boundary beacons",
    requiredReferences: 0,
    mustBePermanent: true,
    mustBeIntervisible: false,
    specialRequirements: [
      "Permanent underground mark in vicinity of beacon",
      "Position least likely to be disturbed",
      "May use two existing nearby beacons instead",
      "Verify position of previously placed reference marks",
    ],
  },
  "building-corner": {
    type: "building-corner",
    regulation: "R.44(1)",
    useCase: "Where plot corner coincides with corner of permanent building",
    requiredReferences: 1,
    mustBePermanent: true,
    mustBeIntervisible: false,
    specialRequirements: [
      "Building corner must be permanent and permanent",
      "Corner surveyed and adopted as beacon",
      "If too close for standard beacon, position relative to plot corner established",
      "Details indicated on plan",
    ],
  },
};

// ─── Classification Functions ───────────────────────────────────────

/**
 * Classify a beacon based on its context and properties.
 *
 * @example
 * ```ts
 * const type = classifyBeacon({
 *   isOnBoundary: true,
 *   intersectsCurvilinear: true,
 *   isAccessible: false,
 *   hasPermanentBuilding: false,
 *   isInRiver: false,
 * });
 * // type = "line"
 * ```
 */
export function classifyBeacon(context: {
  isOnBoundary: boolean;
  intersectsCurvilinear: boolean;
  isAccessible: boolean;
  hasPermanentBuilding: boolean;
  isBuildingCornerPermanent: boolean;
  isInRiver: boolean;
  isAboveFloodLevel: boolean;
  isTrigStation: boolean;
  isBenchmark: boolean;
  isReferenceMark: boolean;
}): BeaconType {
  // Priority order per Survey Regulations
  if (context.isTrigStation) return "trig-station";
  if (context.isBenchmark) return "benchmark";
  if (context.isReferenceMark) return "reference-mark";
  if (context.hasPermanentBuilding && context.isBuildingCornerPermanent) return "building-corner";
  if (context.isInRiver && context.isAboveFloodLevel) return "river";
  if (!context.isAccessible && context.isOnBoundary) return "indicatory";
  if (context.intersectsCurvilinear && context.isOnBoundary) return "line";
  return "standard";
}

/**
 * Get the validation rule for a beacon type.
 */
export function getBeaconRule(type: BeaconType): BeaconTypeRule {
  return BEACON_TYPE_RULES[type];
}

/**
 * Validate a beacon against its type rules.
 */
export function validateBeacon(beacon: BeaconDefinition): {
  valid: boolean;
  violations: string[];
} {
  const rule = BEACON_TYPE_RULES[beacon.type];
  const violations: string[] = [];

  // Check reference mark requirement
  const refCount = beacon.referenceMarks?.length ?? 0;
  if (refCount < rule.requiredReferences) {
    violations.push(
      `${rule.regulation}: Requires ${rule.requiredReferences} reference mark(s), found ${refCount}`,
    );
  }

  // Check notes for river beacon
  if (beacon.type === "river") {
    const notes = (beacon.notes ?? "").toLowerCase();
    if (!notes.includes("flood") && !notes.includes("above")) {
      violations.push(
        "R.40(3): River beacon must note that it is above flood level",
      );
    }
  }

  // Check material for standard beacon
  if (beacon.type === "standard" && beacon.material !== "pillar" && beacon.material !== "peg" && beacon.material !== "pipe") {
    // Cairn or mound are acceptable per R.38
    if (beacon.material !== "cairn" && beacon.material !== "mound") {
      violations.push(
        "R.38: Standard beacon should be surmounted by cairn of stones or mound of earth",
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Generate a beacon summary for survey reports.
 */
export function generateBeaconSummary(beacons: BeaconDefinition[]): {
  total: number;
  byType: Record<BeaconType, number>;
  byStatus: Record<string, number>;
  needsVerification: BeaconDefinition[];
} {
  const byType: Record<BeaconType, number> = {
    "standard": 0,
    "line": 0,
    "river": 0,
    "indicatory": 0,
    "trig-station": 0,
    "benchmark": 0,
    "reference-mark": 0,
    "building-corner": 0,
  };

  const byStatus: Record<string, number> = {};

  for (const b of beacons) {
    byType[b.type]++;
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  }

  const needsVerification = beacons.filter(
    (b) => b.status === "new" || b.status === "re-established",
  );

  return {
    total: beacons.length,
    byType,
    byStatus,
    needsVerification,
  };
}
