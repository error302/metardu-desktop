/**
 * Engineering workflow — cross-sections, volumes, alignment/chainage.
 *
 * Master plan Section 6.3. Computes cut/fill volumes between two
 * surfaces (TIN-to-TIN or TIN-to-design-plane), extracts cross-
 * sections at specified chainages along an alignment, and produces
 * an engineering survey report.
 *
 * # Pipeline
 *
 *   1. Accept the existing-ground TIN + a design surface (plane or TIN)
 *   2. Compute cut/fill volumes by triangle-wise comparison
 *   3. Extract cross-sections at each chainage along the alignment
 *   4. Compute end-area volumes per section pair (average end area method)
 *   5. Output a JSON report with all sections + volumes
 *
 * # References
 *
 *   - Master plan Section 6.3
 *   - Schofield & Breach, "Engineering Surveying" Ch. 14 (volumes)
 *   - BS 7334-3 (UK engineering survey accuracy)
 *   - ICSM SP1 v2.2 (Australia engineering tolerance)
 */

import type { CountrySurveyConfig } from "@metardu/country-config";
import type { TIN, TopoPoint } from "./topographic.js";

// ─── Types ───────────────────────────────────────────────────────

/** A design surface — either a flat plane or a TIN. */
export interface DesignSurface {
  type: "plane" | "tin";
  /** For "plane": the plane equation is z = a*x + b*y + c. */
  plane?: { a: number; b: number; c: number };
  /** For "tin": the design TIN. */
  tin?: TIN;
}

/** An alignment (centerline) defined by a series of points + chainages. */
export interface Alignment {
  /** Centerline points in order, with chainage (metres from start). */
  points: { chainage: number; easting: number; northing: number }[];
}

/** A cross-section. */
export interface CrossSection {
  /** Chainage along the alignment (metres). */
  chainage: number;
  /** Centerline point. */
  centerline: { easting: number; northing: number };
  /** Cross-section profile: offset (m) → elevation (m). */
  profile: { offset: number; existingElevation: number; designElevation: number }[];
  /** Cut/fill area at this section (m²). Positive = cut, negative = fill. */
  area: number;
}

/** Input to the engineering workflow. */
export interface EngineeringWorkflowInput {
  /** Existing-ground TIN. */
  existingGround: TIN;
  /** Design surface. */
  design: DesignSurface;
  /** Alignment (centerline). */
  alignment: Alignment;
  /** Cross-section spacing (metres). */
  sectionSpacing: number;
  /** Cross-section width (metres, total — half each side of the centerline). */
  sectionWidth: number;
  /** Cross-section sample interval (metres along the section). */
  sectionSampleInterval: number;
  /** Active country config. */
  country: CountrySurveyConfig;
}

/** Output of the engineering workflow. */
export interface EngineeringWorkflowOutput {
  /** Generated cross-sections. */
  sections: CrossSection[];
  /** Total cut volume (m³). */
  cutVolume: number;
  /** Total fill volume (m³). */
  fillVolume: number;
  /** Net volume (cut - fill, m³). Positive = net cut. */
  netVolume: number;
  /** Engineering tolerance from the country config. */
  engineeringToleranceM: number;
  /** Number of sections generated. */
  sectionCount: number;
  /** Max cut depth (m). */
  maxCutDepth: number;
  /** Max fill height (m). */
  maxFillHeight: number;
}

// ─── Main entry point ────────────────────────────────────────────

/**
 * Run the engineering workflow: cross-sections + cut/fill volumes.
 *
 * Uses the average-end-area method for volume computation:
 *   V = (A1 + A2) / 2 × L
 * where A1, A2 are the cut/fill areas at consecutive sections and L
 * is the chainage difference.
 */
export function runEngineeringWorkflow(input: EngineeringWorkflowInput): EngineeringWorkflowOutput {
  if (input.existingGround.triangles.length === 0) {
    throw new Error("Existing ground TIN has no triangles.");
  }
  if (input.alignment.points.length < 2) {
    throw new Error("Alignment requires at least 2 points.");
  }
  if (input.sectionSpacing <= 0 || input.sectionWidth <= 0 || input.sectionSampleInterval <= 0) {
    throw new Error("Section spacing, width, and sample interval must be positive.");
  }

  // Sample cross-sections along the alignment.
  const sections: CrossSection[] = [];
  const totalChainage = input.alignment.points[input.alignment.points.length - 1]!.chainage;

  for (let ch = 0; ch <= totalChainage + 1e-9; ch += input.sectionSpacing) {
    const centerline = interpolateAlignment(input.alignment, ch);
    if (!centerline) continue;
    const bearing = alignmentBearingAt(input.alignment, ch);

    const profile: { offset: number; existingElevation: number; designElevation: number }[] = [];
    const halfWidth = input.sectionWidth / 2;

    for (let off = -halfWidth; off <= halfWidth + 1e-9; off += input.sectionSampleInterval) {
      // Sample point perpendicular to the alignment.
      const sampleE = centerline.easting + off * Math.cos(bearing + Math.PI / 2);
      const sampleN = centerline.northing + off * Math.sin(bearing + Math.PI / 2);

      const existingElev = interpolateTINElevation(input.existingGround, sampleE, sampleN);
      const designElev = interpolateDesignElevation(input.design, sampleE, sampleN);

      if (existingElev !== null && designElev !== null) {
        profile.push({ offset: off, existingElevation: existingElev, designElevation: designElev });
      }
    }

    if (profile.length < 2) continue;

    // Compute cut/fill area at this section using the trapezoidal rule.
    let area = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const p1 = profile[i]!;
      const p2 = profile[i + 1]!;
      const w = p2.offset - p1.offset;
      const d1 = p1.existingElevation - p1.designElevation; // positive = cut
      const d2 = p2.existingElevation - p2.designElevation;
      area += w * (d1 + d2) / 2;
    }

    sections.push({
      chainage: ch,
      centerline,
      profile,
      area,
    });
  }

  // Compute volumes via average-end-area method.
  let cutVolume = 0;
  let fillVolume = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    const s1 = sections[i]!;
    const s2 = sections[i + 1]!;
    const L = s2.chainage - s1.chainage;
    if (L <= 0) continue;

    // If both areas are cut (positive), add to cut volume.
    if (s1.area > 0 && s2.area > 0) {
      cutVolume += (s1.area + s2.area) / 2 * L;
    } else if (s1.area < 0 && s2.area < 0) {
      // Both fill.
      fillVolume += Math.abs((s1.area + s2.area) / 2 * L);
    } else {
      // Mixed — transition section. Split the volume proportionally.
      // Use the prismoidal formula's mixed-case handling.
      const totalArea = Math.abs(s1.area) + Math.abs(s2.area);
      if (totalArea > 1e-9) {
        const cutFraction = (Math.max(0, s1.area) + Math.max(0, s2.area)) / totalArea;
        const totalVol = Math.abs((s1.area + s2.area) / 2 * L);
        cutVolume += totalVol * cutFraction;
        fillVolume += totalVol * (1 - cutFraction);
      }
    }
  }

  // Max cut/fill depths.
  let maxCutDepth = 0;
  let maxFillHeight = 0;
  for (const s of sections) {
    for (const p of s.profile) {
      const diff = p.existingElevation - p.designElevation;
      if (diff > maxCutDepth) maxCutDepth = diff;
      if (-diff > maxFillHeight) maxFillHeight = -diff;
    }
  }

  // Engineering tolerance from country config.
  const engRule = input.country.toleranceTable.find(
    (r) => r.surveyType === "Engineering" && r.toleranceType === "horizontal_position",
  );
  const engineeringToleranceM = engRule ? engRule.compute({}) : 0.015;

  return {
    sections,
    cutVolume,
    fillVolume,
    netVolume: cutVolume - fillVolume,
    engineeringToleranceM,
    sectionCount: sections.length,
    maxCutDepth,
    maxFillHeight,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Interpolate the alignment at a given chainage. */
function interpolateAlignment(alignment: Alignment, chainage: number): { easting: number; northing: number } | null {
  if (alignment.points.length === 0) return null;
  if (chainage < alignment.points[0]!.chainage || chainage > alignment.points[alignment.points.length - 1]!.chainage) {
    return null;
  }
  for (let i = 0; i < alignment.points.length - 1; i++) {
    const p1 = alignment.points[i]!;
    const p2 = alignment.points[i + 1]!;
    if (chainage >= p1.chainage && chainage <= p2.chainage) {
      const t = (chainage - p1.chainage) / (p2.chainage - p1.chainage);
      return {
        easting: p1.easting + t * (p2.easting - p1.easting),
        northing: p1.northing + t * (p2.northing - p1.northing),
      };
    }
  }
  return null;
}

/** Compute the alignment bearing at a given chainage (radians, clockwise from North). */
function alignmentBearingAt(alignment: Alignment, chainage: number): number {
  for (let i = 0; i < alignment.points.length - 1; i++) {
    const p1 = alignment.points[i]!;
    const p2 = alignment.points[i + 1]!;
    if (chainage >= p1.chainage && chainage <= p2.chainage) {
      const de = p2.easting - p1.easting;
      const dn = p2.northing - p1.northing;
      return Math.atan2(de, dn);
    }
  }
  return 0;
}

/** Interpolate the elevation of a point (e, n) on a TIN. */
function interpolateTINElevation(tin: TIN, e: number, n: number): number | null {
  for (const tri of tin.triangles) {
    const a = tin.vertices[tri[0]]!;
    const b = tin.vertices[tri[1]]!;
    const c = tin.vertices[tri[2]]!;
    if (pointInTriangle(e, n, a, b, c)) {
      // Barycentric interpolation.
      const v0x = b.easting - a.easting, v0y = b.northing - a.northing;
      const v1x = c.easting - a.easting, v1y = c.northing - a.northing;
      const v2x = e - a.easting, v2y = n - a.northing;
      const denom = v0x * v1y - v0y * v1x;
      if (Math.abs(denom) < 1e-12) return null;
      const v = (v2x * v1y - v2y * v1x) / denom;
      const w = (v0x * v2y - v0y * v2x) / denom;
      const u = 1 - v - w;
      return u * a.elevation + v * b.elevation + w * c.elevation;
    }
  }
  return null;
}

/** Check if point (e, n) is inside triangle (a, b, c). */
function pointInTriangle(e: number, n: number, a: TopoPoint, b: TopoPoint, c: TopoPoint): boolean {
  const d1 = (e - b.easting) * (a.northing - b.northing) - (a.easting - b.easting) * (n - b.northing);
  const d2 = (e - c.easting) * (b.northing - c.northing) - (b.easting - c.easting) * (n - c.northing);
  const d3 = (e - a.easting) * (c.northing - a.northing) - (c.easting - a.easting) * (n - a.northing);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Interpolate the design elevation at (e, n). */
function interpolateDesignElevation(design: DesignSurface, e: number, n: number): number | null {
  if (design.type === "plane" && design.plane) {
    return design.plane.a * e + design.plane.b * n + design.plane.c;
  }
  if (design.type === "tin" && design.tin) {
    return interpolateTINElevation(design.tin, e, n);
  }
  return null;
}
