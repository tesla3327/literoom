//! Histogram computation WASM bindings.
//!
//! This module provides JavaScript bindings for histogram computation,
//! allowing RGB and luminance histograms to be calculated from pixel data.

use literoom_core::histogram::compute_histogram as compute_histogram_core;
use wasm_bindgen::prelude::*;

/// Histogram result accessible from JavaScript.
///
/// Contains 256-bin histograms for red, green, blue, and luminance channels,
/// plus helper methods for clipping detection and normalization.
#[wasm_bindgen]
pub struct JsHistogram {
    red: Vec<u32>,
    green: Vec<u32>,
    blue: Vec<u32>,
    luminance: Vec<u32>,
    max_value: u32,
    has_highlight_clipping: bool,
    has_shadow_clipping: bool,
}

#[wasm_bindgen]
impl JsHistogram {
    /// Get red channel histogram (256 bins).
    pub fn red(&self) -> Vec<u32> {
        self.red.clone()
    }

    /// Get green channel histogram (256 bins).
    pub fn green(&self) -> Vec<u32> {
        self.green.clone()
    }

    /// Get blue channel histogram (256 bins).
    pub fn blue(&self) -> Vec<u32> {
        self.blue.clone()
    }

    /// Get luminance histogram (256 bins).
    pub fn luminance(&self) -> Vec<u32> {
        self.luminance.clone()
    }

    /// Get maximum bin value across all RGB channels.
    ///
    /// Useful for normalizing histogram display.
    #[wasm_bindgen(getter)]
    pub fn max_value(&self) -> u32 {
        self.max_value
    }

    /// Check if any RGB channel has values at 255 (highlight clipping).
    #[wasm_bindgen(getter)]
    pub fn has_highlight_clipping(&self) -> bool {
        self.has_highlight_clipping
    }

    /// Check if any RGB channel has values at 0 (shadow clipping).
    #[wasm_bindgen(getter)]
    pub fn has_shadow_clipping(&self) -> bool {
        self.has_shadow_clipping
    }
}

/// Compute histogram from RGB pixel data.
///
/// # Arguments
/// * `pixels` - RGB pixel data as Uint8Array (3 bytes per pixel, row-major)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
///
/// # Returns
/// JsHistogram with all channel data and clipping info
///
/// # Example (TypeScript)
/// ```typescript
/// // Get pixel data from decoded image
/// const pixels = decodedImage.pixels();
///
/// // Compute histogram
/// const hist = compute_histogram(pixels, width, height);
///
/// // Access data
/// const redBins = hist.red();        // Uint32Array[256]
/// const max = hist.max_value;        // For normalization
/// const clipped = hist.has_highlight_clipping;
///
/// // Don't forget to free!
/// hist.free();
/// ```
#[wasm_bindgen]
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> JsHistogram {
    let hist = compute_histogram_core(pixels, width, height);

    JsHistogram {
        red: hist.red.to_vec(),
        green: hist.green.to_vec(),
        blue: hist.blue.to_vec(),
        luminance: hist.luminance.to_vec(),
        max_value: hist.max_value(),
        has_highlight_clipping: hist.has_highlight_clipping(),
        has_shadow_clipping: hist.has_shadow_clipping(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_histogram_creation() {
        let pixels = vec![255, 0, 0, 0, 255, 0, 0, 0, 255];
        let hist = compute_histogram(&pixels, 3, 1);

        assert_eq!(hist.red().len(), 256);
        assert_eq!(hist.green().len(), 256);
        assert_eq!(hist.blue().len(), 256);
        assert_eq!(hist.luminance().len(), 256);
        assert!(hist.has_highlight_clipping);
        assert!(hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_max_value() {
        let pixels = vec![128, 128, 128, 128, 128, 128, 128, 128, 128, 200, 200, 200];
        let hist = compute_histogram(&pixels, 4, 1);

        assert_eq!(hist.max_value, 3); // 3 pixels at value 128
        assert_eq!(hist.red()[128], 3);
        assert_eq!(hist.red()[200], 1);
    }

    #[test]
    fn test_js_histogram_no_clipping() {
        let pixels = vec![64, 64, 64, 128, 128, 128, 192, 192, 192];
        let hist = compute_histogram(&pixels, 3, 1);

        assert!(!hist.has_highlight_clipping);
        assert!(!hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_empty() {
        let pixels: Vec<u8> = vec![];
        let hist = compute_histogram(&pixels, 0, 0);

        assert_eq!(hist.max_value, 0);
        assert!(!hist.has_highlight_clipping);
        assert!(!hist.has_shadow_clipping);
    }

    #[test]
    fn test_js_histogram_luminance() {
        // Pure white pixel
        let pixels = vec![255, 255, 255];
        let hist = compute_histogram(&pixels, 1, 1);

        assert_eq!(hist.luminance()[255], 1);
    }

    #[test]
    fn test_js_histogram_gradients() {
        // Create a simple gradient from 0 to 255
        let mut pixels = Vec::new();
        for i in 0..=255 {
            pixels.push(i as u8);
            pixels.push(i as u8);
            pixels.push(i as u8);
        }
        let hist = compute_histogram(&pixels, 256, 1);

        // Each bin should have exactly 1 pixel
        for i in 0..256 {
            assert_eq!(hist.red()[i], 1);
            assert_eq!(hist.green()[i], 1);
            assert_eq!(hist.blue()[i], 1);
        }
        assert_eq!(hist.max_value, 1);
    }
}
