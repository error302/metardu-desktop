/**
 * Subscription catalog — plan IDs for the METARDU Desktop product.
 *
 * In the upstream metardu web app this is a full SaaS subscription catalog
 * with stripe integration, plan limits, feature flags, etc. For the desktop
 * fork we only need the PlanId type — the desktop app is a single-user
 * perpetual license, not a SaaS subscription.
 *
 * We keep the same type shape so the document templates (deed plan, form
 * no 4, etc.) work without modification. The "free" plan id is used for
 * unsigned documents; "pro" is used after the surveyor's certificate is
 * applied (which acts as the license signature).
 */

export type PlanId = 'free' | 'pro' | 'team' | 'firm' | 'enterprise';

export interface PlanLimits {
  maxProjects: number;
  maxPointsPerProject: number;
  watermarkFreeTier: boolean;
  statutoryDocsEnabled: boolean;
  nlimsExportEnabled: boolean;
  cryptoSealEnabled: boolean;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    maxProjects: 1,
    maxPointsPerProject: 50,
    watermarkFreeTier: true,
    statutoryDocsEnabled: false,
    nlimsExportEnabled: false,
    cryptoSealEnabled: false,
  },
  pro: {
    maxProjects: Infinity,
    maxPointsPerProject: Infinity,
    watermarkFreeTier: false,
    statutoryDocsEnabled: true,
    nlimsExportEnabled: true,
    cryptoSealEnabled: true,
  },
  team: {
    maxProjects: Infinity,
    maxPointsPerProject: Infinity,
    watermarkFreeTier: false,
    statutoryDocsEnabled: true,
    nlimsExportEnabled: true,
    cryptoSealEnabled: true,
  },
  firm: {
    maxProjects: Infinity,
    maxPointsPerProject: Infinity,
    watermarkFreeTier: false,
    statutoryDocsEnabled: true,
    nlimsExportEnabled: true,
    cryptoSealEnabled: true,
  },
  enterprise: {
    maxProjects: Infinity,
    maxPointsPerProject: Infinity,
    watermarkFreeTier: false,
    statutoryDocsEnabled: true,
    nlimsExportEnabled: true,
    cryptoSealEnabled: true,
  },
};

export function getPlanLimits(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}
