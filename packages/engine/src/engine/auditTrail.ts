/**
 * METARDU Computation Audit Trail
 *
 * Every computation run produces an audit record with:
 * - Hash of inputs → hash of outputs
 * - Source references (Ghilani & Wolf, Basak, RDM 1.1)
 * - Timestamp and user context
 *
 * This enables:
 * 1. Reprinting a document months later and proving inputs were unchanged
 * 2. Reviewing officer can trace every intermediate value
 * 3. Professional liability defense — "the software computed X given Y"
 *
 * Source: Kenya Survey Act Cap 299 — survey records must be traceable
 * Source: ISK Professional Ethics — surveyor must be able to defend computations
 */

export interface ComputationAuditRecord {
  id: string;
  computationType: string;
  timestamp: string;
  userId?: string;
  projectId?: string;

  // Source references
  sources: string[];

  // Input/output hashes for reproducibility
  inputHash: string;
  outputHash: string;

  // The actual inputs and outputs (for audit trail display)
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;

  // Intermediate steps (for computation workbook)
  steps?: Array<{
    label: string;
    formula: string;
    value: number;
    source: string;
  }>;
}

/**
 * Simple hash function for computation inputs/outputs.
 * Uses SubtleCrypto if available (browser/server), falls back to simple string hash.
 * NOT cryptographic — just for change detection.
 */
export async function hashComputationData(data: unknown): Promise<string> {
  const str = JSON.stringify(data, Object.keys(data as object).sort());

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple string hash (djb2)
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Create an audit record for a computation run.
 */
export async function createAuditRecord(params: {
  computationType: string;
  sources: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  steps?: ComputationAuditRecord['steps'];
  userId?: string;
  projectId?: string;
}): Promise<ComputationAuditRecord> {
  const [inputHash, outputHash] = await Promise.all([
    hashComputationData(params.inputs),
    hashComputationData(params.outputs),
  ]);

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    computationType: params.computationType,
    timestamp: new Date().toISOString(),
    userId: params.userId,
    projectId: params.projectId,
    sources: params.sources,
    inputHash,
    outputHash,
    inputs: params.inputs,
    outputs: params.outputs,
    steps: params.steps,
  };
}

/**
 * Standard source references used across the engine.
 */
export const STANDARD_SOURCES = {
  BOWDITCH: 'Basak, Chapter 11 — Bowditch (Compass) Rule; Ghilani & Wolf, Chapter 12',
  TRANSIT: 'Basak, Chapter 11 — Transit Rule; Ghilani & Wolf, Chapter 12',
  AREA_SHOELACE: 'Basak, Chapter 4; Ghilani & Wolf, Eq. 12.5 — Coordinate Method (Shoelace)',
  UTM_REDFEARN: 'EPSG Guidance Note 7-2 — Redfearn formula; Ghilani & Wolf, Chapter 7',
  LEVELING_RF: 'Basak, Chapters 5-7; Ghilani & Wolf, Chapters 5-6',
  LEVELING_HOC: 'Basak, Chapters 5-7; Ghilani & Wolf, Chapters 5-6',
  RDM1_1_LEVEL: 'RDM 1.1 Kenya 2025, Table 5.1 — Allowable misclosure 10√K mm',
  RDM1_1_TRAVERSE: 'RDM 1.1 Kenya 2025, Table 2.4 — Accuracy Classification',
  KENYA_SURVEY_REG: 'Kenya Survey Regulations 1994, Cap 299, Regulation 97',
  COGO_INVERSE: 'Basak, Chapter 10; Ghilani & Wolf, Chapter 12 — Inverse computation',
  COGO_POLAR: 'Basak, Chapter 10; Ghilani & Wolf, Chapter 12 — Forward (Polar) computation',
} as const;
