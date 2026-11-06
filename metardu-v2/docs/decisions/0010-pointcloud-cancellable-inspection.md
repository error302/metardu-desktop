# ADR-0010: Cancellable project-scoped point-cloud inspection jobs

**Status:** Accepted for the record-inspection job slice
**Date:** 29 October 2026
**Supersedes:** The synchronous inspection call in ADR-0009; source scope, evidence and trust boundaries remain unchanged.

## Context

ADR-0009 provides a project-scoped read-only LAS/LAZ record scan. It verifies the stored source before and after decoding and stores a digest-bound report. The scan currently runs as one blocking sidecar request with no progress or cancellation. A request timeout only stops waiting in Electron; it does not stop sidecar work. This is unsuitable for large international survey datasets and blocks the next host-managed point-cloud processing work.

## Decision

- Replace the Desktop scan interaction with dedicated start, status, and cancel IPC methods. Main resolves the source ID against the active project and sends the private managed path only to the sidecar.
- The sidecar starts one bounded-batch scan in a background blocking task and retains a bounded job record containing only the progress counters, cancellation token, terminal status, and compact inspection report or failure text.
- Main and renderer poll compact status; no point records, filesystem path, or storage key crosses the preload boundary. The renderer cannot invoke the generic sidecar RPC methods for a path-bearing point-cloud operation.
- Cancellation is cooperative between existing bounded decode batches. A completed batch may still be processed before the job stops. Cancellation, failure, a changed active project, or a source digest mismatch yields no saved inspection report.
- Main verifies the source digest before starting and after successful completion. It persists a report once only after the project and digest checks pass.
- Only one record scan runs at a time. Job count and terminal retention are bounded; unknown, expired, or malformed job IDs are rejected.
- The existing synchronous Rust inspection entrypoint may remain for trusted sidecar tests/internal compatibility, but the Desktop UI uses the job contract.

## Consequences

- Surveyors can see scan progress and cancel long LAS/LAZ reads without treating a client timeout as cancellation.
- Progress is an estimate against the source-declared point count; it is not proof that the header count or records are valid. The final inspection continues to report count mismatches.
- Cancellation can take up to one bounded batch plus current batch processing to take effect.
- The job contract is not a point-stream API for community modules. Large point arrays remain out of ABI v1 JSON; chunk access requires a separate capability design and ADR.
- The scan and report remain local to the active Desktop installation; portability, full-file conformance, CRS interpretation, classification, and survey-output validation remain unresolved.

## Security and evidence boundary

The renderer can start a scan only by a source ID, then poll or cancel an app-issued job ID. Main checks IDs and project ownership, controls the managed object path, and revalidates the exact source digest before persisting. Sidecar job state is in-memory and bounded; a sidecar restart invalidates unfinished jobs and produces no report. No network access or renderer privilege is added.

## Verification required

- Rust tests cover progress, cooperative cancellation, job status transitions, duplicate-active-job rejection, and bounded/expired job state.
- `point-cloud-inspection-controller.test.ts` exercises the production dedicated IPC route binder and controller with real SQLite and content-addressed object storage plus a controlled sidecar double. It covers project/source scoping, hash verification before and after, changed-source and changed-project behavior, cancellation/completion races, malformed identifiers, progress, failure, and one-time persistence. These tests do not launch Electron.
- Typecheck/build and focused tests pass. The existing Electron-to-sidecar round-trip suite is skipped when the release sidecar binary is absent; an Electron IPC smoke is recorded only if the harness exists and actually launches the app.
