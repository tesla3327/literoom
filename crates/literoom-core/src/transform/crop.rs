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
