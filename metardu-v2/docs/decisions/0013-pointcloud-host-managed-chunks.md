# ADR-0013: Host-managed point-cloud chunk streaming

**Status:** Accepted for the read-only chunk-stream foundation
**Date:** 1 November 2026
**Supersedes:** None

## Context

The project-linked LAS/LAZ source store and cancellable record-inspection job can validate and summarize declared points, but they do not supply point data to a processing tool. The WebAssembly ABI v1 preview accepts a single bounded JSON input and has no project-data capability. Passing an entire cloud through that interface would use unbounded memory and expose no safe cancellation or source-integrity boundary.

## Decision

- A main-process `PointCloudChunkStreamController` accepts only a source ID attached to the active project. It resolves the hash-addressed managed file internally; no caller provides or receives a path or storage key.
- Before opening a stream, the controller verifies the retained object's recorded size and SHA-256 and confirms the same project/source membership still applies. It rechecks source membership and the full digest after the sidecar reaches a valid end of the declared point range. Processing code may treat a stream as complete only after that final check succeeds.
- A dedicated Rust sidecar stream actor owns one sequential LAS/LAZ reader per stream. It yields source-order chunks of at most 2,048 points, keeps at most one read request in flight, and checks cooperative cancellation between bounded reads. Sidecar job state and terminal retention are bounded.
- Each point carries its zero-based source index, scaled X/Y/Z, intensity, existing numeric class code, return number/count, scan angle, user data, point-source ID, and optional GPS time, RGB, and NIR when present in the supported point format. The stream identifies absent optional fields and states that LAS scale/offset has been applied but CRS, units, epoch, and vertical reference have not been interpreted. Extra Bytes, waveform payloads, and format flags not exposed by the pinned reader are disclosed as omitted; a tool requiring them must refuse the input.
- Chunks are returned only to trusted main-process callers. No preload method, renderer IPC route, generic sidecar call, file path, full-cloud JSON object, or ABI v1 project-data capability is added.
- The stream is read-only and does not persist derived data. Cancellation, decoding failure, count mismatch, project switch, source detachment, or integrity failure invalidates the stream; future output-writing work must use a separate derived artifact and provenance contract.
- This supports the reader's current LAS/LAZ version boundary only. It does not claim full LAS/LAZ conformance, COPC indexing, classifier correctness, output round-trip fidelity, or survey-grade results.

## Consequences

- A trusted extension coordinator can consume bounded chunks without copying a full cloud into renderer state or the ABI v1 preview. This ADR does not yet run a community module against those chunks.
- The source remains unchanged and can be reverified after processing. Any result is unusable until the coordinator receives verified stream completion.
- Chunk JSON remains bounded, but it incurs serialization cost. A later binary capability may be considered only with separate profiling and security review.
- Tools that depend on Extra Bytes, waveform packets, or unexposed flags cannot claim complete source access through this API.

## Verification required

- LAS and LAZ fixtures prove chunk order, source indices, scales/offsets, optional dimensions, bounded chunk size, EOF/count behavior, and no source mutation.
- Rust job tests prove cancellation, malformed input failure, one active stream, single in-flight reads, and bounded terminal retention.
- Main-controller tests use the production class with SQLite/content-addressed storage and a controlled sidecar to prove project/source scope, pre/post hash checks, project switching, cancellation, and that no path or point array is registered through renderer IPC.
- Rust and Desktop focused tests and typecheck pass. No Electron runtime, third-party producer, plugin execution, or field workflow is claimed unless exercised directly.
