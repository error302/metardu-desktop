import type {
  SurveyReportInput,
  SectionContent,
  ReportCompletenessResult,
  SectionGap,
  ReportSection
} from '@/types/surveyReport'

export function computeReportCompleteness(
  input: SurveyReportInput,
  sections: SectionContent[]
): ReportCompletenessResult {
  const sectionCompleteness: Record<ReportSection, number> = {
    TITLE_PAGE: calculateTitlePageCompleteness(input),
    TABLE_OF_CONTENTS: 100,
    INTRODUCTION: calculateIntroductionCompleteness(input),
    SCOPE_OF_WORK: calculateScopeOfWorkCompleteness(input),
    EQUIPMENT_AND_PERSONNEL: calculateEquipmentAndPersonnelCompleteness(input),
    CONTROL_SURVEY: calculateControlSurveyCompleteness(input),
    TOPOGRAPHIC_SURVEY: calculateTopographicSurveyCompleteness(input),
    DATA_PROCESSING: 100,
    RESULTS_AND_ACCURACY: calculateResultsAndAccuracyCompleteness(input),
    COORDINATE_REGISTER: 100,
    BENCHMARK_REGISTER: 100,
    TRAVERSE_COMPUTATIONS: 100,
    LEVELLING_COMPUTATIONS: 100,
    CONCLUSIONS_AND_RECOMMENDATIONS: calculateConclusionsCompleteness(input),
    DECLARATION: input.declarationStatement ? 100 : 0,
  }

  const sectionTitles: Record<ReportSection, string> = {
    TITLE_PAGE: 'Title Page',
    TABLE_OF_CONTENTS: 'Table of Contents',
    INTRODUCTION: 'Introduction',
    SCOPE_OF_WORK: 'Scope of Work',
    EQUIPMENT_AND_PERSONNEL: 'Equipment and Personnel',
    CONTROL_SURVEY: 'Control Survey',
    TOPOGRAPHIC_SURVEY: 'Topographic Survey',
    DATA_PROCESSING: 'Data Processing',
    RESULTS_AND_ACCURACY: 'Results and Accuracy',
    COORDINATE_REGISTER: 'Coordinate Register',
    BENCHMARK_REGISTER: 'Benchmark Register',
    TRAVERSE_COMPUTATIONS: 'Traverse Computations',
    LEVELLING_COMPUTATIONS: 'Levelling Computations',
    CONCLUSIONS_AND_RECOMMENDATIONS: 'Conclusions and Recommendations',
    DECLARATION: 'Declaration',
  }

  const sectionNumbers: Record<ReportSection, number> = {
    TITLE_PAGE: 1,
    TABLE_OF_CONTENTS: 2,
    INTRODUCTION: 3,
    SCOPE_OF_WORK: 4,
    EQUIPMENT_AND_PERSONNEL: 5,
    CONTROL_SURVEY: 6,
    TOPOGRAPHIC_SURVEY: 7,
    DATA_PROCESSING: 8,
    RESULTS_AND_ACCURACY: 9,
    COORDINATE_REGISTER: 10,
    BENCHMARK_REGISTER: 11,
    TRAVERSE_COMPUTATIONS: 12,
    LEVELLING_COMPUTATIONS: 13,
    CONCLUSIONS_AND_RECOMMENDATIONS: 14,
    DECLARATION: 15,
  }

  const missingFields: Record<ReportSection, string[]> = {
    TITLE_PAGE: getTitlePageMissingFields(input),
    TABLE_OF_CONTENTS: [],
    INTRODUCTION: getIntroductionMissingFields(input),
    SCOPE_OF_WORK: getScopeOfWorkMissingFields(input),
    EQUIPMENT_AND_PERSONNEL: getEquipmentAndPersonnelMissingFields(input),
    CONTROL_SURVEY: getControlSurveyMissingFields(input),
    TOPOGRAPHIC_SURVEY: getTopographicSurveyMissingFields(input),
    DATA_PROCESSING: [],
    RESULTS_AND_ACCURACY: getResultsAndAccuracyMissingFields(input),
    COORDINATE_REGISTER: [],
    BENCHMARK_REGISTER: [],
    TRAVERSE_COMPUTATIONS: [],
    LEVELLING_COMPUTATIONS: [],
    CONCLUSIONS_AND_RECOMMENDATIONS: getConclusionsMissingFields(input),
    DECLARATION: input.declarationStatement ? [] : ['declarationStatement'],
  }

  const sectionKeys = Object.keys(sectionCompleteness) as ReportSection[]
  const totalCompleteness = Object.values(sectionCompleteness).reduce((a, b) => a + b, 0) / sectionKeys.length
  const sectionsComplete = Object.values(sectionCompleteness).filter(c => c >= 100).length

  const sectionsIncomplete: SectionGap[] = sectionKeys
    .filter(section => sectionCompleteness[section] < 100)
    .map(section => ({
      section,
      sectionNumber: sectionNumbers[section],
      title: sectionTitles[section],
      missingFields: missingFields[section],
      completeness: sectionCompleteness[section]
    }))

  return {
    overallPercent: Math.round(totalCompleteness),
    sectionsComplete,
    sectionsIncomplete,
    readyToFinalise: totalCompleteness >= 95
  }
}

function calculateTitlePageCompleteness(input: SurveyReportInput): number {
  const requiredFields = [
    input.reportTitle,
    input.clientName,
    input.firmName,
    input.firmIskNumber,
    input.surveyorName,
    input.surveyorRegistrationNumber,
    input.surveyorIskNumber,
    input.reportDate,
    input.reportNumber,
    input.submissionNumber
  ]
  const present = requiredFields.filter((f: string | undefined) => f && f.trim().length > 0).length
  return Math.round((present / requiredFields.length) * 100)
}

function calculateIntroductionCompleteness(input: SurveyReportInput): number {
  const fields = [
    input.projectLocation,
    input.county,
    input.projectPurpose,
    input.siteDescription,
    input.surveyPeriodStart,
    input.surveyPeriodEnd
  ]
  const present = fields.filter((f: string | undefined) => f && f.trim().length > 0).length
  return Math.round((present / fields.length) * 100)
}

function calculateScopeOfWorkCompleteness(input: SurveyReportInput): number {
  return (input.scopeItems && input.scopeItems.length >= 1) ? 100 : 0
}

function calculateEquipmentAndPersonnelCompleteness(input: SurveyReportInput): number {
  const hasEquipment = (input.equipment && input.equipment.length >= 1) ? 50 : 0
  const hasPersonnel = (input.personnel && input.personnel.length >= 1) ? 50 : 0
  return hasEquipment + hasPersonnel
}

function calculateControlSurveyCompleteness(input: SurveyReportInput): number {
  const hasDatum = input.datum ? 33.33 : 0
  const hasProjection = input.projection && input.projection.length > 0 ? 33.33 : 0
  const hasControlPoints = input.controlPoints && input.controlPoints.length >= 2 ? 33.34 : 0
  return hasDatum + hasProjection + hasControlPoints
}

function calculateTopographicSurveyCompleteness(input: SurveyReportInput): number {
  const hasMethod = input.surveyMethod ? 50 : 0
  const hasInstrument = input.instrumentUsed && input.instrumentUsed.length > 0 ? 50 : 0
  return hasMethod + hasInstrument
}

function calculateResultsAndAccuracyCompleteness(input: SurveyReportInput): number {
  const hasTraverse = input.traverseAccuracy && input.traverseAccuracy.length > 0
  const hasLevelling = input.levellingMisclosure && input.levellingMisclosure.length > 0
  return (hasTraverse || hasLevelling) ? 100 : 0
}

function calculateConclusionsCompleteness(input: SurveyReportInput): number {
  const hasConclusions = input.conclusions && input.conclusions.length >= 1 ? 50 : 0
  const hasRecommendations = input.recommendations && input.recommendations.length >= 1 ? 50 : 0
  return hasConclusions + hasRecommendations
}

function getTitlePageMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.reportTitle || !input.reportTitle.trim()) missing.push('reportTitle')
  if (!input.clientName || !input.clientName.trim()) missing.push('clientName')
  if (!input.firmName || !input.firmName.trim()) missing.push('firmName')
  if (!input.firmIskNumber || !input.firmIskNumber.trim()) missing.push('firmIskNumber')
  if (!input.surveyorName || !input.surveyorName.trim()) missing.push('surveyorName')
  if (!input.surveyorRegistrationNumber || !input.surveyorRegistrationNumber.trim()) missing.push('surveyorRegistrationNumber')
  if (!input.surveyorIskNumber || !input.surveyorIskNumber.trim()) missing.push('surveyorIskNumber')
  if (!input.reportDate) missing.push('reportDate')
  if (!input.reportNumber || !input.reportNumber.trim()) missing.push('reportNumber')
  if (!input.submissionNumber || !input.submissionNumber.trim()) missing.push('submissionNumber')
  return missing
}

function getIntroductionMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.projectLocation || !input.projectLocation.trim()) missing.push('projectLocation')
  if (!input.county || !input.county.trim()) missing.push('county')
  if (!input.projectPurpose || !input.projectPurpose.trim()) missing.push('projectPurpose')
  if (!input.siteDescription || !input.siteDescription.trim()) missing.push('siteDescription')
  if (!input.surveyPeriodStart) missing.push('surveyPeriodStart')
  if (!input.surveyPeriodEnd) missing.push('surveyPeriodEnd')
  return missing
}

function getScopeOfWorkMissingFields(input: SurveyReportInput): string[] {
  if (!input.scopeItems || input.scopeItems.length < 1) return ['scopeItems']
  return []
}

function getEquipmentAndPersonnelMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.equipment || input.equipment.length < 1) missing.push('equipment')
  if (!input.personnel || input.personnel.length < 1) missing.push('personnel')
  return missing
}

function getControlSurveyMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.datum) missing.push('datum')
  if (!input.projection || !input.projection.trim()) missing.push('projection')
  if (!input.controlPoints || input.controlPoints.length < 2) missing.push('controlPoints (minimum 2)')
  return missing
}

function getTopographicSurveyMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.surveyMethod) missing.push('surveyMethod')
  if (!input.instrumentUsed || !input.instrumentUsed.trim()) missing.push('instrumentUsed')
  return missing
}

function getResultsAndAccuracyMissingFields(input: SurveyReportInput): string[] {
  if (!input.traverseAccuracy && !input.levellingMisclosure) {
    return ['traverseAccuracy or levellingMisclosure']
  }
  return []
}

function getConclusionsMissingFields(input: SurveyReportInput): string[] {
  const missing: string[] = []
  if (!input.conclusions || input.conclusions.length < 1) missing.push('conclusions')
  if (!input.recommendations || input.recommendations.length < 1) missing.push('recommendations')
  return missing
}
