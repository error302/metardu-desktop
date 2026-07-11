# ADR-002 — Local Data Store: SQLite + SpatiaLite

**Status:** Accepted
**Date:** 2025-07-11
**Decision Maker:** Software Architect agent
**Phase:** 0 (Initiation)

## Context

METARDU runs on PostgreSQL 15 with PostGIS, with 47 migrations defining 106
tables. The desktop app needs a zero-install embedded store that survives
offline field use and supports spatial queries.

## Decision

**Adopt SQLite 3 with the SpatiaLite extension.**

## Consequences

**Positive:**
- Zero install, ~5 MB overhead, no server process.
- Single-file database that ships with the project file (.metardu file = .sqlite).
- Excellent offline support — surveyors in the field have no network.
- Native Node binding via `better-sqlite3` (synchronous, fast, thread-safe).
- SpatiaLite provides every PostGIS function we need for surveying workflows.

**Negative:**
- We must port 47 PG migrations to SQLite syntax (mostly type renames).
- No concurrent multi-user write access (acceptable — desktop is single-user).
- SpatiaLite's geometry column handling is slightly different from PostGIS.

**Migration rules (PG → SQLite):**
- `serial` / `bigserial` → `integer primary key autoincrement`
- `timestamptz` → `text` (ISO-8601 with timezone offset)
- `jsonb` → `text` (with `json_extract()` for queries)
- `geometry(Point, 4326)` → `geometry(Point, 4326)` (SpatiaLite native)
- `gen_random_uuid()` → application-generated UUIDs
- `LISTEN` / `NOTIFY` → not needed (single-process)

## Alternatives Considered

- **Embedded PostgreSQL**: Zero porting of SQL, but ships a 50 MB server binary
  and requires service management + initdb on first run. Rejected as too heavy.
- **DuckDB**: Excellent columnar OLAP for point clouds, but spatial extension is
  younger and ecosystem is thinner for surveying workflows. Reconsider for v1.1
  if LiDAR point cloud analytics becomes a major feature.
- **Hybrid SQLite + DuckDB**: SQLite for parcel/transactional data, DuckDB for
  point cloud analytics. More moving parts. Recommended only if LiDAR is a v1
  feature — it is not.

## References

- METARDU Desktop Master Plan §5
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- SpatiaLite: https://www.gaia-gis.it/foss/libspatialite/
