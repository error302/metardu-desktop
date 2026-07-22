/**
 * QGIS project file (.qgs) generator — emits a self-contained QGIS 3.34
 * project file the GIS analyst opens directly in QGIS (no Python console
 * needed). Fifth concrete exporter in ADR-0005's Integration & Export
 * family.
 *
 * # What this is (and isn't)
 *
 * Brief 04 (PyQGIS script) and Brief 05 (.qgs file) solve the same
 * problem two different ways:
 *
 *   - **Brief 04 (.py script)**: analyst opens QGIS, runs the Python
 *     script from the Python console. The script loads the .gpkg,
 *     applies symbology, groups layers. Pro: easy to read + modify the
 *     Python. Con: requires opening the Python console.
 *
 *   - **Brief 05 (.qgs file)**: analyst double-clicks the .qgs file.
 *     QGIS opens with all layers loaded, styled, grouped, canvas CRS
 *     correct. Pro: zero-friction "just open it". Con: the .qgs XML is
 *     verbose and harder to read/modify than Python.
 *
 * Both are offered — surveyors pick based on workflow preference.
 *
 * # Two-artifact pattern (same as Brief 04)
 *
 * The .qgs file references a .gpkg file (path next to the .qgs file,
 * same base name). The .gpkg comes from Brief 03's GeoPackage exporter.
 * The surveyor exports both, drops them in the same folder, opens the
 * .qgs in QGIS.
 *
 * # Architectural invariants (per ADR-0005 + docs/invariants.md)
 *
 *   - A1: No geodetic math. CRS is read from country-config.
 *   - A2: SRID from country-config. The .qgs's <srs> elements all
 *          reference the EPSG code from country-config.
 *   - A6: Pure XML string templates, no QGIS dependency in the engine.
 *   - C1: Per-feature uncertainty is referenced by name in the
 *          renderer's data-defined size expression so analyst can
 *          scale symbol size by uncertainty. No re-computation.
 *   - C2: No coordinate rounding — QGIS reads the GeoPackage's
 *          float64 columns directly.
 *
 * # .qgs format notes
 *
 * The QGIS project file is XML. The format is documented at:
 *   https://docs.qgis.org/3.34/en/docs/pyqgis_developer_cookbook/
 *
 * Key elements we emit:
 *   - <qgis projectname="..." version="3.34.9-LTR">  root
 *   - <homePath path="."/>  relative path resolution
 *   - <title>...</title> + <abstract>...</abstract>  project metadata
 *   - <coordinateSystem>  project CRS
 *   - <layer-tree-group>  layer tree (grouped by project name)
 *   - <projectlayers>     layer definitions with embedded <renderer-v2>
 *                         and <labeling> elements
 *   - <relations/>        (empty — no inter-layer relations)
 *   - <mapcanvas>         canvas extent + CRS
 *
 * Each layer references the GeoPackage via:
 *   <datasource>./basename.gpkg|layername=table_name</datasource>
 *
 * # Output contract
 *
 * `bytes` is UTF-8 encoded XML. `featureCount` is the number of layers
 * (not features — those live in the .gpkg).
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - QGIS Project File Format: https://docs.qgis.org/3.34/en/docs/pyqgis_developer_cookbook/
 *   - QGIS XML renderer-v2 schema: qgis/sources/src/core/symbology/qgsrenderer.cpp
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

// ─── QGS-specific types ──────────────────────────────────────────

/** Options for the .qgs project generator. */
export interface QgsOptions extends IntegrationOptions {
  /**
   * Base name for the GeoPackage file the .qgs will load. Default:
   * `metardu-survey`. The .qgs assumes `<baseName>.gpkg` lives next to
   * the .qgs file. Surveyors can override if they renamed the .gpkg.
   */
  geoPackageBaseName?: string;
}

/** Output of the .qgs project generator. */
export interface QgsOutput extends IntegrationOutput {
  format: "qgs-project";
  /** CRS URN embedded in the project's <coordinateSystem>, e.g. "urn:ogc:def:crs:EPSG::21037". */
  crsUrn: string;
  /** EPSG SRID set on the QGIS project. */
  srid: number;
  /** Layer table names referenced in the .qgs. */
  layers: string[];
  /** QGIS project name (used as <qgis projectname="..."> + layer tree group). */
  projectName: string;
}

// ─── Survey type discriminator (shared logic) ────────────────────

function detectSurveyType(
  input: SurveyOutput,
): "cadastral" | "topographic" | "engineering" {
  if (typeof input === "object" && input !== null) {
    if ("form3" in input) return "cadastral";
    if ("sections" in input) return "engineering";
    if ("tin" in input && "contours" in input) return "topographic";
  }
  throw new Error(
    "Cannot detect survey type from input shape. The .qgs project generator " +
      "currently supports cadastral, topographic, and engineering outputs.",
  );
}

// ─── Per-layer XML spec ──────────────────────────────────────────

interface QgsLayerSpec {
  /** GeoPackage table name to load. */
  tableName: string;
  /** QGIS layer display name. */
  displayName: string;
  /** Geometry type for the QGIS vector layer. */
  geometryType: "Point" | "LineString" | "Polygon";
  /** QGIS XML <renderer-v2> element body (without the outer <renderer-v2> tag). */
  rendererXml: string;
  /** QGIS XML labeling element (empty string = no labeling). */
  labelingXml: string;
}

/**
 * XML escape — escape &, <, >, ", ' per XML spec.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Per-country + per-survey-type QGIS symbology (parallel to Brief 04's
 * getLayerSpecs but emitting QGIS XML renderer-v2 + labeling elements
 * instead of Python code).
 *
 * Each renderer is a <renderer-v2> element with a single <symbols>
 * containing one symbol. The symbol uses QGIS's XML symbol format
 * (symbol + layer + prop + color) — minimal but valid for QGIS 3.34.
 */
function getQgsLayerSpecs(
  countryCode: string,
  surveyType: "cadastral" | "topographic" | "engineering",
): QgsLayerSpec[] {
  // Common renderer building blocks. QGIS XML uses <renderer-v2> with
  // attributes for type ("singleSymbol" for one symbol per layer),
  // symbol levels, etc.

  // Helper: build a single-symbol renderer for a Point layer (marker symbol).
  function pointRenderer(colorRgb: string, sizeMm: number, dataDefinedSize = false): string {
    const ddSize = dataDefinedSize
      ? `<data_defined_properties><Option type="Map"><Option type="QString" name="name" value="semi_major"/><Option type="double" name="val" value="2"/><Option type="QString" name="units" value="Millimeters"/><Option type="QString" name="active" value="true"/></Option></data_defined_properties>`
      : "";
    return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0">
  <symbols>
    <symbol clip_to_extent="1" force_raster="0" alpha="1" type="marker" name="0">
      <layer pass="0" class="SimpleMarker" locked="0">
        <prop k="color" v="${colorRgb}"/>
        <prop k="size" v="${sizeMm}"/>
        <prop k="outline_style" v="solid"/>
        <prop k="outline_color" v="0,0,0,255"/>
        <prop k="outline_width" v="0.3"/>
        <prop k="name" v="cross"/>
        <prop k="size_unit" v="MM"/>
        ${ddSize}
      </layer>
    </symbol>
  </symbols>
  <rotation/>
  <sizescale/>
</renderer-v2>`;
  }

  // Helper: build a single-symbol renderer for a LineString layer (line symbol).
  function lineRenderer(colorRgb: string, widthMm: number, dashed = false): string {
    const style = dashed ? "dash" : "solid";
    return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0">
  <symbols>
    <symbol clip_to_extent="1" force_raster="0" alpha="1" type="line" name="0">
      <layer pass="0" class="SimpleLine" locked="0">
        <prop k="line_style" v="${style}"/>
        <prop k="line_color" v="${colorRgb}"/>
        <prop k="line_width" v="${widthMm}"/>
        <prop k="line_width_unit" v="MM"/>
      </layer>
    </symbol>
  </symbols>
  <rotation/>
  <sizescale/>
</renderer-v2>`;
  }

  // Helper: build a single-symbol renderer for a Polygon layer (fill symbol).
  function polygonRenderer(
    fillColorRgba: string,
    strokeColorRgb: string,
    strokeWidthMm: number,
    dashed = false,
  ): string {
    const style = dashed ? "dash" : "solid";
    return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0">
  <symbols>
    <symbol clip_to_extent="1" force_raster="0" alpha="1" type="fill" name="0">
      <layer pass="0" class="SimpleFill" locked="0">
        <prop k="color" v="${fillColorRgba}"/>
        <prop k="outline_color" v="${strokeColorRgb}"/>
        <prop k="outline_style" v="${style}"/>
        <prop k="outline_width" v="${strokeWidthMm}"/>
        <prop k="outline_width_unit" v="MM"/>
      </layer>
    </symbol>
  </symbols>
  <rotation/>
  <sizescale/>
</renderer-v2>`;
  }

  // Helper: build a labeling element that labels features by a field.
  function fieldLabeling(fieldName: string, fontSize = 8): string {
    return `<labeling type="simple">
  <settings calloutType="simple">
    <text-style fontSizeUnit="Point" fontSize="${fontSize}" fontFamily="Sans Serif" namedStyle="Normal" textColor="0,0,0,255"/>
    <text-format plussign="0" leftDelimiter="(" rightDelimiter=")" multilineAlign="0" formatNumbers="0" decimals="3"/>
    <placement placement="0" placementFlags="10" yOffset="0" xOffset="0" centroidWhole="0" predefinedPositionOrder="TR,TL,BR,BL"/>
    <rendering scaleMin="0" scaleMax="0" fontLimitPixelSize="0" maxNumLabels="2000" obstacle="1" obstacleFactor="1" mergeLines="0" displayAll="0" limitNumLabels="0" drawLabels="1" minScale="0" maxScale="0" scaleVisibility="0" zIndex="0" upsidedownLabels="0" labelPerPart="0" fontMaxPixelSize="10000" fontMinPixelSize="3"/>
    <dd_properties>
      <Option type="Map">
        <Option type="QString" name="fieldName" value="${escapeXml(fieldName)}"/>
      </Option>
    </dd_properties>
  </settings>
</labeling>`;
  }

  if (surveyType === "cadastral") {
    if (countryCode === "KE") {
      // Kenya cadastral: red beacon crosses (data-defined size by uncertainty),
      // yellow parcel fill, red boundary.
      return [
        {
          tableName: "beacons",
          displayName: "Beacons (Kenya Cadastral)",
          geometryType: "Point",
          rendererXml: pointRenderer("255,0,0,255", 3.0, true),
          labelingXml: fieldLabeling("label"),
        },
        {
          tableName: "parcel",
          displayName: "Parcel (Kenya Cadastral)",
          geometryType: "Polygon",
          rendererXml: polygonRenderer("255,255,200,180", "255,0,0,255", 0.5),
          labelingXml: "", // No parcel labels — survey number not always available on polygon
        },
      ];
    }
    if (countryCode === "GB") {
      // UK general-boundaries: blue dashed boundary, no fill, small blue dots.
      return [
        {
          tableName: "beacons",
          displayName: "Measured Points (UK General Boundaries)",
          geometryType: "Point",
          rendererXml: pointRenderer("0,0,255,255", 1.5),
          labelingXml: fieldLabeling("label"),
        },
        {
          tableName: "parcel",
          displayName: "General Boundary (UK)",
          geometryType: "Polygon",
          rendererXml: polygonRenderer("0,0,0,0", "0,0,255,255", 0.4, true),
          labelingXml: "",
        },
      ];
    }
    // Generic cadastral fallback
    return [
      {
        tableName: "beacons",
        displayName: "Beacons",
        geometryType: "Point",
        rendererXml: pointRenderer("255,0,0,255", 2.5),
        labelingXml: fieldLabeling("label"),
      },
      {
        tableName: "parcel",
        displayName: "Parcel",
        geometryType: "Polygon",
        rendererXml: polygonRenderer("255,255,200,180", "0,0,0,255", 0.3),
        labelingXml: "",
      },
    ];
  }

  if (surveyType === "topographic") {
    return [
      {
        tableName: "topo_points",
        displayName: "Topo Points (TIN Vertices)",
        geometryType: "Point",
        rendererXml: pointRenderer("120,120,120,255", 0.8),
        labelingXml: "", // Off by default — too many points
      },
      {
        tableName: "contours",
        displayName: "Contours",
        geometryType: "LineString",
        rendererXml: lineRenderer("139,69,19,255", 0.25),
        labelingXml: fieldLabeling("elevation"),
      },
      {
        tableName: "spot_heights",
        displayName: "Spot Heights",
        geometryType: "Point",
        rendererXml: pointRenderer("0,128,0,255", 1.5),
        labelingXml: fieldLabeling("elevation"),
      },
    ];
  }

  if (surveyType === "engineering") {
    return [
      {
        tableName: "section_centerlines",
        displayName: "Section Centerlines",
        geometryType: "Point",
        rendererXml: pointRenderer("255,165,0,255", 2.0),
        labelingXml: fieldLabeling("chainage"),
      },
      {
        tableName: "cross_section_profiles",
        displayName: "Cross-Section Profiles (NOT map features)",
        geometryType: "LineString",
        // Magenta — unusual color signals 'not a normal layer'
        rendererXml: lineRenderer("255,0,255,255", 0.3),
        labelingXml: "",
      },
    ];
  }

  return [];
}

// ─── XML generation helpers ──────────────────────────────────────

const QGIS_VERSION = "3.34.9-LTR";
const GENERATOR_VERSION = "1.0.0";

/**
 * Generate the QGIS project XML body. Pure function — no I/O.
 */
function generateQgsXml(
  layers: QgsLayerSpec[],
  srid: number,
  crsUrn: string,
  geoPackagePath: string,
  projectName: string,
  metadata: ProjectMetadata,
  countryCode: string,
  surveyType: string,
  extraSummary: Record<string, unknown>,
): string {
  const now = new Date().toISOString();
  const summaryJson = escapeXml(JSON.stringify(extraSummary, null, 2));
  const escapedProjectName = escapeXml(projectName);
  const escapedSurveyor = escapeXml(metadata.surveyorName);
  const escapedAdjustmentId = escapeXml(metadata.adjustmentRunId);
  const titleText = escapedProjectName;
  const abstractText = [
    `metardu-desktop survey project`,
    `Surveyor: ${metadata.surveyorName} (${metadata.licenseNumber})`,
    `Survey date: ${metadata.surveyDate}`,
    `Adjustment run: ${metadata.adjustmentRunId}`,
    `Country: ${countryCode} | Survey type: ${surveyType}`,
    `CRS: ${crsUrn} (EPSG:${srid})`,
    `Generated: ${now}`,
    `Generator: metardu-desktop QGS generator v${GENERATOR_VERSION}`,
    ``,
    `Survey-type summary:`,
    summaryJson,
  ].join("\n");

  // Per-layer <maplayer> XML blocks.
  const layerXmlBlocks = layers.map((layer, idx) => {
    const layerId = `metardu_${surveyType}_${layer.tableName}_${idx}_${Date.now().toString(36)}`;
    const datasource = `./${escapeXml(geoPackagePath)}|layername=${escapeXml(layer.tableName)}`;
    const geometryTypeQgis =
      layer.geometryType === "Point" ? "Point" :
      layer.geometryType === "LineString" ? "LineString" : "Polygon";
    return `    <maplayer simplifyMaxScale="1" autoRefreshEnabled="0" simplifyAlgorithm="0" minScale="0" simplifyDrawingHints="1" styleCategories="AllStyleFlags" maxScale="0" refreshOnNotifyEnabled="0" autoRefreshTime="0" simplifyLocal="1" simplifyDrawingTol="1" hasScaleBasedVisibilityFlag="0" readOnly="0" type="vector" labelsEnabled="${layer.labelingXml ? "1" : "0"}" refreshOnNotifyMessage="" wkbType="${wkbType(layer.geometryType)}">
      <id>${layerId}</id>
      <datasource>${datasource}</datasource>
      <title>${escapeXml(layer.displayName)}</title>
      <abstract></abstract>
      <keywordList>
        <value>metardu</value>
        <value>${escapeXml(surveyType)}</value>
        <value>${escapeXml(countryCode)}</value>
      </keywordList>
      <layername>${escapeXml(layer.displayName)}</layername>
      <srs>
        <spatialrefsys nativeFormat="Wkt">
          <wkt>${escapeXml(crsUrn)}</wkt>
          <proj4></proj4>
          <srsid>${srid}</srsid>
          <srid>${srid}</srid>
          <authid>EPSG:${srid}</authid>
          <description>${escapeXml(crsUrn)}</description>
          <projectionacronym></projectionacronym>
          <ellipsoidacronym></ellipsoidacronym>
          <geographicflag>false</geographicflag>
        </spatialrefsys>
      </srs>
      <resourceMetadata>
        <identifier>${escapeXml(layer.tableName)}</identifier>
        <parentidentifier></parentidentifier>
        <language></language>
        <type>dataset</type>
        <title>${escapeXml(layer.displayName)}</title>
        <abstract>Generated by metardu-desktop</abstract>
      </resourceMetadata>
      <provider>ogr</provider>
      <vectorjoins/>
      <layerDependencies/>
      <dataDependencies/>
      <legend type="default-vector"/>
      ${layer.rendererXml}
      ${layer.labelingXml}
      <blendMode>0</blendMode>
      <featureBlendMode>0</featureBlendMode>
      <layerTransparency>0</layerTransparency>
      <SingleCategoryDiagramRenderer attributeLegend="1" diagramType="Pie">
        <DiagramCategory sizeScale="3X:0,0,0,0,0,0" penWidth="0" minimumSize="0" penColor="#000000" minScaleDenominator="0" lineSizeScale="3X:0,0,0,0,0,0" penAlpha="255" rotationOffset="270" sizeType="MM" height="15" width="15" scaleDependency="Area" labelPlacementMethod="XHeight" lineSizeType="MM" backgroundColor="#ffffff" backgroundAlpha="255" maxScaleDenominator="1e+08" diagramOrientation="Up" barWidth="5" opacity="1" scaleBasedVisibility="0" enabled="0">
          <fontProperties style="" description="Sans Serif,9,-1,5,50,0,0,0,0,0"/>
        </DiagramCategory>
      </SingleCategoryDiagramRenderer>
      <geometryOptions removeDuplicateNodes="1" geometryPrecision="0"/>
      <layerGeometryType>${geometryTypeQgis === "Point" ? "0" : geometryTypeQgis === "LineString" ? "1" : "2"}</layerGeometryType>
    </maplayer>`;
  }).join("\n");

  // Layer-tree-group: all metardu layers under a project-named group.
  const layerTreeGroup = `  <layer-tree-group>
    <customproperties/>
    <layer-tree-layer name="${layers[0] ? escapeXml(layers[0]!.displayName) : ""}" id="${layers[0] ? `metardu_${surveyType}_${layers[0]!.tableName}_0` : ""}" source="${layers[0] ? `./${escapeXml(geoPackagePath)}|layername=${escapeXml(layers[0]!.tableName)}` : ""}" providerKey="ogr" checked="QtChecked" expanded="1" patch_size="-1"/>
${layers.slice(1).map((layer, idx) => {
  const layerId = `metardu_${surveyType}_${layer.tableName}_${idx + 1}`;
  return `    <layer-tree-layer name="${escapeXml(layer.displayName)}" id="${layerId}" source="./${escapeXml(geoPackagePath)}|layername=${escapeXml(layer.tableName)}" providerKey="ogr" checked="QtChecked" expanded="1" patch_size="-1"/>`;
}).join("\n")}
  </layer-tree-group>`;

  // Project-level <projectlayers> wrapping all <maplayer> blocks.
  const projectLayers = `  <projectlayers>
${layerXmlBlocks}
  </projectlayers>`;

  // Project metadata (QGIS 3.34 stores this in <projectMetadata>).
  const projectMetadata = `  <projectMetadata>
    <identifier>${escapedAdjustmentId}</identifier>
    <parentidentifier></parentidentifier>
    <language>en</language>
    <type>dataset</type>
    <title>${titleText}</title>
    <abstract>${abstractText}</abstract>
    <keywords>
      <keyword>metardu</keyword>
      <keyword>${escapeXml(surveyType)}</keyword>
      <keyword>${escapeXml(countryCode)}</keyword>
    </keywords>
    <contacts>
      <contact>
        <name>${escapedSurveyor}</name>
        <organization>metardu-desktop</organization>
        <position>Surveyor</position>
        <voice></voice>
        <fax></fax>
        <email></email>
        <role></role>
      </contact>
    </contacts>
    <links/>
    <history>Generated by metardu-desktop QGS generator v${GENERATOR_VERSION} on ${now}</history>
    <creationDate>${now}</creationDate>
  </projectMetadata>`;

  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="${escapedProjectName}" version="${QGIS_VERSION}">
  <homePath path="."/>
  <title>${titleText}</title>
  <abstract>${abstractText}</abstract>
  <keywordList>
    <value>metardu</value>
    <value>${escapeXml(surveyType)}</value>
    <value>${escapeXml(countryCode)}</value>
  </keywordList>
  <projectCrs>
    <spatialrefsys nativeFormat="Wkt">
      <wkt>${escapeXml(crsUrn)}</wkt>
      <proj4></proj4>
      <srsid>${srid}</srsid>
      <srid>${srid}</srid>
      <authid>EPSG:${srid}</authid>
      <description>${escapeXml(crsUrn)}</description>
      <projectionacronym></projectionacronym>
      <ellipsoidacronym></ellipsoidacronym>
      <geographicflag>false</geographicflag>
    </spatialrefsys>
  </projectCrs>
  ${projectMetadata}
  ${layerTreeGroup}
  ${projectLayers}
  <mapcanvas annotationsVisible="1" name="theMapCanvas">
    <units>degrees</units>
    <extent>
      <xmin>0</xmin>
      <ymin>0</ymin>
      <xmax>0</xmax>
      <ymax>0</ymax>
    </extent>
    <rotation>0</rotation>
    <destinationsrs>
      <spatialrefsys nativeFormat="Wkt">
        <wkt>${escapeXml(crsUrn)}</wkt>
        <proj4></proj4>
        <srsid>${srid}</srsid>
        <srid>${srid}</srid>
        <authid>EPSG:${srid}</authid>
        <description>${escapeXml(crsUrn)}</description>
        <projectionacronym></projectionacronym>
        <ellipsoidacronym></ellipsoidacronym>
        <geographicflag>false</geographicflag>
      </spatialrefsys>
    </destinationsrs>
    <rendermaptile>0</rendermaptile>
  </mapcanvas>
  <projectlayers/>
  <relations/>
  <policy layerMode="Transparent"/>
  <measurement units="meters">
    <ellipsoid>WGS84</ellipsoid>
  </measurement>
  <layersums/>
</qgis>
`;
}

/**
 * Map metardu geometry type to QGIS WKB type code.
 * Point=1, LineString=2, Polygon=3 (per OGC 06-103r4 WKB spec).
 */
function wkbType(geometryType: "Point" | "LineString" | "Polygon"): number {
  switch (geometryType) {
    case "Point": return 1;
    case "LineString": return 2;
    case "Polygon": return 3;
  }
}

// ─── The exporter object ─────────────────────────────────────────

export const qgsProjectExporter: IntegrationExporter<
  SurveyOutput,
  QgsOptions,
  QgsOutput
> = {
  format: "qgs-project",
  mimeType: "application/x-qgis-project",
  fileExtension: "qgs",
  description: "QGIS project file (.qgs) — open directly in QGIS 3.34+",

  validate(input: SurveyOutput, options: QgsOptions): ValidationResult {
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

    let surveyType: "cadastral" | "topographic" | "engineering";
    try {
      surveyType = detectSurveyType(input);
    } catch (e) {
      errors.push((e as Error).message);
      return { ok: false, errors, warnings };
    }

    const specs = getQgsLayerSpecs(options.countryCode, surveyType);
    if (specs.length === 0) {
      warnings.push(
        `No layer specs for country='${options.countryCode}', surveyType='${surveyType}'. ` +
          `Project file will be empty.`,
      );
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(
    input: SurveyOutput,
    options: QgsOptions,
  ): Promise<QgsOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `QGIS project generation refused (validation failed):\n  - ` +
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

    // Project name = sanitized project name.
    const m = options.projectMetadata as ProjectMetadata;
    const projectName = m.projectName.replace(/["'<>&]/g, "").slice(0, 60) || "metardu-survey";

    // Get country-correct layer specs.
    const specs = getQgsLayerSpecs(options.countryCode, surveyType);
    if (specs.length === 0) {
      warnings.push("No layer specs available — project file will be empty.");
    }

    // Survey-type-specific summary metadata (mirror the other exporters).
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

    // Generate the XML.
    const xml = generateQgsXml(
      specs,
      srid,
      crsUrn,
      gpkgPath,
      projectName,
      m,
      options.countryCode,
      surveyType,
      extraSummary,
    );

    const bytes = new TextEncoder().encode(xml);

    return {
      format: "qgs-project",
      bytes,
      featureCount: specs.length, // layer count, not feature count
      warnings,
      crsUrn,
      srid,
      layers: specs.map((s) => s.tableName),
      projectName,
    };
  },
};
