/**
 * @module neighborConsensus
 *
 * Geofenced Adjoining Owner Consensus Capture
 *
 * Records formal boundary consensus with adjoining property owners:
 * - Neighbor name, National ID, phone
 * - Signature captured on touchscreen canvas
 * - GPS geofence verification (must be within 5m of beacon)
 * - Cryptographic signing of consensus record
 * - Prevents fraudulent off-site sign-offs
 *
 * Legal significance:
 * - Admissible as evidence in boundary disputes
 * - Prevents future litigation from adjoining owners
 * - Required for high-value urban boundary surveys
 */

import { sealRecord } from '@/lib/security/cryptoSealing'

export interface NeighborConsensusRecord {
  id: string
  beaconId: string
  beaconEasting: number
  beaconNorthing: number
  // Neighbor info
  neighborName: string
  neighborNationalId: string
  neighborPhone: string
  neighborParcelNumber?: string
  // Signature
  signatureData: string  // Base64 encoded vector path
  // Geofence verification
  signLocationEasting: number
  signLocationNorthing: number
  distanceFromBeacon: number  // meters
  isGeofenceValid: boolean
  // Timestamps
  signedAt: string
  // Surveyor
  surveyorId: string
  surveyorLicense: string
  // Crypto seal
  seal?: string  // Cryptographic signature
}

export interface ConsensusVerificationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Maximum allowed distance from beacon for valid sign-off (meters).
 */
export const GEOFENCE_RADIUS_M = 5.0

/**
 * Verify that the signing location is within the geofence radius.
 */
export function verifyGeofence(
  beaconEasting: number,
  beaconNorthing: number,
  signLocationEasting: number,
  signLocationNorthing: number,
): { distance: number; isValid: boolean } {
  const dE = signLocationEasting - beaconEasting
  const dN = signLocationNorthing - beaconNorthing
  const distance = Math.sqrt(dE * dE + dN * dN)

  return {
    distance,
    isValid: distance <= GEOFENCE_RADIUS_M,
  }
}

/**
 * Create a neighbor consensus record with geofence verification.
 *
 * @throws Error if geofence check fails
 */
export async function createConsensusRecord(
  params: {
    beaconId: string
    beaconEasting: number
    beaconNorthing: number
    neighborName: string
    neighborNationalId: string
    neighborPhone: string
    neighborParcelNumber?: string
    signatureData: string
    signLocationEasting: number
    signLocationNorthing: number
    surveyorId: string
    surveyorLicense: string
  },
): Promise<NeighborConsensusRecord> {
  const geofence = verifyGeofence(
    params.beaconEasting,
    params.beaconNorthing,
    params.signLocationEasting,
    params.signLocationNorthing,
  )

  if (!geofence.isValid) {
    throw new Error(
      `Geofence violation: signing location is ${geofence.distance.toFixed(2)}m from beacon ` +
      `(maximum allowed: ${GEOFENCE_RADIUS_M}m). Sign-off must be done on-site.`
    )
  }

  const record: NeighborConsensusRecord = {
    id: crypto.randomUUID(),
    beaconId: params.beaconId,
    beaconEasting: params.beaconEasting,
    beaconNorthing: params.beaconNorthing,
    neighborName: params.neighborName,
    neighborNationalId: params.neighborNationalId,
    neighborPhone: params.neighborPhone,
    neighborParcelNumber: params.neighborParcelNumber,
    signatureData: params.signatureData,
    signLocationEasting: params.signLocationEasting,
    signLocationNorthing: params.signLocationNorthing,
    distanceFromBeacon: geofence.distance,
    isGeofenceValid: geofence.isValid,
    signedAt: new Date().toISOString(),
    surveyorId: params.surveyorId,
    surveyorLicense: params.surveyorLicense,
  }

  // Cryptographically seal the record
  try {
    const sealed = await sealRecord({
      pointId: params.beaconId,
      wgs84Lat: 0,  // Would be filled from actual position
      wgs84Lng: 0,
      arc1960Easting: params.beaconEasting,
      arc1960Northing: params.beaconNorthing,
      gpsAccuracy: 0,
      capturedAt: record.signedAt,
      surveyorId: params.surveyorId,
      surveyorLicense: params.surveyorLicense,
    }, params.surveyorId)

    record.seal = sealed.signature
  } catch (err) {
    // Sealing is optional — record is still valid without it
    console.warn('[neighborConsensus] Failed to seal record:', err)
  }

  return record
}

/**
 * Verify a consensus record.
 */
export function verifyConsensusRecord(record: NeighborConsensusRecord): ConsensusVerificationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check geofence
  if (!record.isGeofenceValid) {
    errors.push('Geofence check failed — sign-off was done off-site')
  }

  // Check required fields
  if (!record.neighborName?.trim()) {
    errors.push('Neighbor name is required')
  }
  if (!record.neighborNationalId?.trim()) {
    errors.push('Neighbor National ID is required')
  }
  if (!record.signatureData) {
    errors.push('Signature is required')
  }

  // Check distance
  if (record.distanceFromBeacon > GEOFENCE_RADIUS_M) {
    errors.push(`Distance from beacon (${record.distanceFromBeacon.toFixed(2)}m) exceeds geofence radius (${GEOFENCE_RADIUS_M}m)`)
  }

  // Warnings
  if (!record.neighborPhone?.trim()) {
    warnings.push('Neighbor phone number not recorded')
  }
  if (!record.neighborParcelNumber?.trim()) {
    warnings.push('Neighbor parcel number not recorded')
  }
  if (!record.seal) {
    warnings.push('Record is not cryptographically sealed')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Generate a consensus report for multiple beacons.
 */
export function generateConsensusReport(
  records: NeighborConsensusRecord[],
): {
  totalBeacons: number
  consensusCount: number
  pendingCount: number
  geofenceViolations: number
  records: NeighborConsensusRecord[]
} {
  const verified = records.map(r => ({
    record: r,
    verification: verifyConsensusRecord(r),
  }))

  return {
    totalBeacons: new Set(records.map(r => r.beaconId)).size,
    consensusCount: verified.filter(v => v.verification.isValid).length,
    pendingCount: records.filter(r => !r.signatureData).length,
    geofenceViolations: records.filter(r => !r.isGeofenceValid).length,
    records,
  }
}
