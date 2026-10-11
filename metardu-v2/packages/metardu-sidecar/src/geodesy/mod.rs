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
//!     Clarke 1880 (RGS), GRS80)
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
pub use projection::{
    lambert_conformal_conic_forward, lambert_conformal_conic_inverse, transverse_mercator_forward,
    transverse_mercator_inverse, utm_forward, utm_inverse, LCCParams, TMParams,
};

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

    /// Clarke 1866 (EPSG::7008) — used by NAD27.
    /// Note: Clarke 1866 has no official 1/f value; we use the derived
    /// value from a=6378206.4 and b=6356583.8.
    pub const CLARKE_1866: Ellipsoid = Ellipsoid {
        name: "Clarke 1866",
        semi_major_a: 6_378_206.4,
        inverse_flattening: 294.978_698_2,
    };

    /// Clarke 1880 (RGS) (EPSG::7012) — the ellipsoid for Arc 1960.
    pub const CLARKE_1880_RGS: Ellipsoid = Ellipsoid {
        name: "Clarke 1880 (RGS)",
        semi_major_a: 6_378_249.145,
        inverse_flattening: 293.465,
    };

    /// GRS80 (EPSG::7019) — used by GDA2020, ETRS89, NAD83.
    pub const GRS80: Ellipsoid = Ellipsoid {
        name: "GRS80",
        semi_major_a: 6_378_137.0,
        inverse_flattening: 298.257_222_101,
    };

    /// Airy 1830 (EPSG::7001) — OSGB36, Great Britain.
    pub const AIRY_1830: Ellipsoid = Ellipsoid {
        name: "Airy 1830",
        semi_major_a: 6377563.396,
        inverse_flattening: 299.3249646,
    };

    /// Bessel 1841 (EPSG::7004) — DHDN, Germany.
    pub const BESSEL_1841: Ellipsoid = Ellipsoid {
        name: "Bessel 1841",
        semi_major_a: 6377397.155,
        inverse_flattening: 299.1528128,
    };

    /// EPSG::1122 parameters for Arc 1960 → WGS 84, in the published direction.
    ///
    /// Source: EPSG::1122, a 3-parameter geocentric translation with
    /// stated accuracy of 35 m. This is not suitable for survey-grade
    /// cadastral output; callers must not treat it as a local control
    /// network or high-accuracy datum operation.
    pub const ARC1960_TO_WGS84: super::helmert::HelmertParams = super::helmert::HelmertParams {
        tx: -160.0,
        ty: -6.0,
        tz: -302.0,
        rx_arcsec: 0.0,
        ry_arcsec: 0.0,
        rz_arcsec: 0.0,
        scale_ppm: 0.0,
        convention: super::helmert::TransformConvention::PositionVector,
    };

    /// Inverse of EPSG::1122 for WGS 84 → Arc 1960.
    /// Sign of every parameter is flipped.
    pub const WGS84_TO_ARC1960: super::helmert::HelmertParams = super::helmert::HelmertParams {
        tx: 160.0,
        ty: 6.0,
        tz: 302.0,
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

    /// Arithmetic inverse sanity only: EPSG::1122 transforms Arc 1960 →
    /// WGS 84 at 35 m stated accuracy and must not be used as survey-grade
    /// output. The desktop blocks this operation pending a suitable local
    /// control operation.
    ///
    /// Accuracy gate: tests/golden-fixtures/kenya/datum-operation__epsg1122-arc1960-wgs84-block.json
    #[test]
    fn test_epsg1122_inverse_translation_roundtrip_nairobi() {
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
    /// PROJ EPSG:4210 → EPSG:21037 (same Arc 1960 datum; projection only).
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
            ellipsoid: datums::CLARKE_1880_RGS,
        };

        let (easting, northing) = transverse_mercator_forward(lat, lon, &params);

        // Expected values from PROJ using the EPSG:4210 Arc 1960 geographic
        // CRS and EPSG:21037 projected CRS. Earlier multi-metre differences
        // came from using the wrong ellipsoid (Clarke 1866 instead of the
        // EPSG-defined Clarke 1880 (RGS)), not from this projection series.
        let expected_e = 257_108.884_269;
        let expected_n = 9_857_724.336_100;

        assert!(
            (easting - expected_e).abs() < 0.001,
            "easting {} differs from expected {} by {}",
            easting,
            expected_e,
            (easting - expected_e).abs()
        );
        assert!(
            (northing - expected_n).abs() < 0.001,
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
            ellipsoid: datums::CLARKE_1880_RGS,
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

    #[test]
    fn test_airy_1830_lookup_succeeds() {
        let e = crate::compute_handlers::lookup_ellipsoid("Airy 1830").unwrap();
        assert!((e.semi_major_a - 6377563.396).abs() < 0.001);
    }

    #[test]
    fn test_bessel_1841_lookup_succeeds() {
        let e = crate::compute_handlers::lookup_ellipsoid("Bessel 1841").unwrap();
        assert!((e.semi_major_a - 6377397.155).abs() < 0.001);
    }

    #[test]
    fn test_arc1960_clarke_1880_rgs_lookup_succeeds() {
        let e = crate::compute_handlers::lookup_ellipsoid("Clarke 1880 (RGS)").unwrap();
        assert!((e.semi_major_a - 6_378_249.145).abs() < 0.001);
        assert!((e.inverse_flattening - 293.465).abs() < 1e-9);
    }
}
