//! Image resizing functions for thumbnail and preview generation.
//!
//! Provides various resize operations using the `image` crate's algorithms.
//! All functions return new `DecodedImage` instances without modifying the input.

use super::{DecodeError, DecodedImage, FilterType};

/// Resize an image to exact dimensions.
///
/// # Arguments
///
/// * `image` - The source image to resize
/// * `width` - Target width in pixels
/// * `height` - Target height in pixels
/// * `filter` - Interpolation filter to use
///
/// # Returns
///
/// A new `DecodedImage` with the specified dimensions.
///
/// # Errors
///
/// Returns `DecodeError::InvalidFormat` if the source image cannot be converted.
pub fn resize(
    image: &DecodedImage,
    width: u32,
    height: u32,
    filter: FilterType,
) -> Result<DecodedImage, DecodeError> {
    if width == 0 || height == 0 {
        return Err(DecodeError::InvalidFormat);
    }

    // Fast path: if dimensions match, just clone
    if image.width == width && image.height == height {
        return Ok(image.clone());
    }

    let rgb_image = image
        .to_rgb_image()
        .ok_or_else(|| DecodeError::CorruptedFile("Failed to create RgbImage".to_string()))?;

    let resized = image::imageops::resize(&rgb_image, width, height, filter.to_image_filter());

    Ok(DecodedImage::from_rgb_image(resized))
}

/// Resize an image to fit within a maximum edge length while preserving aspect ratio.
///
/// The image is scaled so that its longest edge equals `max_edge`, while
/// maintaining the original aspect ratio. If the image is already smaller
/// than `max_edge`, it is returned unchanged.
///
/// # Arguments
///
/// * `image` - The source image to resize
/// * `max_edge` - Maximum length of the longest edge in pixels
/// * `filter` - Interpolation filter to use
///
/// # Returns
///
/// A new `DecodedImage` that fits within the specified dimensions.
///
/// # Errors
///
/// Returns `DecodeError::InvalidFormat` if the source image cannot be converted.
pub fn resize_to_fit(
    image: &DecodedImage,
    max_edge: u32,
    filter: FilterType,
) -> Result<DecodedImage, DecodeError> {
    if max_edge == 0 {
        return Err(DecodeError::InvalidFormat);
    }

    let (src_width, src_height) = (image.width, image.height);

    // If already fits, just clone
    if src_width <= max_edge && src_height <= max_edge {
        return Ok(image.clone());
    }

    // Calculate new dimensions preserving aspect ratio
    let (new_width, new_height) = calculate_fit_dimensions(src_width, src_height, max_edge);

    resize(image, new_width, new_height, filter)
}

/// Generate a thumbnail optimized for grid display.
///
/// Uses bilinear interpolation for speed. The resulting image will fit
/// within a `size x size` bounding box while preserving aspect ratio.
///
/// # Arguments
///
/// * `image` - The source image
/// * `size` - Maximum thumbnail dimension (typically 256 for grid thumbnails)
///
/// # Returns
///
/// A new `DecodedImage` sized for thumbnail display.
///
/// # Errors
///
/// Returns `DecodeError::InvalidFormat` if the source image cannot be converted.
pub fn generate_thumbnail(image: &DecodedImage, size: u32) -> Result<DecodedImage, DecodeError> {
    // Use bilinear for thumbnails - good balance of speed and quality
    resize_to_fit(image, size, FilterType::Bilinear)
}

/// Calculate dimensions to fit within max_edge while preserving aspect ratio.
fn calculate_fit_dimensions(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (0, 0);
    }

    let ratio = width as f64 / height as f64;

    if width >= height {
        // Landscape or square: constrain by width
        let new_width = max_edge;
        let new_height = (max_edge as f64 / ratio).round() as u32;
        (new_width, new_height.max(1))
    } else {
        // Portrait: constrain by height
        let new_height = max_edge;
        let new_width = (max_edge as f64 * ratio).round() as u32;
        (new_width.max(1), new_height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_image(width: u32, height: u32) -> DecodedImage {
        // Create a simple gradient image for testing
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height {
            for x in 0..width {
                pixels.push(((x * 255) / width.max(1)) as u8); // R
                pixels.push(((y * 255) / height.max(1)) as u8); // G
                pixels.push(128); // B
            }
        }
        DecodedImage::new(width, height, pixels)
    }

    #[test]
    fn test_resize_basic() {
        let img = create_test_image(100, 50);
        let resized = resize(&img, 50, 25, FilterType::Bilinear).unwrap();

        assert_eq!(resized.width, 50);
        assert_eq!(resized.height, 25);
        assert_eq!(resized.pixels.len(), 50 * 25 * 3);
    }

    #[test]
    fn test_resize_same_dimensions() {
        let img = create_test_image(100, 50);
        let resized = resize(&img, 100, 50, FilterType::Bilinear).unwrap();

        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_upscale() {
        let img = create_test_image(50, 25);
        let resized = resize(&img, 100, 50, FilterType::Lanczos3).unwrap();

        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_zero_dimensions_error() {
        let img = create_test_image(100, 50);

        assert!(resize(&img, 0, 50, FilterType::Bilinear).is_err());
        assert!(resize(&img, 50, 0, FilterType::Bilinear).is_err());
    }

    #[test]
    fn test_resize_to_fit_landscape() {
        let img = create_test_image(6000, 4000);
        let resized = resize_to_fit(&img, 2560, FilterType::Lanczos3).unwrap();

        // Width should be 2560, height scaled proportionally
        assert_eq!(resized.width, 2560);
        assert_eq!(resized.height, 1707); // 4000 * (2560/6000) ≈ 1707
    }

    #[test]
    fn test_resize_to_fit_portrait() {
        let img = create_test_image(4000, 6000);
        let resized = resize_to_fit(&img, 2560, FilterType::Lanczos3).unwrap();

        // Height should be 2560, width scaled proportionally
        assert_eq!(resized.height, 2560);
        assert_eq!(resized.width, 1707); // 4000 * (2560/6000) ≈ 1707
    }

    #[test]
    fn test_resize_to_fit_square() {
        let img = create_test_image(4000, 4000);
        let resized = resize_to_fit(&img, 256, FilterType::Bilinear).unwrap();

        assert_eq!(resized.width, 256);
        assert_eq!(resized.height, 256);
    }

    #[test]
    fn test_resize_to_fit_already_smaller() {
        let img = create_test_image(100, 50);
        let resized = resize_to_fit(&img, 256, FilterType::Bilinear).unwrap();

        // Should return same dimensions when already smaller
        assert_eq!(resized.width, 100);
        assert_eq!(resized.height, 50);
    }

    #[test]
    fn test_resize_to_fit_zero_max_edge_error() {
        let img = create_test_image(100, 50);
        assert!(resize_to_fit(&img, 0, FilterType::Bilinear).is_err());
    }

    #[test]
    fn test_generate_thumbnail() {
        let img = create_test_image(6000, 4000);
        let thumb = generate_thumbnail(&img, 256).unwrap();

        // Should fit within 256x256
        assert!(thumb.width <= 256);
        assert!(thumb.height <= 256);
        // One dimension should be exactly 256
        assert!(thumb.width == 256 || thumb.height == 256);
    }

    #[test]
    fn test_generate_thumbnail_small_image() {
        let img = create_test_image(100, 50);
        let thumb = generate_thumbnail(&img, 256).unwrap();

        // Small images should not be upscaled
        assert_eq!(thumb.width, 100);
        assert_eq!(thumb.height, 50);
    }

    #[test]
    fn test_calculate_fit_dimensions_landscape() {
        let (w, h) = calculate_fit_dimensions(6000, 4000, 2560);
        assert_eq!(w, 2560);
        assert_eq!(h, 1707);
    }

    #[test]
    fn test_calculate_fit_dimensions_portrait() {
        let (w, h) = calculate_fit_dimensions(4000, 6000, 2560);
        assert_eq!(w, 1707);
        assert_eq!(h, 2560);
    }

    #[test]
    fn test_calculate_fit_dimensions_square() {
        let (w, h) = calculate_fit_dimensions(4000, 4000, 256);
        assert_eq!(w, 256);
        assert_eq!(h, 256);
    }

    #[test]
    fn test_calculate_fit_dimensions_zero_input() {
        let (w, h) = calculate_fit_dimensions(0, 0, 256);
        assert_eq!(w, 0);
        assert_eq!(h, 0);
    }

    #[test]
    fn test_all_filter_types() {
        let img = create_test_image(100, 50);

        for filter in [
            FilterType::Nearest,
            FilterType::Bilinear,
            FilterType::Lanczos3,
        ] {
            let resized = resize(&img, 50, 25, filter).unwrap();
            assert_eq!(resized.width, 50);
            assert_eq!(resized.height, 25);
        }
    }
}
