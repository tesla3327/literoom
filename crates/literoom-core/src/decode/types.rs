//! Core types for image decoding.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Error types for image decoding operations.
#[derive(Debug, Error)]
pub enum DecodeError {
    /// The file format is not recognized or supported.
    #[error("Invalid or unsupported image format")]
    InvalidFormat,

    /// The camera model is not supported for RAW decoding.
    #[error("Unsupported camera: {0}")]
    UnsupportedCamera(String),

    /// The image file is corrupted or incomplete.
    #[error("Corrupted or incomplete image file: {0}")]
    CorruptedFile(String),

    /// Out of memory during decoding.
    #[error("Out of memory during decoding")]
    OutOfMemory,

    /// I/O error during file reading.
    #[error("I/O error: {0}")]
    IoError(String),

    /// EXIF parsing error.
    #[error("EXIF error: {0}")]
    ExifError(String),

    /// No embedded thumbnail found in RAW file.
    #[error("No embedded thumbnail found")]
    NoThumbnail,
}

/// Filter type for image resizing operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum FilterType {
    /// Nearest neighbor interpolation (fastest, lowest quality).
    Nearest,
    /// Bilinear interpolation (fast, acceptable quality).
    #[default]
    Bilinear,
    /// Lanczos3 interpolation (slower, highest quality).
    Lanczos3,
}

impl FilterType {
    /// Convert to the image crate's FilterType.
    pub fn to_image_filter(self) -> image::imageops::FilterType {
        match self {
            FilterType::Nearest => image::imageops::FilterType::Nearest,
            FilterType::Bilinear => image::imageops::FilterType::Triangle,
            FilterType::Lanczos3 => image::imageops::FilterType::Lanczos3,
        }
    }
}

/// EXIF orientation values (1-8).
/// See: https://exiftool.org/TagNames/EXIF.html
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[repr(u8)]
pub enum Orientation {
    /// Normal (no transformation needed).
    #[default]
    Normal = 1,
    /// Horizontal flip.
    FlipHorizontal = 2,
    /// Rotate 180 degrees.
    Rotate180 = 3,
    /// Vertical flip.
    FlipVertical = 4,
    /// Transpose (flip horizontal + rotate 270 CW).
    Transpose = 5,
    /// Rotate 90 degrees clockwise.
    Rotate90CW = 6,
    /// Transverse (flip horizontal + rotate 90 CW).
    Transverse = 7,
    /// Rotate 270 degrees clockwise (90 CCW).
    Rotate270CW = 8,
}

impl Orientation {
    /// Returns true if this orientation swaps width and height dimensions.
    ///
    /// Rotations of 90° and 270° (and their flip variants Transpose/Transverse)
    /// swap the image dimensions.
    #[inline]
    pub fn swaps_dimensions(self) -> bool {
        matches!(
            self,
            Orientation::Transpose
                | Orientation::Rotate90CW
                | Orientation::Transverse
                | Orientation::Rotate270CW
        )
    }
}

impl From<u32> for Orientation {
    fn from(value: u32) -> Self {
        match value {
            1 => Orientation::Normal,
            2 => Orientation::FlipHorizontal,
            3 => Orientation::Rotate180,
            4 => Orientation::FlipVertical,
            5 => Orientation::Transpose,
            6 => Orientation::Rotate90CW,
            7 => Orientation::Transverse,
            8 => Orientation::Rotate270CW,
            _ => Orientation::Normal,
        }
    }
}

/// Metadata extracted from an image file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageMetadata {
    /// Image width in pixels (before orientation correction).
    pub width: u32,
    /// Image height in pixels (before orientation correction).
    pub height: u32,
    /// EXIF orientation.
    pub orientation: Orientation,
    /// Camera make (e.g., "Sony").
    pub camera_make: Option<String>,
    /// Camera model (e.g., "ILCE-6600").
    pub camera_model: Option<String>,
    /// Date/time the photo was taken (ISO 8601 format).
    pub date_taken: Option<String>,
    /// ISO sensitivity.
    pub iso: Option<u32>,
    /// Shutter speed as a string (e.g., "1/250").
    pub shutter_speed: Option<String>,
    /// Aperture as f-number (e.g., 2.8).
    pub aperture: Option<f32>,
    /// Focal length in mm.
    pub focal_length: Option<f32>,
}

impl ImageMetadata {
    /// Get the effective dimensions after orientation correction.
    pub fn oriented_dimensions(&self) -> (u32, u32) {
        if self.orientation.swaps_dimensions() {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        }
    }
}

/// A decoded image with RGB pixel data.
#[derive(Debug, Clone)]
pub struct DecodedImage {
    /// Image width in pixels.
    pub width: u32,
    /// Image height in pixels.
    pub height: u32,
    /// RGB pixel data in row-major order (3 bytes per pixel).
    /// Length should be width * height * 3.
    pub pixels: Vec<u8>,
}

impl DecodedImage {
    /// Create a new DecodedImage with the given dimensions and pixel data.
    pub fn new(width: u32, height: u32, pixels: Vec<u8>) -> Self {
        debug_assert_eq!(
            pixels.len(),
            (width * height * 3) as usize,
            "Pixel buffer size mismatch"
        );
        Self {
            width,
            height,
            pixels,
        }
    }

    /// Create a DecodedImage from an image::RgbImage.
    pub fn from_rgb_image(img: image::RgbImage) -> Self {
        let (width, height) = img.dimensions();
        let pixels = img.into_raw();
        Self {
            width,
            height,
            pixels,
        }
    }

    /// Convert to an image::RgbImage for further processing.
    pub fn to_rgb_image(&self) -> Option<image::RgbImage> {
        image::RgbImage::from_raw(self.width, self.height, self.pixels.clone())
    }

    /// Get the total number of pixels.
    pub fn pixel_count(&self) -> u32 {
        self.width * self.height
    }

    /// Get the size of the pixel buffer in bytes.
    pub fn byte_size(&self) -> usize {
        self.pixels.len()
    }

    /// Check if this is an empty/invalid image.
    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0 || self.pixels.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_type_conversion() {
        assert!(matches!(
            FilterType::Nearest.to_image_filter(),
            image::imageops::FilterType::Nearest
        ));
        assert!(matches!(
            FilterType::Bilinear.to_image_filter(),
            image::imageops::FilterType::Triangle
        ));
        assert!(matches!(
            FilterType::Lanczos3.to_image_filter(),
            image::imageops::FilterType::Lanczos3
        ));
    }

    #[test]
    fn test_orientation_from_u32() {
        assert_eq!(Orientation::from(1), Orientation::Normal);
        assert_eq!(Orientation::from(6), Orientation::Rotate90CW);
        assert_eq!(Orientation::from(99), Orientation::Normal); // Invalid defaults to Normal
    }

    #[test]
    fn test_orientation_swaps_dimensions() {
        // Non-swapping orientations
        assert!(!Orientation::Normal.swaps_dimensions());
        assert!(!Orientation::FlipHorizontal.swaps_dimensions());
        assert!(!Orientation::Rotate180.swaps_dimensions());
        assert!(!Orientation::FlipVertical.swaps_dimensions());

        // Swapping orientations (90° and 270° rotations and their flip variants)
        assert!(Orientation::Transpose.swaps_dimensions());
        assert!(Orientation::Rotate90CW.swaps_dimensions());
        assert!(Orientation::Transverse.swaps_dimensions());
        assert!(Orientation::Rotate270CW.swaps_dimensions());
    }

    #[test]
    fn test_oriented_dimensions() {
        let mut meta = ImageMetadata {
            width: 6000,
            height: 4000,
            ..Default::default()
        };

        // Normal orientation - no swap
        meta.orientation = Orientation::Normal;
        assert_eq!(meta.oriented_dimensions(), (6000, 4000));

        // Rotate 90 CW - dimensions swap
        meta.orientation = Orientation::Rotate90CW;
        assert_eq!(meta.oriented_dimensions(), (4000, 6000));
    }

    #[test]
    fn test_decoded_image_creation() {
        let pixels = vec![0u8; 100 * 50 * 3];
        let img = DecodedImage::new(100, 50, pixels);

        assert_eq!(img.width, 100);
        assert_eq!(img.height, 50);
        assert_eq!(img.pixel_count(), 5000);
        assert_eq!(img.byte_size(), 15000);
        assert!(!img.is_empty());
    }

    #[test]
    fn test_decoded_image_empty() {
        let img = DecodedImage::new(0, 0, vec![]);
        assert!(img.is_empty());
    }

    #[test]
    fn test_decode_error_display() {
        let err = DecodeError::UnsupportedCamera("Unknown XYZ".to_string());
        assert_eq!(err.to_string(), "Unsupported camera: Unknown XYZ");

        let err = DecodeError::InvalidFormat;
        assert_eq!(err.to_string(), "Invalid or unsupported image format");
    }
}
