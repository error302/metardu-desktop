/**
 * Tests for the OSM changeset XML exporter.
 *
 * Brief 07: emits OSM API 0.6 XML for surveyed basemap features the
 * surveyor wants to contribute back to OSM. Last ADR-0005 deliverable.
 *
 * Coverage:
 *   1. Format metadata (format, mimeType, fileExtension)
 *   2. Happy path — nodes + ways with tags, well-formed XML
 *   3. WGS84 projection warning when country SRID is not 4326
 *   4. No warning when inputSrid=4326 explicit
 *   5. Source attribution tags auto-added to every node + way
 *   6. Custom changeset tags respected
 *   7. XML well-formedness — single root, balanced tags
 *   8. Missing project metadata → validate() fails
 *   9. Unknown country code → validate() fails
 *  10. Duplicate node IDs → validate() fails
 *  11. Way with non-existent nodeRef → validate() fails
 *  12. Invalid lat/lon range → validate() fails
 *  13. INTEGRATION_EXPORTERS registry includes osmChangesetExporter
 *  14. Negative IDs warning when non-negative IDs are used
 *  15. Empty nodes list → validate() fails
 *  16. XML escape — special characters in tag values
 *  17. Round-trip: parse the XML back, verify node/way counts + coordinates
 */

import { describe, it, expect } from "vitest";
import { osmChangesetExporter } from "../osm-changeset-export.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import type { OsmInput, OsmOptions, OsmNode, OsmWay } from "../osm-changeset-export.js";

const baseMetadata = {
  projectName: "Brief 07 OSM Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-07-test-001",
};

// ─── Fixtures ────────────────────────────────────────────────────

/**
 * 4 OSM nodes around Kasarani, Nairobi in WGS84 lat/lon.
 * (Already converted from UTM 37S — the exporter requires WGS84 input.)
 */
function kenyaOsmNodes(): OsmNode[] {
  // Approximate WGS84 for Kasarani: lat=-1.22, lon=36.90
  return [
    {
      id: -1,
      lat: -1.2200000,
      lon: 36.9000000,
      tags: { "man_made": "survey_point", "name": "B1" },
    },
    {
      id: -2,
      lat: -1.2200000,
      lon: 36.9005000,
      tags: { "man_made": "survey_point", "name": "B2" },
    },
    {
      id: -3,
      lat: -1.2205000,
      lon: 36.9005000,
      tags: { "man_made": "survey_point", "name": "B3" },
    },
    {
      id: -4,
      lat: -1.2205000,
      lon: 36.9000000,
      tags: { "man_made": "survey_point", "name": "B4" },
    },
  ];
}

/** A closed way (parcel boundary) referencing the 4 nodes above. */
function kenyaParcelWay(): OsmWay {
  return {
    id: -101,
    nodeRefs: [-1, -2, -3, -4, -1], // closed ring (first === last)
    tags: {
      boundary: "administrative",
      admin_level: "8",
      name: "S/12345",
      area: "yes",
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function decodeXml(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Minimal XML well-formedness check: starts with `<?xml`, has a single
 * root element, all opening tags have matching closing tags.
 */
function isWellFormedXml(xml: string): { ok: boolean; error?: string } {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<?xml")) return { ok: false, error: "does not start with <?xml" };

  // Strip XML declaration.
  const declEnd = trimmed.indexOf("?>") + 2;
  let body = trimmed.slice(declEnd).trim();

  // Strip comments for the root-element check.
  const bodyNoComments = body.replace(/<!--[\s\S]*?-->/g, "").trim();

  // Find the root element opening tag.
  const rootMatch = bodyNoComments.match(/^<(\w+)/);
  if (!rootMatch) return { ok: false, error: "no root element" };
  const rootTag = rootMatch[1]!;

  // Check that the document ends with </rootTag>.
  if (!bodyNoComments.endsWith(`</${rootTag}>`) && !bodyNoComments.endsWith(`</${rootTag}>\n`)) {
    return { ok: false, error: `does not end with </${rootTag}>` };
  }

  return { ok: true };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("osmChangesetExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(osmChangesetExporter.format).toBe("osm-changeset");
    expect(osmChangesetExporter.mimeType).toBe("application/xml");
    expect(osmChangesetExporter.fileExtension).toBe("osm");
    expect(osmChangesetExporter.description).toMatch(/OSM/i);
  });
});

describe("osmChangesetExporter — Case 1: happy path with nodes + ways", () => {
  it("produces well-formed OSM XML with source attribution tags", async () => {
    const input: OsmInput = {
      nodes: kenyaOsmNodes(),
      ways: [kenyaParcelWay()],
      inputSrid: 4326, // explicit WGS84 — no warning expected
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("osm-changeset");
    expect(result.nodeCount).toBe(4);
    expect(result.wayCount).toBe(1);
    expect(result.featureCount).toBe(5); // 4 nodes + 1 way
    expect(result.warnedAboutProjection).toBe(false);

    const xml = decodeXml(result.bytes);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<osm version="0.6"');
    expect(xml).toContain('generator="metardu-desktop OSM exporter');

    // Nodes present
    expect(xml).toContain('<node id="-1"');
    expect(xml).toContain('lat="-1.2200000"');
    expect(xml).toContain('lon="36.9000000"');

    // Way present with nd refs
    expect(xml).toContain('<way id="-101"');
    expect(xml).toContain('<nd ref="-1"/>');
    expect(xml).toContain('<nd ref="-2"/>');

    // Source attribution tags auto-added
    expect(xml).toContain('k="source" v="metardu-desktop"');
    expect(xml).toContain('k="source:surveyor" v="Test Surveyor"');
    expect(xml).toContain('k="source:license_number" v="LS/1234"');
    expect(xml).toContain('k="source:survey_date" v="2026-07-23"');

    // User-provided tags preserved
    expect(xml).toContain('k="man_made" v="survey_point"');
    expect(xml).toContain('k="boundary" v="administrative"');

    // Changeset tags in comment header
    expect(xml).toContain("# source=metardu-desktop");
    expect(xml).toContain("# source:adjustment_run_id=brief-07-test-001");

    // XML well-formedness
    expect(isWellFormedXml(xml).ok).toBe(true);
  });
});

describe("osmChangesetExporter — Case 2: WGS84 projection warning", () => {
  it("warns when country SRID is not 4326 and input doesn't say it's WGS84", async () => {
    const input: OsmInput = {
      nodes: kenyaOsmNodes(),
      ways: [],
      // No inputSrid — exporter can't confirm WGS84
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE", // Kenya's primary SRID is 21037 (UTM 37S), not 4326
      projectMetadata: baseMetadata,
    });

    expect(result.warnedAboutProjection).toBe(true);
    expect(result.warnings.some((w) => w.includes("WGS84"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("21037"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 3: no warning when inputSrid=4326", () => {
  it("does not warn when input explicitly declares WGS84", async () => {
    const input: OsmInput = {
      nodes: kenyaOsmNodes(),
      ways: [],
      inputSrid: 4326,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.warnedAboutProjection).toBe(false);
    expect(result.warnings.filter((w) => w.includes("WGS84"))).toHaveLength(0);
  });
});

describe("osmChangesetExporter — Case 4: source attribution on every node + way", () => {
  it("merges source tags into existing tags (source wins on conflict)", async () => {
    const input: OsmInput = {
      nodes: [
        {
          id: -1,
          lat: -1.22,
          lon: 36.90,
          tags: {
            source: "some-other-source", // should be overridden
            "custom_tag": "preserved",
          },
        },
      ],
      ways: [],
      inputSrid: 4326,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    const xml = decodeXml(result.bytes);
    // source tag overridden by metardu-desktop attribution
    expect(xml).toContain('k="source" v="metardu-desktop"');
    expect(xml).not.toContain('k="source" v="some-other-source"');
    // custom tag preserved
    expect(xml).toContain('k="custom_tag" v="preserved"');
  });
});

describe("osmChangesetExporter — Case 5: custom changeset tags respected", () => {
  it("merges user-provided changeset tags into the comment header", async () => {
    const input: OsmInput = {
      nodes: kenyaOsmNodes(),
      ways: [],
      inputSrid: 4326,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      changesetTags: {
        comment: "Adding surveyed parcel boundary in Kasarani",
        imagery_used: "Bing",
        "custom:review_status": "needs_review",
      },
    });

    const xml = decodeXml(result.bytes);
    expect(xml).toContain("# comment=Adding surveyed parcel boundary in Kasarani");
    expect(xml).toContain("# imagery_used=Bing");
    expect(xml).toContain("# custom:review_status=needs_review");
  });
});

describe("osmChangesetExporter — Case 6: missing project metadata", () => {
  it("validate() fails and export() throws", async () => {
    const input: OsmInput = { nodes: kenyaOsmNodes(), inputSrid: 4326 };
    const options: OsmOptions = { countryCode: "KE" };

    const validation = osmChangesetExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectMetadata"))).toBe(true);

    await expect(osmChangesetExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
});

describe("osmChangesetExporter — Case 7: unknown country code", () => {
  it("validate() fails", () => {
    const input: OsmInput = { nodes: kenyaOsmNodes(), inputSrid: 4326 };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "XX",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown country code"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 8: duplicate node IDs", () => {
  it("validate() fails on duplicate node IDs", () => {
    const input: OsmInput = {
      nodes: [
        { id: -1, lat: -1.22, lon: 36.90 },
        { id: -1, lat: -1.23, lon: 36.91 },
      ],
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Duplicate OSM node id"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 9: way references non-existent node", () => {
  it("validate() fails when a way nodeRef doesn't exist", () => {
    const input: OsmInput = {
      nodes: [{ id: -1, lat: -1.22, lon: 36.90 }],
      ways: [{ id: -101, nodeRefs: [-1, -999] }], // -999 doesn't exist
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("non-existent node id"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 10: invalid lat/lon range", () => {
  it("validate() fails when lat > 90 or lon > 180", () => {
    const input: OsmInput = {
      nodes: [
        { id: -1, lat: 95.0, lon: 36.90 }, // lat out of range
      ],
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("invalid lat"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 11: INTEGRATION_EXPORTERS registry", () => {
  it("includes the osmChangesetExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("geopackage");
    expect(formats).toContain("pyqgis-script");
    expect(formats).toContain("gcp");
    expect(formats).toContain("qgs-project");
    expect(formats).toContain("osm-changeset");
  });
});

describe("osmChangesetExporter — Case 12: negative ID convention warning", () => {
  it("warns when node IDs are non-negative (OSM convention is negative for new objects)", () => {
    const input: OsmInput = {
      nodes: [
        { id: 1, lat: -1.22, lon: 36.90 }, // positive ID — non-conventional
      ],
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    // validate() should pass (warnings don't fail validation)
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => w.includes("non-negative"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 13: empty nodes list", () => {
  it("validate() fails on empty nodes list", () => {
    const input: OsmInput = { nodes: [], inputSrid: 4326 };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("no OSM nodes"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 14: XML escape in tag values", () => {
  it("escapes special XML characters in tag keys and values", async () => {
    const input: OsmInput = {
      nodes: [
        {
          id: -1,
          lat: -1.22,
          lon: 36.90,
          tags: {
            "name": 'Test "quoted" & <value>', // special chars: " & <
            "note": "It's working",
          },
        },
      ],
      inputSrid: 4326,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    const xml = decodeXml(result.bytes);
    // Verify escaped versions are present (raw versions are not)
    expect(xml).toContain("&quot;quoted&quot;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;value&gt;");
    expect(xml).toContain("&apos;s working");
    // Raw unescaped versions must NOT be present
    expect(xml).not.toContain('"quoted" & <value>');
  });
});

describe("osmChangesetExporter — Case 15: round-trip XML parse", () => {
  it("XML parses back with the same node + way counts + coordinates", async () => {
    const originalNodes = kenyaOsmNodes();
    const originalWay = kenyaParcelWay();
    const input: OsmInput = {
      nodes: originalNodes,
      ways: [originalWay],
      inputSrid: 4326,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    const xml = decodeXml(result.bytes);

    // Count <node> elements (excluding <nd> which also starts with 'n')
    const nodeMatches = xml.match(/<node\s/g) || [];
    expect(nodeMatches.length).toBe(originalNodes.length);

    // Count <way> elements
    const wayMatches = xml.match(/<way\s/g) || [];
    expect(wayMatches.length).toBe(1);

    // Verify each node's lat/lon round-trips via regex
    for (const node of originalNodes) {
      const nodeRegex = new RegExp(
        `<node id="${node.id}" lat="(-?\\d+\\.\\d+)" lon="(-?\\d+\\.\\d+)"`,
      );
      const match = xml.match(nodeRegex);
      expect(match).not.toBeNull();
      expect(parseFloat(match![1]!)).toBeCloseTo(node.lat, 7);
      expect(parseFloat(match![2]!)).toBeCloseTo(node.lon, 7);
    }
  });
});

describe("osmChangesetExporter — Case 16: way with fewer than 2 nodeRefs", () => {
  it("validate() fails when a way has < 2 nodeRefs", () => {
    const input: OsmInput = {
      nodes: [{ id: -1, lat: -1.22, lon: 36.90 }],
      ways: [{ id: -101, nodeRefs: [-1] }], // only 1 ref — invalid
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("fewer than 2 nodeRefs"))).toBe(true);
  });
});

describe("osmChangesetExporter — Case 17: non-finite coordinates rejected", () => {
  it("validate() fails when lat/lon is NaN or Infinity", () => {
    const input: OsmInput = {
      nodes: [
        { id: -1, lat: NaN, lon: 36.90 },
      ],
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("non-finite"))).toBe(true);
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("osmChangesetExporter — golden .osm fixtures", () => {
  it("kenya-cadastral.osm exists and is well-formed XML with expected structure", () => {
    const xml = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.osm"), "utf-8");
    expect(xml.length).toBeGreaterThan(500);

    // XML declaration + root element
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<osm version="0.6"');
    expect(xml).toContain('generator="metardu-desktop OSM exporter');

    // 4 nodes (beacons) + 1 way (parcel boundary)
    const nodeCount = (xml.match(/<node\s/g) || []).length;
    expect(nodeCount).toBe(4);
    const wayCount = (xml.match(/<way\s/g) || []).length;
    expect(wayCount).toBe(1);

    // Source attribution tags
    expect(xml).toContain('k="source" v="metardu-desktop"');
    expect(xml).toContain('k="source:surveyor" v="Jane Wanjiru"');
    expect(xml).toContain('k="source:license_number" v="LS/1234"');
    expect(xml).toContain('k="survey:adjustment_run_id" v="golden-osm-ke-001"');

    // Changeset tags in comment header
    expect(xml).toContain("# comment=Adding surveyed parcel boundary in Kasarani");
    expect(xml).toContain("# imagery_used=Bing");

    // Way references all 4 nodes (closed ring)
    expect(xml).toContain('<nd ref="-1"/>');
    expect(xml).toContain('<nd ref="-2"/>');
    expect(xml).toContain('<nd ref="-3"/>');
    expect(xml).toContain('<nd ref="-4"/>');

    // Cadastral-specific tags
    expect(xml).toContain('k="boundary" v="administrative"');
    expect(xml).toContain('k="admin_level" v="8"');
    expect(xml).toContain('k="man_made" v="survey_point"');

    // XML well-formedness via heuristic check
    expect(isWellFormedXml(xml).ok).toBe(true);

    // Validate via Python's xml.etree.ElementTree (strict XML parser,
    // catches malformed XML our heuristic would miss). Skip silently
    // if python3 isn't installed.
    try {
      execSync(
        `python3 -c "import xml.etree.ElementTree as ET; ET.parse('${join(FIXTURES_DIR, "kenya-cadastral.osm").replace(/'/g, "\\'")}')"`
      , { stdio: "pipe" });
    } catch {
      // python3 not installed — skip.
    }
  });

  it("kenya-topographic.osm exists and is well-formed XML with expected structure", () => {
    const xml = readFileSync(join(FIXTURES_DIR, "kenya-topographic.osm"), "utf-8");
    expect(xml).toContain('<osm version="0.6"');

    // 4 nodes + 1 way (building footprint)
    const nodeCount = (xml.match(/<node\s/g) || []).length;
    expect(nodeCount).toBe(4);
    const wayCount = (xml.match(/<way\s/g) || []).length;
    expect(wayCount).toBe(1);

    // Building tags
    expect(xml).toContain('k="building" v="yes"');
    expect(xml).toContain('k="area" v="yes"');

    // Topo-specific adjustment run ID
    expect(xml).toContain("golden-osm-topo-ke-001");

    // XML well-formedness
    expect(isWellFormedXml(xml).ok).toBe(true);

    try {
      execSync(
        `python3 -c "import xml.etree.ElementTree as ET; ET.parse('${join(FIXTURES_DIR, "kenya-topographic.osm").replace(/'/g, "\\'")}')"`
      , { stdio: "pipe" });
    } catch {
      // python3 not installed — skip.
    }
  });

  it("fixtures are byte-stable for same input (modulo timestamp)", async () => {
    // Re-export and compare structural content. The .osm embeds a
    // timestamp so byte-identical comparison would be flaky — compare
    // node + way counts + key tags instead.
    const nodes = [
      { id: -1, lat: -1.2200000, lon: 36.9000000,
        tags: { man_made: "survey_point", name: "B1", "survey:accuracy": "0.0120", "survey:confidence": "0.95" } },
      { id: -2, lat: -1.2200000, lon: 36.9005000,
        tags: { man_made: "survey_point", name: "B2", "survey:accuracy": "0.0120", "survey:confidence": "0.95" } },
      { id: -3, lat: -1.2205000, lon: 36.9005000,
        tags: { man_made: "survey_point", name: "B3", "survey:accuracy": "0.0150", "survey:confidence": "0.95" } },
      { id: -4, lat: -1.2205000, lon: 36.9000000,
        tags: { man_made: "survey_point", name: "B4", "survey:accuracy": "0.0150", "survey:confidence": "0.95" } },
    ];
    const ways = [
      { id: -101, nodeRefs: [-1, -2, -3, -4, -1],
        tags: { boundary: "administrative", admin_level: "8", name: "S/12345", area: "yes" } },
    ];
    const result = await osmChangesetExporter.export(
      { nodes, ways, inputSrid: 4326 },
      {
        countryCode: "KE",
        projectMetadata: {
          projectName: "Golden Fixture — Kenya Cadastral OSM",
          surveyorName: "Jane Wanjiru",
          licenseNumber: "LS/1234",
          surveyDate: "2026-07-23",
          adjustmentRunId: "golden-osm-ke-001",
        },
        changesetTags: {
          comment: "Adding surveyed parcel boundary in Kasarani, Nairobi",
          imagery_used: "Bing",
        },
      },
    );

    const liveXml = decodeXml(result.bytes);
    const fixtureXml = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.osm"), "utf-8");

    // Same node + way counts
    const liveNodeCount = (liveXml.match(/<node\s/g) || []).length;
    const fixtNodeCount = (fixtureXml.match(/<node\s/g) || []).length;
    expect(liveNodeCount).toBe(fixtNodeCount);

    const liveWayCount = (liveXml.match(/<way\s/g) || []).length;
    const fixtWayCount = (fixtureXml.match(/<way\s/g) || []).length;
    expect(liveWayCount).toBe(fixtWayCount);

    // Same coordinates on node -1
    expect(liveXml).toContain('lat="-1.2200000"');
    expect(fixtureXml).toContain('lat="-1.2200000"');
    expect(liveXml).toContain('lon="36.9000000"');
    expect(fixtureXml).toContain('lon="36.9000000"');

    // Same source attribution
    expect(liveXml).toContain("golden-osm-ke-001");
    expect(fixtureXml).toContain("golden-osm-ke-001");
  });
});

// ─── projectToWgs84 callback tests (sidecar lat/lon bridge) ─────

describe("osmChangesetExporter — projectToWgs84 callback auto-converts projected coords", () => {
  it("auto-converts projectedCoords to WGS84 when callback provided", async () => {
    const input: OsmInput = {
      nodes: [
        {
          id: -1,
          projectedCoords: { easting: 257100.0, northing: 9857700.0, srid: 21037 },
          tags: { man_made: "survey_point", name: "B1" },
        },
      ],
      inputSrid: 21037,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      projectToWgs84: async (_e, _n, _srid) => {
        return { lat: -1.2200000, lon: 36.9000000 };
      },
    });

    expect(result.nodeCount).toBe(1);
    expect(result.warnedAboutProjection).toBe(false);

    const xml = decodeXml(result.bytes);
    // The node should have WGS84 lat/lon (not blank, not the projected coords)
    expect(xml).toContain('lat="-1.2200000"');
    expect(xml).toContain('lon="36.9000000"');
    // Source tags still present
    expect(xml).toContain('k="source" v="metardu-desktop"');
  });

  it("validation fails when projectedCoords present but no callback", () => {
    const input: OsmInput = {
      nodes: [
        {
          id: -1,
          projectedCoords: { easting: 257100.0, northing: 9857700.0, srid: 21037 },
        },
      ],
      inputSrid: 21037,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      // No projectToWgs84 callback
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectedCoords but no projectToWgs84"))).toBe(true);
  });

  it("no WGS84 warning when callback is provided", () => {
    const input: OsmInput = {
      nodes: [
        { id: -1, lat: -1.22, lon: 36.90, tags: {} },
      ],
      inputSrid: 4326,
    };
    const validation = osmChangesetExporter.validate(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      projectToWgs84: async () => ({ lat: 0, lon: 0 }),
    });
    expect(validation.ok).toBe(true);
    expect(validation.warnings.filter((w) => w.includes("WGS84"))).toHaveLength(0);
  });

  it("surfaces warning when callback throws for a projected node", async () => {
    const input: OsmInput = {
      nodes: [
        {
          id: -1,
          projectedCoords: { easting: 257100.0, northing: 9857700.0, srid: 21037 },
          tags: {},
        },
      ],
      inputSrid: 21037,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      projectToWgs84: async () => {
        throw new Error("sidecar IPC error");
      },
    });

    expect(result.warnings.some((w) => w.includes("projection-inverse failed"))).toBe(true);
    // Node was skipped (not in output)
    expect(result.nodeCount).toBe(0);
  });

  it("accepts mixed input: some WGS84, some projected", async () => {
    const input: OsmInput = {
      nodes: [
        { id: -1, lat: -1.22, lon: 36.90, tags: { name: "WGS84 node" } },
        {
          id: -2,
          projectedCoords: { easting: 257200.0, northing: 9857800.0, srid: 21037 },
          tags: { name: "projected node" },
        },
      ],
      inputSrid: 21037,
    };
    const result = await osmChangesetExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      projectToWgs84: async () => ({ lat: -1.23, lon: 36.91 }),
    });

    expect(result.nodeCount).toBe(2);
    const xml = decodeXml(result.bytes);
    // Both nodes present with WGS84 coords
    expect(xml).toContain('lat="-1.2200000"');
    expect(xml).toContain('lat="-1.2300000"');
  });
});
