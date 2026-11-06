# TASK: Persist bounded community extension outputs with project provenance

## Goal

Let a surveyor explicitly run an installed local community extension and save its bounded JSON output as a Community / Draft artifact tied to the exact current project version. Preserve the artifact through the portable project bundle.

## Implemented

- Main-process run-and-save and project-artifact listing routes use strict IPC schemas.
- The host checks project version before and after extension execution, reloads the installed package by digest, validates JSON limits, and calculates input/output hashes.
- SQLite schema v8 stores immutable project-linked artifact metadata and JSON; the project limit is 32 MiB aggregate / 10,000 records.
- Bundle v2 includes artifacts and verifies JSON bounds, project links, and input/output digests. Bundle v1 remains accepted with an empty artifact collection.
- Extensions view displays saved records and output JSON while retaining the Community / Draft boundary.

## Limits and next gates

- This provides persistence and provenance for small JSON tools; it does not itself process point clouds or automate iO Geomatics' complete capture-to-delivery workflow.
- No feature geometry, curve sampling, breakline placement, coverage, control residual, accuracy, CAD/GIS/BIM receiving-app, statutory, or field QA is inferred from artifact presence or its hashes.
- Large LiDAR workflows still require a reviewed chunked brokered API, source-to-output provenance, and validated methods. Delivery files require their own content verification and receiving-system review before inclusion.
