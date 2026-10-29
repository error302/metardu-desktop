# ADR-0006: Topographic Delaunay triangulation in the Rust sidecar

**Status:** Accepted 29 Oct 2026
**Decision owner:** METARDU Desktop product owner
**Scope:** Draft topographic TIN construction

## Context

The project-referenced topographic draft currently constructs triangles in
TypeScript by testing every point triple against every other point. That
routine is O(n^4), uses a coordinate rounding key to discard nearby points,
and is capped at 100 input points. It cannot be the desktop's general-purpose
surface engine. The repository architecture assigns numerically sensitive
surface computation to the Rust sidecar (ADR-0001 and invariant A1).

## Decision

Implement planar Delaunay triangulation in the Rust sidecar using Spade's
robust-predicate implementation. Add one explicit `topographic.build_tin`
method to the existing renderer sidecar-method allowlist. Its input is a
bounded array of finite planar coordinate triples with stable point order;
its output is triangle indices into that exact input order. It receives no
file paths, network access, CRS definitions, or other capabilities.

The handler rejects fewer than three points, non-finite coordinates,
duplicate horizontal positions, collinear sets, and inputs over the
documented resource limit. It does not round or silently discard survey
points. The engine and renderer retain the original point records and use the
returned index triples to assemble a draft surface.

This operation is planar only. It does not transform coordinates, validate
CRS area of use, establish units or height datum, adjust observations,
estimate uncertainty, or make a surface suitable for statutory or field
decisions. Those states remain explicit in the project and draft output.

## Security and architecture

- The renderer invokes only `topographic.build_tin`, added deliberately to
  `apps/desktop/src/preload/index.ts`.
- The sidecar validates the payload independently; the preload schema also
  checks shape and resource bounds.
- No new filesystem, network, shell, or generic IPC capability is exposed.
- Country-specific tolerances and legal outputs remain outside this method.

## Verification required

Tests cover known triangle counts, stable output for cocircular input,
near-collinear finite geometry, duplicate/collinear/non-finite rejection,
input-index preservation, and a 10,000-point stress fixture. The desktop
must use this sidecar result; no production TypeScript triangulator remains.

## References

- `docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- `docs/decisions/0003-contextbridge-allowlist.md`
- `docs/invariants.md` A1, A4, A5, E1-E4
- [Spade API documentation](https://docs.rs/spade/latest/spade/)
- [Spade source and license](https://github.com/Stoeoef/spade)
