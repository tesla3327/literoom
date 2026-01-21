//! Image adjustment algorithms
//!
//! Applies the 10 basic adjustments to RGB pixel data.
//!
//! ## Adjustment Order
//! 1. Exposure
//! 2. Contrast
//! 3. Temperature
//! 4. Tint
//! 5. Highlights
//! 6. Shadows
//! 7. Whites
//! 8. Blacks
//! 9. Saturation
//! 10. Vibrance

use crate::BasicAdjustments;

/// Apply all adjustments to an image's pixel data in place.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
/// * `adjustments` - The adjustment values to apply
///
/// # Example
/// ```
/// use literoom_core::{BasicAdjustments, adjustments::apply_all_adjustments};
///
/// let mut pixels = vec![128, 128, 128]; // Single gray pixel
/// let mut adj = BasicAdjustments::default();
/// adj.exposure = 1.0; // +1 stop
///
/// apply_all_adjustments(&mut pixels, &adj);
/// // Pixel is now brighter (clamped at 255)
/// ```
pub fn apply_all_adjustments(pixels: &mut [u8], adjustments: &BasicAdjustments) {
    // Early exit if no adjustments
    if adjustments.is_default() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply adjustments in order
        (r, g, b) = apply_exposure(r, g, b, adjustments.exposure);
        (r, g, b) = apply_contrast(r, g, b, adjustments.contrast);
        (r, g, b) = apply_temperature(r, g, b, adjustments.temperature);
        (r, g, b) = apply_tint(r, g, b, adjustments.tint);

        let luminance = calculate_luminance(r, g, b);
        (r, g, b) = apply_highlights(r, g, b, luminance, adjustments.highlights);
        (r, g, b) = apply_shadows(r, g, b, luminance, adjustments.shadows);
        (r, g, b) = apply_whites(r, g, b, adjustments.whites);
        (r, g, b) = apply_blacks(r, g, b, adjustments.blacks);
        (r, g, b) = apply_saturation(r, g, b, adjustments.saturation);
        (r, g, b) = apply_vibrance(r, g, b, adjustments.vibrance);

        chunk[0] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
    }
}

/// Apply exposure adjustment.
///
/// Exposure is measured in stops (-5 to +5).
/// Each stop doubles or halves the brightness.
///
/// Formula: `output = input * 2^exposure`
#[inline]
fn apply_exposure(r: f32, g: f32, b: f32, exposure: f32) -> (f32, f32, f32) {
    if exposure == 0.0 {
        return (r, g, b);
    }
    let multiplier = 2.0_f32.powf(exposure);
    (r * multiplier, g * multiplier, b * multiplier)
}

/// Apply contrast adjustment.
///
/// Contrast ranges from -100 to +100.
/// Positive values increase contrast, negative values decrease it.
///
/// Formula: `output = (input - 0.5) * (1 + contrast/100) + 0.5`
#[inline]
fn apply_contrast(r: f32, g: f32, b: f32, contrast: f32) -> (f32, f32, f32) {
    if contrast == 0.0 {
        return (r, g, b);
    }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = 0.5;
    (
        (r - midpoint) * factor + midpoint,
        (g - midpoint) * factor + midpoint,
        (b - midpoint) * factor + midpoint,
    )
}

/// Apply temperature (white balance) adjustment.
///
/// Temperature ranges from -100 to +100.
/// - Negative = warmer (more orange/red)
/// - Positive = cooler (more blue)
#[inline]
fn apply_temperature(r: f32, g: f32, b: f32, temperature: f32) -> (f32, f32, f32) {
    if temperature == 0.0 {
        return (r, g, b);
    }
    let shift = temperature / 100.0 * 0.3;
    if temperature < 0.0 {
        // Warmer: boost red, reduce blue
        (r * (1.0 + shift.abs()), g, b * (1.0 - shift.abs()))
    } else {
        // Cooler: reduce red, boost blue
        (r * (1.0 - shift), g, b * (1.0 + shift))
    }
}

/// Apply tint (green-magenta) adjustment.
///
/// Tint ranges from -100 to +100.
/// - Negative = more green
/// - Positive = more magenta (red + blue)
#[inline]
fn apply_tint(r: f32, g: f32, b: f32, tint: f32) -> (f32, f32, f32) {
    if tint == 0.0 {
        return (r, g, b);
    }
    let shift = tint / 100.0 * 0.2;
    if tint < 0.0 {
        // Green tint
        (r, g * (1.0 + shift.abs()), b)
    } else {
        // Magenta tint (red + blue)
        (r * (1.0 + shift), g * (1.0 - shift), b * (1.0 + shift))
    }
}

/// Calculate luminance using ITU-R BT.709 coefficients.
#[inline]
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// Smooth interpolation function.
///
/// Returns 0 for x <= edge0, 1 for x >= edge1,
/// and smoothly interpolates between.
#[inline]
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Apply highlights adjustment.
///
/// Highlights range from -100 to +100.
/// Affects bright areas of the image (luminance > 0.5).
#[inline]
fn apply_highlights(r: f32, g: f32, b: f32, luminance: f32, highlights: f32) -> (f32, f32, f32) {
    if highlights == 0.0 {
        return (r, g, b);
    }
    // Mask: 1 for bright areas, 0 for dark areas, smooth transition in between
    let highlight_mask = smoothstep(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;

    if highlights < 0.0 {
        // Reduce highlights: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        (r * factor, g * factor, b * factor)
    } else {
        // Boost highlights: add to each channel
        let boost = adjustment * 0.5;
        (r + boost, g + boost, b + boost)
    }
}

/// Apply shadows adjustment.
///
/// Shadows range from -100 to +100.
/// Affects dark areas of the image (luminance < 0.5).
#[inline]
fn apply_shadows(r: f32, g: f32, b: f32, luminance: f32, shadows: f32) -> (f32, f32, f32) {
    if shadows == 0.0 {
        return (r, g, b);
    }
    // Mask: 1 for dark areas, 0 for bright areas
    let shadow_mask = smoothstep(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;

    if shadows < 0.0 {
        // Deepen shadows: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        (r * factor, g * factor, b * factor)
    } else {
        // Lift shadows: add to each channel
        let boost = adjustment * 0.5;
        (r + boost, g + boost, b + boost)
    }
}

/// Apply whites adjustment.
///
/// Whites range from -100 to +100.
/// Affects the brightest pixels (any channel > 0.9).
#[inline]
fn apply_whites(r: f32, g: f32, b: f32, whites: f32) -> (f32, f32, f32) {
    if whites == 0.0 {
        return (r, g, b);
    }
    let max_channel = r.max(g).max(b);
    if max_channel > 0.9 {
        let factor = 1.0 + (whites / 100.0) * 0.3;
        (r * factor, g * factor, b * factor)
    } else {
        (r, g, b)
    }
}

/// Apply blacks adjustment.
///
/// Blacks range from -100 to +100.
/// Affects the darkest pixels (any channel < 0.1).
#[inline]
fn apply_blacks(r: f32, g: f32, b: f32, blacks: f32) -> (f32, f32, f32) {
    if blacks == 0.0 {
        return (r, g, b);
    }
    let min_channel = r.min(g).min(b);
    if min_channel < 0.1 {
        let factor = 1.0 + (blacks / 100.0) * 0.2;
        (r * factor, g * factor, b * factor)
    } else {
        (r, g, b)
    }
}

/// Apply saturation adjustment.
///
/// Saturation ranges from -100 to +100.
/// - Negative = desaturate toward grayscale
/// - Positive = increase color intensity
#[inline]
fn apply_saturation(r: f32, g: f32, b: f32, saturation: f32) -> (f32, f32, f32) {
    if saturation == 0.0 {
        return (r, g, b);
    }
    // Luminance-based desaturation
    let gray = calculate_luminance(r, g, b);
    let factor = 1.0 + (saturation / 100.0);
    (
        gray + (r - gray) * factor,
        gray + (g - gray) * factor,
        gray + (b - gray) * factor,
    )
}

/// Apply vibrance adjustment.
///
/// Vibrance ranges from -100 to +100.
/// Similar to saturation but:
/// - Protects already-saturated colors
/// - Protects skin tones (R > G > B)
/// - More subtle, natural-looking effect
#[inline]
fn apply_vibrance(r: f32, g: f32, b: f32, vibrance: f32) -> (f32, f32, f32) {
    if vibrance == 0.0 {
        return (r, g, b);
    }

    // Calculate current saturation (simplified HSV S)
    let max_c = r.max(g).max(b);
    let min_c = r.min(g).min(b);
    let current_sat = if max_c > 0.0 {
        (max_c - min_c) / max_c
    } else {
        0.0
    };

    // Detect skin tones (simplified: R > G > B with specific ratios)
    let is_skin = r > g && g > b && (r - g) > 0.06;
    let skin_protection = if is_skin { 0.5 } else { 1.0 };

    // Less effect on already saturated colors
    let saturation_protection = 1.0 - current_sat;

    // Apply reduced vibrance
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    apply_saturation(r, g, b, effective_vibrance)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a pixel from RGB values (0-255)
    fn pixel(r: u8, g: u8, b: u8) -> Vec<u8> {
        vec![r, g, b]
    }

    /// Helper to apply adjustments and return resulting pixel
    fn apply(pixels: &[u8], adj: &BasicAdjustments) -> Vec<u8> {
        let mut result = pixels.to_vec();
        apply_all_adjustments(&mut result, adj);
        result
    }

    // ===== Identity Tests =====

    #[test]
    fn test_identity_no_adjustments() {
        let pixels = pixel(128, 64, 192);
        let adj = BasicAdjustments::default();
        let result = apply(&pixels, &adj);
        assert_eq!(
            result, pixels,
            "Default adjustments should not change pixels"
        );
    }

    #[test]
    fn test_identity_black_pixel() {
        let pixels = pixel(0, 0, 0);
        let adj = BasicAdjustments::default();
        let result = apply(&pixels, &adj);
        assert_eq!(result, pixels);
    }

    #[test]
    fn test_identity_white_pixel() {
        let pixels = pixel(255, 255, 255);
        let adj = BasicAdjustments::default();
        let result = apply(&pixels, &adj);
        assert_eq!(result, pixels);
    }

    // ===== Exposure Tests =====

    #[test]
    fn test_exposure_positive_one_stop() {
        let pixels = pixel(64, 64, 64);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0; // +1 stop = 2x brightness
        let result = apply(&pixels, &adj);
        // 64 * 2 = 128
        assert_eq!(result, pixel(128, 128, 128));
    }

    #[test]
    fn test_exposure_negative_one_stop() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.exposure = -1.0; // -1 stop = 0.5x brightness
        let result = apply(&pixels, &adj);
        // 128 * 0.5 = 64
        assert_eq!(result, pixel(64, 64, 64));
    }

    #[test]
    fn test_exposure_clips_at_white() {
        let pixels = pixel(200, 200, 200);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 2.0; // +2 stops = 4x brightness
        let result = apply(&pixels, &adj);
        // Clipped at 255
        assert_eq!(result, pixel(255, 255, 255));
    }

    // ===== Contrast Tests =====

    #[test]
    fn test_contrast_positive() {
        let pixels = pixel(64, 128, 192);
        let mut adj = BasicAdjustments::default();
        adj.contrast = 100.0; // Double contrast
        let result = apply(&pixels, &adj);
        // midpoint = 0.5 (128)
        // 64/255 = 0.251, (0.251 - 0.5) * 2 + 0.5 = 0.002 -> ~0
        // 128/255 = 0.502, (0.502 - 0.5) * 2 + 0.5 = 0.504 -> ~128
        // 192/255 = 0.753, (0.753 - 0.5) * 2 + 0.5 = 1.006 -> 255 (clamped)
        assert!(result[0] < 64, "Dark pixel should get darker");
        assert!(
            (result[1] as i32 - 128).abs() < 5,
            "Mid pixel should stay near middle"
        );
        assert_eq!(result[2], 255, "Bright pixel should clip at white");
    }

    #[test]
    fn test_contrast_negative() {
        let pixels = pixel(0, 128, 255);
        let mut adj = BasicAdjustments::default();
        adj.contrast = -50.0; // Reduce contrast
        let result = apply(&pixels, &adj);
        // All values should move toward midpoint (128)
        assert!(result[0] > 0, "Black should move toward gray");
        assert!(
            (result[1] as i32 - 128).abs() < 5,
            "Mid should stay near middle"
        );
        assert!(result[2] < 255, "White should move toward gray");
    }

    // ===== Temperature Tests =====

    #[test]
    fn test_temperature_warm() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.temperature = -100.0; // Maximum warm
        let result = apply(&pixels, &adj);
        assert!(result[0] > 128, "Red should increase for warm");
        assert!(result[2] < 128, "Blue should decrease for warm");
    }

    #[test]
    fn test_temperature_cool() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.temperature = 100.0; // Maximum cool
        let result = apply(&pixels, &adj);
        assert!(result[0] < 128, "Red should decrease for cool");
        assert!(result[2] > 128, "Blue should increase for cool");
    }

    // ===== Tint Tests =====

    #[test]
    fn test_tint_green() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.tint = -100.0; // Maximum green
        let result = apply(&pixels, &adj);
        assert!(result[1] > 128, "Green should increase");
        assert_eq!(result[0], 128, "Red should stay same");
        assert_eq!(result[2], 128, "Blue should stay same");
    }

    #[test]
    fn test_tint_magenta() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.tint = 100.0; // Maximum magenta
        let result = apply(&pixels, &adj);
        assert!(result[0] > 128, "Red should increase for magenta");
        assert!(result[1] < 128, "Green should decrease for magenta");
        assert!(result[2] > 128, "Blue should increase for magenta");
    }

    // ===== Saturation Tests =====

    #[test]
    fn test_saturation_increase() {
        let pixels = pixel(200, 128, 100);
        let mut adj = BasicAdjustments::default();
        adj.saturation = 50.0;
        let result = apply(&pixels, &adj);
        // Colors should become more vivid
        // The difference between channels should increase
        let orig_diff = (200 - 100) as i32;
        let new_diff = (result[0] as i32 - result[2] as i32).abs();
        assert!(new_diff > orig_diff, "Color difference should increase");
    }

    #[test]
    fn test_saturation_desaturate() {
        let pixels = pixel(200, 128, 100);
        let mut adj = BasicAdjustments::default();
        adj.saturation = -100.0; // Full desaturation
        let result = apply(&pixels, &adj);
        // Should become grayscale (all channels roughly equal)
        let avg = (result[0] as i32 + result[1] as i32 + result[2] as i32) / 3;
        assert!((result[0] as i32 - avg).abs() < 5);
        assert!((result[1] as i32 - avg).abs() < 5);
        assert!((result[2] as i32 - avg).abs() < 5);
    }

    // ===== Vibrance Tests =====

    #[test]
    fn test_vibrance_protects_saturated() {
        // Highly saturated red
        let saturated = pixel(255, 0, 0);
        let mut adj = BasicAdjustments::default();
        adj.vibrance = 100.0;
        let result = apply(&saturated, &adj);
        // Already saturated color should not change much
        assert_eq!(result[0], 255, "Red should stay at max");
        assert!(result[1] < 30, "Green should stay low");
        assert!(result[2] < 30, "Blue should stay low");
    }

    #[test]
    fn test_vibrance_boosts_desaturated() {
        // Low saturation gray-ish color
        let muted = pixel(140, 130, 120);
        let mut adj = BasicAdjustments::default();
        adj.vibrance = 100.0;
        let result = apply(&muted, &adj);
        // Muted color should get more saturated
        let orig_diff = 140 - 120;
        let new_diff = result[0] as i32 - result[2] as i32;
        assert!(
            new_diff > orig_diff,
            "Color difference should increase for muted colors"
        );
    }

    // ===== Highlights/Shadows Tests =====

    #[test]
    fn test_highlights_only_affects_bright() {
        // Dark pixel should not be affected by highlights
        let dark = pixel(30, 30, 30);
        let mut adj = BasicAdjustments::default();
        adj.highlights = 50.0;
        let result = apply(&dark, &adj);
        assert!(
            (result[0] as i32 - 30).abs() < 5,
            "Dark pixels should not change much"
        );
    }

    #[test]
    fn test_shadows_only_affects_dark() {
        // Bright pixel should not be affected by shadows
        let bright = pixel(220, 220, 220);
        let mut adj = BasicAdjustments::default();
        adj.shadows = 50.0;
        let result = apply(&bright, &adj);
        assert!(
            (result[0] as i32 - 220).abs() < 5,
            "Bright pixels should not change much"
        );
    }

    // ===== Whites/Blacks Tests =====

    #[test]
    fn test_whites_clips_at_max() {
        let almost_white = pixel(240, 240, 240);
        let mut adj = BasicAdjustments::default();
        adj.whites = 100.0;
        let result = apply(&almost_white, &adj);
        assert_eq!(result[0], 255, "Should clip at white");
    }

    #[test]
    fn test_blacks_affects_dark_only() {
        let almost_black = pixel(20, 20, 20);
        let mut adj = BasicAdjustments::default();
        adj.blacks = 50.0;
        let result_dark = apply(&almost_black, &adj);
        assert!(result_dark[0] > 20, "Dark pixel should brighten");

        let mid_gray = pixel(128, 128, 128);
        let result_mid = apply(&mid_gray, &adj);
        assert_eq!(result_mid[0], 128, "Mid-gray should not change");
    }

    // ===== Combined Adjustments Tests =====

    #[test]
    fn test_multiple_adjustments() {
        let pixels = pixel(100, 100, 100);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 0.5;
        adj.contrast = 20.0;
        adj.saturation = 10.0;
        let result = apply(&pixels, &adj);
        // Just verify it doesn't crash and produces valid output (3 RGB bytes)
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_extreme_values_dont_crash() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.exposure = 5.0;
        adj.contrast = 100.0;
        adj.temperature = 100.0;
        adj.tint = 100.0;
        adj.highlights = 100.0;
        adj.shadows = 100.0;
        adj.whites = 100.0;
        adj.blacks = 100.0;
        adj.vibrance = 100.0;
        adj.saturation = 100.0;
        let result = apply(&pixels, &adj);
        // Just verify it doesn't crash and produces valid output
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_all_negative_extreme() {
        let pixels = pixel(128, 128, 128);
        let mut adj = BasicAdjustments::default();
        adj.exposure = -5.0;
        adj.contrast = -100.0;
        adj.temperature = -100.0;
        adj.tint = -100.0;
        adj.highlights = -100.0;
        adj.shadows = -100.0;
        adj.whites = -100.0;
        adj.blacks = -100.0;
        adj.vibrance = -100.0;
        adj.saturation = -100.0;
        let result = apply(&pixels, &adj);
        // Just verify it doesn't crash and produces valid output
        assert_eq!(result.len(), 3);
    }

    // ===== Multi-pixel Tests =====

    #[test]
    fn test_multiple_pixels() {
        let mut pixels = vec![
            255, 0, 0, // Red
            0, 255, 0, // Green
            0, 0, 255, // Blue
            128, 128, 128, // Gray
        ];
        let mut adj = BasicAdjustments::default();
        adj.saturation = -100.0;
        apply_all_adjustments(&mut pixels, &adj);

        // All should be grayscale now
        // Red pixel
        assert!((pixels[0] as i32 - pixels[1] as i32).abs() < 10);
        // Green pixel
        assert!((pixels[3] as i32 - pixels[4] as i32).abs() < 10);
        // Blue pixel
        assert!((pixels[6] as i32 - pixels[7] as i32).abs() < 10);
    }

    // ===== Edge Case Tests =====

    #[test]
    fn test_empty_pixels() {
        let mut pixels: Vec<u8> = vec![];
        let adj = BasicAdjustments::default();
        apply_all_adjustments(&mut pixels, &adj);
        assert!(pixels.is_empty());
    }

    #[test]
    fn test_incomplete_pixel_ignored() {
        // 4 bytes = 1 complete pixel + 1 byte remainder
        let mut pixels = vec![128, 128, 128, 64];
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0;
        apply_all_adjustments(&mut pixels, &adj);
        // Only complete pixel should be modified
        assert_eq!(pixels[0], 255); // Brightened and clamped
        assert_eq!(pixels[3], 64); // Remainder unchanged
    }
}
