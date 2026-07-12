import type { DeedPlanInput, DeedPlanOutput } from '@/types/deedPlan'

const BASE = process.env.NEXT_PUBLIC_URL || ''

export async function generateDeedPlan(input: DeedPlanInput): Promise<DeedPlanOutput> {
  const res = await fetch(`${BASE}/api/deed-plan/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || 'Failed to generate deed plan')
  }

  return res.json()
}
