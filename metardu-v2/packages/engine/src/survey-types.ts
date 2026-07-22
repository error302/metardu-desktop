/**
 * Shared survey-domain types used across multiple workflows.
 *
 * Promoted here from `workflows/cadastral.ts` so that the topographic
 * and engineering workflows (and the integration exporters that consume
 * them) can reference the same `PointUncertainty` shape without
 * cross-workflow imports.
 *
 * Per master plan Section 5.3 invariant C1: every statutory number
 * must trace to an adjusted value with a stated uncertainty. This type
 * is the canonical shape of that uncertainty, surfaced on every
 * workflow's output.
 */

/**
 * Per-point uncertainty. Known (fixed) control points have
 * `adjusted: false` and no ellipse. New (adjusted) points carry the
 * full 2D error ellipse at the stated confidence level.
 *
 * Renamed from `BeaconUncertainty` (the cadastral-only name) to
 * `PointUncertainty` (the survey-domain name) — but the shape is
 * identical. `BeaconUncertainty` is re-exported as an alias from
 * `workflows/cadastral.ts` for backward compatibility.
 */
export interface PointUncertainty {
  /** True if this point's coordinates were adjusted by an LS fit. */
  adjusted: boolean;
  /** Semi-major axis of the error ellipse, in metres. */
  semiMajorAxis?: number;
  /** Semi-minor axis of the error ellipse, in metres. */
  semiMinorAxis?: number;
  /** Orientation of the semi-major axis, degrees clockwise from north. */
  orientation?: number;
  /** Confidence level (0–1). Default 0.95 (95% confidence ellipse). */
  confidenceLevel?: number;
  /** A posteriori variance factor the ellipse was scaled by. */
  sigma_0_sq?: number;
  /**
   * Reason the ellipse is absent. Used when `adjusted: false` or when
   * the configuration is degenerate. Consumed by the GeoJSON exporter
   * to produce a human-readable `uncertainty.reason` field per feature.
   *
   *   - "fixed-control"     — known control point, no propagated uncertainty by design
   *   - "field-data"        — raw field reading, no LS adjustment run (topo/engg default)
   *   - "degenerate-configuration" — adjustment ran but normal matrix was singular
   *   - "missing"           — no uncertainty record at all (data integrity gap)
   */
  reason?: "fixed-control" | "field-data" | "degenerate-configuration" | "missing";
}
