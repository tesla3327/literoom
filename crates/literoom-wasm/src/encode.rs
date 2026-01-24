//! Image encoding WASM bindings.
//!
//! This module exposes the literoom-core JPEG encoding functions to JavaScript,
//! enabling the export workflow to encode processed images as JPEG files.
//!
//! # Functions
//!
//! - [`encode_jpeg`] - Encode RGB pixel data to JPEG bytes
//! - [`encode_jpeg_from_image`] - Encode a JsDecodedImage to JPEG bytes
//!
//! # Example
//!
//! ```typescript
//! import { encode_jpeg, encode_jpeg_from_image } from '@literoom/wasm';
//!
//! // Encode raw pixel data
//! const jpegBytes = encode_jpeg(pixels, width, height, 90);
//!
//! // Encode a decoded image
//! const jpegBytes = encode_jpeg_from_image(image, 90);
//! ```

use crate::types::JsDecodedImage;
use literoom_core::encode;
use wasm_bindgen::prelude::*;

/// Encode RGB pixel data to JPEG bytes.
///
/// This function takes raw RGB pixel data and encodes it to JPEG format with
/// the specified quality setting.
///
/// # Arguments
///
/// * `pixels` - RGB pixel data as a `Uint8Array` (3 bytes per pixel, row-major order)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// * `quality` - JPEG quality (1-100, where 100 is highest quality, recommended: 90)
///
/// # Returns
///
/// A `Uint8Array` containing the JPEG-encoded bytes, or an error if encoding fails.
///
/// # Errors
///
/// Returns an error if:
/// - The pixel data length doesn't match width * height * 3
/// - Width or height is zero
/// - Encoding fails internally
///
/// # Quality Guidelines
///
/// * 90-100: High quality, suitable for archival (Lightroom default: 90)
/// * 80-90: Good quality, recommended for most uses
/// * 60-80: Medium quality, acceptable for web/social media
/// * Below 60: Low quality, visible artifacts
///
/// # Example
///
/// ```typescript
/// // Create a gray 100x100 image
/// const pixels = new Uint8Array(100 * 100 * 3).fill(128);
/// const jpeg = encode_jpeg(pixels, 100, 100, 90);
/// console.log(`Encoded ${jpeg.byteLength} bytes`);
/// ```
#[wasm_bindgen]
pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    encode::encode_jpeg(pixels, width, height, quality)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Encode a JsDecodedImage to JPEG bytes.
///
/// This is a convenience function that extracts pixel data from a `JsDecodedImage`
/// and encodes it to JPEG format. Use this when you have an existing decoded image
/// from the processing pipeline.
///
/// # Arguments
///
/// * `image` - The decoded image to encode
/// * `quality` - JPEG quality (1-100, where 100 is highest quality, recommended: 90)
///
/// # Returns
///
/// A `Uint8Array` containing the JPEG-encoded bytes, or an error if encoding fails.
///
/// # Example
///
/// ```typescript
/// // After processing an image through the pipeline
/// const processed = apply_adjustments(decoded, adjustments);
/// const jpeg = encode_jpeg_from_image(processed, 90);
///
/// // Write to file via File System Access API
/// const writable = await fileHandle.createWritable();
/// await writable.write(new Blob([jpeg], { type: 'image/jpeg' }));
/// await writable.close();
/// ```
#[wasm_bindgen]
pub fn encode_jpeg_from_image(image: &JsDecodedImage, quality: u8) -> Result<Vec<u8>, JsValue> {
    let pixels = image.pixels();
    encode::encode_jpeg(&pixels, image.width(), image.height(), quality)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Tests for encode bindings.
///
/// These tests verify the encode bindings work correctly on native targets.
/// Tests that require `JsValue` are in the `wasm_tests` module below.
#[cfg(test)]
mod tests {
    use super::*;

    // Tests that work on all targets by using the underlying core functions

    #[test]
    fn test_encode_jpeg_from_image_creates_valid_jpeg() {
        let img = JsDecodedImage::new(10, 10, vec![128u8; 10 * 10 * 3]);

        // We can't test JsValue results on non-wasm targets,
        // but we can verify the function compiles and runs
        let pixels = img.pixels();
        let result = literoom_core::encode::encode_jpeg(&pixels, img.width(), img.height(), 90);
        assert!(result.is_ok());

        let jpeg = result.unwrap();
        // Verify JPEG magic bytes
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn test_encode_jpeg_small_image() {
        let img = JsDecodedImage::new(1, 1, vec![255, 0, 0]); // Red pixel

        let pixels = img.pixels();
        let result = encode::encode_jpeg(&pixels, img.width(), img.height(), 90);
        assert!(result.is_ok());

        let jpeg = result.unwrap();
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]); // SOI marker
        let len = jpeg.len();
        assert_eq!(&jpeg[len - 2..], &[0xFF, 0xD9]); // EOI marker
    }

    #[test]
    fn test_encode_jpeg_various_sizes() {
        // Test various image dimensions
        let test_cases = [
            (10, 10),
            (50, 50),
            (100, 50), // Wide
            (50, 100), // Tall
            (1, 100),  // Very thin
            (100, 1),  // Very wide
        ];

        for (width, height) in test_cases {
            let pixels = vec![128u8; width * height * 3];
            let img = JsDecodedImage::new(width as u32, height as u32, pixels);

            let pixel_data = img.pixels();
            let result = encode::encode_jpeg(&pixel_data, img.width(), img.height(), 90);

            assert!(
                result.is_ok(),
                "Failed to encode {}x{} image",
                width,
                height
            );

            let jpeg = result.unwrap();
            assert_eq!(
                &jpeg[0..2],
                &[0xFF, 0xD8],
                "Invalid JPEG header for {}x{}",
                width,
                height
            );
        }
    }

    #[test]
    fn test_encode_jpeg_quality_levels() {
        let img = JsDecodedImage::new(50, 50, vec![128u8; 50 * 50 * 3]);
        let pixels = img.pixels();

        // Test all typical quality levels
        let quality_levels = [1, 10, 25, 50, 75, 90, 95, 100];

        for quality in quality_levels {
            let result = encode::encode_jpeg(&pixels, img.width(), img.height(), quality);
            assert!(
                result.is_ok(),
                "Failed to encode with quality {}",
                quality
            );

            let jpeg = result.unwrap();
            assert!(jpeg.len() > 0, "Empty output for quality {}", quality);
        }
    }

    #[test]
    fn test_encode_jpeg_invalid_dimensions_zero_width() {
        let pixels = vec![];
        let result = encode::encode_jpeg(&pixels, 0, 100, 90);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(encode::EncodeError::InvalidDimensions { .. })),
            "Expected InvalidDimensions error"
        );
    }

    #[test]
    fn test_encode_jpeg_invalid_dimensions_zero_height() {
        let pixels = vec![];
        let result = encode::encode_jpeg(&pixels, 100, 0, 90);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(encode::EncodeError::InvalidDimensions { .. })),
            "Expected InvalidDimensions error"
        );
    }

    #[test]
    fn test_encode_jpeg_invalid_pixel_data_too_short() {
        let pixels = vec![128u8; 99 * 100 * 3]; // One row short
        let result = encode::encode_jpeg(&pixels, 100, 100, 90);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(encode::EncodeError::InvalidPixelData { .. })),
            "Expected InvalidPixelData error"
        );
    }

    #[test]
    fn test_encode_jpeg_invalid_pixel_data_too_long() {
        let pixels = vec![128u8; 101 * 100 * 3]; // One row extra
        let result = encode::encode_jpeg(&pixels, 100, 100, 90);
        assert!(result.is_err());
        assert!(
            matches!(result, Err(encode::EncodeError::InvalidPixelData { .. })),
            "Expected InvalidPixelData error"
        );
    }

    #[test]
    fn test_encode_jpeg_gradient_image() {
        // Create a gradient image to ensure complex content encodes correctly
        let width = 50;
        let height = 50;
        let mut pixels = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let r = (x * 255 / width) as u8;
                let g = (y * 255 / height) as u8;
                let b = 128u8;
                pixels.push(r);
                pixels.push(g);
                pixels.push(b);
            }
        }

        let img = JsDecodedImage::new(width as u32, height as u32, pixels);
        let pixel_data = img.pixels();
        let result = encode::encode_jpeg(&pixel_data, img.width(), img.height(), 90);

        assert!(result.is_ok());
        let jpeg = result.unwrap();
        assert!(jpeg.len() > 100, "Gradient image should produce substantial output");
    }

    #[test]
    fn test_encode_jpeg_black_and_white_images() {
        let width = 20;
        let height = 20;

        // All black
        let black_pixels = vec![0u8; width * height * 3];
        let result = encode::encode_jpeg(&black_pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());

        // All white
        let white_pixels = vec![255u8; width * height * 3];
        let result = encode::encode_jpeg(&white_pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());
    }

    #[test]
    fn test_encode_jpeg_primary_colors() {
        let width = 10;
        let height = 10;

        // Red
        let mut red_pixels = Vec::with_capacity(width * height * 3);
        for _ in 0..(width * height) {
            red_pixels.extend_from_slice(&[255, 0, 0]);
        }
        let result = encode::encode_jpeg(&red_pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());

        // Green
        let mut green_pixels = Vec::with_capacity(width * height * 3);
        for _ in 0..(width * height) {
            green_pixels.extend_from_slice(&[0, 255, 0]);
        }
        let result = encode::encode_jpeg(&green_pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());

        // Blue
        let mut blue_pixels = Vec::with_capacity(width * height * 3);
        for _ in 0..(width * height) {
            blue_pixels.extend_from_slice(&[0, 0, 255]);
        }
        let result = encode::encode_jpeg(&blue_pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());
    }

    #[test]
    fn test_encode_jpeg_quality_affects_file_size() {
        let width = 50;
        let height = 50;

        // Create a complex image (gradient) where quality difference is visible
        let mut pixels = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            for x in 0..width {
                pixels.push(((x * 255) / width) as u8);
                pixels.push(((y * 255) / height) as u8);
                pixels.push(((x + y) * 127 / (width + height)) as u8);
            }
        }

        let low_q = encode::encode_jpeg(&pixels, width as u32, height as u32, 10).unwrap();
        let high_q = encode::encode_jpeg(&pixels, width as u32, height as u32, 100).unwrap();

        // High quality should be larger (or at least not much smaller)
        assert!(
            high_q.len() > low_q.len() || (low_q.len() as f64 / high_q.len() as f64) < 1.5,
            "High quality ({}) should generally be larger than low quality ({})",
            high_q.len(),
            low_q.len()
        );
    }

    #[test]
    fn test_encode_jpeg_deterministic() {
        let pixels = vec![128u8; 20 * 20 * 3];

        let result1 = encode::encode_jpeg(&pixels, 20, 20, 90).unwrap();
        let result2 = encode::encode_jpeg(&pixels, 20, 20, 90).unwrap();

        assert_eq!(result1, result2, "Same input should produce same output");
    }

    #[test]
    fn test_js_decoded_image_to_jpeg_roundtrip_structure() {
        // Test the JsDecodedImage workflow without JsValue
        let original = JsDecodedImage::new(30, 30, vec![100u8; 30 * 30 * 3]);

        // Verify dimensions preserved
        assert_eq!(original.width(), 30);
        assert_eq!(original.height(), 30);
        assert_eq!(original.byte_length(), 30 * 30 * 3);

        // Encode to JPEG
        let pixels = original.pixels();
        let jpeg = encode::encode_jpeg(&pixels, original.width(), original.height(), 90).unwrap();

        // Verify JPEG structure
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
        let len = jpeg.len();
        assert_eq!(&jpeg[len - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn test_encode_jpeg_extreme_aspect_ratios() {
        // Very wide
        let wide = vec![128u8; 200 * 10 * 3];
        assert!(encode::encode_jpeg(&wide, 200, 10, 90).is_ok());

        // Very tall
        let tall = vec![128u8; 10 * 200 * 3];
        assert!(encode::encode_jpeg(&tall, 10, 200, 90).is_ok());
    }

    #[test]
    fn test_encode_jpeg_quality_clamping() {
        let pixels = vec![128u8; 10 * 10 * 3];

        // Quality 0 should be clamped to 1
        let result = encode::encode_jpeg(&pixels, 10, 10, 0);
        assert!(result.is_ok());

        // Quality 255 should be clamped to 100
        let result = encode::encode_jpeg(&pixels, 10, 10, 255);
        assert!(result.is_ok());
    }
}

/// WASM-specific tests that require JsValue.
///
/// These tests use functions that return `Result<T, JsValue>` and can only
/// run on wasm32 targets. Use `wasm-pack test` to run these.
#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_encode_jpeg_basic() {
        let pixels = vec![128u8; 100 * 100 * 3];
        let result = encode_jpeg(&pixels, 100, 100, 90);
        assert!(result.is_ok());

        let jpeg = result.unwrap();
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
    }

    #[wasm_bindgen_test]
    fn test_encode_jpeg_invalid_dimensions() {
        let pixels = vec![128u8; 100];
        let result = encode_jpeg(&pixels, 0, 100, 90);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_encode_jpeg_invalid_pixel_data() {
        let pixels = vec![128u8; 50 * 50 * 3]; // Wrong size for 100x100
        let result = encode_jpeg(&pixels, 100, 100, 90);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_encode_jpeg_from_image() {
        let img = JsDecodedImage::new(50, 50, vec![128u8; 50 * 50 * 3]);
        let result = encode_jpeg_from_image(&img, 90);
        assert!(result.is_ok());

        let jpeg = result.unwrap();
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
    }

    #[wasm_bindgen_test]
    fn test_encode_jpeg_quality_range() {
        let pixels = vec![128u8; 50 * 50 * 3];

        // Low quality
        let low = encode_jpeg(&pixels, 50, 50, 20).unwrap();
        // High quality
        let high = encode_jpeg(&pixels, 50, 50, 95).unwrap();

        // Both should be valid JPEGs
        assert_eq!(&low[0..2], &[0xFF, 0xD8]);
        assert_eq!(&high[0..2], &[0xFF, 0xD8]);
    }
}
