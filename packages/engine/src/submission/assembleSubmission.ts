import JSZip from 'jszip'
import { createClient } from '@/lib/api-client/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getActiveSurveyorProfile } from './surveyorProfile'
import { generateSubmissionRef } from './revisionNumber'
import { validateSubmission } from './validateSubmission'
import { generateFormNo4DXF } from './generators/formNo4'
import { generateStatutoryWorkbook } from './workbook/statutoryWorkbook'
import { generateWorkingDiagramDXF } from './generators/workingDiagram'
import { generatePPA2Form } from './generators/ppa2Form'
import { generateLCBConsent } from './generators/lcbConsent'
import { generateMutationForm } from './generators/mutationForm'
import type { PPA2Input } from './generators/ppa2Form'
import type { LCBConsentInput } from './generators/lcbConsent'
import type { MutationFormInput } from './generators/mutationForm'
import { coordinateArea } from '@/lib/engine/area'
import { angularClosureTolerance } from '@/lib/engine/traverse'
import type { SubmissionPackage, QAGateResult, SurveySubtype } from './types'

interface ProjectData {
  id: string
  lr_number: string
  parcel_number: string
  division: string
  county: string
  district: string
  locality: string
  area_m2: number
  perimeter_m: number
  subtype: SurveySubtype
  survey_points: unknown[]
  supporting_documents: unknown[]
  angular_misclosure: number
  linear_misclosure: number
  precision_ratio: string
  closing_error_e: number
  closing_error_n: number
  client_name: string
  survey_type?: string
}

export async function assembleSubmissionPackage(
  projectId: string
): Promise<{ zipBuffer: Buffer; ref: string; qa: QAGateResult }> {
  const dbClient = await createClient()
  const surveyor = await getActiveSurveyorProfile()
  const asNum = (value: unknown, fallback = 0): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  // QueryBuilder does not support DbClient-style nested relation selects,
  // so fetch project, points, and docs in separate queries.
  const { data: project, error: projectError } = await dbClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (projectError || !project) throw new Error('Project not found')

  const { data: surveyPoints, error: pointsError } = await dbClient
    .from('survey_points')
    .select('*')
    .eq('project_id', projectId)
    .limit(50_000) // hard cap: 50k points per project (~50MB RAM for dense surveys).
                    // Exceeding this requires project splitting or cursor pagination.

  if (pointsError) {
    throw new Error(`Failed to load survey points: ${pointsError.message}`)
  }

  const { data: supportingDocuments, error: docsError } = await dbClient
    .from('supporting_documents')
    .select('*')
    .eq('project_id', projectId)

  if (docsError) {
    throw new Error(`Failed to load supporting documents: ${docsError.message}`)
  }

  const proj = {
    ...(project as Record<string, unknown>),
    survey_points: Array.isArray(surveyPoints) ? surveyPoints : [],
    supporting_documents: Array.isArray(supportingDocuments) ? supportingDocuments : []
  } as unknown as ProjectData

  const adjustedCoordinates = (proj.survey_points || [])
    .filter((pt: any) => pt.adjusted_easting != null && pt.adjusted_northing != null)
    .map((pt: any) => ({
      label: pt.point_name ?? pt.name ?? `P${pt.idx}`,
      easting: asNum(pt.adjusted_easting),
      northing: asNum(pt.adjusted_northing)
    }));

  let computedAreaM2 = 0;
  if (adjustedCoordinates.length >= 3) {
    const areaResult = coordinateArea(adjustedCoordinates);
    computedAreaM2 = areaResult.areaSqm;
  } else if (proj.survey_points && proj.survey_points.length >= 3) {
    const rawCoordinates = (proj.survey_points || []).map((pt: any) => ({
      easting: asNum(pt.easting),
      northing: asNum(pt.northing)
    }));
    const areaResult = coordinateArea(rawCoordinates);
    computedAreaM2 = areaResult.areaSqm;
  }

  if (adjustedCoordinates.length < 3 && proj.survey_points && proj.survey_points.length >= 3) {
    console.warn('No adjusted coordinates found - using raw coordinates for area computation');
  }

  if (adjustedCoordinates.length < 3 && (!proj.survey_points || proj.survey_points.length < 3)) {
    throw new Error(
      'Cannot assemble submission: traverse must have at least 3 points to compute area. ' +
      'Complete traverse computation before submitting.'
    );
  }

  const { ref, revision } = await generateSubmissionRef(
    projectId,
    surveyor.registrationNumber
  )

  const supportingDocs = (proj.supporting_documents ?? []).map((doc: any) => ({
    type: doc.type,
    label: doc.label,
    required: doc.required,
    fileUrl: doc.file_url ?? null,
    uploadedAt: doc.uploaded_at ?? null
  }))

  const pkg: SubmissionPackage = {
    submissionRef: ref,
    projectId,
    surveyor,
    subtype: (proj.survey_type || 'cadastral_subdivision') as SurveySubtype,
    parcel: {
      lrNumber: proj.lr_number || '',
      parcelNumber: proj.parcel_number || proj.lr_number || '',
      county: proj.county || '',
      division: proj.division || '',
      district: proj.district || '',
      locality: proj.locality || '',
      areaM2: computedAreaM2,
      perimeterM: asNum(proj.perimeter_m),
      clientName: proj.client_name || ''
    },
    traverse: {
      points: (proj.survey_points || []).map((pt: any) => ({
        pointName: pt.name || pt.point_name || `P${pt.id}`,
        easting: asNum(pt.easting),
        northing: asNum(pt.northing),
        adjustedEasting: asNum(pt.adjusted_easting, asNum(pt.easting)),
        adjustedNorthing: asNum(pt.adjusted_northing, asNum(pt.northing)),
        observedBearing: asNum(pt.observed_bearing),
        observedDistance: asNum(pt.observed_distance, asNum(pt.distance))
      })),
      angularMisclosure: asNum(proj.angular_misclosure),
      linearMisclosure: asNum(proj.linear_misclosure),
      precisionRatio: proj.precision_ratio || '1:1',
      closingErrorE: asNum(proj.closing_error_e),
      closingErrorN: asNum(proj.closing_error_n),
      adjustmentMethod: 'bowditch',
      areaM2: computedAreaM2,
      perimeterM: asNum(proj.perimeter_m)
    },
    supportingDocs,
    generatedAt: new Date().toISOString(),
    revision
  }

  const qa = validateSubmission(pkg)
  if (!qa.passed) {
    return { zipBuffer: Buffer.alloc(0), ref, qa }
  }

  const formNo4Dxf = generateFormNo4DXF(pkg)
  const firstPt = pkg.traverse.points[0]
  const workbook = await generateStatutoryWorkbook({
    project: {
      name: String(project.name ?? ''),
      lrNumber: String(project.lr_number ?? ''),
      parcelNumber: String(project.parcel_number ?? ''),
      county: String(project.county ?? ''),
      division: String(project.division ?? ''),
      district: String(project.district ?? ''),
      locality: String(project.locality ?? ''),
      surveyType: 'cadastral',
      surveyDate: String(project.survey_date ?? new Date().toISOString()),
      scaleDenominator: 2500,
    },
    surveyor: {
      name: surveyor.fullName,
      iskNumber: surveyor.iskNumber,
      firmName: surveyor.firmName ?? '',
    },
    submission: {
      referenceNumber: ref,
      revision,
      status: 'submitted',
    },
    fieldObservations: pkg.traverse.points.map((pt, i) => ({
      stationFrom: pt.pointName,
      stationTo: pkg.traverse.points[(i + 1) % pkg.traverse.points.length]?.pointName ?? '',
      observedBearingDeg: pt.observedBearing,
      observedDistanceM: pt.observedDistance,
    })),
    traverse: {
      method: pkg.traverse.adjustmentMethod,
      stations: pkg.traverse.points.map(pt => ({
        label: pt.pointName,
        observedBearing: pt.observedBearing,
        observedDistance: pt.observedDistance,
        departureRaw: pt.easting - (firstPt?.easting ?? 0),
        latitudeRaw: pt.northing - (firstPt?.northing ?? 0),
        departureCorrected: pt.adjustedEasting - pt.easting,
        latitudeCorrected: pt.adjustedNorthing - pt.northing,
        easting: pt.adjustedEasting,
        northing: pt.adjustedNorthing,
      })),
      angularMisclosureSec: pkg.traverse.angularMisclosure,
      angularToleranceSec: angularClosureTolerance(pkg.traverse.points.length),
      angularPassesQA: pkg.traverse.angularMisclosure <= angularClosureTolerance(pkg.traverse.points.length),
      linearMisclosureM: pkg.traverse.linearMisclosure,
      perimeterM: pkg.traverse.perimeterM,
      precisionRatio: parseInt(pkg.traverse.precisionRatio.replace('1:', '')),
      precisionMinimum: 5000,
      linearPassesQA: true,
    },
    adjustedStations: pkg.traverse.points.map(pt => ({
      label: pt.pointName,
      easting: pt.adjustedEasting,
      northing: pt.adjustedNorthing,
    })),
    levelling: null,
    areaComputation: {
      stations: pkg.traverse.points.map(pt => ({
        label: pt.pointName,
        easting: pt.adjustedEasting,
        northing: pt.adjustedNorthing,
      })),
      areaM2: pkg.traverse.areaM2,
      areaHa: pkg.traverse.areaM2 / 10000,
      perimeterM: pkg.traverse.perimeterM,
    },
    legs: pkg.traverse.points.map((pt, i) => ({
      fromLabel: pt.pointName,
      toLabel: pkg.traverse.points[(i + 1) % pkg.traverse.points.length]?.pointName ?? '',
      bearing: pt.observedBearing,
      distance: pt.observedDistance,
    })),
    cogoResults: null,
  })
  const workingDiagram = generateWorkingDiagramDXF(pkg)

  const zip = new JSZip()
  zip.file('form_no_4.dxf', formNo4Dxf)
  zip.file('computation_workbook.xlsx', workbook)
  zip.file('working_diagram.dxf', workingDiagram)

  // Supporting documents - PPA2 (always included)
  // ponytail: cast via unknown — the query result `project` is typed as
  // Record<string, unknown> after the Phase 6 queryBuilder tightening, so each
  // property access yields `unknown`. The PDF generator handles stringification
  // at runtime; the cast preserves the legacy `any`-typed behavior.
  const ppa2Input = {
    lrNumber: project.lr_number,
    parcelNumber: project.parcel_number,
    county: project.county,
    division: project.division,
    district: project.district,
    locality: project.locality,
    areaHa: computedAreaM2 / 10000,
    surveyType: project.survey_subtype ?? project.survey_type ?? 'Cadastral',
    applicantName: project.client_name ?? '',
    applicantAddress: project.client_address ?? '',
    applicantIdNumber: project.client_id_number,
    surveyorName: surveyor.fullName,
    iskNumber: surveyor.iskNumber,
    firmName: surveyor.firmName ?? '',
    surveyDate: project.survey_date ?? new Date().toISOString(),
    referenceNumber: ref,
  } as unknown as PPA2Input
  zip.file('supporting_docs/ppa2_form.pdf', generatePPA2Form(ppa2Input))

  // Supporting documents - LCB Consent (always included)
  // ponytail: same as PPA2 above — cast via unknown to preserve legacy runtime.
  const lcbInput = {
    lrNumber: project.lr_number,
    parcelNumber: project.parcel_number,
    county: project.county,
    division: project.division,
    district: project.district,
    areaHa: computedAreaM2 / 10000,
    landUse: project.land_use ?? 'Agricultural',
    transferorName: project.owner_name ?? '',
    transfereeName: project.client_name ?? '',
    transferorIdNumber: project.owner_id_number,
    transfereeIdNumber: project.client_id_number,
    surveyorName: surveyor.fullName,
    iskNumber: surveyor.iskNumber,
    surveyDate: project.survey_date ?? new Date().toISOString(),
    referenceNumber: ref,
    lbcApplicationNumber: project.lbc_application_number,
  } as unknown as LCBConsentInput
  zip.file('supporting_docs/lcb_consent.pdf', generateLCBConsent(lcbInput))

  // Supporting documents - Mutation Form (only for mutation subtype)
  if (project.survey_subtype === 'mutation') {
    // ponytail: same as PPA2 above — cast via unknown to preserve legacy runtime.
    const mutationInput = {
      parentLRNumber: project.lr_number,
      parentParcelNumber: project.parcel_number,
      parentAreaHa: project.parent_area_ha ?? computedAreaM2 / 10000,
      resultingParcels: project.resulting_parcels ?? [],
      county: project.county,
      division: project.division,
      district: project.district,
      locality: project.locality,
      registryMapSheet: project.registry_map_sheet ?? '',
      mutationType: 'subdivision' as const,
      reasonForMutation: project.mutation_reason ?? 'Subdivision',
      affectedBeacons: adjustedCoordinates.map((st, i) => ({
        beaconId: st.label,
        action: 'new' as const,
        easting: st.easting,
        northing: st.northing,
      })),
      surveyorName: surveyor.fullName,
      iskNumber: surveyor.iskNumber,
      firmName: surveyor.firmName ?? '',
      surveyDate: project.survey_date ?? new Date().toISOString(),
      referenceNumber: ref,
      mutationNumber: project.mutation_number,
    } as unknown as MutationFormInput
    zip.file('supporting_docs/mutation_form.pdf', generateMutationForm(mutationInput))
  }

  const manifest = {
    submissionRef: ref,
    generatedAt: pkg.generatedAt,
    surveyor: pkg.surveyor.registrationNumber,
    lrNumber: pkg.parcel.lrNumber,
    areaHa: (pkg.parcel.areaM2 / 10000).toFixed(4),
    areaM2: pkg.parcel.areaM2.toFixed(2),
    perimeterM: pkg.traverse.perimeterM.toFixed(3),
    precisionRatio: pkg.traverse.precisionRatio,
    adjustmentMethod: pkg.traverse.adjustmentMethod,
    files: ['form_no_4.dxf', 'computation_workbook.xlsx', 'working_diagram.dxf', 'manifest.json'],
    supportingDocuments: pkg.supportingDocs.map(d => d.type).filter(Boolean),
    qaResult: qa
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  // Get user from NextAuth session
  const authSession = await getServerSession(authOptions)
  const userId = (authSession?.user as any)?.id ?? ''
  
  const { rows: profileRows } = await db.query(
    'SELECT id, user_id, isk_number, verified_isk FROM surveyor_profiles WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  const profile = profileRows[0]

  if (!profile) {
    throw new Error('Surveyor profile not found')
  }

  const currentYear = new Date().getFullYear()
  const { rows: existingRows } = await db.query(
    'SELECT revision_number FROM project_submissions WHERE project_id = $1 ORDER BY revision_number DESC LIMIT 1',
    [projectId]
  )

  const revisionNumber = (existingRows[0]?.revision_number ?? -1) + 1

  // Direct SQL replaces dbClient.rpc('increment_submission_sequence')
  const { rows: seqRows } = await db.query(
    `INSERT INTO submission_sequences (surveyor_profile_id, year, current_sequence)
     VALUES ($1, $2, 1)
     ON CONFLICT (surveyor_profile_id, year)
     DO UPDATE SET current_sequence = submission_sequences.current_sequence + 1
     RETURNING current_sequence`,
    [profile.id, currentYear]
  )

  const sequence = seqRows[0]?.current_sequence ?? 1
  const submissionNumber = `${profile.isk_number}_${currentYear}_${String(sequence).padStart(3, '0')}_R${String(revisionNumber).padStart(2, '0')}`

  await db.query(
    `INSERT INTO project_submissions (project_id, surveyor_profile_id, submission_number, revision_code, submission_year, package_status, generated_artifacts, validation_results)
     VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7)`,
    [
      projectId,
      profile.id,
      submissionNumber,
      `R${String(revisionNumber).padStart(2, '0')}`,
      currentYear,
      JSON.stringify({
        form_no_4: 'form_no_4.dxf',
        computation_workbook: 'computation_workbook.xlsx',
        working_diagram: 'working_diagram.dxf'
      }),
      JSON.stringify(qa)
    ]
  )

  return { zipBuffer, ref, qa }
}
