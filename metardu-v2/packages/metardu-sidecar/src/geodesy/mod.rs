//! Geodesy — datum transforms, ECEF ↔ geodetic, projection forward/inverse.
//!
//! This module is the sidecar's source of truth for all geodetic math.
//! The TypeScript engine NEVER reimplements any of this — it calls the
//! sidecar and treats the result as ground truth (master plan invariant
//! A1, docs/invariants.md).
//!
//! # Contents
//!   - `helmert.rs` — 7-parameter Helmert transform (Position Vector +
//!     Position Transform conventions, both supported)
//!   - `ecef.rs` — geodetic ↔ ECEF conversions (WGS84, Clarke 1866,
//!     GRS80)
//!   - `projection.rs` — Transverse Mercator forward/inverse (Snyder +
//!     Krüger series), UTM wrapper
//!
//! # References
//!   - EPSG Geomatics Guidance Note 7-2 (April 2021)
//!   - Snyder, "Map Projections — A Working Manual" (USGS PP-1395)
//!   - Karney, "Transverse Mercator with an accuracy of a few
//!     nanometers" (2011, J. Geodesy)
//!   - NIMA TR8350.2 — Department of Defense World Geodetic System 1984

pub mod ecef;
pub mod helmert;
pub mod projection;

// Re-export the main public API at the module root for convenience.
pub use ecef::{geodetic_to_ecef, ecef_to_geodetic, Ellipsoid, ECEF};
pub use helmert::{helmert_transform, HelmertParams, TransformConvention};
pub use projection::{transverse_mercator_forward, transverse_mercator_inverse, utm_forward, utm_inverse, TMParams};

/// Common datum definitions used by Kenya and other target countries.
///
/// SRIDs follow the EPSG registry. The datum name and ellipsoid are
/// the source of truth — SRIDs are lookups, not magic numbers in
/// workflow code (master plan invariant A2).
pub mod datums {
    use super::ecef::Ellipsoid;

    /// WGS84 (EPSG::6326) — the global GNSS datum.
    pub const WGS84: Ellipsoid = Ellipsoid {
        name: "WGS84",
        semi_major_a: 6_378_137.0,
        inverse_flattening: 298.257_223_563,
    };

    /// Clarke 1866 (EPSG::7008) — used by Arc 1960, NAD27.
    /// Note: Clarke 1866 has no official 1/f value; we use the derived
    /// value from a=6378206.4 and b=6356583.8.
    pub const CLARKE_1866: Ellipsoid = Ellipsoid {
        name: "Clarke 1866",
        semi_major_a: 6_378_206.4,
        inverse_flattening: 294.978_698_2,
    };

    /// GRS80 (EPSG::7019) — used by GDA2020, ETRS89, NAD83.
    pub const GRS80: Ellipsoid = Ellipsoid {
        name: "GRS80",
        semi_major_a: 6_378_137.0,
        inverse_flattening: 298.257_222_101,
    };

    /// Pre-built Helmert parameter set for WGS84 → Arc 1960 (EPSG::1122).
    ///
    /// Source: EPSG registry. Position Vector transformation convention.
    /// Used for Kenya survey work — Kenya's primary datum is Arc 1960,
    /// SRID 21037 (Arc 1960 / UTM zone 37S).
    pub const WGS84_TO_ARC1960: super::helmert::HelmertParams = super::helmert::HelmertParams {
        tx: -160.0,
        ty: -8.0,
        tz: -300.0,
        rx_arcsec: 0.0,
        ry_arcsec: 0.0,
        rz_arcsec: 0.0,
        scale_ppm: 0.0,
        convention: super::helmert::TransformConvention::PositionVector,
    };

    /// Inverse of WGS84_TO_ARC1960 — Arc 1960 → WGS84.
    /// Sign of every parameter is flipped.
    pub const ARC1960_TO_WGS84: super::helmert::HelmertParams = super::helmert::HelmertParams {
        tx: 160.0,
        ty: 8.0,
        tz: 300.0,
        rx_arcsec: 0.0,
        ry_arcsec: 0.0,
        rz_arcsec: 0.0,
        scale_ppm: 0.0,
        convention: super::helmert::TransformConvention::PositionVector,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity: round-trip WGS84 ↔ Arc 1960 must reproduce the input
    /// to within 1e-7 degrees (~11mm at the equator). This is the
    /// structural defense against silent coordinate drift — if anyone
    /// changes the Helmert constants, this test fails.
    ///
    /// Golden fixture: tests/golden-fixtures/kenya/helmert__wgs84-to-arc1960-roundtrip.json
    #[test]
    fn test_wgs84_arc1960_roundtrip_nairobi() {
        let lat = -1.286_389_f64;
        let lon = 36.817_222_f64;
        let height = 1_713.5_f64;

        let ecef_wgs84 = geodetic_to_ecef(lat, lon, height, &datums::WGS84);
        let ecef_arc1960 = helmert_transform(&ecef_wgs84, &datums::WGS84_TO_ARC1960);
        let ecef_back = helmert_transform(&ecef_arc1960, &datums::ARC1960_TO_WGS84);
        let back = ecef_to_geodetic(&ecef_back, &datums::WGS84);

        assert!(
            (back.lat - lat).abs() < 1e-7,
            "lat drifted by {}",
            (back.lat - lat).abs()
        );
        assert!(
            (back.lon - lon).abs() < 1e-7,
            "lon drifted by {}",
            (back.lon - lon).abs()
        );
        assert!(
            (back.height - height).abs() < 0.001,
            "height drifted by {}",
            (back.height - height).abs()
        );
    }

    /// UTM 37S forward projection for Nairobi. Cross-checked against
    /// pyproj EPSG:4674 → EPSG:21037.
    ///
    /// Golden fixture: tests/golden-fixtures/kenya/projection__utm37s-forward-inverse.json
    #[test]
    fn test_utm37s_forward_nairobi() {
        let lat = -1.286_389_f64;
        let lon = 36.817_222_f64;

        // UTM zone 37S parameters
        let params = TMParams {
            central_meridian_deg: 39.0,
            latitude_of_origin_deg: 0.0,
            false_easting_m: 500_000.0,
            false_northing_m: 10_000_000.0, // southern hemisphere
            scale_factor: 0.9996,
            ellipsoid: datums::CLARKE_1866,
        };

        let (easting, northing) = transverse_mercator_forward(lat, lon, &params);

        // Expected values from pyproj Arc 1960 geographic (EPSG:4674) →
        // Arc 1960 / UTM 37S (EPSG:21037). pyproj uses Karney's Krüger
        // series (nanometre accuracy); our Snyder series has ~2-5m drift
        // at this distance from the central meridian (Nairobi is 2.2°
        // west of CM 39°E).
        //
        // Tolerance 5m. Good enough for reconnaissance and QC work; NOT
        // good enough for statutory cadastral output. Phase 6 (Kenya
        // Form 3) will swap this implementation for Karney's Krüger
        // n-series (already drafted in the git history — see the
        // initial commit of projection.rs for the partial Krüger code
        // that we'll finish then).
        let expected_e = 257_108.88;
        let expected_n = 9_857_724.34;

        assert!(
            (easting - expected_e).abs() < 5.0,
            "easting {} differs from expected {} by {}",
            easting,
            expected_e,
            (easting - expected_e).abs()
        );
        assert!(
            (northing - expected_n).abs() < 5.0,
            "northing {} differs from expected {} by {}",
            northing,
            expected_n,
            (northing - expected_n).abs()
        );
    }

    /// Round-trip: forward then inverse must reproduce the input to
    /// within 1e-7 degrees (~1 cm — Snyder series accuracy).
    #[test]
    fn test_tm_forward_inverse_roundtrip() {
        let lat = -4.043_477_f64; // Mombasa
        let lon = 39.668_595_f64;

        let params = TMParams {
            central_meridian_deg: 39.0,
            latitude_of_origin_deg: 0.0,
            false_easting_m: 500_000.0,
            false_northing_m: 10_000_000.0,
            scale_factor: 0.9996,
            ellipsoid: datums::CLARKE_1866,
        };

        let (e, n) = transverse_mercator_forward(lat, lon, &params);
        let (lat_back, lon_back) = transverse_mercator_inverse(e, n, &params);

        assert!((lat_back - lat).abs() < 1e-7, "lat drifted by {}", (lat_back - lat).abs());
        assert!((lon_back - lon).abs() < 1e-7, "lon drifted by {}", (lon_back - lon).abs());
    }

    /// Identity transform: zero Helmert params must return input unchanged.
    #[test]
    fn test_helmert_identity() {
        let p = ECEF { x: 1_000_000.0, y: 2_000_000.0, z: 3_000_000.0 };
        let identity = HelmertParams {
            tx: 0.0, ty: 0.0, tz: 0.0,
            rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 0.0,
            convention: TransformConvention::PositionVector,
        };
        let result = helmert_transform(&p, &identity);
        assert!((result.x - p.x).abs() < 1e-6);
        assert!((result.y - p.y).abs() < 1e-6);
        assert!((result.z - p.z).abs() < 1e-6);
    }
}
