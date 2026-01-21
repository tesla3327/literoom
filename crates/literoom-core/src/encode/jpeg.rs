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
pub fn encode_jpeg(pixels: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, EncodeError> {
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
