# TASK: Pass a bounded saved project output snapshot to a local community extension

## Context

ABI v1 accepts explicitly supplied bounded JSON, has no Wasm imports, and returns Community / Draft JSON. Enable the user to seed that existing input from the active project's saved workflow output without granting a live project capability.

## Scope

- Add a typed shared validator for bounded community-plugin JSON so renderer preflight and IPC use the same 4 MiB, 64-level, and 100,000-value contract.
- Add a pure country-neutral wrapper builder for the active project's saved output and explicitly declared coordinate context.
- Add a clear Extensions-view action with whole-input rejection on invalid or oversized data, non-default input replacement confirmation, and stale-snapshot indication.
- Document the wrapper, exclusions, and remaining large-data/persistence gates.

## Constraints

- Do not include the project name/ID, linked source paths/bytes, or source point-cloud bytes.
- Do not add Wasm imports or grant filesystem, network, project-store, database, or instrument access.
- Do not infer that declared CRS metadata is validated or that a plugin result is accurate, approved, or suitable for delivery.
- Do not persist plugin output or make LiDAR classification claims in this slice.

## Verification

- Focused tests cover snapshot metadata, declared/invalid/missing coordinate context, missing output, and bounded JSON rejection.
- Run renderer typecheck/build and the focused schema/renderer tests; preserve unrelated worktree changes and commit only task-owned paths.

## Next gates

Large point clouds require a reviewed chunked host-brokered data API, bounded cancellation/resource policy, output dataset storage, exact source/output provenance, and independent method validation. Community JSON results still need durable, project-linked artifact storage before they can participate in coordinated delivery.
