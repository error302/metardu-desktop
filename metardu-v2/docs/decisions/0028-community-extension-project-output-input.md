# ADR-0028: Explicit bounded project output input for community extensions

**Status:** Accepted for ABI v1 local preview
**Date:** 6 November 2026

## Context

The local Wasm runtime can process only user-supplied bounded JSON and has no host imports. The Extensions view's hand-authored JSON field leaves community tools disconnected from saved survey workflows, although small survey outputs can fit the existing v1 limit.

## Decision

- Add a surveyor-invoked action that copies the active project's current saved workflow output into the existing JSON input field; confirm when it will replace non-default input.
- Wrap the snapshot as `metardu-project-output-input/v1`, including survey type, source view, declared country code, declared horizontal CRS code, declared coordinate context, and an explicit coordinate-context state.
- Exclude the project name and ID, linked source files, point-cloud bytes, and every other live project capability. The snapshot is held in renderer input state and passed to a plugin only when the surveyor explicitly executes that tool.
- Preserve the ABI v1 JSON bounds: 4 MiB serialized size, 64 levels, and 100,000 values. Reject unbounded or non-JSON data without truncation.
- Keep coordinate context visibly declared/unverified, keep plugin output Community / Draft, and do not persist plugin output as a project artifact in this slice.

## Consequences

- Community tools can work on small saved workflow outputs without new Wasm imports or privileged IPC capabilities.
- The input snapshot does not update if the project changes. The UI keeps a local project ID/version association for a stale-snapshot notice, and manual edits clear that association; the project ID is not sent to the extension.
- This does not enable LiDAR classification or other large binary workflows. Chunked host-brokered datasets and durable derived project artifacts remain required gates.

## Verification

- Unit coverage validates the wrapper, declaration state, absent output, invalid JSON, and oversize rejection.
- The existing IPC schema remains the enforcement boundary for all extension input and preserves its size/depth/node-count limits.
