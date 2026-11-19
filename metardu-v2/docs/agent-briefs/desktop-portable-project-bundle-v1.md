# TASK: Export and restore a portable METARDU survey project bundle

## Task ID
desktop-portable-project-bundle-v1

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] Relevant ADRs:
  - [x] `metardu-v2/docs/decisions/0007-community-extension-ecosystem.md`
  - [x] `metardu-v2/docs/decisions/0008-pointcloud-source-store.md`
  - [x] `metardu-v2/docs/decisions/0013-pointcloud-host-managed-chunks.md`
  - [x] `metardu-v2/docs/decisions/0019-pointcloud-source-coordinate-context.md`
- [x] Regulatory sources: none required; this task is country-agnostic and does not render a statutory output.
- [x] Most recent worklog entries (last 3+).
- [x] The plan names `upload/METARDU-DESKTOP-MASTER-PLAN.md`, but that file is absent in the current checkout; use the current international product plan and invariants and record this limit.

## Required audit before writing code
- `metardu-v2/apps/desktop/src/main/database.ts` — preserve exact project fields, source rows, coordinate declarations, and all inspection history.
- `metardu-v2/apps/desktop/src/main/point-cloud-store.ts` — reuse content-addressed storage and stream/hash behavior without exposing paths through IPC.
- `metardu-v2/apps/desktop/src/main/projects.ts` and `src/preload/index.ts` — add only typed, validated, native-dialog bundle operations.
- `metardu-v2/apps/desktop/src/renderer/views/ProjectsPanel.tsx` — add export/restore controls without implying CRS verification or statutory acceptance.
- `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md` — update the recovery gate and scope limits.

## Hard constraints
- The renderer never supplies filesystem paths or receives database/object-store paths.
- Project bundles preserve raw source bytes and stored project evidence; they do not interpret or transform coordinates.
- Stream large point-cloud files with bounded memory and verify exact size and SHA-256 before publishing or restoring.
- Validate the bundle manifest, exact package members, and all hashes before adding a project row. Failed imports create no partial project. Do not delete existing content-addressed objects during recovery cleanup.
- Restored project and point-cloud IDs are local identities; preserve all surveying data and source/inspection provenance while linking records to the new project.
- Keep local data offline-first. No cloud upload or subscription check is added.
- Preserve unrelated staged and untracked work; commit only task-owned files to the Desktop repository.

## Acceptance criteria

### Format and behavior
- [x] A versioned `.mdp` folder bundle contains the complete persisted project row, linked LAS/LAZ source bytes, source coordinate declarations, and all point-cloud inspection rows.
- [x] Export streams files, verifies source digest and size, uses an incomplete staging directory, and publishes the bundle only after a stable project/source snapshot is confirmed.
- [x] Restore rejects malformed, incomplete, extra-member, symlink, traversal, size-mismatch, and hash-mismatch bundles before any project is created.
- [x] Restore publishes verified source bytes to the managed content-addressed store and inserts the project, sources, and inspections in one SQLite transaction as a new local project.
- [x] Native dialogs choose locations. Renderer IPC accepts identifiers only; progress and cancellation are bounded and scoped to one operation.
- [x] Export/restore do not modify original files or existing project records.

### Verification
- [x] Focused bundle and SQLite tests prove round-trip preservation, stream verification, cancellation/cleanup, malformed bundle rejection, and all-or-nothing database restore.
- [x] Desktop TypeScript build and full Desktop unit suite pass.
- [x] Preload types and the renderer production build pass, and `git diff --check` passes. The full renderer TypeScript check passed after small timer/status narrowing fixes in `PointCloudView.tsx`.
- [x] Attempt the Electron smoke gate required for main/preload changes; `scripts/electron-smoke.sh` is absent from this checkout, so no native Electron runtime smoke was run.

### Documentation and delivery
- [x] Update the international plan with bundle scope and explicit exclusions.
- [x] Append actual verification output and evidence limits to root `worklog.md`.
- [ ] Commit task-owned files only, push to `https://github.com/error302/metardu-desktop.git`, and verify the configured branch tip.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Out of scope
- Uploading project bundles to METARDU Web or any network service.
- Portable reference grids, instrument profiles, community plugins, credentials, and app settings.
- Any CRS interpretation, coordinate transformation, adjustment, classification, legal acceptance, or statutory rendering.
- Encryption or digital signatures; v1 checks corruption and byte identity, not publisher identity or confidentiality.
