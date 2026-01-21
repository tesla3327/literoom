# Phase 9: WASM Edit Pipeline - Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [WASM Edit Pipeline Synthesis](../research/2026-01-21-wasm-edit-pipeline-synthesis.md)

---

## Overview

Phase 9 implements the `apply_adjustments()` function that applies the 10 basic adjustments to image pixels. This enables real-time photo editing with responsive preview updates.

**Goal**: When users move adjustment sliders, the preview image updates with applied edits.

---

## Implementation Phases

### Phase 9.1: Rust Adjustment Module

**Goal**: Implement core adjustment algorithms in Rust.

#### 9.1.1 Create `crates/literoom-core/src/adjustments.rs`

```rust
//! Image adjustment algorithms
//!
//! Applies the 10 basic adjustments to RGB pixel data.

use crate::BasicAdjustments;

/// Apply all adjustments to an image's pixel data in place.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major order)
/// * `adjustments` - The adjustment values to apply
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

// Individual adjustment functions...
```

#### 9.1.2 Implement Individual Adjustments

**Exposure** (stops, -5 to +5):
```rust
fn apply_exposure(r: f32, g: f32, b: f32, exposure: f32) -> (f32, f32, f32) {
    if exposure == 0.0 { return (r, g, b); }
    let multiplier = 2.0_f32.powf(exposure);
    (r * multiplier, g * multiplier, b * multiplier)
}
```

**Contrast** (-100 to +100):
```rust
fn apply_contrast(r: f32, g: f32, b: f32, contrast: f32) -> (f32, f32, f32) {
    if contrast == 0.0 { return (r, g, b); }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = 0.5;
    (
        (r - midpoint) * factor + midpoint,
        (g - midpoint) * factor + midpoint,
        (b - midpoint) * factor + midpoint,
    )
}
```

**Temperature** (-100 to +100):
```rust
fn apply_temperature(r: f32, g: f32, b: f32, temperature: f32) -> (f32, f32, f32) {
    if temperature == 0.0 { return (r, g, b); }
    let shift = temperature / 100.0 * 0.3;
    if temperature < 0.0 {
        // Warmer: boost red, reduce blue
        (r * (1.0 + shift.abs()), g, b * (1.0 - shift.abs()))
    } else {
        // Cooler: reduce red, boost blue
        (r * (1.0 - shift), g, b * (1.0 + shift))
    }
}
```

**Tint** (-100 to +100):
```rust
fn apply_tint(r: f32, g: f32, b: f32, tint: f32) -> (f32, f32, f32) {
    if tint == 0.0 { return (r, g, b); }
    let shift = tint / 100.0 * 0.2;
    if tint < 0.0 {
        // Green tint
        (r, g * (1.0 + shift.abs()), b)
    } else {
        // Magenta tint (red + blue)
        (r * (1.0 + shift), g * (1.0 - shift), b * (1.0 + shift))
    }
}
```

**Luminance calculation**:
```rust
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    // ITU-R BT.709
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
```

**Highlights** (-100 to +100):
```rust
fn apply_highlights(r: f32, g: f32, b: f32, luminance: f32, highlights: f32) -> (f32, f32, f32) {
    if highlights == 0.0 { return (r, g, b); }
    let highlight_mask = smoothstep(0.5, 1.0, luminance);
    let factor = 1.0 + (highlights / 100.0) * highlight_mask;
    (r * factor, g * factor, b * factor)
}
```

**Shadows** (-100 to +100):
```rust
fn apply_shadows(r: f32, g: f32, b: f32, luminance: f32, shadows: f32) -> (f32, f32, f32) {
    if shadows == 0.0 { return (r, g, b); }
    let shadow_mask = smoothstep(0.0, 0.5, 1.0 - luminance);
    let factor = 1.0 + (shadows / 100.0) * shadow_mask;
    (r * factor, g * factor, b * factor)
}
```

**Whites** (-100 to +100):
```rust
fn apply_whites(r: f32, g: f32, b: f32, whites: f32) -> (f32, f32, f32) {
    if whites == 0.0 { return (r, g, b); }
    let max_channel = r.max(g).max(b);
    if max_channel > 0.9 {
        let factor = 1.0 + (whites / 100.0) * 0.3;
        (r * factor, g * factor, b * factor)
    } else {
        (r, g, b)
    }
}
```

**Blacks** (-100 to +100):
```rust
fn apply_blacks(r: f32, g: f32, b: f32, blacks: f32) -> (f32, f32, f32) {
    if blacks == 0.0 { return (r, g, b); }
    let min_channel = r.min(g).min(b);
    if min_channel < 0.1 {
        let factor = 1.0 + (blacks / 100.0) * 0.2;
        (r * factor, g * factor, b * factor)
    } else {
        (r, g, b)
    }
}
```

**Saturation** (-100 to +100):
```rust
fn apply_saturation(r: f32, g: f32, b: f32, saturation: f32) -> (f32, f32, f32) {
    if saturation == 0.0 { return (r, g, b); }
    let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let factor = 1.0 + (saturation / 100.0);
    (
        gray + (r - gray) * factor,
        gray + (g - gray) * factor,
        gray + (b - gray) * factor,
    )
}
```

**Vibrance** (-100 to +100):
```rust
fn apply_vibrance(r: f32, g: f32, b: f32, vibrance: f32) -> (f32, f32, f32) {
    if vibrance == 0.0 { return (r, g, b); }

    // Calculate current saturation
    let max_c = r.max(g).max(b);
    let min_c = r.min(g).min(b);
    let current_sat = if max_c > 0.0 { (max_c - min_c) / max_c } else { 0.0 };

    // Detect skin tones (simplified: R > G > B)
    let is_skin = r > g && g > b && (r - g) > 0.06;
    let skin_protection = if is_skin { 0.5 } else { 1.0 };

    // Less effect on already saturated colors
    let saturation_protection = 1.0 - current_sat;

    // Apply reduced vibrance
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    apply_saturation(r, g, b, effective_vibrance)
}
```

#### 9.1.3 Add module to lib.rs

```rust
pub mod adjustments;
pub use adjustments::apply_all_adjustments;
```

#### 9.1.4 Add Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity() {
        let mut pixels = vec![128, 64, 192];
        let adj = BasicAdjustments::default();
        apply_all_adjustments(&mut pixels, &adj);
        assert_eq!(pixels, vec![128, 64, 192]);
    }

    #[test]
    fn test_exposure_positive() {
        let mut pixels = vec![128, 128, 128];
        let mut adj = BasicAdjustments::default();
        adj.exposure = 1.0; // +1 stop = 2x brightness
        apply_all_adjustments(&mut pixels, &adj);
        assert_eq!(pixels, vec![255, 255, 255]); // Clipped at 255
    }

    #[test]
    fn test_exposure_negative() {
        let mut pixels = vec![128, 128, 128];
        let mut adj = BasicAdjustments::default();
        adj.exposure = -1.0; // -1 stop = 0.5x brightness
        apply_all_adjustments(&mut pixels, &adj);
        assert_eq!(pixels, vec![64, 64, 64]);
    }

    // ... more tests for each adjustment
}
```

#### 9.1.5 Verification

- [ ] All tests pass: `cargo test -p literoom-core`
- [ ] No clippy warnings: `cargo clippy -p literoom-core`
- [ ] Formatting: `cargo fmt --check`

---

### Phase 9.2: WASM Bindings

**Goal**: Expose `apply_adjustments()` to JavaScript.

#### 9.2.1 Update `crates/literoom-wasm/src/adjustments.rs`

Add the apply function:

```rust
use literoom_core::adjustments::apply_all_adjustments;
use crate::types::JsDecodedImage;
use wasm_bindgen::prelude::*;

/// Apply all adjustments to an image.
///
/// Takes ownership of the input image and returns a new adjusted image.
#[wasm_bindgen]
pub fn apply_adjustments(
    image: JsDecodedImage,
    adjustments: &BasicAdjustments,
) -> Result<JsDecodedImage, JsValue> {
    let width = image.width();
    let height = image.height();
    let mut pixels = image.pixels();

    apply_all_adjustments(&mut pixels, &adjustments.inner);

    Ok(JsDecodedImage::new(width, height, pixels))
}
```

#### 9.2.2 Update `crates/literoom-wasm/src/lib.rs`

Ensure the function is exported:

```rust
pub use adjustments::{BasicAdjustments, apply_adjustments};
```

#### 9.2.3 Build WASM

```bash
pnpm wasm:build
```

#### 9.2.4 Verification

- [ ] WASM builds without errors
- [ ] TypeScript types include `apply_adjustments` function
- [ ] Types include correct signature

---

### Phase 9.3: Worker Message Types

**Goal**: Define TypeScript types for adjustment requests/responses.

#### 9.3.1 Update `packages/core/src/decode/worker-messages.ts`

Add new message types:

```typescript
// Add to DecodeRequest union
export interface ApplyAdjustmentsRequest {
  id: string
  type: 'apply-adjustments'
  pixels: Uint8Array
  width: number
  height: number
  adjustments: {
    temperature: number
    tint: number
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    vibrance: number
    saturation: number
  }
}

export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest
  | ApplyAdjustmentsRequest  // Add this
```

#### 9.3.2 Update types.ts

Add Adjustments type if not exists:

```typescript
export interface Adjustments {
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
}
```

#### 9.3.3 Verification

- [ ] TypeScript compiles without errors
- [ ] Types are exported from index.ts

---

### Phase 9.4: Worker Handler

**Goal**: Handle apply-adjustments messages in the worker.

#### 9.4.1 Update `packages/core/src/decode/decode-worker.ts`

Add handler for apply-adjustments:

```typescript
case 'apply-adjustments': {
  const { pixels, width, height, adjustments } = request

  // Create BasicAdjustments instance
  const wasmAdj = new wasm.BasicAdjustments()
  wasmAdj.temperature = adjustments.temperature
  wasmAdj.tint = adjustments.tint
  wasmAdj.exposure = adjustments.exposure
  wasmAdj.contrast = adjustments.contrast
  wasmAdj.highlights = adjustments.highlights
  wasmAdj.shadows = adjustments.shadows
  wasmAdj.whites = adjustments.whites
  wasmAdj.blacks = adjustments.blacks
  wasmAdj.vibrance = adjustments.vibrance
  wasmAdj.saturation = adjustments.saturation

  // Create input image
  const inputImage = new wasm.JsDecodedImage(width, height, pixels)

  // Apply adjustments
  const outputImage = wasm.apply_adjustments(inputImage, wasmAdj)
  const outputPixels = outputImage.pixels()
  const outputWidth = outputImage.width()
  const outputHeight = outputImage.height()

  // Free WASM memory
  inputImage.free()
  outputImage.free()
  wasmAdj.free()

  const response: DecodeResponse = {
    id: request.id,
    type: 'success',
    width: outputWidth,
    height: outputHeight,
    pixels: outputPixels,
  }

  self.postMessage(response, [outputPixels.buffer])
  break
}
```

#### 9.4.2 Verification

- [ ] Worker compiles without errors
- [ ] Handler properly frees WASM memory

---

### Phase 9.5: Decode Service Method

**Goal**: Add `applyAdjustments()` method to DecodeService.

#### 9.5.1 Update `packages/core/src/decode/decode-service.ts`

Add method to IDecodeService interface:

```typescript
export interface IDecodeService {
  // ... existing methods ...

  /**
   * Apply adjustments to an image's pixel data.
   */
  applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments,
  ): Promise<DecodedImage>
}
```

Implement in DecodeService class:

```typescript
async applyAdjustments(
  pixels: Uint8Array,
  width: number,
  height: number,
  adjustments: Adjustments,
): Promise<DecodedImage> {
  const request: ApplyAdjustmentsRequest = {
    id: crypto.randomUUID(),
    type: 'apply-adjustments',
    pixels,
    width,
    height,
    adjustments,
  }
  return this.sendRequest(request)
}
```

#### 9.5.2 Update exports

Ensure Adjustments type is exported from index.ts.

#### 9.5.3 Verification

- [ ] Service compiles without errors
- [ ] Method signature matches interface

---

### Phase 9.6: Preview Integration

**Goal**: Wire the edit preview to apply adjustments.

#### 9.6.1 Update `apps/web/app/composables/useEditPreview.ts`

Replace the placeholder with actual WASM call:

```typescript
export function useEditPreview(assetId: Ref<string>) {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()

  const previewUrl = ref<string | null>(null)
  const isRendering = ref(false)
  const renderQuality = ref<'draft' | 'full'>('full')
  const error = ref<string | null>(null)

  // Source pixels (loaded once per asset)
  const sourcePixels = ref<Uint8Array | null>(null)
  const sourceWidth = ref(0)
  const sourceHeight = ref(0)

  // Load source image when asset changes
  async function loadSource(id: string) {
    const asset = catalogStore.assets.get(id)
    if (!asset?.thumbnailUrl) return

    try {
      // Fetch thumbnail as source (for now)
      const response = await fetch(asset.thumbnailUrl)
      const blob = await response.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())

      // Decode to get pixels
      const decoded = await $decodeService.decodeJpeg(bytes)
      sourcePixels.value = decoded.pixels
      sourceWidth.value = decoded.width
      sourceHeight.value = decoded.height

      // Show initial preview
      await renderPreview()
    } catch (e) {
      error.value = 'Failed to load source image'
      console.error(e)
    }
  }

  // Render preview with current adjustments
  async function renderPreview() {
    if (!sourcePixels.value) return

    isRendering.value = true
    renderQuality.value = 'draft'

    try {
      const adjustments = editStore.adjustments

      // Apply adjustments via WASM
      const result = await $decodeService.applyAdjustments(
        sourcePixels.value,
        sourceWidth.value,
        sourceHeight.value,
        adjustments,
      )

      // Convert pixels to blob URL
      const canvas = document.createElement('canvas')
      canvas.width = result.width
      canvas.height = result.height
      const ctx = canvas.getContext('2d')!
      const imageData = new ImageData(
        new Uint8ClampedArray(rgbToRgba(result.pixels)),
        result.width,
        result.height,
      )
      ctx.putImageData(imageData, 0, 0)

      // Revoke old URL
      if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value)
      }

      // Create new URL
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9)
      })
      previewUrl.value = URL.createObjectURL(blob)

      renderQuality.value = 'full'
    } catch (e) {
      error.value = 'Failed to apply adjustments'
      console.error(e)
    } finally {
      isRendering.value = false
    }
  }

  // Debounced render
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  function debouncedRender() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(renderPreview, 300)
  }

  // Watch adjustments
  watch(
    () => editStore.adjustments,
    () => {
      if (sourcePixels.value) {
        debouncedRender()
      }
    },
    { deep: true }
  )

  // Watch asset change
  watch(assetId, (id) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    error.value = null
    loadSource(id)
  }, { immediate: true })

  // Cleanup
  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
    }
  })

  return {
    previewUrl,
    isRendering,
    renderQuality,
    error,
  }
}

// Helper to convert RGB to RGBA
function rgbToRgba(rgb: Uint8Array): Uint8Array {
  const rgba = new Uint8Array((rgb.length / 3) * 4)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]
    rgba[j + 1] = rgb[i + 1]
    rgba[j + 2] = rgb[i + 2]
    rgba[j + 3] = 255 // Alpha
  }
  return rgba
}
```

#### 9.6.2 Verification

- [ ] Preview updates when sliders move
- [ ] Debouncing prevents excessive renders
- [ ] Memory is cleaned up (blob URLs revoked)

---

## File Summary

```
crates/
├── literoom-core/
│   └── src/
│       ├── lib.rs              # 9.1.3 - Add module export
│       └── adjustments.rs      # 9.1.1 - NEW: Adjustment algorithms
└── literoom-wasm/
    └── src/
        ├── lib.rs              # 9.2.2 - Export apply_adjustments
        └── adjustments.rs      # 9.2.1 - Add WASM binding

packages/core/src/decode/
├── types.ts                    # 9.3.2 - Add Adjustments type
├── worker-messages.ts          # 9.3.1 - Add ApplyAdjustmentsRequest
├── decode-worker.ts            # 9.4.1 - Add message handler
├── decode-service.ts           # 9.5.1 - Add applyAdjustments method
└── index.ts                    # 9.5.2 - Export Adjustments

apps/web/app/composables/
└── useEditPreview.ts           # 9.6.1 - Wire to WASM
```

---

## Verification Checklist

After all phases complete:

**Rust (Phase 9.1):**
- [ ] All adjustment algorithms implemented
- [ ] Unit tests pass for each adjustment
- [ ] Identity test passes (zero adjustments = no change)
- [ ] Boundary tests pass (extreme values don't crash)

**WASM (Phase 9.2):**
- [ ] WASM builds successfully
- [ ] `apply_adjustments` function exported
- [ ] TypeScript types generated correctly

**TypeScript (Phases 9.3-9.5):**
- [ ] Message types defined
- [ ] Worker handler implemented
- [ ] Service method implemented
- [ ] All code type-checks

**Integration (Phase 9.6):**
- [ ] Sliders update preview
- [ ] Debouncing works (no excessive renders)
- [ ] Quality indicators show correctly
- [ ] Memory cleanup works

**E2E Test:**
- [ ] Move exposure slider → preview gets brighter
- [ ] Move saturation slider → colors more vibrant
- [ ] Reset button → preview returns to original

---

## Performance Targets

| Operation | Target | Measured |
|-----------|--------|----------|
| Apply adjustments (256px thumbnail) | <50ms | |
| Apply adjustments (600px draft) | <100ms | |
| Apply adjustments (2560px full) | <300ms | |
| Preview update latency | <400ms | |

---

## Future Improvements (Post v1)

1. **Draft quality mode**: Use smaller resolution during drag
2. **Histogram computation**: Add `compute_histogram()` function
3. **SIMD optimization**: Use SIMD intrinsics for faster pixel processing
4. **Incremental updates**: Only recompute changed adjustments
