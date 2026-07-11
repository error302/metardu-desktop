import type { SurveyPoint } from '@/types/surveyPoint'

// Re-export for backwards compatibility.
export type { SurveyPoint }

export interface METARDUProjectExport {
  version: '1.0'
  exportDate: string
  project: {
    name: string
    location: string
    utm_zone: number
    hemisphere: string
    datum: string
    survey_type?: string
    client_name?: string
    surveyor_name?: string
  }
  control_points: SurveyPoint[]
  survey_points: SurveyPoint[]
  traverses: unknown[]
  parcels: unknown[]
  alignments: unknown[]
}

export async function exportProject(
  projectId: string,
  dbClient: any
): Promise<void> {
  const [project, points, traverses, parcels, alignments] = await Promise.all([
    dbClient.from('projects').select('*').eq('id', projectId).single(),
    dbClient.from('survey_points').select('*').eq('project_id', projectId),
    dbClient.from('traverses').select('*').eq('project_id', projectId),
    dbClient.from('parcels').select('*').eq('project_id', projectId),
    dbClient.from('alignments').select('*').eq('project_id', projectId)
  ])

  const exportData: METARDUProjectExport = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    project: {
      name: project.data.name,
      location: project.data.location || '',
      utm_zone: project.data.utm_zone,
      hemisphere: project.data.hemisphere,
      datum: 'WGS84',
      survey_type: project.data.survey_type,
      client_name: project.data.client_name,
      surveyor_name: project.data.surveyor_name
    },
    control_points: points.data?.filter((p: any) => p.is_control) || [],
    survey_points: points.data?.filter((p: any) => !p.is_control) || [],
    traverses: traverses.data || [],
    parcels: parcels.data || [],
    alignments: alignments.data || []
  }

  const json = JSON.stringify(exportData, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.data.name.replace(/\s+/g, '_')}_${
    new Date().toISOString().slice(0, 10)
  }.metardu`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importProject(
  file: File,
  dbClient: any
): Promise<{ success: boolean; projectId?: string; error?: string }> {
  try {
    const text = await file.text()
    const data: METARDUProjectExport = JSON.parse(text)

    if (data.version !== '1.0') {
      return { success: false, error: 'Unsupported file version' }
    }

    const { data: { session } } = await dbClient.auth.getSession()
    const user = session?.user ?? null
    if (!user) {
      return { success: false, error: 'Must be logged in to import' }
    }

    const { data: newProject, error: projectError } = await dbClient
      .from('projects')
      .insert({
        name: data.project.name + ' (Imported)',
        location: data.project.location,
        utm_zone: data.project.utm_zone,
        hemisphere: data.project.hemisphere,
        survey_type: data.project.survey_type,
        client_name: data.project.client_name,
        surveyor_name: data.project.surveyor_name,
        user_id: user.id
      })
      .select()
      .single()

    if (projectError) {
      return { success: false, error: projectError.message }
    }

    const allPoints = [...data.control_points, ...data.survey_points]
    if (allPoints.length > 0) {
      const pointsToInsert = allPoints.map((p: any) => ({
        project_id: newProject.id,
        name: p.name,
        easting: p.easting,
        northing: p.northing,
        elevation: p.elevation,
        is_control: p.is_control,
        control_order: p.control_order
      }))

      const { error: pointsError } = await dbClient
        .from('survey_points')
        .insert(pointsToInsert)

      if (pointsError) {
        console.error('Error importing points:', pointsError)
      }
    }

    return { success: true, projectId: newProject.id }
  } catch (e) {
    return { success: false, error: 'Failed to parse file' }
  }
}
