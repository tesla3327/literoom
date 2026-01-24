//! Mask WASM bindings.
//!
//! This module provides JavaScript bindings for local adjustment masks,
//! allowing linear gradient and radial gradient masks to be applied from TypeScript.

use crate::types::JsDecodedImage;
use literoom_core::mask::{LinearGradientMask, RadialGradientMask};
use literoom_core::BasicAdjustments;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// JavaScript-compatible mask stack data structure.
///
/// Contains arrays of linear and radial masks, each with their own adjustments.
/// This is passed from TypeScript as a JSON object via serde_wasm_bindgen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsMaskStack {
    /// Linear gradient masks
    pub linear_masks: Vec<JsLinearMask>,
    /// Radial gradient masks
    pub radial_masks: Vec<JsRadialMask>,
}

/// JavaScript-compatible linear gradient mask.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsLinearMask {
    /// Start point X coordinate (0.0 to 1.0)
    pub start_x: f32,
    /// Start point Y coordinate (0.0 to 1.0)
    pub start_y: f32,
    /// End point X coordinate (0.0 to 1.0)
    pub end_x: f32,
    /// End point Y coordinate (0.0 to 1.0)
    pub end_y: f32,
    /// Feather amount (0.0 = hard edge, 1.0 = full gradient)
    pub feather: f32,
    /// Whether the mask is enabled
    pub enabled: bool,
    /// Per-mask adjustments
    pub adjustments: JsAdjustments,
}

/// JavaScript-compatible radial gradient mask.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsRadialMask {
    /// Center X coordinate (0.0 to 1.0)
    pub center_x: f32,
    /// Center Y coordinate (0.0 to 1.0)
    pub center_y: f32,
    /// Horizontal radius (0.0 to 1.0)
    pub radius_x: f32,
    /// Vertical radius (0.0 to 1.0)
    pub radius_y: f32,
    /// Rotation angle in degrees
    pub rotation: f32,
    /// Feather amount (0.0 = hard edge, 1.0 = full gradient)
    pub feather: f32,
    /// Whether to invert the mask (apply effect outside ellipse)
    pub invert: bool,
    /// Whether the mask is enabled
    pub enabled: bool,
    /// Per-mask adjustments
    pub adjustments: JsAdjustments,
}

/// JavaScript-compatible adjustments for masks.
///
/// These are the same adjustment parameters as BasicAdjustments,
/// but with serde defaults so missing fields default to 0.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JsAdjustments {
    #[serde(default)]
    pub exposure: f32,
    #[serde(default)]
    pub contrast: f32,
    #[serde(default)]
    pub highlights: f32,
    #[serde(default)]
    pub shadows: f32,
    #[serde(default)]
    pub whites: f32,
    #[serde(default)]
    pub blacks: f32,
    #[serde(default)]
    pub temperature: f32,
    #[serde(default)]
    pub tint: f32,
    #[serde(default)]
    pub saturation: f32,
    #[serde(default)]
    pub vibrance: f32,
}

impl From<JsAdjustments> for BasicAdjustments {
    fn from(js: JsAdjustments) -> Self {
        BasicAdjustments {
            exposure: js.exposure,
            contrast: js.contrast,
            highlights: js.highlights,
            shadows: js.shadows,
            whites: js.whites,
            blacks: js.blacks,
            temperature: js.temperature,
            tint: js.tint,
            saturation: js.saturation,
            vibrance: js.vibrance,
        }
    }
}

/// Apply masked adjustments to an image.
///
/// Each mask in the stack applies its own set of adjustments, blended based on
/// the mask's strength at each pixel. Masks are processed sequentially.
///
/// # Arguments
/// * `image` - The source image to apply adjustments to
/// * `mask_data` - JavaScript object containing the mask stack (JsMaskStack structure)
///
/// # Returns
/// A new JsDecodedImage with the masked adjustments applied
///
/// # Example (TypeScript)
/// ```typescript
/// const maskStack = {
///   linear_masks: [{
///     start_x: 0.0, start_y: 0.5,
///     end_x: 1.0, end_y: 0.5,
///     feather: 0.5,
///     enabled: true,
///     adjustments: { exposure: 1.0 }
///   }],
///   radial_masks: []
/// };
///
/// const result = apply_masked_adjustments(sourceImage, maskStack);
/// ```
#[wasm_bindgen]
pub fn apply_masked_adjustments(
    image: &JsDecodedImage,
    mask_data: JsValue,
) -> Result<JsDecodedImage, JsValue> {
    // Parse the mask stack from JavaScript
    let masks: JsMaskStack = serde_wasm_bindgen::from_value(mask_data)
        .map_err(|e| JsValue::from_str(&format!("Invalid mask data: {}", e)))?;

    // Clone pixel data to avoid modifying original
    let mut pixels = image.pixels();

    // Convert and filter enabled linear masks
    let linear: Vec<_> = masks
        .linear_masks
        .into_iter()
        .filter(|m| m.enabled)
        .map(|m| {
            let mask = LinearGradientMask::new(m.start_x, m.start_y, m.end_x, m.end_y, m.feather);
            let adj: BasicAdjustments = m.adjustments.into();
            (mask, adj)
        })
        .collect();

    // Convert and filter enabled radial masks
    let radial: Vec<_> = masks
        .radial_masks
        .into_iter()
        .filter(|m| m.enabled)
        .map(|m| {
            let mask = RadialGradientMask::new(
                m.center_x,
                m.center_y,
                m.radius_x,
                m.radius_y,
                m.rotation.to_radians(), // Convert degrees to radians
                m.feather,
                m.invert,
            );
            let adj: BasicAdjustments = m.adjustments.into();
            (mask, adj)
        })
        .collect();

    // Apply the masked adjustments
    literoom_core::mask::apply_masked_adjustments(
        &mut pixels,
        image.width(),
        image.height(),
        &linear,
        &radial,
    );

    // Return new image with adjusted pixels
    Ok(JsDecodedImage::new(image.width(), image.height(), pixels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_adjustments_default() {
        let adj = JsAdjustments::default();
        assert_eq!(adj.exposure, 0.0);
        assert_eq!(adj.contrast, 0.0);
        assert_eq!(adj.saturation, 0.0);
    }

    #[test]
    fn test_js_adjustments_to_basic() {
        let js_adj = JsAdjustments {
            exposure: 1.0,
            contrast: 20.0,
            saturation: -10.0,
            ..Default::default()
        };

        let basic: BasicAdjustments = js_adj.into();
        assert_eq!(basic.exposure, 1.0);
        assert_eq!(basic.contrast, 20.0);
        assert_eq!(basic.saturation, -10.0);
        assert_eq!(basic.temperature, 0.0); // Default
    }

    #[test]
    fn test_js_mask_stack_creation() {
        // Test that mask structures can be created
        let mask_stack = JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 45.0,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments::default(),
            }],
        };

        assert_eq!(mask_stack.linear_masks.len(), 1);
        assert_eq!(mask_stack.radial_masks.len(), 1);
        assert_eq!(mask_stack.linear_masks[0].adjustments.exposure, 1.0);
        assert_eq!(mask_stack.radial_masks[0].rotation, 45.0);
    }

    #[test]
    fn test_linear_mask_conversion() {
        let js_mask = JsLinearMask {
            start_x: 0.1,
            start_y: 0.2,
            end_x: 0.8,
            end_y: 0.9,
            feather: 0.5,
            enabled: true,
            adjustments: JsAdjustments {
                exposure: 0.5,
                ..Default::default()
            },
        };

        // Convert to core mask
        let core_mask = LinearGradientMask::new(
            js_mask.start_x,
            js_mask.start_y,
            js_mask.end_x,
            js_mask.end_y,
            js_mask.feather,
        );

        assert_eq!(core_mask.start_x, 0.1);
        assert_eq!(core_mask.start_y, 0.2);
        assert_eq!(core_mask.end_x, 0.8);
        assert_eq!(core_mask.end_y, 0.9);
        assert_eq!(core_mask.feather, 0.5);
    }

    #[test]
    fn test_radial_mask_conversion_degrees_to_radians() {
        let js_mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 90.0, // Degrees
            feather: 0.5,
            invert: true,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        // Convert to core mask (rotation should be converted to radians)
        let core_mask = RadialGradientMask::new(
            js_mask.center_x,
            js_mask.center_y,
            js_mask.radius_x,
            js_mask.radius_y,
            js_mask.rotation.to_radians(), // Convert degrees to radians
            js_mask.feather,
            js_mask.invert,
        );

        assert_eq!(core_mask.center_x, 0.5);
        assert_eq!(core_mask.radius_x, 0.3);
        assert!((core_mask.rotation - std::f32::consts::FRAC_PI_2).abs() < 0.001);
        assert!(core_mask.invert);
    }

    // Note: Tests that call apply_masked_adjustments require the wasm target
    // because they use serde_wasm_bindgen. The core functionality is tested
    // in literoom-core::mask::tests.

    // =====================================================================
    // JsAdjustments Tests
    // =====================================================================

    #[test]
    fn test_js_adjustments_all_fields_default() {
        let adj = JsAdjustments::default();
        assert_eq!(adj.exposure, 0.0);
        assert_eq!(adj.contrast, 0.0);
        assert_eq!(adj.highlights, 0.0);
        assert_eq!(adj.shadows, 0.0);
        assert_eq!(adj.whites, 0.0);
        assert_eq!(adj.blacks, 0.0);
        assert_eq!(adj.temperature, 0.0);
        assert_eq!(adj.tint, 0.0);
        assert_eq!(adj.vibrance, 0.0);
        assert_eq!(adj.saturation, 0.0);
    }

    #[test]
    fn test_js_adjustments_to_basic_all_fields_set() {
        let js_adj = JsAdjustments {
            exposure: 1.5,
            contrast: 25.0,
            highlights: -30.0,
            shadows: 40.0,
            whites: 15.0,
            blacks: -20.0,
            temperature: 5000.0,
            tint: 10.0,
            vibrance: 35.0,
            saturation: -15.0,
        };

        let basic: BasicAdjustments = js_adj.into();
        assert_eq!(basic.exposure, 1.5);
        assert_eq!(basic.contrast, 25.0);
        assert_eq!(basic.highlights, -30.0);
        assert_eq!(basic.shadows, 40.0);
        assert_eq!(basic.whites, 15.0);
        assert_eq!(basic.blacks, -20.0);
        assert_eq!(basic.temperature, 5000.0);
        assert_eq!(basic.tint, 10.0);
        assert_eq!(basic.vibrance, 35.0);
        assert_eq!(basic.saturation, -15.0);
    }

    #[test]
    fn test_js_adjustments_partial_fields_defaults_propagate() {
        // Only set some fields, others should remain at default (0.0)
        let js_adj = JsAdjustments {
            exposure: 2.0,
            highlights: 50.0,
            vibrance: 25.0,
            ..Default::default()
        };

        let basic: BasicAdjustments = js_adj.into();
        assert_eq!(basic.exposure, 2.0);
        assert_eq!(basic.highlights, 50.0);
        assert_eq!(basic.vibrance, 25.0);
        // These should be default (0.0)
        assert_eq!(basic.contrast, 0.0);
        assert_eq!(basic.shadows, 0.0);
        assert_eq!(basic.whites, 0.0);
        assert_eq!(basic.blacks, 0.0);
        assert_eq!(basic.temperature, 0.0);
        assert_eq!(basic.tint, 0.0);
        assert_eq!(basic.saturation, 0.0);
    }

    #[test]
    fn test_js_adjustments_negative_values() {
        let js_adj = JsAdjustments {
            exposure: -3.0,
            contrast: -50.0,
            highlights: -100.0,
            shadows: -100.0,
            whites: -100.0,
            blacks: -100.0,
            temperature: -50.0,
            tint: -50.0,
            vibrance: -100.0,
            saturation: -100.0,
        };

        let basic: BasicAdjustments = js_adj.into();
        assert_eq!(basic.exposure, -3.0);
        assert_eq!(basic.contrast, -50.0);
        assert_eq!(basic.highlights, -100.0);
        assert_eq!(basic.shadows, -100.0);
        assert_eq!(basic.whites, -100.0);
        assert_eq!(basic.blacks, -100.0);
        assert_eq!(basic.temperature, -50.0);
        assert_eq!(basic.tint, -50.0);
        assert_eq!(basic.vibrance, -100.0);
        assert_eq!(basic.saturation, -100.0);
    }

    // =====================================================================
    // JsLinearMask Structure Tests
    // =====================================================================

    #[test]
    fn test_linear_mask_boundary_values_zero() {
        let mask = JsLinearMask {
            start_x: 0.0,
            start_y: 0.0,
            end_x: 0.0,
            end_y: 0.0,
            feather: 0.0,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.start_x, 0.0);
        assert_eq!(mask.start_y, 0.0);
        assert_eq!(mask.end_x, 0.0);
        assert_eq!(mask.end_y, 0.0);
        assert_eq!(mask.feather, 0.0);
    }

    #[test]
    fn test_linear_mask_boundary_values_one() {
        let mask = JsLinearMask {
            start_x: 1.0,
            start_y: 1.0,
            end_x: 1.0,
            end_y: 1.0,
            feather: 1.0,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.start_x, 1.0);
        assert_eq!(mask.start_y, 1.0);
        assert_eq!(mask.end_x, 1.0);
        assert_eq!(mask.end_y, 1.0);
        assert_eq!(mask.feather, 1.0);
    }

    #[test]
    fn test_linear_mask_feather_values() {
        // Test various feather values
        let feather_values = [0.0, 0.25, 0.5, 0.75, 1.0];

        for feather in feather_values {
            let mask = JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather,
                enabled: true,
                adjustments: JsAdjustments::default(),
            };

            assert_eq!(mask.feather, feather);

            // Convert to core and verify
            let core_mask = LinearGradientMask::new(
                mask.start_x,
                mask.start_y,
                mask.end_x,
                mask.end_y,
                mask.feather,
            );
            // Core clamps feather to 0.0-1.0
            assert!((core_mask.feather - feather).abs() < f32::EPSILON);
        }
    }

    #[test]
    fn test_linear_mask_enabled_flag_true() {
        let mask = JsLinearMask {
            start_x: 0.0,
            start_y: 0.0,
            end_x: 1.0,
            end_y: 1.0,
            feather: 0.5,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(mask.enabled);
    }

    #[test]
    fn test_linear_mask_enabled_flag_false() {
        let mask = JsLinearMask {
            start_x: 0.0,
            start_y: 0.0,
            end_x: 1.0,
            end_y: 1.0,
            feather: 0.5,
            enabled: false,
            adjustments: JsAdjustments::default(),
        };

        assert!(!mask.enabled);
    }

    #[test]
    fn test_linear_mask_with_all_adjustments() {
        let mask = JsLinearMask {
            start_x: 0.2,
            start_y: 0.3,
            end_x: 0.8,
            end_y: 0.7,
            feather: 0.6,
            enabled: true,
            adjustments: JsAdjustments {
                exposure: 1.0,
                contrast: 10.0,
                highlights: -20.0,
                shadows: 30.0,
                whites: 5.0,
                blacks: -5.0,
                temperature: 15.0,
                tint: -10.0,
                vibrance: 25.0,
                saturation: -15.0,
            },
        };

        assert_eq!(mask.adjustments.exposure, 1.0);
        assert_eq!(mask.adjustments.contrast, 10.0);
        assert_eq!(mask.adjustments.highlights, -20.0);
        assert_eq!(mask.adjustments.shadows, 30.0);
        assert_eq!(mask.adjustments.whites, 5.0);
        assert_eq!(mask.adjustments.blacks, -5.0);
        assert_eq!(mask.adjustments.temperature, 15.0);
        assert_eq!(mask.adjustments.tint, -10.0);
        assert_eq!(mask.adjustments.vibrance, 25.0);
        assert_eq!(mask.adjustments.saturation, -15.0);
    }

    // =====================================================================
    // JsRadialMask Structure Tests
    // =====================================================================

    #[test]
    fn test_radial_mask_rotation_0_degrees() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.rotation, 0.0);

        // Verify conversion to radians
        let radians = mask.rotation.to_radians();
        assert!((radians - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_radial_mask_rotation_45_degrees() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 45.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.rotation, 45.0);

        // Verify conversion to radians (45 degrees = PI/4)
        let radians = mask.rotation.to_radians();
        assert!((radians - std::f32::consts::FRAC_PI_4).abs() < 0.001);
    }

    #[test]
    fn test_radial_mask_rotation_90_degrees() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 90.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.rotation, 90.0);

        // Verify conversion to radians (90 degrees = PI/2)
        let radians = mask.rotation.to_radians();
        assert!((radians - std::f32::consts::FRAC_PI_2).abs() < 0.001);
    }

    #[test]
    fn test_radial_mask_rotation_180_degrees() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 180.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.rotation, 180.0);

        // Verify conversion to radians (180 degrees = PI)
        let radians = mask.rotation.to_radians();
        assert!((radians - std::f32::consts::PI).abs() < 0.001);
    }

    #[test]
    fn test_radial_mask_rotation_360_degrees() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 360.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.rotation, 360.0);

        // Verify conversion to radians (360 degrees = 2*PI)
        let radians = mask.rotation.to_radians();
        assert!((radians - 2.0 * std::f32::consts::PI).abs() < 0.001);
    }

    #[test]
    fn test_radial_mask_invert_true() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.5,
            invert: true,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(mask.invert);
    }

    #[test]
    fn test_radial_mask_invert_false() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(!mask.invert);
    }

    #[test]
    fn test_radial_mask_symmetric_radii() {
        // Circular mask (equal radii)
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.25,
            radius_y: 0.25,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert_eq!(mask.radius_x, mask.radius_y);
        assert_eq!(mask.radius_x, 0.25);
    }

    #[test]
    fn test_radial_mask_asymmetric_radii_horizontal() {
        // Wide ellipse (larger horizontal radius)
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.4,
            radius_y: 0.2,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(mask.radius_x > mask.radius_y);
        assert_eq!(mask.radius_x, 0.4);
        assert_eq!(mask.radius_y, 0.2);
    }

    #[test]
    fn test_radial_mask_asymmetric_radii_vertical() {
        // Tall ellipse (larger vertical radius)
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.15,
            radius_y: 0.35,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(mask.radius_y > mask.radius_x);
        assert_eq!(mask.radius_x, 0.15);
        assert_eq!(mask.radius_y, 0.35);
    }

    #[test]
    fn test_radial_mask_enabled_flag_true() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        assert!(mask.enabled);
    }

    #[test]
    fn test_radial_mask_enabled_flag_false() {
        let mask = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
            enabled: false,
            adjustments: JsAdjustments::default(),
        };

        assert!(!mask.enabled);
    }

    #[test]
    fn test_radial_mask_degrees_to_radians_conversion() {
        let test_cases = [
            (0.0, 0.0),
            (30.0, std::f32::consts::FRAC_PI_6),
            (45.0, std::f32::consts::FRAC_PI_4),
            (60.0, std::f32::consts::FRAC_PI_3),
            (90.0, std::f32::consts::FRAC_PI_2),
            (180.0, std::f32::consts::PI),
            (270.0, 3.0 * std::f32::consts::FRAC_PI_2),
            (360.0, 2.0 * std::f32::consts::PI),
        ];

        for (degrees, expected_radians) in test_cases {
            let mask = JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.2,
                rotation: degrees,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments::default(),
            };

            let radians = mask.rotation.to_radians();
            assert!(
                (radians - expected_radians).abs() < 0.001,
                "Failed for {} degrees: expected {}, got {}",
                degrees,
                expected_radians,
                radians
            );
        }
    }

    // =====================================================================
    // JsMaskStack Tests
    // =====================================================================

    #[test]
    fn test_mask_stack_only_linear_masks() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 0.0,
                    end_x: 1.0,
                    end_y: 0.0,
                    feather: 0.5,
                    enabled: true,
                    adjustments: JsAdjustments {
                        exposure: 0.5,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 1.0,
                    end_x: 1.0,
                    end_y: 1.0,
                    feather: 0.3,
                    enabled: true,
                    adjustments: JsAdjustments {
                        contrast: 20.0,
                        ..Default::default()
                    },
                },
            ],
            radial_masks: vec![],
        };

        assert_eq!(mask_stack.linear_masks.len(), 2);
        assert_eq!(mask_stack.radial_masks.len(), 0);
        assert_eq!(mask_stack.linear_masks[0].adjustments.exposure, 0.5);
        assert_eq!(mask_stack.linear_masks[1].adjustments.contrast, 20.0);
    }

    #[test]
    fn test_mask_stack_only_radial_masks() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![
                JsRadialMask {
                    center_x: 0.25,
                    center_y: 0.25,
                    radius_x: 0.2,
                    radius_y: 0.2,
                    rotation: 0.0,
                    feather: 0.5,
                    invert: false,
                    enabled: true,
                    adjustments: JsAdjustments {
                        shadows: 30.0,
                        ..Default::default()
                    },
                },
                JsRadialMask {
                    center_x: 0.75,
                    center_y: 0.75,
                    radius_x: 0.15,
                    radius_y: 0.15,
                    rotation: 45.0,
                    feather: 0.8,
                    invert: true,
                    enabled: true,
                    adjustments: JsAdjustments {
                        highlights: -25.0,
                        ..Default::default()
                    },
                },
            ],
        };

        assert_eq!(mask_stack.linear_masks.len(), 0);
        assert_eq!(mask_stack.radial_masks.len(), 2);
        assert_eq!(mask_stack.radial_masks[0].adjustments.shadows, 30.0);
        assert_eq!(mask_stack.radial_masks[1].adjustments.highlights, -25.0);
    }

    #[test]
    fn test_mask_stack_both_types() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 0.0,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    vibrance: 50.0,
                    ..Default::default()
                },
            }],
        };

        assert_eq!(mask_stack.linear_masks.len(), 1);
        assert_eq!(mask_stack.radial_masks.len(), 1);
        assert_eq!(mask_stack.linear_masks[0].adjustments.exposure, 1.0);
        assert_eq!(mask_stack.radial_masks[0].adjustments.vibrance, 50.0);
    }

    #[test]
    fn test_mask_stack_empty() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![],
        };

        assert_eq!(mask_stack.linear_masks.len(), 0);
        assert_eq!(mask_stack.radial_masks.len(), 0);
    }

    #[test]
    fn test_mask_stack_multiple_masks_each_type() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 0.0,
                    end_x: 0.5,
                    end_y: 0.5,
                    feather: 0.3,
                    enabled: true,
                    adjustments: JsAdjustments {
                        exposure: 0.5,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 0.5,
                    start_y: 0.0,
                    end_x: 1.0,
                    end_y: 0.5,
                    feather: 0.6,
                    enabled: false,
                    adjustments: JsAdjustments {
                        exposure: -0.5,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 1.0,
                    end_x: 1.0,
                    end_y: 0.0,
                    feather: 1.0,
                    enabled: true,
                    adjustments: JsAdjustments {
                        contrast: 15.0,
                        ..Default::default()
                    },
                },
            ],
            radial_masks: vec![
                JsRadialMask {
                    center_x: 0.25,
                    center_y: 0.25,
                    radius_x: 0.1,
                    radius_y: 0.1,
                    rotation: 0.0,
                    feather: 0.5,
                    invert: false,
                    enabled: true,
                    adjustments: JsAdjustments::default(),
                },
                JsRadialMask {
                    center_x: 0.75,
                    center_y: 0.25,
                    radius_x: 0.15,
                    radius_y: 0.1,
                    rotation: 30.0,
                    feather: 0.3,
                    invert: true,
                    enabled: true,
                    adjustments: JsAdjustments::default(),
                },
                JsRadialMask {
                    center_x: 0.5,
                    center_y: 0.75,
                    radius_x: 0.2,
                    radius_y: 0.25,
                    rotation: 90.0,
                    feather: 0.8,
                    invert: false,
                    enabled: false,
                    adjustments: JsAdjustments::default(),
                },
            ],
        };

        assert_eq!(mask_stack.linear_masks.len(), 3);
        assert_eq!(mask_stack.radial_masks.len(), 3);

        // Verify enabled flags
        assert!(mask_stack.linear_masks[0].enabled);
        assert!(!mask_stack.linear_masks[1].enabled);
        assert!(mask_stack.linear_masks[2].enabled);
        assert!(mask_stack.radial_masks[0].enabled);
        assert!(mask_stack.radial_masks[1].enabled);
        assert!(!mask_stack.radial_masks[2].enabled);
    }

    // =====================================================================
    // Integration Tests (JS to Core Conversion)
    // =====================================================================

    #[test]
    fn test_linear_mask_js_to_core_conversion() {
        let js_mask = JsLinearMask {
            start_x: 0.1,
            start_y: 0.2,
            end_x: 0.9,
            end_y: 0.8,
            feather: 0.7,
            enabled: true,
            adjustments: JsAdjustments {
                exposure: 1.5,
                contrast: 25.0,
                highlights: -30.0,
                shadows: 40.0,
                whites: 15.0,
                blacks: -20.0,
                temperature: 10.0,
                tint: -5.0,
                vibrance: 35.0,
                saturation: -10.0,
            },
        };

        // Convert to core mask
        let core_mask = LinearGradientMask::new(
            js_mask.start_x,
            js_mask.start_y,
            js_mask.end_x,
            js_mask.end_y,
            js_mask.feather,
        );

        // Verify conversion
        assert_eq!(core_mask.start_x, 0.1);
        assert_eq!(core_mask.start_y, 0.2);
        assert_eq!(core_mask.end_x, 0.9);
        assert_eq!(core_mask.end_y, 0.8);
        assert_eq!(core_mask.feather, 0.7);

        // Convert adjustments
        let core_adj: BasicAdjustments = js_mask.adjustments.into();
        assert_eq!(core_adj.exposure, 1.5);
        assert_eq!(core_adj.contrast, 25.0);
        assert_eq!(core_adj.highlights, -30.0);
        assert_eq!(core_adj.shadows, 40.0);
        assert_eq!(core_adj.whites, 15.0);
        assert_eq!(core_adj.blacks, -20.0);
        assert_eq!(core_adj.temperature, 10.0);
        assert_eq!(core_adj.tint, -5.0);
        assert_eq!(core_adj.vibrance, 35.0);
        assert_eq!(core_adj.saturation, -10.0);
    }

    #[test]
    fn test_radial_mask_js_to_core_conversion() {
        let js_mask = JsRadialMask {
            center_x: 0.4,
            center_y: 0.6,
            radius_x: 0.25,
            radius_y: 0.35,
            rotation: 45.0, // Degrees
            feather: 0.6,
            invert: true,
            enabled: true,
            adjustments: JsAdjustments {
                exposure: -1.0,
                saturation: 20.0,
                ..Default::default()
            },
        };

        // Convert to core mask (including degree to radian conversion)
        let core_mask = RadialGradientMask::new(
            js_mask.center_x,
            js_mask.center_y,
            js_mask.radius_x,
            js_mask.radius_y,
            js_mask.rotation.to_radians(),
            js_mask.feather,
            js_mask.invert,
        );

        // Verify conversion
        assert_eq!(core_mask.center_x, 0.4);
        assert_eq!(core_mask.center_y, 0.6);
        assert_eq!(core_mask.radius_x, 0.25);
        assert_eq!(core_mask.radius_y, 0.35);
        assert!((core_mask.rotation - std::f32::consts::FRAC_PI_4).abs() < 0.001);
        assert_eq!(core_mask.feather, 0.6);
        assert!(core_mask.invert);

        // Convert adjustments
        let core_adj: BasicAdjustments = js_mask.adjustments.into();
        assert_eq!(core_adj.exposure, -1.0);
        assert_eq!(core_adj.saturation, 20.0);
        assert_eq!(core_adj.contrast, 0.0); // Default
    }

    #[test]
    fn test_mask_stack_full_conversion() {
        let mask_stack = JsMaskStack {
            linear_masks: vec![
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 0.5,
                    end_x: 1.0,
                    end_y: 0.5,
                    feather: 0.5,
                    enabled: true,
                    adjustments: JsAdjustments {
                        exposure: 1.0,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 0.5,
                    start_y: 0.0,
                    end_x: 0.5,
                    end_y: 1.0,
                    feather: 0.8,
                    enabled: false, // Disabled
                    adjustments: JsAdjustments {
                        contrast: 30.0,
                        ..Default::default()
                    },
                },
            ],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 90.0,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    vibrance: 40.0,
                    ..Default::default()
                },
            }],
        };

        // Convert and filter enabled linear masks (simulating what apply_masked_adjustments does)
        let linear: Vec<_> = mask_stack
            .linear_masks
            .into_iter()
            .filter(|m| m.enabled)
            .map(|m| {
                let mask = LinearGradientMask::new(m.start_x, m.start_y, m.end_x, m.end_y, m.feather);
                let adj: BasicAdjustments = m.adjustments.into();
                (mask, adj)
            })
            .collect();

        // Convert and filter enabled radial masks
        let radial: Vec<_> = mask_stack
            .radial_masks
            .into_iter()
            .filter(|m| m.enabled)
            .map(|m| {
                let mask = RadialGradientMask::new(
                    m.center_x,
                    m.center_y,
                    m.radius_x,
                    m.radius_y,
                    m.rotation.to_radians(),
                    m.feather,
                    m.invert,
                );
                let adj: BasicAdjustments = m.adjustments.into();
                (mask, adj)
            })
            .collect();

        // Only one linear mask should pass (the enabled one)
        assert_eq!(linear.len(), 1);
        assert_eq!(linear[0].0.start_x, 0.0);
        assert_eq!(linear[0].1.exposure, 1.0);

        // One radial mask should pass
        assert_eq!(radial.len(), 1);
        assert_eq!(radial[0].0.center_x, 0.5);
        assert!((radial[0].0.rotation - std::f32::consts::FRAC_PI_2).abs() < 0.001);
        assert_eq!(radial[0].1.vibrance, 40.0);
    }

    #[test]
    fn test_mask_clone_and_reuse() {
        let original = JsLinearMask {
            start_x: 0.2,
            start_y: 0.3,
            end_x: 0.8,
            end_y: 0.7,
            feather: 0.5,
            enabled: true,
            adjustments: JsAdjustments {
                exposure: 1.5,
                contrast: 20.0,
                ..Default::default()
            },
        };

        // Clone the mask
        let cloned = original.clone();

        // Verify they are equal
        assert_eq!(original.start_x, cloned.start_x);
        assert_eq!(original.start_y, cloned.start_y);
        assert_eq!(original.end_x, cloned.end_x);
        assert_eq!(original.end_y, cloned.end_y);
        assert_eq!(original.feather, cloned.feather);
        assert_eq!(original.enabled, cloned.enabled);
        assert_eq!(original.adjustments.exposure, cloned.adjustments.exposure);
        assert_eq!(original.adjustments.contrast, cloned.adjustments.contrast);

        // Convert both to core masks
        let core_original = LinearGradientMask::new(
            original.start_x,
            original.start_y,
            original.end_x,
            original.end_y,
            original.feather,
        );
        let core_cloned = LinearGradientMask::new(
            cloned.start_x,
            cloned.start_y,
            cloned.end_x,
            cloned.end_y,
            cloned.feather,
        );

        // Both should produce the same evaluation
        let test_point = (0.5, 0.5);
        assert_eq!(
            core_original.evaluate(test_point.0, test_point.1),
            core_cloned.evaluate(test_point.0, test_point.1)
        );
    }

    #[test]
    fn test_radial_mask_clone_and_reuse() {
        let original = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.2,
            rotation: 60.0,
            feather: 0.5,
            invert: true,
            enabled: true,
            adjustments: JsAdjustments {
                shadows: 25.0,
                highlights: -15.0,
                ..Default::default()
            },
        };

        // Clone the mask
        let cloned = original.clone();

        // Verify they are equal
        assert_eq!(original.center_x, cloned.center_x);
        assert_eq!(original.center_y, cloned.center_y);
        assert_eq!(original.radius_x, cloned.radius_x);
        assert_eq!(original.radius_y, cloned.radius_y);
        assert_eq!(original.rotation, cloned.rotation);
        assert_eq!(original.feather, cloned.feather);
        assert_eq!(original.invert, cloned.invert);
        assert_eq!(original.enabled, cloned.enabled);
        assert_eq!(original.adjustments.shadows, cloned.adjustments.shadows);
        assert_eq!(original.adjustments.highlights, cloned.adjustments.highlights);

        // Convert both to core masks
        let core_original = RadialGradientMask::new(
            original.center_x,
            original.center_y,
            original.radius_x,
            original.radius_y,
            original.rotation.to_radians(),
            original.feather,
            original.invert,
        );
        let core_cloned = RadialGradientMask::new(
            cloned.center_x,
            cloned.center_y,
            cloned.radius_x,
            cloned.radius_y,
            cloned.rotation.to_radians(),
            cloned.feather,
            cloned.invert,
        );

        // Both should produce the same evaluation
        let test_points = [(0.5, 0.5), (0.3, 0.3), (0.7, 0.6)];
        for (x, y) in test_points {
            assert_eq!(
                core_original.evaluate(x, y),
                core_cloned.evaluate(x, y),
                "Evaluation mismatch at ({}, {})",
                x,
                y
            );
        }
    }

    #[test]
    fn test_mask_stack_clone() {
        let original = JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 45.0,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments::default(),
            }],
        };

        let cloned = original.clone();

        assert_eq!(original.linear_masks.len(), cloned.linear_masks.len());
        assert_eq!(original.radial_masks.len(), cloned.radial_masks.len());
        assert_eq!(
            original.linear_masks[0].adjustments.exposure,
            cloned.linear_masks[0].adjustments.exposure
        );
        assert_eq!(original.radial_masks[0].rotation, cloned.radial_masks[0].rotation);
    }

    #[test]
    fn test_core_mask_evaluation_after_conversion() {
        // Create a JS linear mask and convert it
        let js_linear = JsLinearMask {
            start_x: 0.0,
            start_y: 0.5,
            end_x: 1.0,
            end_y: 0.5,
            feather: 1.0,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        let core_linear = LinearGradientMask::new(
            js_linear.start_x,
            js_linear.start_y,
            js_linear.end_x,
            js_linear.end_y,
            js_linear.feather,
        );

        // Test evaluation at key points
        let val_start = core_linear.evaluate(0.0, 0.5);
        let val_center = core_linear.evaluate(0.5, 0.5);
        let val_end = core_linear.evaluate(1.0, 0.5);

        assert!(val_start > 0.99, "Start should be ~1.0");
        assert!((val_center - 0.5).abs() < 0.01, "Center should be ~0.5");
        assert!(val_end < 0.01, "End should be ~0.0");
    }

    #[test]
    fn test_core_radial_mask_evaluation_after_conversion() {
        // Create a JS radial mask and convert it
        let js_radial = JsRadialMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 1.0,
            invert: false,
            enabled: true,
            adjustments: JsAdjustments::default(),
        };

        let core_radial = RadialGradientMask::new(
            js_radial.center_x,
            js_radial.center_y,
            js_radial.radius_x,
            js_radial.radius_y,
            js_radial.rotation.to_radians(),
            js_radial.feather,
            js_radial.invert,
        );

        // Test evaluation at key points
        let val_center = core_radial.evaluate(0.5, 0.5);
        let val_edge = core_radial.evaluate(0.5 + 0.3, 0.5);
        let val_outside = core_radial.evaluate(0.0, 0.0);

        assert!(val_center > 0.99, "Center should be ~1.0");
        assert!(val_edge < 0.01, "Edge should be ~0.0");
        assert!(val_outside < 0.01, "Outside should be ~0.0");
    }
}

/// WASM-specific tests that require JsValue and serde_wasm_bindgen.
///
/// These tests use the `apply_masked_adjustments` function that takes JsValue
/// mask data and can only run on wasm32 targets. Use `wasm-pack test` to run these.
#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use literoom_core::decode::DecodedImage;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    // =========================================================================
    // Helper functions
    // =========================================================================

    /// Create a test image with uniform gray pixels.
    fn create_gray_image(width: u32, height: u32, value: u8) -> JsDecodedImage {
        JsDecodedImage::from_decoded(DecodedImage {
            width,
            height,
            pixels: vec![value; (width * height * 3) as usize],
        })
    }

    /// Create a test image with specified RGB values for each pixel.
    fn create_colored_image(width: u32, height: u32, r: u8, g: u8, b: u8) -> JsDecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for _ in 0..(width * height) {
            pixels.push(r);
            pixels.push(g);
            pixels.push(b);
        }
        JsDecodedImage::from_decoded(DecodedImage {
            width,
            height,
            pixels,
        })
    }

    /// Get pixel at coordinates from pixel array.
    fn get_pixel(pixels: &[u8], width: u32, x: u32, y: u32) -> (u8, u8, u8) {
        let idx = ((y * width + x) * 3) as usize;
        (pixels[idx], pixels[idx + 1], pixels[idx + 2])
    }

    // =========================================================================
    // Basic functionality tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_empty_masks() {
        let image = create_gray_image(10, 10, 128);
        let original_pixels = image.pixels();

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 10);
        assert_eq!(output.height(), 10);
        assert_eq!(output.pixels(), original_pixels, "Empty masks should not modify image");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_single_linear_mask_exposure() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.0, // Hard edge for predictable testing
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0, // +1 stop (doubles brightness)
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Left side should be brighter (mask = 1.0)
        let left = get_pixel(&pixels, 20, 0, 10);
        assert!(
            left.0 > 150,
            "Left side should be significantly brighter, got {}",
            left.0
        );

        // Right side should be unchanged (mask = 0.0)
        let right = get_pixel(&pixels, 20, 19, 10);
        assert_eq!(right, (100, 100, 100), "Right side should be unchanged");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_single_radial_mask_exposure() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 0.0,
                feather: 0.0, // Hard edge
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Center should be brighter (inside radial mask)
        let center = get_pixel(&pixels, 20, 10, 10);
        assert!(
            center.0 > 150,
            "Center should be bright, got {}",
            center.0
        );

        // Corner should be unchanged (outside radial mask)
        let corner = get_pixel(&pixels, 20, 0, 0);
        assert_eq!(corner, (100, 100, 100), "Corner should be unchanged");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_multiple_masks() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 0.5,
                    ..Default::default()
                },
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.4,
                radius_y: 0.4,
                rotation: 0.0,
                feather: 0.5,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    contrast: 30.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 20);
        assert_eq!(output.height(), 20);

        // Center should be affected by both masks
        let pixels = output.pixels();
        let center = get_pixel(&pixels, 20, 10, 10);
        assert_ne!(
            center,
            (100, 100, 100),
            "Center should be modified by multiple masks"
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_disabled_masks() {
        let image = create_gray_image(10, 10, 128);
        let original_pixels = image.pixels();

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.0,
                enabled: false, // Disabled
                adjustments: JsAdjustments {
                    exposure: 2.0, // Would make a big change if enabled
                    ..Default::default()
                },
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.5,
                radius_y: 0.5,
                rotation: 0.0,
                feather: 0.0,
                invert: false,
                enabled: false, // Disabled
                adjustments: JsAdjustments {
                    exposure: 2.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(
            output.pixels(),
            original_pixels,
            "Disabled masks should not modify image"
        );
    }

    // =========================================================================
    // Error handling tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_invalid_mask_data() {
        let image = create_gray_image(10, 10, 128);

        // Pass invalid JsValue (a string instead of mask object)
        let invalid_data = JsValue::from_str("not a valid mask object");

        let result = apply_masked_adjustments(&image, invalid_data);
        assert!(result.is_err(), "Should return error for invalid mask data");

        // Check error message contains useful info
        let err = result.unwrap_err();
        let err_str = err.as_string().unwrap_or_default();
        assert!(
            err_str.contains("Invalid mask data"),
            "Error should mention invalid mask data, got: {}",
            err_str
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_missing_required_fields() {
        let image = create_gray_image(10, 10, 128);

        // Create a JS object missing required fields
        let partial_mask = js_sys::Object::new();
        // Only set linear_masks, missing radial_masks
        let linear_array = js_sys::Array::new();
        js_sys::Reflect::set(&partial_mask, &"linear_masks".into(), &linear_array).unwrap();

        let result = apply_masked_adjustments(&image, partial_mask.into());
        assert!(
            result.is_err(),
            "Should return error when required fields are missing"
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_null_mask_data() {
        let image = create_gray_image(10, 10, 128);

        let result = apply_masked_adjustments(&image, JsValue::NULL);
        assert!(result.is_err(), "Should return error for null mask data");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_undefined_mask_data() {
        let image = create_gray_image(10, 10, 128);

        let result = apply_masked_adjustments(&image, JsValue::UNDEFINED);
        assert!(
            result.is_err(),
            "Should return error for undefined mask data"
        );
    }

    // =========================================================================
    // Edge case tests
    // =========================================================================

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_inverted_radial_mask() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 0.0,
                feather: 0.0,
                invert: true, // Inverted - affects OUTSIDE the ellipse
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Center should be UNCHANGED (inside inverted mask = 0.0)
        let center = get_pixel(&pixels, 20, 10, 10);
        assert_eq!(
            center,
            (100, 100, 100),
            "Center should be unchanged with inverted mask"
        );

        // Corner should be BRIGHTER (outside inverted mask = 1.0)
        let corner = get_pixel(&pixels, 20, 0, 0);
        assert!(
            corner.0 > 150,
            "Corner should be bright with inverted mask, got {}",
            corner.0
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_feathered_linear_mask() {
        let image = create_gray_image(100, 1, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 1.0, // Full feather for smooth gradient
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Check for smooth transition across the image
        let left = pixels[0];
        let center = pixels[50 * 3];
        let right = pixels[99 * 3];

        assert!(
            left > center,
            "Left ({}) should be brighter than center ({})",
            left,
            center
        );
        assert!(
            center > right,
            "Center ({}) should be brighter than right ({})",
            center,
            right
        );

        // Verify transition is gradual (no sudden jumps)
        let mut max_jump = 0i32;
        for i in 1..100 {
            let prev = pixels[(i - 1) * 3] as i32;
            let curr = pixels[i * 3] as i32;
            let jump = (curr - prev).abs();
            max_jump = max_jump.max(jump);
        }
        assert!(
            max_jump < 20,
            "Feathered transition should be smooth, max jump was {}",
            max_jump
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_feathered_radial_mask() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.3,
                radius_y: 0.3,
                rotation: 0.0,
                feather: 1.0, // Full feather
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Center should be brightest
        let center = get_pixel(&pixels, 20, 10, 10);

        // Edge of circle area should be partially affected
        let edge = get_pixel(&pixels, 20, 14, 10); // Near edge of mask

        // Corner should be least affected
        let corner = get_pixel(&pixels, 20, 0, 0);

        assert!(
            center.0 >= edge.0,
            "Center ({}) should be >= edge ({})",
            center.0,
            edge.0
        );
        assert!(
            edge.0 >= corner.0,
            "Edge ({}) should be >= corner ({})",
            edge.0,
            corner.0
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_all_adjustment_types() {
        let image = create_colored_image(10, 10, 128, 128, 128);

        // Test all adjustment types in a single mask
        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 2.0, // Ensure full coverage
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 0.5,
                    contrast: 20.0,
                    highlights: -10.0,
                    shadows: 10.0,
                    whites: 5.0,
                    blacks: -5.0,
                    temperature: 10.0,
                    tint: -5.0,
                    saturation: 10.0,
                    vibrance: 15.0,
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Just verify image was modified (all adjustments applied)
        let pixel = get_pixel(&pixels, 10, 5, 5);
        assert_ne!(
            pixel,
            (128, 128, 128),
            "Pixel should be modified by adjustments"
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_rotation_degrees_to_radians() {
        let image = create_gray_image(20, 20, 100);

        // Create an elliptical mask with 90 degree rotation
        // This tests that rotation is converted from degrees to radians
        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.4,  // Wide
                radius_y: 0.15, // Narrow
                rotation: 90.0, // 90 degrees - should make it tall instead of wide
                feather: 0.0,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // With 90 degree rotation, the ellipse should be tall (affecting vertical strip)
        // Check that a point that would be outside horizontally is now affected
        // and a point that would be inside horizontally is now not affected

        // Center should be affected regardless
        let center = get_pixel(&pixels, 20, 10, 10);
        assert!(center.0 > 150, "Center should be bright");

        // With no rotation: wide ellipse would affect x=14, y=10 (within radius_x=0.4)
        // With 90 deg rotation: tall ellipse should NOT affect x=14, y=10 (outside radius_y=0.15)
        let right_side = get_pixel(&pixels, 20, 14, 10);

        // The ellipse is now tall, so horizontal points at same y should be outside
        // This is a tricky test - just verify the mask isn't a simple circle
        // by checking that the effect differs in different directions
        let top = get_pixel(&pixels, 20, 10, 3); // Vertical direction

        // With rotation, vertical should be MORE affected than horizontal
        // (since radius_x > radius_y, and after 90 deg rotation, vertical extent is larger)
        assert!(
            top.0 >= right_side.0 || right_side == (100, 100, 100),
            "Rotation should affect mask shape: top={}, right_side={}",
            top.0,
            right_side.0
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_temperature_color_shift() {
        let image = create_gray_image(10, 10, 128);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 2.0, // Full coverage
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    temperature: -50.0, // Warm (should boost red, reduce blue)
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();
        let pixel = get_pixel(&pixels, 10, 5, 5);

        // Warm temperature should make red > blue
        assert!(
            pixel.0 > pixel.2,
            "Warm temperature should have more red ({}) than blue ({})",
            pixel.0,
            pixel.2
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_saturation_desaturate() {
        let image = create_colored_image(10, 10, 200, 100, 50); // Warm colored image

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 2.0,
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    saturation: -100.0, // Full desaturation
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();
        let pixel = get_pixel(&pixels, 10, 5, 5);

        // Desaturated should be nearly grayscale
        let max_diff = (pixel.0 as i32 - pixel.1 as i32)
            .abs()
            .max((pixel.1 as i32 - pixel.2 as i32).abs())
            .max((pixel.0 as i32 - pixel.2 as i32).abs());

        assert!(
            max_diff < 30,
            "Desaturated should be near gray, max channel diff was {}",
            max_diff
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_output_dimensions_match_input() {
        let image = create_gray_image(123, 456, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 123, "Width should match input");
        assert_eq!(output.height(), 456, "Height should match input");
        assert_eq!(
            output.byte_length(),
            123 * 456 * 3,
            "Byte length should match"
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_pixels_unchanged_with_default_adjustments() {
        let image = create_gray_image(10, 10, 128);
        let original_pixels = image.pixels();

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments::default(), // All zeros
            }],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.5,
                radius_y: 0.5,
                rotation: 0.0,
                feather: 0.0,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments::default(), // All zeros
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(
            output.pixels(),
            original_pixels,
            "Default adjustments should not modify image"
        );
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_mask_strength_blending() {
        // Test that mask correctly blends based on position
        let image = create_gray_image(100, 1, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 1.0,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Sample multiple points to verify gradient blending
        let p0 = pixels[0];           // x=0, should be brightest
        let p25 = pixels[25 * 3];     // x=25
        let p50 = pixels[50 * 3];     // x=50, should be medium
        let p75 = pixels[75 * 3];     // x=75
        let p99 = pixels[99 * 3];     // x=99, should be darkest/unchanged

        // Verify monotonic decrease
        assert!(p0 >= p25, "Gradient should decrease: {} >= {}", p0, p25);
        assert!(p25 >= p50, "Gradient should decrease: {} >= {}", p25, p50);
        assert!(p50 >= p75, "Gradient should decrease: {} >= {}", p50, p75);
        assert!(p75 >= p99, "Gradient should decrease: {} >= {}", p75, p99);

        // Verify actual change occurred
        assert!(p0 > p99, "Left should be brighter than right");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_small_image() {
        // Test with minimal 1x1 image
        let image = create_gray_image(1, 1, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 1);
        assert_eq!(output.height(), 1);
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_large_image() {
        // Test with larger image to verify performance doesn't break
        let image = create_gray_image(500, 500, 128);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 1.0,
                end_y: 0.5,
                feather: 0.5,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 0.5,
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 500);
        assert_eq!(output.height(), 500);
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_extreme_exposure_clamps() {
        let image = create_gray_image(10, 10, 200); // Bright starting point

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 2.0, // Full coverage
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 5.0, // Maximum exposure
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();
        let pixel = get_pixel(&pixels, 10, 5, 5);

        // Should clamp at 255 (white)
        assert_eq!(pixel.0, 255, "Should clamp at white");
        assert_eq!(pixel.1, 255, "Should clamp at white");
        assert_eq!(pixel.2, 255, "Should clamp at white");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_negative_exposure_clamps() {
        let image = create_gray_image(10, 10, 50); // Dark starting point

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![JsLinearMask {
                start_x: 0.0,
                start_y: 0.5,
                end_x: 2.0,
                end_y: 0.5,
                feather: 0.0,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: -5.0, // Minimum exposure
                    ..Default::default()
                },
            }],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();
        let pixel = get_pixel(&pixels, 10, 5, 5);

        // Should clamp at 0 (black) or very close to it
        assert!(pixel.0 < 5, "Should be near black, got {}", pixel.0);
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_elliptical_radial_mask() {
        let image = create_gray_image(40, 20, 100);

        // Ellipse: wide (radius_x > radius_y)
        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![],
            radial_masks: vec![JsRadialMask {
                center_x: 0.5,
                center_y: 0.5,
                radius_x: 0.4, // Wide
                radius_y: 0.2, // Short
                rotation: 0.0,
                feather: 0.0,
                invert: false,
                enabled: true,
                adjustments: JsAdjustments {
                    exposure: 1.0,
                    ..Default::default()
                },
            }],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Center should be affected
        let center = get_pixel(&pixels, 40, 20, 10);
        assert!(center.0 > 150, "Center should be bright");

        // Point above (outside radius_y) should NOT be affected
        let top = get_pixel(&pixels, 40, 20, 0); // 0.0 normalized y - definitely outside
        assert_eq!(top, (100, 100, 100), "Top should be unchanged (outside ellipse)");
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_many_masks() {
        let image = create_gray_image(50, 50, 100);

        // Create multiple overlapping masks
        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 0.5,
                    end_x: 1.0,
                    end_y: 0.5,
                    feather: 0.5,
                    enabled: true,
                    adjustments: JsAdjustments {
                        exposure: 0.3,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 0.5,
                    start_y: 0.0,
                    end_x: 0.5,
                    end_y: 1.0,
                    feather: 0.5,
                    enabled: true,
                    adjustments: JsAdjustments {
                        contrast: 20.0,
                        ..Default::default()
                    },
                },
            ],
            radial_masks: vec![
                JsRadialMask {
                    center_x: 0.25,
                    center_y: 0.25,
                    radius_x: 0.2,
                    radius_y: 0.2,
                    rotation: 0.0,
                    feather: 0.5,
                    invert: false,
                    enabled: true,
                    adjustments: JsAdjustments {
                        saturation: 20.0,
                        ..Default::default()
                    },
                },
                JsRadialMask {
                    center_x: 0.75,
                    center_y: 0.75,
                    radius_x: 0.2,
                    radius_y: 0.2,
                    rotation: 0.0,
                    feather: 0.5,
                    invert: true,
                    enabled: true,
                    adjustments: JsAdjustments {
                        vibrance: 30.0,
                        ..Default::default()
                    },
                },
            ],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        assert_eq!(output.width(), 50);
        assert_eq!(output.height(), 50);
    }

    #[wasm_bindgen_test]
    fn test_apply_masked_adjustments_mixed_enabled_disabled() {
        let image = create_gray_image(20, 20, 100);

        let mask_data = serde_wasm_bindgen::to_value(&JsMaskStack {
            linear_masks: vec![
                JsLinearMask {
                    start_x: 0.0,
                    start_y: 0.5,
                    end_x: 1.0,
                    end_y: 0.5,
                    feather: 0.0,
                    enabled: true, // Enabled
                    adjustments: JsAdjustments {
                        exposure: 1.0,
                        ..Default::default()
                    },
                },
                JsLinearMask {
                    start_x: 1.0,
                    start_y: 0.5,
                    end_x: 0.0,
                    end_y: 0.5,
                    feather: 0.0,
                    enabled: false, // Disabled - would cancel out first if enabled
                    adjustments: JsAdjustments {
                        exposure: -1.0,
                        ..Default::default()
                    },
                },
            ],
            radial_masks: vec![],
        })
        .unwrap();

        let result = apply_masked_adjustments(&image, mask_data);
        assert!(result.is_ok());

        let output = result.unwrap();
        let pixels = output.pixels();

        // Only first mask should apply - left side brighter
        let left = get_pixel(&pixels, 20, 0, 10);
        assert!(
            left.0 > 150,
            "Left should be bright (only enabled mask applies)"
        );
    }
}
