// ============================================================
// METARDU — CLA Forms Index/Registry
// Community Land Act No. 27 of 2016, Kenya
//
// Central registry for all CLA form generators.
// Re-exports all form generators, input types, and provides
// lookup utilities for the METARDU platform.
// ============================================================

/**
 * Union type of all valid CLA form numbers covered by METARDU.
 * These correspond to specific forms prescribed under the
 * Community Land Act No. 27 of 2016.
 */
export type ClaFormNumber = 1 | 2 | 3 | 4 | 5 | 6 | 9 | 11 | 12

/**
 * Metadata descriptor for a CLA form, used for UI rendering,
 * routing, and form selection within the METARDU platform.
 */
export interface ClaFormMetadata {
  /** The CLA form number as referenced in the Act */
  formNumber: ClaFormNumber
  /** Human-readable title of the form */
  title: string
  /** The section of the Community Land Act under which the form falls */
  section: string
  /** Brief description of the form's purpose */
  description: string
  /** TypeScript interface name for the form's input type */
  inputType: string
}

/**
 * Complete registry of all CLA form metadata, ordered by form number.
 * Used for programmatic access to form information throughout the platform.
 */
export const CLA_FORMS: ClaFormMetadata[] = [
  {
    formNumber: 1,
    title: 'Application for Registration of Community Land',
    section: 'Section 12',
    description: 'Initial application to register community land under the Act',
    inputType: 'CLA1Input',
  },
  {
    formNumber: 2,
    title: 'Notice of Intention to Allocate Community Land',
    section: 'Section 15',
    description: 'Public notice before community land allocation to an allottee',
    inputType: 'CLA2Input',
  },
  {
    formNumber: 3,
    title: 'Community Land Rights Allocation Record',
    section: 'Section 16',
    description: 'Record of allocations of community land rights (lease, license, customary)',
    inputType: 'CLA3Input',
  },
  {
    formNumber: 4,
    title: 'Community Land Register Entry',
    section: 'Section 17',
    description: 'Official register entry for recording community land interests',
    inputType: 'CLA4Input',
  },
  {
    formNumber: 5,
    title: 'Application for Community Land Title',
    section: 'Section 27',
    description: 'Application for issuance of collective or individual community land title',
    inputType: 'CLA5Input',
  },
  {
    formNumber: 6,
    title: 'Community Assembly Resolution Record',
    section: 'Section 6',
    description: 'Official record of community assembly proceedings and resolution outcomes',
    inputType: 'CLA6Input',
  },
  {
    formNumber: 9,
    title: 'Application for Lease or License of Community Land',
    section: 'Section 36',
    description: 'Application by an individual or entity for a lease or license over community land',
    inputType: 'CLA9Input',
  },
  {
    formNumber: 11,
    title: 'Notice of Variation of Community Land Rights',
    section: 'Section 40',
    description: 'Notice of proposed variation to existing community land rights',
    inputType: 'CLA11Input',
  },
  {
    formNumber: 12,
    title: 'Community Land Dispute Resolution Form',
    section: 'Sections 38 & 39',
    description: 'Records community land disputes and the resolution process',
    inputType: 'CLA12Input',
  },
]

/** Valid set of CLA form numbers for quick membership checking */
export const VALID_CLA_FORM_NUMBERS: ReadonlySet<number> = new Set(CLA_FORMS.map(f => f.formNumber))

// ── Static imports of all generators ────────────────────────
import { generateCLAForm1 } from './claForm1'
import { generateCLAForm2 } from './claForm2'
import { generateCLAForm3 } from './claForm3'
import { generateCLAForm4 } from './claForm4'
import { generateCLAForm5 } from './claForm5'
import { generateCLAForm6 } from './claForm6'
import { generateCLAForm9 } from './claForm9'
import { generateCLAForm11 } from './claForm11'
import { generateCLAForm12 } from './claForm12'

// ── Re-exports: Input Interfaces ──────────────────────────────

export type { CLA1Input } from './claForm1'
export type { CLA2Input } from './claForm2'
export type { CLA3Input, AllocationEntry } from './claForm3'
export type { CLA4Input } from './claForm4'
export type { CLA5Input } from './claForm5'
export type { CLA6Input } from './claForm6'
export type { CLA9Input } from './claForm9'
export type { CLA11Input, VariationRow } from './claForm11'
export type { CLA12Input, Witness, DisputeResolutionCommittee } from './claForm12'

// ── Re-exports: Generator Functions ───────────────────────────

export { generateCLAForm1 } from './claForm1'
export { generateCLAForm2 } from './claForm2'
export { generateCLAForm3 } from './claForm3'
export { generateCLAForm4 } from './claForm4'
export { generateCLAForm5 } from './claForm5'
export { generateCLAForm6 } from './claForm6'
export { generateCLAForm9 } from './claForm9'
export { generateCLAForm11 } from './claForm11'
export { generateCLAForm12 } from './claForm12'

// ── Generator Function Type ──────────────────────────────────

/** Generic type for any CLA form generator function */
export type ClaFormGenerator = (input: unknown) => Uint8Array

/**
 * Retrieves the CLA form generator function for the given form number.
 * Uses static imports for reliability in Next.js server context.
 */
export function getClaFormGenerator(formNumber: ClaFormNumber): ClaFormGenerator | undefined {
  switch (formNumber) {
    case 1: return generateCLAForm1 as unknown as ClaFormGenerator
    case 2: return generateCLAForm2 as unknown as ClaFormGenerator
    case 3: return generateCLAForm3 as unknown as ClaFormGenerator
    case 4: return generateCLAForm4 as unknown as ClaFormGenerator
    case 5: return generateCLAForm5 as unknown as ClaFormGenerator
    case 6: return generateCLAForm6 as unknown as ClaFormGenerator
    case 9: return generateCLAForm9 as unknown as ClaFormGenerator
    case 11: return generateCLAForm11 as unknown as ClaFormGenerator
    case 12: return generateCLAForm12 as unknown as ClaFormGenerator
    default: return undefined
  }
}

/**
 * Retrieves the metadata descriptor for a given CLA form number.
 *
 * @param formNumber - The CLA form number
 * @returns The metadata object, or `undefined` if not found
 */
export function getClaFormMetadata(formNumber: ClaFormNumber): ClaFormMetadata | undefined {
  return CLA_FORMS.find(f => f.formNumber === formNumber)
}

/**
 * Validates whether a given number is a recognized CLA form number.
 *
 * @param formNumber - The number to validate
 * @returns `true` if the form number is recognized by METARDU
 */
export function isValidClaFormNumber(formNumber: number): formNumber is ClaFormNumber {
  return VALID_CLA_FORM_NUMBERS.has(formNumber)
}
