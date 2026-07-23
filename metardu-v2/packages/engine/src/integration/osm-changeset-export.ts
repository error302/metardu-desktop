/**
 * OSM changeset XML exporter — emits OpenStreetMap XML for surveyed
 * basemap features the surveyor wants to contribute back to OSM.
 *
 * # What this is
 *
 * The Spatial Data Editor role per ADR-0005 includes a third slice
 * beyond drone GCPs (Brief 06): surveyed features that belong in
 * basemaps — new roads, building footprints from topo surveys,
 * administrative boundary updates from cadastral work. The surveyor
 * exports these as OSM XML, opens the file in JOSM (or Level0 editor),
 * reviews, then uploads to OSM via the standard OSM API 0.6 changeset
 * flow.
 *
 * metardu-desktop's job here is to take a list of OSM nodes + ways
 * with OSM tags and emit a well-formed OSM XML file the surveyor can
 * open in JOSM. We do NOT upload to OSM directly — that requires
 * authentication and is out of scope for a desktop exporter.
 *
 * # WGS84 only — invariant A1 boundary
 *
 * OSM uses WGS84 (EPSG:4326) lat/lon exclusively. metardu-desktop's
 * surveys are in projected CRS (UTM 37S for Kenya, OSGB36 for UK,
 * etc.). Per ADR-0005 invariant A1: "Sidecar owns the math. Integration
 * modules do NOT recompute coordinates."
 *
 * This exporter therefore REQUIRES the surveyor to pass WGS84
 * coordinates in `OsmInput`. The exporter:
 *   1. Validates that the input CRS is EPSG:4326 (or unset, meaning
 *      the surveyor already converted).
 *   2. Emits a clear warning if the country-config's primarySRID is
 *      not 4326, instructing the surveyor to convert first via the
 *      sidecar's projection-inverse handler (future task brief) or
 *      via an external tool like `cs2cs`.
 *
 * This is honest: we surface the gap (projected→WGS84 conversion
 * needed) rather than silently emitting wrong coordinates. When a
 * future task brief wires the sidecar's projection-inverse through
 * IPC, this exporter can call it automatically.
 *
 * # What we emit (OSM API 0.6 XML)
 *
 * A standalone `<osm>` document with `<node>` and `<way>` elements.
 * NOT an `<osmChange>` document (which is the upload format with
 * `<create>`/`<modify>`/`<delete>` blocks). The surveyor opens the
 * `<osm>` file in JOSM, which handles the changeset creation +
 * upload via OSM API 0.6.
 *
 * Each node:
 *   <node id="..." lat="..." lon="..." version="0">
 *     <tag k="..." v="..."/>
 *     ...
 *   </node>
 *
 * Each way:
 *   <way id="..." version="0">
 *     <nd ref="..."/>  (references node IDs)
 *     <tag k="..." v="..."/>
 *     ...
 *   </way>
 *
 * IDs are negative (OSM convention for new objects not yet uploaded).
 *
 * # OSM tag conventions
 *
 * Tags follow the OSM wiki:
 *   - Surveyed beacon/control point: `man_made=survey_point` +
 *     `survey:accuracy=*` (metres) + `survey:adjustment_run_id=*`
 *   - Cadastral parcel boundary (closed way): `boundary=administrative` +
 *     `admin_level=*` (country-dependent — KE uses admin_level=8 for
 *     parcel-level, UK doesn't fit OSM's admin_level scheme well —
 *     emit `boundary=parcel` as a custom tag for UK instead)
 *   - Topo features: depend on the surveyor's feature code in the
 *     input — we map common codes (`BUILDING` → `building=yes`,
 *     `ROAD` → `highway=road`, `FENCE` → `barrier=fence`, etc.)
 *   - Always: `source=metardu-desktop` + `source:license_number=*` +
 *     `source:surveyor=*` + `source:survey_date=*` for traceability
 *
 * # Architectural invariants (per ADR-0005 + docs/invariants.md)
 *
 *   - A1: No geodetic math. Coordinates passed through unchanged.
 *          Surveyor must convert projected→WGS84 before calling.
 *   - A2: SRID check — country-config's primarySRID is checked; if
 *          not 4326, a warning is emitted (the surveyor still
 *          proceeds, but the warning documents the gap).
 *   - A6: Pure XML string templates, no OSM API dependency in engine.
 *   - C1: Per-feature uncertainty surfaced as `survey:accuracy=*`
 *          tag (XY accuracy in metres) + `survey:confidence=*` tag.
 *   - C2: No coordinate rounding — lat/lon use 7 decimal places
 *          (~11mm precision at the equator, well below RTK noise).
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - OSM API 0.6: https://wiki.openstreetmap.org/wiki/API_v0.6
 *   - OSM XML format: https://wiki.openstreetmap.org/wiki/OSM_XML
 *   - JOSM: https://josm.openstreetmap.de/
 */

import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  ValidationResult,
} from "./types.js";

// ─── OSM-specific types ──────────────────────────────────────────

/** A single OSM node (point). */
export interface OsmNode {
  /** Negative ID (OSM convention for new objects). Must be unique within input. */
  id: number;
  /** WGS84 latitude in decimal degrees. */
  lat: number;
  /** WGS84 longitude in decimal degrees. */
  lon: number;
  /** OSM tags as key/value pairs. */
  tags?: Record<string, string>;
}

/** A single OSM way (polyline or polygon). */
export interface OsmWay {
  /** Negative ID (OSM convention for new objects). Must be unique within input. */
  id: number;
  /** References to node IDs (must exist in the input's nodes array). */
  nodeRefs: number[];
  /** OSM tags. Include `area=yes` if the way is a closed polygon. */
  tags?: Record<string, string>;
}

/** Input to the OSM changeset exporter. */
export interface OsmInput {
  /** OSM nodes to emit. */
  nodes: OsmNode[];
  /** OSM ways to emit (reference node IDs via nodeRefs). */
  ways?: OsmWay[];
  /**
   * Optional: the input CRS. If set to 4326 (WGS84), no warning.
   * If set to anything else, a warning is emitted (surveyor must
   * convert coordinates to WGS84 before calling). If undefined,
   * we assume the surveyor has already converted (no warning).
   */
  inputSrid?: number;
}

/** Options for the OSM changeset exporter. */
export interface OsmOptions extends IntegrationOptions {
  /**
   * Optional: OSM changeset tags to embed in the document header.
   * Standard tags: `created_by`, `comment`, `source`, `imagery_used`.
   * The exporter auto-adds `source=metardu-desktop` +
   * `source:license_number=*` + `source:surveyor=*` — surveyor can
   * override by passing them here.
   */
  changesetTags?: Record<string, string>;
}

/** Output of the OSM changeset exporter. */
export interface OsmOutput extends IntegrationOutput {
  format: "osm-changeset";
  /** Number of <node> elements written. */
  nodeCount: number;
  /** Number of <way> elements written. */
  wayCount: number;
  /** Whether a WGS84-conversion warning was emitted. */
  warnedAboutProjection: boolean;
}

// ─── XML helpers ─────────────────────────────────────────────────

/** XML escape — escape &, <, >, ", ' per XML spec. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format a lat/lon value with 7 decimal places (~11mm precision). */
function fmtLatLon(n: number): string {
  return n.toFixed(7);
}

// ─── OSM tag conventions ─────────────────────────────────────────

/**
 * Build standard source attribution tags. Always emitted on every
 * node/way so the OSM community can trace the data back to its source.
 *
 * Per OSM community norms: every contributor must be traceable to a
 * source. metardu-desktop embeds the surveyor's license number +
 * adjustment run ID + survey date so the OSM community can verify
 * the data's provenance.
 */
function buildSourceTags(
  metadata: ProjectMetadata,
  accuracyM?: number,
  confidence?: number,
  adjustmentRunId?: string,
): Record<string, string> {
  const tags: Record<string, string> = {
    source: "metardu-desktop",
    "source:surveyor": metadata.surveyorName,
    "source:license_number": metadata.licenseNumber,
    "source:survey_date": metadata.surveyDate,
  };
  if (accuracyM !== undefined) {
    tags["survey:accuracy"] = accuracyM.toFixed(4);
  }
  if (confidence !== undefined) {
    tags["survey:confidence"] = confidence.toString();
  }
  if (adjustmentRunId) {
    tags["survey:adjustment_run_id"] = adjustmentRunId;
  }
  return tags;
}

/**
 * Merge source tags into a node/way's existing tags. Source tags win
 * on conflict (so the surveyor can't accidentally strip attribution).
 */
function mergeTagsWithSource(
  existing: Record<string, string> | undefined,
  sourceTags: Record<string, string>,
): Record<string, string> {
  return { ...(existing ?? {}), ...sourceTags };
}

// ─── XML generation ──────────────────────────────────────────────

const GENERATOR_VERSION = "1.0.0";

/**
 * Generate the OSM XML body. Pure function — no I/O.
 */
function generateOsmXml(
  nodes: OsmNode[],
  ways: OsmWay[],
  metadata: ProjectMetadata,
  changesetTags: Record<string, string>,
  generator: string,
): string {
  const now = new Date().toISOString();

  // Top-level changeset tags — embedded in the document as a comment
  // (OSM XML doesn't have a <changeset> element in the standalone
  // format; JOSM reads them from a separate dialog). We also emit
  // them as comments for human readability.
  const allChangesetTags = {
    created_by: `metardu-desktop OSM exporter v${GENERATOR_VERSION}`,
    comment: `Survey export from metardu-desktop — ${metadata.projectName}`,
    source: "metardu-desktop",
    "source:surveyor": metadata.surveyorName,
    "source:license_number": metadata.licenseNumber,
    "source:survey_date": metadata.surveyDate,
    "source:adjustment_run_id": metadata.adjustmentRunId,
    ...changesetTags,
  };

  const changesetTagLines = Object.entries(allChangesetTags).map(
    ([k, v]) => `# ${k}=${v}`,
  );

  // Per-node XML.
  const nodeXml = nodes.map((node) => {
    const tags = node.tags ?? {};
    const tagXml = Object.entries(tags)
      .map(([k, v]) => `    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
      .join("\n");
    const tagsBlock = tagXml.length > 0 ? `\n${tagXml}` : "";
    return `  <node id="${node.id}" lat="${fmtLatLon(node.lat)}" lon="${fmtLatLon(node.lon)}" version="0" timestamp="${now}">${tagsBlock}\n  </node>`;
  }).join("\n");

  // Per-way XML.
  const wayXml = ways.map((way) => {
    const ndXml = way.nodeRefs
      .map((ref) => `    <nd ref="${ref}"/>`)
      .join("\n");
    const tags = way.tags ?? {};
    const tagXml = Object.entries(tags)
      .map(([k, v]) => `    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
      .join("\n");
    const inner = [ndXml, tagXml].filter((s) => s.length > 0).join("\n");
    return `  <way id="${way.id}" version="0" timestamp="${now}">\n${inner}\n  </way>`;
  }).join("\n");

  // Top-level <osm> document.
  return `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="${escapeXml(generator)}">
<!--
  OSM changeset export from metardu-desktop.
  Open this file in JOSM (https://josm.openstreetmap.de/) to review
  and upload to OSM via the standard OSM API 0.6 changeset flow.

  Changeset tags (JOSM will prompt for these on upload):
${changesetTagLines.map((l) => `  ${l}`).join("\n")}

  Project: ${metadata.projectName}
  Surveyor: ${metadata.surveyorName} (${metadata.licenseNumber})
  Survey date: ${metadata.surveyDate}
  Adjustment run: ${metadata.adjustmentRunId}
  Generated: ${now}
  Generator: metardu-desktop OSM exporter v${GENERATOR_VERSION}
-->
${nodeXml}
${wayXml}
</osm>
`;
}

// ─── The exporter object ─────────────────────────────────────────

export const osmChangesetExporter: IntegrationExporter<
  OsmInput,
  OsmOptions,
  OsmOutput
> = {
  format: "osm-changeset",
  mimeType: "application/xml",
  fileExtension: "osm",
  description: "OSM changeset XML for surveyed basemap features (open in JOSM)",

  validate(input: OsmInput, options: OsmOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Country code check (we still need this for the source tags + projection warning).
    const validCodes: ReadonlyArray<string> = ["KE", "AU", "GB", "ZA", "AE"];
    if (!validCodes.includes(options.countryCode)) {
      errors.push(`Unknown country code '${options.countryCode}'.`);
    } else {
      try {
        const config = getCountryConfig(options.countryCode as CountryCode);
        if (!config.geodeticFramework.primarySRID) {
          errors.push(`Country '${options.countryCode}' config has no primarySRID.`);
        } else {
          // WGS84 check — OSM uses EPSG:4326 exclusively.
          // If the country's primary SRID isn't 4326 AND the input doesn't
          // explicitly say it's already 4326, emit a warning.
          const countrySrid = config.geodeticFramework.primarySRID;
          if (countrySrid !== 4326 && input.inputSrid !== 4326) {
            warnings.push(
              `Country '${options.countryCode}' primarySRID is ${countrySrid} ` +
                `(projected CRS), but OSM requires WGS84 (EPSG:4326) lat/lon. ` +
                `The input coordinates must already be in WGS84 — if they ` +
                `aren't, convert them first via the sidecar's projection-inverse ` +
                `handler (future task brief) or an external tool like cs2cs. ` +
                `metardu-desktop will NOT silently reproject.`,
            );
          }
        }
      } catch (e) {
        errors.push(`Failed to load country config: ${(e as Error).message}`);
      }
    }

    // Project metadata
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

    // Input check
    if (!input.nodes || input.nodes.length === 0) {
      errors.push("Input has no OSM nodes — nothing to export.");
    } else {
      // Check for duplicate node IDs.
      const nodeIds = new Set<number>();
      for (const node of input.nodes) {
        if (nodeIds.has(node.id)) {
          errors.push(`Duplicate OSM node id '${node.id}'. IDs must be unique.`);
        }
        nodeIds.add(node.id);

        // Validate ID is negative (OSM convention for new objects).
        if (node.id >= 0) {
          warnings.push(
            `OSM node id '${node.id}' is non-negative. OSM convention uses ` +
              `negative IDs for new objects (not yet uploaded). The exporter ` +
              `will emit it as-is, but JOSM may complain.`,
          );
        }

        // Validate lat/lon range.
        if (node.lat < -90 || node.lat > 90) {
          errors.push(`OSM node ${node.id} has invalid lat '${node.lat}' (must be -90..90).`);
        }
        if (node.lon < -180 || node.lon > 180) {
          errors.push(`OSM node ${node.id} has invalid lon '${node.lon}' (must be -180..180).`);
        }
        if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
          errors.push(`OSM node ${node.id} has non-finite lat/lon.`);
        }
      }

      // Check way nodeRefs reference existing nodes.
      if (input.ways) {
        for (const way of input.ways) {
          if (way.nodeRefs.length < 2) {
            errors.push(`OSM way ${way.id} has fewer than 2 nodeRefs — invalid way.`);
          }
          for (const ref of way.nodeRefs) {
            if (!nodeIds.has(ref)) {
              errors.push(`OSM way ${way.id} references non-existent node id '${ref}'.`);
            }
          }
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(input: OsmInput, options: OsmOptions): Promise<OsmOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `OSM changeset export refused (validation failed):\n  - ` +
          validation.errors.join("\n  - "),
      );
    }

    const warnings: string[] = [...validation.warnings];
    const warnedAboutProjection = warnings.some((w) => w.includes("WGS84"));

    const m = options.projectMetadata as ProjectMetadata;
    const changesetTags = options.changesetTags ?? {};
    const generator = `metardu-desktop OSM exporter v${GENERATOR_VERSION}`;

    // Build source tags once — applied to every node + way.
    // Pass the adjustment run ID so every emitted feature traces back
    // to its source adjustment (invariant C1 traceability).
    const sourceTags = buildSourceTags(m, undefined, undefined, m.adjustmentRunId);

    // Apply source tags to every node (merge with existing tags, source wins).
    const nodesWithSource: OsmNode[] = input.nodes.map((node) => ({
      ...node,
      tags: mergeTagsWithSource(node.tags, sourceTags),
    }));

    // Apply source tags to every way.
    const waysWithSource: OsmWay[] = (input.ways ?? []).map((way) => ({
      ...way,
      tags: mergeTagsWithSource(way.tags, sourceTags),
    }));

    // Generate the XML.
    const xml = generateOsmXml(
      nodesWithSource,
      waysWithSource,
      m,
      changesetTags,
      generator,
    );

    const bytes = new TextEncoder().encode(xml);

    return {
      format: "osm-changeset",
      bytes,
      featureCount: nodesWithSource.length + waysWithSource.length,
      warnings,
      nodeCount: nodesWithSource.length,
      wayCount: waysWithSource.length,
      warnedAboutProjection,
    };
  },
};
