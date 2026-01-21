# Histogram Update Fix - Implementation Plan

## Overview

Fix the histogram to update when edits are made by using adjusted pixels from the preview pipeline.

## Background

The histogram currently computes from source (thumbnail) pixels, not adjusted pixels. This is documented as an MVP design decision. The fix is to share adjusted pixels from `useEditPreview` with `useHistogramDisplay`.

## Prerequisites

- Research complete: `docs/research/2026-01-21-histogram-update-synthesis.md`

---

## Phase 1: Export Adjusted Pixels from useEditPreview

**Goal**: Make the final adjusted pixel data available for histogram computation.

### 1.1 Add State for Adjusted Pixels

In `apps/web/app/composables/useEditPreview.ts`:

```typescript
// Add to composable state
const adjustedPixels = shallowRef<Uint8Array | null>(null)
const adjustedDimensions = shallowRef<{ width: number; height: number } | null>(null)
```

### 1.2 Store Adjusted Pixels in Render Pipeline

After all transforms (rotation, crop, adjustments, tone curve), store the final pixels:

```typescript
// In renderPreview() after all transforms applied
adjustedPixels.value = finalPixels
adjustedDimensions.value = { width: finalWidth, height: finalHeight }
```

### 1.3 Export from Composable

```typescript
return {
  // Existing exports...
  adjustedPixels,
  adjustedDimensions,
}
```

### Files Modified
- `apps/web/app/composables/useEditPreview.ts`

---

## Phase 2: Update useHistogramDisplay to Use Adjusted Pixels

**Goal**: Compute histogram from adjusted pixels when available.

### 2.1 Accept Adjusted Pixels Parameter

Update the composable signature to accept optional adjusted pixels:

```typescript
export function useHistogramDisplay(
  canvasRef: Ref<HTMLCanvasElement | null>,
  adjustedPixelsRef?: Ref<Uint8Array | null>,
  adjustedDimensionsRef?: Ref<{ width: number; height: number } | null>,
)
```

### 2.2 Watch Adjusted Pixels

Add a watcher for adjusted pixels that triggers histogram recomputation:

```typescript
// Watch adjusted pixels if provided
if (adjustedPixelsRef && adjustedDimensionsRef) {
  watch(
    [adjustedPixelsRef, adjustedDimensionsRef],
    ([pixels, dims]) => {
      if (pixels && dims) {
        computeHistogramFromPixels(pixels, dims.width, dims.height)
      }
    },
    { immediate: true },
  )
}
```

### 2.3 Add Direct Pixel Computation

Add a function to compute histogram directly from pixel data:

```typescript
const computeHistogramFromPixels = async (
  pixels: Uint8Array,
  width: number,
  height: number,
) => {
  if (isComputing.value) return

  const gen = ++computeGeneration.value
  isComputing.value = true

  try {
    const result = await $decodeService.computeHistogram(pixels, width, height)
    if (gen !== computeGeneration.value) return // Stale

    histogram.value = result
    renderHistogram()
  } catch (error) {
    console.error('[useHistogramDisplay] Error computing histogram:', error)
  } finally {
    if (gen === computeGeneration.value) {
      isComputing.value = false
    }
  }
}
```

### 2.4 Remove Adjustment Watcher (Optional)

The existing watcher on `editStore.adjustments` can be removed or kept as a fallback.
The adjusted pixels watcher will be the primary trigger.

### Files Modified
- `apps/web/app/composables/useHistogramDisplay.ts`

---

## Phase 3: Update useHistogramDisplaySVG

**Goal**: Apply the same pattern to the SVG-based histogram implementation.

### 3.1 Accept Adjusted Pixels Parameter

Same changes as Phase 2.1 for the SVG composable.

### 3.2 Watch Adjusted Pixels

Same changes as Phase 2.2 for the SVG composable.

### 3.3 Add Direct Pixel Computation

Same changes as Phase 2.3 for the SVG composable.

### Files Modified
- `apps/web/app/composables/useHistogramDisplaySVG.ts`

---

## Phase 4: Wire Up in Edit Page

**Goal**: Connect the preview's adjusted pixels to the histogram.

### 4.1 Determine Connection Method

Option A: Direct composable access
- Histogram composable calls useEditPreview internally
- Pros: Simple, automatic
- Cons: Tight coupling

Option B: Props through component
- Page passes adjusted pixels from preview to histogram component
- Pros: Explicit data flow
- Cons: More prop drilling

**Decision**: Use Option A - histogram composable accesses preview composable directly,
or better: have the edit page provide adjusted pixels to histogram via component props.

### 4.2 Update EditHistogramDisplay Component

Accept `adjustedPixels` and `adjustedDimensions` props:

```vue
<script setup lang="ts">
const props = defineProps<{
  adjustedPixels?: Uint8Array | null
  adjustedDimensions?: { width: number; height: number } | null
}>()

const adjustedPixelsRef = toRef(props, 'adjustedPixels')
const adjustedDimensionsRef = toRef(props, 'adjustedDimensions')

const { isComputing, histogram, ... } = useHistogramDisplay(
  canvasRef,
  adjustedPixelsRef,
  adjustedDimensionsRef,
)
</script>
```

### 4.3 Update Edit Page to Pass Props

In `apps/web/app/pages/edit/[id].vue`:

```vue
<template>
  <EditHistogramDisplay
    :adjusted-pixels="adjustedPixels"
    :adjusted-dimensions="adjustedDimensions"
  />
</template>

<script setup>
const { previewUrl, adjustedPixels, adjustedDimensions } = useEditPreview(assetId)
</script>
```

### Files Modified
- `apps/web/app/components/edit/EditHistogramDisplay.vue`
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`
- `apps/web/app/pages/edit/[id].vue`

---

## Phase 5: Verification and Testing

### 5.1 Manual Testing
1. Load edit view with any image
2. Adjust exposure slider → histogram should shift right
3. Adjust contrast slider → histogram should spread/compress
4. Adjust temperature slider → RGB channels should shift
5. Adjust blacks slider down → shadow area of histogram should compress
6. Adjust whites slider up → highlight area should extend

### 5.2 Performance Testing
1. Drag sliders quickly → no jank
2. Histogram updates after debounce delay
3. Memory usage stable (no leaks)

### 5.3 Browser Automation Verification
- Use /agent-browser to verify histogram updates
- Compare histogram before and after adjustment
- Verify clipping indicators update correctly

---

## Files Summary

### To Modify
1. `apps/web/app/composables/useEditPreview.ts` - Export adjusted pixels
2. `apps/web/app/composables/useHistogramDisplay.ts` - Use adjusted pixels
3. `apps/web/app/composables/useHistogramDisplaySVG.ts` - Use adjusted pixels
4. `apps/web/app/components/edit/EditHistogramDisplay.vue` - Accept props
5. `apps/web/app/components/edit/EditHistogramDisplaySVG.vue` - Accept props
6. `apps/web/app/pages/edit/[id].vue` - Wire up props

---

## Success Criteria

1. ✅ Histogram updates when adjustments change
2. ✅ Histogram reflects actual tonal distribution of edited image
3. ✅ Clipping indicators match clipping overlay on preview
4. ✅ Performance acceptable (no jank during slider drag)
5. ✅ Both canvas and SVG histogram implementations work
6. ✅ All existing tests pass

---

## Estimated Complexity

- Phase 1: Small (add refs and export)
- Phase 2: Medium (add watcher and computation)
- Phase 3: Small (copy pattern from Phase 2)
- Phase 4: Medium (wire up components)
- Phase 5: Verification only

Total: ~100-150 lines of code changes
