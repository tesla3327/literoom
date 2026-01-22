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
}
