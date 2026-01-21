//! Image decoding WASM bindings.
//!
//! This module exposes the literoom-core image decoding functions to JavaScript,
//! providing JPEG decoding, RAW thumbnail extraction, and image resizing.
//!
//! # Functions
//!
//! - [`decode_jpeg`] - Decode a JPEG image from bytes
//! - [`extract_raw_thumbnail_bytes`] - Extract embedded JPEG bytes from a RAW file
//! - [`decode_raw_thumbnail`] - Extract and decode the embedded thumbnail from a RAW file
//! - [`is_raw_file`] - Check if bytes represent a RAW file (TIFF-based)
//! - [`resize`] - Resize an image to exact dimensions
//! - [`resize_to_fit`] - Resize an image to fit within a max edge, preserving aspect ratio
//! - [`generate_thumbnail`] - Generate a thumbnail for grid display
//!
//! # Example
//!
//! ```typescript
//! import { decode_jpeg, resize_to_fit, is_raw_file } from '@literoom/wasm';
//!
//! const bytes = new Uint8Array(await file.arrayBuffer());
//!
//! if (is_raw_file(bytes)) {
//!   const thumbnail = decode_raw_thumbnail(bytes);
//!   console.log(`RAW thumbnail: ${thumbnail.width}x${thumbnail.height}`);
//! } else {
//!   const image = decode_jpeg(bytes);
//!   const preview = resize_to_fit(image, 2560, 2); // Lanczos3 filter
//!   console.log(`Preview: ${preview.width}x${preview.height}`);
//! }
//! ```

use crate::types::{filter_from_u8, JsDecodedImage};
use literoom_core::decode;
use wasm_bindgen::prelude::*;

/// Decode a JPEG image from bytes.
///
/// This function decodes JPEG data and automatically applies EXIF orientation
/// correction to ensure the image is displayed correctly.
///
/// # Arguments
///
/// * `bytes` - The raw JPEG file bytes as a `Uint8Array`
///
/// # Returns
///
/// A `JsDecodedImage` containing the decoded RGB pixel data, or an error if
/// decoding fails.
///
/// # Errors
///
/// Returns an error if:
/// - The bytes are not valid JPEG data
/// - The JPEG is corrupted or truncated
///
/// # Example
///
/// ```typescript
/// const bytes = new Uint8Array(await file.arrayBuffer());
/// const image = decode_jpeg(bytes);
/// console.log(`Decoded ${image.width}x${image.height} image`);
/// ```
#[wasm_bindgen]
pub fn decode_jpeg(bytes: &[u8]) -> Result<JsDecodedImage, JsValue> {
    decode::decode_jpeg(bytes)
        .map(JsDecodedImage::from_decoded)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Extract the embedded JPEG thumbnail bytes from a RAW file.
///
/// RAW files (like Sony ARW) typically contain an embedded JPEG preview.
/// This function extracts those bytes without decoding them, which is useful
/// if you want to pass them to another decoder or cache them separately.
///
/// # Arguments
///
/// * `bytes` - The raw RAW file bytes as a `Uint8Array`
///
/// # Returns
///
/// A `Uint8Array` containing the embedded JPEG bytes, or an error if extraction fails.
///
/// # Errors
///
/// Returns an error if:
/// - The file is not a valid RAW format
/// - No embedded thumbnail is found
///
/// # Example
///
/// ```typescript
/// const rawBytes = new Uint8Array(await file.arrayBuffer());
/// const jpegBytes = extract_raw_thumbnail_bytes(rawBytes);
/// // jpegBytes can now be decoded with decode_jpeg or used elsewhere
/// ```
#[wasm_bindgen]
pub fn extract_raw_thumbnail_bytes(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    decode::extract_raw_thumbnail(bytes).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Extract and decode the embedded thumbnail from a RAW file.
///
/// This is a convenience function that combines `extract_raw_thumbnail_bytes`
/// and `decode_jpeg` into a single operation. It extracts the embedded JPEG
/// from the RAW file and decodes it to RGB pixel data.
///
/// This is the "fast path" for displaying RAW files - the embedded thumbnail
/// can be extracted and decoded in under 50ms, compared to 1-2 seconds for
/// full RAW decoding.
///
/// # Arguments
///
/// * `bytes` - The raw RAW file bytes as a `Uint8Array`
///
/// # Returns
///
/// A `JsDecodedImage` containing the decoded thumbnail, or an error if
/// extraction or decoding fails.
///
/// # Errors
///
/// Returns an error if:
/// - The file is not a valid RAW format
/// - No embedded thumbnail is found
/// - The embedded JPEG is corrupted
///
/// # Example
///
/// ```typescript
/// if (is_raw_file(bytes)) {
///   const thumbnail = decode_raw_thumbnail(bytes);
///   // thumbnail is typically 1616x1080 for Sony ARW files
/// }
/// ```
#[wasm_bindgen]
pub fn decode_raw_thumbnail(bytes: &[u8]) -> Result<JsDecodedImage, JsValue> {
    decode::decode_raw_thumbnail(bytes)
        .map(JsDecodedImage::from_decoded)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Check if bytes represent a RAW file (TIFF-based format).
///
/// This performs a quick header check to determine if the file is a TIFF-based
/// RAW format (like Sony ARW, Canon CR2, Nikon NEF, etc.). It checks for the
/// TIFF magic bytes at the start of the file.
///
/// # Arguments
///
/// * `bytes` - The file bytes to check (only the first 8 bytes are examined)
///
/// # Returns
///
/// `true` if the file appears to be a TIFF-based RAW file, `false` otherwise.
///
/// # Example
///
/// ```typescript
/// if (is_raw_file(bytes)) {
///   const thumbnail = decode_raw_thumbnail(bytes);
/// } else {
///   const image = decode_jpeg(bytes);
/// }
/// ```
#[wasm_bindgen]
pub fn is_raw_file(bytes: &[u8]) -> bool {
    decode::is_raw_file(bytes)
}

/// Resize an image to exact dimensions.
///
/// This function resizes the image to the specified width and height, regardless
/// of the original aspect ratio. If you want to preserve aspect ratio, use
/// `resize_to_fit` instead.
///
/// # Arguments
///
/// * `image` - The source image to resize
/// * `width` - Target width in pixels
/// * `height` - Target height in pixels
/// * `filter` - Resize algorithm: 0=Nearest (fastest), 1=Bilinear (default), 2=Lanczos3 (best quality)
///
/// # Returns
///
/// A new `JsDecodedImage` with the resized pixel data, or an error if resizing fails.
///
/// # Errors
///
/// Returns an error if:
/// - Width or height is zero
///
/// # Example
///
/// ```typescript
/// const resized = resize(image, 800, 600, 2); // Lanczos3
/// ```
#[wasm_bindgen]
pub fn resize(
    image: &JsDecodedImage,
    width: u32,
    height: u32,
    filter: u8,
) -> Result<JsDecodedImage, JsValue> {
    let decoded = image.to_decoded();
    let filter_type = filter_from_u8(filter);

    decode::resize(&decoded, width, height, filter_type)
        .map(JsDecodedImage::from_decoded)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Resize an image to fit within a maximum edge size, preserving aspect ratio.
///
/// The image is scaled so that its longest edge equals `max_edge` pixels, while
/// the shorter edge is scaled proportionally to maintain the original aspect ratio.
///
/// If the image is already smaller than `max_edge` in both dimensions, it is
/// returned unchanged (no upscaling).
///
/// # Arguments
///
/// * `image` - The source image to resize
/// * `max_edge` - Maximum size for the longest edge in pixels
/// * `filter` - Resize algorithm: 0=Nearest (fastest), 1=Bilinear (default), 2=Lanczos3 (best quality)
///
/// # Returns
///
/// A new `JsDecodedImage` with the resized pixel data, or an error if resizing fails.
///
/// # Example
///
/// ```typescript
/// // Resize for 1x preview (max 2560px edge)
/// const preview1x = resize_to_fit(image, 2560, 2);
///
/// // Resize for 2x preview (max 5120px edge)
/// const preview2x = resize_to_fit(image, 5120, 2);
/// ```
#[wasm_bindgen]
pub fn resize_to_fit(
    image: &JsDecodedImage,
    max_edge: u32,
    filter: u8,
) -> Result<JsDecodedImage, JsValue> {
    let decoded = image.to_decoded();
    let filter_type = filter_from_u8(filter);

    decode::resize_to_fit(&decoded, max_edge, filter_type)
        .map(JsDecodedImage::from_decoded)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a thumbnail for grid display.
///
/// This is a convenience function that uses bilinear filtering to create a
/// small thumbnail suitable for grid/filmstrip display. It preserves the
/// aspect ratio and fits the image within a square of `size` pixels.
///
/// # Arguments
///
/// * `image` - The source image
/// * `size` - Target thumbnail size in pixels (both width and height max)
///
/// # Returns
///
/// A new `JsDecodedImage` with the thumbnail pixel data, or an error if
/// generation fails.
///
/// # Example
///
/// ```typescript
/// // Generate 256px thumbnails for the grid
/// const thumb = generate_thumbnail(image, 256);
/// ```
#[wasm_bindgen]
pub fn generate_thumbnail(image: &JsDecodedImage, size: u32) -> Result<JsDecodedImage, JsValue> {
    let decoded = image.to_decoded();

    decode::generate_thumbnail(&decoded, size)
        .map(JsDecodedImage::from_decoded)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Tests for decode bindings.
///
/// Note: Most decode tests use functions that return `Result<T, JsValue>`, which
/// only work on wasm32 targets. The `is_raw_file` function is the exception as
/// it returns a plain `bool`. For comprehensive decode testing, see the tests
/// in `literoom_core::decode` which test the underlying functionality.
#[cfg(test)]
mod tests {
    use super::*;

    // Tests for is_raw_file - these work on all targets since they don't use JsValue

    #[test]
    fn test_is_raw_file_tiff_le() {
        // TIFF little-endian header
        let bytes = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00];
        assert!(is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_tiff_be() {
        // TIFF big-endian header
        let bytes = [0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08];
        assert!(is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_jpeg_not_raw() {
        // JPEG marker
        let bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert!(!is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_short_data() {
        let bytes = [0x49, 0x49];
        assert!(!is_raw_file(&bytes));
    }

    // Tests for JsDecodedImage creation and methods (work on all targets)

    #[test]
    fn test_js_decoded_image_from_decoded() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });
        assert_eq!(img.width(), 100);
        assert_eq!(img.height(), 50);
        assert_eq!(img.byte_length(), 15000);
    }

    #[test]
    fn test_js_decoded_image_to_decoded() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });
        let decoded = img.to_decoded();
        assert_eq!(decoded.width, 100);
        assert_eq!(decoded.height, 50);
        assert_eq!(decoded.pixels.len(), 15000);
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
    fn test_decode_jpeg_invalid() {
        let result = decode_jpeg(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_jpeg_empty() {
        let result = decode_jpeg(&[]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_extract_raw_thumbnail_invalid() {
        let result = extract_raw_thumbnail_bytes(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_raw_thumbnail_invalid() {
        let result = decode_raw_thumbnail(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_resize_creates_new_image() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });

        let result = resize(&img, 50, 25, 1); // Bilinear
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 25);
    }

    #[wasm_bindgen_test]
    fn test_resize_zero_width_errors() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });

        let result = resize(&img, 0, 25, 1);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_resize_to_fit_landscape() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        });

        let result = resize_to_fit(&img, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 50);
    }

    #[wasm_bindgen_test]
    fn test_resize_to_fit_portrait() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 200,
            pixels: vec![128u8; 100 * 200 * 3],
        });

        let result = resize_to_fit(&img, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_generate_thumbnail() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 400,
            height: 300,
            pixels: vec![128u8; 400 * 300 * 3],
        });

        let result = generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // 400x300 with max 100 -> 100x75
        assert_eq!(thumb.width(), 100);
        assert_eq!(thumb.height(), 75);
    }

    #[wasm_bindgen_test]
    fn test_filter_values() {
        let img = JsDecodedImage::from_decoded(literoom_core::decode::DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        });

        // All filter values should work
        assert!(resize(&img, 50, 50, 0).is_ok()); // Nearest
        assert!(resize(&img, 50, 50, 1).is_ok()); // Bilinear
        assert!(resize(&img, 50, 50, 2).is_ok()); // Lanczos3
        assert!(resize(&img, 50, 50, 99).is_ok()); // Unknown -> Bilinear
    }
}
