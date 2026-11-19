# ADR-0026: Persist project delivery profiles and review records

## Status

Accepted

## Context

Survey deliverables vary by client, project, recipient, and jurisdiction. A global desktop application needs to help practices capture those requirements without inventing national feature codes, tolerances, legal formats, or survey conclusions. The engine has a country-neutral completeness evaluator, but an in-memory evaluator alone cannot support durable project QA.

## Decision

- Store a bounded, versioned-by-schema delivery profile and its reference, feature-review, QA, and expected-artifact records with each project in SQLite.
- Validate project updates, portable project bundles, and persisted review records against the shared strict IPC schema. Keep the new bundle field optional so existing project bundle snapshots remain readable.
- Expose a Delivery QA workspace with editable starter prompts for common topographic/corridor, measured-building, UAV, river/bathymetry, and underground-utility projects. Starters are checklists only and remain editable for the client brief and local practice.
- Preserve explicit missing, declared, and surveyor-reviewed reference states. A saved corrupt review is shown as invalid and cannot be treated as complete.
- Stop successful readiness at “ready for surveyor review.” Never infer accuracy, legal sufficiency, statutory acceptance, or professional approval from checklist completion.

## Consequences

- A practice can retain project-specific deliverable intent and review decisions across application restarts and portable project export/restore.
- New generic starters lower setup effort while leaving standards and acceptance decisions with the responsible surveyor and client.
- This record does not inspect survey geometry or spatial coverage, calculate residuals, generate every named deliverable, read files to verify their bytes, or create an issue manifest. Each requires its own validated workflow and evidence.
- Project database schema version 7 adds a nullable delivery-review column. Older projects and bundle snapshots migrate/load without a delivery profile.
