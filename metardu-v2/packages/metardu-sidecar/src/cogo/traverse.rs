//! Traverse computation — open and closed traverses, adjustment methods.
//!
//! A traverse is a series of connected survey legs where each leg has
//! a bearing and distance. Closed traverses return to their starting
//! point (or close onto a known point); open traverses do not.
//!
//! # Algorithms
//!   - **Bowditch (Compass Rule)** — distributes the misclosure
//!     proportionally to leg length. Simple, traditional, used in
//!     most cadastral work.
//!   - **Transit Rule** — distributes the lat/dep misclosure
//!     proportionally to the lat/dep magnitudes. Better than Bowditch
//!     for E-W oriented traverses.
//!   - **Crandall Rule** — weighted least-squares with distances as
//!     weights (approximation of LS for angle-measurement-dominated
//!     traverses). Not yet implemented; will come in Phase 4B.
//!
//! For statutory-grade work, the rigorous least-squares adjustment in
//! `crate::adjustment/` should be used instead of Bowditch/Transit.
//!
//! # References
//!   - Davis et al., "Surveying: Theory and Practice," §8.16-8.24
//!   - Kenya Survey Regulations 1994 §4.3 (Angular misclosure: 3.0″ × √N)

use serde::{Deserialize, Serialize};

/// A single traverse leg: a bearing (decimal degrees, 0=North, clockwise)
/// and a horizontal distance (metres).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct TraverseLeg {
    pub bearing_deg: f64,
    pub distance_m: f64,
}

/// Error returned by traverse computations.
#[derive(Debug, thiserror::Error)]
pub enum TraverseError {
    #[error("Traverse must have at least 1 leg, got {0}")]
    TooFewLegs(usize),
    #[error("Traverse closure failed: linear misclosure {misclosure_m} m exceeds tolerance {tolerance_m} m")]
    MisclosureExceedsTolerance { misclosure_m: f64, tolerance_m: f64 },
}

/// Compute the linear misclosure of a closed traverse.
///
/// A closed traverse's misclosure is the distance between the
/// computed end point and the starting point. It should be ≤
/// 1:5000 of the total traverse length for cadastral work (Kenya
/// Survey Regulations 1994 §4.3).
///
/// Returns (delta_easting_m, delta_northing_m, total_length_m, misclosure_m).
pub fn closed_traverse_misclosure(legs: &[TraverseLeg]) -> Result<(f64, f64, f64, f64), TraverseError> {
    if legs.is_empty() {
        return Err(TraverseError::TooFewLegs(0));
    }

    let (de, dn, total_length) = legs.iter().fold(
        (0.0_f64, 0.0_f64, 0.0_f64),
        |(de_acc, dn_acc, len_acc), leg| {
            let brg = leg.bearing_deg.to_radians();
            // Standard surveying convention: bearing measured clockwise from North.
            //   ΔN = d * cos(brg)
            //   ΔE = d * sin(brg)
            let d_n = leg.distance_m * brg.cos();
            let d_e = leg.distance_m * brg.sin();
            (de_acc + d_e, dn_acc + d_n, len_acc + leg.distance_m)
        },
    );

    let misclosure = (de * de + dn * dn).sqrt();
    Ok((de, dn, total_length, misclosure))
}

/// Bowditch (Compass Rule) adjustment.
///
/// Distributes the misclosure proportionally to each leg's length:
///   correction_i = -misclosure * (length_i / total_length)
///
/// Returns the corrected legs (each with adjusted bearing/distance such
/// that the traverse now closes perfectly). For a traverse that
/// already closes within tolerance, the corrections are small.
///
/// Note: Bowditch adjusts the COORDINATES, not the bearings/distances
/// directly. The standard practice is to compute unadjusted coordinates,
/// then apply per-point corrections. We return the corrected coordinate
/// offsets (ΔE, ΔN) per leg so the caller can build the adjusted
/// coordinate list.
///
/// Returns: Vec<(delta_e_m, delta_n_m)> per leg, plus the misclosure info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BowditchResult {
    /// Per-leg corrected ΔE (metres). Sum of these = 0 for a closed traverse.
    pub corrected_de: Vec<f64>,
    /// Per-leg corrected ΔN (metres). Sum of these = 0 for a closed traverse.
    pub corrected_dn: Vec<f64>,
    /// Total traverse length (metres).
    pub total_length_m: f64,
    /// Linear misclosure before adjustment (metres).
    pub misclosure_m: f64,
    /// Linear misclosure ratio (1 : N). E.g. 5000 means 1:5000.
    pub misclosure_ratio: f64,
    /// True if misclosure ratio ≤ 1:5000 (Kenya cadastral tolerance).
    pub within_cadastral_tolerance: bool,
}

pub fn bowditch_adjust(legs: &[TraverseLeg]) -> Result<BowditchResult, TraverseError> {
    if legs.is_empty() {
        return Err(TraverseError::TooFewLegs(0));
    }

    let (de_total, dn_total, total_length, misclosure) = closed_traverse_misclosure(legs)?;

    // Per-leg unadjusted ΔE, ΔN
    let unadjusted: Vec<(f64, f64)> = legs
        .iter()
        .map(|leg| {
            let brg = leg.bearing_deg.to_radians();
            (leg.distance_m * brg.sin(), leg.distance_m * brg.cos())
        })
        .collect();

    // Bowditch: correction proportional to leg length.
    //   ΔE_corrected_i = ΔE_unadjusted_i - (de_total * length_i / total_length)
    //   ΔN_corrected_i = ΔN_unadjusted_i - (dn_total * length_i / total_length)
    let corrected_de: Vec<f64> = legs
        .iter()
        .enumerate()
        .map(|(i, leg)| unadjusted[i].0 - de_total * leg.distance_m / total_length)
        .collect();
    let corrected_dn: Vec<f64> = legs
        .iter()
        .enumerate()
        .map(|(i, leg)| unadjusted[i].1 - dn_total * leg.distance_m / total_length)
        .collect();

    // Ratio: e.g. 1:5000 means misclosure / total_length = 1/5000.
    let ratio = if misclosure > 0.0 {
        total_length / misclosure
    } else {
        f64::INFINITY
    };

    Ok(BowditchResult {
        corrected_de,
        corrected_dn,
        total_length_m: total_length,
        misclosure_m: misclosure,
        misclosure_ratio: ratio,
        within_cadastral_tolerance: ratio >= 5000.0,
    })
}

/// Transit Rule adjustment.
///
/// Distributes the ΔE misclosure proportionally to |ΔE| magnitudes,
/// and the ΔN misclosure proportionally to |ΔN| magnitudes. Better
/// than Bowditch for traverses that run mostly E-W or N-S.
pub fn transit_adjust(legs: &[TraverseLeg]) -> Result<BowditchResult, TraverseError> {
    if legs.is_empty() {
        return Err(TraverseError::TooFewLegs(0));
    }

    let (de_total, dn_total, total_length, misclosure) = closed_traverse_misclosure(legs)?;

    let unadjusted: Vec<(f64, f64)> = legs
        .iter()
        .map(|leg| {
            let brg = leg.bearing_deg.to_radians();
            (leg.distance_m * brg.sin(), leg.distance_m * brg.cos())
        })
        .collect();

    let sum_abs_de: f64 = unadjusted.iter().map(|(de, _)| de.abs()).sum();
    let sum_abs_dn: f64 = unadjusted.iter().map(|(_, dn)| dn.abs()).sum();

    // Avoid div-by-zero for traverses that are perfectly N-S or E-W.
    let de_correction_per_unit = if sum_abs_de > 1e-12 { de_total / sum_abs_de } else { 0.0 };
    let dn_correction_per_unit = if sum_abs_dn > 1e-12 { dn_total / sum_abs_dn } else { 0.0 };

    let corrected_de: Vec<f64> = unadjusted
        .iter()
        .map(|(de, _)| de - de_correction_per_unit * de.abs())
        .collect();
    let corrected_dn: Vec<f64> = unadjusted
        .iter()
        .map(|(_, dn)| dn - dn_correction_per_unit * dn.abs())
        .collect();

    let ratio = if misclosure > 0.0 {
        total_length / misclosure
    } else {
        f64::INFINITY
    };

    Ok(BowditchResult {
        corrected_de,
        corrected_dn,
        total_length_m: total_length,
        misclosure_m: misclosure,
        misclosure_ratio: ratio,
        within_cadastral_tolerance: ratio >= 5000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A perfect square traverse — 4 legs of 100 m at 0°, 90°, 180°, 270°.
    /// Misclosure should be zero.
    #[test]
    fn test_square_traverse_zero_misclosure() {
        let legs = vec![
            TraverseLeg { bearing_deg: 90.0, distance_m: 100.0 }, // East
            TraverseLeg { bearing_deg: 180.0, distance_m: 100.0 }, // South
            TraverseLeg { bearing_deg: 270.0, distance_m: 100.0 }, // West
            TraverseLeg { bearing_deg: 0.0, distance_m: 100.0 },   // North
        ];
        let (de, dn, total, misc) = closed_traverse_misclosure(&legs).unwrap();
        assert!(de.abs() < 1e-9, "de = {}", de);
        assert!(dn.abs() < 1e-9, "dn = {}", dn);
        assert!((total - 400.0).abs() < 1e-9);
        assert!(misc.abs() < 1e-9, "misclosure = {}", misc);
    }

    /// Traverse with a known misclosure. Legs 100 m each at the four
    /// cardinal directions, but the last leg is 100.05 m — misclosure
    /// should be 0.05 m, ratio 1:8000 (within cadastral tolerance).
    #[test]
    fn test_traverse_with_misclosure() {
        let legs = vec![
            TraverseLeg { bearing_deg: 90.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 180.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 270.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 0.0, distance_m: 100.05 }, // 5 cm overshot
        ];
        let (de, dn, total, misc) = closed_traverse_misclosure(&legs).unwrap();
        assert!(de.abs() < 1e-9, "de should be 0 (E-W balanced), got {}", de);
        assert!((dn - 0.05).abs() < 1e-9, "dn = {}, expected 0.05", dn);
        assert!((total - 400.05).abs() < 1e-9);
        assert!((misc - 0.05).abs() < 1e-9);
        let ratio = total / misc;
        assert!(ratio > 5000.0, "ratio {} should be > 5000", ratio);
    }

    /// Bowditch adjustment of a perfect square should produce zero
    /// corrections.
    #[test]
    fn test_bowditch_perfect_square() {
        let legs = vec![
            TraverseLeg { bearing_deg: 90.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 180.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 270.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 0.0, distance_m: 100.0 },
        ];
        let result = bowditch_adjust(&legs).unwrap();
        assert!(result.misclosure_m.abs() < 1e-9);
        assert!(result.within_cadastral_tolerance);
        // Sum of corrected ΔE should be 0.
        let sum_de: f64 = result.corrected_de.iter().sum();
        let sum_dn: f64 = result.corrected_dn.iter().sum();
        assert!(sum_de.abs() < 1e-9, "sum_de = {}", sum_de);
        assert!(sum_dn.abs() < 1e-9, "sum_dn = {}", sum_dn);
    }

    /// Bowditch on a traverse with 5cm misclosure must produce corrected
    /// coordinates that close exactly.
    #[test]
    fn test_bowditch_closes_traverse() {
        let legs = vec![
            TraverseLeg { bearing_deg: 90.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 180.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 270.0, distance_m: 100.0 },
            TraverseLeg { bearing_deg: 0.0, distance_m: 100.05 },
        ];
        let result = bowditch_adjust(&legs).unwrap();
        let sum_de: f64 = result.corrected_de.iter().sum();
        let sum_dn: f64 = result.corrected_dn.iter().sum();
        assert!(sum_de.abs() < 1e-9, "sum_de = {}", sum_de);
        assert!(sum_dn.abs() < 1e-9, "sum_dn = {}", sum_dn);
    }

    /// Transit vs Bowditch: for a traverse that runs mostly N-S, transit
    /// should produce a different (smaller) correction on the E components
    /// than Bowditch. We just check that both close the traverse.
    #[test]
    fn test_transit_closes_traverse() {
        let legs = vec![
            TraverseLeg { bearing_deg: 0.0, distance_m: 200.0 }, // North
            TraverseLeg { bearing_deg: 90.0, distance_m: 50.0 }, // East
            TraverseLeg { bearing_deg: 180.0, distance_m: 200.0 }, // South
            TraverseLeg { bearing_deg: 270.0, distance_m: 50.05 }, // West (5cm overshot)
        ];
        let result = transit_adjust(&legs).unwrap();
        let sum_de: f64 = result.corrected_de.iter().sum();
        let sum_dn: f64 = result.corrected_dn.iter().sum();
        assert!(sum_de.abs() < 1e-9, "sum_de = {}", sum_de);
        assert!(sum_dn.abs() < 1e-9, "sum_dn = {}", sum_dn);
    }
}
