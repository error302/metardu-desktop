/**
 * Boundary Monument Service — client for the boundary-monuments API
 *
 * Boundary monuments are physical markers on international or sub-national
 * boundaries, established under treaty or commission authority. They carry:
 *   - Treaty citation (the legal basis for the boundary)
 *   - Coordinate with full epoch + covariance (time-dependent)
 *   - Physical description + condition log
 *   - Bilateral commission verification status
 *
 * This is distinct from `beacon_registry` (cadastral beacons) and
 * `survey_points` (project survey points). A surveyor working on a bilateral
 * boundary needs treaty-grade monument tracking.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BoundaryMonument {
  id: string
  monument_number: string
  monument_type: string
  boundary_name: string
  treaty_reference: string
  treaty_date: string | null
  latitude: number | null
  longitude: number | null
  elevation: number | null
  easting: number | null
  northing: number | null
  utm_zone: number
  hemisphere: string
  datum: string
  epsg_code: string
  coordinate_epoch: number | null
  reference_frame: string
  observation_date: string | null
  sigma_e: number | null
  sigma_n: number | null
  sigma_h: number | null
  sigma_en: number
  confidence_level: number
  physical_description: string | null
  material: string | null
  dimensions: string | null
  marker_text: string | null
  photo_url: string | null
  county: string | null
  sub_county: string | null
  locality: string | null
  sheet_number: string | null
  condition: string
  condition_notes: string | null
  last_inspected_date: string | null
  last_inspected_by: string | null
  verification_status: string
  verified_by: string | null
  verified_date: string | null
  verification_notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

export interface MonumentSearchOptions {
  boundary_name?: string
  monument_number?: string
  lat?: number
  lon?: number
  radiusKm?: number
  verification_status?: string
  condition?: string
  limit?: number
}

export interface CreateMonumentInput {
  monument_number: string
  monument_type?: string
  boundary_name: string
  treaty_reference: string
  treaty_date?: string
  latitude?: number
  longitude?: number
  elevation?: number
  easting?: number
  northing?: number
  utm_zone?: number
  hemisphere?: string
  datum?: string
  epsg_code?: string
  coordinate_epoch?: number
  reference_frame?: string
  observation_date?: string
  sigma_e?: number
  sigma_n?: number
  sigma_h?: number
  sigma_en?: number
  confidence_level?: number
  physical_description?: string
  material?: string
  dimensions?: string
  marker_text?: string
  photo_url?: string
  county?: string
  sub_county?: string
  locality?: string
  sheet_number?: string
  condition?: string
  condition_notes?: string
  last_inspected_date?: string
  verification_status?: string
  verified_by?: string
  verified_date?: string
  verification_notes?: string
  metadata?: Record<string, unknown>
}

// ─── API Functions ──────────────────────────────────────────────────────────

/**
 * Search boundary monuments.
 */
export async function searchBoundaryMonuments(
  options: MonumentSearchOptions = {},
): Promise<{ data: BoundaryMonument[]; count: number }> {
  const params = new URLSearchParams()
  for (const [key, val] of Object.entries(options)) {
    if (val !== undefined && val !== null) {
      params.set(key, String(val))
    }
  }

  const res = await fetch(`/api/boundary-monuments?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Failed to search boundary monuments: ${res.status}`)
  }
  return res.json()
}

/**
 * Create a new boundary monument.
 */
export async function createBoundaryMonument(
  input: CreateMonumentInput,
): Promise<BoundaryMonument> {
  const res = await fetch('/api/boundary-monuments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(`Failed to create boundary monument: ${error.error || res.status}`)
  }

  const result = await res.json()
  return result.data
}

/**
 * Get a single boundary monument by ID.
 */
export async function getBoundaryMonument(id: string): Promise<BoundaryMonument> {
  const res = await fetch(`/api/boundary-monuments/${id}`)
  if (!res.ok) {
    throw new Error(`Failed to get boundary monument: ${res.status}`)
  }
  const result = await res.json()
  return result.data
}

/**
 * Get all monuments on a specific boundary (e.g., 'Kenya-Tanzania').
 */
export async function getMonumentsByBoundary(
  boundaryName: string,
): Promise<BoundaryMonument[]> {
  const result = await searchBoundaryMonuments({ boundary_name: boundaryName, limit: 500 })
  return result.data
}

/**
 * Find monuments near a point.
 */
export async function findNearbyMonuments(
  lat: number,
  lon: number,
  radiusKm: number = 10,
): Promise<BoundaryMonument[]> {
  const result = await searchBoundaryMonuments({ lat, lon, radiusKm })
  return result.data
}

/**
 * Get monuments that need inspection (condition != 'good' or not inspected recently).
 */
export async function getMonumentsNeedingInspection(): Promise<BoundaryMonument[]> {
  // Monuments where condition is poor/destroyed/missing OR last_inspected_date > 2 years ago
  const result = await searchBoundaryMonuments({
    condition: 'poor',
    limit: 100,
  })
  return result.data
}

/**
 * Get monuments pending bilateral commission verification.
 */
export async function getPendingVerificationMonuments(): Promise<BoundaryMonument[]> {
  const result = await searchBoundaryMonuments({
    verification_status: 'pending',
    limit: 100,
  })
  return result.data
}

// ─── Display Helpers ────────────────────────────────────────────────────────

/**
 * Format a monument's coordinate for display, including epoch + frame.
 *
 * @example
 *   formatMonumentCoordinate(monument)
 *   // → "E: 264311.1  N: 9861507.9  (EPSG:21037, epoch 2025.5, ITRF2014)"
 */
export function formatMonumentCoordinate(m: BoundaryMonument): string {
  const parts: string[] = []
  if (m.easting !== null && m.northing !== null) {
    parts.push(`E: ${m.easting.toFixed(1)}  N: ${m.northing.toFixed(1)}`)
  } else if (m.latitude !== null && m.longitude !== null) {
    parts.push(`Lat: ${m.latitude.toFixed(6)}°  Lon: ${m.longitude.toFixed(6)}°`)
  }
  parts.push(m.epsg_code)
  if (m.coordinate_epoch !== null) {
    parts.push(`epoch ${m.coordinate_epoch.toFixed(1)}`)
  }
  parts.push(m.reference_frame)
  return parts.join(', ')
}

/**
 * Format a monument's accuracy for display.
 */
export function formatMonumentAccuracy(m: BoundaryMonument): string {
  const parts: string[] = []
  if (m.sigma_e !== null && m.sigma_n !== null) {
    parts.push(`σ_E=${m.sigma_e.toFixed(3)}m`)
    parts.push(`σ_N=${m.sigma_n.toFixed(3)}m`)
  }
  if (m.sigma_h !== null) {
    parts.push(`σ_H=${m.sigma_h.toFixed(3)}m`)
  }
  if (m.confidence_level) {
    parts.push(`${(m.confidence_level * 100).toFixed(0)}% CL`)
  }
  return parts.join('  ')
}

/**
 * Format the treaty citation for display.
 */
export function formatTreatyCitation(m: BoundaryMonument): string {
  let citation = m.treaty_reference
  if (m.treaty_date) {
    citation += ` (${m.treaty_date})`
  }
  return citation
}

/**
 * Get the verification status badge color.
 */
export function getVerificationStatusColor(status: string): string {
  switch (status) {
    case 'verified': return 'green'
    case 'pending': return 'yellow'
    case 'disputed': return 'red'
    case 're_established': return 'blue'
    default: return 'gray'
  }
}

/**
 * Get the condition badge color.
 */
export function getConditionColor(condition: string): string {
  switch (condition) {
    case 'good': return 'green'
    case 'fair': return 'yellow'
    case 'poor': return 'orange'
    case 'destroyed': return 'red'
    case 'missing': return 'red'
    case 'restored': return 'blue'
    default: return 'gray'
  }
}
