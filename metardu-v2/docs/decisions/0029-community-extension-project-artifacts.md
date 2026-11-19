# ADR-0029: Persist bounded community extension results as project drafts

**Status:** Accepted for ABI v1 JSON artifacts
**Date:** 6 November 2026

## Context

METARDU's local community extension runner can consume an explicitly supplied bounded JSON snapshot, but previously returned only a preview. Surveyors need useful derived work to remain attached to its project and survive a handoff. A saved result also needs enough provenance to identify its input, package, module, and source project version.

## Decision

- Add an explicit **Run and save to active project** action for an installed package. Preview-only execution remains available.
- The main process validates the target project and expected version before execution, reloads the exact installed package by digest, executes it, validates bounded JSON input/output, computes SHA-256 digests, and persists a host-created artifact. It checks the project version again when saving; changed or deleted projects reject the result.
- Each artifact records the exact canonical input and output JSON, project identity/version, creation time, plugin ID/version/name and publisher/licence claims, package and module digests, input and output digests, and the immutable `community-draft` trust state. Publisher and licence strings are claims, not authentication.
- Community artifacts are read-only records in the project database. Extensions receive no database, project, source-file, point-cloud, network, or instrument capability. A project input snapshot remains explicit and user-selected.
- Project bundle format v2 includes project-linked community artifacts and validates their JSON bounds, project links, and recorded digests. Existing v1 bundles remain importable and restore with no community artifacts.
- Bound each extension input and output to the ABI v1 limit (4 MiB, 64 levels, and 100,000 JSON values). Bound aggregate saved community JSON per project to 32 MiB and artifact count to 10,000 so a project remains portable.

## Consequences

- Small JSON-based community tools can leave a traceable, portable draft result in the project for surveyor review.
- A digest proves byte identity for the saved JSON/package/module; it does not prove a surveying method, coordinate interpretation, completeness, accuracy, legality, or professional acceptance.
- The current ABI still cannot stream LAS/LAZ/COPC or process large point clouds. Large-data tools need a separate reviewed brokered dataset API, cancellation/resource policy, source-to-output provenance, and method validation.
- These artifacts are not automatically included in client deliverables and cannot promote themselves beyond Community / Draft.
