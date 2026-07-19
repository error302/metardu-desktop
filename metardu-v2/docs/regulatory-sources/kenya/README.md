# Kenya Regulatory Source Documents

This directory holds the primary regulatory documents that govern
surveying work in Kenya. **Per master plan Section 3 invariant B1, no
statutory document renderer may be built until its source document
exists here AND every layout decision in the renderer cites the
specific page/clause.**

## Directory structure

```
kenya/
├── cadastral/    — Survey Act Cap. 299, cadastral survey guidelines
├── general/      — Land Survey Handbook (covers all survey types)
├── reference/    — International standards + sample reports (informative, not normative)
└── sectional/    — Sectional Properties Act 2020 (pending)
```

## Filed documents (19 Jul 2026)

### cadastral/

| File | Source | Size | Status |
|------|--------|------|--------|
| cadastral-survey-guidelines.pdf | User-supplied | 3.5 MB | Cadastral survey methodology |
| annex-6-cadastral-survey-and-aerial-mapping.pdf | User-supplied | 126 KB | Annex on aerial mapping for cadastral work |

### general/

| File | Source | Size | Status |
|------|--------|------|--------|
| land-survey-handbook.pdf | User-supplied | 6.0 MB | General land survey reference |

### reference/ (informative — not Kenya statutory)

| File | Source | Size | Status |
|------|--------|------|--------|
| lochab-site-usa-report.pdf | User-supplied | 2.2 MB | Sample land survey report (USA site) |
| accuracy-standards-introduction.pdf | User-supplied | 1.1 MB | General introduction to accuracy standards |
| measured-surveys-rics.pdf | User-supplied | 2.7 MB | RICS measured surveys specification (UK reference) |
| biva-topographic-report.pdf | User-supplied | 12.8 MB | Sample topographic survey report |

## Documents still outstanding (per master plan Section 8.1)

The following are cited in `packages/country-config/src/countries/kenya.ts`
as `sourceDocsRequired` but NOT yet filed here. The user must supply
them before the corresponding renderer can be built:

1. **Survey Act Cap. 299 (Laws of Kenya)** — the actual Act text,
   not a summary. Needed for Form 3 / Form 4 / Beacon Certificate
   renderers (Phase 6).
2. **Kenya Survey Regulations 1994** — the full regulations document,
   not excerpts. Tolerance values are sourced from this; we currently
   rely on cited page numbers but the PDF itself is missing.
3. **RDM 1.1 (2025) — Kenya Roads Design Manual** — needed for the
   engineering surveying workflow (future phase).
4. **Sectional Properties Act 2020** — needed for the sectional title
   renderer (future phase).
5. **LSB Topographical Survey Guidelines** — needed for the
   topographic survey renderer (future phase).
6. **ISK Code of Ethics** — informational; needed before any
   professional-body verification feature.

## How to add a document

1. Drop the PDF (or scan) into the appropriate subdirectory.
2. Update the table above with file name, source, size, and what it covers.
3. If the document enables a new statutory renderer, update the
   corresponding `sourceDocsRequired` checklist entry in
   `packages/country-config/src/countries/kenya.ts`.
4. Cite the document in the renderer's spec doc (e.g.
   `cadastral/form-3-spec.md`) for every layout decision per invariant B2.

## Why this matters

> A plausible-looking wrong plan is worse than an obvious blocker,
> because it fails silently at the lodging authority months later.
> — Master plan Section 3, invariant B1

Every number on a Form 3, every field in the title block, every
margin, every certification phrase — they all have a specific source
in the regulation. Without the source document filed, we cannot cite
the page/clause, and without the citation, the renderer is not
compliant.
