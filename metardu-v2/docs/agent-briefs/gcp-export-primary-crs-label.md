# TASK: Label GCP exports from the configured primary CRS

## Task ID
gcp-export-primary-crs-label

## Context the agent must read first
- [x] `AGENT.md`
- [x] `metardu-v2/docs/invariants.md`
- [x] `metardu-v2/docs/decisions/0004-kenya-as-reference-country.md`
- [x] No statutory renderer is changed; the country CRS profile is the source.
- [x] Recent root `worklog.md` entries.

## Required audit before writing code
- `metardu-v2/packages/engine/src/integration/gcp-export.ts` — EPSG and display-name selection.
- `metardu-v2/packages/country-config/src/countries/kenya.ts` — primary SRID and zone records.
- `metardu-v2/packages/engine/src/integration/tests/gcp-export.test.ts` — expected exported CRS labels.

## Hard constraints
- The CRS URN and human-readable zone must resolve from the same SRID.
- Do not infer the primary CRS from array position.
- Do not change coordinate values or transformation behavior.

## Acceptance criteria
- [x] GCP export zone display name matches the configured primary SRID.
- [x] Focused exporter tests pass and the result is recorded verbatim in `worklog.md`.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

Append the verification output and exact remaining blockers to `worklog.md`.

## Out of scope
- Changing country configuration data or CRS transformations.
- Modifying other exporter format contracts.
