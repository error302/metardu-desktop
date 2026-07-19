# ADR-0004: Kenya as the reference implementation for country-config

**Status:** Accepted
**Date:** 19 Jul 2026
**Supersedes:** None
**Superseded by:** None

## Context

Master plan Section 4 calls for a `CountrySurveyConfig` abstraction
before a second country's logic is written. The abstraction needs to be
proven against one real country first — retrofitting it after Kenya-only
code exists is exactly the kind of rework that burns agent context.

## Decision

Port Kenya into `packages/country-config/` as the reference
implementation. Zero behavior change from the current Kenya-specific
logic; the abstraction is proven by the absence of behavior change.

Kenya config will include (per master plan Section 4.1):
- `countryCode: "KE"`
- `geodeticFramework: { datum: "Arc 1960", primarySRID: 21037, ... }`
- `toleranceTable: [...]` — 10√K mm levelling, 3.0″ angular misclosure, etc.
- `statutoryDocuments: [...]` — Form 3, Form 4, Beacon Certificate
- `professionalBody: { ... }` — ISK registration
- `sectionalPropertyRegime: { ... }` — Sectional Properties Act 2020
- `sourceDocsRequired: [...]` — checklist gate

## Rationale

- **Kenya is best-documented.** Mohammed's existing work has the LSB
  Topographical Survey Guidelines, RDM 1.1 (2025), Survey Act Cap 299,
  Kenya Survey Regulations 1994 already internalized.
- **Kenya has the tightest regulatory loop.** Form 3 is the highest-
  priority missing document. Building country-config around Kenya
  unblocks the most important downstream work.
- **Kenya exercises the legacy-datum path.** Arc 1960 → WGS84 via
  Helmert transformation is the same machinery South Africa's Cape →
  Hartebeesthoek94 will need. Building it for Kenya first proves the
  abstraction handles legacy-to-modern re-establishment generally.

## Alternatives considered

- **Australia first.** Rejected: GDA2020 is well-defined nationally but
  state-fragmented statutorily. Kenya's cleaner regulatory loop is a
  better first proof.
- **Two countries at once.** Rejected: master plan Section 9 explicitly
  warns against parallelizing across countries before the abstraction
  is proven.
- **Build country-config without a reference country.** Rejected:
  abstracting from zero examples produces Java-style over-engineering
  that doesn't fit any real country. One real example first.

## Consequences

- Kenya-specific constants (SRID 21037, 10√K mm, 3.0″, etc.) move from
  scattered engine code into one config object. This is a behavior-
  preserving refactor; tests must still pass.
- A second country's addition (likely Australia-NSW or South Africa)
  becomes "implement `country-config/<country>.ts` against the attached
  regulations," not "rebuild the cadastral module."
- The country-config package is a hard dependency of every workflow
  module. Workflow code reads tolerances/SRIDs/document specs ONLY
  through this config layer.

## Verification (Phase 5)

- `packages/country-config/` exists with `kenya.ts` implementing the
  full `CountrySurveyConfig` interface.
- Every Kenya-specific constant in `packages/engine/` has been replaced
  with a read from the config object.
- All 343 engine tests still pass (zero behavior change).
- New unit tests in `packages/country-config/` verify the Kenya config
  values against the source documents cited in
  `docs/regulatory-sources/kenya/`.
