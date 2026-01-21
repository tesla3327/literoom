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
pub fn encode_jpeg(pixels: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, JsValue> {
    encode::encode_jpeg(pixels, width, height, quality).map_err(|e| JsValue::from_str(&e.to_string()))
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
/// Note: Most encode tests use functions that return `Result<T, JsValue>`, which
/// only work on wasm32 targets. For comprehensive encode testing, see the tests
/// in `literoom_core::encode` which test the underlying functionality.
#[cfg(test)]
mod tests {
    use super::*;

    // Tests that work on all targets

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
