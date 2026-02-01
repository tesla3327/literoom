# Zoom State Persistence Research Synthesis

**Date**: 2026-01-31
**Issue**: Zoom state not persisted per-image
**Severity**: Medium

## Problem Statement

When a user sets a specific zoom level on one image and then navigates to another image, the zoom level from the second image is applied to all images. The zoom state is global rather than per-image.

## Research Findings

### 1. Caching Infrastructure Exists and Works

The editUI store (`apps/web/app/stores/editUI.ts`) already implements a proper per-asset zoom cache:

```typescript
interface CachedZoomState {
  camera: Camera          // { scale, panX, panY }
  preset: ZoomPreset      // 'fit', 'fill', '100%', '200%', 'custom'
}

const ZOOM_CACHE_MAX_SIZE = 50  // LRU eviction
const zoomCache = ref<Map<string, CachedZoomState>>(new Map())
```

**Key Methods:**
- `cacheZoomForAsset(assetId)`: Saves current zoom with LRU eviction
- `restoreZoomForAsset(assetId)`: Restores cached zoom or resets to 'fit'

### 2. EditPreviewCanvas Integration Exists

The component properly calls cache/restore on asset navigation (`EditPreviewCanvas.vue` lines 210-222):

```typescript
watch(
  () => props.assetId,
  (newId, oldId) => {
    if (oldId && oldId !== newId) {
      editUIStore.cacheZoomForAsset(oldId)  // Save previous
    }
    if (newId) {
      editUIStore.restoreZoomForAsset(newId)  // Restore or reset
    }
  },
)
```

### 3. Root Cause: initializeZoom() Overwrites Restored Zoom

**The Bug:** The `initializeZoom()` method unconditionally recalculates camera for "standard presets", which **overwrites the carefully restored zoom state from the cache**.

```typescript
function initializeZoom(): void {
  const preset = zoomPreset.value

  // For standard presets (fit, fill, 100%, 200%), ALWAYS recalculate
  if (STANDARD_PRESETS.has(preset)) {
    camera.value = createCameraForPreset(preset, ...)  // OVERWRITES!
  }
}
```

**Timing Sequence:**
1. User navigates to new asset
2. `restoreZoomForAsset()` restores cached `camera` and `zoomPreset`
3. New image loads, triggering `setImageDimensions()`
4. `initializeZoom()` is called
5. Since preset is a "standard preset" (e.g., '100%'), camera is **recalculated from scratch**
6. Cached zoom state is lost

### 4. Why Standard Presets Recalculate

The rationale for recalculating standard presets:
- **Viewport resize handling**: When window resizes, 'fit' and 'fill' need recalculation
- **Deferred calculation**: When `setZoomPreset()` is called before dimensions are ready

However, this logic doesn't distinguish between:
1. Initial dimension setup (should calculate)
2. Dimension changes due to navigation with restored zoom (should NOT recalculate)

## Solution Design

### Option A: Track "Pending Zoom Restore" State

Add a flag to indicate that zoom was just restored and should NOT be recalculated:

```typescript
const pendingZoomRestore = ref(false)

function restoreZoomForAsset(assetId: string): void {
  const cached = zoomCache.value.get(assetId)
  if (cached) {
    camera.value = { ...cached.camera }
    zoomPreset.value = cached.preset
    pendingZoomRestore.value = true  // Mark as pending
  }
}

function initializeZoom(): void {
  // Skip recalculation if we just restored from cache
  if (pendingZoomRestore.value) {
    pendingZoomRestore.value = false
    // Only clamp pan (in case dimensions differ from when cached)
    camera.value = clampPan(camera.value, ...)
    return
  }
  // ... existing logic
}
```

**Pros:**
- Simple state flag
- Clear intent
- Handles dimension changes by clamping pan

**Cons:**
- Additional state to manage
- Could get out of sync

### Option B: Only Recalculate on Viewport Resize (Not Asset Change)

Track whether dimensions changed due to viewport resize vs. asset change:

```typescript
let lastAssetId: string | null = null
let lastViewportDimensions = { width: 0, height: 0 }

function initializeZoom(): void {
  const d = getDimensions()
  const isViewportResize = (
    d.viewportWidth !== lastViewportDimensions.width ||
    d.viewportHeight !== lastViewportDimensions.height
  )

  if (isViewportResize && STANDARD_PRESETS.has(preset)) {
    // Recalculate for viewport resize
    camera.value = createCameraForPreset(preset, ...)
  } else {
    // Just clamp pan for asset change
    camera.value = clampPan(camera.value, ...)
  }

  lastViewportDimensions = { width: d.viewportWidth, height: d.viewportHeight }
}
```

**Pros:**
- Distinguishes between resize and navigation
- More precise trigger conditions

**Cons:**
- More complex tracking logic
- Could miss edge cases

### Option C: Clamp Pan Instead of Recalculating for Cached Presets (Recommended)

**Key insight:** The camera was valid when cached. On navigation, only the image dimensions might differ. We should:
1. Keep the scale (zoom level)
2. Clamp the pan to valid bounds for new dimensions

```typescript
function restoreZoomForAsset(assetId: string): void {
  const cached = zoomCache.value.get(assetId)
  if (cached) {
    // Mark preset as restored (not a fresh calculation target)
    zoomPreset.value = cached.preset
    camera.value = { ...cached.camera }
    wasRestoredFromCache.value = true
  } else {
    wasRestoredFromCache.value = false
    zoomPreset.value = 'fit'
  }
}

function initializeZoom(): void {
  const d = getDimensions()

  // If zoom was restored from cache, don't recalculate - just clamp
  if (wasRestoredFromCache.value) {
    camera.value = clampPan(camera.value, ...)
    wasRestoredFromCache.value = false
    return
  }

  // For fresh presets (not restored), calculate camera
  if (STANDARD_PRESETS.has(zoomPreset.value)) {
    camera.value = createCameraForPreset(...)
  } else {
    camera.value = clampPan(camera.value, ...)
  }
}
```

**Pros:**
- Minimal changes
- Handles dimension differences gracefully
- Preserves user's zoom level

**Cons:**
- Requires flag state

## Implementation Plan

### Phase 1: Add Restoration Flag

Add `wasRestoredFromCache` ref to editUI store:
- Set to `true` in `restoreZoomForAsset()` when cache hit
- Set to `false` in `restoreZoomForAsset()` when cache miss
- Check and reset in `initializeZoom()`

### Phase 2: Modify initializeZoom()

Update `initializeZoom()` to skip recalculation when flag is set:
- If `wasRestoredFromCache`: Clamp pan only, reset flag
- Otherwise: Existing logic (recalculate for standard presets)

### Phase 3: Add Tests

Add tests in `editUIStore.test.ts`:
1. Restored zoom is preserved after dimension update
2. Restored zoom pan is clamped to valid bounds
3. Fresh preset (not from cache) is still calculated
4. Viewport resize after restore recalculates correctly

## Files to Modify

1. `apps/web/app/stores/editUI.ts`
   - Add `wasRestoredFromCache` ref
   - Update `restoreZoomForAsset()` to set flag
   - Update `initializeZoom()` to check flag

2. `apps/web/test/editUIStore.test.ts`
   - Add tests for zoom persistence through dimension updates

## Test Coverage Gaps

Current tests verify:
- Cache storage and retrieval work
- LRU eviction works
- Restore returns cached values

Missing tests:
- **Zoom preserved after `initializeZoom()` call with restored state**
- Integration with dimension changes
- Pan clamping for different aspect ratios

## Risk Assessment

- **Low risk**: Changes are contained to editUI store
- **No UI changes**: Same components, same user interactions
- **Backward compatible**: Default behavior unchanged for new/uncached assets
