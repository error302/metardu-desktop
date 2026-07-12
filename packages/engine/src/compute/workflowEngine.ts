import type { WorkflowNode, WorkflowEdge, ReportRequest, ReportResponse } from '@/types/workflow'

const BASE = process.env.NEXT_PUBLIC_URL || ''

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  projectData?: Record<string, unknown>
): Promise<{ status: string; results: Record<string, unknown>; errors: string[] }> {
  const res = await fetch(`${BASE}/api/automator/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, edges, project_data: projectData || {} })
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || 'Failed to execute workflow')
  }
  
  return res.json()
}

export async function generateReport(
  projectData: Record<string, unknown>,
  sections?: string[],
  style?: 'technical' | 'executive' | 'simple'
): Promise<ReportResponse> {
  const res = await fetch(`${BASE}/api/automator/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_data: projectData, sections, style })
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || 'Failed to generate report')
  }
  
  return res.json()
}
