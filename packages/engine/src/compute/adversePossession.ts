import { AdversePossessionCase, AdversePossessionEvidence } from '@/types/landLaw'

export interface AdversePossessionInput {
  startDate: string
  endDate?: string
  parcelId: string
  evidence: AdversePossessionEvidenceInput[]
}

export interface AdversePossessionEvidenceInput {
  type: 'WITNESS' | 'DOCUMENTARY' | 'PHOTOGRAPHIC' | 'SURVEY' | 'OCCUPATION_RECORD' | 'RATE_PAYMENT' | 'IMPROVEMENT'
  description: string
  date: string
}

export interface AdversePossessionAnalysis {
  meetsRequirements: boolean
  duration: number
  yearsRemaining: number
  requirements: AdversePossessionRequirement[]
  strength: 'STRONG' | 'MODERATE' | 'WEAK'
  recommendation: string
  steps: AnalysisStep[]
}

export interface AdversePossessionRequirement {
  name: string
  code: 'HOSTILE' | 'OPEN' | 'NOTORIOUS' | 'EXCLUSIVE' | 'CONTINUOUS'
  met: boolean
  evidence: string[]
  strength: 'STRONG' | 'MODERATE' | 'WEAK'
}

export interface AnalysisStep {
  step: number
  title: string
  description: string
  passed: boolean
}

export function computeAdversePossession(input: AdversePossessionInput): AdversePossessionAnalysis {
  const steps: AnalysisStep[] = []
  const requirements: AdversePossessionRequirement[] = []
  
  const startDate = new Date(input.startDate)
  const endDate = input.endDate ? new Date(input.endDate) : new Date()
  const durationYears = Math.floor((endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  const yearsRemaining = Math.max(0, 12 - durationYears)
  
  steps.push({
    step: 1,
    title: 'Calculate Possession Duration',
    description: `Possession period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} = ${durationYears} years`,
    passed: durationYears > 0
  })
  
  const hasHostileEvidence = input.evidence.some((e) => 
    e.type === 'DOCUMENTARY' || e.type === 'WITNESS' || e.type === 'OCCUPATION_RECORD'
  )
  const hostileStrength = calculateStrength(input.evidence, ['DOCUMENTARY', 'WITNESS'])
  requirements.push({
    name: 'Hostile Possession',
    code: 'HOSTILE',
    met: hasHostileEvidence,
    evidence: input.evidence
      .filter((e) => ['DOCUMENTARY', 'WITNESS', 'OCCUPATION_RECORD'].includes(e.type))
      .map((e) => e.description),
    strength: hostileStrength
  })
  
  steps.push({
    step: 2,
    title: 'Analyze Hostile Nature',
    description: `Evidence showing possession without permission: ${hasHostileEvidence ? 'FOUND' : 'NOT FOUND'}`,
    passed: hasHostileEvidence
  })
  
  const hasOpenEvidence = input.evidence.some((e) => 
    e.type === 'PHOTOGRAPHIC' || e.type === 'SURVEY' || e.type === 'OCCUPATION_RECORD'
  )
  const openStrength = calculateStrength(input.evidence, ['PHOTOGRAPHIC', 'SURVEY', 'OCCUPATION_RECORD'])
  requirements.push({
    name: 'Open & Notorious',
    code: 'OPEN',
    met: hasOpenEvidence,
    evidence: input.evidence
      .filter((e) => ['PHOTOGRAPHIC', 'SURVEY', 'OCCUPATION_RECORD'].includes(e.type))
      .map((e) => e.description),
    strength: openStrength
  })
  
  steps.push({
    step: 3,
    title: 'Verify Open Possession',
    description: `Evidence of visible, open possession: ${hasOpenEvidence ? 'FOUND' : 'NOT FOUND'}`,
    passed: hasOpenEvidence
  })
  
  const hasNotoriousEvidence = input.evidence.some((e) => 
    e.type === 'WITNESS' || e.type === 'DOCUMENTARY' || e.type === 'RATE_PAYMENT'
  )
  const notoriousStrength = calculateStrength(input.evidence, ['WITNESS', 'DOCUMENTARY', 'RATE_PAYMENT'])
  requirements.push({
    name: 'Notorious to Owner',
    code: 'NOTORIOUS',
    met: hasNotoriousEvidence,
    evidence: input.evidence
      .filter((e) => ['WITNESS', 'DOCUMENTARY', 'RATE_PAYMENT'].includes(e.type))
      .map((e) => e.description),
    strength: notoriousStrength
  })
  
  steps.push({
    step: 4,
    title: 'Check Owner Knowledge',
    description: `Evidence owner knew of possession: ${hasNotoriousEvidence ? 'FOUND' : 'NOT FOUND'}`,
    passed: hasNotoriousEvidence
  })
  
  const exclusiveTypes = ['DOCUMENTARY', 'RATE_PAYMENT', 'IMPROVEMENT']
  const hasExclusiveEvidence = input.evidence.some((e) => exclusiveTypes.includes(e.type))
  const exclusiveStrength = calculateStrength(input.evidence, exclusiveTypes)
  requirements.push({
    name: 'Exclusive Possession',
    code: 'EXCLUSIVE',
    met: hasExclusiveEvidence,
    evidence: input.evidence
      .filter((e) => exclusiveTypes.includes(e.type))
      .map((e) => e.description),
    strength: exclusiveStrength
  })
  
  steps.push({
    step: 5,
    title: 'Verify Exclusivity',
    description: `Evidence of exclusive use: ${hasExclusiveEvidence ? 'FOUND' : 'NOT FOUND'}`,
    passed: hasExclusiveEvidence
  })
  
  const continuousMet = durationYears >= 12
  requirements.push({
    name: 'Continuous 12 Years',
    code: 'CONTINUOUS',
    met: continuousMet,
    evidence: [`Duration: ${durationYears} years`],
    strength: durationYears >= 15 ? 'STRONG' : durationYears >= 12 ? 'MODERATE' : 'WEAK'
  })
  
  steps.push({
    step: 6,
    title: 'Verify 12-Year Period',
    description: `Continuous possession for 12+ years: ${continuousMet ? 'MET' : 'NOT MET'}`,
    passed: continuousMet
  })
  
  const allMet = requirements.every(r => r.met)
  const totalStrength = calculateTotalStrength(requirements)
  
  let recommendation = ''
  if (allMet && durationYears >= 12) {
    recommendation = `All requirements met. File claim with Land Disputes Tribunal. Recommended evidence strength: ${totalStrength}.`
  } else if (durationYears >= 10) {
    recommendation = `Strong case developing. Continue maintaining possession. Need ${yearsRemaining} more years for statutory period.`
  } else {
    recommendation = `Not yet eligible. Must maintain adverse possession for additional ${yearsRemaining} years. Strengthen evidence collection.`
  }
  
  steps.push({
    step: 7,
    title: 'Final Assessment',
    description: recommendation,
    passed: allMet
  })
  
  return {
    meetsRequirements: allMet,
    duration: durationYears,
    yearsRemaining,
    requirements,
    strength: totalStrength,
    recommendation,
    steps
  }
}

function calculateStrength(evidence: AdversePossessionEvidenceInput[], types: string[]): 'STRONG' | 'MODERATE' | 'WEAK' {
  const matching = evidence.filter((e) => types.includes(e.type))
  if (matching.length >= 3) return 'STRONG'
  if (matching.length >= 1) return 'MODERATE'
  return 'WEAK'
}

function calculateTotalStrength(requirements: AdversePossessionRequirement[]): 'STRONG' | 'MODERATE' | 'WEAK' {
  const strongCount = requirements.filter((r) => r.strength === 'STRONG').length
  const moderateCount = requirements.filter((r) => r.strength === 'MODERATE').length
  
  if (strongCount >= 4) return 'STRONG'
  if (strongCount + moderateCount >= 4) return 'MODERATE'
  return 'WEAK'
}

export function createAdversePossessionCase(input: AdversePossessionInput): AdversePossessionCase {
  const analysis = computeAdversePossession(input)
  
  const evidence: AdversePossessionEvidence[] = input.evidence.map((e) => ({
    type: e.type,
    description: e.description,
    date: e.date,
    strength: calculateStrength(input.evidence, [e.type])
  }))
  
  return {
    id: crypto.randomUUID(),
    claimantId: '',
    parcelId: input.parcelId,
    adverseType: 'HOSTILE',
    startDate: input.startDate,
    endDate: input.endDate,
    duration: analysis.duration,
    meetsAllRequirements: analysis.meetsRequirements,
    evidence,
    status: analysis.meetsRequirements ? 'PENDING' : 'PENDING',
    createdAt: new Date().toISOString()
  }
}

export function getRequiredEvidenceTypes(): { type: string; description: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[] {
  return [
    { type: 'WITNESS', description: 'Sworn statements from neighbours or parties', priority: 'HIGH' },
    { type: 'DOCUMENTARY', description: 'Written documents showing possession', priority: 'HIGH' },
    { type: 'RATE_PAYMENT', description: 'Land rates receipts in occupiers name', priority: 'HIGH' },
    { type: 'PHOTOGRAPHIC', description: 'Dated photographs showing occupation', priority: 'MEDIUM' },
    { type: 'SURVEY', description: 'Survey plans showing boundary occupation', priority: 'MEDIUM' },
    { type: 'OCCUPATION_RECORD', description: 'Utility bills, correspondence', priority: 'MEDIUM' },
    { type: 'IMPROVEMENT', description: 'Evidence of land improvements', priority: 'LOW' }
  ]
}
