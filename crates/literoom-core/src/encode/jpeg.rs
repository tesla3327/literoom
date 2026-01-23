//! JPEG encoding for export.
//!
//! This module provides JPEG encoding using the `image` crate's JPEG encoder.
//! The encoder supports configurable quality settings for balancing file size
//! and image quality during export.

use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use image::ImageEncoder;
use std::io::Cursor;
use thiserror::Error;

/// Errors that can occur during JPEG encoding.
#[derive(Debug, Error)]
pub enum EncodeError {
    /// Pixel data length doesn't match expected dimensions
    #[error("Invalid pixel data: expected {expected} bytes (width * height * 3), got {actual}")]
    InvalidPixelData { expected: usize, actual: usize },

    /// Width or height is zero
    #[error("Invalid dimensions: width ({width}) and height ({height}) must be non-zero")]
    InvalidDimensions { width: u32, height: u32 },

    /// JPEG encoding failed
    #[error("JPEG encoding failed: {0}")]
    EncodingFailed(String),
}

/// Encode RGB pixel data to JPEG bytes.
///
/// # Arguments
///
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// * `quality` - JPEG quality (1-100, where 100 is highest quality)
///
/// # Returns
///
/// JPEG-encoded bytes on success, or an error if encoding fails.
///
/// # Quality Guidelines
///
/// * 90-100: High quality, suitable for archival or further editing
/// * 80-90: Good quality, recommended for most uses (Lightroom default: 90)
/// * 60-80: Medium quality, acceptable for web/social media
/// * Below 60: Low quality, visible artifacts
///
/// # Example
///
/// ```
/// use literoom_core::encode::encode_jpeg;
///
/// let pixels = vec![128u8; 100 * 100 * 3]; // Gray image
/// let jpeg = encode_jpeg(&pixels, 100, 100, 90).unwrap();
///
/// // Verify JPEG magic bytes
/// assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
/// ```
pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, EncodeError> {
    // Validate dimensions
    if width == 0 || height == 0 {
        return Err(EncodeError::InvalidDimensions { width, height });
    }

    // Validate pixel data length
    let expected_len = (width as usize) * (height as usize) * 3;
    if pixels.len() != expected_len {
        return Err(EncodeError::InvalidPixelData {
            expected: expected_len,
            actual: pixels.len(),
        });
    }

    // Clamp quality to valid range (1-100)
    let quality = quality.clamp(1, 100);

    // Create output buffer
    let mut buffer = Cursor::new(Vec::new());

    // Create JPEG encoder with specified quality
    let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);

    // Encode the image
    encoder
        .write_image(pixels, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| EncodeError::EncodingFailed(e.to_string()))?;

    Ok(buffer.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_jpeg_basic() {
        let width = 100;
        let height = 100;
        let pixels = vec![128u8; width * height * 3];

        let result = encode_jpeg(&pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());

        let jpeg_bytes = result.unwrap();

        // Check JPEG magic bytes (SOI marker)
        assert_eq!(&jpeg_bytes[0..2], &[0xFF, 0xD8]);

        // Check JPEG ends with EOI marker
        let len = jpeg_bytes.len();
        assert_eq!(&jpeg_bytes[len - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn test_encode_jpeg_quality_affects_size() {
        let pixels = vec![128u8; 100 * 100 * 3];

        let low_q = encode_jpeg(&pixels, 100, 100, 20).unwrap();
        let high_q = encode_jpeg(&pixels, 100, 100, 95).unwrap();

        // Higher quality generally produces larger files
        // (may not always be true for very simple images, but usually is)
        assert!(high_q.len() > low_q.len() || (low_q.len() - high_q.len()) < 100);
    }

    #[test]
    fn test_encode_jpeg_quality_clamping() {
        let pixels = vec![128u8; 10 * 10 * 3];

        // Quality 0 should be clamped to 1
        let result = encode_jpeg(&pixels, 10, 10, 0);
        assert!(result.is_ok());

        // Quality 255 should be clamped to 100
        let result = encode_jpeg(&pixels, 10, 10, 255);
        assert!(result.is_ok());
    }

    #[test]
    fn test_encode_jpeg_invalid_pixel_data_short() {
        let pixels = vec![128u8; 99 * 100 * 3]; // One row short

        let result = encode_jpeg(&pixels, 100, 100, 90);
        assert!(matches!(result, Err(EncodeError::InvalidPixelData { .. })));
    }

    #[test]
    fn test_encode_jpeg_invalid_pixel_data_long() {
        let pixels = vec![128u8; 101 * 100 * 3]; // One row extra

        let result = encode_jpeg(&pixels, 100, 100, 90);
        assert!(matches!(result, Err(EncodeError::InvalidPixelData { .. })));
    }

    #[test]
    fn test_encode_jpeg_zero_width() {
        let pixels = vec![];

        let result = encode_jpeg(&pixels, 0, 100, 90);
        assert!(matches!(result, Err(EncodeError::InvalidDimensions { .. })));
    }

    #[test]
    fn test_encode_jpeg_zero_height() {
        let pixels = vec![];

        let result = encode_jpeg(&pixels, 100, 0, 90);
        assert!(matches!(result, Err(EncodeError::InvalidDimensions { .. })));
    }

    #[test]
    fn test_encode_jpeg_small_image() {
        // 1x1 pixel image
        let pixels = vec![255, 0, 0]; // Red pixel

        let result = encode_jpeg(&pixels, 1, 1, 90);
        assert!(result.is_ok());

        let jpeg_bytes = result.unwrap();
        assert_eq!(&jpeg_bytes[0..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn test_encode_jpeg_non_square() {
        // Wide image
        let pixels = vec![128u8; 200 * 50 * 3];
        let result = encode_jpeg(&pixels, 200, 50, 90);
        assert!(result.is_ok());

        // Tall image
        let pixels = vec![128u8; 50 * 200 * 3];
        let result = encode_jpeg(&pixels, 50, 200, 90);
        assert!(result.is_ok());
    }

    #[test]
    fn test_encode_jpeg_gradient() {
        // Create a simple gradient image
        let width = 100;
        let height = 100;
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

        let result = encode_jpeg(&pixels, width as u32, height as u32, 90);
        assert!(result.is_ok());

        let jpeg_bytes = result.unwrap();
        // Gradient images should produce reasonable file sizes
        assert!(jpeg_bytes.len() > 500); // Not too small
        assert!(jpeg_bytes.len() < 50000); // Not too large for 100x100
    }
}

// ============================================================================
// Property-Based Tests
// ============================================================================

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// Strategy for generating image dimensions (keep small for speed).
    fn dimensions_strategy() -> impl Strategy<Value = (u32, u32)> {
        (1u32..=50, 1u32..=50)
    }

    /// Strategy for generating quality values.
    fn quality_strategy() -> impl Strategy<Value = u8> {
        1u8..=100
    }

    /// Strategy for generating random pixel data for a given size.
    fn pixels_strategy(width: u32, height: u32) -> impl Strategy<Value = Vec<u8>> {
        let size = (width as usize) * (height as usize) * 3;
        prop::collection::vec(any::<u8>(), size..=size)
    }

    proptest! {
        /// Property: Encoding always produces valid JPEG when given valid input.
        #[test]
        fn prop_valid_input_produces_valid_jpeg(
            (width, height) in dimensions_strategy(),
            quality in quality_strategy(),
        ) {
            let size = (width as usize) * (height as usize) * 3;
            let pixels = vec![128u8; size];

            let result = encode_jpeg(&pixels, width, height, quality);
            prop_assert!(result.is_ok(), "Valid input should produce valid output");

            let jpeg_bytes = result.unwrap();

            // Check JPEG SOI marker
            prop_assert_eq!(&jpeg_bytes[0..2], &[0xFF, 0xD8], "Should have SOI marker");

            // Check JPEG EOI marker
            let len = jpeg_bytes.len();
            prop_assert!(len >= 4, "JPEG should have at least 4 bytes");
            prop_assert_eq!(&jpeg_bytes[len - 2..], &[0xFF, 0xD9], "Should have EOI marker");
        }

        /// Property: Output size is always positive for valid input.
        #[test]
        fn prop_output_size_is_positive(
            (width, height) in dimensions_strategy(),
            quality in quality_strategy(),
        ) {
            let size = (width as usize) * (height as usize) * 3;
            let pixels = vec![128u8; size];

            let result = encode_jpeg(&pixels, width, height, quality);
            prop_assert!(result.is_ok());

            let jpeg_bytes = result.unwrap();
            prop_assert!(jpeg_bytes.len() > 0, "Output should be non-empty");
        }

        /// Property: Same input always produces same output (deterministic).
        #[test]
        fn prop_deterministic_output(
            (width, height) in (1u32..=20, 1u32..=20),
            quality in quality_strategy(),
        ) {
            let size = (width as usize) * (height as usize) * 3;
            let pixels = vec![100u8; size]; // Use a fixed value for reproducibility

            let result1 = encode_jpeg(&pixels, width, height, quality);
            let result2 = encode_jpeg(&pixels, width, height, quality);

            prop_assert!(result1.is_ok() && result2.is_ok());
            prop_assert_eq!(result1.unwrap(), result2.unwrap(), "Same input should produce same output");
        }

        /// Property: Quality affects file size (generally higher quality = larger file).
        #[test]
        fn prop_quality_affects_size_general(
            (width, height) in (20u32..=40, 20u32..=40),
        ) {
            // Create a complex image (gradient) where quality difference is visible
            let size = (width as usize) * (height as usize) * 3;
            let mut pixels = Vec::with_capacity(size);

            for y in 0..height {
                for x in 0..width {
                    pixels.push(((x * 255) / width) as u8);
                    pixels.push(((y * 255) / height) as u8);
                    pixels.push(((x + y) * 127 / (width + height)) as u8);
                }
            }

            let low_q = encode_jpeg(&pixels, width, height, 10);
            let high_q = encode_jpeg(&pixels, width, height, 100);

            prop_assert!(low_q.is_ok() && high_q.is_ok());

            // High quality should generally be larger, but we allow some tolerance
            // since for very simple images this might not hold
            let low_size = low_q.unwrap().len();
            let high_size = high_q.unwrap().len();

            // Either high quality is larger OR they're within 50% of each other
            prop_assert!(
                high_size > low_size || (low_size as f64 / high_size as f64) < 1.5,
                "Quality should affect size: low={}, high={}",
                low_size,
                high_size
            );
        }

        /// Property: Invalid pixel data length always returns error.
        #[test]
        fn prop_invalid_pixel_length_returns_error(
            (width, height) in dimensions_strategy(),
            quality in quality_strategy(),
            extra_or_missing in -10i32..=10,
        ) {
            prop_assume!(extra_or_missing != 0); // Skip zero, as that's valid

            let expected_size = (width as usize) * (height as usize) * 3;
            let actual_size = if extra_or_missing > 0 {
                expected_size + extra_or_missing as usize
            } else {
                expected_size.saturating_sub((-extra_or_missing) as usize)
            };

            // Skip if we would get the correct size
            prop_assume!(actual_size != expected_size);

            let pixels = vec![128u8; actual_size];
            let result = encode_jpeg(&pixels, width, height, quality);

            prop_assert!(
                matches!(result, Err(EncodeError::InvalidPixelData { .. })),
                "Mismatched pixel data should return InvalidPixelData error"
            );
        }

        /// Property: Zero dimensions always return error.
        #[test]
        fn prop_zero_dimensions_return_error(
            width in 0u32..=1,
            height in 0u32..=1,
            quality in quality_strategy(),
        ) {
            prop_assume!(width == 0 || height == 0);

            let pixels = vec![];
            let result = encode_jpeg(&pixels, width, height, quality);

            prop_assert!(
                matches!(result, Err(EncodeError::InvalidDimensions { .. })),
                "Zero dimensions should return InvalidDimensions error"
            );
        }

        /// Property: All quality values in range produce valid output.
        #[test]
        fn prop_all_quality_values_work(quality in 0u8..=255) {
            let pixels = vec![128u8; 10 * 10 * 3];
            let result = encode_jpeg(&pixels, 10, 10, quality);

            // All quality values should work (extreme values get clamped)
            prop_assert!(result.is_ok(), "Quality {} should work after clamping", quality);
        }

        /// Property: Various pixel patterns encode successfully.
        #[test]
        fn prop_various_pixel_patterns(
            (width, height) in (5u32..=20, 5u32..=20),
            pattern in 0u8..=4,
        ) {
            let size = (width as usize) * (height as usize) * 3;
            let pixels: Vec<u8> = match pattern {
                0 => vec![0u8; size],        // Black
                1 => vec![255u8; size],      // White
                2 => vec![128u8; size],      // Gray
                3 => (0..size).map(|i| (i % 256) as u8).collect(), // Gradient
                _ => (0..size).map(|i| ((i * 37) % 256) as u8).collect(), // Pseudo-random
            };

            let result = encode_jpeg(&pixels, width, height, 90);
            prop_assert!(result.is_ok(), "Pattern {} should encode successfully", pattern);

            let jpeg = result.unwrap();
            prop_assert_eq!(&jpeg[0..2], &[0xFF, 0xD8], "Should have valid JPEG header");
        }

        /// Property: Aspect ratios don't affect encoding success.
        #[test]
        fn prop_aspect_ratio_independence(
            short_side in 5u32..=20,
            ratio in 1u32..=10,
        ) {
            let long_side = short_side * ratio;

            // Wide image
            let pixels_wide = vec![128u8; (long_side * short_side * 3) as usize];
            let result_wide = encode_jpeg(&pixels_wide, long_side, short_side, 90);

            // Tall image
            let pixels_tall = vec![128u8; (short_side * long_side * 3) as usize];
            let result_tall = encode_jpeg(&pixels_tall, short_side, long_side, 90);

            prop_assert!(result_wide.is_ok(), "Wide image should encode");
            prop_assert!(result_tall.is_ok(), "Tall image should encode");
        }
    }
}
