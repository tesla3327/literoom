//! Histogram computation from RGB pixel data.
//!
//! This module provides functions for computing RGB and luminance histograms
//! from pixel data, used for the edit view histogram display.

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

        // Compute and bin luminance using ITU-R BT.709 coefficients
        let lum = calculate_luminance_u8(chunk[0], chunk[1], chunk[2]);
        hist.luminance[lum as usize] += 1;
    }

    hist
}

/// Calculate luminance from RGB using ITU-R BT.709 coefficients.
///
/// Returns a value in range 0-255.
///
/// # Arguments
/// * `r` - Red channel value (0-255)
/// * `g` - Green channel value (0-255)
/// * `b` - Blue channel value (0-255)
#[inline]
fn calculate_luminance_u8(r: u8, g: u8, b: u8) -> u8 {
    // ITU-R BT.709 coefficients: R=0.2126, G=0.7152, B=0.0722
    let lum = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
    // Clamp to valid range and round
    lum.clamp(0.0, 255.0).round() as u8
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
    fn test_luminance_calculation_pure_white() {
        assert_eq!(calculate_luminance_u8(255, 255, 255), 255);
    }

    #[test]
    fn test_luminance_calculation_pure_black() {
        assert_eq!(calculate_luminance_u8(0, 0, 0), 0);
    }

    #[test]
    fn test_luminance_calculation_gray() {
        let lum = calculate_luminance_u8(128, 128, 128);
        // ITU-R BT.709: 0.2126*128 + 0.7152*128 + 0.0722*128 = 128
        assert!((lum as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_luminance_calculation_pure_red() {
        let lum = calculate_luminance_u8(255, 0, 0);
        // ITU-R BT.709: 0.2126*255 = 54.21
        assert!((lum as i32 - 54).abs() <= 1);
    }

    #[test]
    fn test_luminance_calculation_pure_green() {
        let lum = calculate_luminance_u8(0, 255, 0);
        // ITU-R BT.709: 0.7152*255 = 182.38
        assert!((lum as i32 - 182).abs() <= 1);
    }

    #[test]
    fn test_luminance_calculation_pure_blue() {
        let lum = calculate_luminance_u8(0, 0, 255);
        // ITU-R BT.709: 0.0722*255 = 18.41
        assert!((lum as i32 - 18).abs() <= 1);
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
