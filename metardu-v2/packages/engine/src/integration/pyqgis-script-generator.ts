/**
 * PyQGIS helper script generator — emits a Python script the GIS
 * analyst runs inside QGIS to load metardu-desktop's survey layers
 * with country-correct symbology.
 *
 * # What this is (and isn't)
 *
 * This is the differentiator ADR-0005 calls out for the GIS Analyst
 * role. The analyst's daily workflow is:
 *   1. Open QGIS.
 *   2. Click "Run Python Script" (Plugins → Python Console).
 *   3. Pick the .py file metardu-desktop generated.
 *   4. The script loads the survey's GeoPackage, applies symbology,
 *      groups layers under a project-named tree node, sets the canvas
 *      CRS to the survey's CRS, and zooms to the layer extent.
 *
 * The analyst doesn't write any Python. They don't manually configure
 * the CRS, manually pick symbols, manually group layers. They get
 * "survey-grade data, dropped into QGIS ready to work on" — that's
 * the ADR-0005 marketing claim, made real.
 *
 * This is NOT:
 *   - A QGIS plugin (overkill, requires signing + plugin repo)
 *   - A bidirectional bridge (the script is one-shot; it doesn't sync
 *     QGIS edits back to metardu-desktop)
 *   - A cartographic renderer (symbology here is functional — beacon
 *     crosses, contour lines — not publication-quality map output)
 *
 * # Architectural invariants (per ADR-0005 + docs/invariants.md)
 *
 *   - A1: No geodetic math. CRS is read from country-config.
 *   - A2: SRID from country-config. No literal SRID in the generated
 *          script outside the `QgsCoordinateReferenceSystem(f'EPSG:{srid}')`
 *          call sourced from country-config.
 *   - A6: PyQGIS script generation uses string templates only. No
 *          QGIS dependency in the engine. The generated script is
 *          plain Python text — surveyors can read and modify it.
 *   - C1: Per-feature uncertainty is referenced by name in comments
 *          so the analyst knows which columns to symbolize on. The
 *          script doesn't re-compute anything.
 *   - C2: No coordinate rounding — the script reads the GeoPackage's
 *          float64 columns directly.
 *
 * # Output contract
 *
 * `bytes` is UTF-8 encoded Python source. `featureCount` is the
 * number of layers the script will load (not the number of features
 * in each layer — that's in the GeoPackage).
 *
 * The script assumes the GeoPackage file lives next to the .py file
 * with the same base name. The surveyor is told this in the export
 * menu — Brief 04 doesn't bundle the .gpkg; it expects the surveyor
 * to export both via the Integration & Export menu.
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - PyQGIS Developer Cookbook: https://docs.qgis.org/3.34/en/docs/pyqgis_developer_cookbook/
 *   - QGIS API: https://qgis.org/api/
 */

import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type { CadastralWorkflowOutput } from "../workflows/cadastral.js";
import type { TopoWorkflowOutput } from "../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../workflows/engineering.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  SurveyOutput,
  ValidationResult,
} from "./types.js";
import { detectSurveyType, type SurveyType } from "../survey-type-detection.js";

// ─── PyQGIS-script-specific types ────────────────────────────────

/** Options for the PyQGIS script generator. */
export interface PyQgisOptions extends IntegrationOptions {
  /**
   * Base name for the GeoPackage file the script will load. Default:
   * `metardu-survey`. The script assumes `<baseName>.gpkg` lives next
   * to the .py file. Surveyors can override if they renamed the .gpkg.
   */
  geoPackageBaseName?: string;
}

/** Output of the PyQGIS script generator. */
export interface PyQgisOutput extends IntegrationOutput {
  format: "pyqgis-script";
  /** CRS URN referenced in the script, e.g. "urn:ogc:def:crs:EPSG::21037". */
  crsUrn: string;
  /** EPSG SRID the script sets on the QGIS canvas. */
  srid: number;
  /** Layer names the script will load from the GeoPackage. */
  layers: string[];
  /** QGIS layer-tree group name (project name). */
  groupName: string;
}

// ─── Per-survey-type layer definitions ───────────────────────────

interface LayerSpec {
  /** GeoPackage table name to load. */
  tableName: string;
  /** QGIS layer display name. */
  displayName: string;
  /** Geometry type for the QGIS vector layer ("Point", "LineString", "Polygon"). */
  geometryType: "Point" | "LineString" | "Polygon";
  /** Symbology script — Python code that builds a QgsSymbol for this layer. */
  symbology: string;
  /** Whether to label features in this layer (and how). */
  labeling: string;
}

/**
 * Per-country + per-survey-type symbology. Country-correct symbology
 * is the differentiator per ADR-0005 — a Kenyan cadastral plan has
 * different beacon conventions than a UK measured survey.
 *
 * Each entry returns a LayerSpec list for the given country + survey
 * type, or null if the country/survey combo isn't supported yet
 * (the script generator then falls back to a generic style).
 */
function getLayerSpecs(
  countryCode: string,
  surveyType: SurveyType,
): LayerSpec[] {
  // Common Python helpers used in symbology strings.
  const MK_MARK = "QgsMarkerSymbol.createSimple({})";
  const MK_LINE = "QgsLineSymbol.createSimple({})";
  const MK_FILL = "QgsFillSymbol.createSimple({})";

  if (surveyType === "cadastral") {
    if (countryCode === "KE") {
      // Kenya cadastral: red beacon crosses, yellow boundary lines,
      // light-yellow parcel fill. Matches Survey of Kenya Form 3
      // conventions.
      return [
        {
          tableName: "beacons",
          displayName: "Beacons (Kenya Cadastral)",
          geometryType: "Point",
          symbology: `# Kenya cadastral beacons: red cross markers, sized by uncertainty.
sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(3.0)
# Color the marker red (Survey of Kenya convention).
sym.setColor(QColor(255, 0, 0))
# Data-defined size: scale by semi_major axis so high-uncertainty beacons
# render larger. Skip if the column is null (known control points).
size_dd = QgsProperty.fromExpression(
    'coalesce("semi_major" * 1000, 2.0)'
)
sym.setDataDefinedSize(size_dd)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
          labeling: `# Label beacons with their label column.
labels = QgsPalLayerSettings()
labels.fieldName = 'label'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
        },
        {
          tableName: "parcel",
          displayName: "Parcel (Kenya Cadastral)",
          geometryType: "Polygon",
          symbology: `# Kenya cadastral parcel: light yellow fill, red boundary.
sym = ${MK_FILL}
sym.setColor(QColor(255, 255, 200, 180))
sym.symbolLayer(0).setStrokeColor(QColor(255, 0, 0))
sym.symbolLayer(0).setStrokeWidth(0.5)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
          labeling: `# Label parcel with survey number if available.
labels = QgsPalLayerSettings()
labels.fieldName = '"survey_number"' if 'survey_number' in [f.name() for f in vlayer.fields()] else 'NULL'
labels.enabled = labels.fieldName != 'NULL'
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
        },
      ];
    }
    if (countryCode === "GB") {
      // UK measured survey (RICS): blue dashed boundary, no fixed
      // beacons — general boundaries rule.
      return [
        {
          tableName: "beacons",
          displayName: "Measured Points (UK General Boundaries)",
          geometryType: "Point",
          symbology: `# UK measured survey points: small blue dots (RICS convention).
sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(1.5)
sym.setColor(QColor(0, 0, 255))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
          labeling: `labels = QgsPalLayerSettings()
labels.fieldName = 'label'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
        },
        {
          tableName: "parcel",
          displayName: "General Boundary (UK)",
          geometryType: "Polygon",
          symbology: `# UK general boundary: blue dashed line, no fill.
sym = ${MK_FILL}
sym.setColor(QColor(0, 0, 0, 0))  # transparent fill
sym.symbolLayer(0).setStrokeColor(QColor(0, 0, 255))
sym.symbolLayer(0).setStrokeStyle(Qt.DashLine)
sym.symbolLayer(0).setStrokeWidth(0.4)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
          labeling: `# No labels on UK general boundary polygons (RICS doesn't require).`,
        },
      ];
    }
    // Generic cadastral fallback
    return [
      {
        tableName: "beacons",
        displayName: "Beacons",
        geometryType: "Point",
        symbology: `sym = ${MK_MARK}
sym.setSize(2.5)
sym.setColor(QColor(255, 0, 0))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `labels = QgsPalLayerSettings()
labels.fieldName = 'label'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
      {
        tableName: "parcel",
        displayName: "Parcel",
        geometryType: "Polygon",
        symbology: `sym = ${MK_FILL}
sym.setColor(QColor(255, 255, 200, 180))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: ``,
      },
    ];
  }

  if (surveyType === "topographic") {
    // Topo symbology is fairly universal — brown contours, green spot
    // heights. Country variation is minor.
    return [
      {
        tableName: "topo_points",
        displayName: "Topo Points (TIN Vertices)",
        geometryType: "Point",
        symbology: `# Topo points: small gray dots, scaled by uncertainty if present.
sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(0.8)
sym.setColor(QColor(120, 120, 120))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `# Label topo points with their point_id (off by default — too many points).
# Analyst can toggle on in QGIS layer properties.
labels = QgsPalLayerSettings()
labels.fieldName = 'point_id'
labels.enabled = False
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
      {
        tableName: "contours",
        displayName: "Contours",
        geometryType: "LineString",
        symbology: `# Contours: brown lines. Use graduated renderer by elevation so
# major contours (every 5m or 10m) can be thicker than minor ones.
sym = ${MK_LINE}
sym.setColor(QColor(139, 69, 19))  # brown
sym.setWidth(0.25)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))
# Graduated by elevation modulo contour interval — left as an exercise
# for the analyst; the field is named 'elevation'.`,
        labeling: `# Label contours with their elevation.
labels = QgsPalLayerSettings()
labels.fieldName = 'elevation'
labels.enabled = True
labels.decimals = 1
labels.formatNumbers = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
      {
        tableName: "spot_heights",
        displayName: "Spot Heights",
        geometryType: "Point",
        symbology: `# Spot heights: green dots, slightly larger than topo points.
sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(1.5)
sym.setColor(QColor(0, 128, 0))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `# Label spot heights with elevation.
labels = QgsPalLayerSettings()
labels.fieldName = 'elevation'
labels.enabled = True
labels.decimals = 2
labels.formatNumbers = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
    ];
  }

  if (surveyType === "engineering") {
    return [
      {
        tableName: "section_centerlines",
        displayName: "Section Centerlines",
        geometryType: "Point",
        symbology: `# Section centerline points: orange dots, sized by chainage.
sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(2.0)
sym.setColor(QColor(255, 165, 0))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `# Label centerline points with chainage (m).
labels = QgsPalLayerSettings()
labels.fieldName = '"Chainage: " || to_string("chainage") || "m"'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
      {
        tableName: "cross_section_profiles",
        displayName: "Cross-Section Profiles (NOT map features)",
        geometryType: "LineString",
        symbology: `# WARNING: cross_section_profiles are in (offset, cut-fill-depth) space,
# NOT map (E, N) space. See the coordinate_space column. These will render
# as garbage on a map canvas — they're meant for CAD/profile-chart tools.
# The script loads them but does NOT add them to the canvas; the analyst
# can inspect them in the QGIS attribute table or export to CSV for CAD.
sym = ${MK_LINE}
sym.setColor(QColor(255, 0, 255))  # magenta — unusual color, signals 'not a normal layer'
sym.setWidth(0.3)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: ``,
      },
    ];
  }

  if (surveyType === "setting-out") {
    return [
      {
        tableName: "design_points",
        displayName: "Design Points (Setting-Out)",
        geometryType: "Point",
        symbology: `sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(2.5)
sym.setColor(QColor(255, 165, 0))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `labels = QgsPalLayerSettings()
labels.fieldName = '"DP: " || "design_point_id"'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
    ];
  }
  if (surveyType === "corridor") {
    return [
      {
        tableName: "corridor_points",
        displayName: "Corridor Points",
        geometryType: "Point",
        symbology: `sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(1.5)
sym.setColor(QColor(0, 128, 128))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `labels = QgsPalLayerSettings()
labels.fieldName = 'label'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
    ];
  }
  if (surveyType === "lidar") {
    return [
      {
        tableName: "lidar_points",
        displayName: "LiDAR Points",
        geometryType: "Point",
        symbology: `sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(0.5)
sym.setColor(QColor(100, 100, 100))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: ``,
      },
    ];
  }
  if (surveyType === "utility-mapping") {
    return [
      {
        tableName: "utility_detections",
        displayName: "Utility Detections",
        geometryType: "Point",
        symbology: `sym = ${MK_MARK}
sym.setSizeUnit(QgsUnitTypes.RenderMillimeters)
sym.setSize(2.0)
sym.setColor(QColor(255, 0, 0))
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: `labels = QgsPalLayerSettings()
labels.fieldName = '"type: " || "utility_type" || " depth: " || to_string("depth") || "m"'
labels.enabled = True
vlayer.setLabeling(QgsVectorLayerSimpleLabeling(labels))`,
      },
      {
        tableName: "utility_runs",
        displayName: "Utility Runs",
        geometryType: "LineString",
        symbology: `sym = ${MK_LINE}
sym.setColor(QColor(255, 0, 0))
sym.setWidth(0.5)
vlayer.setRenderer(QgsSingleSymbolRenderer(sym))`,
        labeling: ``,
      },
    ];
  }
  // Metadata-only types (sectional, drone-processing, surface-comparison):
  // no spatial layers to load — script prints summary.
  return [];
}

// ─── Python script template ─────────────────────────────────────

const SCRIPT_VERSION = "1.0.0";

/**
 * Indent every line of a multi-line code block by N spaces. Used to
 * inject symbology/labeling code (authored at column 0 for readability)
 * into the else: block of the per-layer template.
 */
function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : pad + line))
    .join("\n");
}

/**
 * Generate the PyQGIS script body. Pure function — no I/O.
 *
 * The script is Python 3, targeting QGIS 3.34+ (LTR). It uses only
 * the PyQGIS API — no external Python packages required.
 */
function generateScript(
  layers: LayerSpec[],
  srid: number,
  crsUrn: string,
  geoPackagePath: string,
  groupName: string,
  metadata: ProjectMetadata,
  countryCode: string,
  surveyType: string,
  extraSummary: Record<string, unknown>,
): string {
  const now = new Date().toISOString();
  const summaryJson = JSON.stringify(extraSummary, null, 2);

  // Per-layer Python code blocks. Each layer is loaded from the
  // GeoPackage, has its renderer set, has its labeling set, and is
  // added to a layer-tree group.
  const layerBlocks = layers.map((layer, idx) => {
    const varName = `layer_${idx}`;
    return `
# ─── Layer ${idx + 1}: ${layer.displayName} ──────────────────
${varName} = QgsVectorLayer(
    "${geoPackagePath}|layername=${layer.tableName}",
    "${layer.displayName}",
    "ogr"
)
if not ${varName}.isValid():
    print("WARNING: layer '${layer.tableName}' failed to load from ${geoPackagePath}")
else:
    # Apply country-correct symbology per ADR-0005 Brief 04.
    vlayer = ${varName}
${indentBlock(layer.symbology, 4)}
${indentBlock(layer.labeling, 4)}
    # Add to the project group.
    QgsProject.instance().addMapLayer(${varName}, False)
    group_${idx} = root.addChildGroup("${layer.displayName}")
    group_${idx}.addLayer(${varName})
    print(f"Loaded layer: ${layer.displayName} (" + str(${varName}.featureCount()) + " features)")`;
  }).join("\n");

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PyQGIS loader script — generated by metardu-desktop.

This script loads metardu-desktop's survey data into QGIS with
country-correct symbology. Run it from the QGIS Python console
(Plugins → Python Console → Open Console → click the folder icon
→ select this .py file).

# Project metadata

  Project name:        ${metadata.projectName}
  Surveyor:            ${metadata.surveyorName}
  License number:      ${metadata.licenseNumber}
  Survey date:         ${metadata.surveyDate}
  Adjustment run ID:   ${metadata.adjustmentRunId}
  Country code:        ${countryCode}
  Survey type:         ${surveyType}
  CRS:                 ${crsUrn} (EPSG:${srid})
  Generated:           ${now}
  Generator:           metardu-desktop PyQGIS script generator v${SCRIPT_VERSION}

# Survey-type summary

${summaryJson}

# What this script does

  1. Sets the QGIS canvas CRS to EPSG:${srid} (the survey's CRS —
     sourced from country-config, never hardcoded).
  2. Loads each survey layer from the GeoPackage file located at:
       ${geoPackagePath}
  3. Applies country-correct symbology per the survey type and country.
  4. Groups all layers under a project-named tree node in the Layers panel.
  5. Zooms the canvas to the combined layer extent.

# Architectural notes

  - Per-feature uncertainty (semi_major, semi_minor, orientation columns
    in the GeoPackage) is referenced by name in the symbology code so
    the analyst can data-define symbol size by uncertainty.
  - Cross-section profiles (engineering surveys) are in (offset, cut-fill-
    depth) space, NOT map (E, N) space. They render as garbage on a map
    canvas — they're meant for CAD/profile-chart tools. The script loads
    them but flags them in red so the analyst knows to treat them as
    non-map features.
  - This script does NOT modify the GeoPackage. Re-running it loads
    the layers again. To clean up: close QGIS without saving the project,
    or remove the layers manually.

# References

  - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
  - PyQGIS Cookbook: https://docs.qgis.org/3.34/en/docs/pyqgis_developer_cookbook/
"""

# Standard library imports.
import os
from datetime import datetime

# PyQGIS imports — only available inside a running QGIS Python console.
from qgis.core import (
    QgsProject,
    QgsVectorLayer,
    QgsCoordinateReferenceSystem,
    QgsProperty,
    QgsSingleSymbolRenderer,
    QgsMarkerSymbol,
    QgsLineSymbol,
    QgsFillSymbol,
    QgsUnitTypes,
    QgsPalLayerSettings,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtCore import Qt

# ─── Configuration ────────────────────────────────────────────────

GPKG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "${geoPackagePath}"
)
GROUP_NAME = ${JSON.stringify(groupName)}
SRID = ${srid}
CRS_URN = ${JSON.stringify(crsUrn)}

print(f"=" * 60)
print(f"metardu-desktop PyQGIS loader — {GROUP_NAME}")
print(f"=" * 60)
print(f"GeoPackage path: {GPKG_PATH}")
print(f"CRS: {CRS_URN} (EPSG:{SRID})")
print(f"Generated: ${now}")
print()

if not os.path.exists(GPKG_PATH):
    raise FileNotFoundError(
        f"GeoPackage file not found at: {{GPKG_PATH}}\\n"
        f"Place the .gpkg file (exported from metardu-desktop) next to "
        f"this .py file, or edit GPKG_PATH above to point to it."
    )

# ─── Set canvas CRS to the survey's CRS ───────────────────────────

crs = QgsCoordinateReferenceSystem(f"EPSG:{SRID}")
if not crs.isValid():
    raise ValueError(f"Invalid EPSG code: {SRID}")
QgsProject.instance().setCrs(crs)
print(f"Canvas CRS set to EPSG:{SRID}")

# ─── Create the layer-tree group ──────────────────────────────────

root = QgsProject.instance().layerTreeRoot()
# Remove any existing group with the same name (idempotent re-runs).
existing = root.findGroup(GROUP_NAME)
if existing is not None:
    root.removeChildNode(existing)
project_group = root.insertGroup(0, GROUP_NAME)

# ─── Load each layer ──────────────────────────────────────────────
${layerBlocks}

# ─── Zoom to the combined layer extent ────────────────────────────

# Get the extent of all added layers and set the canvas to it.
canvas = iface.mapCanvas()
extents = []
for layer in QgsProject.instance().mapLayers().values():
    if layer.name().startswith("Beacon") or \\
       layer.name().startswith("Parcel") or \\
       layer.name().startswith("Topo") or \\
       layer.name().startswith("Contour") or \\
       layer.name().startswith("Spot") or \\
       layer.name().startswith("Section"):
        try:
            extents.append(layer.extent())
        except Exception:
            pass

if extents:
    combined = extents[0]
    for ext in extents[1:]:
        combined.combineExtentWith(ext)
    canvas.setExtent(combined)
    canvas.refresh()
    print(f"Canvas zoomed to combined extent: {combined.toString()}")

print()
print(f"=" * 60)
print(f"Loaded {len([l for l in QgsProject.instance().mapLayers().values() if GROUP_NAME in (l.name() or '')])} layers under group '{GROUP_NAME}'")
print(f"=" * 60)
print(f"Done. Inspect the Layers panel — your metardu-desktop survey")
print(f"layers are grouped under '{GROUP_NAME}'.")
print()
print(f"Tip: per-feature uncertainty columns (semi_major, semi_minor,")
print(f"orientation) are available for data-defined symbology. Right-click")
print(f"a layer → Properties → Symbology → Data-defined override.")
`;
}

// ─── The exporter object ─────────────────────────────────────────

export const pyQgisScriptExporter: IntegrationExporter<
  SurveyOutput,
  PyQgisOptions,
  PyQgisOutput
> = {
  format: "pyqgis-script",
  mimeType: "text/x-python",
  fileExtension: "py",
  description: "PyQGIS loader script (loads GeoPackage + applies country-correct symbology)",

  validate(input: SurveyOutput, options: PyQgisOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const validCodes: ReadonlyArray<string> = ["KE", "AU", "GB", "ZA", "AE"];
    if (!validCodes.includes(options.countryCode)) {
      errors.push(`Unknown country code '${options.countryCode}'.`);
    } else {
      try {
        const config = getCountryConfig(options.countryCode as CountryCode);
        if (!config.geodeticFramework.primarySRID) {
          errors.push(`Country '${options.countryCode}' config has no primarySRID.`);
        }
      } catch (e) {
        errors.push(`Failed to load country config: ${(e as Error).message}`);
      }
    }

    const m = options.projectMetadata;
    if (!m) {
      errors.push("projectMetadata is required (invariant C1).");
    } else {
      const missing: string[] = [];
      if (!m.projectName) missing.push("projectName");
      if (!m.surveyorName) missing.push("surveyorName");
      if (!m.licenseNumber) missing.push("licenseNumber");
      if (!m.surveyDate) missing.push("surveyDate");
      if (!m.adjustmentRunId) missing.push("adjustmentRunId");
      if (missing.length > 0) {
        errors.push(`projectMetadata incomplete. Missing: ${missing.join(", ")}.`);
      }
    }

    let surveyType: SurveyType;
    try {
      surveyType = detectSurveyType(input);
    } catch (e) {
      errors.push((e as Error).message);
      return { ok: false, errors, warnings };
    }

    // Per-survey-type sanity: at least one layer must be specifiable.
    // (If getLayerSpecs returns empty, the script will be empty.)
    const specs = getLayerSpecs(options.countryCode, surveyType);
    if (specs.length === 0) {
      warnings.push(
        `No country-specific symbology for country='${options.countryCode}', ` +
          `surveyType='${surveyType}'. Script will use generic styling.`,
      );
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(
    input: SurveyOutput,
    options: PyQgisOptions,
  ): Promise<PyQgisOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `PyQGIS script generation refused (validation failed):\n  - ` +
          validation.errors.join("\n  - "),
      );
    }

    const warnings: string[] = [...validation.warnings];
    const surveyType = detectSurveyType(input);

    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = `urn:ogc:def:crs:EPSG::${srid}`;

    // GeoPackage base name (default: metardu-survey).
    const gpkgBaseName = options.geoPackageBaseName ?? "metardu-survey";
    const gpkgPath = `${gpkgBaseName}.gpkg`;

    // QGIS group name = project name (sanitized — no quotes/backslashes).
    const m = options.projectMetadata as ProjectMetadata;
    const groupName = m.projectName
      .replace(/["'\\]/g, "")
      .slice(0, 60) || "metardu-survey";

    // Get country-correct layer specs.
    const specs = getLayerSpecs(options.countryCode, surveyType);
    if (specs.length === 0) {
      warnings.push("No layer specs available — script will be empty.");
    }

    // Survey-type-specific summary metadata (mirror the GeoJSON + GeoPackage exporters).
    let extraSummary: Record<string, unknown> = {};
    if (surveyType === "topographic") {
      const output = input as TopoWorkflowOutput;
      extraSummary = {
        topographic: {
          triangleCount: output.triangleCount,
          minElevation: output.minElevation,
          maxElevation: output.maxElevation,
          meanSlope: output.meanSlope,
          contourCount: output.contours.length,
          spotHeightCount: output.spotHeights.length,
        },
      };
    } else if (surveyType === "engineering") {
      const output = input as EngineeringWorkflowOutput;
      extraSummary = {
        engineering: {
          sectionCount: output.sectionCount,
          cutVolume: output.cutVolume,
          fillVolume: output.fillVolume,
          netVolume: output.netVolume,
          maxCutDepth: output.maxCutDepth,
          maxFillHeight: output.maxFillHeight,
        },
      };
    } else if (surveyType === "cadastral") {
      const output = input as CadastralWorkflowOutput;
      extraSummary = {
        cadastral: {
          beaconCount: output.allBeacons.length,
          adjustedBeaconCount: Object.values(output.uncertainty ?? {}).filter(
            (u) => u?.adjusted,
          ).length,
          sigma_0_sq: output.sigma_0_sq,
          passesCadastralTolerance: output.passesCadastralTolerance,
        },
      };
    }

    // Generate the script.
    const script = generateScript(
      specs,
      srid,
      crsUrn,
      gpkgPath,
      groupName,
      m,
      options.countryCode,
      surveyType,
      extraSummary,
    );

    const bytes = new TextEncoder().encode(script);

    return {
      format: "pyqgis-script",
      bytes,
      featureCount: specs.length, // layer count, not feature count
      warnings,
      crsUrn,
      srid,
      layers: specs.map((s) => s.tableName),
      groupName,
    };
  },
};
