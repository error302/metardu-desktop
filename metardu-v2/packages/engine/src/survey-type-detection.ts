/**
 * Survey type detection — shared discriminator used by all integration
 * exporters to route input to the correct feature builder.
 *
 * Extracted from the 5 exporters (geojson-export, geopackage-export,
 * pyqgis-script-generator, qgs-project-generator, dxf-export) where it
 * was previously duplicated. Extending it to handle new workflow types
 * is now a one-place change.
 *
 * Uses duck-typing via `in` checks — no imports from workflow modules
 * needed. Each workflow output has a unique characteristic field that
 * distinguishes it from the others.
 *
 * Per ADR-0005 + Brief 02 pattern: every workflow output that reaches
 * an integration exporter must be detectable here so the exporter can
 * route to the correct feature builder.
 */

/** All supported survey types. */
export type SurveyType =
  | "cadastral"
  | "topographic"
  | "engineering"
  | "sectional"
  | "setting-out"
  | "corridor"
  | "drone-processing"
  | "lidar"
  | "surface-comparison"
  | "utility-mapping";

/**
 * Discriminate which workflow produced the input by its shape.
 *
 * Uses characteristic fields unique to each workflow output type:
 *   - cadastral:           `form3` (the PDF render result)
 *   - engineering:         `sections` + `engineeringToleranceM`
 *   - topographic:         `tin` + `contours`
 *   - sectional:           `levels` + `totalBuildingArea`
 *   - setting-out:         `instructions` + `results` (stakeout + as-built)
 *   - corridor:            `crossSections` + `template`
 *   - drone-processing:    `quality` + `orthophotoPath`
 *   - lidar:               `dtm` + `dsm` + `counts`
 *   - surface-comparison:  `cutVolume` + `cutArea` + `fillArea`
 *   - utility-mapping:     `detections` + `runs` + `crossings`
 *
 * Order matters: more specific checks come first to avoid false matches.
 * (e.g. engineering, corridor, and surface-comparison all have
 * `cutVolume` — but only engineering has `sections`, only corridor has
 * `crossSections`, and only surface-comparison has `cutArea`.)
 */
export function detectSurveyType(input: unknown): SurveyType {
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;

    // Cadastral — most specific (unique `form3` field)
    if ("form3" in obj) return "cadastral";

    // Sectional — unique `levels` + `totalBuildingArea`
    if ("levels" in obj && "totalBuildingArea" in obj) return "sectional";

    // Setting-out — unique `instructions` + `results`
    if ("instructions" in obj && "results" in obj) return "setting-out";

    // Corridor — unique `crossSections` + `template`
    if ("crossSections" in obj && "template" in obj) return "corridor";

    // Drone-processing — unique `quality` + `orthophotoPath`
    if ("quality" in obj && "orthophotoPath" in obj) return "drone-processing";

    // LiDAR — unique `dtm` + `dsm` + `counts`
    if ("dtm" in obj && "dsm" in obj && "counts" in obj) return "lidar";

    // Utility-mapping — unique `detections` + `runs` + `crossings`
    if ("detections" in obj && "runs" in obj && "crossings" in obj) return "utility-mapping";

    // Surface-comparison — has `cutVolume` + `cutArea` (engineering has
    // cutVolume but NOT cutArea; corridor has cutVolume but NOT cutArea)
    if ("cutVolume" in obj && "cutArea" in obj) return "surface-comparison";

    // Engineering — `sections` + `engineeringToleranceM` (checked after
    // surface-comparison to avoid false match on cutVolume)
    if ("sections" in obj && "engineeringToleranceM" in obj) return "engineering";

    // Topographic — `tin` + `contours` (checked last because lidar also
    // has contours-like data, but lidar has `dtm`/`dsm` which is checked
    // earlier)
    if ("tin" in obj && "contours" in obj) return "topographic";
  }
  throw new Error(
    "Cannot detect survey type from input shape. The integration exporters " +
      "currently support: cadastral, topographic, engineering, sectional, " +
      "setting-out, corridor, drone-processing, lidar, surface-comparison, " +
      "utility-mapping. Other types will be added as their workflow modules " +
      "gain the same pointUncertainty field per the Brief 02 pattern.",
  );
}
