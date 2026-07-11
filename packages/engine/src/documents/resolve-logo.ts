/**
 * Logo Resolution Utility
 *
 * Resolves the company logo to use on generated documents.
 *
 * - Free plan: returns null → METARDU watermark will be applied by the PDF engine
 * - Pro/Team/Firm/Enterprise: looks up the user's uploaded logo from the database
 *   - If found, returns the logo Buffer
 *   - If not found, returns null (no watermark, no logo)
 */

import { db } from '@/lib/db';
import type { PlanId } from '@/lib/subscription/catalog';

export interface ResolvedLogo {
  /** The logo image data as a Buffer */
  data: Buffer;
  /** MIME type of the logo (image/png, image/jpeg, image/svg+xml) */
  mimeType: string;
  /** Original filename */
  filename: string;
}

/**
 * Resolve the company logo for a given user and plan.
 *
 * @param userId - The user's ID
 * @param plan - The user's subscription plan
 * @returns The resolved logo, or null if no logo should be shown
 */
export async function resolveCompanyLogo(
  userId: string,
  plan: PlanId
): Promise<ResolvedLogo | null> {
  // Free tier always gets METARDU watermark — no custom logo
  if (plan === 'free') {
    return null;
  }

  // Paid plans: look up the user's uploaded logo
  try {
    const { rows } = await db.query(
      'SELECT logo_data, mime_type, filename FROM company_logos WHERE user_id = $1',
      [userId]
    );

    if (rows.length === 0 || !rows[0].logo_data) {
      return null;
    }

    return {
      data: rows[0].logo_data as Buffer,
      mimeType: rows[0].mime_type as string,
      filename: rows[0].filename as string,
    };
  } catch (error) {
    console.error('[resolve-logo] Error fetching logo:', error);
    return null;
  }
}

/**
 * Determine the watermark strategy for document generation.
 *
 * - Free plan + no logo → METARDU watermark
 * - Paid plan + logo → Company logo in title block
 * - Paid plan + no logo → Blank (no watermark, no logo)
 */
export type WatermarkStrategy = 'metardu' | 'company_logo' | 'none';

export function getWatermarkStrategy(
  plan: PlanId,
  logo: ResolvedLogo | null
): WatermarkStrategy {
  if (plan === 'free') {
    return 'metardu';
  }
  if (logo) {
    return 'company_logo';
  }
  return 'none';
}
