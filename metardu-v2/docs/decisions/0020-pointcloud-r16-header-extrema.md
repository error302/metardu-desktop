# ADR-0020: Compare decoded point extrema with LAS header bounds

**Status:** Accepted for record-inspection evidence
**Date:** 3 November 2026
**Supersedes:** None

## Context

LAS 1.4 Revision 16 clarifies that header min/max X, Y, and Z are the actual coordinate extrema of the point data after the point-record coordinate transformation, and that all six values are zero when the file has no point records. Existing METARDU inspection decodes coordinates and checks only that all finite decoded points lie inside the header bounds. An unnecessarily large, stale extent therefore passes that containment test.

## Decision

- Compare each decoded minimum and maximum coordinate with its corresponding source header extent after LAS scale and offset.
- Use four binary64 epsilon-scaled units at the magnitude of the compared values solely to accommodate floating-point representation. This is not positional accuracy, survey tolerance, or CRS validation.
- Require exact zero-valued header extrema for a complete zero-point file.
- Return an inconclusive value when the declared point range was not completely decoded, any decoded coordinate is non-finite, or a header bound is non-finite.
- Keep the existing “decoded points are within header bounds” result. Apply the same small representation tolerance to boundary containment so the two report fields do not conflict because of one-ULP arithmetic differences.
- Report mismatches as source-file consistency warnings. Do not modify or reject the retained source solely because its header extrema are stale.
- Make the result optional in the shared TypeScript report type so older persisted inspection reports remain readable.

## Consequences

- A stale oversized header extent can be distinguished from a true match even when every point lies within it.
- The comparison improves file-quality evidence only; it cannot establish coordinate reference, positional accuracy, or classification correctness.
- Full LAS/LAZ structure validation, waveform payload extents, non-default LASzip special EVLR handling, producer interoperability, and professional surveyor review remain separate gates.

## Verification boundary

Known-answer LAS fixtures can prove the comparison behavior for their encoded points and bounds. They cannot establish whole-file conformance, producer interoperability, or survey-grade accuracy.

## References

- [ASPRS LAS 1.4 Revision 16 release summary](https://github.com/ASPRSorg/LAS/releases)
- [ASPRS LAS Working Group issue #89: coordinate extrema semantics](https://github.com/ASPRSorg/LAS/issues/89)
- ADR-0009: Project-scoped LAS/LAZ record inspection.
- ADR-0011: Fail-closed LAS/LAZ version support gate.
