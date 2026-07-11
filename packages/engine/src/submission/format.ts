export const SUBMISSION_NUMBER_PATTERN = /^[A-Z]{1,4}\d{1,6}_\d{4}_\d{3}_R\d{2}$/

export interface SubmissionNumberParts {
  registrationNo: string
  year: number
  sequence: number
  revision: number
}

export function buildSubmissionNumber(parts: SubmissionNumberParts): string {
  const registrationNo = parts.registrationNo.trim().toUpperCase()
  const year = Number.isFinite(parts.year) ? parts.year : new Date().getFullYear()
  const sequence = Math.max(1, Math.trunc(parts.sequence || 1))
  const revision = Math.max(0, Math.trunc(parts.revision || 0))

  return `${registrationNo}_${year}_${String(sequence).padStart(3, '0')}_R${String(revision).padStart(2, '0')}`
}

export function validateSubmissionNumber(value?: string): boolean {
  return !!value && SUBMISSION_NUMBER_PATTERN.test(value.trim().toUpperCase())
}

export function normaliseRegistrationNo(value?: string): string {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '')
}
