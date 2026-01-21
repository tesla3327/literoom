//! Literoom Core - Image processing library
//!
//! This crate provides the core image processing functionality for Literoom,
//! including RAW decoding, edit pipeline, histogram computation, and more.

pub mod adjustments;
pub mod curve;
pub mod decode;
pub mod histogram;
pub mod transform;

pub use curve::{apply_tone_curve, evaluate_curve, ToneCurveLut};
pub use transform::{apply_crop, apply_rotation, compute_rotated_bounds, InterpolationFilter};

/// Basic adjustments for image editing
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BasicAdjustments {
    /// White balance temperature (-100 to 100)
    pub temperature: f32,
    /// White balance tint (-100 to 100)
    pub tint: f32,
    /// Exposure adjustment (-5 to 5 stops)
    pub exposure: f32,
    /// Contrast (-100 to 100)
    pub contrast: f32,
    /// Highlights (-100 to 100)
    pub highlights: f32,
    /// Shadows (-100 to 100)
    pub shadows: f32,
    /// Whites (-100 to 100)
    pub whites: f32,
    /// Blacks (-100 to 100)
    pub blacks: f32,
    /// Vibrance (-100 to 100)
    pub vibrance: f32,
    /// Saturation (-100 to 100)
    pub saturation: f32,
}

impl BasicAdjustments {
    /// Create a new BasicAdjustments with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if all values are at their defaults
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// Tone curve control point
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct CurvePoint {
    /// Input value (0.0 to 1.0)
    pub x: f32,
    /// Output value (0.0 to 1.0)
    pub y: f32,
}

impl CurvePoint {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

/// Tone curve with control points
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToneCurve {
    /// Control points for the curve (sorted by x)
    pub points: Vec<CurvePoint>,
}

impl Default for ToneCurve {
    fn default() -> Self {
        Self {
            // Linear curve by default
            points: vec![CurvePoint::new(0.0, 0.0), CurvePoint::new(1.0, 1.0)],
        }
    }
}

impl ToneCurve {
    /// Create a new linear tone curve
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if the curve is linear (no adjustment)
    pub fn is_linear(&self) -> bool {
        if self.points.len() != 2 {
            return false;
        }
        let first = &self.points[0];
        let last = &self.points[1];
        (first.x - 0.0).abs() < f32::EPSILON
            && (first.y - 0.0).abs() < f32::EPSILON
            && (last.x - 1.0).abs() < f32::EPSILON
            && (last.y - 1.0).abs() < f32::EPSILON
    }
}

/// Histogram data for an image
#[derive(Debug, Clone)]
pub struct Histogram {
    /// Red channel histogram (256 bins)
    pub red: [u32; 256],
    /// Green channel histogram (256 bins)
    pub green: [u32; 256],
    /// Blue channel histogram (256 bins)
    pub blue: [u32; 256],
    /// Luminance histogram (256 bins)
    pub luminance: [u32; 256],
}

impl Default for Histogram {
    fn default() -> Self {
        Self {
            red: [0; 256],
            green: [0; 256],
            blue: [0; 256],
            luminance: [0; 256],
        }
    }
}

impl Histogram {
    /// Create a new empty histogram
    pub fn new() -> Self {
        Self::default()
    }

    /// Find the maximum value across all channels for normalization
    pub fn max_value(&self) -> u32 {
        let max_r = *self.red.iter().max().unwrap_or(&0);
        let max_g = *self.green.iter().max().unwrap_or(&0);
        let max_b = *self.blue.iter().max().unwrap_or(&0);
        max_r.max(max_g).max(max_b)
    }

    /// Check for highlight clipping (values at 255)
    pub fn has_highlight_clipping(&self) -> bool {
        self.red[255] > 0 || self.green[255] > 0 || self.blue[255] > 0
    }

    /// Check for shadow clipping (values at 0)
    pub fn has_shadow_clipping(&self) -> bool {
        self.red[0] > 0 || self.green[0] > 0 || self.blue[0] > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_adjustments_default() {
        let adj = BasicAdjustments::new();
        assert!(adj.is_default());
    }

    #[test]
    fn test_basic_adjustments_not_default() {
        let mut adj = BasicAdjustments::new();
        adj.exposure = 1.0;
        assert!(!adj.is_default());
    }

    #[test]
    fn test_tone_curve_linear() {
        let curve = ToneCurve::new();
        assert!(curve.is_linear());
    }

    #[test]
    fn test_tone_curve_not_linear() {
        let mut curve = ToneCurve::new();
        curve.points.push(CurvePoint::new(0.5, 0.6));
        assert!(!curve.is_linear());
    }

    #[test]
    fn test_histogram_clipping() {
        let mut hist = Histogram::new();
        assert!(!hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());

        hist.red[255] = 100;
        assert!(hist.has_highlight_clipping());

        hist.blue[0] = 50;
        assert!(hist.has_shadow_clipping());
    }
}
