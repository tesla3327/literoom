# Zoom Bugs Research Synthesis

**Date**: 2026-01-23
**Status**: Complete

## Executive Summary

Research into two zoom-related bugs has identified clear root causes and recommended fixes:

1. **Zoom fit doesn't center or fill correctly** - CSS positioning issue
2. **Zoom sensitivity too high** - Binary delta mapping + oversized zoom step

## Bug 1: Zoom Fit Doesn't Center Correctly

### Root Causes

1. **Transform container positioning**: The transform container uses `position: absolute` without proper positioning properties (`top`, `left`), defaulting to `0, 0`.

2. **Transform origin**: `transform-origin: '0 0'` causes scaling from top-left corner instead of center.

3. **Flexbox centering broken**: The outer container has `flex items-center justify-center`, but the absolutely-positioned transform container is removed from the flex layout flow.

### Current Code (EditPreviewCanvas.vue, lines 277-280)

```vue
<div
  class="absolute"
  :style="transformStyle"
  data-testid="transform-container"
>
```

The `transformStyle` computes:
```typescript
{
  transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.scale})`,
  transformOrigin: '0 0',
  willChange: isZoomInteracting ? 'transform' : 'auto',
}
```

### Recommended Fix

Change the transform approach to use the viewport center as the reference point:

1. Keep the transform container at top-left (`left: 0; top: 0`)
2. The `calculateCenteredPan()` function already calculates correct centering offsets
3. The issue is that dimensions may not be set correctly when fit is calculated

After analysis, the math is correct but the initialization timing may be wrong. Need to ensure:
- `imageDimensions` are set from `naturalWidth/naturalHeight` when image loads
- `viewportDimensions` are set from container `clientWidth/clientHeight`
- `initializeZoom()` is called AFTER both are set

## Bug 2: Zoom Sensitivity Too High

### Root Cause

**Binary delta mapping** in `useZoomPan.ts` (line 112):

```typescript
const zoomFactor = delta > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
```

This reduces ALL deltaY values to just 2 options (0.8 or 1.25), treating:
- Gentle scroll (deltaY=1) = 25% zoom
- Fast scroll (deltaY=100) = 25% zoom
- Trackpad pinch = 25% zoom

Combined with `ZOOM_STEP = 1.25`, each event causes a 25% zoom change.

### Industry Standards

| Editor | Approach | Factor |
|--------|----------|--------|
| Figma | Proportional delta | 0.001/px continuous |
| Lightroom | Velocity-sensitive | 1.05-1.1 adaptive |
| Chrome DevTools | Exponential scaling | Base 1.2, scaled |

### Recommended Fix

1. **Proportional delta mapping**:
```typescript
// Normalize deltaY to a reasonable range
const normalizedDelta = Math.min(Math.max(e.deltaY, -100), 100)
// Map to zoom factor with smaller base
const zoomExponent = -normalizedDelta / 500  // More gradual
const zoomFactor = Math.pow(1.1, zoomExponent * 5)
```

2. **Reduce ZOOM_STEP** from 1.25 to 1.1 for button zoom

3. **Differentiate input devices**:
```typescript
const isPinch = e.ctrlKey  // Trackpad pinch sends ctrlKey
```

## Files to Modify

1. **`apps/web/app/composables/useZoomPan.ts`**
   - `handleWheel()` - implement proportional delta mapping

2. **`apps/web/app/utils/zoomCalculations.ts`**
   - Change `ZOOM_STEP` from 1.25 to 1.1

3. **`apps/web/app/components/edit/EditPreviewCanvas.vue`**
   - Verify initialization flow

## Test Coverage Notes

- Good coverage for pure math functions (88 tests)
- Good coverage for store (95+ tests)
- Gap: `useZoomPan.ts` composable has NO unit tests
- Missing: wheel zoom behavior tests with different deltaY values
