/**
 * Document Template Registry
 *
 * Maps DocumentType to the correct template generator.
 * Each template has: id, name, description, documentType, generator function.
 *
 * Templates:
 * - deed-plan: Kenya Deed Plan (A1 landscape, with grid, north arrow, beacon schedule, area table)
 * - form-c22: Form C-22 (A4 portrait, registration form under Land Registration Act)
 * - beacon-certificate: Beacon Certificate (A4 portrait, with beacon photo placeholder)
 * - traverse-sheet: Traverse Computation Sheet (A4 landscape, with face-left/face-right columns)
 * - setting-out: Setting Out Sheet (A4 portrait, with coordinate table)
 * - topo-plan: Topographic Plan (A1 landscape, with contour legend, feature code legend)
 * - mutation-form: Mutation Form (A4 portrait, for subdivision/amalgamation per Survey Act Cap 299)
 * - form-no4: Form No. 4 (A4 portrait, survey submission form per Survey Act Cap 299)
 * - contour-plan: Contour Plan (A1 landscape, contour interval legend)
 * - cross-section: Cross Section Drawing (A3 landscape, with grid, levels, chainage)
 */

import type { PlanId } from '@/lib/subscription/catalog';
import type { ResolvedLogo } from '../resolve-logo';

// ─── Document Type Enum ──────────────────────────────────────────

export type DocumentType =
  | 'deed-plan'
  | 'form-c22'
  | 'beacon-certificate'
  | 'traverse-sheet'
  | 'setting-out'
  | 'topo-plan'
  | 'mutation-form'
  | 'form-no4'
  | 'contour-plan'
  | 'cross-section';

// ─── Template Definition ─────────────────────────────────────────

export interface DocumentTemplate<T = unknown> {
  /** Unique template identifier */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Brief description of the template */
  description: string;
  /** Document type this template generates */
  documentType: DocumentType;
  /** Paper size (e.g., 'A1', 'A4') */
  paperSize: string;
  /** Orientation */
  orientation: 'portrait' | 'landscape';
  /** Generator function that produces a PDF Buffer */
  generate: (data: T, options?: TemplateGenerateOptions) => Promise<Buffer>;
}

export interface TemplateGenerateOptions {
  /** User's subscription plan */
  plan?: PlanId;
  /** Resolved company logo (null for free tier or if not uploaded) */
  companyLogo?: ResolvedLogo | null;
}

// ─── Template Registry ───────────────────────────────────────────

const templates = new Map<DocumentType, DocumentTemplate>();

/**
 * Register a template in the registry.
 */
export function registerTemplate(template: DocumentTemplate): void {
  templates.set(template.documentType, template);
}

/**
 * Get a template by document type.
 */
export function getTemplate(documentType: DocumentType): DocumentTemplate | undefined {
  return templates.get(documentType);
}

/**
 * Get all registered templates.
 */
export function getAllTemplates(): DocumentTemplate[] {
  return Array.from(templates.values());
}

/**
 * Check if a template exists for a given document type.
 */
export function hasTemplate(documentType: DocumentType): boolean {
  return templates.has(documentType);
}

/**
 * Generate a document using the appropriate template.
 *
 * @throws Error if no template is registered for the given document type
 */
export async function generateDocument(
  documentType: DocumentType,
  data: unknown,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  const template = templates.get(documentType);
  if (!template) {
    throw new Error(`No template registered for document type: ${documentType}`);
  }
  return template.generate(data, options);
}

// ─── Lazy-loaded Template Registration ───────────────────────────
// Templates are registered on first access to avoid circular imports
// and to keep startup fast.

let registered = false;

/**
 * Ensure all templates are registered.
 * Called lazily before first document generation.
 */
function ensureRegistered(): void {
  if (registered) return;
  registered = true;

  // Import and register each template
  // Using dynamic imports to avoid circular dependencies
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const deedPlan = require('./deed-plan');
    registerTemplate(deedPlan.DEED_PLAN_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const formC22 = require('./form-c22');
    registerTemplate(formC22.FORM_C22_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const beaconCert = require('./beacon-certificate');
    registerTemplate(beaconCert.BEACON_CERTIFICATE_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const traverseSheet = require('./traverse-sheet');
    registerTemplate(traverseSheet.TRAVERSE_SHEET_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingOut = require('./setting-out');
    registerTemplate(settingOut.SETTING_OUT_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const topoPlan = require('./topo-plan');
    registerTemplate(topoPlan.TOPO_PLAN_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mutationForm = require('./mutation-form');
    registerTemplate(mutationForm.MUTATION_FORM_TEMPLATE);
  } catch { /* template not available yet */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const formNo4 = require('./form-no4');
    registerTemplate(formNo4.FORM_NO4_TEMPLATE);
  } catch { /* template not available yet */ }
}

// Override getTemplate to ensure lazy registration
const originalGetTemplate = getTemplate;
export { originalGetTemplate as _getTemplateDirect };

/**
 * Get a template, ensuring all templates are registered first.
 */
export function getRegisteredTemplate(documentType: DocumentType): DocumentTemplate | undefined {
  ensureRegistered();
  return templates.get(documentType);
}

/**
 * Generate a document, ensuring templates are registered first.
 */
export async function generateDocumentSafe(
  documentType: DocumentType,
  data: unknown,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  ensureRegistered();
  return generateDocument(documentType, data, options);
}
