# Clipping Overlay Implementation Plan

## Overview

Implement the clipping overlay feature to show highlight/shadow clipped pixels on the preview canvas. This is a v1 acceptance criteria requirement.

## Phase 1: UI State Store

Create a shared store for clipping toggle state that can be accessed by both histogram and preview components.

### 1.1 Create `useEditUIStore`

**File**: `apps/web/app/stores/editUI.ts`

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEditUIStore = defineStore('editUI', () => {
  // Clipping overlay visibility
  const showHighlightClipping = ref(false)
  const showShadowClipping = ref(false)

  function toggleClippingOverlays(): void {
    const bothOn = showHighlightClipping.value && showShadowClipping.value
    showHighlightClipping.value = !bothOn
    showShadowClipping.value = !bothOn
  }

  function toggleShadowClipping(): void {
    showShadowClipping.value = !showShadowClipping.value
  }

  function toggleHighlightClipping(): void {
    showHighlightClipping.value = !showHighlightClipping.value
  }

  function resetClippingOverlays(): void {
    showHighlightClipping.value = false
    showShadowClipping.value = false
  }

  return {
    showHighlightClipping,
    showShadowClipping,
    toggleClippingOverlays,
    toggleShadowClipping,
    toggleHighlightClipping,
    resetClippingOverlays,
  }
})
```

### 1.2 Update Histogram Composables

**Files**:
- `apps/web/app/composables/useHistogramDisplay.ts`
- `apps/web/app/composables/useHistogramDisplaySVG.ts`

Changes:
1. Import `useEditUIStore`
2. Replace local `showHighlightClipping` and `showShadowClipping` refs with store refs
3. Replace local toggle functions with store functions
4. Update return type interface

## Phase 2: Clipping Detection

Add pixel-level clipping detection to the preview pipeline.

### 2.1 Add Detection Function to `useEditPreview.ts`

**File**: `apps/web/app/composables/useEditPreview.ts`

Add clipping detection function:

```typescript
interface ClippingMap {
  data: Uint8Array  // 0=none, 1=shadow, 2=highlight, 3=both
  width: number
  height: number
  hasShadowClipping: boolean
  hasHighlightClipping: boolean
}

function detectClippedPixels(
  pixels: Uint8Array,
  width: number,
  height: number
): ClippingMap {
  const pixelCount = width * height
  const data = new Uint8Array(pixelCount)
  let hasShadow = false
  let hasHighlight = false

  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const idx = i / 3
    let clipType = 0

    // Shadow clipping: any channel at minimum
    if (r === 0 || g === 0 || b === 0) {
      clipType |= 1
      hasShadow = true
    }

    // Highlight clipping: any channel at maximum
    if (r === 255 || g === 255 || b === 255) {
      clipType |= 2
      hasHighlight = true
    }

    data[idx] = clipType
  }

  return {
    data,
    width,
    height,
    hasShadowClipping: hasShadow,
    hasHighlightClipping: hasHighlight,
  }
}
```

### 2.2 Store Clipping Map in Composable State

Add to `useEditPreview.ts`:
- `clippingMap` ref to store detection results
- Update `renderPreview()` to compute clipping map after pixel processing
- Export `clippingMap` from composable

## Phase 3: Overlay Canvas Composable

Create a composable to manage the clipping overlay canvas.

### 3.1 Create `useClippingOverlay.ts`

**File**: `apps/web/app/composables/useClippingOverlay.ts`

```typescript
import { ref, watch, type Ref, type ComputedRef } from 'vue'
import { useEditUIStore } from '~/stores/editUI'

interface ClippingMap {
  data: Uint8Array
  width: number
  height: number
}

interface UseClippingOverlayOptions {
  canvasRef: Ref<HTMLCanvasElement | null>
  clippingMap: Ref<ClippingMap | null>
  previewWidth: Ref<number> | ComputedRef<number>
  previewHeight: Ref<number> | ComputedRef<number>
}

interface UseClippingOverlayReturn {
  render: () => void
}

const COLORS = {
  shadow: 'rgba(59, 130, 246, 0.4)',     // Blue with 40% opacity
  highlight: 'rgba(239, 68, 68, 0.4)',   // Red with 40% opacity
  both: 'rgba(168, 85, 247, 0.4)',       // Purple for both (optional)
}

export function useClippingOverlay(options: UseClippingOverlayOptions): UseClippingOverlayReturn {
  const { canvasRef, clippingMap, previewWidth, previewHeight } = options
  const editUIStore = useEditUIStore()

  function render(): void {
    const canvas = canvasRef.value
    const map = clippingMap.value
    if (!canvas || !map) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear previous overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Skip if neither clipping overlay is enabled
    if (!editUIStore.showHighlightClipping && !editUIStore.showShadowClipping) {
      return
    }

    // Calculate scale from clipping map to canvas
    const scaleX = canvas.width / map.width
    const scaleY = canvas.height / map.height

    // Create ImageData for efficient pixel manipulation
    const imageData = ctx.createImageData(canvas.width, canvas.height)
    const pixels = imageData.data

    // Shadow color (blue)
    const shadowR = 59, shadowG = 130, shadowB = 246, shadowA = 102  // 40%
    // Highlight color (red)
    const highlightR = 239, highlightG = 68, highlightB = 68, highlightA = 102

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        // Map canvas position to clipping map position
        const mapX = Math.floor(x / scaleX)
        const mapY = Math.floor(y / scaleY)
        const mapIdx = mapY * map.width + mapX
        const clipType = map.data[mapIdx]

        if (clipType === 0) continue

        const pixelIdx = (y * canvas.width + x) * 4

        const showShadow = editUIStore.showShadowClipping && (clipType & 1)
        const showHighlight = editUIStore.showHighlightClipping && (clipType & 2)

        if (showShadow && showHighlight) {
          // Both - use purple
          pixels[pixelIdx] = 168
          pixels[pixelIdx + 1] = 85
          pixels[pixelIdx + 2] = 247
          pixels[pixelIdx + 3] = 102
        } else if (showShadow) {
          pixels[pixelIdx] = shadowR
          pixels[pixelIdx + 1] = shadowG
          pixels[pixelIdx + 2] = shadowB
          pixels[pixelIdx + 3] = shadowA
        } else if (showHighlight) {
          pixels[pixelIdx] = highlightR
          pixels[pixelIdx + 1] = highlightG
          pixels[pixelIdx + 2] = highlightB
          pixels[pixelIdx + 3] = highlightA
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }

  // Re-render when toggles change
  watch(
    () => [editUIStore.showHighlightClipping, editUIStore.showShadowClipping],
    () => render(),
    { immediate: true }
  )

  // Re-render when clipping map updates
  watch(clippingMap, () => render())

  // Re-render when canvas dimensions change
  watch([previewWidth, previewHeight], () => {
    const canvas = canvasRef.value
    if (canvas) {
      canvas.width = previewWidth.value
      canvas.height = previewHeight.value
      render()
    }
  })

  return { render }
}
```

## Phase 4: Component Integration

### 4.1 Update `EditPreviewCanvas.vue`

**File**: `apps/web/app/components/edit/EditPreviewCanvas.vue`

Changes:
1. Add overlay canvas element
2. Import and use `useClippingOverlay` composable
3. Pass clipping map from `useEditPreview`

Template changes:
```vue
<template>
  <div class="relative w-full h-full">
    <!-- Existing preview image -->
    <img v-if="previewUrl" :src="previewUrl" ... />

    <!-- Clipping overlay canvas -->
    <canvas
      ref="clippingCanvasRef"
      class="absolute inset-0 pointer-events-none"
      :width="previewWidth"
      :height="previewHeight"
    />

    <!-- Existing status indicators -->
    ...
  </div>
</template>
```

### 4.2 Update Histogram Components

**Files**:
- `apps/web/app/components/edit/EditHistogramDisplay.vue`
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`

Changes:
1. Import `useEditUIStore`
2. Use store's toggle functions instead of composable's
3. Use store's refs for button styling

## Phase 5: Verification

### 5.1 Manual Testing Checklist

- [ ] J key toggles both overlays on/off
- [ ] Shadow button toggles blue overlay
- [ ] Highlight button toggles red overlay
- [ ] Overlay updates when preview updates
- [ ] Overlay clears when both toggles off
- [ ] Performance: no visible lag on toggle
- [ ] Colors match histogram indicators

### 5.2 Visual Verification

- [ ] Overexposed areas show red overlay
- [ ] Underexposed areas show blue overlay
- [ ] Overlay aligns correctly with preview image
- [ ] Overlay scales correctly on zoom

## File Summary

### New Files
1. `apps/web/app/stores/editUI.ts`
2. `apps/web/app/composables/useClippingOverlay.ts`

### Modified Files
1. `apps/web/app/composables/useHistogramDisplay.ts`
2. `apps/web/app/composables/useHistogramDisplaySVG.ts`
3. `apps/web/app/composables/useEditPreview.ts`
4. `apps/web/app/components/edit/EditPreviewCanvas.vue`
5. `apps/web/app/components/edit/EditHistogramDisplay.vue`
6. `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`

## Implementation Order

1. Phase 1.1: Create editUI store
2. Phase 1.2: Update histogram composables to use store
3. Phase 2.1-2.2: Add clipping detection to useEditPreview
4. Phase 3.1: Create useClippingOverlay composable
5. Phase 4.1: Update EditPreviewCanvas with overlay canvas
6. Phase 4.2: Update histogram components to use store
7. Phase 5: Verification and testing
