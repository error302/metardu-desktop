import { createClient } from '@/lib/api-client/server'
import { db } from '@/lib/db'
export async function generateSubmissionRef(
  projectId: string,
  iskNumber: string
): Promise<{ ref: string; revision: number; sequence: number }> {
  const dbClient = await createClient()
  const currentYear = new Date().getFullYear()

  const { data: profile } = await dbClient
    .from('surveyor_profiles')
    .select('id')
    .eq('isk_number', iskNumber)
    .single()

  if (!profile) {
    throw new Error('Surveyor profile not found')
  }

  const { data: existingSubmissions } = await dbClient
    .from('project_submissions')
    .select('revision_number')
    .eq('project_id', projectId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // ponytail: Phase 6 — existingSubmissions is Record<string, unknown> | null;
  // cast revision_number to number explicitly
  const rawRevision = existingSubmissions?.revision_number as number | undefined
  const revision = (rawRevision ?? -1) + 1
  const paddedRev = String(revision).padStart(2, '0')

  // Direct SQL replaces the old dbClient.rpc('increment_submission_sequence')
  const { rows } = await db.query(
    `INSERT INTO submission_sequences (surveyor_profile_id, year, current_sequence)
     VALUES ($1, $2, 1)
     ON CONFLICT (surveyor_profile_id, year)
     DO UPDATE SET current_sequence = submission_sequences.current_sequence + 1
     RETURNING current_sequence`,
    [profile.id, currentYear]
  )

  const sequence = rows[0]?.current_sequence ?? 1
  const paddedSeq = String(sequence).padStart(3, '0')

  const ref = `${iskNumber}_${currentYear}_${paddedSeq}_R${paddedRev}`

  return { ref, revision, sequence }
}