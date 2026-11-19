# ADR-0012: Bound the LAS/LAZ VLR sequence before decoding

**Status:** Accepted for the current point-cloud inspection scope
**Date:** 29 October 2026

## Context

The LAS/LAZ preflight already bounded the metadata region before point data, but it did not walk each declared Variable Length Record (VLR) header and payload against the public-header point-data offset. A malformed VLR could therefore cross that boundary before the `las-rs` header reader attempted to parse it. Bytes between the declared VLR sequence and point data also lacked explicit reporting.

## Decision

- Before `las-rs` parses the header, walk the declared VLR sequence from `Header Size` using the 54-byte VLR header and 16-bit `Record Length After Header` field.
- Reject a VLR header or payload that crosses the declared point-data offset or the actual file size. Keep the existing VLR-count and total pre-point-metadata resource limits.
- Measure any bytes after the VLR sequence and before point data. Read them in a bounded buffer and report whether every byte is zero, but do not label them as valid padding or assign a record type.
- Include the declared VLR count, sequence start/end, gap byte count, and all-zero result in the record-inspection structure report. The Point Cloud view displays these values and keeps old saved reports compatible when the optional VLR details are absent.
- Keep the source read-only. No IPC or project database schema changes are needed.
- This is structural boundary validation only. It does not validate reserved fields, record-specific schemas, all legal padding rules, ASPRS LAS 1.4 Revision 16 conformance, or producer interoperability.

## Consequences

- Import/header inspection fails closed when a declared VLR crosses into the point-data region.
- Record reports distinguish a zero-filled gap from a nonzero unclassified gap without silently treating either as understood data.
- No new IPC or project schema is introduced; the renderer's typed report contract gains an optional field only.

## Verification

- Generated LAS fixtures cover an oversized VLR payload crossing the point-data offset, a zero-filled pre-point gap, and a nonzero pre-point gap.
- Record scans continue to decode the two declared points in both gap fixtures, showing the gap is not consumed as point records.
- The tests do not establish full-file LAS/LAZ conformance or validation against every producer.

## References

- [OGC LAZ 1.4 Community Standard, clauses 6.3–6.5](https://docs.ogc.org/cs/24-070r1/24-070r1.pdf) describes the declared VLR count, sequential 54-byte VLR headers and point-data offset. Its normative LAS reference is LAS 1.4 R15, so it is not evidence of LAS 1.4 Revision 16 conformance.
- ADR-0011, fail-closed LAS/LAZ version support.
- ADR-0009, project-scoped LAS/LAZ record inspection.
