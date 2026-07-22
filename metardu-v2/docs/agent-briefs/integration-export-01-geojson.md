# TASK: GeoJSON integration exporter with CRS metadata + per-feature uncertainty attribution

## Task ID
integration-export-01-geojson

## Context the agent must read first

- [ ] `AGENT.md` (root)
- [ ] `metardu-v2/docs/invariants.md` — particularly A1, A2, A6, C1, C2
- [ ] ADRs relevant to this task:
  - [ ] `metardu-v2/docs/decisions/0004-kenya-as-reference-country.md` — country-config pattern
  - [ ] **`download/integration-export/ADR-0005-integration-export-workflow-family.md`** — this task's parent ADR (Proposed status — your work lands it as Accepted once verification passes)
- [ ] Regulatory source doc(s): **none required** — this task is country-agnostic. CRS, SRID, and precision conventions all come from `packages/country-config/`.
- [ ] Most recent worklog entries (last 5+ from `worklog.md` at repo root)

## Required audit before writing code

Open and paste verbatim contents of (do not paraphrase — the worklog must contain the actual file contents you saw):

- `metardu-v2/packages/engine/src/documents/dxf-output.ts` — the existing DXF exporter is the pattern to follow for: layer naming, country-config lookup, fixture-based testing. Pay attention to how it reads SRID and precision.
- `metardu-v2/packages/country-config/src/types.ts` — the `CountrySurveyConfig` interface. Your exporter reads `geodeticFramework.primarySRID` and `toleranceTable` from here.
- `metardu-v2/packages/country-config/src/countries/kenya.ts` — the reference country. Verify the SRID field exists and matches the Kenya invariant (21037 for Arc 1960/UTM 37S).
- `metardu-v2/packages/engine/src/workflows/index.ts` — the `SurveyOutput` type family. Your exporter consumes the output of `runCadastralWorkflow`, `runTopographicWorkflow`, etc. Confirm what fields carry adjusted coordinates and what fields carry covariance.
- `metardu-v2/packages/engine/src/workflows/cadastral.ts` — to confirm the exact shape of the adjusted-coordinate + uncertainty output. If the workflow does NOT yet emit per-coordinate covariance, STOP — that's a blocker and must be reported, not worked around.

If a cited invariant conflicts with this task, STOP and report the conflict — do not silently resolve it. In particular: if the cadastral workflow's output does not include propagated uncertainty (semi-major axis, semi-minor axis, orientation of the error ellipse per adjusted coordinate), this task is blocked on a prerequisite and you must say so explicitly.

## Hard constraints (restate relevant subset of invariants, every time)

- **A1 — Sidecar owns the math.** This exporter does NOT recompute coordinates. It serializes what the workflow produced. If you find yourself writing projection math in `integration/geojson-export.ts`, stop and move it to the sidecar.
- **A2 — SRID comes from country config.** A literal SRID number (e.g. `21037`, `4326`) anywhere in `packages/engine/src/integration/` is a failing review. SRID is read from `country-config` at runtime.
- **A6 — Forbidden dependencies.** GeoJSON export uses the built-in `JSON.stringify`. No `axios`, no `supabase`, no Prisma/Drizzle. If you believe a new dependency is required, STOP and propose it in the worklog — don't add it silently.
- **C1 — Every statutory number traces to an adjusted value.** Exported coordinates MUST carry their propagated uncertainty as a per-feature property. The default behavior is `includeUncertainty: true`. A user may opt out (some downstream GIS tools don't understand covariance), but the default ships the uncertainty.
- **C2 — Rounding only at display time.** Exported coordinates use full `float64` precision via `JSON.stringify`'s default number serialization. Do NOT call `.toFixed()` or `.toPrecision()` on coordinates mid-export.
- **RFC 7946 compliance.** The produced GeoJSON MUST be valid per RFC 7946. CRS metadata goes in the `crs` top-level member (RFC 7946 technically deprecates `crs` in favor of WGS84-only, but in practice every GIS tool still reads it — we ship it because survey-grade data MUST declare its CRS, not silently assume WGS84).
- **Anti-hallucination.** If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents.

## Scope of this task

Build:

1. **`packages/engine/src/integration/types.ts`** — the shared `IntegrationExporter` interface and supporting types from ADR-0005 Section "Schema contract". This is the contract every future exporter (GeoPackage, PyQGIS script, QGS project, GCP, OSM changeset) will implement.

2. **`packages/engine/src/integration/geojson-export.ts`** — the first concrete exporter. Implements `IntegrationExporter<SurveyOutput, GeoJsonOptions, GeoJsonOutput>`.

3. **`packages/engine/src/integration/index.ts`** — barrel file re-exporting the interface, the types, and the registered exporter.

4. **`packages/engine/src/integration/tests/geojson-export.test.ts`** — tests (see Acceptance criteria for the required coverage).

5. **Wire the new module into `packages/engine/src/index.ts`** — add an `export * from "./integration/index.js";` block at the bottom, following the existing pattern.

6. **Add ADR-0005 to `metardu-v2/docs/decisions/`** — copy `download/integration-export/ADR-0005-integration-export-workflow-family.md` into the repo's decisions directory. Change its status from "Proposed" to "Accepted" once the verification below passes.

### What the GeoJSON exporter must produce

For a cadastral survey output (the first integration target — topographic and engineering come later as separate task briefs):

```json
{
  "type": "FeatureCollection",
  "crs": {
    "type": "name",
    "properties": { "name": "urn:ogc:def:crs:EPSG::21037" }
  },
  "metadata": {
    "metardu": {
      "softwareVersion": "<from package.json>",
      "projectName": "<from options>",
      "surveyorName": "<from options>",
      "licenseNumber": "<from options>",
      "surveyDate": "<from options>",
      "adjustmentRunId": "<from options>",
      "countryCode": "KE",
      "exportedAt": "<ISO 8601 UTC>"
    }
  },
  "features": [
    {
      "type": "Feature",
      "id": "beacon-B1",
      "geometry": {
        "type": "Point",
        "coordinates": [257100.0, 9857700.0]
      },
      "properties": {
        "featureType": "beacon",
        "label": "B1",
        "description": "Concrete pillar",
        "surveyType": "cadastral",
        "adjusted": true,
        "uncertainty": {
          "semiMajorAxis": 0.012,
          "semiMinorAxis": 0.008,
          "orientation": 45.3,
          "confidenceLevel": 0.95
        },
        "trace": {
          "adjustmentRunId": "<matches top-level metadata>",
          "observationCount": 12,
          "redundancy": 4
        }
      }
    },
    {
      "type": "Feature",
      "id": "parcel-S-12345",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[257100.0, 9857700.0], [257150.0, 9857700.0], [257150.0, 9857750.0], [257100.0, 9857750.0], [257100.0, 9857700.0]]]
      },
      "properties": {
        "featureType": "parcel",
        "surveyNumber": "S/12345",
        "district": "NAIROBI",
        "location": "KASARANI",
        "areaHa": 0.25,
        "areaUncertaintyHa": 0.0008,
        "surveyType": "cadastral",
        "adjusted": true,
        "beaconIds": ["beacon-B1", "beacon-B2", "beacon-B3", "beacon-B4"]
      }
    }
  ]
}
```

### Behaviors (mandatory)

1. **CRS declaration from country-config.** The `crs.properties.name` string is built as `urn:ogc:def:crs:EPSG::<srid>` where `<srid>` comes from the active `CountrySurveyConfig.geodeticFramework.primarySRID`. No hardcoded SRID.

2. **Uncertainty attribution.** Every adjusted coordinate feature (beacon, control point, stakeout point) carries an `uncertainty` object with `semiMajorAxis`, `semiMinorAxis`, `orientation` (degrees from north), and `confidenceLevel` (default 0.95). If the input survey output does not provide uncertainty for a feature, the exporter MUST:
   - Emit a warning in `IntegrationOutput.warnings` naming the feature ID.
   - Set `properties.adjusted = false` and omit the `uncertainty` object.
   - NOT refuse the export — the surveyor may be exporting raw field data intentionally. The warning is the audit trail.

3. **Validation.** `validate(input, options)` returns `errors: []` if all of:
   - `options.countryCode` matches a country in `country-config`
   - The input's `countryCode` (if present) matches `options.countryCode`
   - `projectMetadata` is fully populated (projectName, surveyorName, licenseNumber, surveyDate, adjustmentRunId) — refuse to export anonymous data; traceability is non-negotiable per invariant C1.
   
   Otherwise `errors` is non-empty and `export()` throws (or returns a rejected promise, depending on the calling convention used elsewhere — match the existing dxf-output pattern).

4. **Round-trip.** The produced bytes must `JSON.parse` cleanly back to an object that passes the same shape validation. This is the regression guard against future schema drift.

5. **No silent precision loss.** Coordinates are serialized with `JSON.stringify`'s default number handling. Do NOT use `.toFixed()`, `.toPrecision()`, or string interpolation that would truncate the float64 representation.

6. **UTF-8.** The output `Uint8Array` is the UTF-8 encoding of the JSON string. Confirm with `new TextEncoder().encode(json)`.

## Out of scope (explicit — do NOT do these in this task)

- Topographic and engineering survey outputs as GeoJSON. This task targets cadastral only; topo/engineering come in a separate task brief (`integration-export-02-geojson-topo-eng`) once this one lands.
- GeoPackage exporter. That's task brief `integration-export-03-geopackage`.
- PyQGIS script generator. That's `integration-export-04-pyqgis-script`.
- QGIS project file generator. That's `integration-export-05-qgs-project`.
- GCP file exporter. That's `integration-export-06-gcp`.
- OSM changeset exporter. That's `integration-export-07-osm-changeset`.
- DXF extension. The existing `dxf-output.ts` is extended by a separate task brief.
- UI wiring in the Electron renderer. A separate task brief will add an "Export → GeoJSON" menu item that calls this exporter through the preload bridge. This task is engine-only.
- Marketing copy update. ADR-0005 flags the marketing copy update as out-of-scope for engineering; it's a separate Mohammed-owned action.

## Acceptance criteria (must be independently verifiable, not agent-asserted)

### Build

- [ ] `cargo build --release` in `packages/metardu-sidecar/` — paste last 10 lines of output. (Sidecar is unchanged by this task; this is the regression gate.)
- [ ] `npx tsc --noEmit` in `packages/engine/` — paste output (must be empty / 0 errors).
- [ ] `npx tsc --noEmit` in `apps/desktop/` — paste output (must be empty / 0 errors).

### Tests

- [ ] `cargo test --release` in `packages/metardu-sidecar/` — paste last 10 lines, including `test result: ok. N passed; 0 failed`. (Regression gate — sidecar unchanged.)
- [ ] `npm test` in `packages/engine/` — paste last 5 lines, including `Tests N passed (N)`. The new test count must be previous + new tests (estimated 12-18 new tests).
- [ ] Golden fixture(s) that must pass, named explicitly:
  - [ ] `packages/engine/src/integration/tests/fixtures/kenya-cadastral-4-beacon.json` — a hand-verified GeoJSON output for a 4-beacon rectangular parcel in Kenya, SRID 21037, with propagated uncertainty.
  - [ ] `packages/engine/src/integration/tests/fixtures/uk-cadastral-general-boundaries.json` — a hand-verified GeoJSON output for a UK parcel, OSGB36 (SRID 27700), exercising the general-boundaries case (no fixed-boundary uncertainty, must emit the warning and set `adjusted=false`).

### Required test coverage (geojson-export.test.ts)

At minimum:

1. Happy path: Kenya 4-beacon cadastral survey → valid GeoJSON with CRS `urn:ogc:def:crs:EPSG::21037`, 5 features (4 beacons + 1 parcel), all beacons carry `uncertainty`, `metadata.metardu.countryCode === "KE"`.
2. UK general-boundaries case: input has no covariance (UK is general-boundaries by invariant) → exporter emits a warning naming each affected feature, sets `adjusted=false` on those features, still produces valid GeoJSON.
3. Missing project metadata → `validate()` returns an error, `export()` throws.
4. Unknown country code → `validate()` returns an error, `export()` throws.
5. SRID lookup: verify the `crs.properties.name` string matches `urn:ogc:def:crs:EPSG::<srid>` for each of the 5 countries in `country-config` (parameterized test).
6. Round-trip: `JSON.parse(bytes)` produces an object with the same feature count, same CRS string, same `metadata.metardu.countryCode`.
7. Precision preservation: a coordinate with value `257100.123456789012` survives the round-trip with no precision loss (compare as `===` on the parsed number).
8. UTF-8: the produced `Uint8Array` decodes back to the original JSON string via `new TextDecoder().decode(bytes)`.
9. Default `includeUncertainty: true` vs explicit `false` — when `false`, the `uncertainty` property is omitted from all features but `adjusted` is still set correctly.
10. A beacon with `uncertainty` present but `confidenceLevel` missing → exporter fills in 0.95 (the default) and emits a warning.

### IPC / UI

Not applicable — this task is engine-only. UI wiring is a separate task brief.

### Anti-hallucination clause (verbatim)

> If you are uncertain whether a regulatory detail, file location, or existing
> behavior is correct, stop and state the uncertainty explicitly. Do not
> fabricate test results, completion percentages, or file contents. A partial,
> honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

On completion, append (do not overwrite) an entry to `worklog.md` at the repo root in the existing format (see `AGENT.md` Section 6), including:

- Task ID: `integration-export-01-geojson`
- Files created (full paths within the repo)
- Files modified (full paths within the repo)
- Verbatim terminal output of:
  - `cargo build --release` (last 10 lines)
  - `cargo test --release` (last 10 lines)
  - `npx tsc --noEmit` in engine (full output)
  - `npx tsc --noEmit` in apps/desktop (full output)
  - `npm test` in engine (last 5 lines, including the test count)
- The two golden fixtures' file paths
- Confirmation that ADR-0005 status was changed from "Proposed" to "Accepted" once verification passed (or, if verification failed, the reason it remains "Proposed")
- What's next: the follow-on task brief IDs (`integration-export-02-geojson-topo-eng`, `integration-export-03-geopackage`, etc.) so the next agent knows where to pick up.

## Estimated effort

- 1 well-briefed agent session: ~3-4 hours of focused work
- Code volume: ~250 lines TypeScript (exporter) + ~80 lines (shared types) + ~200 lines (tests) + 2 fixture files
- Risk: LOW — pattern is established by `dxf-output.ts`, country-config exists, survey output shape is documented. The only real risk is if the cadastral workflow doesn't yet emit propagated uncertainty — that would be a blocker requiring a prerequisite task.

## Prerequisite check (before starting)

Confirm the following before writing any code. If any are false, STOP and report:

1. `packages/engine/src/workflows/cadastral.ts` exports a type whose adjusted coordinates include a `covariance` or `uncertainty` field (semi-major, semi-minor, orientation).
2. `packages/country-config/src/countries/kenya.ts` exports a config with `geodeticFramework.primarySRID === 21037`.
3. `packages/engine/src/documents/dxf-output.ts` exists and follows a recognizable "input type → bytes" pattern. (It does — confirmed during the ADR audit.)
4. `packages/engine/src/index.ts` uses the `export * from "./<module>/index.js"` barrel pattern (or equivalent) that you can extend.

If #1 is false, this task is blocked on a prerequisite: extend `runCadastralWorkflow` to emit propagated uncertainty before building the GeoJSON exporter. Surface this to Mohammed — do NOT proceed by exporting raw coordinates without uncertainty (that violates invariant C1).

---

*This brief is generated from ADR-0005. ADR-0005 is the controlling architectural decision; this brief is the first concrete slice of its implementation.*
