# Zoom Bugs Fix Plan

**Date**: 2026-01-23
**Based on**: docs/research/2026-01-23-zoom-bugs-synthesis.md

## Overview

Fix two zoom-related bugs:
1. Zoom fit doesn't center or fill correctly
2. Zoom sensitivity too high

## Phase 1: Fix Zoom Sensitivity

### 1.1 Update ZOOM_STEP Constant

**File**: `apps/web/app/utils/zoomCalculations.ts`

Change:
```typescript
export const ZOOM_STEP = 1.25
```

To:
```typescript
export const ZOOM_STEP = 1.1
```

### 1.2 Update handleWheel for Proportional Zoom

**File**: `apps/web/app/composables/useZoomPan.ts`

Replace binary delta check with proportional mapping:

```typescript
function handleWheel(e: WheelEvent): void {
  if (!enabled.value) return
  e.preventDefault()

  const container = containerRef.value
  if (!container) return

  const rect = container.getBoundingClientRect()
  const pivotX = e.clientX - rect.left
  const pivotY = e.clientY - rect.top

  // Proportional zoom based on delta magnitude
  // Normalize delta to reasonable range (-100 to 100)
  // Trackpad pinch (ctrlKey) has smaller deltas, scale them up
  const rawDelta = e.deltaY
  const isPinch = e.ctrlKey

  // Different sensitivity for pinch vs scroll
  const sensitivity = isPinch ? 0.02 : 0.002
  const zoomFactor = Math.pow(2, -rawDelta * sensitivity)

  // Clamp the factor to prevent extreme jumps
  const clampedFactor = Math.max(0.5, Math.min(2, zoomFactor))
  const newScale = editUIStore.camera.scale * clampedFactor

  editUIStore.zoomToPointAction(newScale, pivotX, pivotY)
}
```

### 1.3 Update Tests

**File**: `apps/web/test/zoomCalculations.test.ts`

Update ZOOM_STEP constant test to expect 1.1.

## Phase 2: Fix Zoom Fit Centering

### 2.1 Investigate Initialization Timing

Check that dimensions are being set correctly before fit calculation:

1. In `useZoomPan.ts`, verify `updateImageDimensions()` is called after image loads
2. In `useZoomPan.ts`, verify `updateViewportDimensions()` is called after container mounts
3. Ensure `initializeZoom()` is called after both are set

### 2.2 Add Defensive Initialization

**File**: `apps/web/app/composables/useZoomPan.ts`

Ensure `initializeZoom()` is only called when both dimensions are valid:

```typescript
function updateImageDimensions(): void {
  const img = imageRef.value
  if (img && img.naturalWidth && img.naturalHeight) {
    editUIStore.setImageDimensions(img.naturalWidth, img.naturalHeight)
    // Only initialize if viewport is also set
    if (editUIStore.viewportDimensions.width > 0 && editUIStore.viewportDimensions.height > 0) {
      editUIStore.initializeZoom()
    }
  }
}

function updateViewportDimensions(): void {
  const container = containerRef.value
  if (container && container.clientWidth > 0 && container.clientHeight > 0) {
    editUIStore.setViewportDimensions(container.clientWidth, container.clientHeight)
    // Only initialize if image is also set
    if (editUIStore.imageDimensions.width > 0 && editUIStore.imageDimensions.height > 0) {
      editUIStore.initializeZoom()
    }
  }
}
```

## Phase 3: Testing

### 3.1 Manual Testing Checklist

- [ ] Wheel zoom feels gradual and controllable
- [ ] Trackpad pinch zoom feels smooth
- [ ] Zoom buttons work correctly (10% steps)
- [ ] Fit button centers image correctly
- [ ] Different aspect ratio images center properly
- [ ] Window resize maintains proper centering
- [ ] 100% button zooms to pixel-perfect view

### 3.2 Verify Existing Tests Pass

Run:
```bash
pnpm test:web
```

## Implementation Order

1. **Phase 1.1**: Update ZOOM_STEP constant
2. **Phase 1.2**: Update handleWheel function
3. **Phase 1.3**: Update tests
4. **Phase 2.1-2.2**: Fix initialization timing
5. **Phase 3**: Testing

## Success Criteria

1. Wheel zoom is proportional to scroll amount
2. Each zoom button click changes zoom by ~10%
3. Fit mode centers image correctly for all aspect ratios
4. All existing tests pass
5. No visual regressions in edit view
