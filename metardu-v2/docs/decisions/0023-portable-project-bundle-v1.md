# ADR-0023: Portable project bundle v1

**Status:** Accepted for recovery and project transfer
**Date:** 3 November 2026
**Supersedes:** None

## Context

METARDU Desktop persists a project row and its workflow output in SQLite. LAS/LAZ sources are stored separately as content-addressed objects, with source-specific coordinate declarations and record-inspection reports in SQLite. A copied database alone is not a portable project, and a source row without its exact object bytes cannot be recovered or processed. Deleting a project detaches the metadata but deliberately leaves the point-cloud object in place.

## Decision

- Export one project as a directory bundle with a versioned `manifest.json` and hash-named `sources/` files. This avoids loading large LAS/LAZ sources into memory and requires no platform-specific archive utility.
- The manifest preserves the raw persisted project row, source rows, source coordinate declaration text, and all point-cloud inspection records. Paths are derived from a validated content digest and LAS/LAZ extension; no manifest value is used as an arbitrary filesystem path.
- Export writes into a unique sibling staging directory, streams every source while recomputing its SHA-256 and size, and publishes only after the project/source/inspection snapshot still matches the snapshot captured at start. Any failure removes only the incomplete staging directory.
- Restore accepts a directory selected through the native file picker. It requires the exact v1 member set, regular non-symlink files, a valid manifest, and matching source sizes and SHA-256 values. It stages and publishes the verified bytes into the existing content-addressed store, then inserts a new project and all linked source/inspection rows in a single SQLite transaction.
- Restores receive new local project/source/inspection identities to avoid replacing existing projects. Survey values, stored JSON, coordinate declarations, source bytes, timestamps, and inspection provenance are preserved. The restored project becomes active, matching normal project creation behavior.
- Import and export use trusted main-process dialogs; renderer IPC receives identifiers only. Operations expose bounded progress and cancellation. Cancelled or failed restores create no project; verified content-addressed objects already published are retained as harmless orphans rather than deleted.
- V1 covers the data currently persisted by the Desktop project and point-cloud tables. Future project-linked assets must be added to the bundle format before they can be described as portable.

## Consequences

- Surveyors can move a project and its current LAS/LAZ source set between Desktop installations without relying on a cloud connection. Imported projects remain separate local workspaces.
- Export rechecks project metadata and source bytes while copying. If any metadata or source changes during the operation, no final bundle is published.
- Restore does not trust paths, IDs, CRS declarations, inspection claims, or hashes merely because they came from a bundle; identities are remapped and bytes are recomputed before the project is inserted.
- Bundles are not encrypted or signed. They can disclose survey data to anyone who can access the folder, and a valid hash proves byte consistency only—not CRS correctness, source classification, positional accuracy, or professional acceptance.
- App preferences, installed extensions, settings, reference grids, instrument profiles, and data outside the current project schema are not included.

## Verification

- Streamed folder export/import tests use bounded fixtures and prove project/source/inspection round-trip, content hashes, and the no-partial-project rule.
- Malformed, extra-member, symlink, traversal, truncated, and modified-source bundles fail closed.
- SQLite tests prove imported rows are atomic, new local IDs are used, source hashes remain exact, and pre-existing projects and objects remain unchanged.
- Type checks and Desktop unit tests cover the typed renderer/preload/main path. A UI test does not replace an Electron runtime smoke test.
