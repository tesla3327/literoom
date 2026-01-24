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
/// These tests verify the decode bindings work correctly on native targets by
/// testing the underlying core functions directly. Tests that require `JsValue`
/// are in the `wasm_tests` module below.
#[cfg(test)]
mod tests {
    use super::*;
    use literoom_core::decode::{self, DecodedImage, FilterType};

    // =========================================================================
    // is_raw_file tests
    // =========================================================================

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

    #[test]
    fn test_is_raw_file_empty() {
        let bytes: [u8; 0] = [];
        assert!(!is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_single_byte() {
        let bytes = [0x49];
        assert!(!is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_png_header() {
        // PNG magic bytes
        let bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(!is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_random_data() {
        let bytes = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        assert!(!is_raw_file(&bytes));
    }

    #[test]
    fn test_is_raw_file_partial_tiff_header() {
        // Only first two bytes of TIFF LE header
        let bytes = [0x49, 0x49, 0x00, 0x00];
        assert!(!is_raw_file(&bytes));
    }

    // =========================================================================
    // JsDecodedImage tests
    // =========================================================================

    #[test]
    fn test_js_decoded_image_from_decoded() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
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
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });
        let decoded = img.to_decoded();
        assert_eq!(decoded.width, 100);
        assert_eq!(decoded.height, 50);
        assert_eq!(decoded.pixels.len(), 15000);
    }

    #[test]
    fn test_js_decoded_image_small() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 1,
            height: 1,
            pixels: vec![255, 128, 64],
        });
        assert_eq!(img.width(), 1);
        assert_eq!(img.height(), 1);
        assert_eq!(img.byte_length(), 3);
    }

    #[test]
    fn test_js_decoded_image_large() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 4000,
            height: 3000,
            pixels: vec![0u8; 4000 * 3000 * 3],
        });
        assert_eq!(img.width(), 4000);
        assert_eq!(img.height(), 3000);
        assert_eq!(img.byte_length(), 36_000_000);
    }

    #[test]
    fn test_js_decoded_image_roundtrip_preserves_pixels() {
        let original_pixels = vec![10, 20, 30, 40, 50, 60, 70, 80, 90];
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 3,
            height: 1,
            pixels: original_pixels.clone(),
        });
        let decoded = img.to_decoded();
        assert_eq!(decoded.pixels, original_pixels);
    }

    // =========================================================================
    // Resize tests (using core functions directly)
    // =========================================================================

    #[test]
    fn test_resize_basic() {
        let img = DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        };

        let result = decode::resize(&img, 50, 25, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 25);
        assert_eq!(resized.pixels.len(), 50 * 25 * 3);
    }

    #[test]
    fn test_resize_upscale() {
        let img = DecodedImage {
            width: 50,
            height: 50,
            pixels: vec![128u8; 50 * 50 * 3],
        };

        let result = decode::resize(&img, 100, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 100);
    }

    #[test]
    fn test_resize_nearest_filter() {
        let img = DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        };

        let result = decode::resize(&img, 50, 50, FilterType::Nearest);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_lanczos3_filter() {
        let img = DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        };

        let result = decode::resize(&img, 50, 50, FilterType::Lanczos3);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_zero_width_errors() {
        let img = DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        };

        let result = decode::resize(&img, 0, 25, FilterType::Bilinear);
        assert!(result.is_err());
    }

    #[test]
    fn test_resize_zero_height_errors() {
        let img = DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        };

        let result = decode::resize(&img, 50, 0, FilterType::Bilinear);
        assert!(result.is_err());
    }

    #[test]
    fn test_resize_same_size() {
        let img = DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        };

        let result = decode::resize(&img, 100, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 100);
    }

    #[test]
    fn test_resize_preserves_color() {
        // Create a solid red image
        let mut pixels = Vec::with_capacity(10 * 10 * 3);
        for _ in 0..(10 * 10) {
            pixels.push(255); // R
            pixels.push(0); // G
            pixels.push(0); // B
        }

        let img = DecodedImage {
            width: 10,
            height: 10,
            pixels,
        };

        let result = decode::resize(&img, 5, 5, FilterType::Nearest);
        assert!(result.is_ok());

        let resized = result.unwrap();
        // With nearest neighbor on solid color, all pixels should remain red
        for chunk in resized.pixels.chunks(3) {
            assert_eq!(chunk[0], 255, "Red channel should be 255");
            assert_eq!(chunk[1], 0, "Green channel should be 0");
            assert_eq!(chunk[2], 0, "Blue channel should be 0");
        }
    }

    #[test]
    fn test_resize_asymmetric() {
        let img = DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        };

        // Resize to different aspect ratio
        let result = decode::resize(&img, 100, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 100);
    }

    #[test]
    fn test_resize_single_pixel() {
        let img = DecodedImage {
            width: 1,
            height: 1,
            pixels: vec![100, 150, 200],
        };

        let result = decode::resize(&img, 10, 10, FilterType::Nearest);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 10);
        assert_eq!(resized.height, 10);
    }

    // =========================================================================
    // Resize to fit tests
    // =========================================================================

    #[test]
    fn test_resize_to_fit_landscape() {
        let img = DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        };

        let result = decode::resize_to_fit(&img, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_to_fit_portrait() {
        let img = DecodedImage {
            width: 100,
            height: 200,
            pixels: vec![128u8; 100 * 200 * 3],
        };

        let result = decode::resize_to_fit(&img, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 100);
    }

    #[test]
    fn test_resize_to_fit_square() {
        let img = DecodedImage {
            width: 200,
            height: 200,
            pixels: vec![128u8; 200 * 200 * 3],
        };

        let result = decode::resize_to_fit(&img, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 100);
    }

    #[test]
    fn test_resize_to_fit_already_smaller() {
        let img = DecodedImage {
            width: 50,
            height: 30,
            pixels: vec![128u8; 50 * 30 * 3],
        };

        let result = decode::resize_to_fit(&img, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        // Should not upscale
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 30);
    }

    #[test]
    fn test_resize_to_fit_exact_size() {
        let img = DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        };

        let result = decode::resize_to_fit(&img, 100, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_to_fit_wide_image() {
        let img = DecodedImage {
            width: 1000,
            height: 100,
            pixels: vec![128u8; 1000 * 100 * 3],
        };

        let result = decode::resize_to_fit(&img, 500, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 500);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_to_fit_tall_image() {
        let img = DecodedImage {
            width: 100,
            height: 1000,
            pixels: vec![128u8; 100 * 1000 * 3],
        };

        let result = decode::resize_to_fit(&img, 500, FilterType::Bilinear);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 500);
    }

    #[test]
    fn test_resize_to_fit_various_filters() {
        let img = DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        };

        // Test all filter types
        for filter in [FilterType::Nearest, FilterType::Bilinear, FilterType::Lanczos3] {
            let result = decode::resize_to_fit(&img, 100, filter);
            assert!(result.is_ok());

            let resized = result.unwrap();
            assert_eq!(resized.width, 100);
            assert_eq!(resized.height, 50);
        }
    }

    // =========================================================================
    // Generate thumbnail tests
    // =========================================================================

    #[test]
    fn test_generate_thumbnail_basic() {
        let img = DecodedImage {
            width: 400,
            height: 300,
            pixels: vec![128u8; 400 * 300 * 3],
        };

        let result = decode::generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // 400x300 with max 100 -> 100x75
        assert_eq!(thumb.width, 100);
        assert_eq!(thumb.height, 75);
    }

    #[test]
    fn test_generate_thumbnail_portrait() {
        let img = DecodedImage {
            width: 300,
            height: 400,
            pixels: vec![128u8; 300 * 400 * 3],
        };

        let result = decode::generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // 300x400 with max 100 -> 75x100
        assert_eq!(thumb.width, 75);
        assert_eq!(thumb.height, 100);
    }

    #[test]
    fn test_generate_thumbnail_square() {
        let img = DecodedImage {
            width: 400,
            height: 400,
            pixels: vec![128u8; 400 * 400 * 3],
        };

        let result = decode::generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        assert_eq!(thumb.width, 100);
        assert_eq!(thumb.height, 100);
    }

    #[test]
    fn test_generate_thumbnail_already_small() {
        let img = DecodedImage {
            width: 50,
            height: 50,
            pixels: vec![128u8; 50 * 50 * 3],
        };

        let result = decode::generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // Should not upscale
        assert_eq!(thumb.width, 50);
        assert_eq!(thumb.height, 50);
    }

    #[test]
    fn test_generate_thumbnail_various_sizes() {
        let img = DecodedImage {
            width: 1000,
            height: 800,
            pixels: vec![128u8; 1000 * 800 * 3],
        };

        // Test common thumbnail sizes
        for size in [64, 128, 256, 512] {
            let result = decode::generate_thumbnail(&img, size);
            assert!(result.is_ok());

            let thumb = result.unwrap();
            // Longest edge should be size, aspect preserved
            assert!(thumb.width <= size || thumb.height <= size);
            assert!(thumb.width == size || thumb.height == size);
        }
    }

    #[test]
    fn test_generate_thumbnail_extreme_aspect_ratio() {
        // Very wide image
        let wide_img = DecodedImage {
            width: 1000,
            height: 100,
            pixels: vec![128u8; 1000 * 100 * 3],
        };

        let result = decode::generate_thumbnail(&wide_img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        assert_eq!(thumb.width, 100);
        assert_eq!(thumb.height, 10);

        // Very tall image
        let tall_img = DecodedImage {
            width: 100,
            height: 1000,
            pixels: vec![128u8; 100 * 1000 * 3],
        };

        let result = decode::generate_thumbnail(&tall_img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        assert_eq!(thumb.width, 10);
        assert_eq!(thumb.height, 100);
    }

    // =========================================================================
    // Filter conversion tests
    // =========================================================================

    #[test]
    fn test_filter_from_u8_nearest() {
        assert!(matches!(filter_from_u8(0), FilterType::Nearest));
    }

    #[test]
    fn test_filter_from_u8_bilinear() {
        assert!(matches!(filter_from_u8(1), FilterType::Bilinear));
    }

    #[test]
    fn test_filter_from_u8_lanczos3() {
        assert!(matches!(filter_from_u8(2), FilterType::Lanczos3));
    }

    #[test]
    fn test_filter_from_u8_defaults_to_bilinear() {
        // Unknown values default to bilinear
        assert!(matches!(filter_from_u8(3), FilterType::Bilinear));
        assert!(matches!(filter_from_u8(100), FilterType::Bilinear));
        assert!(matches!(filter_from_u8(255), FilterType::Bilinear));
    }

    // =========================================================================
    // JPEG decode error handling tests (using core functions)
    // =========================================================================

    #[test]
    fn test_decode_jpeg_invalid_data() {
        let result = decode::decode_jpeg(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_jpeg_empty() {
        let result = decode::decode_jpeg(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_jpeg_truncated_header() {
        // Valid JPEG header but truncated
        let result = decode::decode_jpeg(&[0xFF, 0xD8, 0xFF]);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_jpeg_png_data() {
        // PNG magic bytes
        let png_header = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let result = decode::decode_jpeg(&png_header);
        assert!(result.is_err());
    }

    // =========================================================================
    // RAW thumbnail extraction error handling tests
    // =========================================================================

    #[test]
    fn test_extract_raw_thumbnail_invalid() {
        let result = decode::extract_raw_thumbnail(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_raw_thumbnail_empty() {
        let result = decode::extract_raw_thumbnail(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_raw_thumbnail_jpeg_data() {
        // JPEG header is not a RAW file
        let jpeg_header = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        let result = decode::extract_raw_thumbnail(&jpeg_header);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_raw_thumbnail_partial_tiff() {
        // Valid TIFF LE header but no data
        let tiff_header = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00];
        let result = decode::extract_raw_thumbnail(&tiff_header);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_raw_thumbnail_invalid() {
        let result = decode::decode_raw_thumbnail(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_raw_thumbnail_empty() {
        let result = decode::decode_raw_thumbnail(&[]);
        assert!(result.is_err());
    }

    // =========================================================================
    // Integration tests with JsDecodedImage wrapper
    // =========================================================================

    #[test]
    fn test_js_decoded_image_resize_workflow() {
        // Simulate the WASM workflow: create image, resize, get result
        let original = JsDecodedImage::from_decoded(DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        });

        // Convert to core type for processing
        let decoded = original.to_decoded();

        // Resize using core function
        let resized = decode::resize(&decoded, 100, 50, FilterType::Bilinear).unwrap();

        // Wrap back in JS type
        let result = JsDecodedImage::from_decoded(resized);

        assert_eq!(result.width(), 100);
        assert_eq!(result.height(), 50);
        assert_eq!(result.byte_length(), 100 * 50 * 3);
    }

    #[test]
    fn test_js_decoded_image_thumbnail_workflow() {
        let original = JsDecodedImage::from_decoded(DecodedImage {
            width: 800,
            height: 600,
            pixels: vec![64u8; 800 * 600 * 3],
        });

        let decoded = original.to_decoded();
        let thumb = decode::generate_thumbnail(&decoded, 256).unwrap();
        let result = JsDecodedImage::from_decoded(thumb);

        // 800x600 with max 256 -> 256x192
        assert_eq!(result.width(), 256);
        assert_eq!(result.height(), 192);
    }

    #[test]
    fn test_js_decoded_image_pixels_immutable() {
        // Verify that calling pixels() multiple times returns same data
        let original_pixels = vec![10u8, 20, 30, 40, 50, 60];
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 2,
            height: 1,
            pixels: original_pixels.clone(),
        });

        let pixels1 = img.pixels();
        let pixels2 = img.pixels();

        assert_eq!(pixels1, pixels2);
        assert_eq!(pixels1, original_pixels);
    }

    #[test]
    fn test_chain_resize_operations() {
        // Test chaining multiple resize operations
        let img = DecodedImage {
            width: 1000,
            height: 1000,
            pixels: vec![128u8; 1000 * 1000 * 3],
        };

        // First resize
        let step1 = decode::resize(&img, 500, 500, FilterType::Bilinear).unwrap();
        assert_eq!(step1.width, 500);
        assert_eq!(step1.height, 500);

        // Second resize
        let step2 = decode::resize(&step1, 250, 250, FilterType::Lanczos3).unwrap();
        assert_eq!(step2.width, 250);
        assert_eq!(step2.height, 250);

        // Third resize
        let step3 = decode::resize(&step2, 100, 100, FilterType::Nearest).unwrap();
        assert_eq!(step3.width, 100);
        assert_eq!(step3.height, 100);
    }

    #[test]
    fn test_all_filter_types_produce_valid_output() {
        let img = DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        };

        let filters = [FilterType::Nearest, FilterType::Bilinear, FilterType::Lanczos3];

        for filter in filters {
            let result = decode::resize(&img, 50, 50, filter).unwrap();

            // Verify dimensions
            assert_eq!(result.width, 50);
            assert_eq!(result.height, 50);

            // Verify pixel count
            assert_eq!(result.pixels.len(), 50 * 50 * 3);

            // Verify pixel count matches expected
            assert_eq!(result.pixels.len(), 50 * 50 * 3);
        }
    }
}

/// WASM-specific tests that require JsValue.
///
/// These tests use functions that return `Result<T, JsValue>` and can only
/// run on wasm32 targets. Use `wasm-pack test` to run these.
#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use literoom_core::decode::DecodedImage;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    // =========================================================================
    // JPEG decode error tests
    // =========================================================================

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
    fn test_decode_jpeg_truncated() {
        let result = decode_jpeg(&[0xFF, 0xD8, 0xFF]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_jpeg_png_data() {
        let png_header = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let result = decode_jpeg(&png_header);
        assert!(result.is_err());
    }

    // =========================================================================
    // RAW thumbnail extraction error tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_extract_raw_thumbnail_invalid() {
        let result = extract_raw_thumbnail_bytes(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_extract_raw_thumbnail_empty() {
        let result = extract_raw_thumbnail_bytes(&[]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_raw_thumbnail_invalid() {
        let result = decode_raw_thumbnail(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_raw_thumbnail_empty() {
        let result = decode_raw_thumbnail(&[]);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_decode_raw_thumbnail_jpeg_data() {
        let jpeg_header = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        let result = decode_raw_thumbnail(&jpeg_header);
        assert!(result.is_err());
    }

    // =========================================================================
    // Resize tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_resize_creates_new_image() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
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
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });

        let result = resize(&img, 0, 25, 1);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_resize_zero_height_errors() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 50,
            pixels: vec![128u8; 100 * 50 * 3],
        });

        let result = resize(&img, 25, 0, 1);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_resize_upscale() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 50,
            height: 50,
            pixels: vec![128u8; 50 * 50 * 3],
        });

        let result = resize(&img, 100, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_resize_same_size() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        });

        let result = resize(&img, 100, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_resize_asymmetric() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        });

        let result = resize(&img, 100, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 100);
    }

    // =========================================================================
    // Resize to fit tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_resize_to_fit_landscape() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
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
        let img = JsDecodedImage::from_decoded(DecodedImage {
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
    fn test_resize_to_fit_square() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 200,
            height: 200,
            pixels: vec![128u8; 200 * 200 * 3],
        });

        let result = resize_to_fit(&img, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_resize_to_fit_already_small() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 50,
            height: 30,
            pixels: vec![128u8; 50 * 30 * 3],
        });

        let result = resize_to_fit(&img, 100, 1);
        assert!(result.is_ok());

        let resized = result.unwrap();
        // Should not upscale
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 30);
    }

    #[wasm_bindgen_test]
    fn test_resize_to_fit_various_filters() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![128u8; 200 * 100 * 3],
        });

        // Test all filter types
        for filter in [0u8, 1, 2] {
            let result = resize_to_fit(&img, 100, filter);
            assert!(result.is_ok());

            let resized = result.unwrap();
            assert_eq!(resized.width(), 100);
            assert_eq!(resized.height(), 50);
        }
    }

    // =========================================================================
    // Generate thumbnail tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_generate_thumbnail() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
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
    fn test_generate_thumbnail_portrait() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 300,
            height: 400,
            pixels: vec![128u8; 300 * 400 * 3],
        });

        let result = generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // 300x400 with max 100 -> 75x100
        assert_eq!(thumb.width(), 75);
        assert_eq!(thumb.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_generate_thumbnail_square() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 400,
            height: 400,
            pixels: vec![128u8; 400 * 400 * 3],
        });

        let result = generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        assert_eq!(thumb.width(), 100);
        assert_eq!(thumb.height(), 100);
    }

    #[wasm_bindgen_test]
    fn test_generate_thumbnail_already_small() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 50,
            height: 50,
            pixels: vec![128u8; 50 * 50 * 3],
        });

        let result = generate_thumbnail(&img, 100);
        assert!(result.is_ok());

        let thumb = result.unwrap();
        // Should not upscale
        assert_eq!(thumb.width(), 50);
        assert_eq!(thumb.height(), 50);
    }

    #[wasm_bindgen_test]
    fn test_generate_thumbnail_various_sizes() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 1000,
            height: 800,
            pixels: vec![128u8; 1000 * 800 * 3],
        });

        // Test common thumbnail sizes
        for size in [64u32, 128, 256, 512] {
            let result = generate_thumbnail(&img, size);
            assert!(result.is_ok());

            let thumb = result.unwrap();
            assert!(thumb.width() <= size || thumb.height() <= size);
            assert!(thumb.width() == size || thumb.height() == size);
        }
    }

    // =========================================================================
    // Filter values tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_filter_values() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
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

    #[wasm_bindgen_test]
    fn test_filter_nearest() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        });

        let result = resize(&img, 50, 50, 0);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 50);
    }

    #[wasm_bindgen_test]
    fn test_filter_lanczos3() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 100,
            height: 100,
            pixels: vec![128u8; 100 * 100 * 3],
        });

        let result = resize(&img, 50, 50, 2);
        assert!(result.is_ok());

        let resized = result.unwrap();
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 50);
    }

    // =========================================================================
    // is_raw_file tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_is_raw_file_tiff_le() {
        let bytes = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00];
        assert!(is_raw_file(&bytes));
    }

    #[wasm_bindgen_test]
    fn test_is_raw_file_tiff_be() {
        let bytes = [0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08];
        assert!(is_raw_file(&bytes));
    }

    #[wasm_bindgen_test]
    fn test_is_raw_file_jpeg_not_raw() {
        let bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert!(!is_raw_file(&bytes));
    }

    #[wasm_bindgen_test]
    fn test_is_raw_file_empty() {
        let bytes: [u8; 0] = [];
        assert!(!is_raw_file(&bytes));
    }

    #[wasm_bindgen_test]
    fn test_is_raw_file_short() {
        let bytes = [0x49, 0x49];
        assert!(!is_raw_file(&bytes));
    }

    // =========================================================================
    // Integration workflow tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_resize_then_thumbnail_workflow() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 1000,
            height: 800,
            pixels: vec![128u8; 1000 * 800 * 3],
        });

        // First resize to fit
        let preview = resize_to_fit(&img, 500, 2).unwrap();
        assert_eq!(preview.width(), 500);
        assert_eq!(preview.height(), 400);

        // Then generate thumbnail
        let thumb = generate_thumbnail(&preview, 100).unwrap();
        assert_eq!(thumb.width(), 100);
        assert_eq!(thumb.height(), 80);
    }

    #[wasm_bindgen_test]
    fn test_chained_resize_operations() {
        let img = JsDecodedImage::from_decoded(DecodedImage {
            width: 500,
            height: 500,
            pixels: vec![128u8; 500 * 500 * 3],
        });

        let step1 = resize(&img, 250, 250, 1).unwrap();
        let step2 = resize(&step1, 125, 125, 1).unwrap();
        let step3 = resize(&step2, 64, 64, 1).unwrap();

        assert_eq!(step3.width(), 64);
        assert_eq!(step3.height(), 64);
    }
}
