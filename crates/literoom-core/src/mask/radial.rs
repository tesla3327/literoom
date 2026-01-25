//! Radial gradient mask implementation
//!
//! A radial gradient mask is an elliptical region defined by center, radii,
//! and optional rotation. The mask transitions from full effect at the center
//! to no effect at the edges, with feathering for smooth transitions.

use super::smootherstep;
use serde::{Deserialize, Serialize};

/// Radial (elliptical) gradient mask for region-based adjustments.
///
/// The gradient is defined by an ellipse with center, horizontal/vertical radii,
/// and optional rotation. The effect is full (1.0) at the center and zero (0.0)
/// at the edge, with the transition controlled by feather.
///
/// # Coordinate System
/// - (0, 0) = top-left corner of the image
/// - (1, 1) = bottom-right corner of the image
///
/// # Invert Option
/// When `invert` is true, the effect is applied OUTSIDE the ellipse rather
/// than inside, useful for vignettes and spotlight effects.
///
/// # Example
/// ```
/// use literoom_core::mask::RadialGradientMask;
///
/// // Circular mask centered in the image
/// let mask = RadialGradientMask {
///     center_x: 0.5,
///     center_y: 0.5,
///     radius_x: 0.3,
///     radius_y: 0.3,
///     rotation: 0.0,
///     feather: 0.5,
///     invert: false,
/// };
///
/// // Center: full effect
/// assert!(mask.evaluate(0.5, 0.5) > 0.99);
/// // Far corner: no effect
/// assert!(mask.evaluate(0.0, 0.0) < 0.01);
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RadialGradientMask {
    /// Center X coordinate (0.0 to 1.0)
    pub center_x: f32,
    /// Center Y coordinate (0.0 to 1.0)
    pub center_y: f32,
    /// Horizontal radius (0.0 to 1.0, relative to image width)
    pub radius_x: f32,
    /// Vertical radius (0.0 to 1.0, relative to image height)
    pub radius_y: f32,
    /// Rotation angle in radians (positive = clockwise)
    pub rotation: f32,
    /// Feather amount (0.0 = hard edge, 1.0 = gradient from center to edge)
    pub feather: f32,
    /// Whether to invert the mask (apply effect outside ellipse)
    pub invert: bool,
}

impl RadialGradientMask {
    /// Create a new radial gradient mask.
    ///
    /// # Arguments
    /// * `center_x`, `center_y` - Center point
    /// * `radius_x`, `radius_y` - Ellipse radii
    /// * `rotation` - Rotation angle in radians
    /// * `feather` - Transition zone width (0.0-1.0)
    /// * `invert` - Whether to invert the mask
    pub fn new(
        center_x: f32,
        center_y: f32,
        radius_x: f32,
        radius_y: f32,
        rotation: f32,
        feather: f32,
        invert: bool,
    ) -> Self {
        Self {
            center_x,
            center_y,
            radius_x: radius_x.max(0.001), // Prevent division by zero
            radius_y: radius_y.max(0.001),
            rotation,
            feather: feather.clamp(0.0, 1.0),
            invert,
        }
    }

    /// Create a circular mask (radius_x = radius_y).
    pub fn circle(center_x: f32, center_y: f32, radius: f32, feather: f32) -> Self {
        Self::new(center_x, center_y, radius, radius, 0.0, feather, false)
    }

    /// Compute the normalized distance squared from center in ellipse space.
    ///
    /// Returns the squared distance where 1.0 means on the ellipse boundary.
    /// Using squared distance avoids a sqrt when only comparison is needed.
    #[inline]
    fn normalized_distance_sq(&self, x: f32, y: f32) -> f32 {
        // Translate to center
        let dx = x - self.center_x;
        let dy = y - self.center_y;

        // Rotate to local coordinate space (inverse rotation)
        let (cos_r, sin_r) = (self.rotation.cos(), self.rotation.sin());
        let local_x = dx * cos_r + dy * sin_r;
        let local_y = -dx * sin_r + dy * cos_r;

        // Normalize by radii (min 0.001 to avoid division by zero)
        let rx = self.radius_x.max(0.001);
        let ry = self.radius_y.max(0.001);

        (local_x / rx).powi(2) + (local_y / ry).powi(2)
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
    /// 1. Translate point relative to ellipse center
    /// 2. Rotate to align with ellipse axes
    /// 3. Compute normalized distance (1.0 = on ellipse edge)
    /// 4. Apply feathering based on distance
    /// 5. Optionally invert the result
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let norm_dist = self.normalized_distance_sq(x, y).sqrt();

        // Calculate inner boundary based on feather
        // feather = 0: inner = 1.0 (hard edge at ellipse boundary)
        // feather = 1: inner = 0.0 (full gradient from center to edge)
        let inner = 1.0 - self.feather.clamp(0.0, 1.0);

        let mask = if norm_dist <= inner {
            // Inside inner boundary: full effect
            1.0
        } else if norm_dist >= 1.0 {
            // Outside ellipse: no effect
            0.0
        } else {
            // In feathered region: interpolate
            let t = (norm_dist - inner) / (1.0 - inner).max(0.001);
            1.0 - smootherstep(t)
        };

        // Optionally invert: outside gets effect, inside doesn't
        if self.invert {
            1.0 - mask
        } else {
            mask
        }
    }

    /// Get the area of the ellipse in normalized coordinates squared.
    pub fn area(&self) -> f32 {
        std::f32::consts::PI * self.radius_x * self.radius_y
    }

    /// Check if a point is inside the ellipse boundary (ignoring feather).
    pub fn contains(&self, x: f32, y: f32) -> bool {
        self.normalized_distance_sq(x, y) <= 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn test_circle_center() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.3, 0.5);

        // At center: full effect
        let val = mask.evaluate(0.5, 0.5);
        assert!(val > 0.99, "Center should have full effect, got {}", val);
    }

    #[test]
    fn test_circle_outside() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.2, 0.2);

        // Far outside: no effect
        let val = mask.evaluate(0.0, 0.0);
        assert!(val < 0.01, "Outside should have no effect, got {}", val);
    }

    #[test]
    fn test_ellipse_horizontal() {
        // Wide ellipse (larger horizontal radius)
        // radius_x = 0.4, radius_y = 0.2
        let mask = RadialGradientMask::new(0.5, 0.5, 0.4, 0.2, 0.0, 0.5, false);

        // Points at normalized distance 0.5 from center in ellipse space
        // For horizontal: x_offset = 0.5 * 0.4 = 0.2
        // For vertical: y_offset = 0.5 * 0.2 = 0.1
        let val_right = mask.evaluate(0.5 + 0.2, 0.5); // 0.5 normalized distance
        let val_top = mask.evaluate(0.5, 0.5 - 0.1); // 0.5 normalized distance

        // Both should be similar since they're equidistant in normalized ellipse space
        assert!(
            (val_right - val_top).abs() < 0.05,
            "Expected similar values, got right={}, top={}",
            val_right,
            val_top
        );
    }

    #[test]
    fn test_ellipse_vertical() {
        // Tall ellipse (larger vertical radius)
        // radius_x = 0.2, radius_y = 0.4
        let mask = RadialGradientMask::new(0.5, 0.5, 0.2, 0.4, 0.0, 0.5, false);

        // Points at normalized distance 0.5 from center in ellipse space
        // For vertical: y_offset = 0.5 * 0.4 = 0.2
        // For horizontal: x_offset = 0.5 * 0.2 = 0.1
        let val_bottom = mask.evaluate(0.5, 0.5 + 0.2); // 0.5 normalized distance
        let val_right = mask.evaluate(0.5 + 0.1, 0.5); // 0.5 normalized distance

        assert!(
            (val_right - val_bottom).abs() < 0.05,
            "Expected similar values, got right={}, bottom={}",
            val_right,
            val_bottom
        );
    }

    #[test]
    fn test_rotation() {
        // Ellipse rotated 45 degrees
        // After rotation, the wide axis (0.3) is along the 45-degree diagonal
        let mask = RadialGradientMask::new(0.5, 0.5, 0.3, 0.1, PI / 4.0, 0.5, false);

        // Point along the wide axis (45-degree diagonal from center)
        // At half the wide radius: should be well inside
        let val_along_wide = mask.evaluate(0.5 + 0.1 * 0.707, 0.5 + 0.1 * 0.707);

        // Point along the narrow axis (135-degree from positive x, perpendicular to wide axis)
        // At the narrow radius: should be at the edge
        let val_at_narrow_edge = mask.evaluate(0.5 - 0.1 * 0.707, 0.5 + 0.1 * 0.707);

        // Point along wide axis should have more effect than point at narrow edge
        assert!(
            val_along_wide > val_at_narrow_edge,
            "Wide axis point should have more effect: {} vs {}",
            val_along_wide,
            val_at_narrow_edge
        );
        assert!(
            val_along_wide > 0.5,
            "Point inside should have high effect, got {}",
            val_along_wide
        );
    }

    #[test]
    fn test_invert() {
        let mask_normal = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.0, false);
        let mask_invert = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.0, true);

        // Center: normal has effect, inverted doesn't
        let val_center_normal = mask_normal.evaluate(0.5, 0.5);
        let val_center_invert = mask_invert.evaluate(0.5, 0.5);

        assert!(val_center_normal > 0.99);
        assert!(val_center_invert < 0.01);

        // Outside: normal doesn't have effect, inverted does
        let val_outside_normal = mask_normal.evaluate(0.0, 0.0);
        let val_outside_invert = mask_invert.evaluate(0.0, 0.0);

        assert!(val_outside_normal < 0.01);
        assert!(val_outside_invert > 0.99);
    }

    #[test]
    fn test_hard_edge_feather_zero() {
        let mask = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.0, false);

        // Just inside edge: full effect
        let val_inside = mask.evaluate(0.5, 0.5 + 0.29);
        assert!(
            val_inside > 0.99,
            "Inside edge should be 1.0, got {}",
            val_inside
        );

        // Just outside edge: no effect
        let val_outside = mask.evaluate(0.5, 0.5 + 0.31);
        assert!(
            val_outside < 0.01,
            "Outside edge should be 0.0, got {}",
            val_outside
        );
    }

    #[test]
    fn test_full_feather() {
        let mask = RadialGradientMask::new(0.5, 0.5, 0.4, 0.4, 0.0, 1.0, false);

        // Center should still be full
        assert!(mask.evaluate(0.5, 0.5) > 0.99);

        // Halfway to edge should be around 0.5
        let val_half = mask.evaluate(0.5, 0.5 + 0.2);
        assert!(
            (val_half - 0.5).abs() < 0.15,
            "Halfway should be ~0.5, got {}",
            val_half
        );

        // At edge should be 0
        let val_edge = mask.evaluate(0.5, 0.5 + 0.4);
        assert!(val_edge < 0.01);
    }

    #[test]
    fn test_contains() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.2, 0.5);

        assert!(mask.contains(0.5, 0.5), "Center should be inside");
        assert!(
            mask.contains(0.5, 0.6),
            "Point within radius should be inside"
        );
        assert!(
            !mask.contains(0.5, 0.8),
            "Point outside radius should be outside"
        );
    }

    #[test]
    fn test_area() {
        let circle = RadialGradientMask::circle(0.5, 0.5, 0.1, 0.5);
        let expected_area = PI * 0.1 * 0.1;
        assert!((circle.area() - expected_area).abs() < 1e-6);
    }

    #[test]
    fn test_tiny_radius() {
        // Very small radius should not cause division by zero
        let mask = RadialGradientMask::new(0.5, 0.5, 0.0001, 0.0001, 0.0, 0.5, false);

        let val_center = mask.evaluate(0.5, 0.5);
        let val_outside = mask.evaluate(0.6, 0.6);

        assert!(val_center > 0.0);
        assert!(val_outside < 1.0);
    }

    #[test]
    fn test_monotonic_falloff() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.4, 1.0);

        // Moving from center to edge, mask value should only decrease
        let mut prev = 1.0;
        for i in 0..=100 {
            let dist = i as f32 / 100.0 * 0.4;
            let val = mask.evaluate(0.5 + dist, 0.5);
            assert!(
                val <= prev + f32::EPSILON,
                "Mask should decrease monotonically"
            );
            prev = val;
        }
    }

    #[test]
    fn test_radial_symmetry() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.3, 0.5);

        // Points at same distance should have same value
        let dist = 0.15;
        let val_right = mask.evaluate(0.5 + dist, 0.5);
        let val_left = mask.evaluate(0.5 - dist, 0.5);
        let val_up = mask.evaluate(0.5, 0.5 - dist);
        let val_down = mask.evaluate(0.5, 0.5 + dist);

        assert!((val_right - val_left).abs() < 1e-6);
        assert!((val_up - val_down).abs() < 1e-6);
        assert!((val_right - val_up).abs() < 1e-6);
    }

    // ===================== Additional edge case tests =====================

    #[test]
    fn test_mask_at_image_corners() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.3, 0.5);

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
    fn test_mask_outside_image() {
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.2, 0.5);

        // Points outside 0-1 range should still produce valid results
        let val = mask.evaluate(-1.0, -1.0);
        assert!(val >= 0.0 && val <= 1.0);
        assert!(val < 0.01, "Point far outside should have no effect");
    }

    #[test]
    fn test_mask_at_edge() {
        let mask = RadialGradientMask::circle(0.0, 0.0, 0.3, 0.5);

        // Mask centered at corner
        let val_corner = mask.evaluate(0.0, 0.0);
        let val_outside = mask.evaluate(0.5, 0.5);

        assert!(val_corner > 0.99, "Center should have full effect");
        assert!(val_outside < val_corner, "Further point should have less effect");
    }

    #[test]
    fn test_zero_radius_handling() {
        // Zero radius should not cause NaN or infinity
        let mask = RadialGradientMask::new(0.5, 0.5, 0.0, 0.0, 0.0, 0.5, false);

        let val = mask.evaluate(0.5, 0.5);
        assert!(!val.is_nan(), "Zero radius should not produce NaN");
        assert!(!val.is_infinite(), "Zero radius should not produce infinity");
    }

    #[test]
    fn test_full_rotation_identity() {
        // 360 degree rotation should be same as no rotation
        let mask_no_rot = RadialGradientMask::new(0.5, 0.5, 0.3, 0.2, 0.0, 0.5, false);
        let mask_full_rot = RadialGradientMask::new(0.5, 0.5, 0.3, 0.2, 2.0 * PI, 0.5, false);

        let test_points = [
            (0.3, 0.3),
            (0.7, 0.3),
            (0.5, 0.6),
            (0.4, 0.5),
        ];

        for (x, y) in test_points {
            let val1 = mask_no_rot.evaluate(x, y);
            let val2 = mask_full_rot.evaluate(x, y);
            assert!(
                (val1 - val2).abs() < 1e-5,
                "360 degree rotation should produce same result"
            );
        }
    }

    #[test]
    fn test_180_degree_rotation_symmetry() {
        // 180 degree rotation should flip the ellipse
        let mask = RadialGradientMask::new(0.5, 0.5, 0.3, 0.15, 0.0, 0.5, false);
        let mask_180 = RadialGradientMask::new(0.5, 0.5, 0.3, 0.15, PI, 0.5, false);

        // For an ellipse centered at 0.5, 0.5, 180 rotation should be symmetric
        let val_normal = mask.evaluate(0.6, 0.5);
        let val_rotated = mask_180.evaluate(0.4, 0.5);  // Opposite side

        assert!(
            (val_normal - val_rotated).abs() < 0.05,
            "180 degree rotation should be symmetric"
        );
    }

    #[test]
    fn test_extreme_aspect_ratio() {
        // Very thin ellipse
        let mask = RadialGradientMask::new(0.5, 0.5, 0.4, 0.01, 0.0, 0.5, false);

        // Along the long axis, should extend further
        let val_along = mask.evaluate(0.7, 0.5);  // Along x axis
        let val_perp = mask.evaluate(0.5, 0.52);  // Perpendicular (beyond narrow radius)

        assert!(val_along > val_perp, "Value along long axis should be greater");
    }

    #[test]
    fn test_inverted_mask_complement() {
        let mask_normal = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.3, false);
        let mask_invert = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.3, true);

        // Normal + inverted should sum to 1.0 at every point
        let test_points = [
            (0.5, 0.5),
            (0.3, 0.3),
            (0.7, 0.7),
            (0.0, 0.0),
        ];

        for (x, y) in test_points {
            let sum = mask_normal.evaluate(x, y) + mask_invert.evaluate(x, y);
            assert!(
                (sum - 1.0).abs() < 1e-5,
                "Normal + inverted should equal 1.0 at ({}, {}), got {}",
                x, y, sum
            );
        }
    }

    #[test]
    fn test_continuous_gradient() {
        // Verify there are no discontinuities in the gradient
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.3, 1.0);

        let mut prev_val = mask.evaluate(0.5, 0.5);
        let steps = 100;
        let mut max_diff = 0.0f32;

        for i in 1..=steps {
            let dist = (i as f32 / steps as f32) * 0.4;  // Go slightly beyond radius
            let val = mask.evaluate(0.5 + dist, 0.5);
            let diff = (val - prev_val).abs();
            max_diff = max_diff.max(diff);
            prev_val = val;
        }

        // Maximum difference between adjacent samples should be small
        assert!(
            max_diff < 0.05,
            "Gradient should be smooth, max difference was {}",
            max_diff
        );
    }
}
