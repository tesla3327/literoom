//! Basic adjustments WASM bindings.
//!
//! This module provides JavaScript bindings for the BasicAdjustments type,
//! allowing photo editing parameters to be manipulated from TypeScript.

use crate::types::JsDecodedImage;
use literoom_core::adjustments::apply_all_adjustments;
use wasm_bindgen::prelude::*;

/// Basic adjustments wrapper for JavaScript
#[wasm_bindgen]
pub struct BasicAdjustments {
    inner: literoom_core::BasicAdjustments,
}

#[wasm_bindgen]
impl BasicAdjustments {
    /// Create new basic adjustments with default values
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: literoom_core::BasicAdjustments::new(),
        }
    }

    /// Get exposure value
    #[wasm_bindgen(getter)]
    pub fn exposure(&self) -> f32 {
        self.inner.exposure
    }

    /// Set exposure value
    #[wasm_bindgen(setter)]
    pub fn set_exposure(&mut self, value: f32) {
        self.inner.exposure = value;
    }

    /// Get contrast value
    #[wasm_bindgen(getter)]
    pub fn contrast(&self) -> f32 {
        self.inner.contrast
    }

    /// Set contrast value
    #[wasm_bindgen(setter)]
    pub fn set_contrast(&mut self, value: f32) {
        self.inner.contrast = value;
    }

    /// Get highlights value
    #[wasm_bindgen(getter)]
    pub fn highlights(&self) -> f32 {
        self.inner.highlights
    }

    /// Set highlights value
    #[wasm_bindgen(setter)]
    pub fn set_highlights(&mut self, value: f32) {
        self.inner.highlights = value;
    }

    /// Get shadows value
    #[wasm_bindgen(getter)]
    pub fn shadows(&self) -> f32 {
        self.inner.shadows
    }

    /// Set shadows value
    #[wasm_bindgen(setter)]
    pub fn set_shadows(&mut self, value: f32) {
        self.inner.shadows = value;
    }

    /// Get temperature value
    #[wasm_bindgen(getter)]
    pub fn temperature(&self) -> f32 {
        self.inner.temperature
    }

    /// Set temperature value
    #[wasm_bindgen(setter)]
    pub fn set_temperature(&mut self, value: f32) {
        self.inner.temperature = value;
    }

    /// Get tint value
    #[wasm_bindgen(getter)]
    pub fn tint(&self) -> f32 {
        self.inner.tint
    }

    /// Set tint value
    #[wasm_bindgen(setter)]
    pub fn set_tint(&mut self, value: f32) {
        self.inner.tint = value;
    }

    /// Get vibrance value
    #[wasm_bindgen(getter)]
    pub fn vibrance(&self) -> f32 {
        self.inner.vibrance
    }

    /// Set vibrance value
    #[wasm_bindgen(setter)]
    pub fn set_vibrance(&mut self, value: f32) {
        self.inner.vibrance = value;
    }

    /// Get saturation value
    #[wasm_bindgen(getter)]
    pub fn saturation(&self) -> f32 {
        self.inner.saturation
    }

    /// Set saturation value
    #[wasm_bindgen(setter)]
    pub fn set_saturation(&mut self, value: f32) {
        self.inner.saturation = value;
    }

    /// Get whites value
    #[wasm_bindgen(getter)]
    pub fn whites(&self) -> f32 {
        self.inner.whites
    }

    /// Set whites value
    #[wasm_bindgen(setter)]
    pub fn set_whites(&mut self, value: f32) {
        self.inner.whites = value;
    }

    /// Get blacks value
    #[wasm_bindgen(getter)]
    pub fn blacks(&self) -> f32 {
        self.inner.blacks
    }

    /// Set blacks value
    #[wasm_bindgen(setter)]
    pub fn set_blacks(&mut self, value: f32) {
        self.inner.blacks = value;
    }

    /// Check if all adjustments are at default values
    pub fn is_default(&self) -> bool {
        self.inner.is_default()
    }

    /// Serialize to JSON for storage
    pub fn to_json(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Deserialize from JSON
    pub fn from_json(value: JsValue) -> Result<BasicAdjustments, JsValue> {
        let inner: literoom_core::BasicAdjustments =
            serde_wasm_bindgen::from_value(value).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(Self { inner })
    }
}

impl Default for BasicAdjustments {
    fn default() -> Self {
        Self::new()
    }
}

impl BasicAdjustments {
    /// Get a reference to the inner BasicAdjustments for use in apply_adjustments
    pub(crate) fn inner(&self) -> &literoom_core::BasicAdjustments {
        &self.inner
    }
}

/// Apply all adjustments to an image.
///
/// Takes an image and adjustments, returning a new adjusted image.
/// The original image's pixel data is cloned and modified.
///
/// # Arguments
/// * `image` - The source image to apply adjustments to
/// * `adjustments` - The adjustment values to apply
///
/// # Returns
/// A new JsDecodedImage with the adjustments applied
///
/// # Example (TypeScript)
/// ```typescript
/// const adj = new BasicAdjustments();
/// adj.exposure = 1.0;  // +1 stop
/// adj.contrast = 20;   // +20 contrast
///
/// const adjusted = apply_adjustments(sourceImage, adj);
/// const pixels = adjusted.pixels();
/// ```
#[wasm_bindgen]
pub fn apply_adjustments(image: &JsDecodedImage, adjustments: &BasicAdjustments) -> JsDecodedImage {
    // Clone the pixel data so we don't modify the original
    let mut pixels = image.pixels();

    // Apply all adjustments
    apply_all_adjustments(&mut pixels, adjustments.inner());

    // Return a new image with the adjusted pixels
    JsDecodedImage::new(image.width(), image.height(), pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_adjustments() {
        let mut adj = BasicAdjustments::new();
        assert!(adj.is_default());

        adj.set_exposure(1.0);
        assert_eq!(adj.exposure(), 1.0);
        assert!(!adj.is_default());
    }

    #[test]
    fn test_all_adjustments() {
        let mut adj = BasicAdjustments::new();

        adj.set_contrast(0.5);
        assert_eq!(adj.contrast(), 0.5);

        adj.set_highlights(-0.3);
        assert_eq!(adj.highlights(), -0.3);

        adj.set_shadows(0.2);
        assert_eq!(adj.shadows(), 0.2);

        adj.set_temperature(5500.0);
        assert_eq!(adj.temperature(), 5500.0);

        adj.set_tint(10.0);
        assert_eq!(adj.tint(), 10.0);

        adj.set_vibrance(0.1);
        assert_eq!(adj.vibrance(), 0.1);

        adj.set_saturation(-0.1);
        assert_eq!(adj.saturation(), -0.1);

        adj.set_whites(0.05);
        assert_eq!(adj.whites(), 0.05);

        adj.set_blacks(-0.05);
        assert_eq!(adj.blacks(), -0.05);
    }

    #[test]
    fn test_apply_adjustments_identity() {
        // Create a simple 2x1 image with two gray pixels
        let pixels = vec![128, 128, 128, 64, 64, 64];
        let image = JsDecodedImage::new(2, 1, pixels.clone());
        let adj = BasicAdjustments::new();

        let result = apply_adjustments(&image, &adj);

        assert_eq!(result.width(), 2);
        assert_eq!(result.height(), 1);
        assert_eq!(result.pixels(), pixels);
    }

    #[test]
    fn test_apply_adjustments_exposure() {
        // Create a 1x1 gray pixel
        let pixels = vec![64, 64, 64];
        let image = JsDecodedImage::new(1, 1, pixels);

        let mut adj = BasicAdjustments::new();
        adj.set_exposure(1.0); // +1 stop = 2x brightness

        let result = apply_adjustments(&image, &adj);
        let result_pixels = result.pixels();

        // 64 * 2 = 128
        assert_eq!(result_pixels, vec![128, 128, 128]);
    }

    #[test]
    fn test_apply_adjustments_does_not_modify_original() {
        let pixels = vec![100, 100, 100];
        let image = JsDecodedImage::new(1, 1, pixels.clone());

        let mut adj = BasicAdjustments::new();
        adj.set_exposure(2.0);

        let _result = apply_adjustments(&image, &adj);

        // Original image should be unchanged
        assert_eq!(image.pixels(), pixels);
    }

    #[test]
    fn test_apply_adjustments_contrast() {
        // Dark pixel
        let pixels = vec![64, 64, 64];
        let image = JsDecodedImage::new(1, 1, pixels);

        let mut adj = BasicAdjustments::new();
        adj.set_contrast(100.0); // Double contrast

        let result = apply_adjustments(&image, &adj);
        let result_pixels = result.pixels();

        // Dark pixel should get darker with increased contrast
        assert!(result_pixels[0] < 64, "Dark pixel should get darker");
    }
}
