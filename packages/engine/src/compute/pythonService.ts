// src/lib/compute/pythonService.ts

const BASE = (typeof window === 'undefined' ? process.env.NEXT_PUBLIC_APP_URL : '') || ''

export async function convertDatum(
  coords: Array<{id?: string, easting: number, northing: number}>,
  fromDatum: string = 'WGS84',
  toDatum: string = 'ARC1960'
) {
  if (fromDatum === toDatum) return coords
  try {
    const res = await fetch(`${BASE}/api/convert-datum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords, fromDatum, toDatum })
    })
    if (!res.ok) throw new Error(`Datum conversion failed: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('Datum conversion failed — returning original coords:', err)
    return coords.map((c: any) => ({ ...c, datum: fromDatum, fallback: true }))
  }
}

export async function validateGeometry(params: {
  terrain: string
  designSpeed: number
  gradient: number
  radius: number
  ssd?: number
}) {
  try {
    const res = await fetch(`${BASE}/api/validate-geometry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    if (!res.ok) throw new Error(`Validation failed: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('Geometric validation failed:', err)
    return { status: 'UNKNOWN', flags: ['Validation service unavailable'], fallback: true }
  }
}

export async function generateContours(
  points: Array<{easting: number, northing: number, rl: number}>,
  interval: number = 1.0
) {
  try {
    const res = await fetch(`${BASE}/api/compute/contours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, interval })
    })
    if (!res.ok) throw new Error(`Contour generation failed: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('Contour generation failed:', err)
    return { contours: [], fallback: true }
  }
}

export async function computeVolumes(
  sections: Array<{chainage: number, cut_area: number, fill_area: number}>,
  shrinkageFactor: number = 0.85
) {
  try {
    const res = await fetch(`${BASE}/api/compute/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections, shrinkageFactor })
    })
    if (!res.ok) throw new Error(`Volume computation failed: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('Volume computation failed:', err)
    return { sections: [], totals: {}, fallback: true }
  }
}

export async function callPythonCompute<T>(
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number }
): Promise<{ ok: true; value: T } | { ok: false; status: number; error: string; fallback?: boolean; details?: unknown }> {
  const base = process.env.PYTHON_COMPUTE_URL || process.env.PYTHON_SERVICE_URL
  if (!base) {
    return { ok: false, status: 503, error: 'Python compute service is not configured.', fallback: true }
  }

  const controller = new AbortController()
  const timeoutMs = opts?.timeoutMs ?? 10000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WORKER_SECRET ? { 'X-Worker-Secret': process.env.WORKER_SECRET } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const status = response.status
    const json = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false,
        status,
        error: json?.error || `Python service returned ${status}`,
        fallback: json?.fallback,
        details: json?.details || json,
      }
    }

    return { ok: true, value: json as T }
  } catch (e: unknown) {
    if (((e as Error)?.name) === 'AbortError') {
      return { ok: false, status: 503, error: `Python compute service unavailable (timeout after ${timeoutMs}ms).`, fallback: true }
    }
    return { ok: false, status: 503, error: 'Python compute service unavailable.', fallback: true, details: ((e as Error)?.message) }
  } finally {
    clearTimeout(timeoutId)
  }
}
