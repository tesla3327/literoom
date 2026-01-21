//! Tone curve WASM bindings.
//!
//! This module provides JavaScript bindings for tone curve processing,
//! allowing LUT generation and curve application from the web UI.

use crate::types::JsDecodedImage;
use literoom_core::curve::{apply_tone_curve as core_apply, ToneCurveLut};
use literoom_core::{CurvePoint, ToneCurve};
use wasm_bindgen::prelude::*;

/// JavaScript-accessible tone curve LUT.
///
/// A pre-computed 256-entry lookup table for efficient curve application.
/// Create from curve control points and pass to `apply_tone_curve` for
/// O(1) per-pixel processing.
///
/// # Example (TypeScript)
/// ```typescript
/// // Create LUT from control points
/// const points = [
///   { x: 0, y: 0 },
///   { x: 0.25, y: 0.15 },  // darken shadows
///   { x: 0.75, y: 0.85 },  // brighten highlights
///   { x: 1, y: 1 }
/// ];
/// const lut = new JsToneCurveLut(points);
///
/// // Apply to image
/// const result = apply_tone_curve(image, lut);
///
/// // Don't forget to free WASM memory!
/// lut.free();
/// result.free();
/// ```
#[wasm_bindgen]
pub struct JsToneCurveLut {
    inner: ToneCurveLut,
}

/// Helper struct for deserializing JS curve points via serde.
#[derive(serde::Deserialize)]
struct CurvePointJs {
    x: f32,
    y: f32,
}

#[wasm_bindgen]
impl JsToneCurveLut {
    /// Create a LUT from curve control points.
    ///
    /// # Arguments
    /// * `points` - Array of {x: number, y: number} objects, sorted by x
    ///
    /// # Errors
    /// Returns error if points cannot be deserialized
    #[wasm_bindgen(constructor)]
    pub fn new(points: JsValue) -> Result<JsToneCurveLut, JsValue> {
        let points: Vec<CurvePointJs> = serde_wasm_bindgen::from_value(points)
            .map_err(|e| JsValue::from_str(&format!("Invalid curve points: {}", e)))?;

        let core_points: Vec<CurvePoint> = points
            .into_iter()
            .map(|p| CurvePoint::new(p.x, p.y))
            .collect();

        let curve = ToneCurve {
            points: core_points,
        };
        let inner = ToneCurveLut::from_curve(&curve);

        Ok(JsToneCurveLut { inner })
    }

    /// Create an identity (no-op) LUT.
    ///
    /// This is a fast path for linear curves that produce no change.
    pub fn identity() -> JsToneCurveLut {
        JsToneCurveLut {
            inner: ToneCurveLut::identity(),
        }
    }

    /// Check if this LUT produces no change (is identity).
    ///
    /// Useful for skipping curve application when unnecessary.
    pub fn is_identity(&self) -> bool {
        self.inner.is_identity()
    }

    /// Get raw LUT data (256 bytes) for debugging/visualization.
    ///
    /// Returns a Vec<u8> where lut[i] = output value for input i.
    pub fn get_lut(&self) -> Vec<u8> {
        self.inner.lut.to_vec()
    }

    /// Explicitly free WASM memory.
    ///
    /// This is optional - wasm-bindgen's finalizer will handle cleanup automatically.
    /// Call this if you want to immediately release memory.
    pub fn free(self) {
        // Dropping self releases the memory
    }
}

/// Apply tone curve to an image.
///
/// Takes a JsDecodedImage and a pre-computed LUT, returns a new image
/// with the curve applied to all RGB pixels.
///
/// # Arguments
/// * `image` - Source image (RGB pixels)
/// * `lut` - Pre-computed tone curve LUT
///
/// # Returns
/// New JsDecodedImage with curve applied
///
/// # Example (TypeScript)
/// ```typescript
/// // Create LUT and apply
/// const lut = new JsToneCurveLut(points);
/// const curved = apply_tone_curve(sourceImage, lut);
///
/// // Get result pixels
/// const pixels = curved.pixels();
///
/// // Free memory
/// lut.free();
/// curved.free();
/// ```
#[wasm_bindgen]
pub fn apply_tone_curve(image: &JsDecodedImage, lut: &JsToneCurveLut) -> JsDecodedImage {
    let mut pixels = image.pixels();
    core_apply(&mut pixels, &lut.inner);
    JsDecodedImage::new(image.width(), image.height(), pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_lut() {
        let lut = JsToneCurveLut::identity();
        assert!(lut.is_identity());
    }

    #[test]
    fn test_lut_data_length() {
        let lut = JsToneCurveLut::identity();
        assert_eq!(lut.get_lut().len(), 256);
    }

    #[test]
    fn test_identity_lut_values() {
        let lut = JsToneCurveLut::identity();
        let data = lut.get_lut();
        for i in 0..256 {
            assert_eq!(data[i], i as u8);
        }
    }

    #[test]
    fn test_apply_tone_curve_identity() {
        let lut = JsToneCurveLut::identity();
        let image = JsDecodedImage::new(2, 1, vec![100, 150, 200, 50, 100, 150]);
        let result = apply_tone_curve(&image, &lut);

        assert_eq!(result.width(), 2);
        assert_eq!(result.height(), 1);
        assert_eq!(result.pixels(), vec![100, 150, 200, 50, 100, 150]);
    }

    #[test]
    fn test_apply_tone_curve_modifies() {
        // Create a simple curve that inverts (0->1, 1->0)
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.0, 1.0), CurvePoint::new(1.0, 0.0)],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        let image = JsDecodedImage::new(1, 1, vec![0, 128, 255]);
        let result = apply_tone_curve(&image, &lut);

        let pixels = result.pixels();
        // 0 should map to 255, 255 should map to 0
        assert!(pixels[0] > 250, "Black should map to white");
        assert!(pixels[2] < 5, "White should map to black");
    }
}
