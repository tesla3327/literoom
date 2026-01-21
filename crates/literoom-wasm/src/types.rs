//! WASM-compatible wrapper types for image data.
//!
//! This module provides JavaScript-friendly types that wrap the core Literoom types,
//! handling the conversion between Rust and JavaScript data representations.

use literoom_core::decode::{DecodedImage, FilterType};
use wasm_bindgen::prelude::*;

/// A decoded image wrapper for JavaScript.
///
/// This type wraps the core `DecodedImage` type and provides a JavaScript-friendly
/// interface for accessing image dimensions and pixel data.
///
/// # Memory Management
///
/// The pixel data is stored in WASM memory. When you call `pixels()`, a copy is made
/// to JavaScript memory as a `Uint8Array`. For performance-critical code, consider
/// keeping the image in WASM memory and only extracting pixels when needed.
///
/// The `free()` method can be called to explicitly release WASM memory, but this is
/// optional as wasm-bindgen's finalizer will handle cleanup automatically.
#[wasm_bindgen]
pub struct JsDecodedImage {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl JsDecodedImage {
    /// Create a new JsDecodedImage from dimensions and pixel data.
    ///
    /// # Arguments
    /// * `width` - Image width in pixels
    /// * `height` - Image height in pixels
    /// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, pixels: Vec<u8>) -> JsDecodedImage {
        JsDecodedImage {
            width,
            height,
            pixels,
        }
    }

    /// Get the image width in pixels
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Get the image height in pixels
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Get the number of bytes in the pixel buffer (width * height * 3 for RGB)
    #[wasm_bindgen(getter)]
    pub fn byte_length(&self) -> usize {
        self.pixels.len()
    }

    /// Returns RGB pixel data as Uint8Array.
    ///
    /// Note: This creates a copy of the pixel data. For large images, this can
    /// take 10-50ms but is necessary for safe memory management.
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }

    /// Explicitly free WASM memory.
    ///
    /// This is optional - wasm-bindgen's finalizer will handle cleanup automatically.
    /// Call this if you want to immediately release memory for a large image.
    pub fn free(self) {
        // Dropping self releases the memory
    }
}

impl JsDecodedImage {
    /// Create a JsDecodedImage from a core DecodedImage.
    ///
    /// This is an internal constructor used by the decode bindings.
    #[allow(dead_code)] // Used in decode module (Phase 3)
    pub(crate) fn from_decoded(img: DecodedImage) -> Self {
        Self {
            width: img.width,
            height: img.height,
            pixels: img.pixels,
        }
    }

    /// Convert back to a core DecodedImage.
    ///
    /// This is used when passing an image to core functions like resize.
    /// Note: This clones the pixel data.
    #[allow(dead_code)] // Used in decode module (Phase 3)
    pub(crate) fn to_decoded(&self) -> DecodedImage {
        DecodedImage {
            width: self.width,
            height: self.height,
            pixels: self.pixels.clone(),
        }
    }
}

/// Convert a u8 filter type value to the core FilterType enum.
///
/// Values:
/// - 0 = Nearest (fastest, lowest quality)
/// - 1 = Bilinear (good balance of speed and quality)
/// - 2 = Lanczos3 (best quality, slowest)
///
/// Any other value defaults to Bilinear.
#[allow(dead_code)] // Used in decode module (Phase 3)
pub(crate) fn filter_from_u8(value: u8) -> FilterType {
    match value {
        0 => FilterType::Nearest,
        2 => FilterType::Lanczos3,
        _ => FilterType::Bilinear, // Default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_decoded_image_creation() {
        let img = JsDecodedImage {
            width: 100,
            height: 50,
            pixels: vec![0u8; 100 * 50 * 3],
        };
        assert_eq!(img.width(), 100);
        assert_eq!(img.height(), 50);
        assert_eq!(img.byte_length(), 15000);
    }

    #[test]
    fn test_js_decoded_image_pixels() {
        let pixels = vec![255u8, 128, 64, 32, 16, 8]; // 2 RGB pixels
        let img = JsDecodedImage {
            width: 2,
            height: 1,
            pixels: pixels.clone(),
        };
        assert_eq!(img.pixels(), pixels);
    }

    #[test]
    fn test_from_decoded() {
        let decoded = DecodedImage {
            width: 200,
            height: 100,
            pixels: vec![0u8; 200 * 100 * 3],
        };
        let js_img = JsDecodedImage::from_decoded(decoded);
        assert_eq!(js_img.width(), 200);
        assert_eq!(js_img.height(), 100);
        assert_eq!(js_img.byte_length(), 60000);
    }

    #[test]
    fn test_to_decoded() {
        let js_img = JsDecodedImage {
            width: 50,
            height: 25,
            pixels: vec![128u8; 50 * 25 * 3],
        };
        let decoded = js_img.to_decoded();
        assert_eq!(decoded.width, 50);
        assert_eq!(decoded.height, 25);
        assert_eq!(decoded.pixels.len(), 3750);
    }

    #[test]
    fn test_filter_from_u8() {
        assert!(matches!(filter_from_u8(0), FilterType::Nearest));
        assert!(matches!(filter_from_u8(1), FilterType::Bilinear));
        assert!(matches!(filter_from_u8(2), FilterType::Lanczos3));
        // Unknown values default to Bilinear
        assert!(matches!(filter_from_u8(3), FilterType::Bilinear));
        assert!(matches!(filter_from_u8(255), FilterType::Bilinear));
    }
}
