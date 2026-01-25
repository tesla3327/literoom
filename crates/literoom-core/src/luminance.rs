//! Luminance calculation utilities using ITU-R BT.709 coefficients.
//!
//! This module provides shared luminance calculation functions used throughout
//! the image processing pipeline for histogram computation and tonal adjustments.

/// ITU-R BT.709 coefficient for red channel in luminance calculation.
pub const LUMINANCE_R: f32 = 0.2126;

/// ITU-R BT.709 coefficient for green channel in luminance calculation.
pub const LUMINANCE_G: f32 = 0.7152;

/// ITU-R BT.709 coefficient for blue channel in luminance calculation.
pub const LUMINANCE_B: f32 = 0.0722;

/// Calculate luminance from normalized RGB values (0.0 to 1.0).
///
/// Uses ITU-R BT.709 coefficients for accurate perceptual luminance.
///
/// # Arguments
/// * `r` - Red channel value (0.0 to 1.0)
/// * `g` - Green channel value (0.0 to 1.0)
/// * `b` - Blue channel value (0.0 to 1.0)
///
/// # Returns
/// Luminance value (0.0 to 1.0)
#[inline]
pub fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b
}

/// Calculate luminance from u8 RGB values (0 to 255).
///
/// Uses ITU-R BT.709 coefficients for accurate perceptual luminance.
///
/// # Arguments
/// * `r` - Red channel value (0-255)
/// * `g` - Green channel value (0-255)
/// * `b` - Blue channel value (0-255)
///
/// # Returns
/// Luminance value (0-255)
#[inline]
pub fn calculate_luminance_u8(r: u8, g: u8, b: u8) -> u8 {
    let lum = LUMINANCE_R * r as f32 + LUMINANCE_G * g as f32 + LUMINANCE_B * b as f32;
    lum.clamp(0.0, 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coefficients_sum_to_one() {
        let sum = LUMINANCE_R + LUMINANCE_G + LUMINANCE_B;
        assert!((sum - 1.0).abs() < 1e-6, "Coefficients should sum to 1.0");
    }

    #[test]
    fn test_luminance_pure_white() {
        assert!((calculate_luminance(1.0, 1.0, 1.0) - 1.0).abs() < f32::EPSILON);
        assert_eq!(calculate_luminance_u8(255, 255, 255), 255);
    }

    #[test]
    fn test_luminance_pure_black() {
        assert!((calculate_luminance(0.0, 0.0, 0.0) - 0.0).abs() < f32::EPSILON);
        assert_eq!(calculate_luminance_u8(0, 0, 0), 0);
    }

    #[test]
    fn test_luminance_gray_preserves_value() {
        // For gray (r=g=b), luminance should equal that gray value
        for v in [0u8, 64, 128, 192, 255] {
            let lum = calculate_luminance_u8(v, v, v);
            assert!(
                (lum as i32 - v as i32).abs() <= 1,
                "Gray {} should produce luminance ~{}, got {}",
                v,
                v,
                lum
            );
        }
    }

    #[test]
    fn test_luminance_pure_red() {
        let lum = calculate_luminance_u8(255, 0, 0);
        // 0.2126 * 255 ≈ 54.21
        assert!((lum as i32 - 54).abs() <= 1);
    }

    #[test]
    fn test_luminance_pure_green() {
        let lum = calculate_luminance_u8(0, 255, 0);
        // 0.7152 * 255 ≈ 182.38
        assert!((lum as i32 - 182).abs() <= 1);
    }

    #[test]
    fn test_luminance_pure_blue() {
        let lum = calculate_luminance_u8(0, 0, 255);
        // 0.0722 * 255 ≈ 18.41
        assert!((lum as i32 - 18).abs() <= 1);
    }

    #[test]
    fn test_luminance_f32_matches_u8() {
        // Test that f32 and u8 versions produce consistent results
        for r in [0, 64, 128, 192, 255] {
            for g in [0, 64, 128, 192, 255] {
                for b in [0, 64, 128, 192, 255] {
                    let lum_f32 = calculate_luminance(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
                    let lum_u8 = calculate_luminance_u8(r, g, b);
                    let expected_u8 = (lum_f32 * 255.0).round() as u8;
                    assert!(
                        (lum_u8 as i32 - expected_u8 as i32).abs() <= 1,
                        "f32 and u8 luminance should match for ({}, {}, {})",
                        r, g, b
                    );
                }
            }
        }
    }
}
