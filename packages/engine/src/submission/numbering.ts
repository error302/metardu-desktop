/**
 * Submission numbering — VM PostgreSQL edition
 *
 * Replaces the old dbClient.rpc('increment_submission_sequence') call which
 * was a no-op stub on the VM.  Now calls /api/submission/sequence directly.
 */

export async function generateSubmissionNumber(
  surveyorProfileId: string,
  registrationNo: string
): Promise<{ submissionNumber: string; sequence: number; year: number }> {
  const year = new Date().getFullYear()

  const res = await fetch('/api/submission/sequence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surveyorProfileId, year }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      `Failed to generate submission number: ${body?.error ?? res.statusText}`
    )
  }

  const { sequence } = await res.json()
  const seq = sequence as number

  const submissionNumber = `${registrationNo}_${year}_${String(seq).padStart(3, '0')}_R00`
  return { submissionNumber, sequence: seq, year }
}

export function incrementRevision(submissionNumber: string): string {
  // RS149_2025_002_R00 → RS149_2025_002_R01
  const parts = submissionNumber.split('_')
  if (parts.length !== 4) throw new Error('Invalid submission number format')
  const revPart = parts[3]
  const revNum = parseInt(revPart.replace('R', ''), 10)
  parts[3] = `R${String(revNum + 1).padStart(2, '0')}`
  return parts.join('_')
}
