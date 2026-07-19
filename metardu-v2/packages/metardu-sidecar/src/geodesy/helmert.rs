//! 7-parameter Helmert (similarity) transform between datums.
//!
//! References:
//!   - EPSG Geomatics Guidance Note 7-2 §2.4.1 ("Position Vector
//!     transformation") and §2.4.2 ("Coordinate Frame rotation")
//!   - Hofmann-Wellenhof, "Physical Geodesy" 2nd ed., §6.4
//!   - Decker, B. L. (1986), "World Geodetic System 1984",
//!     DMA Technical Report 8350.2

use crate::geodesy::ecef::ECEF;
use serde::{Deserialize, Serialize};

/// Two conventions for the rotation sign in a 7-parameter Helmert.
///
/// Both conventions describe the same physical transformation; they
/// differ only in the sign of the rotation parameters. EPSG documents
/// both:
///
/// - **Position Vector** (EPSG operation method 9606): the rotation
///   parameters are applied to the position vector. Used by Australia
///   (GDA94→GDA2020), Europe (ETRS89), Kenya (Arc 1960→WGS84 EPSG::1122).
///
/// - **Coordinate Frame** (EPSG operation method 9607): the rotation
///   parameters are applied to the coordinate frame. Used by USA
///   (NAD83→WGS84) and many older transformations.
///
/// If you get the convention wrong, the rotations flip sign and you
/// silently shift coordinates by twice the intended rotation. Always
/// cite the source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum TransformConvention {
    PositionVector,
    CoordinateFrame,
}

/// 7-parameter Helmert transformation.
///
/// `tx/ty/tz` are translations in metres. `rx/ry/rz` are rotations in
/// arcseconds. `scale_ppm` is the scale change in parts per million.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HelmertParams {
    pub tx: f64,
    pub ty: f64,
    pub tz: f64,
    pub rx_arcsec: f64,
    pub ry_arcsec: f64,
    pub rz_arcsec: f64,
    pub scale_ppm: f64,
    pub convention: TransformConvention,
}

/// Apply a Helmert transformation to an ECEF point.
///
/// Algorithm (Position Vector convention):
///   [xt]   [tx]              [ 1    -rz   ry ] [x]
///   [yt] = [ty] + (1+s) *    [ rz    1   -rx ] [y]
///   [zt]   [tz]              [-ry    rz   1  ] [z]
///
/// where rx, ry, rz are in RADIANS (we convert from arcseconds) and
/// s is the dimensionless scale (= scale_ppm * 1e-6).
///
/// For Coordinate Frame convention, the rotation signs flip. We
/// handle this by negating rx/ry/rz internally.
///
/// The small-angle approximation (sin θ ≈ θ, cos θ ≈ 1) is valid for
/// all real-world datum transformations — rotations are always < 5
/// arcseconds. The off-diagonal "1" terms in the rotation matrix are
/// kept as 1.0 (the omitted terms are θ², ~10⁻¹⁰ at typical rotation
/// magnitudes, far below survey tolerance).
pub fn helmert_transform(p: &ECEF, params: &HelmertParams) -> ECEF {
    // Convert arcseconds → radians. 1 arcsec = π / (180 * 3600) rad.
    let arcsec_to_rad = std::f64::consts::PI / (180.0 * 3600.0);

    // Negate rotations for Coordinate Frame convention so we can use
    // the same matrix formula below.
    let (rx, ry, rz) = match params.convention {
        TransformConvention::PositionVector => (
            params.rx_arcsec * arcsec_to_rad,
            params.ry_arcsec * arcsec_to_rad,
            params.rz_arcsec * arcsec_to_rad,
        ),
        TransformConvention::CoordinateFrame => (
            -params.rx_arcsec * arcsec_to_rad,
            -params.ry_arcsec * arcsec_to_rad,
            -params.rz_arcsec * arcsec_to_rad,
        ),
    };

    let s = params.scale_ppm * 1e-6;
    let one_plus_s = 1.0 + s;

    ECEF {
        x: params.tx + one_plus_s * (p.x - rz * p.y + ry * p.z),
        y: params.ty + one_plus_s * (rz * p.x + p.y - rx * p.z),
        z: params.tz + one_plus_s * (-ry * p.x + rx * p.y + p.z),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Identity transform: all-zero params returns input unchanged.
    #[test]
    fn test_identity() {
        let p = ECEF { x: 1_000_000.0, y: 2_000_000.0, z: 3_000_000.0 };
        let id = HelmertParams {
            tx: 0.0, ty: 0.0, tz: 0.0,
            rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 0.0,
            convention: TransformConvention::PositionVector,
        };
        let r = helmert_transform(&p, &id);
        assert!((r.x - p.x).abs() < 1e-6);
        assert!((r.y - p.y).abs() < 1e-6);
        assert!((r.z - p.z).abs() < 1e-6);
    }

    /// Pure translation: only tx/ty/tz nonzero — output is input + (tx,ty,tz).
    #[test]
    fn test_pure_translation() {
        let p = ECEF { x: 1_000_000.0, y: 2_000_000.0, z: 3_000_000.0 };
        let t = HelmertParams {
            tx: 100.0, ty: -50.0, tz: 200.0,
            rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 0.0,
            convention: TransformConvention::PositionVector,
        };
        let r = helmert_transform(&p, &t);
        assert!((r.x - 1_000_100.0).abs() < 1e-6);
        assert!((r.y - 1_999_950.0).abs() < 1e-6);
        assert!((r.z - 3_000_200.0).abs() < 1e-6);
    }

    /// Pure scale: scale_ppm only. Output = input * (1 + s).
    #[test]
    fn test_pure_scale() {
        let p = ECEF { x: 1_000_000.0, y: 2_000_000.0, z: 3_000_000.0 };
        let t = HelmertParams {
            tx: 0.0, ty: 0.0, tz: 0.0,
            rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 10.0, // 10 ppm = 1e-5
            convention: TransformConvention::PositionVector,
        };
        let r = helmert_transform(&p, &t);
        assert!((r.x - 1_000_010.0).abs() < 1e-3);
        assert!((r.y - 2_000_020.0).abs() < 1e-3);
        assert!((r.z - 3_000_030.0).abs() < 1e-3);
    }

    /// Position Vector vs Coordinate Frame: same magnitudes, opposite
    /// rotation signs — must produce inverse rotations.
    #[test]
    fn test_convention_sign_flip() {
        let p = ECEF { x: 1_000_000.0, y: 2_000_000.0, z: 3_000_000.0 };

        let pv = HelmertParams {
            tx: 0.0, ty: 0.0, tz: 0.0,
            rx_arcsec: 1.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 0.0,
            convention: TransformConvention::PositionVector,
        };
        let cf = HelmertParams {
            tx: 0.0, ty: 0.0, tz: 0.0,
            rx_arcsec: 1.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
            scale_ppm: 0.0,
            convention: TransformConvention::CoordinateFrame,
        };

        let r_pv = helmert_transform(&p, &pv);
        let r_cf = helmert_transform(&p, &cf);

        // The y and z components (the ones rotated by rx) must be
        // mirrored across the input value. x is unchanged by rx.
        assert!((r_pv.x - r_cf.x).abs() < 1e-9, "x should be the same");
        assert!(
            (r_pv.y + r_cf.y - 2.0 * p.y).abs() < 1e-9,
            "y should be mirrored"
        );
        assert!(
            (r_pv.z + r_cf.z - 2.0 * p.z).abs() < 1e-9,
            "z should be mirrored"
        );
    }

    /// WGS84 → Arc 1960 translation shift must be (-160, -8, -300) m
    /// (with zero rotations and zero scale per EPSG::1122).
    #[test]
    fn test_wgs84_to_arc1960_translation_magnitude() {
        use crate::geodesy::datums;
        let p = ECEF { x: 5_105_954.307, y: 3_820_776.484, z: -142_538.557 };
        let r = helmert_transform(&p, &datums::WGS84_TO_ARC1960);
        assert!((r.x - (p.x - 160.0)).abs() < 1e-6, "x shift wrong: {}", r.x - p.x);
        assert!((r.y - (p.y - 8.0)).abs() < 1e-6, "y shift wrong: {}", r.y - p.y);
        assert!((r.z - (p.z - 300.0)).abs() < 1e-6, "z shift wrong: {}", r.z - p.z);
    }
}
