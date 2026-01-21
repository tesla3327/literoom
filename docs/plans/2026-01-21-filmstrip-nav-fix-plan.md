# Implementation Plan: Filmstrip Navigation Stuck Loading State Fix

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [Filmstrip Navigation Synthesis](../research/2026-01-21-filmstrip-nav-synthesis.md)

---

## Overview

This plan fixes the critical bug where rapidly clicking filmstrip thumbnails causes the edit view to get stuck in "Loading..." state. The fix involves adding render generation counters to prevent stale updates and proper error handling in async watchers.

---

## Phase 1: useEditPreview - Generation Counter and Error Handling

### 1.1 Add Render Generation Counter

**File**: `apps/web/app/composables/useEditPreview.ts`

Add a generation counter ref after other refs (around line 175):

```typescript
const renderGeneration = ref(0)
```

### 1.2 Update assetId Watcher

**Lines**: ~443-470

Replace the existing watcher with error handling and generation tracking:

```typescript
watch(assetId, async (id) => {
  // Increment generation to invalidate pending operations
  renderGeneration.value++
  const currentGen = renderGeneration.value

  // Cancel pending debounced renders
  debouncedRender.cancel()

  // Reset state
  error.value = null
  sourceCache.value = null

  if (!id) {
    previewUrl.value = null
    return
  }

  const asset = catalogStore.assets.get(id)
  if (!asset) {
    previewUrl.value = null
    return
  }

  // Show thumbnail immediately
  previewUrl.value = asset.thumbnailUrl

  // Request thumbnail generation if needed
  if (!asset.thumbnailUrl && asset.thumbnailStatus !== 'loading') {
    $catalogService?.requestThumbnail(id, 0)
  }

  // Wait for thumbnail URL
  if (!asset.thumbnailUrl) return

  try {
    await loadSource(id)

    // Check generation before proceeding
    if (renderGeneration.value !== currentGen) return

    if (sourceCache.value && editStore.isDirty) {
      await renderPreview('full')
    }
  } catch (err) {
    // Only update error if still on same generation
    if (renderGeneration.value === currentGen) {
      error.value = err instanceof Error ? err.message : 'Failed to load preview'
      isRendering.value = false
      console.error('[useEditPreview] Asset load error:', err)
    }
  }
}, { immediate: true })
```

### 1.3 Update sourceUrl Watcher

**Lines**: ~476-487

Add error handling:

```typescript
watch(sourceUrl, async (url) => {
  if (!url || sourceCache.value) return

  const currentGen = renderGeneration.value

  try {
    await loadSource(assetId.value)

    if (renderGeneration.value !== currentGen) return

    if (sourceCache.value) {
      await renderPreview('full')
    }
  } catch (err) {
    if (renderGeneration.value === currentGen) {
      error.value = err instanceof Error ? err.message : 'Failed to load source'
      isRendering.value = false
      console.error('[useEditPreview] Source load error:', err)
    }
  }
})
```

### 1.4 Update renderPreview Function

**Lines**: ~257-398

Add generation check before updating state:

At the start of the function (after line ~265):
```typescript
const currentGen = renderGeneration.value
```

Before setting `previewUrl.value` (around line ~388):
```typescript
// Verify generation hasn't changed
if (renderGeneration.value !== currentGen) {
  console.log('[useEditPreview] Discarding stale render')
  return
}
```

Ensure finally block always resets isRendering (around line ~395):
```typescript
} finally {
  isRendering.value = false
}
```

### 1.5 Verification

- [ ] Generation counter increments on asset change
- [ ] Stale renders are discarded
- [ ] Errors reset isRendering to false
- [ ] Preview loads correctly after rapid navigation

---

## Phase 2: useHistogramDisplay - Generation Counter and Error Handling

### 2.1 Add Computation Generation Counter

**File**: `apps/web/app/composables/useHistogramDisplay.ts`

Add generation counter ref (after other refs):

```typescript
const computeGeneration = ref(0)
```

### 2.2 Lazy Kernel Initialization

Replace line ~114:

```typescript
// Old: const SMOOTHING_KERNEL = createGaussianKernel(SMOOTHING_KERNEL_SIZE)

// New: Lazy initialization
let _smoothingKernel: number[] | null = null

function getSmoothingKernel(): number[] {
  if (!_smoothingKernel) {
    _smoothingKernel = createGaussianKernel(SMOOTHING_KERNEL_SIZE)
  }
  return _smoothingKernel
}
```

Update usage in renderHistogram (lines ~263-265):
```typescript
const kernel = getSmoothingKernel()
const smoothedRed = smoothHistogram(hist.red, kernel)
const smoothedGreen = smoothHistogram(hist.green, kernel)
const smoothedBlue = smoothHistogram(hist.blue, kernel)
```

### 2.3 Update assetId Watcher

**Lines**: ~464-483

Add error handling and generation tracking:

```typescript
watch(assetId, async (id) => {
  computeGeneration.value++
  const currentGen = computeGeneration.value

  debouncedCompute.cancel()
  sourceCache.value = null

  if (!id) {
    histogram.value = null
    return
  }

  const asset = catalogStore.assets.get(id)
  if (!asset) {
    histogram.value = null
    return
  }

  // Request thumbnail if needed
  if (!asset.thumbnailUrl && asset.thumbnailStatus !== 'loading') {
    $catalogService?.requestThumbnail(id, 0)
  }

  if (!asset.thumbnailUrl) return

  try {
    await loadSource(id)

    if (computeGeneration.value !== currentGen) return

    if (sourceCache.value) {
      await computeHistogram()
    }
  } catch (err) {
    if (computeGeneration.value === currentGen) {
      error.value = err instanceof Error ? err.message : 'Failed to load histogram'
      isComputing.value = false
      console.error('[useHistogramDisplay] Error:', err)
    }
  }
}, { immediate: true })
```

### 2.4 Update sourceUrl Watcher

**Lines**: ~489-496

Add error handling:

```typescript
watch(sourceUrl, async (url) => {
  if (!url || sourceCache.value) return

  const currentGen = computeGeneration.value

  try {
    await loadSource(assetId.value)

    if (computeGeneration.value !== currentGen) return

    if (sourceCache.value) {
      await computeHistogram()
    }
  } catch (err) {
    if (computeGeneration.value === currentGen) {
      error.value = err instanceof Error ? err.message : 'Failed to load histogram source'
      isComputing.value = false
    }
  }
})
```

### 2.5 Update computeHistogram Function

Add generation check before updating histogram state.

### 2.6 Add Toggle Methods

Export toggle methods from the composable:

```typescript
function toggleShadowClipping(): void {
  showShadowClipping.value = !showShadowClipping.value
}

function toggleHighlightClipping(): void {
  showHighlightClipping.value = !showHighlightClipping.value
}

return {
  // ... existing exports ...
  toggleShadowClipping,
  toggleHighlightClipping,
}
```

### 2.7 Verification

- [ ] Generation counter works
- [ ] Lazy kernel initialization works
- [ ] No HMR errors with `createGaussianKernel`
- [ ] Histogram updates correctly

---

## Phase 3: Component Updates

### 3.1 EditHistogramDisplay.vue - Use Toggle Methods

**File**: `apps/web/app/components/edit/EditHistogramDisplay.vue`

Update destructuring (around line 21):
```typescript
const {
  // ... existing ...
  toggleShadowClipping,
  toggleHighlightClipping,
} = useHistogramDisplay(toRef(props, 'assetId'))
```

Update template buttons (lines ~106, ~119):
```vue
<!-- Replace -->
@click="showShadowClipping = !showShadowClipping"
<!-- With -->
@click="toggleShadowClipping"

<!-- Replace -->
@click="showHighlightClipping = !showHighlightClipping"
<!-- With -->
@click="toggleHighlightClipping"
```

### 3.2 EditHistogramDisplaySVG.vue - Similar Updates

If this component is used, apply similar changes.

### 3.3 Edit Page - Error Handling

**File**: `apps/web/app/pages/edit/[id].vue`

Update watcher (lines ~120-124):

```typescript
watch(assetId, async (id) => {
  if (id) {
    try {
      await editStore.loadForAsset(id)
    } catch (err) {
      console.error('[EditPage] Failed to load asset:', err)
    }
  }
}, { immediate: true })
```

---

## Phase 4: Testing and Verification

### 4.1 Manual Testing Checklist

1. [ ] Navigate to edit view via catalog double-click
2. [ ] Rapidly click 10+ filmstrip thumbnails in quick succession
3. [ ] Verify preview never gets stuck in "Loading..."
4. [ ] Verify histogram never gets stuck in "Loading..."
5. [ ] Verify correct preview/histogram shown after navigation settles
6. [ ] Check console for any Vue warnings or errors
7. [ ] Test with slow network (devtools throttling)

### 4.2 Run Existing Tests

```bash
pnpm test
```

### 4.3 Check Types

```bash
pnpm check:types
```

---

## File Summary

```
apps/web/app/
├── composables/
│   ├── useEditPreview.ts      # Phase 1: Generation counter, error handling
│   └── useHistogramDisplay.ts # Phase 2: Generation counter, lazy kernel, toggles
├── components/edit/
│   ├── EditHistogramDisplay.vue    # Phase 3.1: Use toggle methods
│   └── EditHistogramDisplaySVG.vue # Phase 3.2: Use toggle methods
└── pages/edit/
    └── [id].vue              # Phase 3.3: Error handling in watcher
```

---

## Rollback Plan

If issues arise:
1. Revert all changes via git
2. Original behavior restored
3. Document any new findings

---

## Success Criteria

- [ ] Rapid filmstrip navigation never causes stuck "Loading..." state
- [ ] Console shows no Vue warnings during navigation
- [ ] All existing tests pass
- [ ] Type checking passes
- [ ] Preview and histogram always show correct data for current asset
