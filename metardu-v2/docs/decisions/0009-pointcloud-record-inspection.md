# ADR-0009: Project-scoped LAS/LAZ record inspection

**Status:** Accepted for the point-record inspection slice
**Date:** 29 October 2026
**Supersedes:** None

## Context

METARDU Desktop can preserve a project-linked LAS/LAZ source and inspect its header, but source-declared counts and bounds have not been compared with decoded point records. Surveyors need to see existing point classes and return counts, detect unreadable or truncated declared records, and inspect bounds derived from decoded coordinates before selecting a processing method.

## Decision

- A renderer invokes record inspection by source ID. Electron main checks that the ID belongs to the active project, resolves the app-managed content key, verifies the source SHA-256, and sends the private path to the Rust sidecar. The renderer never receives that path or key.
- The sidecar reads LAS and LAZ point records sequentially in bounded reusable batches through the pinned `las` reader. It returns only compact counts, bounds, metadata, and warnings; no point arrays are serialized.
- Main re-verifies the stored source after decoding. If either full-file digest check fails, inspection results are discarded and not persisted.
- Inspection reports numeric class codes decoded from the source; it does not interpret a Classification Lookup VLR, run a classifier, or validate that the source classifications are correct. Class meanings vary with the LAS point format and classification scheme, so this UI does not attach names to those codes. Coordinates are shown after the header's LAS scale and offset only; no CRS, units, epoch, vertical reference, or accuracy is inferred.
- SQLite v3 migrates forward to v4 with append-only inspection history linked to the source record and exact content digest. Each result retains reader version, scan time, count comparisons, class/return counts, coordinate bounds, and warnings.
- A count mismatch or decoding error remains visible as a data-quality issue. Header-declared record counts are not treated as proof that bytes beyond the declared point range are valid; this slice does not claim whole-file structural conformance.
- Results stay local and offline. Classification, derived data, project portability, and plugin reads require their own validated contracts.

## Consequences

- A manual record inspection can require another full source read and decompression; it may take time for very large clouds.
- The scan has a bounded point-data buffer and bounded result size, but this slice does not expose progress or cancellation. The follow-up host-managed chunk API must add cancellable processing.
- Full-file hash checks before and after the scan add I/O but bind displayed evidence to the retained source bytes.
- The report provides file/record evidence only. It cannot establish that source classes are correct, that coordinates are in the project CRS, or that any output is fit for survey delivery.

## Security and evidence boundary

The new operation is source-ID scoped and registered only through a dedicated preload method, not the generic renderer sidecar-call allowlist. Main validates the source belongs to the active project and keeps path resolution inside the hash-keyed object store. Hash and scan results must match the database digest before they are returned or saved.

## Verification required

- LAS and compressed LAZ fixtures with known classifications, return counts, transforms, and bounds.
- Truncated/malformed record fixtures fail closed; source bytes remain unchanged.
- SQLite v3-to-v4 migration preserves prior rows; inspection reports are hash-bound and project-scoped.
- Desktop and renderer builds, focused tests, and an Electron IPC smoke test if the repository harness exists.
