//! Tone curve interpolation and LUT generation using monotonic cubic hermite splines.
//!
//! This module implements the Fritsch-Carlson algorithm for monotonic spline interpolation,
//! which guarantees that the curve never crosses (no solarization artifacts).

use crate::{CurvePoint, ToneCurve};

// ============================================================================
// LUT Type
// ============================================================================

/// Pre-computed 256-entry lookup table for efficient curve application.
#[derive(Debug, Clone)]
pub struct ToneCurveLut {
    /// LUT values: lut[input] = output
    pub lut: [u8; 256],
}

impl ToneCurveLut {
    /// Generate LUT from a tone curve.
    pub fn from_curve(curve: &ToneCurve) -> Self {
        // Fast path for linear curve
        if curve.is_linear() {
            return Self::identity();
        }

        let tangents = compute_monotonic_tangents(&curve.points);
        let mut lut = [0u8; 256];

        for (i, lut_value) in lut.iter_mut().enumerate() {
            let x = i as f32 / 255.0;
            let y = evaluate_with_tangents(&curve.points, &tangents, x);
            *lut_value = (y * 255.0).clamp(0.0, 255.0).round() as u8;
        }

        Self { lut }
    }

    /// Create identity LUT (no change).
    pub fn identity() -> Self {
        let mut lut = [0u8; 256];
        for (i, lut_value) in lut.iter_mut().enumerate() {
            *lut_value = i as u8;
        }
        Self { lut }
    }

    /// Check if this LUT is identity.
    pub fn is_identity(&self) -> bool {
        self.lut.iter().enumerate().all(|(i, &v)| v == i as u8)
    }
}

impl Default for ToneCurveLut {
    fn default() -> Self {
        Self::identity()
    }
}

// ============================================================================
// Curve Application
// ============================================================================

/// Apply tone curve LUT to RGB pixels in place.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel)
/// * `lut` - Pre-computed lookup table
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    // Early exit for identity
    if lut.is_identity() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}

// ============================================================================
// Monotonic Cubic Hermite Spline (Fritsch-Carlson)
// ============================================================================

/// Compute monotonic tangents using Fritsch-Carlson algorithm.
fn compute_monotonic_tangents(points: &[CurvePoint]) -> Vec<f32> {
    let n = points.len();
    if n < 2 {
        return vec![0.0; n];
    }

    // Compute secants (slopes between adjacent points)
    let mut h: Vec<f32> = Vec::with_capacity(n - 1);
    let mut delta: Vec<f32> = Vec::with_capacity(n - 1);

    for i in 0..n - 1 {
        h.push(points[i + 1].x - points[i].x);
        delta.push(if h[i].abs() < f32::EPSILON {
            0.0
        } else {
            (points[i + 1].y - points[i].y) / h[i]
        });
    }

    // Initialize tangents
    let mut m: Vec<f32> = vec![0.0; n];

    // Interior points: weighted harmonic mean
    for i in 1..n - 1 {
        if delta[i - 1].signum() != delta[i].signum()
            || delta[i - 1].abs() < f32::EPSILON
            || delta[i].abs() < f32::EPSILON
        {
            m[i] = 0.0;
        } else {
            let w1 = 2.0 * h[i] + h[i - 1];
            let w2 = h[i] + 2.0 * h[i - 1];
            m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
        }
    }

    // Endpoint tangents
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];

    // Enforce monotonicity constraints
    for i in 0..n - 1 {
        if delta[i].abs() < f32::EPSILON {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let alpha = m[i] / delta[i];
            let beta = m[i + 1] / delta[i];

            if alpha > 3.0 {
                m[i] = 3.0 * delta[i];
            }
            if beta > 3.0 {
                m[i + 1] = 3.0 * delta[i];
            }
            if alpha < -3.0 {
                m[i] = -3.0 * delta[i].abs();
            }
            if beta < -3.0 {
                m[i + 1] = -3.0 * delta[i].abs();
            }
        }
    }

    m
}

/// Evaluate curve at x with pre-computed tangents.
fn evaluate_with_tangents(points: &[CurvePoint], tangents: &[f32], x: f32) -> f32 {
    let n = points.len();

    if n == 0 {
        return x;
    }
    if n == 1 {
        return points[0].y;
    }

    // Clamp to valid range
    let x = x.clamp(points[0].x, points[n - 1].x);

    // Find interval
    let i = find_interval(points, x);

    let p0 = &points[i];
    let p1 = &points[i + 1];

    let h = p1.x - p0.x;
    if h.abs() < f32::EPSILON {
        return p0.y;
    }

    let t = (x - p0.x) / h;
    let t2 = t * t;
    let t3 = t2 * t;

    // Hermite basis functions
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;

    let y = h00 * p0.y + h10 * h * tangents[i] + h01 * p1.y + h11 * h * tangents[i + 1];

    y.clamp(0.0, 1.0)
}

/// Binary search for interval containing x.
fn find_interval(points: &[CurvePoint], x: f32) -> usize {
    let n = points.len();
    if n <= 2 {
        return 0;
    }

    let mut low = 0;
    let mut high = n - 2;

    while low < high {
        let mid = (low + high).div_ceil(2);
        if points[mid].x <= x {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    low
}

// ============================================================================
// Public Curve Evaluation (for UI preview)
// ============================================================================

/// Evaluate tone curve at a given x value.
/// Used for drawing the curve in the UI.
pub fn evaluate_curve(curve: &ToneCurve, x: f32) -> f32 {
    let tangents = compute_monotonic_tangents(&curve.points);
    evaluate_with_tangents(&curve.points, &tangents, x)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn linear_curve() -> ToneCurve {
        ToneCurve::default()
    }

    fn s_curve() -> ToneCurve {
        ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),
                CurvePoint::new(0.75, 0.85),
                CurvePoint::new(1.0, 1.0),
            ],
        }
    }

    #[test]
    fn test_identity_lut() {
        let lut = ToneCurveLut::identity();
        assert!(lut.is_identity());
        for i in 0..256 {
            assert_eq!(lut.lut[i], i as u8);
        }
    }

    #[test]
    fn test_linear_curve_produces_identity_lut() {
        let curve = linear_curve();
        let lut = ToneCurveLut::from_curve(&curve);
        // Should be very close to identity (allow +/- 1 for rounding)
        for i in 0..256 {
            assert!(
                (lut.lut[i] as i32 - i as i32).abs() <= 1,
                "LUT mismatch at {}: got {}",
                i,
                lut.lut[i]
            );
        }
    }

    #[test]
    fn test_s_curve_increases_contrast() {
        let curve = s_curve();
        let lut = ToneCurveLut::from_curve(&curve);

        // Shadows should be darker
        assert!(lut.lut[64] < 64, "Shadows not darkened");
        // Highlights should be brighter
        assert!(lut.lut[192] > 192, "Highlights not brightened");
    }

    #[test]
    fn test_monotonicity() {
        let curve = s_curve();

        // Verify curve never decreases
        let mut prev_y = -1.0;
        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = evaluate_curve(&curve, x);
            assert!(
                y >= prev_y - f32::EPSILON,
                "Monotonicity violated at x={}: y={} < prev_y={}",
                x,
                y,
                prev_y
            );
            prev_y = y;
        }
    }

    #[test]
    fn test_endpoints_preserved() {
        let curve = s_curve();
        let y_0 = evaluate_curve(&curve, 0.0);
        let y_1 = evaluate_curve(&curve, 1.0);

        assert!((y_0 - 0.0).abs() < 0.01, "Start point not preserved");
        assert!((y_1 - 1.0).abs() < 0.01, "End point not preserved");
    }

    #[test]
    fn test_apply_tone_curve_identity() {
        let original = vec![0, 64, 128, 192, 255, 100];
        let mut pixels = original.clone();
        let lut = ToneCurveLut::identity();

        apply_tone_curve(&mut pixels, &lut);

        assert_eq!(pixels, original);
    }

    #[test]
    fn test_apply_tone_curve_modifies() {
        let mut pixels = vec![64, 64, 64, 192, 192, 192];
        let curve = s_curve();
        let lut = ToneCurveLut::from_curve(&curve);

        apply_tone_curve(&mut pixels, &lut);

        // Verify pixels were modified
        assert!(pixels[0] < 64, "Dark pixel not darkened");
        assert!(pixels[3] > 192, "Bright pixel not brightened");
    }

    #[test]
    fn test_steep_curve_no_overshoot() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.1, 0.9),
                CurvePoint::new(1.0, 1.0),
            ],
        };

        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = evaluate_curve(&curve, x);
            assert!((0.0..=1.0).contains(&y), "Overshoot at x={}: y={}", x, y);
        }
    }

    #[test]
    fn test_curve_through_midpoint() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.5),
                CurvePoint::new(1.0, 1.0),
            ],
        };

        // Should pass through the midpoint
        let y_mid = evaluate_curve(&curve, 0.5);
        assert!(
            (y_mid - 0.5).abs() < 0.01,
            "Midpoint not preserved: got {}",
            y_mid
        );
    }

    #[test]
    fn test_lut_from_inverted_curve() {
        // A curve that inverts light and dark
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.0, 1.0), CurvePoint::new(1.0, 0.0)],
        };

        let lut = ToneCurveLut::from_curve(&curve);

        // 0 should map to ~255
        assert!(lut.lut[0] > 250, "Black should map to white");
        // 255 should map to ~0
        assert!(lut.lut[255] < 5, "White should map to black");
    }

    #[test]
    fn test_single_point_curve() {
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.5, 0.5)],
        };

        // Should return the single point's y value
        let y = evaluate_curve(&curve, 0.5);
        assert!((y - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_empty_points() {
        let curve = ToneCurve { points: vec![] };

        // Should return x (identity) for empty curve
        let y = evaluate_curve(&curve, 0.5);
        assert!((y - 0.5).abs() < 0.01);
    }
}

// ============================================================================
// Property-Based Tests
// ============================================================================

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// Strategy to generate valid curve points sorted by x value.
    fn sorted_curve_points_strategy(
        min_points: usize,
        max_points: usize,
    ) -> impl Strategy<Value = Vec<CurvePoint>> {
        prop::collection::vec((0.0f32..=1.0, 0.0f32..=1.0), min_points..=max_points)
            .prop_filter_map("need at least 2 distinct x values", |points| {
                let mut pts: Vec<(f32, f32)> = points;
                // Sort by x
                pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                // Remove duplicates by x
                pts.dedup_by(|a, b| (a.0 - b.0).abs() < 0.01);
                if pts.len() < 2 {
                    return None;
                }
                // Ensure we have endpoints at 0 and 1
                if pts.first().unwrap().0 > 0.01 {
                    pts.insert(0, (0.0, pts.first().unwrap().1));
                } else {
                    pts[0].0 = 0.0;
                }
                if pts.last().unwrap().0 < 0.99 {
                    pts.push((1.0, pts.last().unwrap().1));
                } else {
                    pts.last_mut().unwrap().0 = 1.0;
                }
                Some(
                    pts.into_iter()
                        .map(|(x, y)| CurvePoint::new(x, y))
                        .collect(),
                )
            })
    }

    /// Strategy to generate monotonically increasing curve points.
    fn monotonic_curve_strategy() -> impl Strategy<Value = ToneCurve> {
        (
            0.0f32..0.5, // Start y (can be low)
            0.5f32..1.0, // End y (must be higher)
        )
            .prop_flat_map(|(start_y, end_y)| {
                // Generate interior y values that are monotonically increasing
                let y_range = end_y - start_y;
                prop::collection::vec(0.0f32..=1.0, 0..=5).prop_map(move |interior_t| {
                    let mut y_values: Vec<f32> = interior_t
                        .into_iter()
                        .map(|t| start_y + t * y_range)
                        .collect();
                    y_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

                    let num_points = y_values.len() + 2;
                    let mut points = vec![CurvePoint::new(0.0, start_y)];

                    for (i, y) in y_values.into_iter().enumerate() {
                        let x = (i + 1) as f32 / (num_points - 1) as f32;
                        points.push(CurvePoint::new(x, y));
                    }

                    points.push(CurvePoint::new(1.0, end_y));

                    ToneCurve { points }
                })
            })
    }

    proptest! {
        /// Property: Output is always within [0, 1] range.
        #[test]
        fn prop_output_in_range(
            points in sorted_curve_points_strategy(2, 8),
            x in 0.0f32..=1.0,
        ) {
            let curve = ToneCurve { points };
            let y = evaluate_curve(&curve, x);

            prop_assert!(
                (0.0..=1.0).contains(&y),
                "Output {} is out of range [0, 1] for input {}",
                y,
                x
            );
        }

        /// Property: LUT values are always valid bytes.
        #[test]
        fn prop_lut_values_are_valid(points in sorted_curve_points_strategy(2, 8)) {
            let curve = ToneCurve { points };
            let lut = ToneCurveLut::from_curve(&curve);

            // All LUT values should be valid (this is always true for u8, but verify LUT generation doesn't panic)
            for (i, &value) in lut.lut.iter().enumerate() {
                prop_assert!(
                    value <= 255,
                    "LUT value {} at index {} is invalid",
                    value,
                    i
                );
            }
        }

        /// Property: Monotonically increasing curves produce monotonically increasing outputs.
        #[test]
        fn prop_monotonic_input_produces_monotonic_output(curve in monotonic_curve_strategy()) {
            let lut = ToneCurveLut::from_curve(&curve);

            // LUT should be monotonically non-decreasing
            let mut prev = 0u8;
            for (i, &value) in lut.lut.iter().enumerate() {
                prop_assert!(
                    value >= prev,
                    "LUT monotonicity violated at index {}: {} < {}",
                    i,
                    value,
                    prev
                );
                prev = value;
            }
        }

        /// Property: Curve always passes through endpoints.
        #[test]
        fn prop_endpoints_preserved(points in sorted_curve_points_strategy(2, 8)) {
            let curve = ToneCurve { points: points.clone() };

            let y_start = evaluate_curve(&curve, 0.0);
            let y_end = evaluate_curve(&curve, 1.0);

            prop_assert!(
                (y_start - points[0].y).abs() < 0.02,
                "Start point not preserved: expected {}, got {}",
                points[0].y,
                y_start
            );
            prop_assert!(
                (y_end - points.last().unwrap().y).abs() < 0.02,
                "End point not preserved: expected {}, got {}",
                points.last().unwrap().y,
                y_end
            );
        }

        /// Property: Evaluation is continuous (no large jumps for small x changes).
        #[test]
        fn prop_continuity(
            points in sorted_curve_points_strategy(2, 8),
            x in 0.01f32..=0.99,
        ) {
            let curve = ToneCurve { points };
            let delta = 0.001;

            let y1 = evaluate_curve(&curve, x);
            let y2 = evaluate_curve(&curve, x + delta);

            // For a reasonable curve, the change should be bounded
            // Maximum slope can be large, but not infinite
            let max_expected_change = 0.5; // Allow fairly steep curves
            prop_assert!(
                (y2 - y1).abs() < max_expected_change,
                "Discontinuity detected at x={}: y1={}, y2={}, delta={}",
                x,
                y1,
                y2,
                (y2 - y1).abs()
            );
        }

        /// Property: Identity LUT is actually identity.
        #[test]
        fn prop_identity_lut_is_identity(_dummy in 0..1i32) {
            let lut = ToneCurveLut::identity();
            prop_assert!(lut.is_identity());

            for i in 0..256 {
                prop_assert_eq!(lut.lut[i], i as u8);
            }
        }

        /// Property: Linear curve produces near-identity LUT.
        #[test]
        fn prop_linear_curve_is_near_identity(_dummy in 0..1i32) {
            let curve = ToneCurve::default();
            let lut = ToneCurveLut::from_curve(&curve);

            // Identity fast-path should be used
            prop_assert!(lut.is_identity(), "Linear curve should produce identity LUT");
        }

        /// Property: Applying identity LUT doesn't change pixels.
        #[test]
        fn prop_identity_preserves_pixels(
            r in 0u8..=255,
            g in 0u8..=255,
            b in 0u8..=255,
        ) {
            let lut = ToneCurveLut::identity();
            let mut pixels = vec![r, g, b];
            let original = pixels.clone();

            apply_tone_curve(&mut pixels, &lut);

            prop_assert_eq!(pixels, original);
        }

        /// Property: Steep transitions don't cause overshoot.
        #[test]
        fn prop_no_overshoot_on_steep_curves(
            low_y in 0.0f32..=0.3,
            high_y in 0.7f32..=1.0,
            transition_x in 0.1f32..=0.9,
        ) {
            let curve = ToneCurve {
                points: vec![
                    CurvePoint::new(0.0, low_y),
                    CurvePoint::new(transition_x, high_y),
                    CurvePoint::new(1.0, high_y + (1.0 - high_y) * 0.5),
                ],
            };

            // Check all LUT values are in range
            let lut = ToneCurveLut::from_curve(&curve);
            for (i, &value) in lut.lut.iter().enumerate() {
                // This is implicitly true for u8, but we're testing the f32 math doesn't produce NaN/Inf
                prop_assert!(
                    value <= 255,
                    "Overshoot at index {}: value {}",
                    i,
                    value
                );
            }

            // Also check raw curve evaluation
            for i in 0..=100 {
                let x = i as f32 / 100.0;
                let y = evaluate_curve(&curve, x);
                prop_assert!(
                    (0.0..=1.0).contains(&y),
                    "Curve overshoot at x={}: y={}",
                    x,
                    y
                );
            }
        }
    }
}
