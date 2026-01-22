# Local Masks Implementation Plan

**Created**: 2026-01-21 19:40 EST
**Based on**: `docs/research/2026-01-21-local-masks-synthesis.md`
**Status**: Ready for Implementation

## Overview

Local adjustment masks (linear gradient and radial gradient) allow users to apply localized edits to specific regions of their photos. This is a core v1 requirement from spec section 3.5.4.

### v1 Requirements (from spec)

- [ ] Linear gradient mask: position/angle, feather
- [ ] Radial gradient mask: ellipse position/size, feather, invert option
- [ ] Mask management: create, select, reorder, enable/disable, delete
- [ ] Per-mask adjustment subset
- [ ] Mask overlay toggle in preview

## Implementation Phases

### Phase 1: TypeScript Types and Schema

**Goal**: Add mask type definitions and update EditState schema to version 4.

**Files to Create**:
None (modifying existing files)

**Files to Modify**:
1. `packages/core/src/catalog/types.ts` - Add mask types, update EditState

**Implementation Details**:

```typescript
// packages/core/src/catalog/types.ts

/**
 * Linear gradient mask definition
 */
export interface LinearGradientMask {
  /** Unique identifier */
  id: string
  /** Start point (0-1 normalized coordinates) */
  start: { x: number; y: number }
  /** End point (0-1 normalized coordinates) */
  end: { x: number; y: number }
  /** Feather amount (0-1, where 0 = hard edge, 1 = full feather) */
  feather: number
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments */
  adjustments: Partial<Adjustments>
}

/**
 * Radial gradient mask definition
 */
export interface RadialGradientMask {
  /** Unique identifier */
  id: string
  /** Center point (0-1 normalized coordinates) */
  center: { x: number; y: number }
  /** Horizontal radius (0-1 normalized to image width) */
  radiusX: number
  /** Vertical radius (0-1 normalized to image height) */
  radiusY: number
  /** Rotation angle in degrees */
  rotation: number
  /** Feather amount (0-1) */
  feather: number
  /** Whether effect is inside (false) or outside (true) ellipse */
  invert: boolean
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments */
  adjustments: Partial<Adjustments>
}

/**
 * Container for all masks on an asset
 */
export interface MaskStack {
  /** Linear gradient masks (applied in order) */
  linearMasks: LinearGradientMask[]
  /** Radial gradient masks (applied in order) */
  radialMasks: RadialGradientMask[]
}

/**
 * Edit state schema version 4 - adds masks
 */
export interface EditState {
  version: 4
  adjustments: Adjustments
  toneCurve: ToneCurvePoint[]
  cropTransform: CropTransform
  masks?: MaskStack
}

export const EDIT_SCHEMA_VERSION = 4

/**
 * Default empty mask stack
 */
export function createDefaultMaskStack(): MaskStack {
  return {
    linearMasks: [],
    radialMasks: [],
  }
}

/**
 * Migrate edit state from previous versions
 */
export function migrateEditState(state: any): EditState {
  if (!state) {
    return {
      version: EDIT_SCHEMA_VERSION,
      adjustments: createDefaultAdjustments(),
      toneCurve: [],
      cropTransform: createDefaultCropTransform(),
      masks: undefined,
    }
  }

  // v3 -> v4: add masks field
  if (state.version === 3) {
    return {
      ...state,
      version: 4,
      masks: undefined,
    }
  }

  return state
}
```

**Tests**:
- Schema migration from v3 to v4
- Default mask stack creation
- Type validation for mask structures

---

### Phase 2: Rust Mask Implementation

**Goal**: Implement mask evaluation algorithms and masked adjustment application in Rust.

**Files to Create**:
1. `crates/literoom-core/src/mask/mod.rs`
2. `crates/literoom-core/src/mask/linear.rs`
3. `crates/literoom-core/src/mask/radial.rs`
4. `crates/literoom-core/src/mask/apply.rs`

**Files to Modify**:
5. `crates/literoom-core/src/lib.rs` - Export mask module

**Implementation Details**:

```rust
// crates/literoom-core/src/mask/mod.rs
pub mod linear;
pub mod radial;
pub mod apply;

pub use linear::LinearGradientMask;
pub use radial::RadialGradientMask;
pub use apply::apply_masked_adjustments;

/// Smootherstep function for smooth feathering
/// Returns values 0.0 to 1.0 with zero velocity and acceleration at boundaries
#[inline]
pub fn smootherstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}
```

```rust
// crates/literoom-core/src/mask/linear.rs
use super::smootherstep;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearGradientMask {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub feather: f32,  // 0.0 to 1.0
}

impl LinearGradientMask {
    /// Evaluate mask strength at given normalized coordinates
    /// Returns 0.0 (no effect) to 1.0 (full effect)
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let dx = self.end_x - self.start_x;
        let dy = self.end_y - self.start_y;
        let len_sq = dx * dx + dy * dy;

        // Degenerate case: start and end are the same point
        if len_sq < f32::EPSILON {
            return 0.5;
        }

        // Project point onto gradient line
        let t = ((x - self.start_x) * dx + (y - self.start_y) * dy) / len_sq;

        // Apply feathering
        // When feather = 0: hard edge at t = 0.5
        // When feather = 1: full gradient from t = 0 to t = 1
        let feather_zone = 0.5 * self.feather.clamp(0.0, 1.0);
        let center = 0.5;

        if t <= center - feather_zone {
            1.0  // Full effect on start side
        } else if t >= center + feather_zone {
            0.0  // No effect on end side
        } else {
            // Interpolate with smootherstep
            let local_t = (t - (center - feather_zone)) / (2.0 * feather_zone).max(0.001);
            1.0 - smootherstep(local_t)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_mask_center() {
        let mask = LinearGradientMask {
            start_x: 0.0,
            start_y: 0.5,
            end_x: 1.0,
            end_y: 0.5,
            feather: 1.0,
        };

        // At start point: full effect
        let val_start = mask.evaluate(0.0, 0.5);
        assert!(val_start > 0.9);

        // At end point: no effect
        let val_end = mask.evaluate(1.0, 0.5);
        assert!(val_end < 0.1);

        // At center: half effect
        let val_center = mask.evaluate(0.5, 0.5);
        assert!((val_center - 0.5).abs() < 0.1);
    }

    #[test]
    fn test_linear_mask_hard_edge() {
        let mask = LinearGradientMask {
            start_x: 0.0,
            start_y: 0.5,
            end_x: 1.0,
            end_y: 0.5,
            feather: 0.0,
        };

        // Sharp transition at midpoint
        let val_before = mask.evaluate(0.49, 0.5);
        let val_after = mask.evaluate(0.51, 0.5);

        assert!(val_before > 0.9);
        assert!(val_after < 0.1);
    }
}
```

```rust
// crates/literoom-core/src/mask/radial.rs
use super::smootherstep;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadialGradientMask {
    pub center_x: f32,
    pub center_y: f32,
    pub radius_x: f32,
    pub radius_y: f32,
    pub rotation: f32,  // Radians
    pub feather: f32,   // 0.0 to 1.0
    pub invert: bool,
}

impl RadialGradientMask {
    /// Evaluate mask strength at given normalized coordinates
    /// Returns 0.0 (no effect) to 1.0 (full effect)
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let dx = x - self.center_x;
        let dy = y - self.center_y;

        // Rotate to local coordinate space
        let (cos_r, sin_r) = (self.rotation.cos(), self.rotation.sin());
        let local_x = dx * cos_r + dy * sin_r;
        let local_y = -dx * sin_r + dy * cos_r;

        // Avoid division by zero
        let rx = self.radius_x.max(0.001);
        let ry = self.radius_y.max(0.001);

        // Normalized distance from center (1.0 = on ellipse edge)
        let norm_dist = ((local_x / rx).powi(2) + (local_y / ry).powi(2)).sqrt();

        // Inner boundary based on feather
        let inner = 1.0 - self.feather.clamp(0.0, 1.0);

        let mask = if norm_dist <= inner {
            1.0  // Full effect inside inner boundary
        } else if norm_dist >= 1.0 {
            0.0  // No effect outside ellipse
        } else {
            // Feathered region
            let t = (norm_dist - inner) / (1.0 - inner).max(0.001);
            1.0 - smootherstep(t)
        };

        if self.invert { 1.0 - mask } else { mask }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_radial_mask_center() {
        let mask = RadialGradientMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.5,
            invert: false,
        };

        // At center: full effect
        let val = mask.evaluate(0.5, 0.5);
        assert!(val > 0.99);
    }

    #[test]
    fn test_radial_mask_outside() {
        let mask = RadialGradientMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.2,
            radius_y: 0.2,
            rotation: 0.0,
            feather: 0.2,
            invert: false,
        };

        // Far outside: no effect
        let val = mask.evaluate(0.0, 0.0);
        assert!(val < 0.01);
    }

    #[test]
    fn test_radial_mask_invert() {
        let mask = RadialGradientMask {
            center_x: 0.5,
            center_y: 0.5,
            radius_x: 0.3,
            radius_y: 0.3,
            rotation: 0.0,
            feather: 0.0,
            invert: true,
        };

        // Inverted: center has no effect
        let val_center = mask.evaluate(0.5, 0.5);
        assert!(val_center < 0.01);

        // Outside has full effect
        let val_outside = mask.evaluate(0.0, 0.0);
        assert!(val_outside > 0.99);
    }
}
```

```rust
// crates/literoom-core/src/mask/apply.rs
use super::{LinearGradientMask, RadialGradientMask};
use crate::adjustments::{apply_adjustments_to_pixel, BasicAdjustments};

/// Apply masked adjustments to an image
///
/// Each mask applies its own adjustments blended with the mask's alpha.
/// Masks are applied sequentially (multiply blend).
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

        // Normalized coordinates (0-1)
        let x = (px as f32 + 0.5) / w_f;
        let y = (py as f32 + 0.5) / h_f;

        // Current pixel values as floats (0-1)
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply each linear mask
        for (mask, adj) in linear_masks {
            let mask_val = mask.evaluate(x, y);

            // Skip if mask has no effect
            if mask_val < 0.001 {
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

            // Skip if mask has no effect
            if mask_val < 0.001 {
                continue;
            }

            // Apply adjustments to get target color
            let (ar, ag, ab) = apply_adjustments_to_pixel(r, g, b, adj);

            // Blend based on mask value
            r = r * (1.0 - mask_val) + ar * mask_val;
            g = g * (1.0 - mask_val) + ag * mask_val;
            b = b * (1.0 - mask_val) + ab * mask_val;
        }

        // Write back
        chunk[0] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_masks_no_change() {
        let mut pixels = vec![128u8; 100 * 100 * 3];
        let original = pixels.clone();

        apply_masked_adjustments(&mut pixels, 100, 100, &[], &[]);

        assert_eq!(pixels, original);
    }

    #[test]
    fn test_linear_mask_exposure() {
        let mut pixels = vec![128u8; 10 * 10 * 3];

        let mask = LinearGradientMask {
            start_x: 0.0,
            start_y: 0.5,
            end_x: 1.0,
            end_y: 0.5,
            feather: 0.0,
        };

        let adj = BasicAdjustments {
            exposure: 1.0,  // +1 EV
            ..Default::default()
        };

        apply_masked_adjustments(&mut pixels, 10, 10, &[(mask, adj)], &[]);

        // Left side (mask = 1.0) should be brighter
        let left_pixel = &pixels[0..3];
        assert!(left_pixel[0] > 128);

        // Right side (mask = 0.0) should be unchanged
        let right_pixel = &pixels[(9 * 3)..(10 * 3)];
        assert_eq!(right_pixel, &[128, 128, 128]);
    }
}
```

---

### Phase 3: WASM Bindings

**Goal**: Expose mask operations to JavaScript via WASM bindings.

**Files to Create**:
1. `crates/literoom-wasm/src/mask.rs`

**Files to Modify**:
2. `crates/literoom-wasm/src/lib.rs` - Export mask module

**Implementation Details**:

```rust
// crates/literoom-wasm/src/mask.rs
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::JsDecodedImage;
use literoom_core::mask::{LinearGradientMask, RadialGradientMask};
use literoom_core::adjustments::BasicAdjustments;

/// JS-compatible mask data structure
#[derive(Serialize, Deserialize)]
pub struct JsMaskStack {
    pub linear_masks: Vec<JsLinearMask>,
    pub radial_masks: Vec<JsRadialMask>,
}

#[derive(Serialize, Deserialize)]
pub struct JsLinearMask {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub feather: f32,
    pub enabled: bool,
    pub adjustments: JsAdjustments,
}

#[derive(Serialize, Deserialize)]
pub struct JsRadialMask {
    pub center_x: f32,
    pub center_y: f32,
    pub radius_x: f32,
    pub radius_y: f32,
    pub rotation: f32,
    pub feather: f32,
    pub invert: bool,
    pub enabled: bool,
    pub adjustments: JsAdjustments,
}

#[derive(Serialize, Deserialize, Default)]
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

/// Apply masked adjustments to an image
#[wasm_bindgen]
pub fn apply_masked_adjustments(
    image: &JsDecodedImage,
    mask_data: JsValue,
) -> Result<JsDecodedImage, JsValue> {
    let masks: JsMaskStack = serde_wasm_bindgen::from_value(mask_data)
        .map_err(|e| JsValue::from_str(&format!("Invalid mask data: {}", e)))?;

    let mut pixels = image.pixels();

    // Convert and filter enabled masks
    let linear: Vec<_> = masks.linear_masks
        .into_iter()
        .filter(|m| m.enabled)
        .map(|m| {
            let mask = LinearGradientMask {
                start_x: m.start_x,
                start_y: m.start_y,
                end_x: m.end_x,
                end_y: m.end_y,
                feather: m.feather,
            };
            let adj: BasicAdjustments = m.adjustments.into();
            (mask, adj)
        })
        .collect();

    let radial: Vec<_> = masks.radial_masks
        .into_iter()
        .filter(|m| m.enabled)
        .map(|m| {
            let mask = RadialGradientMask {
                center_x: m.center_x,
                center_y: m.center_y,
                radius_x: m.radius_x,
                radius_y: m.radius_y,
                rotation: m.rotation.to_radians(),
                feather: m.feather,
                invert: m.invert,
            };
            let adj: BasicAdjustments = m.adjustments.into();
            (mask, adj)
        })
        .collect();

    literoom_core::mask::apply_masked_adjustments(
        &mut pixels,
        image.width(),
        image.height(),
        &linear,
        &radial,
    );

    Ok(JsDecodedImage::new(image.width(), image.height(), pixels))
}
```

---

### Phase 4: Worker Integration

**Goal**: Expose mask operations through the decode worker.

**Files to Modify**:
1. `packages/core/src/decode/worker-messages.ts` - Add mask message types
2. `packages/core/src/decode/decode-worker.ts` - Add mask handler
3. `packages/core/src/decode/decode-service.ts` - Add applyMaskedAdjustments method
4. `packages/core/src/decode/types.ts` - Update IDecodeService interface
5. `packages/core/src/decode/mock-decode-service.ts` - Add mock implementation

**Implementation Details**:

```typescript
// packages/core/src/decode/worker-messages.ts - Add to unions
export type DecodeRequest =
  // ... existing types ...
  | { type: 'apply-masked-adjustments'; id: string; data: Uint8Array; width: number; height: number; maskStack: MaskStackData }

export interface MaskStackData {
  linearMasks: Array<{
    startX: number; startY: number
    endX: number; endY: number
    feather: number
    enabled: boolean
    adjustments: Partial<Adjustments>
  }>
  radialMasks: Array<{
    centerX: number; centerY: number
    radiusX: number; radiusY: number
    rotation: number
    feather: number
    invert: boolean
    enabled: boolean
    adjustments: Partial<Adjustments>
  }>
}
```

```typescript
// packages/core/src/decode/decode-worker.ts - Add handler
case 'apply-masked-adjustments': {
  const { id, data, width, height, maskStack } = request
  try {
    const image = new wasm.JsDecodedImage(data, width, height)

    // Convert to WASM format
    const wasmMaskData = {
      linear_masks: maskStack.linearMasks.map(m => ({
        start_x: m.startX,
        start_y: m.startY,
        end_x: m.endX,
        end_y: m.endY,
        feather: m.feather,
        enabled: m.enabled,
        adjustments: {
          exposure: m.adjustments.exposure ?? 0,
          contrast: m.adjustments.contrast ?? 0,
          highlights: m.adjustments.highlights ?? 0,
          shadows: m.adjustments.shadows ?? 0,
          whites: m.adjustments.whites ?? 0,
          blacks: m.adjustments.blacks ?? 0,
          temperature: m.adjustments.temperature ?? 0,
          tint: m.adjustments.tint ?? 0,
          saturation: m.adjustments.saturation ?? 0,
          vibrance: m.adjustments.vibrance ?? 0,
        },
      })),
      radial_masks: maskStack.radialMasks.map(m => ({
        center_x: m.centerX,
        center_y: m.centerY,
        radius_x: m.radiusX,
        radius_y: m.radiusY,
        rotation: m.rotation,
        feather: m.feather,
        invert: m.invert,
        enabled: m.enabled,
        adjustments: {
          exposure: m.adjustments.exposure ?? 0,
          contrast: m.adjustments.contrast ?? 0,
          highlights: m.adjustments.highlights ?? 0,
          shadows: m.adjustments.shadows ?? 0,
          whites: m.adjustments.whites ?? 0,
          blacks: m.adjustments.blacks ?? 0,
          temperature: m.adjustments.temperature ?? 0,
          tint: m.adjustments.tint ?? 0,
          saturation: m.adjustments.saturation ?? 0,
          vibrance: m.adjustments.vibrance ?? 0,
        },
      })),
    }

    const result = wasm.apply_masked_adjustments(image, wasmMaskData)
    image.free()

    self.postMessage({
      type: 'adjusted',
      id,
      data: result.pixels(),
      width: result.width(),
      height: result.height(),
    } as DecodeResponse)

    result.free()
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      error: String(err),
    } as DecodeResponse)
  }
  break
}
```

```typescript
// packages/core/src/decode/decode-service.ts - Add method
async applyMaskedAdjustments(
  pixels: Uint8Array,
  width: number,
  height: number,
  maskStack: MaskStackData,
): Promise<DecodedImage> {
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject })

    this.worker.postMessage({
      type: 'apply-masked-adjustments',
      id,
      data: pixels,
      width,
      height,
      maskStack,
    })
  })
}
```

---

### Phase 5: Edit Store Integration

**Goal**: Add mask state management to the edit store.

**Files to Modify**:
1. `apps/web/app/stores/edit.ts` - Add mask state and actions

**Implementation Details**:

```typescript
// apps/web/app/stores/edit.ts - Add to existing store

// New state
const masks = ref<MaskStack | null>(null)
const selectedMaskId = ref<string | null>(null)

// New computed
const hasMaskModifications = computed(() => {
  if (!masks.value) return false
  return masks.value.linearMasks.length > 0 || masks.value.radialMasks.length > 0
})

const selectedMask = computed(() => {
  if (!selectedMaskId.value || !masks.value) return null

  const linear = masks.value.linearMasks.find(m => m.id === selectedMaskId.value)
  if (linear) return { type: 'linear' as const, mask: linear }

  const radial = masks.value.radialMasks.find(m => m.id === selectedMaskId.value)
  if (radial) return { type: 'radial' as const, mask: radial }

  return null
})

// New actions
function addLinearMask(mask: LinearGradientMask): void {
  if (!masks.value) {
    masks.value = createDefaultMaskStack()
  }
  masks.value.linearMasks.push(mask)
  selectedMaskId.value = mask.id
}

function addRadialMask(mask: RadialGradientMask): void {
  if (!masks.value) {
    masks.value = createDefaultMaskStack()
  }
  masks.value.radialMasks.push(mask)
  selectedMaskId.value = mask.id
}

function updateLinearMask(id: string, updates: Partial<LinearGradientMask>): void {
  if (!masks.value) return
  const index = masks.value.linearMasks.findIndex(m => m.id === id)
  if (index !== -1) {
    masks.value.linearMasks[index] = { ...masks.value.linearMasks[index], ...updates }
  }
}

function updateRadialMask(id: string, updates: Partial<RadialGradientMask>): void {
  if (!masks.value) return
  const index = masks.value.radialMasks.findIndex(m => m.id === id)
  if (index !== -1) {
    masks.value.radialMasks[index] = { ...masks.value.radialMasks[index], ...updates }
  }
}

function deleteMask(id: string): void {
  if (!masks.value) return
  masks.value.linearMasks = masks.value.linearMasks.filter(m => m.id !== id)
  masks.value.radialMasks = masks.value.radialMasks.filter(m => m.id !== id)
  if (selectedMaskId.value === id) {
    selectedMaskId.value = null
  }
}

function toggleMaskEnabled(id: string): void {
  if (!masks.value) return

  const linear = masks.value.linearMasks.find(m => m.id === id)
  if (linear) {
    linear.enabled = !linear.enabled
    return
  }

  const radial = masks.value.radialMasks.find(m => m.id === id)
  if (radial) {
    radial.enabled = !radial.enabled
  }
}

function selectMask(id: string | null): void {
  selectedMaskId.value = id
}

function setMaskAdjustments(id: string, adjustments: Partial<Adjustments>): void {
  if (!masks.value) return

  const linear = masks.value.linearMasks.find(m => m.id === id)
  if (linear) {
    linear.adjustments = { ...linear.adjustments, ...adjustments }
    return
  }

  const radial = masks.value.radialMasks.find(m => m.id === id)
  if (radial) {
    radial.adjustments = { ...radial.adjustments, ...adjustments }
  }
}

function resetMasks(): void {
  masks.value = null
  selectedMaskId.value = null
}

// Update hasModifications computed to include masks
const hasModifications = computed(() => {
  return hasAdjustmentModifications.value ||
         hasToneCurveModifications.value ||
         hasCropModifications.value ||
         hasMaskModifications.value
})
```

---

### Phase 6: Preview Pipeline Integration

**Goal**: Add mask rendering to the preview pipeline.

**Files to Modify**:
1. `apps/web/app/composables/useEditPreview.ts` - Add mask step to pipeline

**Implementation Details**:

The preview pipeline order should be:
1. Rotation
2. Crop
3. Global Adjustments
4. Global Tone Curve
5. **Masked Adjustments** (NEW)
6. Clipping Detection

```typescript
// apps/web/app/composables/useEditPreview.ts - Add after tone curve step

// Step 5: Apply masked adjustments
if (editStore.masks && (editStore.masks.linearMasks.length > 0 || editStore.masks.radialMasks.length > 0)) {
  const maskStack: MaskStackData = {
    linearMasks: editStore.masks.linearMasks.map(m => ({
      startX: m.start.x,
      startY: m.start.y,
      endX: m.end.x,
      endY: m.end.y,
      feather: m.feather,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
    radialMasks: editStore.masks.radialMasks.map(m => ({
      centerX: m.center.x,
      centerY: m.center.y,
      radiusX: m.radiusX,
      radiusY: m.radiusY,
      rotation: m.rotation,
      feather: m.feather,
      invert: m.invert,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
  }

  const maskResult = await decodeService.applyMaskedAdjustments(
    currentPixels,
    currentWidth,
    currentHeight,
    maskStack,
  )

  currentPixels = maskResult.data
}
```

Add watcher for mask changes:

```typescript
// Watch mask changes
watch(
  () => editStore.masks,
  () => {
    renderPreview()
  },
  { deep: true }
)
```

---

### Phase 7: Mask Editor UI

**Goal**: Create the UI components for creating and editing masks.

**Files to Create**:
1. `apps/web/app/composables/useMaskEditor.ts` - Canvas interaction composable
2. `apps/web/app/components/edit/EditMaskPanel.vue` - Mask list panel
3. `apps/web/app/components/edit/EditMaskOverlay.vue` - Canvas overlay for mask visualization
4. `apps/web/app/components/edit/EditMaskAdjustments.vue` - Per-mask adjustment sliders

**Files to Modify**:
5. `apps/web/app/components/edit/EditControlsPanel.vue` - Add mask section
6. `apps/web/app/components/edit/EditPreviewCanvas.vue` - Add mask overlay canvas
7. `apps/web/app/stores/editUI.ts` - Add mask tool state

**Implementation Details**:

```typescript
// apps/web/app/composables/useMaskEditor.ts
export interface UseMaskEditorOptions {
  canvasRef: Ref<HTMLCanvasElement | null>
  imageWidth: Ref<number>
  imageHeight: Ref<number>
  displayWidth: Ref<number>
  displayHeight: Ref<number>
}

export function useMaskEditor(options: UseMaskEditorOptions) {
  const editStore = useEditStore()
  const editUIStore = useEditUIStore()

  // Local state for dragging
  const isDragging = ref(false)
  const dragType = ref<'create' | 'move' | 'resize' | null>(null)
  const dragHandle = ref<string | null>(null)

  // Coordinate conversion
  function canvasToNormalized(canvasX: number, canvasY: number): { x: number; y: number } {
    return {
      x: canvasX / options.displayWidth.value,
      y: canvasY / options.displayHeight.value,
    }
  }

  function normalizedToCanvas(x: number, y: number): { x: number; y: number } {
    return {
      x: x * options.displayWidth.value,
      y: y * options.displayHeight.value,
    }
  }

  // Rendering
  function render(): void {
    const canvas = options.canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!editStore.masks || !editUIStore.showMaskOverlay) return

    // Render linear masks
    for (const mask of editStore.masks.linearMasks) {
      renderLinearMask(ctx, mask, mask.id === editStore.selectedMaskId)
    }

    // Render radial masks
    for (const mask of editStore.masks.radialMasks) {
      renderRadialMask(ctx, mask, mask.id === editStore.selectedMaskId)
    }
  }

  function renderLinearMask(ctx: CanvasRenderingContext2D, mask: LinearGradientMask, selected: boolean): void {
    const start = normalizedToCanvas(mask.start.x, mask.start.y)
    const end = normalizedToCanvas(mask.end.x, mask.end.y)

    // Draw gradient line
    ctx.strokeStyle = selected ? '#3b82f6' : '#888888'
    ctx.lineWidth = selected ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // Draw handles
    drawHandle(ctx, start.x, start.y, selected)
    drawHandle(ctx, end.x, end.y, selected)

    // Draw feather lines (perpendicular)
    if (mask.feather > 0) {
      const dx = end.x - start.x
      const dy = end.y - start.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const perpX = -dy / len * 50 * mask.feather
      const perpY = dx / len * 50 * mask.feather

      ctx.strokeStyle = selected ? '#60a5fa' : '#aaaaaa'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(start.x - perpX, start.y - perpY)
      ctx.lineTo(start.x + perpX, start.y + perpY)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  function renderRadialMask(ctx: CanvasRenderingContext2D, mask: RadialGradientMask, selected: boolean): void {
    const center = normalizedToCanvas(mask.center.x, mask.center.y)
    const rx = mask.radiusX * options.displayWidth.value
    const ry = mask.radiusY * options.displayHeight.value

    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.rotate(mask.rotation * Math.PI / 180)

    // Draw ellipse
    ctx.strokeStyle = selected ? '#3b82f6' : '#888888'
    ctx.lineWidth = selected ? 2 : 1
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Draw inner feather ellipse
    if (mask.feather > 0) {
      const innerRx = rx * (1 - mask.feather)
      const innerRy = ry * (1 - mask.feather)
      ctx.strokeStyle = selected ? '#60a5fa' : '#aaaaaa'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.ellipse(0, 0, innerRx, innerRy, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()

    // Draw handles
    drawHandle(ctx, center.x, center.y, selected)  // Center
    drawHandle(ctx, center.x + rx, center.y, selected)  // Right edge
  }

  function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, selected: boolean): void {
    ctx.fillStyle = selected ? '#3b82f6' : '#888888'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // Mouse interaction handlers
  function handleMouseDown(e: MouseEvent): void {
    // ... hit detection and drag start
  }

  function handleMouseMove(e: MouseEvent): void {
    // ... update position during drag
  }

  function handleMouseUp(e: MouseEvent): void {
    // ... commit changes
  }

  // Watch for changes and re-render
  watch(
    [() => editStore.masks, () => editStore.selectedMaskId, () => editUIStore.showMaskOverlay],
    () => render(),
    { deep: true }
  )

  return {
    isDragging,
    render,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  }
}
```

```vue
<!-- apps/web/app/components/edit/EditMaskPanel.vue -->
<script setup lang="ts">
import { useEditStore } from '~/stores/edit'

const editStore = useEditStore()

function addLinearMask(): void {
  editStore.addLinearMask({
    id: crypto.randomUUID(),
    start: { x: 0.3, y: 0.5 },
    end: { x: 0.7, y: 0.5 },
    feather: 0.5,
    enabled: true,
    adjustments: {},
  })
}

function addRadialMask(): void {
  editStore.addRadialMask({
    id: crypto.randomUUID(),
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.3,
    radiusY: 0.3,
    rotation: 0,
    feather: 0.3,
    invert: false,
    enabled: true,
    adjustments: {},
  })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">Masks</span>
      <UDropdownMenu :items="[
        [{ label: 'Linear Gradient', icon: 'i-heroicons-minus', click: addLinearMask }],
        [{ label: 'Radial Gradient', icon: 'i-heroicons-circle-stack', click: addRadialMask }],
      ]">
        <UButton size="xs" icon="i-heroicons-plus" variant="ghost" />
      </UDropdownMenu>
    </div>

    <div v-if="!editStore.masks || (editStore.masks.linearMasks.length === 0 && editStore.masks.radialMasks.length === 0)"
         class="text-xs text-gray-500 text-center py-4">
      No masks. Click + to add.
    </div>

    <div v-else class="space-y-1">
      <div v-for="mask in editStore.masks?.linearMasks" :key="mask.id"
           class="flex items-center gap-2 p-2 rounded cursor-pointer"
           :class="editStore.selectedMaskId === mask.id ? 'bg-blue-500/20' : 'hover:bg-gray-500/10'"
           @click="editStore.selectMask(mask.id)">
        <UButton size="xs" variant="ghost"
                 :icon="mask.enabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
                 @click.stop="editStore.toggleMaskEnabled(mask.id)" />
        <UIcon name="i-heroicons-minus" class="text-gray-500" />
        <span class="text-sm flex-1">Linear Gradient</span>
        <UButton size="xs" variant="ghost" icon="i-heroicons-trash"
                 @click.stop="editStore.deleteMask(mask.id)" />
      </div>

      <div v-for="mask in editStore.masks?.radialMasks" :key="mask.id"
           class="flex items-center gap-2 p-2 rounded cursor-pointer"
           :class="editStore.selectedMaskId === mask.id ? 'bg-blue-500/20' : 'hover:bg-gray-500/10'"
           @click="editStore.selectMask(mask.id)">
        <UButton size="xs" variant="ghost"
                 :icon="mask.enabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
                 @click.stop="editStore.toggleMaskEnabled(mask.id)" />
        <UIcon name="i-heroicons-circle-stack" class="text-gray-500" />
        <span class="text-sm flex-1">Radial Gradient</span>
        <UButton size="xs" variant="ghost" icon="i-heroicons-trash"
                 @click.stop="editStore.deleteMask(mask.id)" />
      </div>
    </div>

    <!-- Per-mask adjustments -->
    <EditMaskAdjustments v-if="editStore.selectedMask" />
  </div>
</template>
```

---

### Phase 8: Copy/Paste Integration

**Goal**: Add masks to the copy/paste system.

**Files to Modify**:
1. `apps/web/app/stores/editClipboard.ts` - Add masks to copy groups
2. `apps/web/app/composables/useCopyPasteSettings.ts` - Handle mask copy/paste
3. `apps/web/app/components/edit/EditCopySettingsModal.vue` - Add masks checkbox

**Implementation Details**:

```typescript
// apps/web/app/stores/editClipboard.ts - Update CopyGroups
export interface CopyGroups {
  basicAdjustments: boolean
  toneCurve: boolean
  crop: boolean
  rotation: boolean
  masks: boolean  // NEW - defaults to false
}

export function createDefaultCopyGroups(): CopyGroups {
  return {
    basicAdjustments: true,
    toneCurve: true,
    crop: true,
    rotation: true,
    masks: false,  // Off by default since masks are position-specific
  }
}
```

```typescript
// apps/web/app/composables/useCopyPasteSettings.ts - Handle masks in copy/paste

function copySettings(): void {
  // ... existing copy logic ...

  if (copyGroups.masks && editStore.masks) {
    clipboard.value.masks = JSON.parse(JSON.stringify(editStore.masks))
  }
}

function pasteSettings(): void {
  // ... existing paste logic ...

  if (copyGroups.masks && clipboard.value.masks) {
    editStore.masks = JSON.parse(JSON.stringify(clipboard.value.masks))
  }
}
```

---

### Phase 9: Testing and Polish

**Goal**: Add tests, keyboard shortcuts, and final polish.

**Files to Create**:
1. `crates/literoom-core/src/mask/tests.rs` - Additional Rust tests
2. `packages/core/src/catalog/mask.test.ts` - TypeScript mask tests

**Files to Modify**:
3. `apps/web/app/pages/edit/[id].vue` - Add keyboard shortcuts

**Keyboard Shortcuts**:
- `M` - Toggle mask overlay visibility
- `Delete/Backspace` - Delete selected mask
- `Tab` - Cycle through masks

---

## Summary

| Phase | Description | Files | Status |
|-------|-------------|-------|--------|
| Phase 1 | TypeScript Types and Schema | 1 | Complete |
| Phase 2 | Rust Mask Implementation | 5 | Complete |
| Phase 3 | WASM Bindings | 2 | Complete |
| Phase 4 | Worker Integration | 5 | Pending |
| Phase 5 | Edit Store Integration | 1 | Pending |
| Phase 6 | Preview Pipeline Integration | 1 | Pending |
| Phase 7 | Mask Editor UI | 7 | Pending |
| Phase 8 | Copy/Paste Integration | 3 | Pending |
| Phase 9 | Testing and Polish | 3 | Pending |

**Total**: ~28 files across 9 phases

## Testing Strategy

1. **Unit Tests (Rust)**:
   - Linear mask evaluation at known coordinates
   - Radial mask evaluation with rotation
   - Feathering smoothness (no visual banding)
   - Invert behavior
   - Boundary conditions

2. **Unit Tests (TypeScript)**:
   - Schema migration v3 → v4
   - Mask CRUD operations in store
   - Copy/paste with masks

3. **Integration Tests**:
   - WASM binding correctness
   - Worker communication
   - Preview pipeline with masks

4. **Visual Verification**:
   - Overlay rendering
   - Handle interaction
   - Performance at 4K resolution

## Dependencies

- Existing: `serde`, `serde-wasm-bindgen` (for WASM serialization)
- No new Rust crates required

## Performance Considerations

- Early exit when mask = 0 or 1 (no blending needed)
- Per-pixel mask evaluation is O(pixels × masks)
- Consider adaptive quality during drag (50% resolution)
- Future: SIMD optimization, Rayon parallelization
