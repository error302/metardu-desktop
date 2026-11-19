# ADR-0019: Keep point-cloud coordinate context source-specific

**Status:** Accepted for local, user-declared source metadata
**Date:** 3 November 2026
**Supersedes:** None

## Context

One survey project can contain point clouds with different horizontal
coordinate systems, units, epochs, and vertical references. The project-level
coordinate declaration from ADR-0016 does not prove that every imported source
uses that context. LAS CRS records and WKT can be present without being
interpreted or confirmed. A future classifier may use distance parameters
whose meaning depends on source units.

## Decision

- Store an optional coordinate declaration on each project-linked point-cloud
  source, separately from project-level context.
- Allow an optional exact user-entered CRS label, horizontal unit, optional
  positive finite decimal-year epoch, and optional named vertical reference
  with unit.
- Mark every saved declaration `user_declared_unverified`. Existing source
  records remain empty after migration.
- Allow edits only for a source ID linked to the active project. Keep paths and
  storage keys in the main process.
- Preserve malformed stored JSON and display it as invalid so the user can
  replace or clear it. Do not parse the raw value into partial UI fields.
- Do not copy project context into a source, interpret source WKT, resolve a
  CRS label, change coordinates, establish an operation, or enable a classifier
  or professional deliverable.
- Keep source context in the local Desktop store. Portable bundles and Web
  synchronization require separate contracts.

## Consequences

- Surveyors can record differing source contexts before a future analysis
  workflow is available, without silently inheriting project assumptions.
- The declaration is metadata only. It does not establish that the source
  bytes, CRS, units, epoch, or vertical reference are correct.
- A future processing task must bind its result to the source digest and the
  exact source-context revision it used, then record method and review
  provenance.
- Source-level edit history, coordinate-operation evidence, whole-file LAS/LAZ
  conformance, and portable project recovery remain separate gates.

## Verification boundary

Schema and SQLite tests can verify declaration shape, local persistence,
migration, and project/source scope. They cannot verify CRS compatibility,
transformations, height conversion, source metadata correctness, field use, or
professional classification accuracy.

## Related decisions

- ADR-0007: community extension ecosystem.
- ADR-0013: host-managed point-cloud chunk streaming.
- ADR-0016: project coordinate declarations.
- ADR-0017: active project coordinate status.
