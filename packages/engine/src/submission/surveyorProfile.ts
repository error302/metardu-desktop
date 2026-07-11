import { createClient } from '@/lib/api-client/server'
import type { SurveyorProfileSubmission } from '@/lib/api-client/community'

export async function getActiveSurveyorProfile(): Promise<SurveyorProfileSubmission> {
  const dbClient = await createClient()

  const { data: { session }, error: authError } = await dbClient.auth.getSession()
  const sessUser = (session as { user?: { id?: string; email?: string; name?: string } } | null)?.user
  if (authError || !sessUser) throw new Error("Not authenticated")
  const user = sessUser as { id: string; email?: string; name?: string }

  const { data, error } = await dbClient
    .from('surveyor_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    throw new Error(
      `Surveyor profile not found for user ${user.id}. ` +
      'Please complete your profile before generating a submission.'
    )
  }

  // ponytail: Phase 6 — data is Record<string, unknown>; cast to expected shape
  const profile = data as Record<string, unknown>

  return {
    registrationNumber: (profile.isk_number as string) ?? '',
    iskNumber: (profile.isk_number as string) ?? '',
    verifiedIsk: (profile.verified_isk as boolean) ?? false,
    fullName: ((profile.full_name as string) ?? (profile.name as string)) ?? '',
    firmName: ((profile.firm_name as string) ?? (profile.company as string)) ?? '',
    isKMemberActive: (profile.verified_isk as boolean) ?? true
  }
}
