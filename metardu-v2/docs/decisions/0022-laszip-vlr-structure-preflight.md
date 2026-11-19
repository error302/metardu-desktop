# ADR-0022: Validate LASzip VLR structure before LAZ inspection

**Status:** Accepted for the bounded LAZ inspection workflow
**Date:** 3 November 2026
**Supersedes:** None; extends the structural checks in ADR-0012

## Context

The LAZ inspector already bounds the VLR sequence, reads the LASzip compressor fields, and validates chunk tables for chunked files. However, the pointwise path returned before parsing the complete LASzip VLR. It could therefore accept an incomplete or length-inconsistent item table, and the chunked path did not prove that LASzip item widths matched the public-header point-record length. A compressed source with multiple LASzip VLRs also lacked an explicit rejection.

The LAZ 1.4 specification defines one LASzip special VLR, a fixed 34-byte data prefix followed by six-byte item records, and compressor families tied to LAS point-format families. These checks improve the file-structure report; they do not establish full LAS 1.4 R16, LAZ, or producer conformance.

## Decision

- Before reporting bounded structure for compressed input, require exactly one recognized LASzip VLR.
- Require its data payload to have exactly `34 + 6 * item_count` bytes. Reject truncation and trailing item-table bytes before decoding records.
- Parse the item records and sum their declared widths using checked 64-bit arithmetic. Require the total to equal the public-header point-record length.
- Require compressor 1 or 2 for point formats 0–5 and compressor 3 for point formats 6–10. Other compressor values remain unsupported.
- Keep non-default special-EVLR reference fields incomplete. Do not interpret their offsets, move the point-data boundary, or claim the exact arithmetic-stream end.
- Keep the original source read-only and preserve existing source-hash and project-scope gates. A failed preflight cannot produce a successful record report.

## Consequences

- Malformed LASzip item metadata and compressor/format mismatches fail before point decoding or a bounded-layout claim.
- Existing valid pointwise and chunked LAZ paths retain their current boundary semantics.
- This validates only a bounded LASzip VLR subset. Item ordering/version/type composition, all reserved fields, waveform packet extents, padding, producer interoperability, and whole-file conformance remain open.
- The check does not validate CRS, coordinate units, vertical reference, classification correctness, or survey accuracy.

## Verification

- Valid compressed LAZ fixtures continue to pass for chunked and pointwise layouts.
- Malformed fixtures cover duplicate LASzip VLRs, a physically truncated fixed prefix, a physically truncated item table, a declared item count inconsistent with record-data length, item widths inconsistent with the point-record length, and a compressor incompatible with the point format.
- A non-default special-EVLR fixture remains explicitly incomplete.

## References

- [OGC LAZ 1.4 Community Standard](https://docs.ogc.org/cs/24-070r1/24-070r1.pdf), clause 7.1 and Tables 8–13.
- ADR-0009: project-scoped LAS/LAZ record inspection.
- ADR-0011: fail-closed LAS/LAZ version support.
- ADR-0012: bounded LAS/LAZ VLR sequence preflight.
