# Zoom/Pan Implementation Plan

**Date**: 2026-01-22
**Based on**: docs/research/2026-01-22-zoom-pan-synthesis.md

## Overview

Implement zoom and pan functionality for the edit view preview canvas, allowing users to inspect photo details at various magnification levels.

## Phase 1: Core Infrastructure

### 1.1 Create Zoom Utilities

**File**: `apps/web/app/utils/zoomCalculations.ts`

```typescript
export interface Camera {
  scale: number
  panX: number
  panY: number
}

export type ZoomPreset = 'fit' | 'fill' | '100%' | '200%' | 'custom'

export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): number

export function calculateFillScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): number

export function zoomToPoint(
  camera: Camera,
  newScale: number,
  pointX: number,
  pointY: number
): Camera

export function clampPan(
  camera: Camera,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): Camera

export function screenToImage(
  screenX: number,
  screenY: number,
  camera: Camera
): { x: number; y: number }
```

### 1.2 Add Zoom State to editUI Store

**File**: `apps/web/app/stores/editUI.ts`

Add:
```typescript
// Zoom/Pan state
const camera = ref<Camera>({ scale: 1, panX: 0, panY: 0 })
const zoomPreset = ref<ZoomPreset>('fit')
const isInteracting = ref(false)

// Per-image zoom cache (LRU, max 50)
const zoomCache = ref<Map<string, Camera & { preset: ZoomPreset }>>(new Map())

// Actions
function setCamera(newCamera: Camera): void
function setZoomPreset(preset: ZoomPreset): void
function cacheZoomForAsset(assetId: string): void
function restoreZoomForAsset(assetId: string, fitScale: number): void
function resetZoom(fitScale: number): void
```

### 1.3 Create useZoomPan Composable

**File**: `apps/web/app/composables/useZoomPan.ts`

```typescript
export interface UseZoomPanOptions {
  containerRef: Ref<HTMLElement | null>
  imageRef: Ref<HTMLImageElement | null>
  viewportWidth: Ref<number>
  viewportHeight: Ref<number>
  imageWidth: Ref<number>
  imageHeight: Ref<number>
}

export interface UseZoomPanReturn {
  camera: Ref<Camera>
  zoomPreset: Ref<ZoomPreset>
  isInteracting: Ref<boolean>
  transformStyle: ComputedRef<CSSProperties>
  cursorStyle: ComputedRef<string>
  zoomPercentage: ComputedRef<number>
  fitScale: ComputedRef<number>
  canPan: ComputedRef<boolean>

  // Methods
  zoomIn(): void
  zoomOut(): void
  setPreset(preset: ZoomPreset): void
  toggleZoom(): void
  resetZoom(): void
}
```

**Implementation responsibilities**:
- Initialize from store
- Handle wheel events (zoom toward cursor)
- Handle mousedown/mousemove/mouseup (pan)
- Handle spacebar for pan mode
- Compute transform style
- Compute cursor style
- Sync state back to store with debouncing

## Phase 2: EditPreviewCanvas Integration

### 2.1 Update Component Structure

**File**: `apps/web/app/components/edit/EditPreviewCanvas.vue`

**Changes**:
1. Add outer container for zoom/pan events
2. Wrap image + overlays in transform container
3. Add zoom controls UI
4. Pass camera state to overlay composables

**Template structure**:
```vue
<template>
  <div
    ref="zoomContainerRef"
    class="absolute inset-0 overflow-hidden"
    :style="{ cursor: cursorStyle }"
  >
    <!-- Transform container -->
    <div
      ref="transformContainerRef"
      class="absolute"
      :style="transformStyle"
    >
      <img ... />
      <canvas ref="clippingCanvasRef" ... />
      <canvas v-if="editUIStore.isCropToolActive" ref="cropCanvasRef" ... />
      <canvas v-if="editUIStore.isMaskToolActive" ref="maskCanvasRef" ... />
    </div>

    <!-- Zoom controls (fixed position) -->
    <div class="absolute bottom-4 left-4 z-10">
      <ZoomControls
        :zoom="zoomPercentage"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @set-preset="setPreset"
      />
    </div>

    <!-- Zoom percentage indicator -->
    <div
      v-if="zoomPreset !== 'fit'"
      class="absolute top-4 left-4 z-10 px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-400"
    >
      {{ zoomPercentage }}%
    </div>
  </div>
</template>
```

### 2.2 Create ZoomControls Component

**File**: `apps/web/app/components/edit/ZoomControls.vue`

Simple control bar with:
- Zoom percentage display (clickable dropdown)
- +/- buttons
- Fit button
- 1:1 (100%) button

## Phase 3: Overlay Integration

### 3.1 Update Coordinate Utilities

**File**: `apps/web/app/composables/cropUtils.ts`

Update `getCanvasCoords()`:
```typescript
export function getCanvasCoords(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
  camera?: Camera  // Optional for backwards compatibility
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  let x = e.clientX - rect.left
  let y = e.clientY - rect.top

  // If camera provided, convert from screen to canvas coordinates
  if (camera) {
    x = (x - camera.panX) / camera.scale
    y = (y - camera.panY) / camera.scale
  }

  return { x, y }
}
```

### 3.2 Update useCropOverlay

**File**: `apps/web/app/composables/useCropOverlay.ts`

Add camera parameter to options:
```typescript
export interface UseCropOverlayOptions {
  // ... existing options ...
  camera?: Ref<Camera>
}
```

Update event handlers to use camera-aware coordinate conversion.

### 3.3 Update useMaskOverlay

**File**: `apps/web/app/composables/useMaskOverlay.ts`

Same pattern as useCropOverlay.

## Phase 4: Keyboard Shortcuts

### 4.1 Add Zoom Shortcuts to Edit Page

**File**: `apps/web/app/pages/edit/[id].vue`

Add to `handleKeydown()`:
```typescript
// Zoom shortcuts
if (key === 'z' && !isMod) {
  toggleZoom()
  return
}

if (isMod && key === '0') {
  e.preventDefault()
  setPreset('fit')
  return
}

if (isMod && key === '1') {
  e.preventDefault()
  setPreset('100%')
  return
}

if (isMod && (key === '=' || key === '+')) {
  e.preventDefault()
  zoomIn()
  return
}

if (isMod && key === '-') {
  e.preventDefault()
  zoomOut()
  return
}
```

### 4.2 Update Help Modal

**File**: `apps/web/app/components/HelpModal.vue`

Add zoom shortcuts to Edit View section:
- `Z` - Toggle zoom (fit/100%)
- `Cmd/Ctrl + 0` - Fit to view
- `Cmd/Ctrl + 1` - 100% zoom
- `Cmd/Ctrl + +/-` - Zoom in/out
- `Space + Drag` - Pan (when zoomed)

## Phase 5: Polish & Edge Cases

### 5.1 Pan Bounds Clamping

Ensure image center stays within viewport:
```typescript
function clampPan(camera: Camera, ...): Camera {
  const scaledWidth = imageWidth * camera.scale
  const scaledHeight = imageHeight * camera.scale

  const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2)
  const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2)

  return {
    ...camera,
    panX: clamp(camera.panX, -maxPanX, maxPanX),
    panY: clamp(camera.panY, -maxPanY, maxPanY)
  }
}
```

### 5.2 Window Resize Handling

When viewport resizes:
- If preset is 'fit' or 'fill': Recalculate scale
- If custom zoom: Maintain scale, adjust pan proportionally

### 5.3 Asset Change Handling

When switching assets:
1. Save current zoom to cache
2. Check cache for new asset
3. If cached: Restore zoom state
4. If not cached: Reset to fit

### 5.4 Crop Mode Integration

When crop tool is active:
- Wheel zoom still works (helpful for precise crops)
- Spacebar enables temporary pan mode
- Release spacebar returns to crop mode

## Implementation Order

1. **Phase 1.1**: Create zoomCalculations.ts (pure functions, unit testable)
2. **Phase 1.2**: Add zoom state to editUI store
3. **Phase 1.3**: Create useZoomPan composable
4. **Phase 2.1**: Update EditPreviewCanvas structure
5. **Phase 3.1-3.3**: Update overlay coordinate handling
6. **Phase 4.1**: Add keyboard shortcuts
7. **Phase 2.2**: Create ZoomControls component
8. **Phase 4.2**: Update help modal
9. **Phase 5.1-5.4**: Polish and edge cases

## Testing Checklist

### Manual Testing
- [ ] Wheel zoom centers on cursor position
- [ ] Drag to pan when zoomed in
- [ ] Drag does nothing at fit scale
- [ ] Double-click toggles fit/100%
- [ ] Z key toggles fit/100%
- [ ] Cmd/Ctrl+0 fits to view
- [ ] Cmd/Ctrl+1 zooms to 100%
- [ ] Cmd/Ctrl++ zooms in
- [ ] Cmd/Ctrl+- zooms out
- [ ] Spacebar enables pan mode
- [ ] Cursor changes to grab/grabbing appropriately
- [ ] Crop overlay remains aligned when zoomed
- [ ] Mask overlay remains aligned when zoomed
- [ ] Clipping overlay renders correctly when zoomed
- [ ] Pan is clamped to keep image visible
- [ ] Zoom state persists when navigating between images
- [ ] Zoom resets to fit on new image (if not cached)
- [ ] Window resize adjusts fit zoom appropriately
- [ ] Browser zoom (Cmd++) is prevented

### Unit Tests
- [ ] calculateFitScale() returns correct scale
- [ ] calculateFillScale() returns correct scale
- [ ] zoomToPoint() maintains cursor position
- [ ] clampPan() constrains pan correctly
- [ ] screenToImage() converts coordinates correctly

## Success Metrics

Feature is complete when:
1. All manual testing checklist items pass
2. All unit tests pass
3. Existing E2E tests pass (no regressions)
4. No Vue reactivity warnings in console
5. Smooth 60fps during zoom/pan operations
