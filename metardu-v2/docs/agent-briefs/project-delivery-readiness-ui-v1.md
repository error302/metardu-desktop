# TASK: Persist and expose project delivery readiness

## Task ID

project-delivery-readiness-ui-v1

## Purpose

Give a survey practice a durable, country-neutral place to define the client's required survey deliverables and record completeness/QA evidence before a named surveyor reviews the package. Support common job shapes without claiming that a generic template is a jurisdictional standard or that METARDU generated the files.

## Implemented scope

- Strict shared schema for profile requirements, coordinate-reference declarations, feature-review records, QA records, and expected output artifacts.
- Project SQLite schema v7 persistence, validated project update IPC, and backward-compatible optional inclusion in portable `.mdp` project bundles.
- Visible Delivery QA view with editable starter checklists for topographic/corridor, measured building, UAV mapping, river/bathymetry, and underground utilities.
- Explicit profile, reference, feature, QA, and output review states. Corrupt saved records fail closed. The evaluator's highest state is `ready-for-surveyor-review`.

## Non-goals and limits

- Do not prescribe country-specific tolerances, feature codes, legal formats, or minimum capture density.
- Do not state that a template means a particular output format is supported or generated.
- Do not claim geometry/coverage inspection, accuracy calculation, output-byte hash verification, statutory compliance, or professional sign-off.
- The current screen records filenames and declared hashes only; it does not select or read files and does not produce an issue manifest.

## Next production gates

1. Bind requirements to actual project sources and validated computation outputs with provenance.
2. Add measurable, method-specific checks for coverage, breaklines, control residuals, topology, and delivery files, each with named acceptance evidence and representative fixtures.
3. Build a coordinated package manifest that hashes the actual included bytes and records CRS/vertical context, versions, warnings, and reviewer decisions.
4. Validate CAD/GIS/BIM receiving-application round trips, native Electron interaction, real survey datasets, and professional review before making field or survey-grade claims.
