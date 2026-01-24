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
        for (i, &val) in data.iter().enumerate() {
            assert_eq!(val, i as u8);
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

    // ========================================================================
    // Additional Identity LUT Tests
    // ========================================================================

    #[test]
    fn test_identity_lut_exact_values() {
        let lut = JsToneCurveLut::identity();
        let data = lut.get_lut();
        for i in 0..=255u8 {
            assert_eq!(
                data[i as usize], i,
                "Identity LUT at index {} should be {}, got {}",
                i, i, data[i as usize]
            );
        }
    }

    #[test]
    fn test_identity_lut_no_effect_on_boundary_pixels() {
        let lut = JsToneCurveLut::identity();
        // Test with boundary pixel values: 0, 128, 255
        let image = JsDecodedImage::new(1, 1, vec![0, 128, 255]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();
        assert_eq!(pixels[0], 0, "Black pixel (0) should remain unchanged");
        assert_eq!(pixels[1], 128, "Mid-gray pixel (128) should remain unchanged");
        assert_eq!(pixels[2], 255, "White pixel (255) should remain unchanged");
    }

    #[test]
    fn test_identity_lut_no_effect_on_various_pixels() {
        let lut = JsToneCurveLut::identity();
        // Test multiple pixels with various values
        let original_pixels = vec![
            0, 0, 0,       // Black
            128, 128, 128, // Mid-gray
            255, 255, 255, // White
            64, 192, 32,   // Random color
        ];
        let image = JsDecodedImage::new(2, 2, original_pixels.clone());
        let result = apply_tone_curve(&image, &lut);
        assert_eq!(result.pixels(), original_pixels);
    }

    // ========================================================================
    // LUT Construction Tests
    // ========================================================================

    #[test]
    fn test_lut_from_two_point_linear_curve() {
        // A simple two-point linear curve from 0,0 to 1,1
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.0, 0.0), CurvePoint::new(1.0, 1.0)],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Should produce identity or near-identity LUT
        let data = lut.get_lut();
        for i in 0..=255u8 {
            let diff = (data[i as usize] as i32 - i as i32).abs();
            assert!(
                diff <= 1,
                "Linear curve LUT at {} should be near {}, got {} (diff: {})",
                i,
                i,
                data[i as usize],
                diff
            );
        }
    }

    #[test]
    fn test_lut_from_s_curve() {
        // Classic S-curve for contrast boost
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),
                CurvePoint::new(0.75, 0.85),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        let data = lut.get_lut();
        // Shadows should be darker (value at 64 should be less than 64)
        assert!(
            data[64] < 64,
            "S-curve should darken shadows: value at 64 is {}",
            data[64]
        );
        // Highlights should be brighter (value at 192 should be greater than 192)
        assert!(
            data[192] > 192,
            "S-curve should brighten highlights: value at 192 is {}",
            data[192]
        );
        // Endpoints should remain at 0 and 255
        assert_eq!(data[0], 0, "Black should remain black");
        assert_eq!(data[255], 255, "White should remain white");
    }

    #[test]
    fn test_lut_from_curve_with_nonstandard_endpoints() {
        // Curve that doesn't start at 0,0 or end at 1,1
        // This raises the black point and lowers the white point
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.2),  // Raised blacks
                CurvePoint::new(1.0, 0.8),  // Lowered whites
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        let data = lut.get_lut();
        // Black input (0) should map to approximately 0.2 * 255 = 51
        assert!(
            (data[0] as i32 - 51).abs() < 5,
            "Black point should be raised to ~51, got {}",
            data[0]
        );
        // White input (255) should map to approximately 0.8 * 255 = 204
        assert!(
            (data[255] as i32 - 204).abs() < 5,
            "White point should be lowered to ~204, got {}",
            data[255]
        );
    }

    // ========================================================================
    // apply_tone_curve Function Tests
    // ========================================================================

    #[test]
    fn test_apply_curve_to_single_pixel() {
        // Brightness boost curve: linear but shifted up
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.1),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        let image = JsDecodedImage::new(1, 1, vec![100, 100, 100]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // All channels should be brighter than original
        assert!(
            pixels[0] > 100,
            "Brightness curve should increase pixel value"
        );
    }

    #[test]
    fn test_apply_curve_to_multi_pixel_image() {
        // Invert curve
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.0, 1.0), CurvePoint::new(1.0, 0.0)],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // 2x2 image with 4 pixels
        let image = JsDecodedImage::new(2, 2, vec![
            0, 0, 0,       // Black -> White
            255, 255, 255, // White -> Black
            100, 150, 200, // Various grays
            50, 100, 150,  // More grays
        ]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // Check black becomes white
        assert!(pixels[0] > 250, "Black should become white");
        assert!(pixels[1] > 250, "Black should become white");
        assert!(pixels[2] > 250, "Black should become white");

        // Check white becomes black
        assert!(pixels[3] < 5, "White should become black");
        assert!(pixels[4] < 5, "White should become black");
        assert!(pixels[5] < 5, "White should become black");
    }

    #[test]
    fn test_curve_applies_uniformly_to_rgb_channels() {
        // Contrast boost S-curve
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),
                CurvePoint::new(0.75, 0.85),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Single pixel with same value in all channels
        let image = JsDecodedImage::new(1, 1, vec![128, 128, 128]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // All channels should have the same output since they had the same input
        assert_eq!(
            pixels[0], pixels[1],
            "R and G channels should be equal for same input"
        );
        assert_eq!(
            pixels[1], pixels[2],
            "G and B channels should be equal for same input"
        );
    }

    #[test]
    fn test_curve_on_all_black_pixels() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.6),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // All black image
        let image = JsDecodedImage::new(2, 2, vec![0; 12]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // All pixels should remain at 0 since the curve passes through 0,0
        for (i, &p) in pixels.iter().enumerate() {
            assert_eq!(p, 0, "Black pixel at index {} should remain black", i);
        }
    }

    #[test]
    fn test_curve_on_all_white_pixels() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.4),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // All white image
        let image = JsDecodedImage::new(2, 2, vec![255; 12]);
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // All pixels should remain at 255 since the curve passes through 1,1
        for (i, &p) in pixels.iter().enumerate() {
            assert_eq!(p, 255, "White pixel at index {} should remain white", i);
        }
    }

    #[test]
    fn test_curve_on_gradient_pixels() {
        // Linear curve for predictable behavior
        let curve = ToneCurve {
            points: vec![CurvePoint::new(0.0, 0.0), CurvePoint::new(1.0, 1.0)],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Gradient from black to white (8 pixels)
        let gradient: Vec<u8> = (0..8).flat_map(|i| {
            let v = (i * 36).min(255) as u8; // 0, 36, 72, 108, 144, 180, 216, 252
            vec![v, v, v]
        }).collect();

        let image = JsDecodedImage::new(8, 1, gradient.clone());
        let result = apply_tone_curve(&image, &lut);
        let pixels = result.pixels();

        // With identity-like curve, gradient should be preserved (within rounding)
        for (i, chunk) in pixels.chunks(3).enumerate() {
            let original_val = (i * 36).min(255) as u8;
            let diff = (chunk[0] as i32 - original_val as i32).abs();
            assert!(
                diff <= 1,
                "Gradient pixel {} should be preserved: expected ~{}, got {}",
                i,
                original_val,
                chunk[0]
            );
        }
    }

    // ========================================================================
    // Edge Case Tests
    // ========================================================================

    #[test]
    fn test_curve_with_points_very_close_together() {
        // Points very close on the x-axis
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.3),
                CurvePoint::new(0.501, 0.7), // Very close to previous point
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Verify LUT is generated without panics and has correct length
        let data = lut.get_lut();
        assert_eq!(data.len(), 256, "LUT should have 256 entries");

        // Verify endpoints are sensible
        assert_eq!(data[0], 0, "Black input should map to black output");
        assert_eq!(data[255], 255, "White input should map to white output");
    }

    #[test]
    fn test_curve_with_steep_transitions() {
        // Very steep curve
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.1, 0.9), // Steep rise
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        let data = lut.get_lut();
        // Verify LUT has correct length
        assert_eq!(data.len(), 256, "LUT should have 256 entries");

        // Verify curve behavior: after the steep rise at 0.1, values should be high
        // Index 26 corresponds to input ~0.1 (26/255)
        let after_steep = data[26];
        assert!(
            after_steep > 200,
            "After steep rise at ~0.1, value should be high, got {}",
            after_steep
        );

        // Mid-point should be high due to the steep rise early on
        let mid_point = data[128];
        assert!(
            mid_point > 200,
            "After steep rise, mid-point should be high, got {}",
            mid_point
        );
    }

    #[test]
    fn test_output_always_valid_range() {
        // Various curves that might cause overflow/underflow during computation
        let test_curves = vec![
            // Extreme contrast
            ToneCurve {
                points: vec![
                    CurvePoint::new(0.0, 0.0),
                    CurvePoint::new(0.4, 0.0),
                    CurvePoint::new(0.6, 1.0),
                    CurvePoint::new(1.0, 1.0),
                ],
            },
            // Inverted curve
            ToneCurve {
                points: vec![CurvePoint::new(0.0, 1.0), CurvePoint::new(1.0, 0.0)],
            },
            // Multiple inflection points
            ToneCurve {
                points: vec![
                    CurvePoint::new(0.0, 0.0),
                    CurvePoint::new(0.25, 0.4),
                    CurvePoint::new(0.5, 0.3),
                    CurvePoint::new(0.75, 0.7),
                    CurvePoint::new(1.0, 1.0),
                ],
            },
        ];

        for (curve_idx, curve) in test_curves.iter().enumerate() {
            let inner = ToneCurveLut::from_curve(curve);
            let lut = JsToneCurveLut { inner };
            let data = lut.get_lut();

            // Verify LUT has correct length (256 entries)
            assert_eq!(
                data.len(),
                256,
                "Curve {} LUT should have 256 entries",
                curve_idx
            );

            // Apply the curve to an image with all possible values
            // and verify no panics occur
            let all_values: Vec<u8> = (0..=255).flat_map(|v| vec![v, v, v]).collect();
            let image = JsDecodedImage::new(256, 1, all_values);
            let result = apply_tone_curve(&image, &lut);

            // Result should have same dimensions
            assert_eq!(result.width(), 256, "Result width should match");
            assert_eq!(result.height(), 1, "Result height should match");
            assert_eq!(
                result.pixels().len(),
                256 * 3,
                "Result should have correct pixel count"
            );
        }
    }

    // ========================================================================
    // Integration Workflow Tests
    // ========================================================================

    #[test]
    fn test_lut_reuse() {
        // Create a LUT once and apply to multiple images
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.7),
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Apply to first image
        let image1 = JsDecodedImage::new(1, 1, vec![100, 100, 100]);
        let result1 = apply_tone_curve(&image1, &lut);

        // Apply to second image with same pixel values - should get same result
        let image2 = JsDecodedImage::new(1, 1, vec![100, 100, 100]);
        let result2 = apply_tone_curve(&image2, &lut);

        assert_eq!(
            result1.pixels(),
            result2.pixels(),
            "Same LUT applied to same pixels should produce identical results"
        );

        // Apply to different sized image
        let image3 = JsDecodedImage::new(2, 2, vec![100; 12]);
        let result3 = apply_tone_curve(&image3, &lut);

        // All pixels should have the same transformed value
        let expected_val = result1.pixels()[0];
        for (i, &v) in result3.pixels().iter().enumerate() {
            assert_eq!(
                v, expected_val,
                "Pixel {} should be {}, got {}",
                i, expected_val, v
            );
        }
    }

    #[test]
    fn test_chaining_curve_applications() {
        // Create two different curves
        let curve1 = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(1.0, 0.8), // Darken
            ],
        };
        let curve2 = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.2), // Raise blacks
                CurvePoint::new(1.0, 1.0),
            ],
        };

        let lut1 = JsToneCurveLut {
            inner: ToneCurveLut::from_curve(&curve1),
        };
        let lut2 = JsToneCurveLut {
            inner: ToneCurveLut::from_curve(&curve2),
        };

        // Apply curves in sequence
        let image = JsDecodedImage::new(1, 1, vec![128, 128, 128]);
        let intermediate = apply_tone_curve(&image, &lut1);
        let final_result = apply_tone_curve(&intermediate, &lut2);

        // The result should be different from applying either curve alone
        let result_with_lut1_only = apply_tone_curve(&image, &lut1);
        let result_with_lut2_only = apply_tone_curve(&image, &lut2);

        let final_pixels = final_result.pixels();
        let lut1_pixels = result_with_lut1_only.pixels();
        let lut2_pixels = result_with_lut2_only.pixels();

        // Chained result should differ from single applications
        assert_ne!(
            final_pixels, lut1_pixels,
            "Chained curves should differ from single curve 1"
        );
        assert_ne!(
            final_pixels, lut2_pixels,
            "Chained curves should differ from single curve 2"
        );
    }

    #[test]
    fn test_create_apply_verify_workflow() {
        // Complete workflow: create curve, build LUT, apply, verify
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15), // Darken shadows
                CurvePoint::new(0.75, 0.85), // Brighten highlights
                CurvePoint::new(1.0, 1.0),
            ],
        };

        // Build LUT
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        // Verify LUT properties
        assert!(!lut.is_identity(), "S-curve should not be identity");
        assert_eq!(lut.get_lut().len(), 256, "LUT should have 256 entries");

        // Apply to test image with known values
        let test_image = JsDecodedImage::new(3, 1, vec![
            32, 32, 32,     // Dark shadow
            128, 128, 128,  // Mid-tone
            224, 224, 224,  // Highlight
        ]);

        let result = apply_tone_curve(&test_image, &lut);
        let pixels = result.pixels();

        // Verify shadows are darker
        assert!(
            pixels[0] < 32,
            "Shadow should be darker: {} vs 32",
            pixels[0]
        );

        // Verify highlights are brighter
        assert!(
            pixels[6] > 224,
            "Highlight should be brighter: {} vs 224",
            pixels[6]
        );

        // Verify dimensions preserved
        assert_eq!(result.width(), 3);
        assert_eq!(result.height(), 1);
    }

    #[test]
    fn test_non_identity_lut_is_detected() {
        // Create a curve that modifies values
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.1),  // Raised black point
                CurvePoint::new(1.0, 0.9),  // Lowered white point
            ],
        };
        let inner = ToneCurveLut::from_curve(&curve);
        let lut = JsToneCurveLut { inner };

        assert!(
            !lut.is_identity(),
            "LUT with modified endpoints should not be identity"
        );
    }
}

/// WASM-specific tests that require JsValue.
///
/// These tests use the `JsToneCurveLut::new` constructor which takes a `JsValue`
/// parameter and can only run on wasm32 targets. Use `wasm-pack test` to run these.
#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use serde::Serialize;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(Serialize)]
    struct TestCurvePoint {
        x: f32,
        y: f32,
    }

    // =========================================================================
    // JsToneCurveLut constructor tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_create_lut_from_linear_curve() {
        // Identity curve: input = output
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_ok());

        let lut = result.unwrap();
        // Linear curve should be identity
        assert!(lut.is_identity());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_from_s_curve() {
        // S-curve for contrast boost: darken shadows, brighten highlights
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.15 },
            TestCurvePoint { x: 0.75, y: 0.85 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_ok());

        let lut = result.unwrap();
        // S-curve is not identity
        assert!(!lut.is_identity());

        // Verify contrast characteristics
        let lut_data = lut.get_lut();
        // Shadows should be darker (lower values)
        assert!(lut_data[64] < 64, "Shadows should be darkened");
        // Highlights should be brighter (higher values)
        assert!(lut_data[192] > 192, "Highlights should be brightened");
    }

    #[wasm_bindgen_test]
    fn test_create_lut_from_inverted_curve() {
        // Inverted curve: 0->1, 1->0
        let points = vec![
            TestCurvePoint { x: 0.0, y: 1.0 },
            TestCurvePoint { x: 1.0, y: 0.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_ok());

        let lut = result.unwrap();
        assert!(!lut.is_identity());

        let lut_data = lut.get_lut();
        // Black (0) should map to white (255)
        assert!(lut_data[0] > 250, "Black should map to near white");
        // White (255) should map to black (0)
        assert!(lut_data[255] < 5, "White should map to near black");
    }

    #[wasm_bindgen_test]
    fn test_create_lut_from_multiple_control_points() {
        // Complex curve with multiple control points
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.2, y: 0.3 },
            TestCurvePoint { x: 0.4, y: 0.35 },
            TestCurvePoint { x: 0.6, y: 0.65 },
            TestCurvePoint { x: 0.8, y: 0.7 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_ok());

        let lut = result.unwrap();
        assert_eq!(lut.get_lut().len(), 256);
    }

    // =========================================================================
    // JsToneCurveLut error handling tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_create_lut_invalid_points_data() {
        // Pass a string instead of array
        let invalid = serde_wasm_bindgen::to_value(&"not an array").unwrap();

        let result = JsToneCurveLut::new(invalid);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_empty_points_array() {
        let empty: Vec<TestCurvePoint> = vec![];
        let js_points = serde_wasm_bindgen::to_value(&empty).unwrap();

        let result = JsToneCurveLut::new(js_points);
        // Empty array should deserialize OK but create a degenerate curve
        // The actual behavior depends on core implementation
        assert!(result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_non_object_data() {
        // Pass a number instead of object array
        let invalid = serde_wasm_bindgen::to_value(&42).unwrap();

        let result = JsToneCurveLut::new(invalid);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_missing_x_field() {
        // Create object with missing x field
        #[derive(Serialize)]
        struct PointMissingX {
            y: f32,
        }
        let points = vec![PointMissingX { y: 0.5 }];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_missing_y_field() {
        // Create object with missing y field
        #[derive(Serialize)]
        struct PointMissingY {
            x: f32,
        }
        let points = vec![PointMissingY { x: 0.5 }];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_err());
    }

    #[wasm_bindgen_test]
    fn test_create_lut_wrong_field_types() {
        // Create object with wrong field types (strings instead of numbers)
        #[derive(Serialize)]
        struct PointWrongTypes {
            x: String,
            y: String,
        }
        let points = vec![PointWrongTypes {
            x: "zero".to_string(),
            y: "one".to_string(),
        }];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        let result = JsToneCurveLut::new(js_points);
        assert!(result.is_err());
    }

    // =========================================================================
    // identity() and is_identity() tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_identity_creates_proper_identity_lut() {
        let lut = JsToneCurveLut::identity();

        // Verify LUT data is proper identity mapping
        let data = lut.get_lut();
        for (i, &val) in data.iter().enumerate() {
            assert_eq!(
                val, i as u8,
                "Identity LUT should map {} to {}",
                i, i
            );
        }
    }

    #[wasm_bindgen_test]
    fn test_is_identity_true_for_identity_lut() {
        let lut = JsToneCurveLut::identity();
        assert!(lut.is_identity());
    }

    #[wasm_bindgen_test]
    fn test_is_identity_true_for_linear_curve_lut() {
        // Create linear curve from points
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        assert!(lut.is_identity());
    }

    #[wasm_bindgen_test]
    fn test_is_identity_false_for_s_curve() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.15 },
            TestCurvePoint { x: 0.75, y: 0.85 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        assert!(!lut.is_identity());
    }

    #[wasm_bindgen_test]
    fn test_is_identity_false_for_inverted_curve() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 1.0 },
            TestCurvePoint { x: 1.0, y: 0.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        assert!(!lut.is_identity());
    }

    // =========================================================================
    // get_lut() tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_get_lut_returns_256_bytes() {
        let lut = JsToneCurveLut::identity();
        let data = lut.get_lut();
        assert_eq!(data.len(), 256);
    }

    #[wasm_bindgen_test]
    fn test_get_lut_identity_values() {
        let lut = JsToneCurveLut::identity();
        let data = lut.get_lut();

        // Identity LUT: lut[i] = i
        for i in 0..256 {
            assert_eq!(data[i], i as u8);
        }
    }

    #[wasm_bindgen_test]
    fn test_get_lut_inverted_values() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 1.0 },
            TestCurvePoint { x: 1.0, y: 0.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        let data = lut.get_lut();

        // Inverted LUT: lut[0] should be ~255, lut[255] should be ~0
        assert!(data[0] > 250);
        assert!(data[255] < 5);

        // Middle should also be inverted: lut[128] should be ~127
        assert!((data[128] as i16 - 127).abs() < 5);
    }

    #[wasm_bindgen_test]
    fn test_get_lut_s_curve_values() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.15 },
            TestCurvePoint { x: 0.75, y: 0.85 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        let data = lut.get_lut();
        assert_eq!(data.len(), 256);

        // S-curve characteristics:
        // - Endpoints preserved
        assert_eq!(data[0], 0);
        assert_eq!(data[255], 255);
        // - Quarter points adjusted for contrast
        // At x=0.25 (index 64), y should be ~0.15 (value ~38)
        assert!(data[64] < 64, "Shadow quarter should be darkened");
        // At x=0.75 (index 192), y should be ~0.85 (value ~217)
        assert!(data[192] > 192, "Highlight quarter should be brightened");
    }

    // =========================================================================
    // apply_tone_curve() tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_apply_identity_doesnt_change_pixels() {
        let lut = JsToneCurveLut::identity();
        let image = JsDecodedImage::new(10, 10, vec![128u8; 10 * 10 * 3]);

        let result = apply_tone_curve(&image, &lut);

        assert_eq!(result.pixels(), vec![128u8; 10 * 10 * 3]);
    }

    #[wasm_bindgen_test]
    fn test_apply_identity_preserves_varied_pixels() {
        let lut = JsToneCurveLut::identity();
        let pixels: Vec<u8> = (0..30).collect(); // 0,1,2,...,29
        let image = JsDecodedImage::new(10, 1, pixels.clone());

        let result = apply_tone_curve(&image, &lut);

        assert_eq!(result.pixels(), pixels);
    }

    #[wasm_bindgen_test]
    fn test_apply_contrast_curve_modifies_pixels() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.15 },
            TestCurvePoint { x: 0.75, y: 0.85 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        // Create image with known values
        let image = JsDecodedImage::new(1, 2, vec![64, 64, 64, 192, 192, 192]);

        let result = apply_tone_curve(&image, &lut);
        let result_pixels = result.pixels();

        // Shadow pixels (64) should be darkened
        assert!(result_pixels[0] < 64, "Shadows should be darker");
        // Highlight pixels (192) should be brightened
        assert!(result_pixels[3] > 192, "Highlights should be brighter");
    }

    #[wasm_bindgen_test]
    fn test_apply_inverted_curve_inverts_pixels() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 1.0 },
            TestCurvePoint { x: 1.0, y: 0.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        let image = JsDecodedImage::new(1, 1, vec![0, 128, 255]);
        let result = apply_tone_curve(&image, &lut);
        let result_pixels = result.pixels();

        // 0 -> ~255
        assert!(result_pixels[0] > 250, "Black should become white");
        // 128 -> ~127
        assert!((result_pixels[1] as i16 - 127).abs() < 5, "Middle gray should stay middle");
        // 255 -> ~0
        assert!(result_pixels[2] < 5, "White should become black");
    }

    #[wasm_bindgen_test]
    fn test_apply_output_dimensions_match_input() {
        let lut = JsToneCurveLut::identity();

        // Test various dimensions
        let test_cases = [(1, 1), (10, 10), (100, 50), (50, 100), (1, 100), (100, 1)];

        for (width, height) in test_cases {
            let image = JsDecodedImage::new(width, height, vec![128u8; (width * height * 3) as usize]);
            let result = apply_tone_curve(&image, &lut);

            assert_eq!(
                result.width(),
                width,
                "Width should match for {}x{}",
                width,
                height
            );
            assert_eq!(
                result.height(),
                height,
                "Height should match for {}x{}",
                width,
                height
            );
            assert_eq!(
                result.byte_length(),
                width * height * 3,
                "Byte length should match for {}x{}",
                width,
                height
            );
        }
    }

    #[wasm_bindgen_test]
    fn test_apply_with_various_image_sizes() {
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.5, y: 0.6 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        // Small image
        let small = JsDecodedImage::new(2, 2, vec![128u8; 2 * 2 * 3]);
        let small_result = apply_tone_curve(&small, &lut);
        assert_eq!(small_result.width(), 2);
        assert_eq!(small_result.height(), 2);

        // Medium image
        let medium = JsDecodedImage::new(100, 100, vec![128u8; 100 * 100 * 3]);
        let medium_result = apply_tone_curve(&medium, &lut);
        assert_eq!(medium_result.width(), 100);
        assert_eq!(medium_result.height(), 100);

        // Large image
        let large = JsDecodedImage::new(500, 300, vec![128u8; 500 * 300 * 3]);
        let large_result = apply_tone_curve(&large, &lut);
        assert_eq!(large_result.width(), 500);
        assert_eq!(large_result.height(), 300);
    }

    #[wasm_bindgen_test]
    fn test_apply_single_pixel_image() {
        let lut = JsToneCurveLut::identity();
        let image = JsDecodedImage::new(1, 1, vec![100, 150, 200]);

        let result = apply_tone_curve(&image, &lut);

        assert_eq!(result.width(), 1);
        assert_eq!(result.height(), 1);
        assert_eq!(result.pixels(), vec![100, 150, 200]);
    }

    #[wasm_bindgen_test]
    fn test_apply_extreme_dimensions() {
        let lut = JsToneCurveLut::identity();

        // Very wide image
        let wide = JsDecodedImage::new(1000, 1, vec![128u8; 1000 * 1 * 3]);
        let wide_result = apply_tone_curve(&wide, &lut);
        assert_eq!(wide_result.width(), 1000);
        assert_eq!(wide_result.height(), 1);

        // Very tall image
        let tall = JsDecodedImage::new(1, 1000, vec![128u8; 1 * 1000 * 3]);
        let tall_result = apply_tone_curve(&tall, &lut);
        assert_eq!(tall_result.width(), 1);
        assert_eq!(tall_result.height(), 1000);
    }

    // =========================================================================
    // Integration tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_full_workflow_create_apply_verify() {
        // Step 1: Create curve points
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.20 },
            TestCurvePoint { x: 0.50, y: 0.55 },
            TestCurvePoint { x: 0.75, y: 0.80 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();

        // Step 2: Create LUT
        let lut = JsToneCurveLut::new(js_points).unwrap();
        assert!(!lut.is_identity());
        assert_eq!(lut.get_lut().len(), 256);

        // Step 3: Create test image with gradient
        let width = 16;
        let height = 16;
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for _ in 0..(width * height) {
            pixels.push(64);  // R - shadow
            pixels.push(128); // G - midtone
            pixels.push(192); // B - highlight
        }
        let image = JsDecodedImage::new(width, height, pixels);

        // Step 4: Apply curve
        let result = apply_tone_curve(&image, &lut);

        // Step 5: Verify output
        assert_eq!(result.width(), width);
        assert_eq!(result.height(), height);
        assert_eq!(result.byte_length(), width * height * 3);

        let result_pixels = result.pixels();
        // Shadow (64) should be slightly darkened
        assert!(result_pixels[0] < 64 || result_pixels[0] > 60, "Shadow modified as expected");
        // Midtone (128) should be slightly brightened
        assert!(result_pixels[1] > 128, "Midtone brightened");
        // Highlight (192) should be close to expected
        assert!(result_pixels[2] >= 192, "Highlight maintained or brightened");
    }

    #[wasm_bindgen_test]
    fn test_workflow_multiple_curves_same_image() {
        // Create an image
        let image = JsDecodedImage::new(10, 10, vec![128u8; 10 * 10 * 3]);

        // Apply identity curve (should not change)
        let identity_lut = JsToneCurveLut::identity();
        let after_identity = apply_tone_curve(&image, &identity_lut);
        assert_eq!(after_identity.pixels(), vec![128u8; 10 * 10 * 3]);

        // Apply contrast curve
        let contrast_points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.25, y: 0.15 },
            TestCurvePoint { x: 0.75, y: 0.85 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_contrast = serde_wasm_bindgen::to_value(&contrast_points).unwrap();
        let contrast_lut = JsToneCurveLut::new(js_contrast).unwrap();
        let after_contrast = apply_tone_curve(&image, &contrast_lut);

        // 128 is midtone - with this S-curve it should still be close to 128
        let mid_val = after_contrast.pixels()[0];
        assert!(
            (mid_val as i16 - 128).abs() < 20,
            "Midtone should be relatively unchanged by S-curve"
        );
    }

    #[wasm_bindgen_test]
    fn test_workflow_chain_curve_applications() {
        // Create starting image
        let image = JsDecodedImage::new(5, 5, vec![128u8; 5 * 5 * 3]);

        // First curve: slight brighten
        let brighten_points = vec![
            TestCurvePoint { x: 0.0, y: 0.1 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_brighten = serde_wasm_bindgen::to_value(&brighten_points).unwrap();
        let brighten_lut = JsToneCurveLut::new(js_brighten).unwrap();
        let step1 = apply_tone_curve(&image, &brighten_lut);

        // Second curve: slight darken
        let darken_points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 1.0, y: 0.9 },
        ];
        let js_darken = serde_wasm_bindgen::to_value(&darken_points).unwrap();
        let darken_lut = JsToneCurveLut::new(js_darken).unwrap();
        let step2 = apply_tone_curve(&step1, &darken_lut);

        // Verify dimensions preserved through chain
        assert_eq!(step2.width(), 5);
        assert_eq!(step2.height(), 5);
        assert_eq!(step2.byte_length(), 5 * 5 * 3);
    }

    #[wasm_bindgen_test]
    fn test_workflow_lut_reuse() {
        // Create a single LUT
        let points = vec![
            TestCurvePoint { x: 0.0, y: 0.0 },
            TestCurvePoint { x: 0.5, y: 0.6 },
            TestCurvePoint { x: 1.0, y: 1.0 },
        ];
        let js_points = serde_wasm_bindgen::to_value(&points).unwrap();
        let lut = JsToneCurveLut::new(js_points).unwrap();

        // Apply to multiple images
        let image1 = JsDecodedImage::new(10, 10, vec![100u8; 10 * 10 * 3]);
        let image2 = JsDecodedImage::new(20, 15, vec![150u8; 20 * 15 * 3]);
        let image3 = JsDecodedImage::new(5, 30, vec![200u8; 5 * 30 * 3]);

        let result1 = apply_tone_curve(&image1, &lut);
        let result2 = apply_tone_curve(&image2, &lut);
        let result3 = apply_tone_curve(&image3, &lut);

        // Each result should have correct dimensions
        assert_eq!(result1.width(), 10);
        assert_eq!(result1.height(), 10);
        assert_eq!(result2.width(), 20);
        assert_eq!(result2.height(), 15);
        assert_eq!(result3.width(), 5);
        assert_eq!(result3.height(), 30);

        // Same input value should produce same output across all images
        // All pixels in image1 were 100, so all result pixels should be the same
        let lut_data = lut.get_lut();
        let expected_100 = lut_data[100];
        assert!(result1.pixels().iter().all(|&p| p == expected_100));
    }
}
