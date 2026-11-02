# ADR-0017: Display project coordinate declarations in the persistent shell

**Status:** Accepted for visible project metadata
**Date:** 1 November 2026
**Supersedes:** None

## Context

ADR-0016 added project-level declarations for horizontal unit, coordinate epoch, and vertical reference. They were visible only in Projects, while the always-visible shell displayed the project name but no coordinate context. Surveyors can move between workflows without seeing that a reference value is absent, malformed, or merely user-declared.

## Decision

- Read the active project's existing persisted fields through the current `projects.list`/`projects.onChanged` bridge and display them in the shell status strip.
- Display the stored EPSG code exactly as a code. Do not resolve or relabel it as a verified CRS definition.
- Display horizontal unit, epoch, vertical kind/name/unit, and the fixed evidence state exactly as stored. Use explicit “not recorded” labels for absent values.
- Show malformed stored context as unreadable and requiring review. Do not parse or display partial values from an invalid declaration.
- Keep `user_declared_unverified` visible as such. Missing context remains incomplete; neither state is a coordinate operation or proof of accuracy.
- Do not add IPC privileges or alter computation, project persistence, transformations, exports, or source-specific context.

## Consequences

- The active project's project-level coordinate declaration state stays visible while the surveyor changes views.
- Legacy projects continue to show missing values rather than receiving inferred values.
- This is a display of project-level metadata only. It does not validate the CRS code, check unit consistency, express per-source contexts, or establish horizontal/vertical operations.

## Verification boundary

Pure formatting tests verify display labels for absent, invalid, and declared context; Desktop typecheck and renderer compilation verify integration. These checks do not prove live Electron rendering, data accuracy, CRS compatibility, or field use.

## Related decisions

- ADR-0003: global project CRS and durable local project store.
- ADR-0016: user-declared project coordinate context.
- ADR-0007: community extension ecosystem.
