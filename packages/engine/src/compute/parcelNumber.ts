import { 
  KENYA_COUNTIES, 
  getRegistrationSectionByCode, 
  getAllRegistrationSections,
  type RegistrationSection 
} from '../data/kenyaLocalities'

export interface ParsedParcelNumber {
  raw: string
  format: 'BLOCK' | 'SECTION' | 'LR' | 'UNKNOWN'
  county?: string
  registrationSection?: string
  block?: number
  parcelNumber?: number
  suffix?: string
  isValid: boolean
  validationErrors: string[]
  formatted: string
  shortForm: string
}

const COUNTY_ABBREVIATIONS: Record<string, string> = {
  'NBI': 'Nairobi', 'NRBN': 'Nairobi', 'WST': 'Nairobi', 'KAS': 'Nairobi',
  'KBU': 'Kiambu', 'RRU': 'Ruiru', 'THK': 'Thika', 'LMR': 'Limuru',
  'MSA': 'Mombasa', 'KWL': 'Kwale', 'MLF': 'Malindi', 'LMW': 'Lamu',
  'KSM': 'Kisumu', 'NKR': 'Nakuru', 'ELD': 'Eldoret', 'NYR': 'Nyeri',
  'MRU': 'Meru', 'KTI': 'Kitui', 'MKS': 'Machakos', 'KIS': 'Kisii',
  'KAJI': 'Kajiado', 'KRN': 'Kericho', 'BMT': 'Bomet', 'NGW': 'Nyandarua',
  'KIR': 'Kirinyaga', 'MUR': 'Muranga', 'EMBU': 'Embu', 'MAS': 'Makueni'
}

function getCanonicalSectionLabel(section: RegistrationSection | null, fallback: string): string {
  return (section?.name || fallback).toUpperCase()
}

function resolveRegistrationSection(input: string): { code: string; info: RegistrationSection | null } {
  const normalized = input.toUpperCase().trim()
  const sectionInfo = lookupRegistrationSection(normalized)

  if (sectionInfo) {
    return { code: sectionInfo.code, info: sectionInfo }
  }

  return { code: normalized, info: null }
}

function isSectionCodeStyle(input: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(input.trim().toUpperCase())
}

export function parseParcelNumber(raw: string): ParsedParcelNumber {
  const normalized = raw.trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/L\.R\.?\s*NO\.?\s*/i, 'L.R. No. ')
    .replace(/^LR\s*/i, 'L.R. No. ')
  
  const errors: string[] = []
  
  if (!normalized || normalized.length === 0) {
    return {
      raw,
      format: 'UNKNOWN',
      isValid: false,
      validationErrors: ['Parcel number is required'],
      formatted: '',
      shortForm: ''
    }
  }

  // Try to detect format and parse
  // Format A: NAIROBI BLOCK 2/1234 or NRBN/B2/1234
  const blockPatterns = [
    /^(?:([A-Z][A-Z\s]{1,})\s+)?BLOCK\s*(\d+)\/(\d+)(?:\/(\d+))?$/i,
    /^([A-Z0-9]{2,10})\/B(?:LOCK)?\s*(\d+)\/(\d+)(?:\/(\d+))?$/i,
  ]
  const blockMatch = blockPatterns
    .map((pattern: any) => normalized.match(pattern))
    .find((match): match is RegExpMatchArray => Boolean(match))
  
  if (blockMatch) {
    const prefix = (blockMatch[1] || 'NRBN').trim()
    const block = parseInt(blockMatch[2], 10)
    const parcel = parseInt(blockMatch[3], 10)
    const suffix = blockMatch[4]
    const { code: section, info: sectionInfo } = resolveRegistrationSection(prefix)
    
    if (isNaN(block) || block <= 0) {
      errors.push('Block number must be a positive integer')
    }
    if (isNaN(parcel) || parcel <= 0) {
      errors.push('Parcel number must be a positive integer')
    }
    
    const formatted = sectionInfo 
      ? `${getCanonicalSectionLabel(sectionInfo, section)} BLOCK ${block}/${parcel}${suffix ? '/' + suffix : ''}`
      : `${prefix} BLOCK ${block}/${parcel}${suffix ? '/' + suffix : ''}`
    
    return {
      raw,
      format: 'BLOCK',
      county: sectionInfo?.county || prefix,
      registrationSection: section,
      block,
      parcelNumber: parcel,
      suffix,
      isValid: errors.length === 0,
      validationErrors: errors,
      formatted,
      shortForm: `${section}/B${block}/${parcel}${suffix ? '/' + suffix : ''}`
    }
  }

  // Format B: KIAMBU/456 or KIAMBU/RUIRU/456
  const sectionPattern = /^([A-Z][A-Z\s]{1,}|[A-Z0-9]{2,10})\/(\d+)(?:\/(\d+))?$/i
  const sectionMatch = normalized.match(sectionPattern)
  
  if (sectionMatch) {
    const prefix = sectionMatch[1].trim()
    const parcel = parseInt(sectionMatch[2], 10)
    const suffix = sectionMatch[3]
    const { code: section, info: sectionInfo } = resolveRegistrationSection(prefix)
    
    if (isNaN(parcel) || parcel <= 0) {
      errors.push('Parcel number must be a positive integer')
    }
    
    if (!sectionInfo && !COUNTY_ABBREVIATIONS[section] && !COUNTY_ABBREVIATIONS[prefix]) {
      errors.push(`Registration section "${prefix}" not found in Kenya locality database`)
    }
    
    const formatted = sectionInfo
      ? `${getCanonicalSectionLabel(sectionInfo, section)}/${parcel}${suffix ? '/' + suffix : ''}`
      : `${prefix}/${parcel}${suffix ? '/' + suffix : ''}`
    
    return {
      raw,
      format: sectionInfo?.hasBlocks || isSectionCodeStyle(prefix) ? 'BLOCK' : 'SECTION',
      county: sectionInfo?.county,
      registrationSection: section,
      parcelNumber: parcel,
      suffix,
      isValid: errors.length === 0,
      validationErrors: errors,
      formatted,
      shortForm: `${section}/${parcel}${suffix ? '/' + suffix : ''}`
    }
  }

  // Format C: L.R. No. 1234/56 (old-style)
  const lrPattern = /^L\.R\.?\s*NO\.?\s*(\d+)(?:\/(\d+))?$/i
  const lrMatch = normalized.match(lrPattern)
  
  if (lrMatch) {
    const parcel = parseInt(lrMatch[1], 10)
    const suffix = lrMatch[2]
    
    if (isNaN(parcel) || parcel <= 0) {
      errors.push('Parcel number must be a positive integer')
    }
    
    return {
      raw,
      format: 'LR',
      parcelNumber: parcel,
      suffix,
      isValid: errors.length === 0,
      validationErrors: errors,
      formatted: `L.R. No. ${parcel}${suffix ? '/' + suffix : ''}`,
      shortForm: `LR${parcel}${suffix ? '/' + suffix : ''}`
    }
  }

  // Invalid format
  return {
    raw,
    format: 'UNKNOWN',
    isValid: false,
    validationErrors: [
      'Invalid parcel number format. Use:',
      '  - NAIROBI BLOCK 2/1234 (block format)',
      '  - KIAMBU/456 (section format)',
      '  - L.R. No. 1234/56 (old-style)'
    ],
    formatted: '',
    shortForm: ''
  }
}

export function validateParcelNumber(raw: string): { isValid: boolean; errors: string[] } {
  const parsed = parseParcelNumber(raw)
  return {
    isValid: parsed.isValid,
    errors: parsed.validationErrors
  }
}

export function formatParcelNumber(
  section: string,
  block: number | null,
  number: number,
  suffix?: string
): string {
  const sectionInfo = lookupRegistrationSection(section)
  const sectionName = getCanonicalSectionLabel(sectionInfo, section.toUpperCase())
  
  if (block !== null && block !== undefined) {
    return `${sectionName} BLOCK ${block}/${number}${suffix ? '/' + suffix : ''}`
  }
  
  return `${sectionName}/${number}${suffix ? '/' + suffix : ''}`
}

export function generateParcelReference(
  countyCode: string,
  sectionCode: string,
  parcelNumber: number,
  block?: number
): string {
  const sectionInfo = lookupRegistrationSection(sectionCode)
  
  if (!sectionInfo) {
    return `${countyCode}/${sectionCode}/${parcelNumber}`
  }
  
  if (block) {
    return `${getCanonicalSectionLabel(sectionInfo, sectionCode)} BLOCK ${block}/${parcelNumber}`
  }
  
  return `${getCanonicalSectionLabel(sectionInfo, sectionCode)}/${parcelNumber}`
}

export function lookupRegistrationSection(input: string): RegistrationSection | null {
  const normalized = input.toUpperCase().trim()
  
  // Direct match
  const direct = getRegistrationSectionByCode(normalized)
  if (direct) return direct
  
  // Try county code
  const county = KENYA_COUNTIES.find((c: any) => 
    c.code.toUpperCase() === normalized || 
    c.name.toUpperCase() === normalized
  )
  if (county?.registrationSections[0]) {
    return county.registrationSections[0]
  }
  
  // Fuzzy match on section name
  const allSections = getAllRegistrationSections()
  const fuzzy = allSections.find((s: any) => 
    s.name.toUpperCase().includes(normalized) ||
    s.code.toUpperCase().includes(normalized)
  )
  if (fuzzy) return fuzzy
  
  // Check abbreviations
  const expanded = COUNTY_ABBREVIATIONS[normalized]
  if (expanded) {
    const countyByName = KENYA_COUNTIES.find((c: any) => c.name.toUpperCase() === expanded.toUpperCase())
    if (countyByName?.registrationSections[0]) {
      return countyByName.registrationSections[0]
    }
  }
  
  return null
}

export function getUTMZoneForParcel(sectionCode: string): { zone: number; hemisphere: 'N' | 'S' } {
  const section = lookupRegistrationSection(sectionCode)
  
  if (section) {
    return {
      zone: section.utmZone,
      hemisphere: section.hemisphere
    }
  }
  
  // Default to Nairobi
  return { zone: 37, hemisphere: 'S' }
}
