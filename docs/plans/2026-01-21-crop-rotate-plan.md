# Phase 12: Crop/Rotate/Straighten - Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [Crop/Rotate/Straighten Synthesis](../research/2026-01-21-crop-rotate-synthesis.md)

---

## Overview

Phase 12 implements crop, rotate, and straighten functionality for the photo editing view. This allows users to reframe their images by cropping to specific regions, rotating to arbitrary angles, and using a straighten tool to level horizons.

**Goal**: Users can crop images with aspect ratio presets, rotate images with precise angle control, and use a straighten tool to draw a horizon line that automatically calculates the rotation needed to level the image.

---

## Implementation Phases

### Phase 12.1: TypeScript Types and Utilities

**Goal**: Define the data structures for crop/transform state.

#### 12.1.1 Update `packages/core/src/catalog/types.ts`

Add crop and rotation types:

```typescript
// ============================================================================
// Crop/Transform Types
// ============================================================================

/**
 * Crop rectangle in normalized coordinates (0-1).
 * Origin is top-left of the image.
 */
export interface CropRectangle {
  /** Left edge position (0-1) */
  left: number
  /** Top edge position (0-1) */
  top: number
  /** Width of crop region (0-1) */
  width: number
  /** Height of crop region (0-1) */
  height: number
}

/**
 * Rotation parameters.
 */
export interface RotationParameters {
  /** Main rotation angle in degrees (-180 to 180) */
  angle: number
  /** Additional straighten angle in degrees (typically small, -45 to 45) */
  straighten: number
}

/**
 * Combined crop and transform state.
 * Transform order: Rotate -> Crop -> Adjustments -> Tone Curve
 */
export interface CropTransform {
  /** Crop region, or null for no crop (full image) */
  crop: CropRectangle | null
  /** Rotation parameters */
  rotation: RotationParameters
}

/**
 * Default crop transform (no crop, no rotation).
 */
export const DEFAULT_CROP_TRANSFORM: Readonly<CropTransform> = Object.freeze({
  crop: null,
  rotation: Object.freeze({ angle: 0, straighten: 0 }),
})

/**
 * Check if crop transform differs from default.
 */
export function isModifiedCropTransform(transform: CropTransform): boolean {
  // Check rotation
  if (transform.rotation.angle !== 0 || transform.rotation.straighten !== 0) {
    return true
  }
  // Check crop
  if (transform.crop !== null) {
    return true
  }
  return false
}

/**
 * Get total rotation angle (main + straighten).
 */
export function getTotalRotation(rotation: RotationParameters): number {
  return rotation.angle + rotation.straighten
}

/**
 * Validate crop rectangle bounds.
 * Returns true if valid, false otherwise.
 */
export function validateCropRectangle(crop: CropRectangle): boolean {
  if (crop.left < 0 || crop.left > 1) return false
  if (crop.top < 0 || crop.top > 1) return false
  if (crop.width <= 0 || crop.width > 1) return false
  if (crop.height <= 0 || crop.height > 1) return false
  if (crop.left + crop.width > 1.001) return false // Small tolerance
  if (crop.top + crop.height > 1.001) return false
  return true
}
```

#### 12.1.2 Update `packages/core/src/catalog/types.ts` - EditState

Extend EditState with cropTransform:

```typescript
export const EDIT_SCHEMA_VERSION = 3  // Bump from 2

export interface EditState {
  version: typeof EDIT_SCHEMA_VERSION
  adjustments: Adjustments
  toneCurve: ToneCurve
  cropTransform: CropTransform
}
```

#### 12.1.3 Update `packages/core/src/catalog/index.ts`

Export new types:

```typescript
export type { CropRectangle, RotationParameters, CropTransform } from './types'
export {
  DEFAULT_CROP_TRANSFORM,
  isModifiedCropTransform,
  getTotalRotation,
  validateCropRectangle,
} from './types'
```

#### 12.1.4 Verification

- [ ] `pnpm check:types` passes
- [ ] New types exported from package
- [ ] Unit tests for utility functions added

---

### Phase 12.2: Edit Store Extensions

**Goal**: Add crop/transform state management to the edit store.

#### 12.2.1 Update `apps/web/app/stores/edit.ts`

Add cropTransform state and actions:

```typescript
// State
const cropTransform = ref<CropTransform>({ ...DEFAULT_CROP_TRANSFORM })

// Actions
/**
 * Set complete crop transform.
 */
function setCropTransform(transform: CropTransform): void {
  cropTransform.value = {
    crop: transform.crop ? { ...transform.crop } : null,
    rotation: { ...transform.rotation },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Set crop rectangle only.
 */
function setCrop(crop: CropRectangle | null): void {
  cropTransform.value = {
    ...cropTransform.value,
    crop: crop ? { ...crop } : null,
  }
  isDirty.value = true
  error.value = null
}

/**
 * Set rotation parameters only.
 */
function setRotation(rotation: RotationParameters): void {
  cropTransform.value = {
    ...cropTransform.value,
    rotation: { ...rotation },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Set main rotation angle (preserving straighten).
 */
function setRotationAngle(angle: number): void {
  cropTransform.value = {
    ...cropTransform.value,
    rotation: {
      ...cropTransform.value.rotation,
      angle,
    },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Set straighten angle (preserving main rotation).
 */
function setStraightenAngle(straighten: number): void {
  cropTransform.value = {
    ...cropTransform.value,
    rotation: {
      ...cropTransform.value.rotation,
      straighten,
    },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Reset crop transform to default.
 */
function resetCropTransform(): void {
  cropTransform.value = { ...DEFAULT_CROP_TRANSFORM }
  isDirty.value = true
  error.value = null
}

// Update hasModifications computed
const hasModifications = computed(() => {
  return (
    isModifiedAdjustments(adjustments.value) ||
    isModifiedToneCurve(toneCurve.value) ||
    isModifiedCropTransform(cropTransform.value)
  )
})

// Update reset function
function reset(): void {
  adjustments.value = { ...DEFAULT_ADJUSTMENTS }
  toneCurve.value = { ...DEFAULT_TONE_CURVE }
  cropTransform.value = { ...DEFAULT_CROP_TRANSFORM }
  isDirty.value = false
  error.value = null
}

// Export in return statement
return {
  // ... existing exports ...
  cropTransform: readonly(cropTransform),
  setCropTransform,
  setCrop,
  setRotation,
  setRotationAngle,
  setStraightenAngle,
  resetCropTransform,
}
```

#### 12.2.2 Verification

- [ ] Store compiles
- [ ] Actions work correctly
- [ ] hasModifications includes cropTransform

---

### Phase 12.3: Rust Transform Module

**Goal**: Implement image rotation and crop in Rust for performance.

#### 12.3.1 Create `crates/literoom-core/src/transform/mod.rs`

```rust
//! Image transformation operations: rotation and cropping.

mod crop;
mod rotation;

pub use crop::apply_crop;
pub use rotation::{apply_rotation, compute_rotated_bounds, InterpolationFilter};
```

#### 12.3.2 Create `crates/literoom-core/src/transform/rotation.rs`

```rust
//! Image rotation with bilinear and lanczos3 interpolation.

use crate::DecodedImage;

/// Interpolation filter for rotation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterpolationFilter {
    /// Fast, good for preview
    Bilinear,
    /// High quality, good for export
    Lanczos3,
}

/// Compute dimensions of rotated image.
pub fn compute_rotated_bounds(width: u32, height: u32, angle_degrees: f64) -> (u32, u32) {
    if angle_degrees.abs() < f64::EPSILON {
        return (width, height);
    }

    let angle_rad = angle_degrees.to_radians();
    let cos = angle_rad.cos().abs();
    let sin = angle_rad.sin().abs();

    let w = width as f64;
    let h = height as f64;

    let new_w = (w * cos + h * sin).ceil() as u32;
    let new_h = (w * sin + h * cos).ceil() as u32;

    (new_w, new_h)
}

/// Apply rotation to an image.
///
/// # Arguments
/// * `image` - Source image
/// * `angle_degrees` - Rotation angle (positive = counter-clockwise)
/// * `filter` - Interpolation method
///
/// # Returns
/// New rotated image with expanded canvas to fit rotated content.
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

    let angle_rad = -angle_degrees.to_radians(); // Negate for correct rotation direction
    let cos = angle_rad.cos();
    let sin = angle_rad.sin();

    // Center of source and destination
    let src_cx = src_w / 2.0;
    let src_cy = src_h / 2.0;
    let dst_cx = dst_w as f64 / 2.0;
    let dst_cy = dst_h as f64 / 2.0;

    let mut output = vec![0u8; (dst_w * dst_h * 3) as usize];

    for dst_y in 0..dst_h {
        for dst_x in 0..dst_w {
            // Translate to center
            let dx = dst_x as f64 - dst_cx;
            let dy = dst_y as f64 - dst_cy;

            // Inverse rotation
            let src_x = dx * cos - dy * sin + src_cx;
            let src_y = dx * sin + dy * cos + src_cy;

            let dst_idx = ((dst_y * dst_w + dst_x) * 3) as usize;

            // Sample pixel
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

/// Bilinear interpolation sampling.
fn sample_bilinear(image: &DecodedImage, x: f64, y: f64) -> [u8; 3] {
    let (w, h) = (image.width as i64, image.height as i64);

    // Check bounds
    if x < 0.0 || x >= (w - 1) as f64 || y < 0.0 || y >= (h - 1) as f64 {
        return [0, 0, 0]; // Transparent/black for out of bounds
    }

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = x0 + 1;
    let y1 = y0 + 1;

    let fx = x - x0 as f64;
    let fy = y - y0 as f64;

    let w = image.width as usize;

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

/// Lanczos3 interpolation sampling (higher quality).
fn sample_lanczos3(image: &DecodedImage, x: f64, y: f64) -> [u8; 3] {
    let (w, h) = (image.width as i64, image.height as i64);

    // Check bounds (with kernel radius)
    if x < 2.0 || x >= (w - 3) as f64 || y < 2.0 || y >= (h - 3) as f64 {
        // Fall back to bilinear near edges
        return sample_bilinear(image, x, y);
    }

    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;

    let mut sum = [0.0f64; 3];
    let mut weight_sum = 0.0;

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
fn lanczos_weight(x: f64, a: f64) -> f64 {
    if x.abs() < f64::EPSILON {
        return 1.0;
    }
    if x.abs() >= a {
        return 0.0;
    }
    let pi_x = std::f64::consts::PI * x;
    let pi_x_a = pi_x / a;
    (a * pi_x.sin() * pi_x_a.sin()) / (pi_x * pi_x)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_image() -> DecodedImage {
        // 4x4 gradient image
        let mut pixels = Vec::with_capacity(4 * 4 * 3);
        for y in 0..4 {
            for x in 0..4 {
                let v = ((x + y) * 32) as u8;
                pixels.push(v);
                pixels.push(v);
                pixels.push(v);
            }
        }
        DecodedImage {
            width: 4,
            height: 4,
            pixels,
        }
    }

    #[test]
    fn test_no_rotation() {
        let img = test_image();
        let result = apply_rotation(&img, 0.0, InterpolationFilter::Bilinear);
        assert_eq!(result.width, 4);
        assert_eq!(result.height, 4);
        assert_eq!(result.pixels.len(), img.pixels.len());
    }

    #[test]
    fn test_90_degree_rotation_bounds() {
        let (w, h) = compute_rotated_bounds(100, 50, 90.0);
        assert_eq!(w, 50);
        assert_eq!(h, 100);
    }

    #[test]
    fn test_45_degree_rotation_bounds() {
        let (w, h) = compute_rotated_bounds(100, 100, 45.0);
        // Diagonal of 100x100 square is ~141.4
        assert!(w > 140 && w < 143);
        assert!(h > 140 && h < 143);
    }

    #[test]
    fn test_rotation_preserves_content() {
        let img = test_image();
        let result = apply_rotation(&img, 45.0, InterpolationFilter::Bilinear);
        // Should be larger due to expanded canvas
        assert!(result.width >= img.width);
        assert!(result.height >= img.height);
    }
}
```

#### 12.3.3 Create `crates/literoom-core/src/transform/crop.rs`

```rust
//! Image cropping operations.

use crate::DecodedImage;

/// Apply crop to an image using normalized coordinates.
///
/// # Arguments
/// * `image` - Source image
/// * `left` - Left edge (0-1)
/// * `top` - Top edge (0-1)
/// * `width` - Crop width (0-1)
/// * `height` - Crop height (0-1)
///
/// # Returns
/// Cropped image region.
pub fn apply_crop(
    image: &DecodedImage,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
) -> DecodedImage {
    // Convert normalized to pixel coordinates
    let src_w = image.width as f64;
    let src_h = image.height as f64;

    let px_left = (left * src_w).round() as u32;
    let px_top = (top * src_h).round() as u32;
    let px_width = (width * src_w).round() as u32;
    let px_height = (height * src_h).round() as u32;

    // Clamp to image bounds
    let px_left = px_left.min(image.width.saturating_sub(1));
    let px_top = px_top.min(image.height.saturating_sub(1));
    let px_right = (px_left + px_width).min(image.width);
    let px_bottom = (px_top + px_height).min(image.height);

    let out_width = px_right.saturating_sub(px_left).max(1);
    let out_height = px_bottom.saturating_sub(px_top).max(1);

    let mut output = vec![0u8; (out_width * out_height * 3) as usize];

    for y in 0..out_height {
        let src_y = px_top + y;
        let src_row_start = (src_y * image.width * 3) as usize;
        let dst_row_start = (y * out_width * 3) as usize;

        for x in 0..out_width {
            let src_x = px_left + x;
            let src_idx = src_row_start + (src_x * 3) as usize;
            let dst_idx = dst_row_start + (x * 3) as usize;

            output[dst_idx] = image.pixels[src_idx];
            output[dst_idx + 1] = image.pixels[src_idx + 1];
            output[dst_idx + 2] = image.pixels[src_idx + 2];
        }
    }

    DecodedImage {
        width: out_width,
        height: out_height,
        pixels: output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_image() -> DecodedImage {
        // 10x10 image with unique values per pixel
        let mut pixels = Vec::with_capacity(10 * 10 * 3);
        for y in 0..10 {
            for x in 0..10 {
                let v = (y * 10 + x) as u8;
                pixels.push(v);
                pixels.push(v);
                pixels.push(v);
            }
        }
        DecodedImage {
            width: 10,
            height: 10,
            pixels,
        }
    }

    #[test]
    fn test_full_crop() {
        let img = test_image();
        let result = apply_crop(&img, 0.0, 0.0, 1.0, 1.0);
        assert_eq!(result.width, 10);
        assert_eq!(result.height, 10);
    }

    #[test]
    fn test_half_crop() {
        let img = test_image();
        let result = apply_crop(&img, 0.0, 0.0, 0.5, 0.5);
        assert_eq!(result.width, 5);
        assert_eq!(result.height, 5);
    }

    #[test]
    fn test_center_crop() {
        let img = test_image();
        let result = apply_crop(&img, 0.25, 0.25, 0.5, 0.5);
        assert_eq!(result.width, 5);
        assert_eq!(result.height, 5);
        // Check first pixel is from (2, 2) of source
        assert_eq!(result.pixels[0], 22);
    }

    #[test]
    fn test_crop_clamps_to_bounds() {
        let img = test_image();
        let result = apply_crop(&img, 0.8, 0.8, 0.5, 0.5);
        // Should clamp to available pixels
        assert!(result.width <= 10);
        assert!(result.height <= 10);
    }
}
```

#### 12.3.4 Update `crates/literoom-core/src/lib.rs`

Add module export:

```rust
pub mod transform;
pub use transform::{apply_crop, apply_rotation, compute_rotated_bounds, InterpolationFilter};
```

#### 12.3.5 Verification

- [ ] `cargo test -p literoom-core` passes
- [ ] `cargo clippy -p literoom-core` has no warnings
- [ ] `cargo fmt --check` passes

---

### Phase 12.4: WASM Bindings

**Goal**: Expose transform functions to JavaScript via WASM.

#### 12.4.1 Create `crates/literoom-wasm/src/transform.rs`

```rust
//! WASM bindings for image transformation operations.

use crate::types::JsDecodedImage;
use literoom_core::transform::{
    apply_crop as core_crop, apply_rotation as core_rotate, InterpolationFilter,
};
use wasm_bindgen::prelude::*;

/// Apply rotation to an image.
///
/// # Arguments
/// * `image` - Source image
/// * `angle_degrees` - Rotation angle (positive = counter-clockwise)
/// * `use_lanczos` - Use high-quality Lanczos3 filter (slower), otherwise bilinear
#[wasm_bindgen]
pub fn apply_rotation(image: &JsDecodedImage, angle_degrees: f64, use_lanczos: bool) -> JsDecodedImage {
    let src = image.to_decoded_image();
    let filter = if use_lanczos {
        InterpolationFilter::Lanczos3
    } else {
        InterpolationFilter::Bilinear
    };

    let result = core_rotate(&src, angle_degrees, filter);
    JsDecodedImage::new(result.width, result.height, result.pixels)
}

/// Apply crop to an image using normalized coordinates.
///
/// # Arguments
/// * `image` - Source image
/// * `left` - Left edge (0-1)
/// * `top` - Top edge (0-1)
/// * `width` - Crop width (0-1)
/// * `height` - Crop height (0-1)
#[wasm_bindgen]
pub fn apply_crop(
    image: &JsDecodedImage,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
) -> JsDecodedImage {
    let src = image.to_decoded_image();
    let result = core_crop(&src, left, top, width, height);
    JsDecodedImage::new(result.width, result.height, result.pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_image() -> JsDecodedImage {
        let pixels: Vec<u8> = (0..100 * 100 * 3).map(|i| (i % 256) as u8).collect();
        JsDecodedImage::new(100, 100, pixels)
    }

    #[test]
    fn test_rotation_wasm() {
        let img = test_image();
        let result = apply_rotation(&img, 45.0, false);
        assert!(result.width() >= 100);
        assert!(result.height() >= 100);
    }

    #[test]
    fn test_crop_wasm() {
        let img = test_image();
        let result = apply_crop(&img, 0.25, 0.25, 0.5, 0.5);
        assert_eq!(result.width(), 50);
        assert_eq!(result.height(), 50);
    }
}
```

#### 12.4.2 Update `crates/literoom-wasm/src/lib.rs`

Add module and exports:

```rust
mod transform;

pub use transform::{apply_crop, apply_rotation};
```

#### 12.4.3 Build WASM

```bash
pnpm wasm:build
```

#### 12.4.4 Verification

- [ ] WASM builds without errors
- [ ] TypeScript types include `apply_rotation` function
- [ ] TypeScript types include `apply_crop` function
- [ ] `cargo test -p literoom-wasm` passes

---

### Phase 12.5: Worker Integration

**Goal**: Add worker message handlers for transform operations.

#### 12.5.1 Update `packages/core/src/decode/worker-messages.ts`

Add message types:

```typescript
/**
 * Request to apply rotation to pixels.
 */
export interface ApplyRotationRequest {
  type: 'apply-rotation'
  id: string
  pixels: Uint8Array
  width: number
  height: number
  angleDegrees: number
  useLanczos: boolean
}

/**
 * Request to apply crop to pixels.
 */
export interface ApplyCropRequest {
  type: 'apply-crop'
  id: string
  pixels: Uint8Array
  width: number
  height: number
  left: number
  top: number
  cropWidth: number
  cropHeight: number
}

// Update DecodeRequest union
export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest
  | ApplyAdjustmentsRequest
  | ComputeHistogramRequest
  | ApplyToneCurveRequest
  | ApplyRotationRequest   // ADD
  | ApplyCropRequest       // ADD
```

#### 12.5.2 Update `packages/core/src/decode/decode-worker.ts`

Add handler cases:

```typescript
case 'apply-rotation': {
  const { pixels, width, height, angleDegrees, useLanczos } = request

  const image = new wasm.JsDecodedImage(width, height, pixels)
  const result = wasm.apply_rotation(image, angleDegrees, useLanczos)

  const outputPixels = result.pixels()
  const outputWidth = result.width()
  const outputHeight = result.height()

  image.free()
  result.free()

  const response: DecodeSuccessResponse = {
    id: request.id,
    type: 'decode-success',
    pixels: outputPixels,
    width: outputWidth,
    height: outputHeight,
  }

  self.postMessage(response, [outputPixels.buffer])
  break
}

case 'apply-crop': {
  const { pixels, width, height, left, top, cropWidth, cropHeight } = request

  const image = new wasm.JsDecodedImage(width, height, pixels)
  const result = wasm.apply_crop(image, left, top, cropWidth, cropHeight)

  const outputPixels = result.pixels()
  const outputWidth = result.width()
  const outputHeight = result.height()

  image.free()
  result.free()

  const response: DecodeSuccessResponse = {
    id: request.id,
    type: 'decode-success',
    pixels: outputPixels,
    width: outputWidth,
    height: outputHeight,
  }

  self.postMessage(response, [outputPixels.buffer])
  break
}
```

#### 12.5.3 Update `packages/core/src/decode/decode-service.ts`

Add interface methods:

```typescript
// In IDecodeService interface
applyRotation(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
  useLanczos?: boolean,
): Promise<{ pixels: Uint8Array; width: number; height: number }>

applyCrop(
  pixels: Uint8Array,
  width: number,
  height: number,
  crop: { left: number; top: number; width: number; height: number },
): Promise<{ pixels: Uint8Array; width: number; height: number }>

// In DecodeService class
async applyRotation(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
  useLanczos = false,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const request: ApplyRotationRequest = {
    id: crypto.randomUUID(),
    type: 'apply-rotation',
    pixels,
    width,
    height,
    angleDegrees,
    useLanczos,
  }
  return this.sendRequest(request)
}

async applyCrop(
  pixels: Uint8Array,
  width: number,
  height: number,
  crop: { left: number; top: number; width: number; height: number },
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const request: ApplyCropRequest = {
    id: crypto.randomUUID(),
    type: 'apply-crop',
    pixels,
    width,
    height,
    left: crop.left,
    top: crop.top,
    cropWidth: crop.width,
    cropHeight: crop.height,
  }
  return this.sendRequest(request)
}
```

#### 12.5.4 Update `packages/core/src/decode/mock-decode-service.ts`

Add mock implementations:

```typescript
async applyRotation(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
  useLanczos = false,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  await this.delay(this.options.thumbnailDelay ?? 50)

  // For small rotations, return same dimensions
  // For 90/180/270, swap dimensions appropriately
  const absAngle = Math.abs(angleDegrees) % 180
  const swap = absAngle > 45 && absAngle < 135

  return {
    pixels: new Uint8Array(pixels),
    width: swap ? height : width,
    height: swap ? width : height,
  }
}

async applyCrop(
  pixels: Uint8Array,
  width: number,
  height: number,
  crop: { left: number; top: number; width: number; height: number },
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  await this.delay(this.options.thumbnailDelay ?? 10)

  const newWidth = Math.round(width * crop.width)
  const newHeight = Math.round(height * crop.height)

  // Just return resized buffer (mock doesn't need to actually crop)
  return {
    pixels: new Uint8Array(newWidth * newHeight * 3),
    width: newWidth,
    height: newHeight,
  }
}
```

#### 12.5.5 Verification

- [ ] Worker handles apply-rotation messages
- [ ] Worker handles apply-crop messages
- [ ] Service methods compile
- [ ] Mock service provides reasonable mock data

---

### Phase 12.6: Preview Pipeline Integration

**Goal**: Integrate transforms into the preview rendering pipeline.

#### 12.6.1 Update `apps/web/app/composables/useEditPreview.ts`

Add rotation and crop steps to the render pipeline:

```typescript
async function renderPreview(): Promise<void> {
  // ... existing validation code ...

  let currentPixels = sourcePixels
  let currentWidth = sourceWidth
  let currentHeight = sourceHeight

  // STEP 1: Apply rotation (if needed)
  const totalRotation = getTotalRotation(editStore.cropTransform.rotation)
  if (Math.abs(totalRotation) > 0.001) {
    const rotated = await $decodeService.applyRotation(
      currentPixels,
      currentWidth,
      currentHeight,
      totalRotation,
      false, // Use bilinear for preview
    )
    currentPixels = rotated.pixels
    currentWidth = rotated.width
    currentHeight = rotated.height
  }

  // STEP 2: Apply crop (if needed)
  const crop = editStore.cropTransform.crop
  if (crop) {
    const cropped = await $decodeService.applyCrop(
      currentPixels,
      currentWidth,
      currentHeight,
      crop,
    )
    currentPixels = cropped.pixels
    currentWidth = cropped.width
    currentHeight = cropped.height
  }

  // STEP 3: Apply adjustments
  const adjustedResult = await $decodeService.applyAdjustments(/* ... */)
  currentPixels = adjustedResult.pixels

  // STEP 4: Apply tone curve (if modified)
  // ... existing tone curve code ...

  // Convert to blob URL
  // ...
}

// Watch cropTransform for re-renders
watch(
  () => editStore.cropTransform,
  () => debouncedRender(),
  { deep: true },
)
```

#### 12.6.2 Verification

- [ ] Preview updates when rotation changes
- [ ] Preview updates when crop changes
- [ ] Transform order is Rotate -> Crop -> Adjustments -> Tone Curve

---

### Phase 12.7: Crop Editor UI

**Goal**: Create the interactive crop editor component.

#### 12.7.1 Create `apps/web/app/composables/useCropEditor.ts`

```typescript
/**
 * useCropEditor Composable
 *
 * Manages crop overlay interaction and rendering:
 * - Canvas overlay with crop region visualization
 * - Drag handles for resizing crop
 * - Aspect ratio constraints
 * - Coordinate conversions
 */

import type { Ref } from 'vue'
import type { CropRectangle } from '@literoom/core/catalog'

// Aspect ratio presets
export const ASPECT_PRESETS = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' as const },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
] as const

export type AspectPreset = (typeof ASPECT_PRESETS)[number]['value']

export interface UseCropEditorOptions {
  canvasRef: Ref<HTMLCanvasElement | null>
  imageWidth: Ref<number>
  imageHeight: Ref<number>
}

export function useCropEditor(options: UseCropEditorOptions) {
  const editStore = useEditStore()
  const { canvasRef, imageWidth, imageHeight } = options

  // Local state (UI-only, not persisted)
  const aspectRatio = ref<AspectPreset>(null)
  const isLocked = ref(false)
  const isDragging = ref(false)
  const dragType = ref<'move' | 'resize' | null>(null)
  const activeHandle = ref<string | null>(null)

  // Local crop state (synced with store)
  const localCrop = ref<CropRectangle>({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  })

  // Handle positions: nw, n, ne, e, se, s, sw, w
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
  type HandlePosition = (typeof HANDLES)[number]

  // Initialize from store
  watch(
    () => editStore.cropTransform.crop,
    (storeCrop) => {
      if (storeCrop) {
        localCrop.value = { ...storeCrop }
      } else {
        localCrop.value = { left: 0, top: 0, width: 1, height: 1 }
      }
    },
    { immediate: true },
  )

  // Computed
  const originalAspectRatio = computed(() => {
    if (imageWidth.value && imageHeight.value) {
      return imageWidth.value / imageHeight.value
    }
    return 1
  })

  const effectiveAspectRatio = computed(() => {
    if (aspectRatio.value === null) return null
    if (aspectRatio.value === 'original') return originalAspectRatio.value
    return aspectRatio.value
  })

  // Actions
  function setAspectRatio(preset: AspectPreset): void {
    aspectRatio.value = preset
    if (preset !== null) {
      constrainCropToAspect()
    }
  }

  function constrainCropToAspect(): void {
    const ratio = effectiveAspectRatio.value
    if (!ratio) return

    const crop = localCrop.value
    const currentRatio = crop.width / crop.height

    if (Math.abs(currentRatio - ratio) < 0.01) return

    // Adjust height to match aspect ratio
    const newHeight = crop.width / ratio
    if (crop.top + newHeight <= 1) {
      localCrop.value = { ...crop, height: newHeight }
    } else {
      // Adjust width instead
      const newWidth = crop.height * ratio
      localCrop.value = { ...crop, width: Math.min(newWidth, 1 - crop.left) }
    }

    commitCrop()
  }

  function commitCrop(): void {
    const crop = localCrop.value
    if (crop.left === 0 && crop.top === 0 && crop.width === 1 && crop.height === 1) {
      editStore.setCrop(null)
    } else {
      editStore.setCrop(crop)
    }
  }

  function resetCrop(): void {
    localCrop.value = { left: 0, top: 0, width: 1, height: 1 }
    editStore.setCrop(null)
  }

  // Rendering
  function render(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const crop = localCrop.value

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Dark overlay outside crop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'

    // Top
    ctx.fillRect(0, 0, w, crop.top * h)
    // Bottom
    ctx.fillRect(0, (crop.top + crop.height) * h, w, (1 - crop.top - crop.height) * h)
    // Left
    ctx.fillRect(0, crop.top * h, crop.left * w, crop.height * h)
    // Right
    ctx.fillRect(
      (crop.left + crop.width) * w,
      crop.top * h,
      (1 - crop.left - crop.width) * w,
      crop.height * h,
    )

    // Crop border
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(crop.left * w, crop.top * h, crop.width * w, crop.height * h)

    // Rule of thirds grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1

    const cropX = crop.left * w
    const cropY = crop.top * h
    const cropW = crop.width * w
    const cropH = crop.height * h

    // Vertical lines
    for (let i = 1; i < 3; i++) {
      const x = cropX + (cropW * i) / 3
      ctx.beginPath()
      ctx.moveTo(x, cropY)
      ctx.lineTo(x, cropY + cropH)
      ctx.stroke()
    }

    // Horizontal lines
    for (let i = 1; i < 3; i++) {
      const y = cropY + (cropH * i) / 3
      ctx.beginPath()
      ctx.moveTo(cropX, y)
      ctx.lineTo(cropX + cropW, y)
      ctx.stroke()
    }

    // Handles
    drawHandles(ctx, crop, w, h)
  }

  function drawHandles(
    ctx: CanvasRenderingContext2D,
    crop: CropRectangle,
    w: number,
    h: number,
  ): void {
    const size = 10
    const half = size / 2

    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1

    const positions = {
      nw: { x: crop.left * w, y: crop.top * h },
      n: { x: (crop.left + crop.width / 2) * w, y: crop.top * h },
      ne: { x: (crop.left + crop.width) * w, y: crop.top * h },
      e: { x: (crop.left + crop.width) * w, y: (crop.top + crop.height / 2) * h },
      se: { x: (crop.left + crop.width) * w, y: (crop.top + crop.height) * h },
      s: { x: (crop.left + crop.width / 2) * w, y: (crop.top + crop.height) * h },
      sw: { x: crop.left * w, y: (crop.top + crop.height) * h },
      w: { x: crop.left * w, y: (crop.top + crop.height / 2) * h },
    }

    for (const [handle, pos] of Object.entries(positions)) {
      const isActive = activeHandle.value === handle
      ctx.fillStyle = isActive ? '#3b82f6' : '#fff'

      ctx.fillRect(pos.x - half, pos.y - half, size, size)
      ctx.strokeRect(pos.x - half, pos.y - half, size, size)
    }
  }

  // Event handlers (to be connected in component)
  function handleMouseDown(e: MouseEvent): void {
    // Implementation for drag start
  }

  function handleMouseMove(e: MouseEvent): void {
    // Implementation for drag
  }

  function handleMouseUp(): void {
    // Implementation for drag end
    isDragging.value = false
    dragType.value = null
    activeHandle.value = null
    commitCrop()
  }

  // Watchers
  watch(localCrop, () => render(), { deep: true })

  return {
    // State
    localCrop,
    aspectRatio,
    isLocked,
    isDragging,

    // Computed
    effectiveAspectRatio,
    ASPECT_PRESETS,

    // Actions
    setAspectRatio,
    resetCrop,
    commitCrop,
    render,

    // Event handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  }
}
```

#### 12.7.2 Create `apps/web/app/components/edit/EditCropEditor.vue`

```vue
<script setup lang="ts">
/**
 * EditCropEditor Component
 *
 * Interactive crop editor overlay on the preview canvas.
 */
import { ASPECT_PRESETS } from '~/composables/useCropEditor'

const props = defineProps<{
  assetId: string
  imageWidth: number
  imageHeight: number
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const {
  localCrop,
  aspectRatio,
  isDragging,
  effectiveAspectRatio,
  setAspectRatio,
  resetCrop,
  render,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
} = useCropEditor({
  canvasRef,
  imageWidth: toRef(() => props.imageWidth),
  imageHeight: toRef(() => props.imageHeight),
})

const hasModifications = computed(() => {
  const crop = localCrop.value
  return crop.left !== 0 || crop.top !== 0 || crop.width !== 1 || crop.height !== 1
})

onMounted(() => {
  render()
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('mousemove', handleMouseMove)
})

onUnmounted(() => {
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('mousemove', handleMouseMove)
})
</script>

<template>
  <div class="space-y-3" data-testid="crop-editor">
    <!-- Aspect Ratio -->
    <div class="space-y-2">
      <label class="text-xs text-gray-500">Aspect Ratio</label>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="preset in ASPECT_PRESETS"
          :key="preset.label"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="{
            'bg-blue-600 text-white': aspectRatio === preset.value,
            'bg-gray-700 text-gray-300 hover:bg-gray-600': aspectRatio !== preset.value,
          }"
          @click="setAspectRatio(preset.value)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between">
      <span v-if="isDragging" class="text-xs text-blue-400">Adjusting...</span>
      <button
        v-if="hasModifications"
        class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        data-testid="crop-reset"
        @click="resetCrop"
      >
        Reset Crop
      </button>
    </div>

    <!-- Crop Values Display -->
    <div class="grid grid-cols-2 gap-2 text-xs text-gray-500">
      <span>X: {{ Math.round(localCrop.left * 100) }}%</span>
      <span>Y: {{ Math.round(localCrop.top * 100) }}%</span>
      <span>W: {{ Math.round(localCrop.width * 100) }}%</span>
      <span>H: {{ Math.round(localCrop.height * 100) }}%</span>
    </div>
  </div>
</template>
```

#### 12.7.3 Verification

- [ ] Aspect ratio buttons work
- [ ] Crop values display correctly
- [ ] Reset button clears crop

---

### Phase 12.8: Rotation Controls UI

**Goal**: Create rotation and straighten controls.

#### 12.8.1 Create `apps/web/app/components/edit/EditRotationControls.vue`

```vue
<script setup lang="ts">
/**
 * EditRotationControls Component
 *
 * Rotation slider and buttons for image rotation.
 */
const editStore = useEditStore()

const rotation = computed({
  get: () => editStore.cropTransform.rotation.angle,
  set: (value: number) => editStore.setRotationAngle(value),
})

const straighten = computed({
  get: () => editStore.cropTransform.rotation.straighten,
  set: (value: number) => editStore.setStraightenAngle(value),
})

const totalRotation = computed(() => rotation.value + straighten.value)

function rotate90CW(): void {
  editStore.setRotationAngle((rotation.value + 90) % 360)
}

function rotate90CCW(): void {
  editStore.setRotationAngle((rotation.value - 90 + 360) % 360)
}

function resetRotation(): void {
  editStore.setRotation({ angle: 0, straighten: 0 })
}

const hasModifications = computed(() => {
  return rotation.value !== 0 || straighten.value !== 0
})
</script>

<template>
  <div class="space-y-4" data-testid="rotation-controls">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h4 class="text-xs font-medium text-gray-400">Rotation</h4>
      <button
        v-if="hasModifications"
        class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        @click="resetRotation"
      >
        Reset
      </button>
    </div>

    <!-- 90-degree buttons -->
    <div class="flex gap-2">
      <button
        class="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Rotate 90° counter-clockwise"
        @click="rotate90CCW"
      >
        ↺ 90°
      </button>
      <button
        class="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Rotate 90° clockwise"
        @click="rotate90CW"
      >
        ↻ 90°
      </button>
    </div>

    <!-- Fine rotation slider -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs text-gray-500">
        <span>Angle</span>
        <span>{{ rotation.toFixed(1) }}°</span>
      </div>
      <input
        v-model.number="rotation"
        type="range"
        min="-180"
        max="180"
        step="0.1"
        class="w-full accent-blue-500"
      />
    </div>

    <!-- Straighten slider -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs text-gray-500">
        <span>Straighten</span>
        <span>{{ straighten.toFixed(1) }}°</span>
      </div>
      <input
        v-model.number="straighten"
        type="range"
        min="-45"
        max="45"
        step="0.1"
        class="w-full accent-blue-500"
      />
    </div>

    <!-- Total display -->
    <div class="text-xs text-gray-600">
      Total: {{ totalRotation.toFixed(1) }}°
    </div>
  </div>
</template>
```

#### 12.8.2 Create `apps/web/app/components/edit/EditStraightenTool.vue`

```vue
<script setup lang="ts">
/**
 * EditStraightenTool Component
 *
 * Draw-to-straighten horizon line tool.
 */
const emit = defineEmits<{
  (e: 'straighten', angle: number): void
}>()

const isActive = ref(false)
const startPoint = ref<{ x: number; y: number } | null>(null)
const endPoint = ref<{ x: number; y: number } | null>(null)

function activate(): void {
  isActive.value = true
  startPoint.value = null
  endPoint.value = null
}

function deactivate(): void {
  isActive.value = false
  startPoint.value = null
  endPoint.value = null
}

function handleMouseDown(e: MouseEvent): void {
  if (!isActive.value) return
  startPoint.value = { x: e.clientX, y: e.clientY }
}

function handleMouseMove(e: MouseEvent): void {
  if (!isActive.value || !startPoint.value) return
  endPoint.value = { x: e.clientX, y: e.clientY }
}

function handleMouseUp(): void {
  if (!isActive.value || !startPoint.value || !endPoint.value) return

  // Calculate straighten angle
  const dx = endPoint.value.x - startPoint.value.x
  const dy = endPoint.value.y - startPoint.value.y
  const angle = -Math.atan2(dy, dx) * (180 / Math.PI)

  emit('straighten', angle)
  deactivate()
}

const lineStyle = computed(() => {
  if (!startPoint.value || !endPoint.value) return null
  return {
    left: `${startPoint.value.x}px`,
    top: `${startPoint.value.y}px`,
    width: `${Math.hypot(
      endPoint.value.x - startPoint.value.x,
      endPoint.value.y - startPoint.value.y,
    )}px`,
    transform: `rotate(${Math.atan2(
      endPoint.value.y - startPoint.value.y,
      endPoint.value.x - startPoint.value.x,
    )}rad)`,
    transformOrigin: 'left center',
  }
})
</script>

<template>
  <div>
    <button
      class="w-full px-3 py-2 text-sm transition-colors rounded"
      :class="{
        'bg-blue-600 text-white': isActive,
        'bg-gray-700 text-gray-300 hover:bg-gray-600': !isActive,
      }"
      @click="isActive ? deactivate() : activate()"
    >
      {{ isActive ? 'Cancel' : 'Straighten Tool' }}
    </button>

    <p v-if="isActive" class="mt-2 text-xs text-gray-500">
      Click and drag along the horizon to straighten
    </p>

    <!-- Line overlay (when drawing) -->
    <Teleport to="body">
      <div
        v-if="isActive"
        class="fixed inset-0 cursor-crosshair z-50"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
      >
        <div
          v-if="lineStyle"
          class="absolute h-0.5 bg-blue-500 pointer-events-none"
          :style="lineStyle"
        />
      </div>
    </Teleport>
  </div>
</template>
```

#### 12.8.3 Verification

- [ ] Rotation slider works
- [ ] 90-degree buttons work
- [ ] Straighten slider works
- [ ] Straighten tool calculates angle correctly

---

### Phase 12.9: Controls Panel Integration

**Goal**: Wire new components into the edit controls panel.

#### 12.9.1 Update `apps/web/app/components/edit/EditControlsPanel.vue`

Add Transform section:

```vue
<template>
  <!-- ... existing Basic and Tone Curve sections ... -->

  <!-- Transform Section -->
  <UAccordion
    :items="[{ label: 'Transform', slot: 'transform' }]"
    :default-value="['Transform']"
    class="border-t border-gray-700 pt-4"
  >
    <template #transform-body>
      <div class="space-y-6">
        <!-- Rotation Controls -->
        <EditRotationControls />

        <!-- Straighten Tool -->
        <EditStraightenTool @straighten="handleStraighten" />

        <!-- Divider -->
        <hr class="border-gray-700" />

        <!-- Crop Editor -->
        <EditCropEditor
          :asset-id="assetId"
          :image-width="imageWidth"
          :image-height="imageHeight"
        />
      </div>
    </template>
  </UAccordion>
</template>

<script setup lang="ts">
const editStore = useEditStore()

function handleStraighten(angle: number): void {
  editStore.setStraightenAngle(angle)
}
</script>
```

#### 12.9.2 Verification

- [ ] Transform accordion section appears
- [ ] Rotation controls work
- [ ] Crop editor appears
- [ ] Straighten tool works

---

## File Summary

```
packages/core/src/
├── catalog/
│   ├── types.ts           # 12.1.1-12.1.2 - Add crop/transform types
│   └── index.ts           # 12.1.3 - Export types
└── decode/
    ├── worker-messages.ts # 12.5.1 - Add message types
    ├── decode-worker.ts   # 12.5.2 - Add handlers
    ├── decode-service.ts  # 12.5.3 - Add methods
    └── mock-decode-service.ts # 12.5.4 - Add mocks

crates/
├── literoom-core/src/
│   ├── lib.rs             # 12.3.4 - Export transform module
│   └── transform/
│       ├── mod.rs         # 12.3.1 - NEW: Module definition
│       ├── rotation.rs    # 12.3.2 - NEW: Rotation with interpolation
│       └── crop.rs        # 12.3.3 - NEW: Crop implementation
└── literoom-wasm/src/
    ├── lib.rs             # 12.4.2 - Export transform bindings
    └── transform.rs       # 12.4.1 - NEW: WASM bindings

apps/web/app/
├── stores/
│   └── edit.ts            # 12.2.1 - Add cropTransform state
├── composables/
│   ├── useCropEditor.ts   # 12.7.1 - NEW: Crop editor composable
│   └── useEditPreview.ts  # 12.6.1 - Add transform pipeline
└── components/edit/
    ├── EditCropEditor.vue       # 12.7.2 - NEW: Crop UI
    ├── EditRotationControls.vue # 12.8.1 - NEW: Rotation controls
    ├── EditStraightenTool.vue   # 12.8.2 - NEW: Straighten tool
    └── EditControlsPanel.vue    # 12.9.1 - Integrate components
```

---

## Verification Checklist

After all phases complete:

**Types (Phase 12.1):**
- [ ] CropRectangle type works
- [ ] RotationParameters type works
- [ ] CropTransform type works
- [ ] Utility functions work

**Store (Phase 12.2):**
- [ ] cropTransform state stored correctly
- [ ] Actions work (setCrop, setRotation, etc.)
- [ ] hasModifications includes transforms

**Rust (Phase 12.3):**
- [ ] Rotation algorithm works correctly
- [ ] Bilinear interpolation produces smooth results
- [ ] Crop extracts correct region
- [ ] Unit tests pass

**WASM (Phase 12.4):**
- [ ] WASM builds successfully
- [ ] apply_rotation accessible from TypeScript
- [ ] apply_crop accessible from TypeScript

**Worker (Phase 12.5):**
- [ ] Worker handles rotation messages
- [ ] Worker handles crop messages
- [ ] Service methods work

**Preview (Phase 12.6):**
- [ ] Preview updates with rotation changes
- [ ] Preview updates with crop changes
- [ ] Transform order is correct

**UI (Phases 12.7-12.9):**
- [ ] Crop editor overlay displays
- [ ] Aspect ratio presets work
- [ ] Rotation slider works
- [ ] 90-degree rotation buttons work
- [ ] Straighten tool calculates angle correctly

---

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Rotation (bilinear, 2560px) | <200ms | For preview |
| Rotation (lanczos3, 6000px) | <600ms | For export |
| Crop | <10ms | Simple pixel copy |
| Full preview with transforms | <500ms | Total pipeline |

---

## Future Enhancements (Post Phase 12)

1. **Flip horizontal/vertical**: Simple pixel reordering
2. **Perspective correction**: Keystone adjustment
3. **Crop overlay on main canvas**: Draw crop directly on preview
4. **Keyboard shortcuts**: R for rotate, C for crop mode
5. **History/undo**: Transform history stack
