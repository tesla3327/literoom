//! WASM bindings for image transformation operations.
//!
//! This module provides JavaScript bindings for rotation and crop operations,
//! enabling the preview and export pipelines to apply transforms.

use crate::types::JsDecodedImage;
use literoom_core::transform::{
    apply_crop as core_crop, apply_rotation as core_rotate, InterpolationFilter,
};
use wasm_bindgen::prelude::*;

/// Apply rotation to an image.
///
/// The image is rotated around its center. The output canvas is expanded
/// to fit the entire rotated image (no clipping).
///
/// # Arguments
///
/// * `image` - Source image to rotate
/// * `angle_degrees` - Rotation angle in degrees (positive = counter-clockwise)
/// * `use_lanczos` - Use high-quality Lanczos3 filter (slower), otherwise bilinear
///
/// # Returns
///
/// New `JsDecodedImage` with the rotated content. The dimensions may differ
/// from the source due to canvas expansion.
///
/// # Example (TypeScript)
///
/// ```typescript
/// // Preview rotation (fast, bilinear)
/// const rotated = apply_rotation(sourceImage, 15.0, false);
///
/// // Export rotation (high quality, lanczos)
/// const exported = apply_rotation(sourceImage, 15.0, true);
/// ```
#[wasm_bindgen]
pub fn apply_rotation(
    image: &JsDecodedImage,
    angle_degrees: f64,
    use_lanczos: bool,
) -> JsDecodedImage {
    let src = image.to_decoded();
    let filter = if use_lanczos {
        InterpolationFilter::Lanczos3
    } else {
        InterpolationFilter::Bilinear
    };

    let result = core_rotate(&src, angle_degrees, filter);
    JsDecodedImage::new(result.width, result.height, result.pixels)
}

/// Apply crop to an image using normalized coordinates.
///
/// Crops a region from the image using coordinates in the range [0, 1],
/// where (0, 0) is the top-left corner and (1, 1) is the bottom-right corner.
///
/// # Arguments
///
/// * `image` - Source image to crop
/// * `left` - Left edge position (0.0 to 1.0)
/// * `top` - Top edge position (0.0 to 1.0)
/// * `width` - Crop region width (0.0 to 1.0)
/// * `height` - Crop region height (0.0 to 1.0)
///
/// # Returns
///
/// New `JsDecodedImage` containing only the cropped region.
///
/// # Example (TypeScript)
///
/// ```typescript
/// // Crop the center 50% of the image
/// const cropped = apply_crop(sourceImage, 0.25, 0.25, 0.5, 0.5);
/// ```
#[wasm_bindgen]
pub fn apply_crop(
    image: &JsDecodedImage,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
) -> JsDecodedImage {
    let src = image.to_decoded();
    let result = core_crop(&src, left, top, width, height);
    JsDecodedImage::new(result.width, result.height, result.pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a simple test image.
    fn test_image(width: u32, height: u32) -> JsDecodedImage {
        let pixels: Vec<u8> = (0..(width * height * 3) as usize)
            .map(|i| (i % 256) as u8)
            .collect();
        JsDecodedImage::new(width, height, pixels)
    }

    #[test]
    fn test_rotation_no_change() {
        let img = test_image(100, 100);
        let result = apply_rotation(&img, 0.0, false);
        assert_eq!(result.width(), 100);
        assert_eq!(result.height(), 100);
    }

    #[test]
    fn test_rotation_90_degrees() {
        let img = test_image(100, 50);
        let result = apply_rotation(&img, 90.0, false);
        // 90-degree rotation swaps dimensions
        assert_eq!(result.width(), 50);
        assert_eq!(result.height(), 100);
    }

    #[test]
    fn test_rotation_45_degrees_expands() {
        let img = test_image(100, 100);
        let result = apply_rotation(&img, 45.0, false);
        // Diagonal rotation expands the canvas
        assert!(result.width() > 100);
        assert!(result.height() > 100);
    }

    #[test]
    fn test_rotation_bilinear_vs_lanczos() {
        let img = test_image(50, 50);
        let bilinear = apply_rotation(&img, 15.0, false);
        let lanczos = apply_rotation(&img, 15.0, true);

        // Same dimensions regardless of filter
        assert_eq!(bilinear.width(), lanczos.width());
        assert_eq!(bilinear.height(), lanczos.height());
    }

    #[test]
    fn test_crop_full_image() {
        let img = test_image(100, 100);
        let result = apply_crop(&img, 0.0, 0.0, 1.0, 1.0);
        assert_eq!(result.width(), 100);
        assert_eq!(result.height(), 100);
    }

    #[test]
    fn test_crop_half() {
        let img = test_image(100, 100);
        let result = apply_crop(&img, 0.0, 0.0, 0.5, 0.5);
        assert_eq!(result.width(), 50);
        assert_eq!(result.height(), 50);
    }

    #[test]
    fn test_crop_center() {
        let img = test_image(100, 100);
        let result = apply_crop(&img, 0.25, 0.25, 0.5, 0.5);
        assert_eq!(result.width(), 50);
        assert_eq!(result.height(), 50);
    }

    #[test]
    fn test_crop_non_square() {
        let img = test_image(200, 100);
        let result = apply_crop(&img, 0.0, 0.0, 0.5, 1.0);
        assert_eq!(result.width(), 100);
        assert_eq!(result.height(), 100);
    }
}
