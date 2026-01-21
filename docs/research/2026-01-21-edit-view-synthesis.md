# Phase 8: Edit View - Research Synthesis

**Date**: 2026-01-21
**Status**: Research Complete
**Research Plan**: [Edit View Research Plan](./2026-01-21-edit-view-research-plan.md)

---

## Executive Summary

Phase 8 implements the core photo editing experience. The existing infrastructure provides:
- WASM-based image processing via Web Workers
- BasicAdjustments struct with all slider parameters
- Decode service with preview generation

Key gaps to address:
- No edit application pipeline (adjustments → pixels)
- ToneCurve and Histogram not exposed to TypeScript
- No crop/transform utilities
- No edit view UI components

---

## 1. Existing WASM/Rust Implementation

### BasicAdjustments (Fully Exposed ✅)

Location: `crates/literoom-core/src/lib.rs`

**Fields (all f32)**:
| Field | Range | Description |
|-------|-------|-------------|
| temperature | -100 to 100 | White balance temperature |
| tint | -100 to 100 | White balance tint |
| exposure | -5 to 5 | Exposure stops |
| contrast | -100 to 100 | Contrast adjustment |
| highlights | -100 to 100 | Highlight recovery |
| shadows | -100 to 100 | Shadow fill |
| whites | -100 to 100 | White point |
| blacks | -100 to 100 | Black point |
| vibrance | -100 to 100 | Selective saturation |
| saturation | -100 to 100 | Global saturation |

**Methods exposed to TypeScript**:
- Getters/setters for each property
- `is_default()` - Check if all values are zero
- `to_json()` / `from_json()` - Serialization

### ToneCurve (NOT Exposed ❌)

Location: `crates/literoom-core/src/lib.rs`

```rust
pub struct ToneCurve {
    pub points: Vec<CurvePoint>,  // Sorted by x
}

pub struct CurvePoint {
    pub x: f32,  // Input (0.0-1.0)
    pub y: f32,  // Output (0.0-1.0)
}
```

**Gap**: Needs WASM bindings in `literoom-wasm`

### Histogram (NOT Exposed ❌)

Location: `crates/literoom-core/src/lib.rs`

```rust
pub struct Histogram {
    pub red: [u32; 256],
    pub green: [u32; 256],
    pub blue: [u32; 256],
    pub luminance: [u32; 256],
}
```

**Methods**:
- `max_value()` - For normalization
- `has_highlight_clipping()` - Check if 255 bin has values
- `has_shadow_clipping()` - Check if 0 bin has values

**Gap**: Needs WASM bindings in `literoom-wasm`

### Crop/Transform (NOT Implemented ❌)

No existing types for:
- Crop rectangle
- Rotation angle
- Flip horizontal/vertical
- Straighten

**Gap**: Needs Rust types + WASM bindings

### Edit Application (NOT Implemented ❌)

**Critical Gap**: No function to apply BasicAdjustments to pixel data.

The decode pipeline only outputs raw RGB pixels. Adjustments must either:
1. Be applied in Rust/WASM (recommended for performance)
2. Be applied in JS/Canvas (simpler but slower)

---

## 2. UI Component Patterns (Nuxt UI 3.3.7)

### Slider Components

**USlider** - Primary component for adjustments
```vue
<USlider
  v-model="exposure"
  :min="-5"
  :max="5"
  :step="0.01"
  tooltip
/>
```

Props: `min`, `max`, `step`, `tooltip`, `orientation`, `color`, `size`

### Form Layout

**UFormField** - Labeled controls
```vue
<UFormField label="Exposure" orientation="horizontal" size="sm">
  <USlider v-model="exposure" :min="-5" :max="5" />
</UFormField>
```

### Collapsible Sections

**UAccordion** - For edit panel organization
```vue
<UAccordion
  :items="[
    { label: 'Basic', slot: 'basic' },
    { label: 'Tone Curve', slot: 'curve' },
    { label: 'Crop', slot: 'crop' }
  ]"
  type="single"
  collapsible
>
  <template #basic>...</template>
</UAccordion>
```

### Modal Patterns

**UModal** - For crop/settings dialogs (already used in PermissionRecovery)

```vue
<UModal v-model:open="showCrop" :dismissible="false">
  <template #header>Crop & Rotate</template>
  <template #body>...</template>
  <template #footer>
    <UButton variant="ghost" @click="cancel">Cancel</UButton>
    <UButton color="primary" @click="apply">Apply</UButton>
  </template>
</UModal>
```

---

## 3. Preview Canvas Architecture

### Recommended Approach

**Canvas 2D** for initial implementation:
- Simpler than WebGL
- Sufficient for preview display
- Can upgrade to WebGL later if needed

### Debouncing Strategy

Three-tier approach:

1. **Immediate (rAF)**: Update slider UI value display
2. **Debounced (300ms)**: Request draft preview render
3. **On Release**: Request full resolution render

```typescript
// UI updates at 60fps max
let isDirty = false
function scheduleUIUpdate() {
  if (!isDirty) {
    isDirty = true
    requestAnimationFrame(() => {
      updateSliderDisplay()
      isDirty = false
    })
  }
}

// WASM processing debounced
const debouncedRender = useDebounceFn(() => {
  renderPreview('draft')
}, 300)

// Full render on release
function handleSliderRelease() {
  renderPreview('full')
}
```

### Draft vs Full Render

| Mode | Resolution | Filter | Use Case |
|------|------------|--------|----------|
| Draft | 1280px max | bilinear | During slider drag |
| Full | 5120px max | lanczos3 | After slider release |

The decode service already supports this via `PreviewOptions.filter`.

### Zoom/Pan

Canvas 2D transform-based:
- Scale factor (0.1 to 5.0)
- Translation offset
- Mouse wheel for zoom
- Mouse drag for pan
- Consider `pan-zoom` library for touch support

---

## 4. Edit State Management

### EditState Type Definition

```typescript
interface EditState {
  version: number  // Schema version for migrations

  // Basic adjustments
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

  // Tone curve (optional, default is linear)
  toneCurve?: {
    points: Array<{ x: number; y: number }>
  }

  // Transform (optional)
  transform?: {
    rotation: number  // Degrees
    flipH: boolean
    flipV: boolean
  }

  // Crop (optional)
  crop?: {
    x: number
    y: number
    width: number
    height: number
    aspect?: string  // "1:1", "4:5", "16:9", "original", "free"
  }
}
```

### Database Storage

Already exists in `packages/core/src/catalog/db.ts`:
```typescript
interface EditRecord {
  assetId: number
  schemaVersion: number
  updatedAt: Date
  settings: string  // JSON serialized EditState
}
```

### Pinia Store Design

```typescript
// stores/edit.ts
export const useEditStore = defineStore('edit', () => {
  const currentAssetId = ref<string | null>(null)
  const editState = ref<EditState | null>(null)
  const isDirty = ref(false)

  function loadEditForAsset(assetId: string): Promise<void>
  function updateAdjustment(key: keyof Adjustments, value: number): void
  function saveEdit(): Promise<void>
  function resetToDefault(): void

  return { currentAssetId, editState, isDirty, ... }
})
```

---

## 5. Histogram and Clipping

### Histogram Computation

Two options:

1. **WASM-based** (recommended): Add `compute_histogram(pixels)` function to WASM
2. **JS-based**: Iterate pixels in main thread (slower but simpler)

### Histogram Rendering

Canvas 2D bar chart:
```typescript
function drawHistogram(ctx: CanvasRenderingContext2D, histogram: Histogram) {
  const maxVal = Math.max(...histogram.red, ...histogram.green, ...histogram.blue)
  const barWidth = ctx.canvas.width / 256

  // Draw RGB channels with transparency
  for (let i = 0; i < 256; i++) {
    const x = i * barWidth

    // Red
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'
    ctx.fillRect(x, ctx.canvas.height * (1 - histogram.red[i] / maxVal), barWidth, ...)

    // Green, Blue similar...
  }
}
```

### Clipping Overlay

Render as a separate layer on the preview canvas:
- Highlight clipping: Red tint on pixels where any channel > threshold (e.g., 250)
- Shadow clipping: Blue tint on pixels where all channels < threshold (e.g., 5)

Toggle via keyboard (J key) or button.

---

## 6. Implementation Strategy

### Vertical Slice Approach

To deliver value incrementally, implement in this order:

**Phase 8.1: Edit Page Shell**
- `/edit/[id]` route with basic layout
- Preview canvas displaying current asset
- Navigation back to grid
- Filmstrip at bottom

**Phase 8.2: Basic Adjustments UI**
- Slider panel with all 10 adjustment controls
- Visual feedback (value display)
- No actual image processing yet

**Phase 8.3: Edit State Persistence**
- Pinia store for edit state
- Load/save to IndexedDB
- Wire sliders to state

**Phase 8.4: WASM Edit Application**
- Add `apply_adjustments(pixels, adjustments)` to WASM
- Wire preview to apply adjustments
- Debounced rendering pipeline

**Phase 8.5: Histogram**
- Add histogram computation to WASM
- Canvas histogram display
- Clipping indicator overlay

**Phase 8.6: Tone Curve**
- Expose ToneCurve to TypeScript
- Interactive curve editor component
- Wire to preview pipeline

**Phase 8.7: Crop/Transform**
- Add crop/transform types to Rust
- Crop overlay UI
- Rotation slider
- Straighten tool

---

## 7. Technical Decisions

### Decision 1: Where to Apply Adjustments

**Options**:
1. **Rust/WASM** (recommended)
   - Pro: Fast, reusable, consistent with decode pipeline
   - Con: More work to expose

2. **JavaScript/Canvas**
   - Pro: Quick to implement
   - Con: Slower, duplicates logic

**Recommendation**: WASM for production, JS fallback for MVP

### Decision 2: Preview Resolution Strategy

Use 2-tier preview system:
- **Preview 1x** (2560px): Main edit preview
- **Preview 2x** (5120px): For zoom > 100%

Already defined in spec, decode service supports this.

### Decision 3: Histogram Update Frequency

Update histogram after debounced render completes (not during drag).
Reduces CPU usage while keeping histogram accurate to current edits.

---

## 8. Dependencies

No new dependencies required. Existing tools:
- Canvas API for preview
- WASM for processing
- Pinia for state
- Nuxt UI for controls
- VueUse for debounce utilities

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| WASM changes break existing decode | Add new functions, don't modify existing |
| Slider lag during drag | Aggressive debouncing + draft quality |
| Memory pressure with large previews | Recycle ImageData buffers, limit preview size |
| Histogram flicker | Only update on stable renders |

---

## Summary

Phase 8 builds the core editing experience on solid infrastructure. The main work is:
1. Exposing ToneCurve and Histogram to TypeScript
2. Implementing `apply_adjustments()` in WASM
3. Building the edit view UI components
4. Adding crop/transform types and utilities

The phased approach ensures each increment delivers value while building toward the complete v1 edit experience.
