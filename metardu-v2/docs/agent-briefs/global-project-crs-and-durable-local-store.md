# TASK: Add explicit project CRS metadata and durable local project storage

## Task ID
global-project-crs-and-durable-local-store

## Product rule
METARDU Desktop projects separate legal jurisdiction from coordinate reference system. A neutral project must never receive an implied country, datum, CRS, unit, height system, legal standard, or statutory workflow. The first globally selectable CRS set is the EPSG WGS 84 / UTM north and south series. CRS assignment records metadata; it does not transform existing coordinates.

## Context reviewed
- `AGENT.md`
- `metardu-v2/docs/invariants.md`
- `metardu-v2/docs/decisions/0001-*` and `0004-*` (architecture and country configuration)
- `metardu-v2/docs/agent-briefs/crs-reprojection-fail-closed.md`
- `metardu-v2/docs/agent-briefs/geoid-and-datum-panel-safety.md`
- Recent `worklog.md` entries
- The AGENT.md reference `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent in this checkout; it was not used as evidence.

## Hard constraints
- Rust sidecar remains the owner of coordinate mathematics; TypeScript only routes validated parameters and results.
- Project jurisdiction and project CRS are independent fields. Never infer a statutory country profile from an EPSG code.
- A WGS 84 inverse projection is not a regional datum or epoch transformation. Unsupported datum and height operations remain blocked.
- Preserve existing project records during the SQLite v1-to-v2 migration. Keep the JSON import path and native project coordinates intact.
- Do not alter the METARDU Web subscription contract or push changes to the Web repository.
- Preserve unrelated staged/unstaged work in the shared checkout.

## Acceptance criteria
- [x] A project can persist an explicit EPSG horizontal CRS independently of jurisdiction.
- [x] Existing v1 SQLite records migrate without losing data; project CRS survives close/reopen.
- [x] Global WGS 84 / UTM EPSG codes 32601–32660 and 32701–32760 resolve to UTM parameters.
- [x] Neutral projects can use explicit supported WGS 84 / UTM inverse projection for the map overlay; unknown or unsupported CRS remains fail-closed.
- [x] Undo/redo and the generic sync data envelope preserve project CRS metadata.
- [x] Export refuses to label coordinates with a jurisdiction CRS when an explicit project CRS conflicts with that profile.
- [x] Focused and package tests, Desktop build, renderer type-check, and diff check are recorded in `worklog.md`.

## Verification boundary and next work
This change establishes a global UTM project reference and honest local persistence, not international survey-grade completeness. CRS areas of use are not yet checked by the generic inverse-projection path. Most survey workflows and current exporters still depend on one of the configured jurisdiction profiles; neutral projects cannot yet use those jurisdiction-dependent exports. Regional datum/epoch operations, vertical CRS/geoid grids, arbitrary EPSG/PROJ catalog search, country statutory packs, field instrument interoperability, and international QA fixtures remain separate work. Do not claim worldwide legal or professional readiness from these changes.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Implementing statutory or legal templates for new countries.
- Transforming coordinates when a user changes the project CRS.
- Claiming CRS area-of-use, epoch, geoid, local datum, or licensing coverage from the EPSG identifier alone.
- Changing authentication, billing, or the shared Web/Desktop subscription entitlement.
