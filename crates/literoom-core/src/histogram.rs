//! Histogram computation from RGB pixel data.
//!
//! This module provides functions for computing RGB and luminance histograms
//! from pixel data, used for the edit view histogram display.

use crate::luminance::calculate_luminance_u8;
use crate::Histogram;

/// Compute RGB and luminance histograms from pixel data.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
///
/// # Returns
/// A `Histogram` with all four channels (red, green, blue, luminance) populated.
///
/// # Example
/// ```
/// use literoom_core::histogram::compute_histogram;
///
/// let pixels = vec![255, 0, 0, 0, 255, 0]; // Red, Green pixels
/// let hist = compute_histogram(&pixels, 2, 1);
/// assert_eq!(hist.red[255], 1);
/// assert_eq!(hist.green[255], 1);
/// ```
///
/// # Performance
/// This function uses a single-pass algorithm with O(n) time complexity
/// where n is the number of pixels. Memory usage is constant (4KB for bins).
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> Histogram {
    let mut hist = Histogram::new();

    let expected_len = (width as usize) * (height as usize) * 3;

    // Early return for empty or invalid data
    if pixels.is_empty() || expected_len == 0 {
        return hist;
    }

    debug_assert!(
        pixels.len() == expected_len,
        "Pixel data size mismatch. Expected {}, got {}",
        expected_len,
        pixels.len()
    );

    // Process pixels in chunks of 3 (RGB)
    for chunk in pixels.chunks_exact(3) {
        let r = chunk[0] as usize;
        let g = chunk[1] as usize;
        let b = chunk[2] as usize;

        // Bin RGB channels
        hist.red[r] += 1;
        hist.green[g] += 1;
        hist.blue[b] += 1;

        // Compute and bin luminance
        let lum = calculate_luminance_u8(chunk[0], chunk[1], chunk[2]);
        hist.luminance[lum as usize] += 1;
    }

    hist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_histogram() {
        let pixels: Vec<u8> = vec![];
        let hist = compute_histogram(&pixels, 0, 0);
        assert_eq!(hist.max_value(), 0);
    }

    #[test]
    fn test_single_red_pixel() {
        let pixels = vec![255, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.green[0], 1);
        assert_eq!(hist.blue[0], 1);
        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_single_green_pixel() {
        let pixels = vec![0, 255, 0];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[0], 1);
        assert_eq!(hist.green[255], 1);
        assert_eq!(hist.blue[0], 1);
        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_single_blue_pixel() {
        let pixels = vec![0, 0, 255];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[0], 1);
        assert_eq!(hist.green[0], 1);
        assert_eq!(hist.blue[255], 1);
        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_rgb_primary_colors() {
        let pixels = vec![
            255, 0, 0, // Red
            0, 255, 0, // Green
            0, 0, 255, // Blue
        ];
        let hist = compute_histogram(&pixels, 3, 1);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.red[0], 2);
        assert_eq!(hist.green[255], 1);
        assert_eq!(hist.green[0], 2);
        assert_eq!(hist.blue[255], 1);
        assert_eq!(hist.blue[0], 2);
    }

    #[test]
    fn test_grayscale_midtone() {
        let pixels = vec![128, 128, 128];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[128], 1);
        assert_eq!(hist.green[128], 1);
        assert_eq!(hist.blue[128], 1);
        assert_eq!(hist.luminance[128], 1);
        assert!(!hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_white_pixel() {
        let pixels = vec![255, 255, 255];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.green[255], 1);
        assert_eq!(hist.blue[255], 1);
        assert_eq!(hist.luminance[255], 1);
        assert!(hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_black_pixel() {
        let pixels = vec![0, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[0], 1);
        assert_eq!(hist.green[0], 1);
        assert_eq!(hist.blue[0], 1);
        assert_eq!(hist.luminance[0], 1);
        assert!(!hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_max_value() {
        let pixels = vec![
            100, 100, 100, 100, 100, 100, 100, 100, 100, 200, 200,
            200, // Only one bright pixel
        ];
        let hist = compute_histogram(&pixels, 4, 1);
        assert_eq!(hist.red[100], 3);
        assert_eq!(hist.red[200], 1);
        assert_eq!(hist.max_value(), 3);
    }

    #[test]
    fn test_large_image() {
        // 100x100 image = 10,000 pixels
        let pixels = vec![128u8; 100 * 100 * 3];
        let hist = compute_histogram(&pixels, 100, 100);
        assert_eq!(hist.red[128], 10_000);
        assert_eq!(hist.green[128], 10_000);
        assert_eq!(hist.blue[128], 10_000);
        assert_eq!(hist.luminance[128], 10_000);
        assert_eq!(hist.max_value(), 10_000);
    }

    #[test]
    fn test_2x2_image() {
        // 2x2 image with different colors
        let pixels = vec![
            255, 0, 0, // Red
            0, 255, 0, // Green
            0, 0, 255, // Blue
            128, 128, 128, // Gray
        ];
        let hist = compute_histogram(&pixels, 2, 2);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.green[255], 1);
        assert_eq!(hist.blue[255], 1);
        assert_eq!(hist.red[128], 1);
    }

    #[test]
    fn test_no_clipping_midtone_image() {
        let pixels = vec![50, 60, 70, 100, 110, 120, 150, 160, 170, 200, 210, 220];
        let hist = compute_histogram(&pixels, 4, 1);
        assert!(!hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_gradient_image() {
        // Create a simple gradient
        let mut pixels = Vec::new();
        for i in 0..=255 {
            pixels.push(i as u8);
            pixels.push(i as u8);
            pixels.push(i as u8);
        }
        let hist = compute_histogram(&pixels, 256, 1);

        // Each bin should have exactly 1 pixel
        for i in 0..256 {
            assert_eq!(hist.red[i], 1);
            assert_eq!(hist.green[i], 1);
            assert_eq!(hist.blue[i], 1);
        }
        assert_eq!(hist.max_value(), 1);
    }
}

// ============================================================================
// Property-Based Tests
// ============================================================================

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// Strategy to generate valid pixel arrays (multiple of 3 bytes).
    fn pixel_array_strategy(max_pixels: usize) -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(any::<u8>(), 0..=(max_pixels * 3))
            .prop_map(|v| {
                // Truncate to multiple of 3
                let len = (v.len() / 3) * 3;
                v[..len].to_vec()
            })
    }

    /// Strategy to generate a small image with dimensions.
    fn small_image_strategy() -> impl Strategy<Value = (Vec<u8>, u32, u32)> {
        (1u32..=10, 1u32..=10).prop_flat_map(|(width, height)| {
            let pixel_count = (width * height) as usize;
            prop::collection::vec(any::<u8>(), pixel_count * 3..=pixel_count * 3)
                .prop_map(move |pixels| (pixels, width, height))
        })
    }

    proptest! {
        /// Property: Total count in each channel equals pixel count.
        #[test]
        fn prop_histogram_count_equals_pixel_count((pixels, width, height) in small_image_strategy()) {
            let hist = compute_histogram(&pixels, width, height);
            let pixel_count = (width * height) as u64;

            let red_total: u64 = hist.red.iter().map(|&c| c as u64).sum();
            let green_total: u64 = hist.green.iter().map(|&c| c as u64).sum();
            let blue_total: u64 = hist.blue.iter().map(|&c| c as u64).sum();
            let lum_total: u64 = hist.luminance.iter().map(|&c| c as u64).sum();

            prop_assert_eq!(red_total, pixel_count, "Red channel total mismatch");
            prop_assert_eq!(green_total, pixel_count, "Green channel total mismatch");
            prop_assert_eq!(blue_total, pixel_count, "Blue channel total mismatch");
            prop_assert_eq!(lum_total, pixel_count, "Luminance channel total mismatch");
        }

        /// Property: Histogram bins are always non-negative (trivially true for u32, but tests no overflow).
        #[test]
        fn prop_bins_are_non_negative((pixels, width, height) in small_image_strategy()) {
            let hist = compute_histogram(&pixels, width, height);

            for i in 0..256 {
                prop_assert!(hist.red[i] >= 0, "Red bin {} is negative", i);
                prop_assert!(hist.green[i] >= 0, "Green bin {} is negative", i);
                prop_assert!(hist.blue[i] >= 0, "Blue bin {} is negative", i);
                prop_assert!(hist.luminance[i] >= 0, "Luminance bin {} is negative", i);
            }
        }

        /// Property: max_value is correct (equals the maximum bin count across RGB).
        /// Note: max_value() only considers RGB channels, not luminance,
        /// since luminance is typically displayed separately in histograms.
        #[test]
        fn prop_max_value_is_correct((pixels, width, height) in small_image_strategy()) {
            let hist = compute_histogram(&pixels, width, height);

            // max_value() only considers RGB channels (not luminance)
            let expected_max = hist.red.iter()
                .chain(hist.green.iter())
                .chain(hist.blue.iter())
                .copied()
                .max()
                .unwrap_or(0);

            prop_assert_eq!(hist.max_value(), expected_max);
        }

        /// Property: Grayscale pixels have identical R, G, B histogram contributions.
        #[test]
        fn prop_grayscale_channels_equal(v in 0u8..=255, count in 1usize..=100) {
            let mut pixels = Vec::with_capacity(count * 3);
            for _ in 0..count {
                pixels.push(v);
                pixels.push(v);
                pixels.push(v);
            }

            let hist = compute_histogram(&pixels, count as u32, 1);

            prop_assert_eq!(hist.red[v as usize], count as u32);
            prop_assert_eq!(hist.green[v as usize], count as u32);
            prop_assert_eq!(hist.blue[v as usize], count as u32);
        }

        /// Property: Empty pixel array produces zero histogram.
        #[test]
        fn prop_empty_produces_zero_histogram(_dummy in 0..1i32) {
            let pixels: Vec<u8> = vec![];
            let hist = compute_histogram(&pixels, 0, 0);

            prop_assert_eq!(hist.max_value(), 0);
            for i in 0..256 {
                prop_assert_eq!(hist.red[i], 0);
                prop_assert_eq!(hist.green[i], 0);
                prop_assert_eq!(hist.blue[i], 0);
                prop_assert_eq!(hist.luminance[i], 0);
            }
        }

        /// Property: Clipping detection is consistent with bin values.
        #[test]
        fn prop_clipping_detection_consistent((pixels, width, height) in small_image_strategy()) {
            let hist = compute_histogram(&pixels, width, height);

            // Highlight clipping should be true iff any channel has non-zero count at index 255
            let has_highlight = hist.red[255] > 0 || hist.green[255] > 0 || hist.blue[255] > 0;
            prop_assert_eq!(
                hist.has_highlight_clipping(),
                has_highlight,
                "Highlight clipping detection mismatch"
            );

            // Shadow clipping should be true iff any channel has non-zero count at index 0
            let has_shadow = hist.red[0] > 0 || hist.green[0] > 0 || hist.blue[0] > 0;
            prop_assert_eq!(
                hist.has_shadow_clipping(),
                has_shadow,
                "Shadow clipping detection mismatch"
            );
        }

        /// Property: Histogram computation is deterministic.
        #[test]
        fn prop_deterministic((pixels, width, height) in small_image_strategy()) {
            let hist1 = compute_histogram(&pixels, width, height);
            let hist2 = compute_histogram(&pixels, width, height);

            for i in 0..256 {
                prop_assert_eq!(hist1.red[i], hist2.red[i]);
                prop_assert_eq!(hist1.green[i], hist2.green[i]);
                prop_assert_eq!(hist1.blue[i], hist2.blue[i]);
                prop_assert_eq!(hist1.luminance[i], hist2.luminance[i]);
            }
        }

        /// Property: Single pixel histogram has exactly one count per channel.
        #[test]
        fn prop_single_pixel(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255) {
            let pixels = vec![r, g, b];
            let hist = compute_histogram(&pixels, 1, 1);

            // Each channel should have exactly 1 entry
            let red_total: u32 = hist.red.iter().sum();
            let green_total: u32 = hist.green.iter().sum();
            let blue_total: u32 = hist.blue.iter().sum();
            let lum_total: u32 = hist.luminance.iter().sum();

            prop_assert_eq!(red_total, 1);
            prop_assert_eq!(green_total, 1);
            prop_assert_eq!(blue_total, 1);
            prop_assert_eq!(lum_total, 1);

            // The bin for each channel value should have count 1
            prop_assert_eq!(hist.red[r as usize], 1);
            prop_assert_eq!(hist.green[g as usize], 1);
            prop_assert_eq!(hist.blue[b as usize], 1);
        }
    }
}
