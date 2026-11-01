# ADR-0016: Persist user-declared project coordinate context

**Status:** Accepted for project metadata only  
**Date:** 1 November 2026  
**Supersedes:** None

## Context

Projects can record jurisdiction and an optional horizontal EPSG code, but had no durable fields for coordinate units, coordinate epoch, or vertical reference. Guessing these values from country, EPSG label, or coordinate magnitudes would be unsafe. Existing projects also must remain usable without having their reference system rewritten by a schema migration.

## Decision

- Add a versioned project coordinate-context record with horizontal unit, optional positive finite decimal-year epoch, and optional vertical reference kind, exact name, and unit.
- Give each saved context the immutable evidence state `user_declared_unverified`. It is not a coordinate operation, datum realization, source-file interpretation, or professional verification.
- Let users declare or edit this context in the Projects panel. Persist it in SQLite and preserve it through local create/update snapshots, undo/redo, and the Desktop sync envelope.
- Keep legacy projects with no coordinate-context record. If imported context JSON is malformed, retain it in storage, surface an invalid status, and allow a user to replace it; unrelated project edits must not erase those bytes.
- Do not infer units from an EPSG identifier or jurisdiction. The current panel does not validate unit/CRS consistency; mismatches remain user-declared and unverified.
- Do not change coordinates, select a transformation, unblock CRS-sensitive computation, or claim that a vertical datum is known as a result of recording these fields.

## Consequences

- Projects can carry explicit context declarations across restart and local editing without silently filling legacy gaps.
- The declarations can warn and inform later workflows, but do not supply the full source/target CRS definitions, operation chain, area of use, accuracy, or required transformation grids described in the product plan.
- The sync mapper carries the context in its wire payload; server-side persistence and round-trip behavior are not proven by this Desktop change.
- The active status strip and dataset-specific reference context are still needed before this is a complete project coordinate-context workflow.

## Verification boundary

Schema, migration, SQLite persistence, malformed-context preservation, pure project store, sync mapping, and undo/redo tests can verify this slice. They do not verify CRS compatibility, coordinate transformations, height conversion, the server's sync persistence, statutory acceptance, or field accuracy.

## Related decisions

- ADR-0003: global project CRS and durable local project store.
- ADR-0004: global topographic draft integrity.
- ADR-0013: host-managed point-cloud chunk streaming.
- ADR-0007: community extension ecosystem.
