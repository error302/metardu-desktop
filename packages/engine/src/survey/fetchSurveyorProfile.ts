/**
 * Fetch surveyor profile data for a project.
 *
 * Used by both the statutory validation gate (pre-export check) and
 * the document assembly pipeline (deed plan generation). Extracted
 * here so both call sites resolve surveyor identity the same way —
 * previously assembleDocument.ts had its own copy.
 *
 * Resolution order:
 *   1. Project-level fields (projects.surveyor_name, projects.surveyor_license)
 *   2. Surveyor profile table (surveyor_profiles joined via user_id)
 *   3. Empty strings (the gate will block on missing name/license)
 */

import { db } from '@/lib/db'
export interface SurveyorProfile {
  surveyorName: string
  iskNumber: string
  firmName: string
  referenceNumber: string
}

export async function fetchSurveyorProfile(
  projectId: string
): Promise<SurveyorProfile> {
  try {
    const projRes = await db.query(
      'SELECT user_id, surveyor_name, surveyor_license FROM projects WHERE id = $1',
      [projectId]
    )
    const proj = projRes.rows[0]

    // 1. Project-level surveyor fields take precedence
    if (proj?.surveyor_name) {
      return {
        surveyorName: proj.surveyor_name || '',
        iskNumber: proj.surveyor_license || '',
        firmName: '',
        referenceNumber: '',
      }
    }

    // 2. Fall back to surveyor_profiles via user_id
    if (proj?.user_id) {
      const userRes = await db.query(
        'SELECT full_name, isk_number, firm_name FROM surveyor_profiles WHERE user_id = $1',
        [proj.user_id]
      )
      const user = userRes.rows[0]
      if (user) {
        return {
          surveyorName: user.full_name || '',
          iskNumber: user.isk_number || '',
          firmName: user.firm_name || '',
          referenceNumber: '',
        }
      }
    }
  } catch (err) {
    console.warn('[fetchSurveyorProfile] Failed:', err)
  }
  return { surveyorName: '', iskNumber: '', firmName: '', referenceNumber: '' }
}
