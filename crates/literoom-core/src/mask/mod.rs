//! Local adjustment masks for region-based editing
//!
//! This module provides linear and radial gradient masks for applying
//! localized adjustments to specific regions of an image.
//!
//! ## Mask Types
//!
//! - **Linear Gradient**: A gradient defined by start and end points with feathering
//! - **Radial Gradient**: An elliptical gradient with center, radii, rotation, and feathering
//!
//! ## Algorithm
//!
//! Masks are evaluated per-pixel and return a value from 0.0 (no effect) to 1.0 (full effect).
//! The feathering uses the smootherstep function for natural transitions.

pub mod apply;
pub mod linear;
pub mod radial;

pub use apply::apply_masked_adjustments;
pub use linear::LinearGradientMask;
pub use radial::RadialGradientMask;

/// Smootherstep interpolation function.
///
/// Returns values from 0.0 to 1.0 with zero velocity and acceleration at boundaries,
/// producing smooth, natural-looking transitions without visible banding.
///
/// Formula: `6t^5 - 15t^4 + 10t^3`
///
/// # Arguments
/// * `t` - Input value (will be clamped to 0.0-1.0)
///
/// # Returns
/// Smoothly interpolated value between 0.0 and 1.0
#[inline]
pub fn smootherstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_smootherstep_boundaries() {
        // At boundaries, should return exact values
        assert!((smootherstep(0.0) - 0.0).abs() < f32::EPSILON);
        assert!((smootherstep(1.0) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_smootherstep_midpoint() {
        // At midpoint, should be exactly 0.5
        assert!((smootherstep(0.5) - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_smootherstep_clamping() {
        // Values outside 0-1 should be clamped
        assert!((smootherstep(-0.5) - 0.0).abs() < f32::EPSILON);
        assert!((smootherstep(1.5) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_smootherstep_monotonic() {
        // Function should be monotonically increasing
        let mut prev = 0.0;
        for i in 0..=100 {
            let t = i as f32 / 100.0;
            let val = smootherstep(t);
            assert!(val >= prev, "smootherstep should be monotonically increasing");
            prev = val;
        }
    }

    #[test]
    fn test_smootherstep_quarter_values() {
        // Values at 0.25 and 0.75 should be symmetric around 0.5
        let val_quarter = smootherstep(0.25);
        let val_three_quarter = smootherstep(0.75);

        // Due to symmetry: f(0.5 - x) + f(0.5 + x) = 1.0
        assert!((val_quarter + val_three_quarter - 1.0).abs() < 1e-6);
    }
}
