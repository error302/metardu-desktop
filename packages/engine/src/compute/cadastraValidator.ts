import type { ValidateRequest, ValidateResponse, BoundaryPolygon } from '@/types/cadastra'

const BASE = process.env.NEXT_PUBLIC_URL || ''

export async function validateBoundary(
  projectId: string | null,
  boundary: BoundaryPolygon,
  options?: { include_satellite?: boolean; historical_comparison?: boolean }
): Promise<ValidateResponse> {
  // AUDIT FIX (2026-07-03): Accept null projectId for standalone validation.
  const res = await fetch(`${BASE}/api/ai/cadastra-validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId || '', boundary, options } as ValidateRequest)
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || 'Failed to validate boundary')
  }
  
  return res.json()
}