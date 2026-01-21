# Phase 10: Histogram Display - Research Synthesis

**Date**: 2026-01-21
**Status**: Complete
**Phase**: Research Synthesis

---

## Executive Summary

This document synthesizes research findings from 5 parallel research areas to inform the Phase 10 implementation of histogram display for the Literoom photo editing application. The histogram feature enables users to see RGB channel distribution with highlight/shadow clipping indicators, updating in real-time as adjustments are applied.

**Key Decisions**:
1. **Rendering**: Canvas 2D with overlapping RGB channels using alpha blending
2. **Resolution**: 256px wide (1:1 bin-to-pixel mapping), 4:3 aspect ratio (~192px tall)
3. **Computation**: WASM-based, single-pass algorithm, computed from preview (not full-res)
4. **Integration**: Separate worker message type for flexibility and priority handling
5. **Debouncing**: 500ms for histogram (vs 300ms for preview) to prioritize visual feedback
6. **Clipping**: Red triangle for highlights, blue for shadows; optional preview overlay

---

## 1. Histogram Computation (Rust/WASM)

### Algorithm: Single-Pass Sequential Binning

```rust
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> Histogram {
    let mut hist = Histogram::default();

    for chunk in pixels.chunks_exact(3) {
        let r = chunk[0] as usize;
        let g = chunk[1] as usize;
        let b = chunk[2] as usize;

        hist.red[r] += 1;
        hist.green[g] += 1;
        hist.blue[b] += 1;

        // ITU-R BT.709 luminance
        let lum = (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32) as u8;
        hist.luminance[lum as usize] += 1;
    }

    hist
}
```

### Performance Characteristics

| Resolution | Pixel Count | Time | Memory |
|------------|-------------|------|--------|
| Preview 1x (2560×1707) | 4.3M | ~10-15ms | 4KB |
| Thumbnail (256×256) | 65K | <1ms | 4KB |

**Decision**: Compute from preview-resolution pixels (2560×max), not full resolution.

### Existing Infrastructure

The `Histogram` struct in `crates/literoom-core/src/lib.rs` is production-ready:
- 4 channels: red, green, blue, luminance (256 bins each)
- `max_value()` for normalization
- `has_highlight_clipping()` / `has_shadow_clipping()` methods
- Missing: `compute_histogram()` function (to be implemented)

---

## 2. Canvas Rendering

### Technology Choice: Canvas 2D

**Rationale**:
- Excellent performance for frequent redraws (30+ fps during slider drag)
- Already used in `useEditPreview.ts` for pixel rendering
- Direct pixel control for alpha blending
- GPU-accelerated in modern browsers

### RGB Channel Display: Overlapping with Alpha

```typescript
// Color scheme
const HISTOGRAM_COLORS = {
  red: 'rgba(255, 0, 0, 0.4)',
  green: 'rgba(0, 255, 0, 0.4)',
  blue: 'rgba(0, 0, 255, 0.4)',
  background: '#1a1a1a'
}

function drawHistogram(ctx: CanvasRenderingContext2D, hist: HistogramData) {
  const { width, height } = ctx.canvas
  const max = hist.maxValue

  // Clear background
  ctx.fillStyle = HISTOGRAM_COLORS.background
  ctx.fillRect(0, 0, width, height)

  // Draw each bin
  ctx.globalAlpha = 0.4
  for (let i = 0; i < 256; i++) {
    const x = i

    // Red channel
    ctx.fillStyle = 'rgb(255, 0, 0)'
    ctx.fillRect(x, height - (hist.red[i] / max) * height, 1, (hist.red[i] / max) * height)

    // Green channel
    ctx.fillStyle = 'rgb(0, 255, 0)'
    ctx.fillRect(x, height - (hist.green[i] / max) * height, 1, (hist.green[i] / max) * height)

    // Blue channel
    ctx.fillStyle = 'rgb(0, 0, 255)'
    ctx.fillRect(x, height - (hist.blue[i] / max) * height, 1, (hist.blue[i] / max) * height)
  }
  ctx.globalAlpha = 1
}
```

### Canvas Dimensions

- Internal: 256×192 (1:1 bin-to-pixel mapping)
- Display: Scale via CSS to fit container
- Aspect ratio: 4:3 (matches existing placeholder)

---

## 3. Clipping Indicators

### Histogram Visualization

**Highlight Clipping (bin 255)**:
- Red triangle indicator in top-right corner
- Red background/tint on bin 255
- Only shown when `histogram.has_highlight_clipping()` is true

**Shadow Clipping (bin 0)**:
- Blue triangle indicator in top-left corner
- Blue background/tint on bin 0
- Only shown when `histogram.has_shadow_clipping()` is true

### Preview Overlay

**Toggle Mechanism**:
- Click histogram triangles to toggle overlay
- Keyboard shortcut: `J` (industry standard from Lightroom)

**Overlay Rendering**:
- Semi-transparent colored overlay on clipped pixels
- Highlight clipping: Red overlay (`rgba(239, 68, 68, 0.3)`)
- Shadow clipping: Blue overlay (`rgba(59, 130, 246, 0.3)`)

### Threshold Values (Phase 10 MVP)

- Highlight: 255 (strict)
- Shadow: 0 (strict)
- Future: Configurable thresholds (250/5) for early warning

---

## 4. Worker/Service Integration

### Separate Message Type (Recommended)

```typescript
export interface ComputeHistogramRequest {
  id: string
  type: 'compute-histogram'
  pixels: Uint8Array
  width: number
  height: number
}

export interface HistogramResponse {
  id: string
  type: 'histogram'
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminance: Uint32Array
  hasHighlightClipping: boolean
  hasShadowClipping: boolean
  maxValue: number
}
```

**Rationale for separate message (not combined with adjustments)**:
1. Different lifecycle/priority
2. Independent debouncing strategies
3. Future flexibility (different resolutions)
4. Easier to disable independently

### Data Transfer

- Use Uint32Array Transferable (4 channels × 256 bins × 4 bytes = 4KB)
- Negligible overhead compared to pixel data transfer

### Service Method

```typescript
interface IDecodeService {
  computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData>
}
```

### Priority Queue

| Priority | Operation | Delay |
|----------|-----------|-------|
| IMMEDIATE | apply-adjustments (preview) | 300ms |
| NORMAL | compute-histogram | 500ms |

---

## 5. Existing Codebase State

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| Histogram struct | ✅ Ready | `crates/literoom-core/src/lib.rs` |
| Clipping detection | ✅ Ready | `Histogram::has_*_clipping()` |
| Worker infrastructure | ✅ Ready | `packages/core/src/decode/` |
| Debouncing pattern | ✅ Ready | `useEditPreview.ts` |
| UI placeholder | ✅ Ready | `edit/[id].vue` (w-64 sidebar) |

### What's Missing (Gaps)

| Gap | Priority | Files to Create/Modify |
|-----|----------|------------------------|
| `compute_histogram()` function | Critical | `literoom-core/src/histogram.rs` |
| WASM histogram binding | Critical | `literoom-wasm/src/histogram.rs` |
| Worker message types | Important | `worker-messages.ts` |
| Worker handler | Important | `decode-worker.ts` |
| Service method | Important | `decode-service.ts` |
| Histogram composable | Important | `useHistogramDisplay.ts` |
| Histogram component | Important | `HistogramDisplay.vue` |

---

## 6. Implementation Architecture

### Data Flow

```
Slider change → editStore.adjustments
    ↓
useEditPreview (watch)
    ↓
┌─────────────────┬─────────────────┐
│ debouncedRender │ debouncedHist   │
│ (300ms)         │ (500ms)         │
└────────┬────────┴────────┬────────┘
         ↓                  ↓
applyAdjustments     computeHistogram
(IMMEDIATE)          (NORMAL)
         ↓                  ↓
    WASM worker        WASM worker
         ↓                  ↓
    Preview canvas    Histogram canvas
```

### Component Structure

```
Edit Page
├── Left Panel (w-64)
│   ├── HistogramDisplay.vue
│   │   ├── Canvas element (256×192)
│   │   ├── Clipping indicators
│   │   └── Toggle controls
│   └── Asset info
├── Center Panel
│   └── EditPreviewCanvas.vue
│       └── Optional clipping overlay
└── Right Panel
    └── EditControlsPanel.vue
```

### Composable Design

```typescript
export function useHistogramDisplay(assetId: Ref<string>) {
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const histogram = ref<HistogramData | null>(null)
  const isComputing = ref(false)
  const showHighlightOverlay = ref(false)
  const showShadowOverlay = ref(false)

  // Watch adjustments, compute histogram with debounce
  // Render to canvas when histogram updates

  return {
    canvasRef,
    histogram,
    isComputing,
    showHighlightOverlay,
    showShadowOverlay,
    toggleClippingOverlay
  }
}
```

---

## 7. Performance Targets

| Operation | Target |
|-----------|--------|
| Histogram computation (preview 1x) | <15ms |
| Canvas render | <10ms |
| Total update latency | <100ms |
| Debounce delay | 500ms |

---

## 8. Implementation Phases

### Phase 10.1: Rust Histogram Module
- Create `crates/literoom-core/src/histogram.rs`
- Implement `compute_histogram(pixels, width, height) -> Histogram`
- Add unit tests

### Phase 10.2: WASM Bindings
- Create `crates/literoom-wasm/src/histogram.rs`
- Export `compute_histogram` function
- Return histogram as JsValue with Uint32Arrays

### Phase 10.3: Worker Integration
- Add `ComputeHistogramRequest` to worker-messages.ts
- Add handler in decode-worker.ts
- Add `computeHistogram()` to DecodeService

### Phase 10.4: Histogram Composable
- Create `useHistogramDisplay.ts`
- Debounced computation (500ms)
- Canvas rendering with alpha blending

### Phase 10.5: Vue Component
- Create `HistogramDisplay.vue`
- Replace placeholder in edit page
- Add clipping indicator triangles

### Phase 10.6: Clipping Overlay
- Add toggle controls for overlay
- Implement preview overlay rendering
- Add `J` keyboard shortcut

---

## 9. File Summary

### Files to Create

```
crates/literoom-core/src/histogram.rs       # Histogram computation
crates/literoom-wasm/src/histogram.rs       # WASM bindings
apps/web/app/composables/useHistogramDisplay.ts
apps/web/app/components/edit/HistogramDisplay.vue
apps/web/app/stores/histogram.ts            # Optional: separate store
```

### Files to Modify

```
crates/literoom-core/src/lib.rs             # Add mod histogram
crates/literoom-wasm/src/lib.rs             # Export compute_histogram
packages/core/src/decode/worker-messages.ts # Add histogram types
packages/core/src/decode/decode-worker.ts   # Add histogram handler
packages/core/src/decode/decode-service.ts  # Add computeHistogram method
packages/core/src/decode/index.ts           # Export new types
apps/web/app/pages/edit/[id].vue            # Replace histogram placeholder
apps/web/app/composables/useEditPreview.ts  # Add histogram integration
```

---

## 10. Key Recommendations

1. **Single-pass algorithm** for cache efficiency (O(n) linear time)
2. **Canvas 2D** for simplicity and established patterns
3. **Overlapping RGB** with 40% alpha for professional appearance
4. **Separate worker message** for flexibility and priority control
5. **500ms debounce** (longer than preview) to prioritize visual feedback
6. **Preview resolution** for histogram computation (not full-res)
7. **Clipping indicators** using industry-standard colors (red/blue)
8. **J keyboard shortcut** for toggling overlays (Lightroom convention)

---

## References

Research documents:
- Area 1: Histogram Computation (Rust/WASM)
- Area 2: Canvas Rendering (TypeScript/Vue)
- Area 3: Clipping Indicators
- Area 4: Worker/Service Integration
- Area 5: Existing Codebase Review
