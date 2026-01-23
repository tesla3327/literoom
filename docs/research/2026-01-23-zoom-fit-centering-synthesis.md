# Zoom Fit Centering Issue - Research Synthesis

**Date**: 2026-01-23
**Issue**: Zoom "Fit" doesn't center or fill correctly

## Problem Statement

When using the "Fit" zoom option in the edit view:
1. The image doesn't center properly in the edit pane
2. The image doesn't fill the available space correctly

## Root Cause Analysis

### Investigation Findings

1. **Fit Calculation Logic is Correct** - The math formula `min(viewportWidth/imageWidth, viewportHeight/imageHeight)` is properly implemented in `zoomCalculations.ts`.

2. **Centering Logic is Correct** - `calculateCenteredPan()` properly calculates `(viewport - scaled) / 2` for both axes.

3. **CSS Transform is Correct** - Using `transformOrigin: '0 0'` with `translate(panX, panY) scale(scale)` is mathematically sound.

### The Real Issue: Timing/State Race Condition

The problem occurs in `EditPreviewCanvas.vue` when the asset changes:

```typescript
watch(
  () => props.assetId,
  (newId, oldId) => {
    if (oldId && oldId !== newId) {
      editUIStore.cacheZoomForAsset(oldId)
    }
    if (newId) {
      editUIStore.restoreZoomForAsset(newId)  // Called BEFORE new image loads
    }
  },
)
```

When `restoreZoomForAsset(newId)` is called:
1. If no cached state exists, it calls `resetZoom()` → `setZoomPreset('fit')`
2. `setZoomPreset('fit')` immediately calculates camera using CURRENT store dimensions
3. These dimensions are from the PREVIOUS asset (stale) or are 0x0

Later when the new image loads:
4. `updateImageDimensions()` is called with correct dimensions
5. It calls `initializeZoom()` which SHOULD recalculate

But the issue is that `setZoomPreset()` unconditionally calculates and sets camera, even with invalid dimensions.

## Solution

Modify `setZoomPreset()` to only calculate camera when dimensions are valid:

```typescript
function setZoomPreset(preset: ZoomPreset): void {
  if (preset === 'custom') return

  // Always update the preset
  zoomPreset.value = preset

  // Only calculate camera if we have valid dimensions
  if (imageDimensions.value.width > 0 && imageDimensions.value.height > 0
      && viewportDimensions.value.width > 0 && viewportDimensions.value.height > 0) {
    const newCamera = createCameraForPreset(...)
    camera.value = newCamera
  }
  // If dimensions aren't ready, initializeZoom() will calculate when they are
}
```

This ensures:
- The preset is always set correctly
- Camera is only calculated with valid dimensions
- `initializeZoom()` will properly calculate when image loads

## Files to Modify

1. `apps/web/app/stores/editUI.ts` - Update `setZoomPreset()` with dimension guards

## Test Plan

1. Load edit view with new asset - should center correctly
2. Navigate between assets in filmstrip - should center correctly
3. Use Fit button after zooming in - should center correctly
4. Resize window while in Fit mode - should re-center correctly
