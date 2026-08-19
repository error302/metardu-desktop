# TASK: File regulatory source documents for the 6 countries whose tolerance tables lack them (B1 compliance)

## Task ID
regulatory-sources-filing-6-countries

## Context the agent must read first
- [ ] AGENT.md — invariant **B1**: "Do not invent/guess regulatory formats or tolerances. The source document must be filed in `docs/regulatory-sources/<country>/<doc-type>/` before a tolerance is encoded."
- [ ] docs/invariants.md
- [ ] This brief's "Current state" section.
- [ ] `packages/country-config/src/countries/*.ts` — the existing (currently unverified) tolerance tables.

### Current state (verified 2026-08-14)
`docs/regulatory-sources/` contains folders ONLY for `bahrain/` and `kenya/`. The other six country configs already encode tolerance tables but their source documents are **not filed**, which violates B1:
- `germany.ts` — cites "AdV accuracy-class practice", "DVW", "German traverse practice", "DHDN↔ETRS89 (NTV2)", "WEG §7". **Not filed.**
- `ghana.ts` — every `source:` string already ends with "pending filing per invariant B1". **Explicitly flagged, not filed.**
- `united-kingdom.ts` — cites RICS Measured Surveys 3rd ed., BS 7334-2:1990, Land Registration Act 2002 s.60, OSTN15, Commonhold Act 2002 s.24. **Not filed.**
- `united-states.ts` — cites ALTA/NSPS Land Title Survey 2021, FGCS Geospatial Positioning Accuracy Standards (1998), NADCON, state condominium acts. **Not filed.**
- `south-africa.ts` — cites SANS 2814 (Classes A/AA/B), Land Survey Act 8 of 1997 Regs 9/16, Chief Surveyor-General directives, Hartebeesthoek94. **Not filed.**
- `united-arab-emirates.ts` — cites Dubai Municipality Survey Dept specs, Dubai Land Dept submission requirements, Law No. 6 of 2019 Art. 9. **Not filed.**
- `australia.ts` — cites ICSM SP1 v2.2, NSW LRS Deposited Plan Requirements, GDA94↔GDA2020 (EPSG::8048), Strata Schemes Development Act 2015 (NSW) s.26. **Not filed.**

Because the documents are missing, the encoded tolerances for these six countries are **unverified** and must not be relied upon for statutory output until reconciled against filed sources.

## Required audit before writing code
For each country below, paste verbatim the tolerance table entries (and their `source:` strings) from the corresponding `countries/<country>.ts` file, grouped by `surveyType` / `toleranceType`, so the reconciliation step has a precise before/after.

## Hard constraints
- **B1 is non-negotiable.** No tolerance value may be added, changed, or presented as authoritative for these countries unless its source document is physically present under `docs/regulatory-sources/<country>/<doc-type>/`.
- Country-agnostic code (the adjustment engine, plan-checker logic) is fine; only *numeric tolerance values and their citations* are gated.
- Do not "paper over" the gap by deleting the tables — that would remove functionality. Either file the source and verify, or (if a source cannot be obtained) mark the country `status: "draft"` / `verified: false` in its config and surface that in the UI, but never silently ship unverified statutory tolerances.

## The work, per country
For each of the 6 countries, in its own scoped sub-PR (do NOT bundle all six into one PR):

1. **Obtain** the cited primary standard (prefer the official/authoritative PDF or webpage; for paywalled standards, file the publisher's publicly available summary/scope page and note the limitation).
2. **File** it under `docs/regulatory-sources/<country>/<doc-type>/` (e.g. `united-kingdom/measured-surveys/rics-measured-surveys-3rd-ed.md` or the raw PDF). Use the `bahrain/` and `kenya/` folders as the structural template.
3. **Reconcile** every tolerance table entry in `countries/<country>.ts` against the filed document:
   - If the encoded value matches the source → set/confirm `verified: true` and keep the `source:` pointer.
   - If it diverges → correct the value to the source, update `source:`, and add a brief note.
   - If a needed category is absent from the source → remove or clearly mark it `verified: false`.
4. **Add a guard test** (extend `packages/country-config/src/tests/*.test.ts`) asserting that for a `verified: true` country, every tolerance `source:` resolves to a file under `docs/regulatory-sources/`. This makes future B1 regressions a test failure.

## Acceptance criteria (independently verifiable)
- [ ] For each country, `docs/regulatory-sources/<country>/` exists with at least the documents cited by its config `source:` strings.
- [ ] `npm test --workspace=@metardu/country-config` passes, including a new test that fails if any `verified: true` tolerance's `source:` file is missing.
- [ ] `npx tsc --noEmit` in `packages/country-config/` and `packages/engine/` and `apps/desktop/` — empty output.
- [ ] Each reconciled country's config carries `verified: true` (or, if a source was unavailable, `verified: false` with a UI-visible warning — never `verified: true` without a filed doc).

## Anti-hallucination clause (verbatim, every brief)
> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement
On completion of each sub-PR, append (do not overwrite) an entry to `worklog.md` noting which country was reconciled, which documents were filed (paths), and any values corrected.

## Out of scope (explicit)
- Kenya and Bahrain: already filed — do not re-do.
- New tolerance *categories* beyond what the filed sources justify.
- Any Rust/TypeScript engine logic changes (this is a data/evidence task only).
- Signed installer / Windows code-signing (separate track).
