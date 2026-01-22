//! Masked adjustment application
//!
//! This module applies adjustments to an image using mask-based blending.
//! Each mask can have its own set of adjustments, which are blended with
//! the original pixel values based on the mask's strength at each pixel.

use super::{LinearGradientMask, RadialGradientMask};
use crate::adjustments::apply_adjustments_to_pixel;
use crate::BasicAdjustments;

/// Apply masked adjustments to an image.
///
/// Each mask applies its own set of adjustments, blended with the mask's
/// alpha value at each pixel location. Masks are applied sequentially,
/// with each mask's result becoming the input for the next.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// * `linear_masks` - Linear gradient masks with their adjustments
/// * `radial_masks` - Radial gradient masks with their adjustments
///
/// # Algorithm
/// For each pixel, for each mask:
/// 1. Evaluate mask strength at pixel coordinates (0.0 to 1.0)
/// 2. If mask strength > 0, apply adjustments to get target color
/// 3. Blend: `output = original * (1 - mask) + adjusted * mask`
///
/// # Performance
/// - Early exit if no masks are provided
/// - Per-pixel early exit if mask value is near zero
/// - O(pixels × masks) complexity
///
/// # Example
/// ```
/// use literoom_core::mask::{LinearGradientMask, apply_masked_adjustments};
/// use literoom_core::BasicAdjustments;
///
/// let mut pixels = vec![128u8; 100 * 100 * 3]; // 100x100 gray image
///
/// let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);
/// let mut adj = BasicAdjustments::default();
/// adj.exposure = 1.0; // +1 stop
///
/// apply_masked_adjustments(
///     &mut pixels,
///     100, 100,
///     &[(mask, adj)],
///     &[],
/// );
/// // Left side is brighter, right side unchanged
/// ```
pub fn apply_masked_adjustments(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    linear_masks: &[(LinearGradientMask, BasicAdjustments)],
    radial_masks: &[(RadialGradientMask, BasicAdjustments)],
) {
    // Early exit if no masks
    if linear_masks.is_empty() && radial_masks.is_empty() {
        return;
    }

    let w_f = width as f32;
    let h_f = height as f32;

    for (idx, chunk) in pixels.chunks_exact_mut(3).enumerate() {
        let px = (idx as u32) % width;
        let py = (idx as u32) / width;

        // Normalized coordinates (0-1), centered on pixel
        let x = (px as f32 + 0.5) / w_f;
        let y = (py as f32 + 0.5) / h_f;

        // Current pixel values as floats (0-1)
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply each linear mask
        for (mask, adj) in linear_masks {
            let mask_val = mask.evaluate(x, y);

            // Skip if mask has no effect at this pixel
            if mask_val < 0.001 {
                continue;
            }

            // Skip if adjustments are all default
            if adj.is_default() {
                continue;
            }

            // Apply adjustments to get target color
            let (ar, ag, ab) = apply_adjustments_to_pixel(r, g, b, adj);

            // Blend based on mask value
            r = r * (1.0 - mask_val) + ar * mask_val;
            g = g * (1.0 - mask_val) + ag * mask_val;
            b = b * (1.0 - mask_val) + ab * mask_val;
        }

        // Apply each radial mask
        for (mask, adj) in radial_masks {
            let mask_val = mask.evaluate(x, y);

            // Skip if mask has no effect at this pixel
            if mask_val < 0.001 {
                continue;
            }

            // Skip if adjustments are all default
            if adj.is_default() {
                continue;
            }

            // Apply adjustments to get target color
            let (ar, ag, ab) = apply_adjustments_to_pixel(r, g, b, adj);

            // Blend based on mask value
            r = r * (1.0 - mask_val) + ar * mask_val;
            g = g * (1.0 - mask_val) + ag * mask_val;
            b = b * (1.0 - mask_val) + ab * mask_val;
        }

        // Write back (clamp to valid range)
        chunk[0] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a uniform gray image
    fn gray_image(width: u32, height: u32, value: u8) -> Vec<u8> {
        vec![value; (width * height * 3) as usize]
    }

    /// Helper to get pixel at coordinates
    fn get_pixel(pixels: &[u8], width: u32, x: u32, y: u32) -> (u8, u8, u8) {
        let idx = ((y * width + x) * 3) as usize;
        (pixels[idx], pixels[idx + 1], pixels[idx + 2])
    }

    #[test]
    fn test_no_masks_no_change() {
        let mut pixels = gray_image(100, 100, 128);
        let original = pixels.clone();

        apply_masked_adjustments(&mut pixels, 100, 100, &[], &[]);

        assert_eq!(pixels, original, "No masks should leave image unchanged");
    }

    #[test]
    fn test_default_adjustments_no_change() {
        let mut pixels = gray_image(100, 100, 128);
        let original = pixels.clone();

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0);
        let adj = BasicAdjustments::default();

        apply_masked_adjustments(&mut pixels, 100, 100, &[(mask, adj)], &[]);

        assert_eq!(pixels, original, "Default adjustments should leave image unchanged");
    }

    #[test]
    fn test_linear_mask_exposure() {
        let mut pixels = gray_image(10, 10, 128);

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0); // Hard edge
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0; // +1 stop (doubles brightness)

        apply_masked_adjustments(&mut pixels, 10, 10, &[(mask, adj)], &[]);

        // Left side (mask = 1.0) should be brighter
        let left_pixel = get_pixel(&pixels, 10, 0, 5);
        assert!(left_pixel.0 > 200, "Left should be bright (exposure +1), got {}", left_pixel.0);

        // Right side (mask = 0.0) should be unchanged
        let right_pixel = get_pixel(&pixels, 10, 9, 5);
        assert_eq!(right_pixel, (128, 128, 128), "Right should be unchanged");
    }

    #[test]
    fn test_radial_mask_exposure() {
        let mut pixels = gray_image(20, 20, 100);

        // Circle in center
        let mask = RadialGradientMask::circle(0.5, 0.5, 0.3, 0.0); // Hard edge
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0;

        apply_masked_adjustments(&mut pixels, 20, 20, &[], &[(mask, adj)]);

        // Center (mask = 1.0) should be brighter
        let center = get_pixel(&pixels, 20, 10, 10);
        assert!(center.0 > 150, "Center should be bright, got {}", center.0);

        // Corner (mask = 0.0) should be unchanged
        let corner = get_pixel(&pixels, 20, 0, 0);
        assert_eq!(corner, (100, 100, 100), "Corner should be unchanged");
    }

    #[test]
    fn test_radial_mask_inverted() {
        let mut pixels = gray_image(20, 20, 100);

        // Inverted circle - affects outside
        let mask = RadialGradientMask::new(0.5, 0.5, 0.3, 0.3, 0.0, 0.0, true);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0;

        apply_masked_adjustments(&mut pixels, 20, 20, &[], &[(mask, adj)]);

        // Center (inverted mask = 0.0) should be unchanged
        let center = get_pixel(&pixels, 20, 10, 10);
        assert_eq!(center, (100, 100, 100), "Center should be unchanged (inverted)");

        // Corner (inverted mask = 1.0) should be brighter
        let corner = get_pixel(&pixels, 20, 0, 0);
        assert!(corner.0 > 150, "Corner should be bright (inverted), got {}", corner.0);
    }

    #[test]
    fn test_multiple_masks() {
        let mut pixels = gray_image(20, 20, 100);

        // Two masks with different effects
        let mask1 = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0);
        let mut adj1 = BasicAdjustments::default();
        adj1.exposure = 0.5;

        let mask2 = RadialGradientMask::circle(0.5, 0.5, 0.4, 0.0);
        let mut adj2 = BasicAdjustments::default();
        adj2.contrast = 50.0;

        apply_masked_adjustments(&mut pixels, 20, 20, &[(mask1, adj1)], &[(mask2, adj2)]);

        // Just verify it doesn't crash and produces some change
        let center = get_pixel(&pixels, 20, 10, 10);
        // Center is affected by both masks
        assert_ne!(center, (100, 100, 100), "Center should be modified by masks");
    }

    #[test]
    fn test_temperature_tint() {
        let mut pixels = gray_image(10, 10, 128);

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0);
        let mut adj = BasicAdjustments::default();
        adj.temperature = -100.0; // Warm (boost red, reduce blue)

        apply_masked_adjustments(&mut pixels, 10, 10, &[(mask, adj)], &[]);

        let left = get_pixel(&pixels, 10, 0, 5);
        assert!(left.0 > left.2, "Warm should have more red than blue");
    }

    #[test]
    fn test_saturation() {
        // Colored pixel
        let mut pixels = vec![200u8, 128, 100]; // Warm-ish color

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0);
        let mut adj = BasicAdjustments::default();
        adj.saturation = -100.0; // Full desaturation

        apply_masked_adjustments(&mut pixels, 1, 1, &[(mask, adj)], &[]);

        // Should be nearly grayscale
        let diff = (pixels[0] as i32 - pixels[2] as i32).abs();
        assert!(diff < 20, "Desaturated should be near gray, diff was {}", diff);
    }

    #[test]
    fn test_feathered_transition() {
        let mut pixels = gray_image(100, 1, 100);

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 1.0); // Full feather
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0;

        apply_masked_adjustments(&mut pixels, 100, 1, &[(mask, adj)], &[]);

        // Check for smooth transition
        let left = pixels[0];
        let center = pixels[50 * 3];
        let right = pixels[99 * 3];

        assert!(left > center, "Left should be brighter than center");
        assert!(center > right, "Center should be brighter than right");

        // Verify transition is gradual (no sudden jumps)
        let mut max_jump = 0i32;
        for i in 1..100 {
            let prev = pixels[(i - 1) * 3] as i32;
            let curr = pixels[i * 3] as i32;
            let jump = (curr - prev).abs();
            max_jump = max_jump.max(jump);
        }
        assert!(max_jump < 20, "Transition should be smooth, max jump was {}", max_jump);
    }

    #[test]
    fn test_empty_image() {
        let mut pixels: Vec<u8> = vec![];

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.5);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0;

        // Should not panic
        apply_masked_adjustments(&mut pixels, 0, 0, &[(mask, adj)], &[]);

        assert!(pixels.is_empty());
    }

    #[test]
    fn test_extreme_adjustments_clamp() {
        let mut pixels = gray_image(1, 1, 200);

        let mask = LinearGradientMask::new(0.0, 0.5, 1.0, 0.5, 0.0);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 5.0; // Maximum exposure

        apply_masked_adjustments(&mut pixels, 1, 1, &[(mask, adj)], &[]);

        // Should clamp at 255
        assert_eq!(pixels[0], 255, "Should clamp at white");
    }

    #[test]
    fn test_highlights_shadows() {
        let mut pixels = vec![
            50, 50, 50,    // Dark pixel
            200, 200, 200, // Bright pixel
        ];

        let mask = LinearGradientMask::new(0.0, 0.5, 2.0, 0.5, 0.0); // Both pixels fully affected
        let mut adj = BasicAdjustments::default();
        adj.highlights = -50.0; // Reduce highlights
        adj.shadows = 50.0;     // Lift shadows

        let original = pixels.clone();
        apply_masked_adjustments(&mut pixels, 2, 1, &[(mask, adj)], &[]);

        // Dark pixel should be lifted
        assert!(pixels[0] > original[0], "Shadow should be lifted");

        // Bright pixel should be reduced
        assert!(pixels[3] < original[3], "Highlight should be reduced");
    }
}
