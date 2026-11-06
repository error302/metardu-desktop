# ADR-0011: Fail-closed LAS/LAZ version support gate

**Status:** Accepted for the current point-cloud reader
**Date:** 29 October 2026

## Context

The Desktop sidecar pins `las-rs 0.11.2`. Its version model and point-format support end at LAS 1.4. ASPRS has published LAS 1.4 Revision 16 and LAS 1.5 Revision 00. A future minor version must not be accepted by the crate's generic 1.4 header-size fallback and then reported as if the current reader understood it.

## Decision

- Before using parsed offsets, point counts, or metadata, the bounded raw-header preflight accepts only major version 1 with minor version 0 through 4.
- Other major versions and versions above 1.4 fail with an explicit unsupported-version error. The importer does not downgrade or reinterpret them as LAS 1.4.
- This gate does not establish full conformance with ASPRS LAS 1.4 Revision 16. That revision needs specification-based and producer interoperability checks against the pinned reader.
- LAS 1.5 requires a reader with explicit LAS 1.5 support and known-answer fixtures before it is accepted. Point-cloud files remain source evidence and are never rewritten by inspection.

## Consequences

- Files newer than the reader's declared version support fail closed during import/inspection, before any record report is persisted.
- The current Desktop capability claim remains bounded to LAS/LAZ versions 1.0 through 1.4, with full-file conformance still unproven.
- Future reader upgrades must update the supported-version gate, format-specific handling, test fixtures, and this decision together.

## Verification

- A generated LAS 1.4 fixture continues to pass header and record inspection tests.
- A copy whose public-header version minor is changed to 5 is rejected with an explicit LAS 1.5 unsupported message.
- This test is a version-boundary check only; it does not validate LAS 1.4 Revision 16 or LAS 1.5 conformance.

## References

- [ASPRS LAS standards publication list](https://community.asprs.org/leadership-restricted/leadership-content/public-documents/standards)
- [ASPRS LAS Working Group publication notice](https://community.asprs.org/wg-las/discussion/lwg-meeting-next-week-sept-18-2025)
- [OGC LAZ 1.4 Community Standard](https://docs.ogc.org/cs/24-070r1/24-070r1.pdf)
