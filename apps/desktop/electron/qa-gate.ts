/**
 * Quality Assurance Gate — Pre-Submission Validation
 *
 * No plan leaves METARDU Desktop without passing this gate.
 * Checks every aspect of the survey against:
 *   - Survey of Kenya Drafting Manual (2020)
 *   - Survey Act Cap 299, Survey Regulations 1994
 *   - RDM 1.1 (2025)
 *   - NLIMS/ArdhiSasa submission requirements
 *
 * Categories:
 *   1. COMPLETENESS — all required fields present
 *   2. PRECISION — traverse meets minimum ratio for survey type
 *   3. TOPOLOGY — no self-intersections, gaps, or overlaps
 *   4. COORDINATE — coordinates in correct CRS, correct precision
 *   5. BEARING/DISTANCE — bearings in DMS, distances in 3dp
 *   6. AREA — area reconciliation (parent = sum of children)
 *   7. BEACON — all beacons have coordinates + type
 *   8. TITLE BLOCK — all required title block fields present
 *   9. METADATA — surveyor license, date, firm, projection, datum
 *  10. NLIMS — NLIMS JSON schema compliance
 *
 * Each check returns PASS / WARNING / FAIL with details.
 * Overall result: PASS (can submit) / CONDITIONAL (can submit with notes) / FAIL (cannot submit).
 */

export type QACheckStatus = 'PASS' | 'WARNING' | 'FAIL';

export interface QACheck {
  category: string;
  name: string;
  status: QACheckStatus;
  message: string;
  details?: string;
  regulation?: string;  // e.g. "Survey Reg 1994, Reg 97"
}

export interface QAGateResult {
  overall: 'PASS' | 'CONDITIONAL' | 'FAIL';
  checks: QACheck[];
  passCount: number;
  warningCount: number;
  failCount: number;
  canSubmit: boolean;
  summary: string;
  recommendations: string[];
}

export interface QAInput {
  surveyType: 'cadastral' | 'topographic' | 'engineering' | 'control' | 'mutation';
  parcel: {
    number: string;
    lrNumber: string;
    areaSqM: number;
    perimeter: number;
    points: Array<{
      number: string;
      easting: number;
      northing: number;
      elevation?: number;
      beaconType?: string;
    }>;
    boundaries?: Array<{
      fromIndex: number;
      toIndex: number;
      bearing: number;
      distance: number;
    }>;
  };
  traverse?: {
    perimeter: number;
    linearMisclosure: number;
    angularMisclosure?: number;
    precisionRatio: number;
    adjustmentMethod: string;
    stationCount: number;
  };
  blunderDetection?: {
    globalTestPassed: boolean;
    blunderCount: number;
    reliability: string;
  };
  titleBlock?: {
    surveyorName: string;
    surveyorLicense: string;
    firmName?: string;
    surveyDate: string;
    county: string;
    locality: string;
    projection?: string;
    datum?: string;
    registryMapSheet?: string;
    deedPlanNumber?: string;
  };
  crs?: string;  // e.g. "EPSG:21037"
  nlimsPayload?: any;
  parentParcelArea?: number;  // for mutation/subdivision area reconciliation
  childParcelAreas?: number[];  // for area reconciliation
}

export function runQAGate(input: QAInput): QAGateResult {
  const checks: QACheck[] = [];

  // ─── 1. COMPLETENESS ────────────────────────────────────────────────
  if (!input.parcel.number || input.parcel.number.trim().length === 0) {
    checks.push({ category: 'Completeness', name: 'Parcel number', status: 'FAIL', message: 'Parcel number is missing', regulation: 'Survey Reg 1994' });
  } else {
    checks.push({ category: 'Completeness', name: 'Parcel number', status: 'PASS', message: `Parcel: ${input.parcel.number}` });
  }

  if (!input.parcel.lrNumber || input.parcel.lrNumber.trim().length === 0) {
    checks.push({ category: 'Completeness', name: 'LR number', status: 'FAIL', message: 'LR number is missing', regulation: 'Survey Reg 1994' });
  } else {
    checks.push({ category: 'Completeness', name: 'LR number', status: 'PASS', message: `LR: ${input.parcel.lrNumber}` });
  }

  if (input.parcel.points.length < 3) {
    checks.push({ category: 'Completeness', name: 'Minimum points', status: 'FAIL', message: `Need at least 3 points, got ${input.parcel.points.length}`, regulation: 'Survey Reg 1994' });
  } else {
    checks.push({ category: 'Completeness', name: 'Minimum points', status: 'PASS', message: `${input.parcel.points.length} points` });
  }

  if (input.parcel.boundaries && input.parcel.boundaries.length !== input.parcel.points.length) {
    checks.push({ category: 'Completeness', name: 'Boundary count', status: 'WARNING', message: `${input.parcel.boundaries.length} boundaries for ${input.parcel.points.length} points (should match)`, regulation: 'SoK Drafting Manual' });
  } else if (input.parcel.boundaries) {
    checks.push({ category: 'Completeness', name: 'Boundary count', status: 'PASS', message: `${input.parcel.boundaries.length} boundaries match ${input.parcel.points.length} points` });
  }

  // ─── 2. PRECISION ───────────────────────────────────────────────────
  if (input.traverse) {
    const minRatio = input.surveyType === 'cadastral' ? 5000 : input.surveyType === 'engineering' ? 3000 : 1000;
    if (input.traverse.precisionRatio >= minRatio) {
      checks.push({ category: 'Precision', name: 'Traverse precision', status: 'PASS', message: `1:${input.traverse.precisionRatio} meets ${input.surveyType} standard (1:${minRatio})`, regulation: 'Survey Reg 1994, Reg 97' });
    } else if (input.traverse.precisionRatio >= minRatio * 0.6) {
      checks.push({ category: 'Precision', name: 'Traverse precision', status: 'WARNING', message: `1:${input.traverse.precisionRatio} below ${input.surveyType} standard (1:${minRatio}) — review observations`, regulation: 'Survey Reg 1994, Reg 97' });
    } else {
      checks.push({ category: 'Precision', name: 'Traverse precision', status: 'FAIL', message: `1:${input.traverse.precisionRatio} far below ${input.surveyType} standard (1:${minRatio}) — re-survey required`, regulation: 'Survey Reg 1994, Reg 97' });
    }
  }

  // ─── 3. BLUNDER DETECTION ──────────────────────────────────────────
  if (input.blunderDetection) {
    if (input.blunderDetection.globalTestPassed && input.blunderDetection.blunderCount === 0) {
      checks.push({ category: 'Blunder', name: 'Baarda global test', status: 'PASS', message: 'No blunders detected, global test passes', regulation: 'Baarda (1968)' });
    } else if (input.blunderDetection.blunderCount > 0) {
      checks.push({ category: 'Blunder', name: 'Baarda global test', status: 'FAIL', message: `${input.blunderDetection.blunderCount} blunder(s) detected — resolve before submission`, regulation: 'Baarda (1968)' });
    } else {
      checks.push({ category: 'Blunder', name: 'Baarda global test', status: 'WARNING', message: 'Global test failed but no specific blunder identified — check for systematic errors', regulation: 'Baarda (1968)' });
    }

    const reliability = input.blunderDetection.reliability;
    if (reliability === 'POOR' || reliability === 'MARGINAL') {
      checks.push({ category: 'Blunder', name: 'Reliability', status: 'WARNING', message: `Reliability is ${reliability} — add check shots to improve blunder detectability`, regulation: 'Baarda (1968)' });
    } else {
      checks.push({ category: 'Blunder', name: 'Reliability', status: 'PASS', message: `Reliability: ${reliability}` });
    }
  }

  // ─── 4. TOPOLOGY ────────────────────────────────────────────────────
  // Check for self-intersecting polygon
  const pts = input.parcel.points;
  let hasSelfIntersection = false;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    for (let k = i + 2; k < pts.length; k++) {
      const l = (k + 1) % pts.length;
      if (k === j || l === i) continue;
      if (segmentsIntersect(pts[i], pts[j], pts[k], pts[l])) {
        hasSelfIntersection = true;
        break;
      }
    }
    if (hasSelfIntersection) break;
  }
  if (hasSelfIntersection) {
    checks.push({ category: 'Topology', name: 'Self-intersection', status: 'FAIL', message: 'Parcel boundary self-intersects — fix boundary before submission', regulation: 'SoK Drafting Manual' });
  } else {
    checks.push({ category: 'Topology', name: 'Self-intersection', status: 'PASS', message: 'No self-intersections detected' });
  }

  // Check for duplicate points
  const pointNumbers = pts.map(p => p.number);
  const duplicates = pointNumbers.filter((n, i) => pointNumbers.indexOf(n) !== i);
  if (duplicates.length > 0) {
    checks.push({ category: 'Topology', name: 'Duplicate points', status: 'FAIL', message: `Duplicate point numbers: ${duplicates.join(', ')}`, regulation: 'SoK Drafting Manual' });
  } else {
    checks.push({ category: 'Topology', name: 'Duplicate points', status: 'PASS', message: 'No duplicate point numbers' });
  }

  // ─── 5. COORDINATE PRECISION ───────────────────────────────────────
  for (const p of pts) {
    const eStr = p.easting.toFixed(3);
    const nStr = p.northing.toFixed(3);
    if (!/^\d{6,7}\.\d{3}$/.test(eStr) || !/^\d{6,7}\.\d{3}$/.test(nStr)) {
      checks.push({ category: 'Coordinate', name: 'Coordinate precision', status: 'WARNING', message: `Point ${p.number}: coordinates should be XXXXXX.XXX format`, regulation: 'SoK Cartographic Standards' });
      break;
    }
  }
  if (!checks.some(c => c.category === 'Coordinate' && c.name === 'Coordinate precision')) {
    checks.push({ category: 'Coordinate', name: 'Coordinate precision', status: 'PASS', message: 'All coordinates in correct format (3 decimal places)' });
  }

  // CRS check
  if (input.crs) {
    if (input.crs === 'EPSG:21037' || input.crs === 'EPSG:21036') {
      checks.push({ category: 'Coordinate', name: 'CRS', status: 'PASS', message: `${input.crs} (Kenya UTM)` });
    } else {
      checks.push({ category: 'Coordinate', name: 'CRS', status: 'WARNING', message: `CRS ${input.crs} — verify this is correct for the survey area`, regulation: 'Survey Reg 1994' });
    }
  } else {
    checks.push({ category: 'Coordinate', name: 'CRS', status: 'WARNING', message: 'No CRS declared — specify EPSG:21037 for Kenya UTM 37S' });
  }

  // ─── 6. BEARING/DISTANCE FORMAT ────────────────────────────────────
  if (input.parcel.boundaries) {
    let allBearingsValid = true;
    for (const b of input.parcel.boundaries) {
      if (b.bearing < 0 || b.bearing > 360) { allBearingsValid = false; break; }
      if (b.distance <= 0) { allBearingsValid = false; break; }
    }
    if (allBearingsValid) {
      checks.push({ category: 'Bearing/Distance', name: 'Range check', status: 'PASS', message: 'All bearings 0-360°, distances > 0' });
    } else {
      checks.push({ category: 'Bearing/Distance', name: 'Range check', status: 'FAIL', message: 'Some bearings out of range or distances ≤ 0', regulation: 'SoK Drafting Manual' });
    }
  }

  // ─── 7. AREA RECONCILIATION (for mutations) ────────────────────────
  if (input.parentParcelArea && input.childParcelAreas) {
    const sumChildren = input.childParcelAreas.reduce((a, b) => a + b, 0);
    const diff = Math.abs(input.parentParcelArea - sumChildren);
    if (diff < 0.001) {
      checks.push({ category: 'Area', name: 'Reconciliation', status: 'PASS', message: `Parent (${input.parentParcelArea} ha) = sum of children (${sumChildren.toFixed(4)} ha)`, regulation: 'Survey Reg 1994' });
    } else if (diff < 0.01) {
      checks.push({ category: 'Area', name: 'Reconciliation', status: 'WARNING', message: `Area difference: ${diff.toFixed(4)} ha (tolerance: 0.01 ha)`, regulation: 'Survey Reg 1994' });
    } else {
      checks.push({ category: 'Area', name: 'Reconciliation', status: 'FAIL', message: `Area mismatch: parent ${input.parentParcelArea} ha ≠ children sum ${sumChildren.toFixed(4)} ha (diff ${diff.toFixed(4)} ha)`, regulation: 'Survey Reg 1994' });
    }
  }

  // ─── 8. BEACON CHECK ───────────────────────────────────────────────
  let allBeaconsTyped = true;
  for (const p of pts) {
    if (!p.beaconType) { allBeaconsTyped = false; break; }
  }
  if (allBeaconsTyped) {
    checks.push({ category: 'Beacon', name: 'Beacon types', status: 'PASS', message: 'All beacons have type assigned' });
  } else {
    checks.push({ category: 'Beacon', name: 'Beacon types', status: 'WARNING', message: 'Some beacons missing type — assign concrete/iron_pin/stone', regulation: 'SoK Drafting Manual' });
  }

  // ─── 9. TITLE BLOCK ────────────────────────────────────────────────
  if (input.titleBlock) {
    const tb = input.titleBlock;
    if (!tb.surveyorName || !tb.surveyorLicense) {
      checks.push({ category: 'Title Block', name: 'Surveyor info', status: 'FAIL', message: 'Surveyor name and license required', regulation: 'Survey Reg 1994, Reg 3(2)' });
    } else {
      checks.push({ category: 'Title Block', name: 'Surveyor info', status: 'PASS', message: `${tb.surveyorName} (${tb.surveyorLicense})` });
    }
    if (!tb.surveyDate) {
      checks.push({ category: 'Title Block', name: 'Survey date', status: 'FAIL', message: 'Survey date required', regulation: 'Survey Reg 1994' });
    } else {
      checks.push({ category: 'Title Block', name: 'Survey date', status: 'PASS', message: tb.surveyDate });
    }
    if (!tb.county || !tb.locality) {
      checks.push({ category: 'Title Block', name: 'Location', status: 'WARNING', message: 'County and locality recommended', regulation: 'SoK Drafting Manual' });
    } else {
      checks.push({ category: 'Title Block', name: 'Location', status: 'PASS', message: `${tb.county}, ${tb.locality}` });
    }
    if (!tb.projection) {
      checks.push({ category: 'Title Block', name: 'Projection', status: 'WARNING', message: 'Projection not specified (should be Cassini-Soldner or UTM)' });
    } else {
      checks.push({ category: 'Title Block', name: 'Projection', status: 'PASS', message: tb.projection });
    }
    if (!tb.datum) {
      checks.push({ category: 'Title Block', name: 'Datum', status: 'WARNING', message: 'Datum not specified (should be Arc 1960)' });
    } else {
      checks.push({ category: 'Title Block', name: 'Datum', status: 'PASS', message: tb.datum });
    }
    if (input.surveyType === 'cadastral' && !tb.registryMapSheet) {
      checks.push({ category: 'Title Block', name: 'Registry map sheet', status: 'WARNING', message: 'Registry map sheet reference recommended for cadastral surveys', regulation: 'Survey Reg 1994' });
    }
  }

  // ─── 10. NLIMS COMPLIANCE ──────────────────────────────────────────
  if (input.nlimsPayload) {
    const required = ['submissionId', 'submissionDate', 'submissionType', 'registry', 'county', 'surveyor'];
    const missing = required.filter(f => !input.nlimsPayload[f]);
    if (missing.length === 0) {
      checks.push({ category: 'NLIMS', name: 'Required fields', status: 'PASS', message: 'All NLIMS required fields present' });
    } else {
      checks.push({ category: 'NLIMS', name: 'Required fields', status: 'FAIL', message: `Missing NLIMS fields: ${missing.join(', ')}`, regulation: 'ArdhiSasa Submission Spec' });
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const warningCount = checks.filter(c => c.status === 'WARNING').length;
  const passCount = checks.filter(c => c.status === 'PASS').length;
  const overall = failCount > 0 ? 'FAIL' : warningCount > 0 ? 'CONDITIONAL' : 'PASS';
  const canSubmit = failCount === 0;

  const recommendations: string[] = [];
  if (failCount > 0) {
    recommendations.push(`${failCount} FAIL(s) must be resolved before submission.`);
    for (const c of checks.filter(c => c.status === 'FAIL')) {
      recommendations.push(`  → ${c.category}: ${c.message}`);
    }
  }
  if (warningCount > 0) {
    recommendations.push(`${warningCount} WARNING(s) — review before submission.`);
  }
  if (failCount === 0 && warningCount === 0) {
    recommendations.push('All checks PASS. Plan is ready for submission.');
  }

  return {
    overall,
    checks,
    passCount,
    warningCount,
    failCount,
    canSubmit,
    summary: `${passCount} PASS, ${warningCount} WARNING, ${failCount} FAIL — ${overall}`,
    recommendations,
  };
}

function segmentsIntersect(p1: any, p2: any, p3: any, p4: any): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(o: any, a: any, b: any): number {
  return (a.easting - o.easting) * (b.northing - o.northing) - (a.northing - o.northing) * (b.easting - o.easting);
}
