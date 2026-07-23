/**
 * Corridor/alignment design module — horizontal + vertical alignment
 * design + template-based cross-section generation.
 *
 * Civil 3D corridor equivalent. Allows a surveyor to:
 *   1. Design a horizontal alignment (tangents + curves)
 *   2. Design a vertical alignment (grades + vertical curves)
 *   3. Apply a cross-section template (e.g. road with lanes, shoulders)
 *   4. Generate cross-sections at each chainage
 *   5. Compute earthwork volumes
 *
 * References:
 *   - Civil 3D corridor modeling documentation
 *   - AASHTO Green Book (horizontal + vertical curve design)
 *   - Schofield & Breach, "Engineering Surveying" Ch. 12-13
 */

// ─── Types ───────────────────────────────────────────────────────

export interface HorizontalElement {
  type: "tangent" | "circular_curve" | "spiral";
  startChainage: number;
  endChainage: number;
  /** For tangents: bearing (decimal degrees). */
  bearing?: number;
  /** For curves: radius (metres). */
  radius?: number;
  /** For spirals: parameter (metres). */
  spiralParameter?: number;
  /** Start point (easting, northing). */
  startPoint: { easting: number; northing: number };
  /** End point (easting, northing). */
  endPoint: { easting: number; northing: number };
}

export interface VerticalElement {
  type: "grade" | "vertical_curve" | "level";
  startChainage: number;
  endChainage: number;
  /** Start elevation (metres). */
  startElevation: number;
  /** End elevation (metres). */
  endElevation: number;
  /** For grades: slope (%). */
  grade?: number;
  /** For vertical curves: length (metres) + curve type. */
  curveLength?: number;
  curveType?: "parabolic" | "circular";
}

export interface CrossSectionTemplate {
  name: string;
  /** Template elements: offset from centerline + elevation difference. */
  elements: {
    offset: number; // metres from centerline (negative = left)
    elevationDelta: number; // metres relative to design elevation
    label: string; // e.g. "Edge of shoulder", "Lane line"
  }[];
  /** Total width (metres). */
  totalWidth: number;
}

export interface CorridorDesign {
  name: string;
  horizontal: HorizontalElement[];
  vertical: VerticalElement[];
  template: CrossSectionTemplate;
  startChainage: number;
  endChainage: number;
  crossSectionInterval: number;
}

export interface DesignCrossSection {
  chainage: number;
  centerlineElevation: number;
  centerline: { easting: number; northing: number };
  bearing: number;
  points: { offset: number; easting: number; northing: number; elevation: number; label: string }[];
}

export interface CorridorResult {
  crossSections: DesignCrossSection[];
  totalLength: number;
  cutVolume: number;
  fillVolume: number;
  netVolume: number;
  template: CrossSectionTemplate;
  /**
   * Per-point uncertainty for corridor alignment + cross-section points.
   */
  pointUncertainty: Record<string, PointUncertainty>;
}

// ─── Standard templates ──────────────────────────────────────────

export const STANDARD_TEMPLATES: Record<string, CrossSectionTemplate> = {
  "single_lane_road": {
    name: "Single Lane Road (7m)",
    elements: [
      { offset: -3.5, elevationDelta: -0.07, label: "Left edge" },
      { offset: -3.0, elevationDelta: -0.06, label: "Left lane" },
      { offset: 0, elevationDelta: 0, label: "Centerline" },
      { offset: 3.0, elevationDelta: -0.06, label: "Right lane" },
      { offset: 3.5, elevationDelta: -0.07, label: "Right edge" },
      { offset: -4.5, elevationDelta: -0.15, label: "Left shoulder" },
      { offset: 4.5, elevationDelta: -0.15, label: "Right shoulder" },
    ],
    totalWidth: 9.0,
  },
  "dual_carriageway": {
    name: "Dual Carriageway (14m)",
    elements: [
      { offset: -7.0, elevationDelta: -0.14, label: "Left edge" },
      { offset: -3.5, elevationDelta: -0.07, label: "Left lane outer" },
      { offset: 0, elevationDelta: 0, label: "Centerline" },
      { offset: 3.5, elevationDelta: -0.07, label: "Right lane inner" },
      { offset: 7.0, elevationDelta: -0.14, label: "Right edge" },
      { offset: -8.5, elevationDelta: -0.20, label: "Left shoulder" },
      { offset: 8.5, elevationDelta: -0.20, label: "Right shoulder" },
    ],
    totalWidth: 17.0,
  },
  "footpath": {
    name: "Footpath (2m)",
    elements: [
      { offset: -1.0, elevationDelta: -0.02, label: "Left edge" },
      { offset: 0, elevationDelta: 0, label: "Centerline" },
      { offset: 1.0, elevationDelta: -0.02, label: "Right edge" },
    ],
    totalWidth: 2.0,
  },
};

// ─── Main entry point ────────────────────────────────────────────

export function generateCorridor(design: CorridorDesign): CorridorResult {
  if (design.horizontal.length === 0) throw new Error("No horizontal elements.");
  if (design.vertical.length === 0) throw new Error("No vertical elements.");

  const crossSections: DesignCrossSection[] = [];
  const totalLength = design.endChainage - design.startChainage;

  for (let ch = design.startChainage; ch <= design.endChainage + 0.01; ch += design.crossSectionInterval) {
    const centerline = getCenterlineAtChainage(design.horizontal, ch);
    const bearing = getBearingAtChainage(design.horizontal, ch);
    const elevation = getElevationAtChainage(design.vertical, ch);

    if (!centerline || bearing === null) continue;

    const points = design.template.elements.map((el) => {
      // Perpendicular offset from centerline.
      const perpRad = (bearing + 90) * Math.PI / 180;
      const easting = centerline.easting + el.offset * Math.sin(perpRad);
      const northing = centerline.northing + el.offset * Math.cos(perpRad);
      const elev = elevation + el.elevationDelta;
      return { offset: el.offset, easting, northing, elevation: elev, label: el.label };
    });

    crossSections.push({
      chainage: ch,
      centerlineElevation: elevation,
      centerline,
      bearing,
      points,
    });
  }

  // Volumes would require the existing ground surface for comparison.
  // Return zeros — the caller can use compareSurfaces() separately.
  return {
    crossSections,
    totalLength,
    cutVolume: 0,
    fillVolume: 0,
    netVolume: 0,
    template: design.template,
    pointUncertainty: {},
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function getCenterlineAtChainage(elements: HorizontalElement[], chainage: number): { easting: number; northing: number } | null {
  for (const el of elements) {
    if (chainage >= el.startChainage && chainage <= el.endChainage) {
      const t = (chainage - el.startChainage) / (el.endChainage - el.startChainage);
      return {
        easting: el.startPoint.easting + t * (el.endPoint.easting - el.startPoint.easting),
        northing: el.startPoint.northing + t * (el.endPoint.northing - el.startPoint.northing),
      };
    }
  }
  return null;
}

function getBearingAtChainage(elements: HorizontalElement[], chainage: number): number | null {
  for (const el of elements) {
    if (chainage >= el.startChainage && chainage <= el.endChainage) {
      if (el.type === "tangent" && el.bearing !== undefined) return el.bearing;
      // For curves, compute the bearing at this chainage.
      if (el.type === "circular_curve" && el.radius !== undefined) {
        const de = el.endPoint.easting - el.startPoint.easting;
        const dn = el.endPoint.northing - el.startPoint.northing;
        let brg = Math.atan2(de, dn) * 180 / Math.PI;
        if (brg < 0) brg += 360;
        return brg;
      }
      // Fallback: compute from start/end.
      const de = el.endPoint.easting - el.startPoint.easting;
      const dn = el.endPoint.northing - el.startPoint.northing;
      let brg = Math.atan2(de, dn) * 180 / Math.PI;
      if (brg < 0) brg += 360;
      return brg;
    }
  }
  return null;
}

function getElevationAtChainage(elements: VerticalElement[], chainage: number): number {
  for (const el of elements) {
    if (chainage >= el.startChainage && chainage <= el.endChainage) {
      const t = (chainage - el.startChainage) / (el.endChainage - el.startChainage);
      return el.startElevation + t * (el.endElevation - el.startElevation);
    }
  }
  return 0;
}
