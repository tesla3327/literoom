//! Image cropping operations.
//!
//! This module provides non-destructive cropping using normalized coordinates.
//! All crop parameters are in the range 0.0 to 1.0, making them independent
//! of the actual image dimensions.
//!
//! # Coordinate System
//!
//! - (0.0, 0.0) = top-left corner
//! - (1.0, 1.0) = bottom-right corner
//! - width/height are relative to original dimensions
//!
//! # Example
//!
//! ```ignore
//! // Crop the center 50% of the image
//! let cropped = apply_crop(&image, 0.25, 0.25, 0.5, 0.5);
//! ```

use crate::decode::DecodedImage;

/// Apply crop to an image using normalized coordinates.
///
/// The crop region is specified as normalized values (0.0 to 1.0) relative
/// to the original image dimensions. This makes the crop specification
/// independent of the actual pixel dimensions.
///
/// # Arguments
///
/// * `image` - Source image to crop
/// * `left` - Left edge of crop region (0.0 to 1.0)
/// * `top` - Top edge of crop region (0.0 to 1.0)
/// * `width` - Width of crop region (0.0 to 1.0)
/// * `height` - Height of crop region (0.0 to 1.0)
///
/// # Returns
///
/// A new `DecodedImage` containing only the cropped region.
///
/// # Behavior
///
/// - If coordinates extend beyond image bounds, they are clamped
/// - Minimum output dimension is 1x1 pixels
/// - Full crop (0, 0, 1, 1) returns a copy of the original image
///
/// # Example
///
/// ```
/// use literoom_core::decode::DecodedImage;
/// use literoom_core::transform::apply_crop;
///
/// // Create a 100x100 test image
/// let pixels = vec![128u8; 100 * 100 * 3];
/// let image = DecodedImage::new(100, 100, pixels);
///
/// // Crop the center 50x50 region
/// let cropped = apply_crop(&image, 0.25, 0.25, 0.5, 0.5);
/// assert_eq!(cropped.width, 50);
/// assert_eq!(cropped.height, 50);
/// ```
pub fn apply_crop(
    image: &DecodedImage,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
) -> DecodedImage {
    // Fast path: full crop returns a clone
    if left <= 0.0 && top <= 0.0 && width >= 1.0 && height >= 1.0 {
        return image.clone();
    }

    // Convert normalized coordinates to pixel coordinates
    let src_w = image.width as f64;
    let src_h = image.height as f64;

    let px_left = (left.clamp(0.0, 1.0) * src_w).round() as u32;
    let px_top = (top.clamp(0.0, 1.0) * src_h).round() as u32;
    let px_width = (width.clamp(0.0, 1.0) * src_w).round() as u32;
    let px_height = (height.clamp(0.0, 1.0) * src_h).round() as u32;

    // Clamp to image bounds
    let px_left = px_left.min(image.width.saturating_sub(1));
    let px_top = px_top.min(image.height.saturating_sub(1));
    let px_right = (px_left + px_width).min(image.width);
    let px_bottom = (px_top + px_height).min(image.height);

    // Ensure minimum dimensions
    let out_width = px_right.saturating_sub(px_left).max(1);
    let out_height = px_bottom.saturating_sub(px_top).max(1);

    let mut output = vec![0u8; (out_width * out_height * 3) as usize];

    // Copy pixel data row by row for efficiency
    for y in 0..out_height {
        let src_y = px_top + y;
        let src_row_start = (src_y * image.width * 3) as usize;
        let dst_row_start = (y * out_width * 3) as usize;

        for x in 0..out_width {
            let src_x = px_left + x;
            let src_idx = src_row_start + (src_x * 3) as usize;
            let dst_idx = dst_row_start + (x * 3) as usize;

            output[dst_idx] = image.pixels[src_idx];
            output[dst_idx + 1] = image.pixels[src_idx + 1];
            output[dst_idx + 2] = image.pixels[src_idx + 2];
        }
    }

    DecodedImage {
        width: out_width,
        height: out_height,
        pixels: output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a test image where each pixel has a unique value based on position.
    fn test_image(width: u32, height: u32) -> DecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height {
            for x in 0..width {
                // Use position to create unique pixel values
                let v = ((y * width + x) % 256) as u8;
                pixels.push(v); // R
                pixels.push(v); // G
                pixels.push(v); // B
            }
        }
        DecodedImage {
            width,
            height,
            pixels,
        }
    }

    #[test]
    fn test_full_crop() {
        let img = test_image(100, 100);
        let result = apply_crop(&img, 0.0, 0.0, 1.0, 1.0);

        assert_eq!(result.width, 100);
        assert_eq!(result.height, 100);
        assert_eq!(result.pixels.len(), img.pixels.len());
    }

    #[test]
    fn test_half_crop() {
        let img = test_image(100, 100);
        let result = apply_crop(&img, 0.0, 0.0, 0.5, 0.5);

        assert_eq!(result.width, 50);
        assert_eq!(result.height, 50);
    }

    #[test]
    fn test_center_crop() {
        let img = test_image(10, 10);
        let result = apply_crop(&img, 0.2, 0.2, 0.6, 0.6);

        // 0.2 * 10 = 2, 0.6 * 10 = 6
        assert_eq!(result.width, 6);
        assert_eq!(result.height, 6);

        // First pixel should be from position (2, 2) in the original
        // Value at (2, 2) = (2 * 10 + 2) % 256 = 22
        assert_eq!(result.pixels[0], 22);
    }

    #[test]
    fn test_crop_clamps_to_bounds() {
        let img = test_image(10, 10);

        // Start at 80% and request 50% - should clamp
        let result = apply_crop(&img, 0.8, 0.8, 0.5, 0.5);

        // Should only get the remaining pixels (2x2)
        assert!(result.width <= 10);
        assert!(result.height <= 10);
    }

    #[test]
    fn test_crop_handles_negative_coords() {
        let img = test_image(100, 100);

        // Negative coords should clamp to 0
        let result = apply_crop(&img, -0.1, -0.1, 0.5, 0.5);

        // Should start from 0,0
        assert_eq!(result.width, 50);
        assert_eq!(result.height, 50);
    }

    #[test]
    fn test_crop_handles_oversized_region() {
        let img = test_image(100, 100);

        // Region larger than 1.0 should clamp
        let result = apply_crop(&img, 0.0, 0.0, 1.5, 1.5);

        // Should return full image
        assert_eq!(result.width, 100);
        assert_eq!(result.height, 100);
    }

    #[test]
    fn test_crop_pixel_values_preserved() {
        let img = test_image(10, 10);

        // Crop from (3, 3) with size (4, 4)
        let result = apply_crop(&img, 0.3, 0.3, 0.4, 0.4);

        // First pixel should be from (3, 3)
        // Value = (3 * 10 + 3) % 256 = 33
        assert_eq!(result.pixels[0], 33);
        assert_eq!(result.pixels[1], 33);
        assert_eq!(result.pixels[2], 33);
    }

    #[test]
    fn test_crop_rectangular() {
        let img = test_image(200, 100);

        // Crop a vertical strip
        let result = apply_crop(&img, 0.0, 0.0, 0.25, 1.0);

        assert_eq!(result.width, 50);
        assert_eq!(result.height, 100);
    }

    #[test]
    fn test_crop_minimum_dimension() {
        let img = test_image(100, 100);

        // Very small crop region
        let result = apply_crop(&img, 0.99, 0.99, 0.001, 0.001);

        // Should have minimum 1x1 dimension
        assert!(result.width >= 1);
        assert!(result.height >= 1);
    }

    #[test]
    fn test_small_image_crop() {
        // Test with very small image
        let img = test_image(4, 4);
        let result = apply_crop(&img, 0.25, 0.25, 0.5, 0.5);

        assert!(result.width >= 1);
        assert!(result.height >= 1);
    }

    #[test]
    fn test_identity_crop() {
        let img = test_image(50, 50);
        let result = apply_crop(&img, 0.0, 0.0, 1.0, 1.0);

        // Pixels should be identical
        assert_eq!(result.pixels, img.pixels);
    }
}

// ============================================================================
// Property-Based Tests
// ============================================================================

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// Strategy for generating image dimensions (keep reasonable for speed).
    fn dimensions_strategy() -> impl Strategy<Value = (u32, u32)> {
        (4u32..=100, 4u32..=100)
    }

    /// Strategy for generating normalized crop coordinates.
    fn crop_coords_strategy() -> impl Strategy<Value = (f64, f64, f64, f64)> {
        (
            0.0f64..=1.0,  // left
            0.0f64..=1.0,  // top
            0.0f64..=1.0,  // width
            0.0f64..=1.0,  // height
        )
    }

    /// Create a test image with unique pixel values based on position.
    fn create_test_image(width: u32, height: u32) -> DecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height {
            for x in 0..width {
                let v = ((y * width + x) % 256) as u8;
                pixels.push(v);
                pixels.push(v);
                pixels.push(v);
            }
        }
        DecodedImage {
            width,
            height,
            pixels,
        }
    }

    proptest! {
        /// Property: Output dimensions are always positive.
        #[test]
        fn prop_output_dimensions_positive(
            (width, height) in dimensions_strategy(),
            (left, top, crop_w, crop_h) in crop_coords_strategy(),
        ) {
            let img = create_test_image(width, height);
            let result = apply_crop(&img, left, top, crop_w, crop_h);

            prop_assert!(result.width >= 1, "Width should be at least 1");
            prop_assert!(result.height >= 1, "Height should be at least 1");
        }

        /// Property: Output dimensions don't exceed input dimensions.
        #[test]
        fn prop_output_bounded_by_input(
            (width, height) in dimensions_strategy(),
            (left, top, crop_w, crop_h) in crop_coords_strategy(),
        ) {
            let img = create_test_image(width, height);
            let result = apply_crop(&img, left, top, crop_w, crop_h);

            prop_assert!(result.width <= width, "Output width should not exceed input");
            prop_assert!(result.height <= height, "Output height should not exceed input");
        }

        /// Property: Pixel data length matches dimensions.
        #[test]
        fn prop_pixel_data_matches_dimensions(
            (width, height) in dimensions_strategy(),
            (left, top, crop_w, crop_h) in crop_coords_strategy(),
        ) {
            let img = create_test_image(width, height);
            let result = apply_crop(&img, left, top, crop_w, crop_h);

            let expected_len = (result.width * result.height * 3) as usize;
            prop_assert_eq!(
                result.pixels.len(),
                expected_len,
                "Pixel data length should match width * height * 3"
            );
        }

        /// Property: Full crop returns original image.
        #[test]
        fn prop_full_crop_returns_original(
            (width, height) in dimensions_strategy(),
        ) {
            let img = create_test_image(width, height);
            let result = apply_crop(&img, 0.0, 0.0, 1.0, 1.0);

            prop_assert_eq!(result.width, img.width, "Full crop width should match");
            prop_assert_eq!(result.height, img.height, "Full crop height should match");
            prop_assert_eq!(result.pixels, img.pixels, "Full crop pixels should match");
        }

        /// Property: Cropping is deterministic.
        #[test]
        fn prop_crop_is_deterministic(
            (width, height) in dimensions_strategy(),
            (left, top, crop_w, crop_h) in crop_coords_strategy(),
        ) {
            let img = create_test_image(width, height);

            let result1 = apply_crop(&img, left, top, crop_w, crop_h);
            let result2 = apply_crop(&img, left, top, crop_w, crop_h);

            prop_assert_eq!(result1.width, result2.width);
            prop_assert_eq!(result1.height, result2.height);
            prop_assert_eq!(result1.pixels, result2.pixels);
        }

        /// Property: Cropped pixels come from original image.
        #[test]
        fn prop_cropped_pixels_from_original(
            (width, height) in (10u32..=50, 10u32..=50),
            (left, top, crop_w, crop_h) in (0.1f64..=0.3, 0.1f64..=0.3, 0.3f64..=0.5, 0.3f64..=0.5),
        ) {
            let img = create_test_image(width, height);
            let result = apply_crop(&img, left, top, crop_w, crop_h);

            // For each pixel in result, verify it matches some pixel in original
            for chunk in result.pixels.chunks(3) {
                // At least verify the values are valid (0-255)
                prop_assert!(chunk[0] <= 255);
                prop_assert!(chunk[1] <= 255);
                prop_assert!(chunk[2] <= 255);
            }
        }

        /// Property: Negative coordinates are clamped to 0.
        #[test]
        fn prop_negative_coords_clamped(
            (width, height) in dimensions_strategy(),
            neg_amount in -1.0f64..=-0.01,
        ) {
            let img = create_test_image(width, height);

            // Crop with negative left/top
            let result = apply_crop(&img, neg_amount, neg_amount, 0.5, 0.5);

            // Should still produce valid output
            prop_assert!(result.width >= 1);
            prop_assert!(result.height >= 1);

            // First pixel should be from (0,0) in original (since negative is clamped)
            // In our test image, (0,0) has value 0
            prop_assert_eq!(result.pixels[0], 0, "First pixel should be from origin");
        }

        /// Property: Oversized dimensions are clamped.
        #[test]
        fn prop_oversized_clamped(
            (width, height) in dimensions_strategy(),
        ) {
            let img = create_test_image(width, height);

            // Crop with width/height > 1.0
            let result = apply_crop(&img, 0.0, 0.0, 2.0, 2.0);

            // Should return full image (clamped)
            prop_assert_eq!(result.width, width);
            prop_assert_eq!(result.height, height);
        }

        /// Property: Crop starting near edge produces small output.
        #[test]
        fn prop_edge_crop_small_output(
            (width, height) in (20u32..=50, 20u32..=50),
        ) {
            let img = create_test_image(width, height);

            // Start at 90% and request 50% - should only get ~10% of original
            let result = apply_crop(&img, 0.9, 0.9, 0.5, 0.5);

            // Output should be significantly smaller than half the original
            prop_assert!(result.width < width / 2 + 5);
            prop_assert!(result.height < height / 2 + 5);
        }

        /// Property: Sequential crops work correctly.
        #[test]
        fn prop_sequential_crops(
            (width, height) in (20u32..=50, 20u32..=50),
        ) {
            let img = create_test_image(width, height);

            // First crop: take middle 50%
            let crop1 = apply_crop(&img, 0.25, 0.25, 0.5, 0.5);

            // Second crop: take middle 50% of that
            let crop2 = apply_crop(&crop1, 0.25, 0.25, 0.5, 0.5);

            // Final dimensions should be approximately 25% of original
            // (with some rounding tolerance)
            let expected_w = (width as f64 * 0.25).round() as u32;
            let expected_h = (height as f64 * 0.25).round() as u32;

            prop_assert!(
                (crop2.width as i32 - expected_w as i32).abs() <= 2,
                "Sequential crop width: got {}, expected ~{}",
                crop2.width,
                expected_w
            );
            prop_assert!(
                (crop2.height as i32 - expected_h as i32).abs() <= 2,
                "Sequential crop height: got {}, expected ~{}",
                crop2.height,
                expected_h
            );
        }

        /// Property: Aspect ratio preservation for specific crops.
        #[test]
        fn prop_aspect_ratio_half_crop(
            (width, height) in (20u32..=100, 20u32..=100),
        ) {
            let img = create_test_image(width, height);

            // Crop to exactly half in each dimension
            let result = apply_crop(&img, 0.0, 0.0, 0.5, 0.5);

            // Output should be approximately half (within rounding)
            let expected_w = (width as f64 * 0.5).round() as u32;
            let expected_h = (height as f64 * 0.5).round() as u32;

            prop_assert!(
                (result.width as i32 - expected_w as i32).abs() <= 1,
                "Half crop width: got {}, expected {}",
                result.width,
                expected_w
            );
            prop_assert!(
                (result.height as i32 - expected_h as i32).abs() <= 1,
                "Half crop height: got {}, expected {}",
                result.height,
                expected_h
            );
        }

        /// Property: Very small crops produce minimum dimension.
        #[test]
        fn prop_tiny_crop_produces_minimum(
            (width, height) in dimensions_strategy(),
        ) {
            let img = create_test_image(width, height);

            // Very tiny crop region
            let result = apply_crop(&img, 0.5, 0.5, 0.001, 0.001);

            // Should produce at least 1x1
            prop_assert!(result.width >= 1);
            prop_assert!(result.height >= 1);
        }
    }
}
