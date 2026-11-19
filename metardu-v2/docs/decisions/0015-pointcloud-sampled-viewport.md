# ADR-0015: Bounded class-colored point-cloud viewport

**Status:** Accepted for read-only visualization preview
**Date:** 1 November 2026
**Supersedes:** None

## Context

The project-linked point-cloud screen can inspect headers and existing class counts, and the main process has a hash-bound, cancellable LAS/LAZ chunk stream. Surveyors still cannot see the source points or inspect how existing classes are distributed spatially. Sending a complete cloud to the renderer is unsafe for memory and bypasses the host-managed stream boundary.

## Decision

- A user starts a preview from an opaque source ID attached to the active project. The main process opens the existing trusted chunk stream; no renderer route accepts a path or storage key.
- The host reads the complete header-declared point range, selects every Nth source point by a deterministic stride, and returns at most 25,000 finite XYZ/class records. The stride, selected count, decoded count, source digest, format, and sampling method accompany the sample.
- A preview is published only after the stream reports the complete declared count and the existing stream controller verifies the retained source hash again. Failure or cancellation discards partial points.
- The renderer colors the unchanged numeric class codes with a METARDU display palette and lets the user isolate classes. LAS colors, class meanings, classification correctness, CRS, units, epoch, and vertical reference are not inferred by the viewport.
- The viewport shows a local XYZ orientation, supports pointer and keyboard rotation and zoom, and labels the sample as visualization only. It cannot measure, create a surface, or produce a deliverable.
- The bounded result remains in process memory and expires with its job. No project artifact or output file is written.

## Consequences

- Surveyors can visually inspect the spatial distribution of existing class codes in LAS and LAZ sources.
- Systematic source-order sampling can be biased when records are spatially ordered. The UI states this and gives the exact sampling stride.
- Creating a preview requires a full sequential decode so source integrity can be checked at EOF; very large sources can take time. Progress and cancellation are visible.
- Plugins, classification algorithms, persistent derived outputs, map registration, and measurement remain separate capabilities and evidence gates.

## Verification boundaries

Unit tests can verify sampling, caps, cancellation, stale or malformed streams, and source-hash gate behavior. They do not prove Electron runtime behavior, representative vendor compatibility, CRS interpretation, classifier accuracy, or field performance.

## Related decisions

- ADR-0007: community extension security and trust states.
- ADR-0013: host-managed point-cloud chunk streaming.
