# ADR-0008: Project-linked content-addressed point-cloud sources

**Status:** Accepted for the point-cloud source-import slice
**Date:** 29 October 2026
**Supersedes:** None

## Context

LAS/LAZ header inspection now runs through the Rust sidecar, but the selected source is transient and is not attached to a project. A surveyor needs the exact source bytes to remain available for later record inspection, classification, review, and derived outputs. Large point clouds cannot be copied through renderer state or the WebAssembly JSON extension ABI.

## Decision

- Electron main owns a narrow native-picker workflow. It copies the selected file through a staging area using streaming I/O, computes SHA-256 over the copied bytes, inspects the staged LAS/LAZ header in the Rust sidecar, and only then copies it into the managed object store with exclusive-create semantics and verifies the final bytes before creating a project record.
- The object store is local under Electron `userData`, organized by content hash and safe extension. Existing objects are never overwritten; a collision is accepted only after verifying the existing bytes against the digest and expected size.
- SQLite records connect each source object to an existing active project and preserve the original basename, digest, size, file extension/format, header evidence, and import time. The schema migration is forward-only and must retain all existing project records.
- The renderer receives a typed source summary and project name. It never receives a file path, storage key, database handle, or general filesystem capability. Community modules receive no access to the object store in this phase.
- The Desktop UI can request a full-file SHA-256 check scoped to a source attached to the active project. Project listing after restart reports the source as not rechecked; no future processing operation may rely on the old import-time status without verifying the bytes it is about to read.
- The source file selected by the surveyor is never modified. Project deletion detaches database metadata but does not remove the underlying object. Automatic cleanup is prohibited until a reviewed recovery and reference-counting design exists.
- Storage and computation remain local and offline. File header fields remain source-declared evidence; this decision does not infer project CRS, units, epoch, or vertical reference.

## Consequences

- Large imports use bounded memory but may take time and temporarily require storage for both a staging copy and a managed copy, in addition to the user's original file.
- Full-file integrity rechecks stream the complete source and can take time; the UI runs them only on explicit request in this phase.
- The source object is append-only through the product API, not cryptographically protected from local operating-system or user modification. Future reads must verify the recorded hash before treating the object as the imported source.
- Orphaned objects can remain after project deletion or interrupted database writes. An interrupted object copy can also leave an incomplete hash-keyed file; future import fails closed on it and a future recovery tool must identify and repair it without replacing a referenced source. This favors data preservation over silent data loss.
- A durable project source is not yet a project bundle, backup, classification result, or plugin-readable dataset.

## Security and evidence boundary

The Electron main process is the only caller of the import/list IPC methods. A native file picker limits the chosen input; extension and file type are validated; sidecar inspection remains bounded. The existing preload remains a typed method allowlist. Header parsing and content hashing establish file-format and byte-identity evidence only, not point-record integrity or survey accuracy.

## Verification required

- Tests for SQLite v2-to-v3 migration and preservation of existing projects.
- Tests for streamed content hashes, safe content-address keys, verified deduplication, and cleanup of failed staging files.
- Rust header inspection fixtures and Desktop/renderer builds.
- IPC smoke testing when the repository's Electron smoke harness is available.
