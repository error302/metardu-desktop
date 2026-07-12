# ADR-005 — Country Pack Plugin Architecture

**Status:** Accepted
**Date:** 2025-07-11
**Decision Maker:** Software Architect agent
**Phase:** 0 (Initiation)

## Context

METARDU hardcodes 60 references to `EPSG:21037` (Kenya UTM 37S), the Kenyan
Form No. 4 deed plan, and the NLIMS/ArdhiSasa submission schema. To serve the
East African Community and beyond, country-specific functionality must be
pluggable.

## Decision

**A country pack is a versioned directory under
`country-packs/<ISO3>/` containing:**

```
country-packs/
├── KEN/                          # Kenya (v1.0)
│   ├── manifest.json             # Pack metadata, version, dependencies
│   ├── crs.json                  # EPSG codes, projections, datums
│   ├── deed-plan.html            # Handlebars template for Form No. 4
│   ├── submission-schema.json    # JSON Schema for NLIMS/ArdhiSasa
│   ├── regulations.md            # Machine-readable survey regulations
│   └── locale/
│       ├── en.json               # English (Kenya)
│       └── sw.json               # Swahili
├── TZA/                          # Tanzania (v1.1)
├── UGA/                          # Uganda (v1.1)
├── RWA/                          # Rwanda (v1.1)
├── BDI/                          # Burundi (v1.1)
└── USA/                          # United States PLSS (v2.0)
```

## Consequences

**Positive:**
- Every hardcoded EPSG reference must be replaced with a country-pack lookup.
- Adding a country is a documentation exercise, not a code change.
- Country packs can be signed and versioned independently of the core app.
- Surveyors can switch country packs when working across borders.

**Negative:**
- v1.0 must refactor all 60 hardcoded `EPSG:21037` references.
- Country packs must be loaded at app startup (not lazily) to avoid UI lag.
- We need a "country pack editor" UI in v1.1 for surveyors to define their
  own packs for unsupported countries.

**Country Pack Manifest Schema:**

```json
{
  "iso3": "KEN",
  "name": "Kenya",
  "version": "1.0.0",
  "defaultCrs": {
    "epsg": 21037,
    "name": "Arc 1960 / UTM zone 37S"
  },
  "datum": "Arc 1960",
  "regulatoryBody": "Survey of Kenya",
  "statutoryDocuments": ["form-no-4", "beacon-certificate", "mutation-form"],
  "submissionFormat": "NLIMS-JSON-1.0"
}
```

## Alternatives Considered

- **Hardcode Kenya only for v1.0**: Rejected because retrofitting a plugin
  architecture is harder than building it right the first time. The 60
  hardcoded references are technical debt that compounds.
- **Use a single `country-config.json`**: Rejected because country packs
  need to ship statutory document templates and locale files alongside the
  config — a single JSON file can't carry that.

## v1.0 Scope

Only `KEN` ships in v1.0. The architecture must be in place, but only one
pack is implemented. EAC packs (TZA, UGA, RWA, BDI) are v1.1.

## References

- METARDU Desktop Master Plan §5
- Survey of Kenya: https://www.survey.go.ke/
