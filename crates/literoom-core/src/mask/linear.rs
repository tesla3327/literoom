//! Linear gradient mask implementation
//!
//! A linear gradient mask is defined by a start point and end point.
//! The mask transitions from full effect (1.0) at the start side to no effect (0.0)
//! at the end side, with the transition zone controlled by the feather amount.

use super::smootherstep;
use serde::{Deserialize, Serialize};

/// Linear gradient mask for region-based adjustments.
///
/// The gradient is defined by two points in normalized coordinates (0.0 to 1.0).
/// The effect is full (1.0) on the start side and zero (0.0) on the end side.
///
/// # Coordinate System
/// - (0, 0) = top-left corner of the image
/// - (1, 1) = bottom-right corner of the image
///
/// # Example
/// ```
/// use literoom_core::mask::LinearGradientMask;
///
/// // Horizontal gradient from left (full effect) to right (no effect)
/// let mask = LinearGradientMask {
///     start_x: 0.0,
///     start_y: 0.5,
///     end_x: 1.0,
///     end_y: 0.5,
///     feather: 0.5,
/// };
///
/// // Left edge: full effect
/// assert!(mask.evaluate(0.0, 0.5) > 0.9);
/// // Right edge: no effect
/// assert!(mask.evaluate(1.0, 0.5) < 0.1);
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinearGradientMask {
    /// Start point X coordinate (0.0 to 1.0)
    pub start_x: f32,
    /// Start point Y coordinate (0.0 to 1.0)
    pub start_y: f32,
    /// End point X coordinate (0.0 to 1.0)
    pub end_x: f32,
    /// End point Y coordinate (0.0 to 1.0)
    pub end_y: f32,
    /// Feather amount (0.0 = hard edge, 1.0 = full gradient)
    pub feather: f32,
}

impl LinearGradientMask {
    /// Create a new linear gradient mask.
    ///
    /// # Arguments
    /// * `start_x`, `start_y` - Start point (full effect side)
    /// * `end_x`, `end_y` - End point (no effect side)
    /// * `feather` - Transition zone width (0.0-1.0)
    pub fn new(start_x: f32, start_y: f32, end_x: f32, end_y: f32, feather: f32) -> Self {
        Self {
            start_x,
            start_y,
            end_x,
            end_y,
            feather: feather.clamp(0.0, 1.0),
        }
    }

    /// Compute the direction vector from start to end and its squared length.
    ///
    /// Returns (dx, dy, len_sq) where len_sq = dx² + dy².
    /// Using squared length avoids a sqrt when only comparison is needed.
    #[inline]
    fn direction_and_len_sq(&self) -> (f32, f32, f32) {
        let dx = self.end_x - self.start_x;
        let dy = self.end_y - self.start_y;
        (dx, dy, dx * dx + dy * dy)
    }

    /// Evaluate the mask strength at a given normalized coordinate.
    ///
    /// Returns a value from 0.0 (no effect) to 1.0 (full effect).
    ///
    /// # Arguments
    /// * `x` - X coordinate (0.0 to 1.0)
    /// * `y` - Y coordinate (0.0 to 1.0)
    ///
    /// # Algorithm
    /// 1. Calculate direction vector from start to end
    /// 2. Project the point onto this line
    /// 3. Normalize to get position along the gradient (0 = start, 1 = end)
    /// 4. Apply feathering centered at the midpoint
    /// 5. Use smootherstep for natural transition
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let (dx, dy, len_sq) = self.direction_and_len_sq();

        // Degenerate case: start and end are the same point
        if len_sq < f32::EPSILON {
            return 0.5;
        }

        // Project point onto gradient line to get position t (0 = start, 1 = end)
        let t = ((x - self.start_x) * dx + (y - self.start_y) * dy) / len_sq;

        // Apply feathering centered at midpoint (t = 0.5)
        // When feather = 0: sharp edge at t = 0.5
        // When feather = 1: full gradient from t = 0 to t = 1
        let feather_zone = 0.5 * self.feather.clamp(0.0, 1.0);
        let center = 0.5;

        if t <= center - feather_zone {
            // Before the transition zone: full effect
            1.0
        } else if t >= center + feather_zone {
            // After the transition zone: no effect
            0.0
        } else {
            // In the transition zone: interpolate with smootherstep
            let local_t = (t - (center - feather_zone)) / (2.0 * feather_zone).max(0.001);
            1.0 - smootherstep(local_t)
        }
    }

    /// Get the line length in normalized coordinates.
    pub fn length(&self) -> f32 {
        let (_, _, len_sq) = self.direction_and_len_sq();
        len_sq.sqrt()
    }

    /// Get the angle of the gradient in radians.
    pub fn angle(&self) -> f32 {
        let (dx, dy, _) = self.direction_and_len_sq();
        dy.atan2(dx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_horizontal_gradient_endpoints() {
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);

        // At start point: full effect
        let val_start = mask.evaluate(0.0, 0.5);
        assert!(
            val_start > 0.99,
            "Start should have full effect, got {}",
            val_start
        );

        // At end point: no effect
        let val_end = mask.evaluate(1.0, 0.5);
        assert!(val_end < 0.01, "End should have no effect, got {}", val_end);

        // At center: half effect
        let val_center = mask.evaluate(0.5, 0.5);
        assert!(
            (val_center - 0.5).abs() < 0.01,
            "Center should be 0.5, got {}",
            val_center
        );
    }

    #[test]
    fn test_vertical_gradient() {
        let mask = LinearGradientMask::new(0.5, 0.0, 0.5, 1.0, 1.0);

        // Top: full effect
        let val_top = mask.evaluate(0.5, 0.0);
        assert!(val_top > 0.99);

        // Bottom: no effect
        let val_bottom = mask.evaluate(0.5, 1.0);
        assert!(val_bottom < 0.01);
    }

    #[test]
    fn test_diagonal_gradient() {
        let mask = LinearGradientMask::new(0.0, 0.0, 1.0, 1.0, 1.0);

        // Top-left corner: full effect
        let val_corner = mask.evaluate(0.0, 0.0);
        assert!(val_corner > 0.99);

        // Bottom-right corner: no effect
        let val_opposite = mask.evaluate(1.0, 1.0);
        assert!(val_opposite < 0.01);

        // Center: half effect
        let val_center = mask.evaluate(0.5, 0.5);
        assert!((val_center - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_hard_edge_feather_zero() {
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0);

        // Just before center: full effect
        let val_before = mask.evaluate(0.49, 0.5);
        assert!(
            val_before > 0.99,
            "Before midpoint should be 1.0, got {}",
            val_before
        );

        // Just after center: no effect
        let val_after = mask.evaluate(0.51, 0.5);
        assert!(
            val_after < 0.01,
            "After midpoint should be 0.0, got {}",
            val_after
        );
    }

    #[test]
    fn test_reversed_gradient() {
        // Gradient from right to left
        let mask = LinearGradientMask::new(1.0, 0.5, 0.0, 0.5, 1.0);

        // Right side: full effect (start)
        let val_right = mask.evaluate(1.0, 0.5);
        assert!(val_right > 0.99);

        // Left side: no effect (end)
        let val_left = mask.evaluate(0.0, 0.5);
        assert!(val_left < 0.01);
    }

    #[test]
    fn test_perpendicular_to_line() {
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);

        // Points perpendicular to gradient line should have same value
        let val_center_top = mask.evaluate(0.5, 0.0);
        let val_center_bottom = mask.evaluate(0.5, 1.0);
        let val_center_mid = mask.evaluate(0.5, 0.5);

        assert!((val_center_top - val_center_mid).abs() < 0.01);
        assert!((val_center_bottom - val_center_mid).abs() < 0.01);
    }

    #[test]
    fn test_degenerate_same_point() {
        let mask = LinearGradientMask::new(0.5, 0.5, 0.5, 0.5, 0.5);

        // Degenerate case should return 0.5
        let val = mask.evaluate(0.3, 0.7);
        assert!((val - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_outside_gradient_bounds() {
        let mask = LinearGradientMask::new(0.3, 0.5, 0.7, 0.5, 1.0);

        // Before start: full effect (clamped)
        let val_before = mask.evaluate(0.0, 0.5);
        assert!(val_before > 0.99);

        // After end: no effect (clamped)
        let val_after = mask.evaluate(1.0, 0.5);
        assert!(val_after < 0.01);
    }

    #[test]
    fn test_length() {
        let mask = LinearGradientMask::new(0.0, 0.0, 3.0, 4.0, 0.5);
        assert!((mask.length() - 5.0).abs() < f32::EPSILON); // 3-4-5 triangle
    }

    #[test]
    fn test_angle() {
        // Horizontal right
        let mask_h = LinearGradientMask::new(0.0, 0.0, 1.0, 0.0, 0.5);
        assert!((mask_h.angle() - 0.0).abs() < f32::EPSILON);

        // Vertical down
        let mask_v = LinearGradientMask::new(0.0, 0.0, 0.0, 1.0, 0.5);
        assert!((mask_v.angle() - std::f32::consts::FRAC_PI_2).abs() < f32::EPSILON);
    }

    #[test]
    fn test_feather_clamp() {
        // Feather > 1 should be clamped
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 2.0);
        assert!((mask.feather - 1.0).abs() < f32::EPSILON);

        // Feather < 0 should be clamped
        let mask2 = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, -1.0);
        assert!((mask2.feather - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_monotonic_falloff() {
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);

        // Moving from start to end, mask value should only decrease
        let mut prev = 1.0;
        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let val = mask.evaluate(x, 0.5);
            assert!(
                val <= prev + f32::EPSILON,
                "Mask should decrease monotonically"
            );
            prev = val;
        }
    }

    // ===================== Additional edge case tests =====================

    #[test]
    fn test_very_short_gradient() {
        // Very short gradient line (nearly a point)
        let mask = LinearGradientMask::new(0.5, 0.5, 0.501, 0.501, 0.5);

        // Should still produce valid values
        let val_center = mask.evaluate(0.5, 0.5);
        let val_far = mask.evaluate(0.0, 0.0);

        assert!(val_center >= 0.0 && val_center <= 1.0);
        assert!(val_far >= 0.0 && val_far <= 1.0);
    }

    #[test]
    fn test_gradient_at_image_edges() {
        let mask = LinearGradientMask::new(0.0, 0.0, 1.0, 1.0, 1.0);

        // All four corners should produce valid values
        let corners = [
            (0.0, 0.0),
            (1.0, 0.0),
            (0.0, 1.0),
            (1.0, 1.0),
        ];

        for (x, y) in corners {
            let val = mask.evaluate(x, y);
            assert!(
                val >= 0.0 && val <= 1.0,
                "Corner ({}, {}) should have valid value, got {}",
                x, y, val
            );
        }
    }

    #[test]
    fn test_gradient_outside_image() {
        let mask = LinearGradientMask::new(0.2, 0.5, 0.8, 0.5, 0.5);

        // Points outside 0-1 range should still work (useful for previews)
        let val_left = mask.evaluate(-0.5, 0.5);
        let val_right = mask.evaluate(1.5, 0.5);

        assert!(val_left > 0.99, "Far left should be full effect");
        assert!(val_right < 0.01, "Far right should be no effect");
    }

    #[test]
    fn test_partial_feather() {
        let mask_half = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.5);
        let mask_quarter = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.25);

        // With less feather, transition should be sharper
        // At midpoint both should be ~0.5
        let val_half_mid = mask_half.evaluate(0.5, 0.5);
        let val_quarter_mid = mask_quarter.evaluate(0.5, 0.5);

        assert!((val_half_mid - 0.5).abs() < 0.01);
        assert!((val_quarter_mid - 0.5).abs() < 0.01);

        // At the start, both should have full effect
        let val_half_start = mask_half.evaluate(0.0, 0.5);
        let val_quarter_start = mask_quarter.evaluate(0.0, 0.5);

        assert!(val_half_start > 0.99, "Start should have full effect");
        assert!(val_quarter_start > 0.99, "Start should have full effect");

        // At 0.35 (within half-feather zone but outside quarter-feather zone)
        // quarter-feather should already be at full effect, half-feather should be transitioning
        let val_half_35 = mask_half.evaluate(0.35, 0.5);
        let val_quarter_35 = mask_quarter.evaluate(0.35, 0.5);

        // With quarter feather (0.25), transition is from 0.375 to 0.625
        // With half feather (0.5), transition is from 0.25 to 0.75
        // At 0.35, half feather is in transition, quarter feather should be at full effect
        assert!(val_quarter_35 >= val_half_35, "Smaller feather should have sharper transition");
    }

    #[test]
    fn test_gradient_symmetry() {
        // Symmetric gradient from center
        let mask_left = LinearGradientMask::new(0.5, 0.5, 0.0, 0.5, 0.5);
        let mask_right = LinearGradientMask::new(0.5, 0.5, 1.0, 0.5, 0.5);

        // At symmetric points, values should be inversely related
        let val_left_at_25 = mask_left.evaluate(0.25, 0.5);
        let val_right_at_75 = mask_right.evaluate(0.75, 0.5);

        assert!(
            (val_left_at_25 - val_right_at_75).abs() < 0.05,
            "Symmetric gradients should produce symmetric results"
        );
    }

    #[test]
    fn test_45_degree_gradient() {
        // 45-degree diagonal gradient
        let mask = LinearGradientMask::new(0.0, 0.0, 1.0, 1.0, 1.0);

        // Points equidistant from the diagonal should have same value
        let val_a = mask.evaluate(0.3, 0.7);  // Above diagonal
        let val_b = mask.evaluate(0.7, 0.3);  // Below diagonal (same distance)

        assert!(
            (val_a - val_b).abs() < 0.05,
            "Equidistant points should have similar values"
        );
    }

    #[test]
    fn test_gradient_perpendicular_invariance() {
        // Horizontal gradient
        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);

        // All y values at same x should give same result
        let x = 0.3;
        let val_top = mask.evaluate(x, 0.0);
        let val_mid = mask.evaluate(x, 0.5);
        let val_bottom = mask.evaluate(x, 1.0);

        assert!((val_top - val_mid).abs() < 0.01);
        assert!((val_mid - val_bottom).abs() < 0.01);
    }
}
