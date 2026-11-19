# ADR-0018: Preserve absent NMEA position and quality fields

**Status:** Accepted for the GGA/GSA parser boundary
**Date:** 3 November 2026
**Supersedes:** None

## Context

The GGA parser currently converts empty coordinates and numeric measurements to `0`, defaults absent altitude/geoid units to `M`, and silently converts malformed numbers to zero. The quality-metric helper then converts missing quality to “no fix” and absent DOP values to synthetic `99` values. GSA has similar zero defaults. These outputs make an absent observation indistinguishable from a measured zero or an explicit no-fix code.

The u-blox GGA field description identifies latitude/longitude, fix quality, satellites, HDOP, altitude above mean sea level, altitude units, geoid separation, geoid units, and differential age as separate fields. It specifies `M` for the two unit fields and describes geoid separation as the difference between the ellipsoid and mean sea level. The parsed data must retain what the receiver actually sent rather than fill empty fields from that specification.

Reference: [u-blox F9 HPS 1.21 Interface Description, section 2.7.5](https://content.u-blox.com/sites/default/files/F9-HPS-1.21_InterfaceDescription_UBX-21019746.pdf).

## Decision

- Represent empty GGA/GSA numeric fields as `None`/`null`; retain an explicit numeric zero as zero.
- Preserve absent altitude and geoid units as `None`/`null`. Preserve the actual non-empty unit token; do not supply `M` on behalf of the receiver.
- Reject a GGA/GSA sentence when a non-empty numeric field is malformed, non-finite, or outside the field's accepted domain. The live serial reader retains rejected GGA/GSA lines as `nmea_rejected` raw records without parsed observation fields. Preserve the raw sentence on every successfully parsed sentence.
- Decode GGA latitude/longitude only when both the numeric value and a valid hemisphere are present. Accept both as absent for no-fix output; reject a partial pair, invalid minutes, out-of-range degrees, or invalid hemisphere.
- Keep quality calculations incomplete when required source quality values are absent. Return “no fix” only for an explicit GGA quality code `0`; do not encode missing fix quality or missing DOP as `0` or `99`.
- GGA altitude and geoid separation remain separate receiver values. Do not derive ellipsoidal height, a local vertical datum, or a transformed coordinate from them.
- Apply identical public semantics in the Rust sidecar parser and the two TypeScript GNSS parser modules.

## Consequences

- Rust JSON output and TypeScript interfaces use nullable GGA/GSA fields. Consumers must distinguish `null` from numeric zero.
- Derived DOP-based accuracy values are unavailable when their input DOP is unavailable; missing values cannot yield a fabricated accuracy estimate.
- This change is a parser-integrity repair only. It does not add instrument hardware validation, NMEA RMC/GLL cleanup, coordinate-reference validation, or survey-accuracy claims.

## Verification boundary

Tests cover populated, empty, explicitly zero, malformed, and out-of-range GGA/GSA fields in both parser implementations, plus raw retention of rejected live GGA/GSA lines. Type checks and sidecar tests verify the code contracts, not live receiver interoperability or field accuracy.
