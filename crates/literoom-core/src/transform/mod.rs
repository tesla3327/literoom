//! Image transformation operations: rotation and cropping.
//!
//! This module provides non-destructive transform operations that are applied
//! in the editing pipeline before adjustments and tone curve processing.
//!
//! # Transform Order
//!
//! When editing an image, transforms are applied in this order:
//! 1. Rotation (main angle + straighten)
//! 2. Crop
//! 3. Basic adjustments
//! 4. Tone curve
//!
//! # Coordinate System
//!
//! - Rotation angles are in degrees, positive = counter-clockwise
//! - Crop coordinates are normalized (0.0 to 1.0) relative to image dimensions
//! - Origin is top-left corner

mod crop;
mod rotation;

pub use crop::apply_crop;
pub use rotation::{apply_rotation, compute_rotated_bounds, InterpolationFilter};
