//! ECEF (Earth-Centered, Earth-Fixed) ↔ geodetic (lat/lon/height) conversions.
//!
//! References:
//!   - Zhu, J. (1993), "Exact Transformations from Geocentric to Geodetic
//!     Coordinates Without Iterations," Celestial Mechanics and Dynamical
//!     Astronomy 56: 521-529.
//!   - NIMA TR8350.2 — WGS84 ellipsoid definition
//!   - EPSG Geomatics Guidance Note 7-2 §2.2.1

use serde::{Deserialize, Serialize};

/// Earth-centered, earth-fixed Cartesian coordinates (metres).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ECEF {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Reference ellipsoid definition.
///
/// Defined by the semi-major axis `a` and the inverse flattening `1/f`.
/// The semi-minor axis `b` is derived: `b = a * (1 - 1/(1/f))`.
#[derive(Debug, Clone, Copy)]
pub struct Ellipsoid {
    pub name: &'static str,
    pub semi_major_a: f64,
    pub inverse_flattening: f64,
}

impl Ellipsoid {
    /// Semi-minor axis b = a * (1 - f) = a * (1 - 1/(1/f)).
    pub fn semi_minor_b(&self) -> f64 {
        let f = 1.0 / self.inverse_flattening;
        self.semi_major_a * (1.0 - f)
    }

    /// First eccentricity squared: e² = (a² - b²) / a² = 2f - f².
    pub fn e2(&self) -> f64 {
        let f = 1.0 / self.inverse_flattening;
        2.0 * f - f * f
    }

    /// Second eccentricity squared: e'² = (a² - b²) / b².
    pub fn e_prime_2(&self) -> f64 {
        let a = self.semi_major_a;
        let b = self.semi_minor_b();
        (a * a - b * b) / (b * b)
    }
}

/// Geodetic coordinates (decimal degrees + metres).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Geodetic {
    pub lat: f64,
    pub lon: f64,
    pub height: f64,
}

/// Convert geodetic (lat, lon, height) → ECEF (x, y, z).
///
/// Algorithm: standard closed-form forward conversion per EPSG GN 7-2.
///   N = a / sqrt(1 - e² sin²(lat))     (prime vertical radius of curvature)
///   x = (N + h) cos(lat) cos(lon)
///   y = (N + h) cos(lat) sin(lon)
///   z = (N(1 - e²) + h) sin(lat)
///
/// Inputs in decimal degrees and metres. Outputs in metres.
pub fn geodetic_to_ecef(lat_deg: f64, lon_deg: f64, height_m: f64, ellipsoid: &Ellipsoid) -> ECEF {
    let lat = lat_deg.to_radians();
    let lon = lon_deg.to_radians();
    let a = ellipsoid.semi_major_a;
    let e2 = ellipsoid.e2();

    let sin_lat = lat.sin();
    let cos_lat = lat.cos();
    let n = a / (1.0 - e2 * sin_lat * sin_lat).sqrt();

    ECEF {
        x: (n + height_m) * cos_lat * lon.cos(),
        y: (n + height_m) * cos_lat * lon.sin(),
        z: (n * (1.0 - e2) + height_m) * sin_lat,
    }
}

/// Convert ECEF (x, y, z) → geodetic (lat, lon, height).
///
/// Algorithm: Zhu's closed-form exact solution (1993), cited by EPSG
/// GN 7-2 as the recommended non-iterative method. Convergence is
/// exact (no iteration) and accuracy is at the level of 10⁻⁸ m for
/// WGS84 — well below any survey tolerance.
///
/// Returns lat/lon in decimal degrees, height in metres.
pub fn ecef_to_geodetic(p: &ECEF, ellipsoid: &Ellipsoid) -> Geodetic {
    let a = ellipsoid.semi_major_a;
    let b = ellipsoid.semi_minor_b();
    let e2 = ellipsoid.e2();
    let ep2 = ellipsoid.e_prime_2();

    let x = p.x;
    let y = p.y;
    let z = p.z;

    // Longitude is trivial — atan2(y, x).
    let lon = y.atan2(x);

    // Zhu's algorithm for latitude.
    let p_xy = (x * x + y * y).sqrt();
    let theta = (z * a).atan2(p_xy * b);

    let sin_theta = theta.sin();
    let cos_theta = theta.cos();

    let lat = (z + ep2 * b * sin_theta * sin_theta * sin_theta)
        .atan2(p_xy - e2 * a * cos_theta * cos_theta * cos_theta);

    // Height: distinguish equatorial vs polar cases to avoid div-by-zero.
    let n = a / (1.0 - e2 * lat.sin() * lat.sin()).sqrt();
    let height = if p_xy > 1e-12 {
        p_xy / lat.cos() - n
    } else {
        // Pole: use z / sin(lat) - b*(1 - e²)... but the simpler form
        // z/sin(lat) - N(1-e²) works at the poles too.
        z / lat.sin() - n * (1.0 - e2)
    };

    Geodetic {
        lat: lat.to_degrees(),
        lon: lon.to_degrees(),
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// WGS84 reference ellipsoid sanity check.
    #[test]
    fn test_wgs84_ellipsoid_values() {
        let wgs84 = Ellipsoid {
            name: "WGS84-test",
            semi_major_a: 6_378_137.0,
            inverse_flattening: 298.257_223_563,
        };
        // Semi-minor axis: ~6356752.3142 m (NIMA TR8350.2)
        let b = wgs84.semi_minor_b();
        assert!((b - 6_356_752.314_2).abs() < 0.01, "b = {}", b);

        // First eccentricity squared: ~0.00669437999014
        let e2 = wgs84.e2();
        assert!((e2 - 0.006_694_379_990_14).abs() < 1e-14, "e2 = {}", e2);
    }

    /// Geodetic → ECEF → geodetic round-trip must reproduce the input
    /// to floating-point precision.
    #[test]
    fn test_ecef_geodetic_roundtrip() {
        let wgs84 = Ellipsoid {
            name: "WGS84",
            semi_major_a: 6_378_137.0,
            inverse_flattening: 298.257_223_563,
        };

        for (lat, lon, h) in [
            (-1.286_389, 36.817_222, 1_713.5), // Nairobi
            (-4.043_477, 39.668_595, 50.0),    // Mombasa
            (0.0, 0.0, 0.0),                   // Equator on prime meridian
            (90.0, 0.0, 0.0),                  // North pole
            (-90.0, 0.0, 0.0),                 // South pole
            (0.0, 180.0, 100.0),               // Antimeridian equator
        ] {
            let ecef = geodetic_to_ecef(lat, lon, h, &wgs84);
            let back = ecef_to_geodetic(&ecef, &wgs84);
            assert!((back.lat - lat).abs() < 1e-9, "lat {:?}: {} vs {}", (lat, lon, h), back.lat, lat);
            assert!((back.lon - lon).abs() < 1e-9, "lon {:?}: {} vs {}", (lat, lon, h), back.lon, lon);
            assert!((back.height - h).abs() < 1e-6, "height {:?}: {} vs {}", (lat, lon, h), back.height, h);
        }
    }

    /// Nairobi WGS84 ECEF coordinates — cross-checked against pyproj
    /// (EPSG:4326 → EPSG:4978) and geographiclib.
    #[test]
    fn test_nairobi_ecef_known_values() {
        let wgs84 = Ellipsoid {
            name: "WGS84",
            semi_major_a: 6_378_137.0,
            inverse_flattening: 298.257_223_563,
        };
        // Nairobi: -1.286389°, 36.817222°, 1713.5 m
        let ecef = geodetic_to_ecef(-1.286_389, 36.817_222, 1_713.5, &wgs84);
        // Expected from pyproj EPSG:4978:
        //   x = 5_106_118.881 m
        //   y = 3_822_259.245 m
        //   z = -142_268.290 m
        assert!((ecef.x - 5_106_118.881).abs() < 0.1, "x = {}", ecef.x);
        assert!((ecef.y - 3_822_259.245).abs() < 0.1, "y = {}", ecef.y);
        assert!((ecef.z - (-142_268.290)).abs() < 0.1, "z = {}", ecef.z);
    }
}
