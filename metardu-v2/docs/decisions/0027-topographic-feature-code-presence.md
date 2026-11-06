# ADR-0027: Derive topographic feature-code presence from project output

## Status

Accepted

## Context

The project-persisted Delivery QA profile records required feature classes, but an unlinked checklist cannot tell whether any matching coded points were included in the current topographic surface draft. The current `TopographicView` output retains point IDs and optional, project-local feature codes in its TIN vertices. These codes have no universal meaning and cannot establish that the corresponding feature was represented adequately.

## Decision

- Allow a feature requirement to list optional project/practice point codes. Match codes case-insensitively and do not ship an assumed country or equipment code dictionary.
- When the active project's latest output is from `TopographicView`, derive a bounded code count from the retained draft vertices. Do not persist the derived count in the delivery-review record; recompute it from the current project output so a changed draft cannot leave stale evidence.
- If a required feature has a code mapping, block delivery review when the current topographic code evidence is unavailable/invalid or none of the mapped codes appears in the saved draft.
- Keep the human feature review and evidence-reference requirement. A code match proves only that a coded vertex appears; it does not prove geometry, feature continuity, curve sampling, breakline enforcement, spatial coverage, accuracy, or field truth.
- An explicitly allowed, reasoned not-applicable decision remains eligible for surveyor review without source-code evidence.

## Consequences

- Delivery QA can expose and check the presence of project-coded features against the actual retained topographic draft.
- A project profile can make use of its practice's existing coding convention without prescribing one internationally.
- Feature completeness still needs method-specific geometric and spatial checks with project-defined criteria and representative data before METARDU can report those checks as performed.
