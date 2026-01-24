//! Histogram computation WASM bindings.
//!
//! This module provides JavaScript bindings for histogram computation,
//! allowing RGB and luminance histograms to be calculated from pixel data.

use literoom_core::histogram::compute_histogram as compute_histogram_core;
use wasm_bindgen::prelude::*;

/// Histogram result accessible from JavaScript.
///
/// Contains 256-bin histograms for red, green, blue, and luminance channels,
/// plus helper methods for clipping detection and normalization.
#[wasm_bindgen]
pub struct JsHistogram {
    red: Vec<u32>,
    green: Vec<u32>,
    blue: Vec<u32>,
    luminance: Vec<u32>,
    max_value: u32,
    has_highlight_clipping: bool,
    has_shadow_clipping: bool,
}

#[wasm_bindgen]
impl JsHistogram {
    /// Get red channel histogram (256 bins).
    pub fn red(&self) -> Vec<u32> {
        self.red.clone()
    }

    /// Get green channel histogram (256 bins).
    pub fn green(&self) -> Vec<u32> {
        self.green.clone()
    }

    /// Get blue channel histogram (256 bins).
    pub fn blue(&self) -> Vec<u32> {
        self.blue.clone()
    }

    /// Get luminance histogram (256 bins).
    pub fn luminance(&self) -> Vec<u32> {
        self.luminance.clone()
    }

    /// Get maximum bin value across all RGB channels.
    ///
    /// Useful for normalizing histogram display.
    #[wasm_bindgen(getter)]
    pub fn max_value(&self) -> u32 {
        self.max_value
    }

    /// Check if any RGB channel has values at 255 (highlight clipping).
    #[wasm_bindgen(getter)]
    pub fn has_highlight_clipping(&self) -> bool {
        self.has_highlight_clipping
    }

    /// Check if any RGB channel has values at 0 (shadow clipping).
    #[wasm_bindgen(getter)]
    pub fn has_shadow_clipping(&self) -> bool {
        self.has_shadow_clipping
    }
}

/// Compute histogram from RGB pixel data.
///
/// # Arguments
/// * `pixels` - RGB pixel data as Uint8Array (3 bytes per pixel, row-major)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
///
/// # Returns
/// JsHistogram with all channel data and clipping info
///
/// # Example (TypeScript)
/// ```typescript
/// // Get pixel data from decoded image
/// const pixels = decodedImage.pixels();
///
/// // Compute histogram
/// const hist = compute_histogram(pixels, width, height);
///
/// // Access data
/// const redBins = hist.red();        // Uint32Array[256]
/// const max = hist.max_value;        // For normalization
/// const clipped = hist.has_highlight_clipping;
///
/// // Don't forget to free!
/// hist.free();
/// ```
#[wasm_bindgen]
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> JsHistogram {
    let hist = compute_histogram_core(pixels, width, height);

    JsHistogram {
        red: hist.red.to_vec(),
        green: hist.green.to_vec(),
        blue: hist.blue.to_vec(),
        luminance: hist.luminance.to_vec(),
        max_value: hist.max_value(),
        has_highlight_clipping: hist.has_highlight_clipping(),
        has_shadow_clipping: hist.has_shadow_clipping(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Basic histogram creation tests
    // =========================================================================

    #[test]
    fn test_js_histogram_creation() {
        let pixels = vec![255, 0, 0, 0, 255, 0, 0, 0, 255];
        let hist = compute_histogram(&pixels, 3, 1);

        assert_eq!(hist.red().len(), 256);
        assert_eq!(hist.green().len(), 256);
        assert_eq!(hist.blue().len(), 256);
        assert_eq!(hist.luminance().len(), 256);
        assert!(hist.has_highlight_clipping);
        assert!(hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_max_value() {
        let pixels = vec![128, 128, 128, 128, 128, 128, 128, 128, 128, 200, 200, 200];
        let hist = compute_histogram(&pixels, 4, 1);

        assert_eq!(hist.max_value, 3); // 3 pixels at value 128
        assert_eq!(hist.red()[128], 3);
        assert_eq!(hist.red()[200], 1);
    }

    #[test]
    fn test_js_histogram_no_clipping() {
        let pixels = vec![64, 64, 64, 128, 128, 128, 192, 192, 192];
        let hist = compute_histogram(&pixels, 3, 1);

        assert!(!hist.has_highlight_clipping);
        assert!(!hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_empty() {
        let pixels: Vec<u8> = vec![];
        let hist = compute_histogram(&pixels, 0, 0);

        assert_eq!(hist.max_value, 0);
        assert!(!hist.has_highlight_clipping);
        assert!(!hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_luminance() {
        // Pure white pixel
        let pixels = vec![255, 255, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.luminance()[255], 1);
    }

    #[test]
    fn test_js_histogram_gradients() {
        // Create a simple gradient from 0 to 255
        let mut pixels = Vec::new();
        for i in 0..=255 {
            pixels.push(i as u8);
            pixels.push(i as u8);
            pixels.push(i as u8);
        }
        let hist = compute_histogram(&pixels, 256, 1);

        // Each bin should have exactly 1 pixel
        for i in 0..256 {
            assert_eq!(hist.red()[i], 1);
            assert_eq!(hist.green()[i], 1);
            assert_eq!(hist.blue()[i], 1);
        }
        assert_eq!(hist.max_value, 1);
    }

    // =========================================================================
    // Clipping detection tests
    // =========================================================================

    #[test]
    fn test_js_histogram_highlight_clipping_only() {
        // Only white pixel (highlight clipping without shadow)
        let pixels = vec![255, 255, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert!(hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_shadow_clipping_only() {
        // Only black pixel (shadow clipping without highlight)
        let pixels = vec![0, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);

        assert!(!hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_both_clipping() {
        // Both extremes
        let pixels = vec![0, 0, 0, 255, 255, 255];
        let hist = compute_histogram(&pixels, 2, 1);

        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_red_channel_only_clipping() {
        // Only red channel clipped at highlight
        let pixels = vec![255, 128, 128];
        let hist = compute_histogram(&pixels, 1, 1);

        assert!(hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_green_channel_only_clipping() {
        // Only green channel clipped at shadow
        let pixels = vec![128, 0, 128];
        let hist = compute_histogram(&pixels, 1, 1);

        assert!(!hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_blue_channel_only_clipping() {
        // Only blue channel clipped
        let pixels = vec![128, 128, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert!(hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    // =========================================================================
    // Channel accessor tests
    // =========================================================================

    #[test]
    fn test_js_histogram_red_channel_accessor() {
        let pixels = vec![100, 50, 75];
        let hist = compute_histogram(&pixels, 1, 1);

        let red = hist.red();
        assert_eq!(red.len(), 256);
        assert_eq!(red[100], 1);
        // All other bins should be 0
        for (i, &count) in red.iter().enumerate() {
            if i != 100 {
                assert_eq!(count, 0);
            }
        }
    }

    #[test]
    fn test_js_histogram_green_channel_accessor() {
        let pixels = vec![100, 50, 75];
        let hist = compute_histogram(&pixels, 1, 1);

        let green = hist.green();
        assert_eq!(green.len(), 256);
        assert_eq!(green[50], 1);
        // All other bins should be 0
        for (i, &count) in green.iter().enumerate() {
            if i != 50 {
                assert_eq!(count, 0);
            }
        }
    }

    #[test]
    fn test_js_histogram_blue_channel_accessor() {
        let pixels = vec![100, 50, 75];
        let hist = compute_histogram(&pixels, 1, 1);

        let blue = hist.blue();
        assert_eq!(blue.len(), 256);
        assert_eq!(blue[75], 1);
        // All other bins should be 0
        for (i, &count) in blue.iter().enumerate() {
            if i != 75 {
                assert_eq!(count, 0);
            }
        }
    }

    #[test]
    fn test_js_histogram_luminance_channel_accessor() {
        // Gray pixel - luminance should equal channel values
        let pixels = vec![128, 128, 128];
        let hist = compute_histogram(&pixels, 1, 1);

        let lum = hist.luminance();
        assert_eq!(lum.len(), 256);
        assert_eq!(lum[128], 1);
    }

    #[test]
    fn test_js_histogram_accessors_return_clones() {
        let pixels = vec![100, 100, 100];
        let hist = compute_histogram(&pixels, 1, 1);

        // Get red twice and verify they're independent
        let red1 = hist.red();
        let red2 = hist.red();

        assert_eq!(red1, red2);
        assert_eq!(red1.len(), 256);
    }

    // =========================================================================
    // Primary color tests
    // =========================================================================

    #[test]
    fn test_js_histogram_pure_red_pixel() {
        let pixels = vec![255, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[255], 1);
        assert_eq!(hist.green()[0], 1);
        assert_eq!(hist.blue()[0], 1);
        // Red has ~0.21 luminance coefficient, so luminance ≈ 54
        let lum = hist.luminance();
        let lum_index = lum.iter().position(|&v| v > 0).unwrap();
        assert!((lum_index as i32 - 54).abs() <= 2);
    }

    #[test]
    fn test_js_histogram_pure_green_pixel() {
        let pixels = vec![0, 255, 0];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[0], 1);
        assert_eq!(hist.green()[255], 1);
        assert_eq!(hist.blue()[0], 1);
        // Green has ~0.72 luminance coefficient, so luminance ≈ 182
        let lum = hist.luminance();
        let lum_index = lum.iter().position(|&v| v > 0).unwrap();
        assert!((lum_index as i32 - 182).abs() <= 2);
    }

    #[test]
    fn test_js_histogram_pure_blue_pixel() {
        let pixels = vec![0, 0, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[0], 1);
        assert_eq!(hist.green()[0], 1);
        assert_eq!(hist.blue()[255], 1);
        // Blue has ~0.07 luminance coefficient, so luminance ≈ 18
        let lum = hist.luminance();
        let lum_index = lum.iter().position(|&v| v > 0).unwrap();
        assert!((lum_index as i32 - 18).abs() <= 2);
    }

    #[test]
    fn test_js_histogram_white_pixel() {
        let pixels = vec![255, 255, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[255], 1);
        assert_eq!(hist.green()[255], 1);
        assert_eq!(hist.blue()[255], 1);
        assert_eq!(hist.luminance()[255], 1);
    }

    #[test]
    fn test_js_histogram_black_pixel() {
        let pixels = vec![0, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[0], 1);
        assert_eq!(hist.green()[0], 1);
        assert_eq!(hist.blue()[0], 1);
        assert_eq!(hist.luminance()[0], 1);
    }

    // =========================================================================
    // Max value calculation tests
    // =========================================================================

    #[test]
    fn test_js_histogram_max_value_single_pixel() {
        let pixels = vec![128, 128, 128];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.max_value(), 1);
    }

    #[test]
    fn test_js_histogram_max_value_multiple_same_pixels() {
        let pixels = vec![100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
        let hist = compute_histogram(&pixels, 4, 1);

        assert_eq!(hist.max_value(), 4);
    }

    #[test]
    fn test_js_histogram_max_value_spread_pixels() {
        // 4 different grayscale values, 1 each
        let pixels = vec![64, 64, 64, 128, 128, 128, 192, 192, 192, 255, 255, 255];
        let hist = compute_histogram(&pixels, 4, 1);

        assert_eq!(hist.max_value(), 1);
    }

    #[test]
    fn test_js_histogram_max_value_large_image() {
        // 100x100 image = 10,000 pixels all the same
        let pixels = vec![100u8; 100 * 100 * 3];
        let hist = compute_histogram(&pixels, 100, 100);

        assert_eq!(hist.max_value(), 10_000);
    }

    #[test]
    fn test_js_histogram_max_value_mixed_channels() {
        // Different values per channel
        let pixels = vec![
            50, 100, 150, 50, 100, 150, 50, 100, 150, // 3 pixels same
            200, 200, 200, // 1 different pixel
        ];
        let hist = compute_histogram(&pixels, 4, 1);

        // Red: 3 at bin 50, 1 at bin 200 -> max 3
        // Green: 3 at bin 100, 1 at bin 200 -> max 3
        // Blue: 3 at bin 150, 1 at bin 200 -> max 3
        assert_eq!(hist.max_value(), 3);
    }

    // =========================================================================
    // Multi-pixel and multi-row tests
    // =========================================================================

    #[test]
    fn test_js_histogram_2x2_image() {
        let pixels = vec![
            255, 0, 0, // Red
            0, 255, 0, // Green
            0, 0, 255, // Blue
            128, 128, 128, // Gray
        ];
        let hist = compute_histogram(&pixels, 2, 2);

        assert_eq!(hist.red()[255], 1);
        assert_eq!(hist.red()[0], 2);
        assert_eq!(hist.red()[128], 1);
        assert_eq!(hist.green()[255], 1);
        assert_eq!(hist.green()[0], 2);
        assert_eq!(hist.green()[128], 1);
        assert_eq!(hist.blue()[255], 1);
        assert_eq!(hist.blue()[0], 2);
        assert_eq!(hist.blue()[128], 1);
    }

    #[test]
    fn test_js_histogram_3x3_image() {
        // 9 pixels with various colors
        let pixels = vec![
            0, 0, 0, 50, 50, 50, 100, 100, 100, 128, 128, 128, 150, 150, 150, 180, 180, 180, 200,
            200, 200, 220, 220, 220, 255, 255, 255,
        ];
        let hist = compute_histogram(&pixels, 3, 3);

        // Each grayscale value should appear once
        assert_eq!(hist.red()[0], 1);
        assert_eq!(hist.red()[50], 1);
        assert_eq!(hist.red()[100], 1);
        assert_eq!(hist.red()[128], 1);
        assert_eq!(hist.red()[150], 1);
        assert_eq!(hist.red()[180], 1);
        assert_eq!(hist.red()[200], 1);
        assert_eq!(hist.red()[220], 1);
        assert_eq!(hist.red()[255], 1);
    }

    #[test]
    fn test_js_histogram_10x1_row() {
        // 10 pixels in a row
        let mut pixels = Vec::with_capacity(10 * 3);
        for i in 0..10 {
            let val = (i * 25) as u8;
            pixels.push(val);
            pixels.push(val);
            pixels.push(val);
        }
        let hist = compute_histogram(&pixels, 10, 1);

        // Check we have 10 distinct values
        let red_count: u32 = hist.red().iter().sum();
        assert_eq!(red_count, 10);
    }

    #[test]
    fn test_js_histogram_1x10_column() {
        // 10 pixels in a column (same as row functionally)
        let mut pixels = Vec::with_capacity(10 * 3);
        for i in 0..10 {
            let val = (i * 25) as u8;
            pixels.push(val);
            pixels.push(val);
            pixels.push(val);
        }
        let hist = compute_histogram(&pixels, 1, 10);

        let red_count: u32 = hist.red().iter().sum();
        assert_eq!(red_count, 10);
    }

    // =========================================================================
    // Edge cases and boundary tests
    // =========================================================================

    #[test]
    fn test_js_histogram_all_same_value() {
        let pixels = vec![77u8; 50 * 3];
        let hist = compute_histogram(&pixels, 50, 1);

        assert_eq!(hist.red()[77], 50);
        assert_eq!(hist.green()[77], 50);
        assert_eq!(hist.blue()[77], 50);
        assert_eq!(hist.max_value(), 50);
    }

    #[test]
    fn test_js_histogram_alternating_values() {
        // Alternate between 0 and 255
        let pixels = vec![0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255];
        let hist = compute_histogram(&pixels, 4, 1);

        assert_eq!(hist.red()[0], 2);
        assert_eq!(hist.red()[255], 2);
        assert_eq!(hist.max_value(), 2);
    }

    #[test]
    fn test_js_histogram_near_clipping_values() {
        // Values at 1 and 254 (near but not clipping)
        let pixels = vec![1, 1, 1, 254, 254, 254];
        let hist = compute_histogram(&pixels, 2, 1);

        assert!(!hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
        assert_eq!(hist.red()[1], 1);
        assert_eq!(hist.red()[254], 1);
    }

    #[test]
    fn test_js_histogram_different_values_per_channel() {
        // R=10, G=100, B=200 for a single pixel
        let pixels = vec![10, 100, 200];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.red()[10], 1);
        assert_eq!(hist.green()[100], 1);
        assert_eq!(hist.blue()[200], 1);

        // Verify no cross-talk
        assert_eq!(hist.red()[100], 0);
        assert_eq!(hist.red()[200], 0);
        assert_eq!(hist.green()[10], 0);
        assert_eq!(hist.green()[200], 0);
        assert_eq!(hist.blue()[10], 0);
        assert_eq!(hist.blue()[100], 0);
    }

    // =========================================================================
    // Luminance specific tests
    // =========================================================================

    #[test]
    fn test_js_histogram_luminance_gray_values() {
        // For gray pixels, luminance should equal the gray value
        let test_values = [0u8, 32, 64, 96, 128, 160, 192, 224, 255];
        for &val in &test_values {
            let pixels = vec![val, val, val];
            let hist = compute_histogram(&pixels, 1, 1);
            // Allow ±1 for rounding
            let lum = hist.luminance();
            let lum_index = lum.iter().position(|&v| v > 0).unwrap();
            assert!(
                (lum_index as i32 - val as i32).abs() <= 1,
                "Gray {} should have luminance near {}, got {}",
                val,
                val,
                lum_index
            );
        }
    }

    #[test]
    fn test_js_histogram_luminance_total_count() {
        let pixels = vec![100, 150, 200, 50, 75, 100, 200, 200, 200];
        let hist = compute_histogram(&pixels, 3, 1);

        let lum_total: u32 = hist.luminance().iter().sum();
        assert_eq!(lum_total, 3); // 3 pixels
    }

    // =========================================================================
    // Determinism and consistency tests
    // =========================================================================

    #[test]
    fn test_js_histogram_deterministic() {
        let pixels = vec![50, 100, 150, 200, 50, 100, 75, 125, 175];
        let hist1 = compute_histogram(&pixels, 3, 1);
        let hist2 = compute_histogram(&pixels, 3, 1);

        assert_eq!(hist1.red(), hist2.red());
        assert_eq!(hist1.green(), hist2.green());
        assert_eq!(hist1.blue(), hist2.blue());
        assert_eq!(hist1.luminance(), hist2.luminance());
        assert_eq!(hist1.max_value(), hist2.max_value());
        assert_eq!(hist1.has_highlight_clipping(), hist2.has_highlight_clipping());
        assert_eq!(hist1.has_shadow_clipping(), hist2.has_shadow_clipping());
    }

    #[test]
    fn test_js_histogram_width_height_consistency() {
        // Same data but different layout should produce same histogram
        let pixels = vec![100, 100, 100, 200, 200, 200, 50, 50, 50, 150, 150, 150];

        // 2x2 layout
        let hist_2x2 = compute_histogram(&pixels, 2, 2);
        // 4x1 layout
        let hist_4x1 = compute_histogram(&pixels, 4, 1);
        // 1x4 layout
        let hist_1x4 = compute_histogram(&pixels, 1, 4);

        assert_eq!(hist_2x2.red(), hist_4x1.red());
        assert_eq!(hist_2x2.red(), hist_1x4.red());
        assert_eq!(hist_2x2.max_value(), hist_4x1.max_value());
        assert_eq!(hist_2x2.max_value(), hist_1x4.max_value());
    }
}
