//! JPEG image decoding with EXIF orientation handling.

use std::io::Cursor;

use exif::{In, Reader, Tag};
use image::DynamicImage;
use image::ImageReader;

use super::{DecodeError, DecodedImage, Orientation};

/// Decode a JPEG image from bytes, applying EXIF orientation correction.
///
/// # Arguments
///
/// * `bytes` - Raw JPEG file bytes
///
/// # Returns
///
/// A `DecodedImage` with RGB pixel data and correct orientation applied.
///
/// # Errors
///
/// Returns `DecodeError::InvalidFormat` if the bytes are not a valid JPEG.
/// Returns `DecodeError::CorruptedFile` if the JPEG is corrupted.
pub fn decode_jpeg(bytes: &[u8]) -> Result<DecodedImage, DecodeError> {
    // First, extract EXIF orientation before decoding
    let orientation = extract_orientation(bytes);

    // Decode the image using the image crate
    let cursor = Cursor::new(bytes);
    let reader = ImageReader::new(cursor)
        .with_guessed_format()
        .map_err(|e| DecodeError::CorruptedFile(e.to_string()))?;

    let img = reader
        .decode()
        .map_err(|e| DecodeError::CorruptedFile(e.to_string()))?;

    // Apply orientation transformation
    let oriented_img = apply_orientation(img, orientation);

    // Convert to RGB8
    let rgb_img = oriented_img.into_rgb8();
    Ok(DecodedImage::from_rgb_image(rgb_img))
}

/// Decode a JPEG image from bytes without applying EXIF orientation.
///
/// Use this when you want to handle orientation separately or when
/// the image is already correctly oriented.
///
/// # Arguments
///
/// * `bytes` - Raw JPEG file bytes
///
/// # Returns
///
/// A `DecodedImage` with RGB pixel data (orientation not applied).
pub fn decode_jpeg_no_orientation(bytes: &[u8]) -> Result<DecodedImage, DecodeError> {
    let cursor = Cursor::new(bytes);
    let reader = ImageReader::new(cursor)
        .with_guessed_format()
        .map_err(|e| DecodeError::CorruptedFile(e.to_string()))?;

    let img = reader
        .decode()
        .map_err(|e| DecodeError::CorruptedFile(e.to_string()))?;

    let rgb_img = img.into_rgb8();
    Ok(DecodedImage::from_rgb_image(rgb_img))
}

/// Extract EXIF orientation from JPEG bytes.
///
/// Returns `Orientation::Normal` if no EXIF data is found or orientation
/// cannot be determined.
fn extract_orientation(bytes: &[u8]) -> Orientation {
    let exif_reader = Reader::new();
    let mut cursor = Cursor::new(bytes);

    match exif_reader.read_from_container(&mut cursor) {
        Ok(exif) => {
            if let Some(field) = exif.get_field(Tag::Orientation, In::PRIMARY) {
                if let Some(value) = field.value.get_uint(0) {
                    return Orientation::from(value);
                }
            }
            Orientation::Normal
        }
        Err(_) => Orientation::Normal,
    }
}

/// Apply EXIF orientation transformation to an image.
fn apply_orientation(img: DynamicImage, orientation: Orientation) -> DynamicImage {
    match orientation {
        Orientation::Normal => img,
        Orientation::FlipHorizontal => img.fliph(),
        Orientation::Rotate180 => img.rotate180(),
        Orientation::FlipVertical => img.flipv(),
        Orientation::Transpose => img.rotate90().fliph(),
        Orientation::Rotate90CW => img.rotate90(),
        Orientation::Transverse => img.rotate270().fliph(),
        Orientation::Rotate270CW => img.rotate270(),
    }
}

/// Extract EXIF orientation value from JPEG bytes (for external use).
pub fn get_orientation(bytes: &[u8]) -> Orientation {
    extract_orientation(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal valid JPEG bytes (1x1 red pixel)
    // This is a valid JPEG file created with minimal headers
    const MINIMAL_JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
        0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B,
        0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31,
        0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF,
        0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00,
        0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
        0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05,
        0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21,
        0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A,
        0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
        0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56,
        0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93,
        0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9,
        0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6,
        0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,
        0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5,
        0xDB, 0x20, 0xA8, 0xF1, 0x7E, 0xFF, 0xD9,
    ];

    #[test]
    fn test_decode_valid_jpeg() {
        let result = decode_jpeg(MINIMAL_JPEG);
        assert!(result.is_ok(), "Failed to decode valid JPEG: {:?}", result);

        let img = result.unwrap();
        assert_eq!(img.width, 1);
        assert_eq!(img.height, 1);
        assert_eq!(img.pixels.len(), 3); // 1x1 RGB = 3 bytes
    }

    #[test]
    fn test_decode_jpeg_no_orientation() {
        let result = decode_jpeg_no_orientation(MINIMAL_JPEG);
        assert!(result.is_ok());

        let img = result.unwrap();
        assert_eq!(img.width, 1);
        assert_eq!(img.height, 1);
    }

    #[test]
    fn test_decode_invalid_jpeg() {
        let invalid_bytes = &[0x00, 0x01, 0x02, 0x03];
        let result = decode_jpeg(invalid_bytes);
        assert!(result.is_err());

        // Check that we get a CorruptedFile error
        match result {
            Err(DecodeError::CorruptedFile(_)) => {}
            Err(e) => panic!("Expected CorruptedFile error, got: {:?}", e),
            Ok(_) => panic!("Expected error, got success"),
        }
    }

    #[test]
    fn test_decode_empty_bytes() {
        let result = decode_jpeg(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_truncated_jpeg() {
        // JPEG header but truncated
        let truncated = &MINIMAL_JPEG[0..20];
        let result = decode_jpeg(truncated);
        assert!(result.is_err());
    }

    #[test]
    fn test_orientation_extraction_no_exif() {
        // The minimal JPEG has no EXIF data
        let orientation = get_orientation(MINIMAL_JPEG);
        assert_eq!(orientation, Orientation::Normal);
    }

    #[test]
    fn test_orientation_extraction_invalid_data() {
        let orientation = get_orientation(&[0x00, 0x01, 0x02]);
        assert_eq!(orientation, Orientation::Normal);
    }

    #[test]
    fn test_apply_orientation_normal() {
        // Create a simple 2x2 image
        let pixels = vec![
            255, 0, 0, // Red
            0, 255, 0, // Green
            0, 0, 255, // Blue
            255, 255, 0, // Yellow
        ];
        let rgb_img = image::RgbImage::from_raw(2, 2, pixels).unwrap();
        let img = DynamicImage::ImageRgb8(rgb_img);

        // Normal orientation should not change anything
        let result = apply_orientation(img, Orientation::Normal);
        let rgb_result = result.into_rgb8();

        assert_eq!(rgb_result.dimensions(), (2, 2));
        // Top-left pixel should still be red
        assert_eq!(rgb_result.get_pixel(0, 0).0, [255, 0, 0]);
    }

    #[test]
    fn test_apply_orientation_rotate90() {
        // Create a simple 2x1 image (horizontal)
        let pixels = vec![
            255, 0, 0, // Red (left)
            0, 255, 0, // Green (right)
        ];
        let rgb_img = image::RgbImage::from_raw(2, 1, pixels).unwrap();
        let img = DynamicImage::ImageRgb8(rgb_img);

        // Rotate 90 CW should make it 1x2 (vertical)
        let result = apply_orientation(img, Orientation::Rotate90CW);
        let rgb_result = result.into_rgb8();

        // Dimensions should swap
        assert_eq!(rgb_result.dimensions(), (1, 2));
    }

    #[test]
    fn test_apply_orientation_rotate180() {
        // Create a simple 2x1 image
        let pixels = vec![
            255, 0, 0, // Red (left)
            0, 255, 0, // Green (right)
        ];
        let rgb_img = image::RgbImage::from_raw(2, 1, pixels).unwrap();
        let img = DynamicImage::ImageRgb8(rgb_img);

        // Rotate 180 should reverse the order
        let result = apply_orientation(img, Orientation::Rotate180);
        let rgb_result = result.into_rgb8();

        assert_eq!(rgb_result.dimensions(), (2, 1));
        // Left pixel should now be green, right should be red
        assert_eq!(rgb_result.get_pixel(0, 0).0, [0, 255, 0]); // Green
        assert_eq!(rgb_result.get_pixel(1, 0).0, [255, 0, 0]); // Red
    }

    #[test]
    fn test_apply_orientation_flip_horizontal() {
        // Create a simple 2x1 image
        let pixels = vec![
            255, 0, 0, // Red (left)
            0, 255, 0, // Green (right)
        ];
        let rgb_img = image::RgbImage::from_raw(2, 1, pixels).unwrap();
        let img = DynamicImage::ImageRgb8(rgb_img);

        // Flip horizontal should swap left and right
        let result = apply_orientation(img, Orientation::FlipHorizontal);
        let rgb_result = result.into_rgb8();

        assert_eq!(rgb_result.get_pixel(0, 0).0, [0, 255, 0]); // Green
        assert_eq!(rgb_result.get_pixel(1, 0).0, [255, 0, 0]); // Red
    }
}
