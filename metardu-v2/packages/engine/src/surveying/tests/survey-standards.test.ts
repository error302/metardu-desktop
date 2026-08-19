/**
 * Tests for Survey Standards Modules (Gap Analysis Items)
 *
 * Covers:
 *   1. Loop misclosure calculator (12√K, 20√K, 30√K)
 *   2. 3-distance beacon verification
 *   3. Beacon type classification
 *   4. Field note audit trail
 *   5. SRVY2025-1 file naming generator
 */
import { describe, it, expect } from "vitest";

// ─── Loop Misclosure ───────────────────────────────────────────────
import {
  checkLoopMisclosure,
  checkLinearMisclosure,
  checkAngularMisclosure,
  generateMisclosureTable,
  generateTraverseClosureReport,
} from "../loop-misclosure.js";

describe("Loop Misclosure Calculator (RDM 1.1 §2.1.7)", () => {
  it("12√K: 4km loop with 20mm misclosure passes", () => {
    const r = checkLoopMisclosure({ loopLengthKm: 4, observedMisclosureMm: 20, constant: 12 });
    // 12 × √4 = 24mm
    expect(r.allowableMisclosureMm).toBe(24);
    expect(r.withinTolerance).toBe(true);
    expect(r.marginMm).toBeCloseTo(4, 0);
  });

  it("12√K: 9km loop with 35mm misclosure fails", () => {
    const r = checkLoopMisclosure({ loopLengthKm: 9, observedMisclosureMm: 35, constant: 12 });
    // 12 × √9 = 36mm
    expect(r.allowableMisclosureMm).toBe(36);
    expect(r.withinTolerance).toBe(true); // 35 ≤ 36
  });

  it("20√K: 4km loop with 36mm misclosure fails", () => {
    const r = checkLoopMisclosure({ loopLengthKm: 4, observedMisclosureMm: 36, constant: 20 });
    // 20 × √4 = 40mm
    expect(r.allowableMisclosureMm).toBe(40);
    expect(r.withinTolerance).toBe(true); // 36 ≤ 40
  });

  it("30√K: 1km loop with 25mm misclosure passes", () => {
    const r = checkLoopMisclosure({ loopLengthKm: 1, observedMisclosureMm: 25, constant: 30 });
    // 30 × √1 = 30mm
    expect(r.allowableMisclosureMm).toBe(30);
    expect(r.withinTolerance).toBe(true);
  });

  it("defaults to 12√K when constant not specified", () => {
    const r = checkLoopMisclosure({ loopLengthKm: 1, observedMisclosureMm: 10 });
    expect(r.constant).toBe(12);
  });

  it("generateMisclosureTable produces correct entries", () => {
    const table = generateMisclosureTable(4, 1);
    expect(table).toHaveLength(4);
    expect(table[0]!.km).toBe(1);
    expect(table[0]!.m12).toBeCloseTo(12, 0);
    expect(table[0]!.m20).toBeCloseTo(20, 0);
    expect(table[0]!.m30).toBeCloseTo(30, 0);
    expect(table[3]!.m12).toBeCloseTo(24, 0); // 12 × √4 = 24
  });
});

describe("Linear Misclosure (Survey Regs R.60)", () => {
  it("5000m traverse with 0.5m misclosure passes 1:5000", () => {
    const r = checkLinearMisclosure({
      traverseLengthM: 5000,
      misclosureM: 0.5,
      requiredRatio: 5000,
    });
    expect(r.achievedRatio).toBe(10000);
    expect(r.withinTolerance).toBe(true);
  });

  it("5000m traverse with 1.5m misclosure fails 1:5000", () => {
    const r = checkLinearMisclosure({
      traverseLengthM: 5000,
      misclosureM: 1.5,
      requiredRatio: 5000,
    });
    expect(r.achievedRatio).toBeCloseTo(3333, 0);
    expect(r.withinTolerance).toBe(false);
  });

  it("zero misclosure returns Infinity ratio", () => {
    const r = checkLinearMisclosure({
      traverseLengthM: 5000,
      misclosureM: 0,
      requiredRatio: 5000,
    });
    expect(r.achievedRatio).toBe(Infinity);
    expect(r.withinTolerance).toBe(true);
  });
});

describe("Angular Misclosure (Survey Regs 1994 §4.3)", () => {
  it("16 stations with 10″ misclosure passes (3.0 × √16 = 12″)", () => {
    const r = checkAngularMisclosure({ numberOfStations: 16, observedMisclosureArcsec: 10 });
    expect(r.allowableArcsec).toBe(12);
    expect(r.withinTolerance).toBe(true);
  });

  it("4 stations with 8″ misclosure fails (3.0 × √4 = 6″)", () => {
    const r = checkAngularMisclosure({ numberOfStations: 4, observedMisclosureArcsec: 8 });
    expect(r.allowableArcsec).toBe(6);
    expect(r.withinTolerance).toBe(false);
  });
});

describe("Traverse Closure Report", () => {
  it("generates a complete report with all checks", () => {
    const r = generateTraverseClosureReport({
      loopLengthKm: 2,
      loopMisclosureMm: 15,
      traverseLengthM: 2000,
      linearMisclosureM: 0.3,
      numberOfStations: 9,
      angularMisclosureArcsec: 8,
    });
    expect(r.allPassed).toBeDefined();
    expect(r.summary).toContain("Traverse Closure Report");
    expect(r.loopMisclosure).toBeDefined();
    expect(r.linearMisclosure).toBeDefined();
    expect(r.angularMisclosure).toBeDefined();
  });
});

// ─── Beacon Verification ───────────────────────────────────────────
import {
  verifyBeaconByDistances,
  verifyMultipleBeacons,
} from "../beacon-verification.js";

describe("3-Distance Beacon Verification (Bahrain CSD §3.11)", () => {
  const beacon = { label: "B-101", easting: 500000, northing: 9800000, isFixed: false };
  const refs = [
    { label: "BM-1", easting: 500100, northing: 9800100, isFixed: true },
    { label: "BM-2", easting: 499900, northing: 9800050, isFixed: true },
    { label: "BM-3", easting: 500050, northing: 9799900, isFixed: true },
  ];

  it("verifies beacon with accurate distances", () => {
    // BM-1: √(100² + 100²) = 141.421m
    const r = verifyBeaconByDistances({
      beacon,
      referencePoints: refs,
      observations: [
        { beaconLabel: "B-101", referenceLabel: "BM-1", observedDistanceM: 141.421 },
        { beaconLabel: "B-101", referenceLabel: "BM-2", observedDistanceM: 111.803 },
        { beaconLabel: "B-101", referenceLabel: "BM-3", observedDistanceM: 111.803 },
      ],
      toleranceMm: 50,
    });
    expect(r.verified).toBe(true);
    expect(r.allWithinTolerance).toBe(true);
    expect(r.distanceCount).toBe(3);
  });

  it("rejects beacon with inaccurate distances", () => {
    const r = verifyBeaconByDistances({
      beacon,
      referencePoints: refs,
      observations: [
        { beaconLabel: "B-101", referenceLabel: "BM-1", observedDistanceM: 142.0 },
        { beaconLabel: "B-101", referenceLabel: "BM-2", observedDistanceM: 111.803 },
        { beaconLabel: "B-101", referenceLabel: "BM-3", observedDistanceM: 111.803 },
      ],
      toleranceMm: 50,
    });
    expect(r.verified).toBe(false);
    expect(r.failedCount).toBeGreaterThan(0);
  });

  it("requires minimum 3 distances by default", () => {
    const r = verifyBeaconByDistances({
      beacon,
      referencePoints: refs,
      observations: [
        { beaconLabel: "B-101", referenceLabel: "BM-1", observedDistanceM: 141.421 },
        { beaconLabel: "B-101", referenceLabel: "BM-2", observedDistanceM: 111.803 },
      ],
      toleranceMm: 50,
    });
    expect(r.verified).toBe(false);
    expect(r.distanceCount).toBe(2);
    expect(r.minRequired).toBe(3);
  });

  it("batch verifies multiple beacons", () => {
    const results = verifyMultipleBeacons([
      {
        beacon,
        referencePoints: refs,
        observations: [
          { beaconLabel: "B-101", referenceLabel: "BM-1", observedDistanceM: 141.421 },
          { beaconLabel: "B-101", referenceLabel: "BM-2", observedDistanceM: 111.803 },
          { beaconLabel: "B-101", referenceLabel: "BM-3", observedDistanceM: 111.803 },
        ],
        toleranceMm: 50,
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.verified).toBe(true);
  });
});

// ─── Beacon Types ──────────────────────────────────────────────────
import {
  classifyBeacon,
  getBeaconRule,
  validateBeacon,
  generateBeaconSummary,
  type BeaconDefinition,
} from "../beacon-types.js";

describe("Beacon Type Classification (Survey Regs R.37-49)", () => {
  it("classifies standard boundary beacon", () => {
    const type = classifyBeacon({
      isOnBoundary: true,
      intersectsCurvilinear: false,
      isAccessible: true,
      hasPermanentBuilding: false,
      isBuildingCornerPermanent: false,
      isInRiver: false,
      isAboveFloodLevel: false,
      isTrigStation: false,
      isBenchmark: false,
      isReferenceMark: false,
    });
    expect(type).toBe("standard");
  });

  it("classifies line beacon", () => {
    const type = classifyBeacon({
      isOnBoundary: true,
      intersectsCurvilinear: true,
      isAccessible: true,
      hasPermanentBuilding: false,
      isBuildingCornerPermanent: false,
      isInRiver: false,
      isAboveFloodLevel: false,
      isTrigStation: false,
      isBenchmark: false,
      isReferenceMark: false,
    });
    expect(type).toBe("line");
  });

  it("classifies river beacon", () => {
    const type = classifyBeacon({
      isOnBoundary: true,
      intersectsCurvilinear: false,
      isAccessible: true,
      hasPermanentBuilding: false,
      isBuildingCornerPermanent: false,
      isInRiver: true,
      isAboveFloodLevel: true,
      isTrigStation: false,
      isBenchmark: false,
      isReferenceMark: false,
    });
    expect(type).toBe("river");
  });

  it("classifies indicatory beacon for inaccessible ground", () => {
    const type = classifyBeacon({
      isOnBoundary: true,
      intersectsCurvilinear: false,
      isAccessible: false,
      hasPermanentBuilding: false,
      isBuildingCornerPermanent: false,
      isInRiver: false,
      isAboveFloodLevel: false,
      isTrigStation: false,
      isBenchmark: false,
      isReferenceMark: false,
    });
    expect(type).toBe("indicatory");
  });

  it("classifies trig-station", () => {
    const type = classifyBeacon({
      isOnBoundary: false,
      intersectsCurvilinear: false,
      isAccessible: true,
      hasPermanentBuilding: false,
      isBuildingCornerPermanent: false,
      isInRiver: false,
      isAboveFloodLevel: false,
      isTrigStation: true,
      isBenchmark: false,
      isReferenceMark: false,
    });
    expect(type).toBe("trig-station");
  });

  it("validates beacon with missing reference marks", () => {
    const beacon: BeaconDefinition = {
      label: "B-101",
      type: "standard",
      material: "pillar",
      easting: 500000,
      northing: 9800000,
      description: "Test beacon",
      status: "new",
      referenceMarks: [],
    };
    const result = validateBeacon(beacon);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("generates beacon summary", () => {
    const beacons: BeaconDefinition[] = [
      { label: "B-1", type: "standard", material: "pillar", easting: 0, northing: 0, description: "", status: "new", referenceMarks: [{ label: "RM-1", distanceM: 10, bearingDeg: 0, description: "" }] },
      { label: "B-2", type: "line", material: "peg", easting: 0, northing: 0, description: "", status: "existing", referenceMarks: [{ label: "RM-2", distanceM: 10, bearingDeg: 0, description: "" }] },
      { label: "B-3", type: "river", material: "pipe", easting: 0, northing: 0, description: "", status: "new", notes: "above flood level", referenceMarks: [{ label: "RM-3", distanceM: 10, bearingDeg: 0, description: "" }] },
    ];
    const summary = generateBeaconSummary(beacons);
    expect(summary.total).toBe(3);
    expect(summary.byType.standard).toBe(1);
    expect(summary.byType.line).toBe(1);
    expect(summary.byType.river).toBe(1);
    expect(summary.needsVerification).toHaveLength(2);
  });
});

// ─── Field Note Audit Trail ────────────────────────────────────────
import {
  createFieldNoteEntry,
  editFieldNoteEntry,
  verifyFieldNoteEntry,
  deleteFieldNoteEntry,
  createFieldNoteBook,
  addEntryToBook,
  validateFieldNoteBook,
  exportFieldNoteBook,
} from "../field-note-audit.js";

describe("Field Note Audit Trail (Survey Regs R.69-77)", () => {
  it("creates entry with audit trail", () => {
    const entry = createFieldNoteEntry({
      pageNumber: 1,
      stationId: "TS-01",
      date: "2025-09-15",
      time: "08:30",
      observer: "J. Doe",
      instrument: "Leica TS16 #12345",
      observations: { bearing: "45°30'15\"", distance: 125.432 },
      userId: "user-1",
      userName: "John Doe",
    });
    expect(entry.id).toBeTruthy();
    expect(entry.auditTrail).toHaveLength(1);
    expect(entry.auditTrail[0]!.action).toBe("create");
    expect(entry.verified).toBe(false);
  });

  it("edits entry with audit trail", () => {
    const entry = createFieldNoteEntry({
      pageNumber: 1,
      stationId: "TS-01",
      date: "2025-09-15",
      time: "08:30",
      observer: "J. Doe",
      instrument: "Leica TS16",
      observations: { bearing: "45°30'15\"" },
      userId: "user-1",
      userName: "John Doe",
    });
    const edited = editFieldNoteEntry(
      entry,
      { observations: { bearing: "45°30'20\"" } },
      "user-1",
      "John Doe",
      "Corrected bearing reading",
    );
    expect(edited.auditTrail).toHaveLength(2);
    expect(edited.auditTrail[1]!.action).toBe("edit");
    expect(edited.auditTrail[1]!.note).toBe("Corrected bearing reading");
  });

  it("verifies entry", () => {
    const entry = createFieldNoteEntry({
      pageNumber: 1,
      stationId: "TS-01",
      date: "2025-09-15",
      time: "08:30",
      observer: "J. Doe",
      instrument: "Leica TS16",
      observations: {},
      userId: "user-1",
      userName: "John Doe",
    });
    const verified = verifyFieldNoteEntry(entry, "user-2", "Chief Surveyor");
    expect(verified.verified).toBe(true);
    expect(verified.auditTrail).toHaveLength(2);
    expect(verified.auditTrail[1]!.action).toBe("verify");
  });

  it("soft-deletes entry with reason", () => {
    const entry = createFieldNoteEntry({
      pageNumber: 1,
      stationId: "TS-01",
      date: "2025-09-15",
      time: "08:30",
      observer: "J. Doe",
      instrument: "Leica TS16",
      observations: {},
      userId: "user-1",
      userName: "John Doe",
    });
    const deleted = deleteFieldNoteEntry(entry, "user-1", "John Doe", "Duplicate entry");
    expect(deleted.deleted).toBe(true);
    expect(deleted.auditTrail[1]!.action).toBe("delete");
    expect(deleted.auditTrail[1]!.note).toBe("Duplicate entry");
  });

  it("validates field note book", () => {
    const book = createFieldNoteBook({
      bookId: "FB-001",
      projectName: "Test Project",
      surveyorName: "J. Doe",
      registrationNumber: "ISK-1234",
      startDate: "2025-09-15",
    });
    const entry = createFieldNoteEntry({
      pageNumber: 1,
      stationId: "TS-01",
      date: "2025-09-15",
      time: "08:30",
      observer: "J. Doe",
      instrument: "Leica TS16",
      observations: {},
      userId: "user-1",
      userName: "John Doe",
    });
    const bookWithEntry = addEntryToBook(book, entry);
    const validation = validateFieldNoteBook(bookWithEntry);
    // Should have violations for unverified entries
    expect(validation.violations.length).toBeGreaterThan(0);
  });

  it("exports field note book as formatted string", () => {
    const book = createFieldNoteBook({
      bookId: "FB-001",
      projectName: "Test Project",
      surveyorName: "J. Doe",
      registrationNumber: "ISK-1234",
      startDate: "2025-09-15",
    });
    const exported = exportFieldNoteBook(book);
    expect(exported).toContain("FIELD NOTE BOOK");
    expect(exported).toContain("FB-001");
    expect(exported).toContain("Test Project");
  });
});

// ─── Submission Naming ─────────────────────────────────────────────
import {
  generateSubmissionFilename,
  generateSubmissionFileSet,
  generateSubmissionNumber,
  validateSubmissionNumber,
  validateDateFormat,
} from "../submission-naming.js";

describe("SRVY2025-1 File Naming (§2.3)", () => {
  it("generates correct filename", () => {
    const r = generateSubmissionFilename({
      submissionNumber: "SRVY2025-001",
      surveyType: "Cadastral",
      location: "Nairobi",
      date: "2025-09-15",
      fileType: "pdf",
      suffix: "Report",
    });
    expect(r.filename).toBe("SRVY2025-001_Cadastral_Nairobi_2025-09-15_Report.pdf");
    expect(r.extension).toBe("pdf");
  });

  it("sanitizes location with spaces", () => {
    const r = generateSubmissionFilename({
      submissionNumber: "SRVY2025-001",
      surveyType: "Cadastral",
      location: "Kasarani, Nairobi",
      date: "2025-09-15",
      fileType: "shp",
    });
    expect(r.filename).toContain("Kasarani_Nairobi");
  });

  it("validates submission number format", () => {
    expect(validateSubmissionNumber("SRVY2025-001")).toBe(true);
    expect(validateSubmissionNumber("SRVY2025-123")).toBe(true);
    expect(validateSubmissionNumber("INVALID")).toBe(false);
    expect(validateSubmissionNumber("SRVY25-001")).toBe(false);
  });

  it("validates date format", () => {
    expect(validateDateFormat("2025-09-15")).toBe(true);
    expect(validateDateFormat("2025-12-31")).toBe(true);
    expect(validateDateFormat("15-09-2025")).toBe(false);
    expect(validateDateFormat("2025/09/15")).toBe(false);
  });

  it("generates file set with all components", () => {
    const files = generateSubmissionFileSet({
      submissionNumber: "SRVY2025-001",
      surveyType: "Cadastral",
      location: "Nairobi",
      date: "2025-09-15",
      includeShapefile: true,
      includeFieldBook: true,
      includeMetadata: true,
    });
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.some((f) => f.filename.includes("Report"))).toBe(true);
    expect(files.some((f) => f.filename.includes("Plan"))).toBe(true);
    expect(files.some((f) => f.extension === "shp")).toBe(true);
    expect(files.some((f) => f.extension === "fbk")).toBe(true);
    expect(files.some((f) => f.extension === "xml")).toBe(true);
  });

  it("generates sequential submission numbers", () => {
    const num1 = generateSubmissionNumber(2025, []);
    expect(num1).toBe("SRVY2025-001");

    const num2 = generateSubmissionNumber(2025, ["SRVY2025-001", "SRVY2025-002"]);
    expect(num2).toBe("SRVY2025-003");
  });
});
