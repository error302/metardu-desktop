/**
 * @module encroachmentAudit
 *
 * Automated Encroachment Audit Log
 *
 * When the topology checker detects a road reserve or boundary encroachment,
 * this module generates a formal compliance report with:
 * - Exact overlap area (m²)
 * - Georeferenced coordinates of the violation
 * - Photo evidence (if attached)
 * - Compliance reference (legal clause)
 * - Pre-filled audit form for submission
 *
 * Legal reference:
 * - Roads Act 2007 (Kenya) — Section 41: Road reserve encroachment
 * - Land Registration Act 2012 — Section 28: Boundary disputes
 * - Survey Act Cap 299 — Regulation 94: Color compliance
 */

import type { TopologyIssue } from '@/lib/survey/topologyChecker'

export interface EncroachmentRecord {
  id: string
  type: 'road_reserve' | 'parcel_overlap' | 'easement'
  severity: 'critical' | 'warning'
  // Spatial details
  overlapAreaSqM: number
  overlapAreaHa: number
  violationCoordinates: Array<{ easting: number; northing: number }>
  conflictingFeatureId: string
  conflictingFeatureName?: string
  // Legal reference
  legalReference: string
  legalClause: string
  // Evidence
  photoUrl?: string
  photoTimestamp?: string
  // Metadata
  detectedAt: string
  surveyorId: string
  surveyorLicense: string
  projectName: string
  // Status
  status: 'detected' | 'reported' | 'resolved'
  reportGenerated: boolean
}

export interface EncroachmentReport {
  reportId: string
  generatedAt: string
  projectName: string
  surveyorName: string
  surveyorLicense: string
  totalViolations: number
  criticalCount: number
  warningCount: number
  totalOverlapAreaSqM: number
  records: EncroachmentRecord[]
  summary: string
  legalDisclaimer: string
}

const LEGAL_REFERENCES: Record<string, { reference: string; clause: string }> = {
  road_reserve: {
    reference: 'Roads Act 2007 (Kenya)',
    clause: 'Section 41: It is an offence to encroach on a road reserve. ' +
            'The Kenya National Highways Authority (KeNHA) may order removal ' +
            'of any structure within the road reserve at the owner\'s cost.',
  },
  parcel_overlap: {
    reference: 'Land Registration Act 2012',
    clause: 'Section 28: No parcel of land shall be registered unless its ' +
            'boundaries have been demarcated and surveyed in accordance with ' +
            'the Survey Act. Overlapping boundaries constitute a dispute.',
  },
  easement: {
    reference: 'Land Act 2012',
    clause: 'Section 98: Easements must be respected. Encroachment on a ' +
            'registered easement is a violation of property rights.',
  },
}

/**
 * Create an encroachment audit record from a topology issue.
 */
export function createEncroachmentRecord(
  issue: TopologyIssue,
  context: {
    surveyorId: string
    surveyorLicense: string
    projectName: string
    photoUrl?: string
  },
): EncroachmentRecord {
  const legalRef = LEGAL_REFERENCES[issue.type] || LEGAL_REFERENCES.parcel_overlap

  // Estimate overlap area from issue details
  const overlapAreaMatch = issue.details?.match(/([\d.]+)\s*m²/)
  const overlapAreaSqM = overlapAreaMatch ? parseFloat(overlapAreaMatch[1]) : 0

  return {
    id: crypto.randomUUID(),
    type: issue.type === 'road_encroachment' ? 'road_reserve' :
          issue.type === 'overlap' ? 'parcel_overlap' : 'easement',
    severity: issue.severity === 'error' ? 'critical' : 'warning',
    overlapAreaSqM,
    overlapAreaHa: overlapAreaSqM / 10000,
    violationCoordinates: issue.coordinates || [],
    conflictingFeatureId: issue.conflictingParcelId || 'unknown',
    conflictingFeatureName: issue.message,
    legalReference: legalRef.reference,
    legalClause: legalRef.clause,
    photoUrl: context.photoUrl,
    photoTimestamp: context.photoUrl ? new Date().toISOString() : undefined,
    detectedAt: new Date().toISOString(),
    surveyorId: context.surveyorId,
    surveyorLicense: context.surveyorLicense,
    projectName: context.projectName,
    status: 'detected',
    reportGenerated: false,
  }
}

/**
 * Generate a full encroachment audit report.
 */
export function generateEncroachmentReport(
  records: EncroachmentRecord[],
  context: {
    surveyorName: string
    surveyorLicense: string
    projectName: string
  },
): EncroachmentReport {
  const criticalCount = records.filter(r => r.severity === 'critical').length
  const warningCount = records.filter(r => r.severity === 'warning').length
  const totalOverlap = records.reduce((sum, r) => sum + r.overlapAreaSqM, 0)

  const summary = `Encroachment audit identified ${records.length} violation(s) ` +
    `(${criticalCount} critical, ${warningCount} warning) ` +
    `with a total overlap area of ${totalOverlap.toFixed(2)} m² ` +
    `(${(totalOverlap / 10000).toFixed(4)} ha). ` +
    `${criticalCount > 0 ? 'Critical violations must be resolved before registry submission.' : ''}`

  return {
    reportId: `ENC-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    projectName: context.projectName,
    surveyorName: context.surveyorName,
    surveyorLicense: context.surveyorLicense,
    totalViolations: records.length,
    criticalCount,
    warningCount,
    totalOverlapAreaSqM: totalOverlap,
    records,
    summary,
    legalDisclaimer: 'This encroachment audit report is generated automatically by METARDU ' +
      'and serves as supporting documentation for survey compliance. ' +
      'All violations must be verified by a licensed surveyor before submission ' +
      'to the Director of Surveys or relevant authority.',
  }
}

/**
 * Export encroachment report as JSON.
 */
export function exportEncroachmentReport(report: EncroachmentReport): string {
  return JSON.stringify(report, null, 2)
}
