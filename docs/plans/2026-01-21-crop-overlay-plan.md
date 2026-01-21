# Implementation Plan: Crop Overlay on Preview Canvas

## Overview

Implement interactive crop controls overlaid on the main preview canvas, allowing users to interact with the crop region directly on the full-size preview image.

## Prerequisites

- Existing useCropEditor composable with rendering and interaction logic
- editUI Pinia store for UI state management
- EditPreviewCanvas with clipping overlay pattern

## Phases

### Phase 1: Extend editUI Store

**Objective:** Add crop tool activation state to enable conditional overlay rendering.

**File:** `apps/web/app/stores/editUI.ts`

**Changes:**
1. Add `isCropToolActive` ref (boolean, default false)
2. Add `activateCropTool()` method
3. Add `deactivateCropTool()` method
4. Add `toggleCropTool()` method

**Code:**
```typescript
// Crop tool state
const isCropToolActive = ref(false)

function activateCropTool(): void {
  isCropToolActive.value = true
}

function deactivateCropTool(): void {
  isCropToolActive.value = false
}

function toggleCropTool(): void {
  isCropToolActive.value = !isCropToolActive.value
}
```

### Phase 2: Extract Shared Crop Utilities

**Objective:** Create shared utilities for coordinate conversion and rendering.

**File:** `apps/web/app/composables/cropUtils.ts` (new)

**Extract from useCropEditor:**
1. Constants: `COLORS`, `HANDLE_SIZE`, `HANDLE_HIT_RADIUS`, `HANDLES`
2. Type definitions: `HandlePosition`, etc.
3. Functions:
   - `toNormalized(canvasX, canvasY, canvas)`
   - `toCanvas(normX, normY, canvas)`
   - `getCanvasCoords(event, canvas)`
   - `drawOverlay(ctx, crop, w, h)`
   - `drawBorder(ctx, crop, w, h, isActive)`
   - `drawGrid(ctx, crop, w, h)`
   - `drawHandles(ctx, crop, w, h, activeHandle)`
   - `getHandlePositions(crop, canvas)`
   - `findHandleAt(x, y, positions)`
   - `isInsideCrop(x, y, crop)`

### Phase 3: Create useCropOverlay Composable

**Objective:** Create composable for preview canvas crop overlay with full interaction.

**File:** `apps/web/app/composables/useCropOverlay.ts` (new)

**Inputs:**
- `canvasRef: Ref<HTMLCanvasElement | null>`
- `displayWidth: Ref<number>`
- `displayHeight: Ref<number>`
- `imageWidth: Ref<number>`
- `imageHeight: Ref<number>`

**State:**
- `localCrop` - Local copy of crop for smooth dragging
- `activeHandle` - Currently dragged handle
- `isMoving` - Whether dragging inside crop
- `lastMousePos` - Previous position for delta calculation
- `isDragging` - Computed from activeHandle or isMoving

**Features:**
1. Render crop overlay (dark mask, border, grid, handles)
2. Handle mouse events (mousedown, mousemove, mouseup, mouseleave)
3. Resize via handle drag with aspect ratio support
4. Move via interior drag
5. Sync with edit store (debounced during drag)
6. Watch for store changes when not dragging
7. Cleanup on unmount

**Returns:**
- `isDragging` - For cursor styling
- `localCrop` - For debugging/display
- `render()` - Manual render trigger if needed

### Phase 4: Update EditPreviewCanvas

**Objective:** Add crop overlay canvas to preview component.

**File:** `apps/web/app/components/edit/EditPreviewCanvas.vue`

**Changes:**

1. Import editUI store and useCropOverlay composable
2. Add crop canvas ref
3. Add crop canvas element (conditionally rendered)
4. Initialize useCropOverlay with refs
5. Style canvas based on drag state

**Template addition:**
```vue
<canvas
  v-if="editUIStore.isCropToolActive"
  ref="cropCanvasRef"
  class="absolute top-0 left-0"
  :class="{
    'cursor-grab': !cropIsDragging,
    'cursor-grabbing': cropIsDragging,
  }"
  :width="renderedDimensions.width"
  :height="renderedDimensions.height"
  :style="{
    width: renderedDimensions.width + 'px',
    height: renderedDimensions.height + 'px',
    zIndex: 20,
    touchAction: 'none',
  }"
  data-testid="crop-overlay-canvas"
/>
```

### Phase 5: Connect Accordion State

**Objective:** Sync accordion expansion with crop tool activation.

**File:** `apps/web/app/components/edit/EditControlsPanel.vue`

**Changes:**

1. Import editUI store
2. Watch `expandedSections` for 'crop' inclusion
3. Call `activateCropTool()` when crop section expands
4. Call `deactivateCropTool()` when crop section collapses

**Code:**
```typescript
const editUIStore = useEditUIStore()

watch(
  () => expandedSections.value.includes('crop'),
  (isCropExpanded) => {
    if (isCropExpanded) {
      editUIStore.activateCropTool()
    } else {
      editUIStore.deactivateCropTool()
    }
  },
  { immediate: true }
)
```

### Phase 6: Cleanup on Navigation

**Objective:** Ensure crop tool is deactivated when leaving edit page.

**File:** `apps/web/app/pages/edit/[id].vue`

**Changes:**
1. Import editUI store
2. Call `deactivateCropTool()` in `onUnmounted`

### Phase 7: Update useCropEditor (Panel)

**Objective:** Refactor to use shared utilities.

**File:** `apps/web/app/composables/useCropEditor.ts`

**Changes:**
1. Import shared utilities from cropUtils.ts
2. Remove duplicated code
3. Keep panel-specific logic (fixed 320x180 canvas size)

## Implementation Order

1. Phase 1: editUI store extension (simple, isolated)
2. Phase 2: Extract shared utilities (refactoring)
3. Phase 3: Create useCropOverlay (core functionality)
4. Phase 4: Update EditPreviewCanvas (integration)
5. Phase 5: Connect accordion state (UX)
6. Phase 6: Cleanup on navigation (robustness)
7. Phase 7: Refactor useCropEditor (cleanup)

## Testing Strategy

### Manual Testing
1. Open edit view, expand crop section
2. Verify crop overlay appears on preview
3. Drag corner handles - verify resize works
4. Drag inside crop - verify move works
5. Verify rule of thirds grid visible
6. Verify dark mask outside crop
7. Collapse crop section - verify overlay disappears
8. Navigate to different photo - verify overlay resets
9. Test with rotated image
10. Test with various aspect ratios

### Edge Cases
- Very small crop region (minimum size constraint)
- Crop at image edges (boundary constraints)
- Rapid toggling of crop section
- Window resize during crop
- Navigation while dragging

## Success Criteria

1. Crop overlay visible on main preview when crop section expanded
2. Handles draggable for resize with aspect ratio constraints
3. Interior draggable for move
4. Rule of thirds grid visible
5. Dark mask outside crop region
6. Panel and preview crop editors stay synchronized
7. Overlay hidden when crop section collapsed
8. Smooth performance during drag (60fps)
9. No memory leaks on navigation
10. Coordinates accurate regardless of image aspect ratio

## Estimated Complexity

| Phase | Complexity | New Code | Modified Code |
|-------|------------|----------|---------------|
| 1 | Low | ~20 lines | editUI.ts |
| 2 | Medium | ~150 lines | cropUtils.ts (new) |
| 3 | High | ~300 lines | useCropOverlay.ts (new) |
| 4 | Medium | ~50 lines | EditPreviewCanvas.vue |
| 5 | Low | ~15 lines | EditControlsPanel.vue |
| 6 | Low | ~5 lines | edit/[id].vue |
| 7 | Medium | 0 | useCropEditor.ts |

**Total new code:** ~535 lines
**Total modified:** 4 files
