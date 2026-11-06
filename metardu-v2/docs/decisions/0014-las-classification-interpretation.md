# ADR-0014: Version-aware display of existing LAS class labels

**Status:** Accepted for point-cloud inspection display
**Date:** 1 November 2026
**Supersedes:** None

## Context

Point-cloud inspection already counts the numeric classification values stored in LAS/LAZ records. Showing only `Class 2` forces a surveyor to consult a separate table, while applying one table to every point format can silently assign the wrong meaning. LAS 1.4 keeps the legacy point formats 0-5 class table distinct from the modern formats 6-10 table. Some modern codes also depend on a domain profile or user-defined lookup description.

The LinkedIn prototype is a workflow example, not evidence about its own class schema or algorithm. METARDU needs to make stored labels easier to read without implying that it ran or validated a classification method.

## Decision

- Keep numeric class codes and counts as the primary source facts.
- For LAS 1.4 only, attach base ASPRS class meanings selected by point data record format: legacy formats 0-5 or modern formats 6-10. The mapping follows the published LAS 1.4 tables; the R16 release change summary reports clarifications but no class-table change from R15.
- For other LAS versions, keep base meanings uninterpreted until their exact version-specific tables are separately verified.
- Parse a `LASF_Spec`, record ID 0 Classification Lookup record only when exactly one record has the expected 4,096-byte payload, all 256 class numbers occur exactly once, and descriptions are printable ASCII. Display these values separately as source-provided descriptions. Ignore malformed or duplicate records and preserve the raw codes.
- Mark modern LAS 1.4 codes 39-63 as requiring a separately validated domain profile; codes 64-255 remain user-defined. METARDU does not identify or validate a domain profile in this slice.
- Interpretations describe the format's base vocabulary, not whether a producer assigned classes correctly. No point is changed, and no classifier or derived artifact is produced.

## Consequences

- Surveyors can read common LAS 1.4 class names directly in the inspection report.
- Legacy code 12 is displayed as Overlap Points while modern code 12 is reserved; selection by point format is mandatory.
- Older saved inspection reports remain readable and show their existing numeric fallback.
- Source lookup descriptions are untrusted metadata and are displayed separately from the base class meaning.
- Classification algorithms, domain-profile validation, class flags, and output writing remain separate product gates.

## References

- [ASPRS LAS 1.4 R15 specification](https://www.asprs.org/wp-content/uploads/2019/07/LAS_1_4_r15.pdf), legacy classification table and modern point-format class table.
- [ASPRS LAS releases](https://github.com/ASPRSorg/LAS/releases), official LAS 1.4 R16 change summary.
- ADR-0007 and ADR-0013.
