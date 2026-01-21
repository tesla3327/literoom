# Phase 10: Histogram Display - Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [Histogram Display Synthesis](../research/2026-01-21-histogram-display-synthesis.md)

---

## Overview

Phase 10 implements the histogram display for the photo editing view. The histogram shows RGB channel distribution with highlight/shadow clipping indicators, updating in real-time as adjustments are applied.

**Goal**: Users can see histogram visualization of their photo's tonal distribution, with clipping warnings for overexposed (255) and underexposed (0) pixels.

---

## Implementation Phases

### Phase 10.1: Rust Histogram Module

**Goal**: Implement `compute_histogram()` function in Rust.

#### 10.1.1 Create `crates/literoom-core/src/histogram.rs`

```rust
//! Histogram computation from RGB pixel data.

use crate::Histogram;

/// Compute RGB and luminance histograms from pixel data.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, row-major)
/// * `width` - Image width (for validation)
/// * `height` - Image height (for validation)
///
/// # Returns
/// Histogram with all four channels populated
///
/// # Example
/// ```
/// let pixels = vec![255, 0, 0, 0, 255, 0]; // Red, Green pixels
/// let hist = compute_histogram(&pixels, 2, 1);
/// assert_eq!(hist.red[255], 1);
/// assert_eq!(hist.green[255], 1);
/// ```
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> Histogram {
    let mut hist = Histogram::new();

    let expected_len = (width as usize) * (height as usize) * 3;
    debug_assert!(
        pixels.len() == expected_len,
        "Pixel data size mismatch. Expected {}, got {}",
        expected_len,
        pixels.len()
    );

    // Process pixels in chunks of 3 (RGB)
    for chunk in pixels.chunks_exact(3) {
        let r = chunk[0] as usize;
        let g = chunk[1] as usize;
        let b = chunk[2] as usize;

        // Bin RGB channels
        hist.red[r] += 1;
        hist.green[g] += 1;
        hist.blue[b] += 1;

        // Compute and bin luminance (ITU-R BT.709)
        let lum = calculate_luminance_u8(chunk[0], chunk[1], chunk[2]);
        hist.luminance[lum as usize] += 1;
    }

    hist
}

/// Calculate luminance from RGB using ITU-R BT.709 coefficients.
/// Returns value in range 0-255.
fn calculate_luminance_u8(r: u8, g: u8, b: u8) -> u8 {
    let lum = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
    lum.round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_histogram() {
        let pixels = vec![];
        let hist = compute_histogram(&pixels, 0, 0);
        assert_eq!(hist.max_value(), 0);
    }

    #[test]
    fn test_single_red_pixel() {
        let pixels = vec![255, 0, 0];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.green[0], 1);
        assert_eq!(hist.blue[0], 1);
        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }

    #[test]
    fn test_rgb_primary_colors() {
        let pixels = vec![
            255, 0, 0,   // Red
            0, 255, 0,   // Green
            0, 0, 255,   // Blue
        ];
        let hist = compute_histogram(&pixels, 3, 1);
        assert_eq!(hist.red[255], 1);
        assert_eq!(hist.red[0], 2);
        assert_eq!(hist.green[255], 1);
        assert_eq!(hist.green[0], 2);
        assert_eq!(hist.blue[255], 1);
        assert_eq!(hist.blue[0], 2);
    }

    #[test]
    fn test_grayscale_midtone() {
        let pixels = vec![128, 128, 128];
        let hist = compute_histogram(&pixels, 1, 1);
        assert_eq!(hist.red[128], 1);
        assert_eq!(hist.green[128], 1);
        assert_eq!(hist.blue[128], 1);
        assert_eq!(hist.luminance[128], 1);
        assert!(!hist.has_highlight_clipping());
        assert!(!hist.has_shadow_clipping());
    }

    #[test]
    fn test_luminance_calculation() {
        // Pure white
        assert_eq!(calculate_luminance_u8(255, 255, 255), 255);
        // Pure black
        assert_eq!(calculate_luminance_u8(0, 0, 0), 0);
        // Gray
        let lum = calculate_luminance_u8(128, 128, 128);
        assert!((lum as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_max_value() {
        let pixels = vec![
            100, 100, 100,
            100, 100, 100,
            100, 100, 100,
            200, 200, 200, // Only one bright pixel
        ];
        let hist = compute_histogram(&pixels, 4, 1);
        assert_eq!(hist.red[100], 3);
        assert_eq!(hist.red[200], 1);
        assert_eq!(hist.max_value(), 3);
    }

    #[test]
    fn test_large_image() {
        // 100x100 image = 10,000 pixels
        let pixels = vec![128u8; 100 * 100 * 3];
        let hist = compute_histogram(&pixels, 100, 100);
        assert_eq!(hist.red[128], 10_000);
        assert_eq!(hist.max_value(), 10_000);
    }
}
```

#### 10.1.2 Update `crates/literoom-core/src/lib.rs`

Add module export:

```rust
pub mod histogram;
pub use histogram::compute_histogram;
```

#### 10.1.3 Verification

- [ ] `cargo test -p literoom-core` passes
- [ ] `cargo clippy -p literoom-core` has no warnings
- [ ] `cargo fmt --check` passes

---

### Phase 10.2: WASM Bindings

**Goal**: Expose `compute_histogram()` to JavaScript via WASM.

#### 10.2.1 Create `crates/literoom-wasm/src/histogram.rs`

```rust
//! Histogram computation WASM bindings.

use literoom_core::histogram::compute_histogram as compute_histogram_core;
use wasm_bindgen::prelude::*;

/// Histogram result accessible from JavaScript.
#[wasm_bindgen]
pub struct JsHistogram {
    red: Vec<u32>,
    green: Vec<u32>,
    blue: Vec<u32>,
    luminance: Vec<u32>,
    max_value: u32,
    has_highlight_clipping: bool,
    has_shadow_clipping: bool,
}

#[wasm_bindgen]
impl JsHistogram {
    /// Get red channel histogram (256 bins).
    pub fn red(&self) -> Vec<u32> {
        self.red.clone()
    }

    /// Get green channel histogram (256 bins).
    pub fn green(&self) -> Vec<u32> {
        self.green.clone()
    }

    /// Get blue channel histogram (256 bins).
    pub fn blue(&self) -> Vec<u32> {
        self.blue.clone()
    }

    /// Get luminance histogram (256 bins).
    pub fn luminance(&self) -> Vec<u32> {
        self.luminance.clone()
    }

    /// Get maximum bin value across all RGB channels.
    pub fn max_value(&self) -> u32 {
        self.max_value
    }

    /// Check if any channel has values at 255.
    pub fn has_highlight_clipping(&self) -> bool {
        self.has_highlight_clipping
    }

    /// Check if any channel has values at 0.
    pub fn has_shadow_clipping(&self) -> bool {
        self.has_shadow_clipping
    }
}

/// Compute histogram from RGB pixel data.
///
/// # Arguments
/// * `pixels` - RGB pixel data as Uint8Array (3 bytes per pixel)
/// * `width` - Image width
/// * `height` - Image height
///
/// # Returns
/// JsHistogram with all channel data and clipping info
#[wasm_bindgen]
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> JsHistogram {
    let hist = compute_histogram_core(pixels, width, height);

    JsHistogram {
        red: hist.red.to_vec(),
        green: hist.green.to_vec(),
        blue: hist.blue.to_vec(),
        luminance: hist.luminance.to_vec(),
        max_value: hist.max_value(),
        has_highlight_clipping: hist.has_highlight_clipping(),
        has_shadow_clipping: hist.has_shadow_clipping(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_histogram_creation() {
        let pixels = vec![255, 0, 0, 0, 255, 0, 0, 0, 255];
        let hist = compute_histogram(&pixels, 3, 1);

        assert_eq!(hist.red().len(), 256);
        assert_eq!(hist.green().len(), 256);
        assert_eq!(hist.blue().len(), 256);
        assert_eq!(hist.luminance().len(), 256);
        assert!(hist.has_highlight_clipping());
        assert!(hist.has_shadow_clipping());
    }
}
```

#### 10.2.2 Update `crates/literoom-wasm/src/lib.rs`

Add module and export:

```rust
mod histogram;

pub use histogram::{compute_histogram, JsHistogram};
```

#### 10.2.3 Build WASM

```bash
pnpm wasm:build
```

#### 10.2.4 Verification

- [ ] WASM builds without errors
- [ ] TypeScript types include `compute_histogram` function
- [ ] TypeScript types include `JsHistogram` class

---

### Phase 10.3: Worker Integration

**Goal**: Add histogram computation to the worker/service pipeline.

#### 10.3.1 Update `packages/core/src/decode/worker-messages.ts`

Add message types:

```typescript
/**
 * Request to compute histogram from pixel data.
 */
export interface ComputeHistogramRequest {
  id: string
  type: 'compute-histogram'
  pixels: Uint8Array
  width: number
  height: number
}

/**
 * Histogram computation result.
 */
export interface HistogramResponse {
  id: string
  type: 'histogram'
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminance: Uint32Array
  maxValue: number
  hasHighlightClipping: boolean
  hasShadowClipping: boolean
}

// Update DecodeRequest union
export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest
  | ApplyAdjustmentsRequest
  | ComputeHistogramRequest  // ADD

// Update DecodeResponse union
export type DecodeResponse =
  | DecodeSuccessResponse
  | FileTypeResponse
  | HistogramResponse  // ADD
  | DecodeErrorResponse
```

#### 10.3.2 Update `packages/core/src/decode/decode-worker.ts`

Add histogram handler:

```typescript
case 'compute-histogram': {
  const { pixels, width, height } = request

  // Compute histogram via WASM
  const histogram = wasm.compute_histogram(pixels, width, height)

  // Extract data
  const red = new Uint32Array(histogram.red())
  const green = new Uint32Array(histogram.green())
  const blue = new Uint32Array(histogram.blue())
  const luminance = new Uint32Array(histogram.luminance())

  // Free WASM memory
  histogram.free()

  const response: HistogramResponse = {
    id: request.id,
    type: 'histogram',
    red,
    green,
    blue,
    luminance,
    maxValue: histogram.max_value(),
    hasHighlightClipping: histogram.has_highlight_clipping(),
    hasShadowClipping: histogram.has_shadow_clipping(),
  }

  // Transfer buffers
  self.postMessage(response, [
    red.buffer,
    green.buffer,
    blue.buffer,
    luminance.buffer,
  ])
  break
}
```

#### 10.3.3 Update `packages/core/src/decode/types.ts`

Add histogram data type:

```typescript
/**
 * Histogram data for an image.
 */
export interface HistogramData {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminance: Uint32Array
  maxValue: number
  hasHighlightClipping: boolean
  hasShadowClipping: boolean
}
```

#### 10.3.4 Update `packages/core/src/decode/decode-service.ts`

Add method to interface and class:

```typescript
// In IDecodeService interface
export interface IDecodeService {
  // ... existing methods ...

  /**
   * Compute histogram from pixel data.
   */
  computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): Promise<HistogramData>
}

// In DecodeService class
async computeHistogram(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<HistogramData> {
  const request: ComputeHistogramRequest = {
    id: crypto.randomUUID(),
    type: 'compute-histogram',
    pixels,
    width,
    height,
  }
  return this.sendRequest(request)
}
```

Also add to `MockDecodeService`:

```typescript
async computeHistogram(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<HistogramData> {
  await this.delay(this.options.thumbnailDelay ?? 10)

  // Generate mock histogram
  const red = new Uint32Array(256)
  const green = new Uint32Array(256)
  const blue = new Uint32Array(256)
  const luminance = new Uint32Array(256)

  // Fill with bell-curve-like distribution
  for (let i = 0; i < 256; i++) {
    const value = Math.floor(
      1000 * Math.exp(-Math.pow(i - 128, 2) / 5000)
    )
    red[i] = value
    green[i] = value
    blue[i] = value
    luminance[i] = value
  }

  return {
    red,
    green,
    blue,
    luminance,
    maxValue: 1000,
    hasHighlightClipping: false,
    hasShadowClipping: false,
  }
}
```

#### 10.3.5 Update `packages/core/src/decode/index.ts`

Export new types:

```typescript
export type { HistogramData } from './types'
export type { ComputeHistogramRequest, HistogramResponse } from './worker-messages'
```

#### 10.3.6 Verification

- [ ] TypeScript compiles without errors
- [ ] Worker handles compute-histogram messages
- [ ] Service method works with mock service

---

### Phase 10.4: Histogram Composable

**Goal**: Create Vue composable for histogram computation and display.

#### 10.4.1 Create `apps/web/app/composables/useHistogramDisplay.ts`

```typescript
import type { HistogramData } from '@literoom/core/decode'

/**
 * Composable for histogram display in edit view.
 *
 * Computes histogram from preview pixels and renders to canvas.
 */
export function useHistogramDisplay(assetId: Ref<string>) {
  const { $decodeService } = useNuxtApp()
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()

  // Canvas reference
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  // Histogram state
  const histogram = ref<HistogramData | null>(null)
  const isComputing = ref(false)
  const error = ref<string | null>(null)

  // Clipping overlay toggles
  const showHighlightClipping = ref(false)
  const showShadowClipping = ref(false)

  // Source pixel cache (shared with preview composable)
  const sourceCache = ref<{
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  // Debounce utility
  function debounce<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number,
  ): T & { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = ((...args: unknown[]) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fn(...args), delay)
    }) as T & { cancel: () => void }
    debounced.cancel = () => {
      if (timer) clearTimeout(timer)
    }
    return debounced
  }

  /**
   * Load source pixels for histogram computation.
   */
  async function loadSource(id: string) {
    const asset = catalogStore.assets.get(id)
    if (!asset?.thumbnailUrl) return

    try {
      // Fetch and decode preview
      const response = await fetch(asset.thumbnailUrl)
      const blob = await response.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const decoded = await $decodeService.decodeJpeg(bytes)

      sourceCache.value = {
        pixels: decoded.pixels,
        width: decoded.width,
        height: decoded.height,
      }

      // Compute initial histogram
      await computeHistogram()
    } catch (e) {
      error.value = 'Failed to load source for histogram'
      console.error(e)
    }
  }

  /**
   * Compute histogram from current source pixels.
   */
  async function computeHistogram() {
    if (!sourceCache.value) return

    isComputing.value = true
    error.value = null

    try {
      histogram.value = await $decodeService.computeHistogram(
        sourceCache.value.pixels,
        sourceCache.value.width,
        sourceCache.value.height,
      )

      // Render to canvas
      renderHistogram()
    } catch (e) {
      error.value = 'Failed to compute histogram'
      console.error(e)
    } finally {
      isComputing.value = false
    }
  }

  /**
   * Render histogram to canvas.
   */
  function renderHistogram() {
    if (!canvasRef.value || !histogram.value) return

    const canvas = canvasRef.value
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const hist = histogram.value
    const max = hist.maxValue || 1

    // Clear background
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, width, height)

    if (max === 0) return

    // Draw RGB channels with alpha blending
    ctx.globalAlpha = 0.4

    for (let i = 0; i < 256; i++) {
      const x = (i / 256) * width
      const barWidth = Math.ceil(width / 256)

      // Red channel
      const redHeight = (hist.red[i] / max) * height
      ctx.fillStyle = 'rgb(255, 0, 0)'
      ctx.fillRect(x, height - redHeight, barWidth, redHeight)

      // Green channel
      const greenHeight = (hist.green[i] / max) * height
      ctx.fillStyle = 'rgb(0, 255, 0)'
      ctx.fillRect(x, height - greenHeight, barWidth, greenHeight)

      // Blue channel
      const blueHeight = (hist.blue[i] / max) * height
      ctx.fillStyle = 'rgb(0, 0, 255)'
      ctx.fillRect(x, height - blueHeight, barWidth, blueHeight)
    }

    ctx.globalAlpha = 1

    // Draw clipping indicators
    drawClippingIndicators(ctx, width, height, hist)
  }

  /**
   * Draw triangular clipping indicators.
   */
  function drawClippingIndicators(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hist: HistogramData,
  ) {
    const size = 8

    // Shadow clipping (top-left, blue)
    if (hist.hasShadowClipping) {
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(size, 0)
      ctx.lineTo(0, size)
      ctx.closePath()
      ctx.fill()
    }

    // Highlight clipping (top-right, red)
    if (hist.hasHighlightClipping) {
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.moveTo(width, 0)
      ctx.lineTo(width - size, 0)
      ctx.lineTo(width, size)
      ctx.closePath()
      ctx.fill()
    }
  }

  /**
   * Toggle both clipping overlays (J key behavior).
   */
  function toggleClippingOverlays() {
    if (showHighlightClipping.value || showShadowClipping.value) {
      showHighlightClipping.value = false
      showShadowClipping.value = false
    } else {
      showHighlightClipping.value = true
      showShadowClipping.value = true
    }
  }

  // Debounced histogram computation (500ms)
  const debouncedCompute = debounce(() => {
    computeHistogram()
  }, 500)

  // Watch asset changes
  watch(assetId, (id) => {
    debouncedCompute.cancel()
    error.value = null
    histogram.value = null
    loadSource(id)
  }, { immediate: true })

  // Watch adjustment changes
  watch(
    () => editStore.adjustments,
    () => {
      if (sourceCache.value) {
        debouncedCompute()
      }
    },
    { deep: true },
  )

  // Cleanup
  onUnmounted(() => {
    debouncedCompute.cancel()
  })

  return {
    canvasRef,
    histogram,
    isComputing,
    error,
    showHighlightClipping,
    showShadowClipping,
    toggleClippingOverlays,
  }
}
```

#### 10.4.2 Verification

- [ ] Composable compiles without errors
- [ ] Histogram renders correctly with mock data
- [ ] Debouncing works during slider drag

---

### Phase 10.5: Histogram Component

**Goal**: Create Vue component for histogram display.

#### 10.5.1 Create `apps/web/app/components/edit/HistogramDisplay.vue`

```vue
<script setup lang="ts">
/**
 * Histogram Display Component
 *
 * Shows RGB histogram with clipping indicators.
 * Updates in real-time as adjustments change.
 */

const props = defineProps<{
  assetId: string
}>()

const {
  canvasRef,
  histogram,
  isComputing,
  error,
  showHighlightClipping,
  showShadowClipping,
  toggleClippingOverlays,
} = useHistogramDisplay(toRef(props, 'assetId'))

// Keyboard shortcut handler
function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return
  }
  if (e.key === 'j' || e.key === 'J') {
    toggleClippingOverlays()
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="space-y-3" data-testid="histogram-display">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Histogram
      </h3>
      <span v-if="isComputing" class="text-xs text-gray-500">
        Computing...
      </span>
    </div>

    <!-- Canvas container -->
    <div
      class="relative aspect-[4/3] bg-gray-900 rounded overflow-hidden"
      data-testid="histogram-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="256"
        height="192"
        class="w-full h-full"
        data-testid="histogram-canvas"
      />

      <!-- Error overlay -->
      <div
        v-if="error"
        class="absolute inset-0 flex items-center justify-center bg-gray-900/80"
      >
        <span class="text-xs text-red-400">{{ error }}</span>
      </div>
    </div>

    <!-- Clipping toggles -->
    <div v-if="histogram" class="flex gap-4 text-xs">
      <button
        class="flex items-center gap-1.5 transition-opacity"
        :class="showShadowClipping ? 'opacity-100' : 'opacity-50'"
        @click="showShadowClipping = !showShadowClipping"
        data-testid="shadow-clipping-toggle"
      >
        <span
          class="w-2 h-2 rounded-sm"
          :class="histogram.hasShadowClipping ? 'bg-blue-500' : 'bg-gray-600'"
        />
        <span class="text-gray-400">Shadows</span>
      </button>

      <button
        class="flex items-center gap-1.5 transition-opacity"
        :class="showHighlightClipping ? 'opacity-100' : 'opacity-50'"
        @click="showHighlightClipping = !showHighlightClipping"
        data-testid="highlight-clipping-toggle"
      >
        <span
          class="w-2 h-2 rounded-sm"
          :class="histogram.hasHighlightClipping ? 'bg-red-500' : 'bg-gray-600'"
        />
        <span class="text-gray-400">Highlights</span>
      </button>
    </div>

    <!-- Keyboard hint -->
    <p class="text-xs text-gray-600">
      Press J to toggle clipping overlay
    </p>
  </div>
</template>
```

#### 10.5.2 Update `apps/web/app/pages/edit/[id].vue`

Replace histogram placeholder:

```vue
<!-- Left panel: histogram -->
<aside class="w-64 border-r border-gray-800 p-4 flex-shrink-0 overflow-y-auto">
  <div class="space-y-4">
    <!-- Histogram Display -->
    <HistogramDisplay :asset-id="assetId" />

    <!-- Quick info -->
    <div class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-gray-500">Format</span>
        <span class="text-gray-300">{{ asset?.extension?.toUpperCase() }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">Size</span>
        <span class="text-gray-300">{{ asset?.fileSize ? formatFileSize(asset.fileSize) : '-' }}</span>
      </div>
    </div>
  </div>
</aside>
```

#### 10.5.3 Verification

- [ ] Histogram displays in edit view
- [ ] Clipping indicators show correctly
- [ ] J key toggles overlay
- [ ] Updates when adjustments change

---

### Phase 10.6: Clipping Preview Overlay (Optional Enhancement)

**Goal**: Show clipped pixels on the preview image.

This phase can be deferred if time-constrained. The histogram indicators alone provide valuable feedback.

#### 10.6.1 Add overlay to EditPreviewCanvas

```typescript
// In useEditPreview.ts, add:
const showClippingOverlay = ref(false)
const clippingOverlayType = ref<'highlight' | 'shadow' | 'both'>('both')

// Render clipping overlay after preview
function renderClippingOverlay() {
  // Create overlay canvas
  // For each pixel, if clipped, set overlay color
  // Composite with preview
}
```

#### 10.6.2 Verification

- [ ] Clipped pixels highlighted in preview
- [ ] Toggle works with histogram controls
- [ ] Performance acceptable during slider drag

---

## File Summary

```
crates/
├── literoom-core/
│   └── src/
│       ├── lib.rs              # 10.1.2 - Add mod histogram
│       └── histogram.rs        # 10.1.1 - NEW: Histogram computation
└── literoom-wasm/
    └── src/
        ├── lib.rs              # 10.2.2 - Export compute_histogram
        └── histogram.rs        # 10.2.1 - NEW: WASM bindings

packages/core/src/decode/
├── types.ts                    # 10.3.3 - Add HistogramData
├── worker-messages.ts          # 10.3.1 - Add histogram types
├── decode-worker.ts            # 10.3.2 - Add histogram handler
├── decode-service.ts           # 10.3.4 - Add computeHistogram
└── index.ts                    # 10.3.5 - Export types

apps/web/app/
├── composables/
│   └── useHistogramDisplay.ts  # 10.4.1 - NEW: Histogram composable
├── components/edit/
│   └── HistogramDisplay.vue    # 10.5.1 - NEW: Histogram component
└── pages/
    └── edit/[id].vue           # 10.5.2 - Integrate histogram
```

---

## Verification Checklist

After all phases complete:

**Rust (Phase 10.1):**
- [ ] `compute_histogram()` function works correctly
- [ ] Unit tests pass
- [ ] Clipping detection accurate
- [ ] Performance acceptable (<15ms for preview size)

**WASM (Phase 10.2):**
- [ ] WASM builds successfully
- [ ] `compute_histogram` exported
- [ ] `JsHistogram` accessible from TypeScript

**Worker/Service (Phase 10.3):**
- [ ] Message types compile
- [ ] Worker handles compute-histogram
- [ ] Service method works
- [ ] Mock service provides realistic data

**Composable (Phase 10.4):**
- [ ] Histogram computes on asset load
- [ ] Debouncing prevents excessive computation
- [ ] Canvas renders correctly

**Component (Phase 10.5):**
- [ ] Histogram displays in edit view
- [ ] RGB channels overlaid with alpha
- [ ] Clipping indicators appear when clipping detected
- [ ] J key toggles overlay state
- [ ] Updates during adjustment changes

---

## Performance Targets

| Operation | Target | Measured |
|-----------|--------|----------|
| Histogram computation (256px) | <5ms | |
| Histogram computation (2560px) | <15ms | |
| Canvas render | <10ms | |
| Total update latency | <100ms | |

---

## Future Enhancements (Post Phase 10)

1. **Clipping preview overlay**: Highlight clipped pixels on main preview
2. **Configurable thresholds**: User-adjustable 250/5 thresholds
3. **Per-channel toggle**: Show/hide individual R/G/B channels
4. **Luminance overlay**: Option to show luminance histogram
5. **Histogram zoom**: Click to expand histogram detail view
