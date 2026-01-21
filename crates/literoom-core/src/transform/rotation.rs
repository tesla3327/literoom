//! Image rotation with bilinear and Lanczos3 interpolation.
//!
//! This module provides high-quality image rotation using two interpolation methods:
//! - **Bilinear**: Fast interpolation suitable for preview rendering
//! - **Lanczos3**: High-quality interpolation suitable for export
//!
//! # Algorithm
//!
//! The rotation uses inverse mapping: for each pixel in the output image,
//! we calculate which source pixel(s) contribute to it and interpolate
//! their values.
//!
//! For rotation by angle θ, the inverse transform is:
//! ```text
//! src_x = (dst_x - cx) * cos(-θ) - (dst_y - cy) * sin(-θ) + src_cx
//! src_y = (dst_x - cx) * sin(-θ) + (dst_y - cy) * cos(-θ) + src_cy
//! ```

use crate::decode::DecodedImage;

/// Interpolation filter for rotation operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InterpolationFilter {
    /// Fast bilinear interpolation - good for preview rendering.
    #[default]
    Bilinear,
    /// High-quality Lanczos3 interpolation - good for export.
    Lanczos3,
}

/// Compute the dimensions of the bounding box for a rotated image.
///
/// When an image is rotated, the corners extend beyond the original bounds.
/// This function calculates the minimum bounding box that contains the
/// entire rotated image.
///
/// # Arguments
///
/// * `width` - Original image width
/// * `height` - Original image height
/// * `angle_degrees` - Rotation angle in degrees (positive = counter-clockwise)
///
/// # Returns
///
/// Tuple of (new_width, new_height) for the rotated bounding box.
///
/// # Example
///
/// ```
/// use literoom_core::transform::compute_rotated_bounds;
///
/// // 90-degree rotation swaps dimensions
/// let (w, h) = compute_rotated_bounds(100, 50, 90.0);
/// assert_eq!(w, 50);
/// assert_eq!(h, 100);
///
/// // No rotation preserves dimensions
/// let (w, h) = compute_rotated_bounds(100, 50, 0.0);
/// assert_eq!(w, 100);
/// assert_eq!(h, 50);
/// ```
pub fn compute_rotated_bounds(width: u32, height: u32, angle_degrees: f64) -> (u32, u32) {
    // Normalize angle to handle 360, 720, etc.
    let angle_normalized = angle_degrees % 360.0;

    // Fast path: no rotation needed (including near-zero and multiples of 360)
    if angle_normalized.abs() < 0.001 || (360.0 - angle_normalized.abs()).abs() < 0.001 {
        return (width, height);
    }

    // Fast path: exact 90/270 degree rotations (swap dimensions)
    let abs_angle = angle_normalized.abs();
    if (abs_angle - 90.0).abs() < 0.001 || (abs_angle - 270.0).abs() < 0.001 {
        return (height, width);
    }

    // Fast path: exact 180 degree rotation (same dimensions)
    if (abs_angle - 180.0).abs() < 0.001 {
        return (width, height);
    }

    let angle_rad = angle_degrees.to_radians();
    let cos = angle_rad.cos().abs();
    let sin = angle_rad.sin().abs();

    let w = width as f64;
    let h = height as f64;

    // The bounding box of a rotated rectangle is:
    // new_w = |w*cos| + |h*sin|
    // new_h = |w*sin| + |h*cos|
    let new_w = (w * cos + h * sin).round() as u32;
    let new_h = (w * sin + h * cos).round() as u32;

    (new_w.max(1), new_h.max(1))
}

/// Apply rotation to an image.
///
/// The image is rotated around its center. The output canvas is expanded
/// to fit the entire rotated image (no clipping).
///
/// # Arguments
///
/// * `image` - Source image to rotate
/// * `angle_degrees` - Rotation angle in degrees (positive = counter-clockwise)
/// * `filter` - Interpolation method (Bilinear for preview, Lanczos3 for export)
///
/// # Returns
///
/// New `DecodedImage` with the rotated content. The dimensions may differ
/// from the source due to canvas expansion.
///
/// # Example
///
/// ```ignore
/// use literoom_core::transform::{apply_rotation, InterpolationFilter};
///
/// let rotated = apply_rotation(&image, 15.0, InterpolationFilter::Bilinear);
/// ```
pub fn apply_rotation(
    image: &DecodedImage,
    angle_degrees: f64,
    filter: InterpolationFilter,
) -> DecodedImage {
    // Fast path: no rotation needed
    if angle_degrees.abs() < 0.001 {
        return image.clone();
    }

    let (src_w, src_h) = (image.width as f64, image.height as f64);
    let (dst_w, dst_h) = compute_rotated_bounds(image.width, image.height, angle_degrees);

    // Negate angle for correct visual rotation direction
    // (positive angle should rotate counter-clockwise visually)
    let angle_rad = -angle_degrees.to_radians();
    let cos = angle_rad.cos();
    let sin = angle_rad.sin();

    // Center of source and destination images
    let src_cx = src_w / 2.0;
    let src_cy = src_h / 2.0;
    let dst_cx = dst_w as f64 / 2.0;
    let dst_cy = dst_h as f64 / 2.0;

    let mut output = vec![0u8; (dst_w * dst_h * 3) as usize];

    for dst_y in 0..dst_h {
        for dst_x in 0..dst_w {
            // Translate destination point to origin at center
            let dx = dst_x as f64 - dst_cx;
            let dy = dst_y as f64 - dst_cy;

            // Apply inverse rotation to find source coordinates
            let src_x = dx * cos - dy * sin + src_cx;
            let src_y = dx * sin + dy * cos + src_cy;

            let dst_idx = ((dst_y * dst_w + dst_x) * 3) as usize;

            // Sample pixel using the specified interpolation
            let pixel = match filter {
                InterpolationFilter::Bilinear => sample_bilinear(image, src_x, src_y),
                InterpolationFilter::Lanczos3 => sample_lanczos3(image, src_x, src_y),
            };

            output[dst_idx] = pixel[0];
            output[dst_idx + 1] = pixel[1];
            output[dst_idx + 2] = pixel[2];
        }
    }

    DecodedImage {
        width: dst_w,
        height: dst_h,
        pixels: output,
    }
}

/// Sample a pixel using bilinear interpolation.
///
/// Bilinear interpolation considers the 4 nearest pixels and weights
/// their contribution based on distance.
fn sample_bilinear(image: &DecodedImage, x: f64, y: f64) -> [u8; 3] {
    let (w, h) = (image.width as i64, image.height as i64);

    // Check bounds - return transparent/black for out-of-bounds
    if x < 0.0 || x >= (w - 1) as f64 || y < 0.0 || y >= (h - 1) as f64 {
        return [0, 0, 0];
    }

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = x0 + 1;
    let y1 = y0 + 1;

    // Fractional distances
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;

    let w = image.width as usize;

    // Get the four corner pixels
    let get_pixel = |px: usize, py: usize| -> [f64; 3] {
        let idx = (py * w + px) * 3;
        [
            image.pixels[idx] as f64,
            image.pixels[idx + 1] as f64,
            image.pixels[idx + 2] as f64,
        ]
    };

    let p00 = get_pixel(x0, y0);
    let p10 = get_pixel(x1, y0);
    let p01 = get_pixel(x0, y1);
    let p11 = get_pixel(x1, y1);

    // Bilinear interpolation formula
    let mut result = [0u8; 3];
    for i in 0..3 {
        let v = p00[i] * (1.0 - fx) * (1.0 - fy)
            + p10[i] * fx * (1.0 - fy)
            + p01[i] * (1.0 - fx) * fy
            + p11[i] * fx * fy;
        result[i] = v.clamp(0.0, 255.0).round() as u8;
    }

    result
}

/// Sample a pixel using Lanczos3 interpolation.
///
/// Lanczos3 considers a 6x6 neighborhood of pixels, providing
/// higher quality results especially for sharp edges.
fn sample_lanczos3(image: &DecodedImage, x: f64, y: f64) -> [u8; 3] {
    let (w, h) = (image.width as i64, image.height as i64);

    // Check bounds with kernel radius - fall back to bilinear near edges
    if x < 2.0 || x >= (w - 3) as f64 || y < 2.0 || y >= (h - 3) as f64 {
        return sample_bilinear(image, x, y);
    }

    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;

    let mut sum = [0.0f64; 3];
    let mut weight_sum = 0.0;

    // Sample 6x6 neighborhood
    for ky in -2..=3 {
        for kx in -2..=3 {
            let px = x0 + kx;
            let py = y0 + ky;

            if px >= 0 && px < w && py >= 0 && py < h {
                let dx = x - px as f64;
                let dy = y - py as f64;
                let weight = lanczos_weight(dx, 3.0) * lanczos_weight(dy, 3.0);

                let idx = ((py as u32 * image.width + px as u32) * 3) as usize;
                sum[0] += image.pixels[idx] as f64 * weight;
                sum[1] += image.pixels[idx + 1] as f64 * weight;
                sum[2] += image.pixels[idx + 2] as f64 * weight;
                weight_sum += weight;
            }
        }
    }

    let mut result = [0u8; 3];
    if weight_sum > 0.0 {
        for i in 0..3 {
            result[i] = (sum[i] / weight_sum).clamp(0.0, 255.0).round() as u8;
        }
    }

    result
}

/// Lanczos kernel weight function.
///
/// The Lanczos kernel is defined as:
/// ```text
/// L(x) = sinc(x) * sinc(x/a)  for |x| < a
/// L(x) = 0                     for |x| >= a
/// ```
///
/// where sinc(x) = sin(πx) / (πx)
fn lanczos_weight(x: f64, a: f64) -> f64 {
    if x.abs() < f64::EPSILON {
        return 1.0;
    }
    if x.abs() >= a {
        return 0.0;
    }

    let pi_x = std::f64::consts::PI * x;
    let pi_x_a = pi_x / a;

    // L(x) = sinc(x) * sinc(x/a)
    // = [sin(πx)/(πx)] * [sin(πx/a)/(πx/a)]
    // = a * sin(πx) * sin(πx/a) / (π²x²)
    (a * pi_x.sin() * pi_x_a.sin()) / (pi_x * pi_x)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a simple test image with a gradient pattern.
    fn test_image(width: u32, height: u32) -> DecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height {
            for x in 0..width {
                let v = ((x + y) * 8) as u8;
                pixels.push(v); // R
                pixels.push(v); // G
                pixels.push(v); // B
            }
        }
        DecodedImage {
            width,
            height,
            pixels,
        }
    }

    #[test]
    fn test_no_rotation() {
        let img = test_image(100, 50);
        let result = apply_rotation(&img, 0.0, InterpolationFilter::Bilinear);

        assert_eq!(result.width, 100);
        assert_eq!(result.height, 50);
        assert_eq!(result.pixels.len(), img.pixels.len());
    }

    #[test]
    fn test_tiny_rotation_fast_path() {
        let img = test_image(100, 50);
        let result = apply_rotation(&img, 0.0001, InterpolationFilter::Bilinear);

        // Should hit fast path
        assert_eq!(result.width, 100);
        assert_eq!(result.height, 50);
    }

    #[test]
    fn test_90_degree_rotation_bounds() {
        let (w, h) = compute_rotated_bounds(100, 50, 90.0);
        assert_eq!(w, 50);
        assert_eq!(h, 100);
    }

    #[test]
    fn test_180_degree_rotation_bounds() {
        let (w, h) = compute_rotated_bounds(100, 50, 180.0);
        assert_eq!(w, 100);
        assert_eq!(h, 50);
    }

    #[test]
    fn test_45_degree_rotation_bounds() {
        let (w, h) = compute_rotated_bounds(100, 100, 45.0);
        // Diagonal of 100x100 square is ~141.4
        assert!(w > 140 && w < 143, "width was {}", w);
        assert!(h > 140 && h < 143, "height was {}", h);
    }

    #[test]
    fn test_negative_rotation_bounds() {
        // Negative and positive rotations should give same bounds
        let (w1, h1) = compute_rotated_bounds(100, 50, 30.0);
        let (w2, h2) = compute_rotated_bounds(100, 50, -30.0);
        assert_eq!(w1, w2);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_rotation_expands_canvas() {
        let img = test_image(100, 100);
        let result = apply_rotation(&img, 45.0, InterpolationFilter::Bilinear);

        // 45-degree rotation should expand the canvas
        assert!(result.width > img.width);
        assert!(result.height > img.height);
    }

    #[test]
    fn test_bilinear_vs_lanczos() {
        let img = test_image(50, 50);

        let bilinear = apply_rotation(&img, 15.0, InterpolationFilter::Bilinear);
        let lanczos = apply_rotation(&img, 15.0, InterpolationFilter::Lanczos3);

        // Both should produce same dimensions
        assert_eq!(bilinear.width, lanczos.width);
        assert_eq!(bilinear.height, lanczos.height);

        // But pixel values may differ slightly
        // (lanczos typically produces sharper results)
    }

    #[test]
    fn test_lanczos_weight_at_zero() {
        let w = lanczos_weight(0.0, 3.0);
        assert!((w - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_lanczos_weight_at_boundary() {
        let w = lanczos_weight(3.0, 3.0);
        assert!(w.abs() < f64::EPSILON);
    }

    #[test]
    fn test_lanczos_weight_symmetry() {
        let w1 = lanczos_weight(1.5, 3.0);
        let w2 = lanczos_weight(-1.5, 3.0);
        assert!((w1 - w2).abs() < 1e-10);
    }

    #[test]
    fn test_small_image_rotation() {
        // Test that small images don't cause panics
        let img = test_image(4, 4);
        let result = apply_rotation(&img, 30.0, InterpolationFilter::Bilinear);
        assert!(result.width > 0);
        assert!(result.height > 0);
    }

    #[test]
    fn test_rectangular_image_rotation() {
        // Test non-square image
        let img = test_image(200, 100);
        let result = apply_rotation(&img, 90.0, InterpolationFilter::Bilinear);

        // After 90-degree rotation, dimensions should swap
        // (accounting for floating point in bounds calculation)
        assert!(
            (result.width as i32 - 100).abs() <= 1,
            "width: {}",
            result.width
        );
        assert!(
            (result.height as i32 - 200).abs() <= 1,
            "height: {}",
            result.height
        );
    }

    #[test]
    fn test_full_rotation() {
        let img = test_image(50, 50);

        // 360-degree rotation should give same dimensions
        let result = apply_rotation(&img, 360.0, InterpolationFilter::Bilinear);
        assert_eq!(result.width, img.width);
        assert_eq!(result.height, img.height);
    }
}
