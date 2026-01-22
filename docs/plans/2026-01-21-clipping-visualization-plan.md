# Clipping Visualization Improvements - Implementation Plan

## Date: 2026-01-21

## Overview

Implement per-channel clipping visualization like Lightroom, showing which specific channels (R, G, B) are clipped with appropriate color coding.

## Phase 1: Update Data Structures

### 1.1 Update ClippingMap Interface (`useEditPreview.ts`)

Replace the simple 2-bit encoding with a 6-bit per-channel encoding:

```typescript
/**
 * Clipping map data for overlay rendering.
 * Each pixel is encoded as a 6-bit field:
 * - Bit 0 (1): R shadow (R = 0)
 * - Bit 1 (2): G shadow (G = 0)
 * - Bit 2 (4): B shadow (B = 0)
 * - Bit 3 (8): R highlight (R = 255)
 * - Bit 4 (16): G highlight (G = 255)
 * - Bit 5 (32): B highlight (B = 255)
 */
export interface ClippingMap {
  /** Per-channel clipping data (6-bit encoding per pixel) */
  data: Uint8Array
  /** Width of the image */
  width: number
  /** Height of the image */
  height: number
  /** Per-channel shadow clipping presence */
  shadowClipping: { r: boolean; g: boolean; b: boolean }
  /** Per-channel highlight clipping presence */
  highlightClipping: { r: boolean; g: boolean; b: boolean }
}
```

### 1.2 Update detectClippedPixels Function

```typescript
// Bit masks
const SHADOW_R = 1
const SHADOW_G = 2
const SHADOW_B = 4
const HIGHLIGHT_R = 8
const HIGHLIGHT_G = 16
const HIGHLIGHT_B = 32

function detectClippedPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
): ClippingMap {
  const pixelCount = width * height
  const data = new Uint8Array(pixelCount)
  const shadowClipping = { r: false, g: false, b: false }
  const highlightClipping = { r: false, g: false, b: false }

  for (let i = 0, idx = 0; i < pixels.length; i += 3, idx++) {
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    let clipType = 0

    // Per-channel shadow clipping
    if (r === 0) {
      clipType |= SHADOW_R
      shadowClipping.r = true
    }
    if (g === 0) {
      clipType |= SHADOW_G
      shadowClipping.g = true
    }
    if (b === 0) {
      clipType |= SHADOW_B
      shadowClipping.b = true
    }

    // Per-channel highlight clipping
    if (r === 255) {
      clipType |= HIGHLIGHT_R
      highlightClipping.r = true
    }
    if (g === 255) {
      clipType |= HIGHLIGHT_G
      highlightClipping.g = true
    }
    if (b === 255) {
      clipType |= HIGHLIGHT_B
      highlightClipping.b = true
    }

    data[idx] = clipType
  }

  return {
    data,
    width,
    height,
    shadowClipping,
    highlightClipping,
  }
}
```

## Phase 2: Update Clipping Overlay

### 2.1 Add Color Mapping Functions (`useClippingOverlay.ts`)

```typescript
// Bit masks (same as detection)
const SHADOW_R = 1
const SHADOW_G = 2
const SHADOW_B = 4
const HIGHLIGHT_R = 8
const HIGHLIGHT_G = 16
const HIGHLIGHT_B = 32

/**
 * Get overlay color for highlight clipping.
 * Shows the clipped channels directly (R/G/B/Yellow/Magenta/Cyan/White).
 */
function getHighlightColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & HIGHLIGHT_R) !== 0
  const gClip = (clipBits & HIGHLIGHT_G) !== 0
  const bClip = (clipBits & HIGHLIGHT_B) !== 0

  return [
    rClip ? 255 : 0,
    gClip ? 255 : 0,
    bClip ? 255 : 0,
    128  // 50% opacity
  ]
}

/**
 * Get overlay color for shadow clipping.
 * Shows the remaining channels (complementary to clipped).
 * If R is clipped, we see Cyan (G+B remaining).
 */
function getShadowColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & SHADOW_R) !== 0
  const gClip = (clipBits & SHADOW_G) !== 0
  const bClip = (clipBits & SHADOW_B) !== 0

  // If all clipped, show black with some transparency
  if (rClip && gClip && bClip) {
    return [0, 0, 0, 160]
  }

  // Show remaining channels
  return [
    rClip ? 0 : 200,
    gClip ? 0 : 200,
    bClip ? 0 : 200,
    128
  ]
}
```

### 2.2 Update Render Function

```typescript
function render(): void {
  // ... setup ...

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const clipType = map.data[mapIdx]
      if (clipType === 0) continue

      const pixelIdx = (y * width + x) * 4

      // Check which types of clipping to show
      const hasShadow = (clipType & (SHADOW_R | SHADOW_G | SHADOW_B)) !== 0
      const hasHighlight = (clipType & (HIGHLIGHT_R | HIGHLIGHT_G | HIGHLIGHT_B)) !== 0

      const showShadow = editUIStore.showShadowClipping && hasShadow
      const showHighlight = editUIStore.showHighlightClipping && hasHighlight

      if (showShadow && showHighlight) {
        // Both - blend shadow and highlight colors
        const shadowColor = getShadowColor(clipType)
        const highlightColor = getHighlightColor(clipType)
        // Simple average blend
        pixels[pixelIdx] = (shadowColor[0] + highlightColor[0]) / 2
        pixels[pixelIdx + 1] = (shadowColor[1] + highlightColor[1]) / 2
        pixels[pixelIdx + 2] = (shadowColor[2] + highlightColor[2]) / 2
        pixels[pixelIdx + 3] = 160
      }
      else if (showShadow) {
        const color = getShadowColor(clipType)
        pixels[pixelIdx] = color[0]
        pixels[pixelIdx + 1] = color[1]
        pixels[pixelIdx + 2] = color[2]
        pixels[pixelIdx + 3] = color[3]
      }
      else if (showHighlight) {
        const color = getHighlightColor(clipType)
        pixels[pixelIdx] = color[0]
        pixels[pixelIdx + 1] = color[1]
        pixels[pixelIdx + 2] = color[2]
        pixels[pixelIdx + 3] = color[3]
      }
    }
  }
}
```

## Phase 3: Update Histogram Indicators

### 3.1 Add Triangle Color Helper (`EditHistogramDisplaySVG.vue`)

```typescript
function getTriangleColor(clipping: { r: boolean; g: boolean; b: boolean }): string {
  const { r, g, b } = clipping

  // All channels = white (true clipping)
  if (r && g && b) return '#ffffff'

  // Two channels = secondary color
  if (r && g) return '#ffff00'  // Yellow
  if (r && b) return '#ff00ff'  // Magenta
  if (g && b) return '#00ffff'  // Cyan

  // One channel = primary color
  if (r) return '#ff0000'
  if (g) return '#00ff00'
  if (b) return '#0000ff'

  // No clipping
  return 'transparent'
}
```

### 3.2 Update SVG Triangles

```vue
<!-- Shadow clipping indicator (top-left triangle) -->
<polygon
  v-if="hasShadowClipping"
  points="0,0 10,0 0,10"
  :fill="shadowTriangleColor"
/>

<!-- Highlight clipping indicator (top-right triangle) -->
<polygon
  v-if="hasHighlightClipping"
  :points="`${SVG_WIDTH},0 ${SVG_WIDTH - 10},0 ${SVG_WIDTH},10`"
  :fill="highlightTriangleColor"
/>
```

Where:
```typescript
const hasShadowClipping = computed(() =>
  histogram.value?.shadowClipping.r ||
  histogram.value?.shadowClipping.g ||
  histogram.value?.shadowClipping.b
)

const hasHighlightClipping = computed(() =>
  histogram.value?.highlightClipping.r ||
  histogram.value?.highlightClipping.g ||
  histogram.value?.highlightClipping.b
)

const shadowTriangleColor = computed(() =>
  histogram.value ? getTriangleColor(histogram.value.shadowClipping) : 'transparent'
)

const highlightTriangleColor = computed(() =>
  histogram.value ? getTriangleColor(histogram.value.highlightClipping) : 'transparent'
)
```

## Phase 4: Update Histogram Composable

### 4.1 Update Return Type (`useHistogramDisplaySVG.ts`)

The histogram composable needs to pass per-channel clipping info from the preview pipeline.

Option: Add `clippingInfo` to the return value or get it from the preview's ClippingMap.

Since the histogram is computed from the same adjusted pixels as the clipping map, we can:
1. Pass the clipping info from `useEditPreview` to the histogram component
2. Or compute it within the histogram composable

Simplest: Add props for clipping info to the histogram component.

## Files to Modify

1. `apps/web/app/composables/useEditPreview.ts`
   - Update ClippingMap interface
   - Update detectClippedPixels function

2. `apps/web/app/composables/useClippingOverlay.ts`
   - Add getHighlightColor and getShadowColor functions
   - Update render function for per-channel colors

3. `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`
   - Add getTriangleColor function
   - Add computed properties for triangle colors
   - Update triangle polygon elements
   - Add props for clipping info

4. `apps/web/app/pages/edit/[id].vue`
   - Pass clipping info from useEditPreview to histogram component

## Testing Plan

1. **Visual verification**:
   - Load image with red-channel-only clipping (e.g., red sunset)
   - Verify overlay shows red for highlights
   - Verify triangle shows red color

2. **All-channel clipping**:
   - Load overexposed image with blown whites
   - Verify overlay shows white
   - Verify triangle shows white

3. **Shadow clipping**:
   - Load underexposed image
   - Verify shadow overlay shows complementary colors
   - Verify triangle color matches clipped channels

4. **Toggle behavior**:
   - J key still toggles both overlays
   - Individual shadow/highlight buttons still work

## Estimated Effort

- Phase 1: 15 minutes (data structure updates)
- Phase 2: 20 minutes (overlay color mapping)
- Phase 3: 15 minutes (histogram indicators)
- Phase 4: 10 minutes (wiring)
- Testing: 15 minutes

Total: ~75 minutes
