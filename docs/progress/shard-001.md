# Progress Shard 001

**Started**: 2026-01-23 15:31 EST

---

## Iteration 147: Zoom Bug Fixes

**Time**: 2026-01-23 15:31 EST
**Status**: Complete
**Task**: Fix two zoom-related bugs:
1. Zoom fit doesn't center or fill correctly
2. Zoom sensitivity too high

### Research Phase
Used parallel subagents to investigate:
- Root cause of zoom fit centering (initialization timing issue)
- Root cause of zoom sensitivity (binary delta mapping + oversized ZOOM_STEP)
- Test coverage gaps

### Implementation
1. **Zoom sensitivity fix**:
   - Changed `ZOOM_STEP` from 1.25 to 1.1 (10% instead of 25%)
   - Implemented proportional delta mapping in `handleWheel()`:
     - Exponential scaling: `Math.pow(2, -deltaY * sensitivity)`
     - Different sensitivity for pinch (0.01) vs scroll (0.002)
     - Clamped factor (0.5-2.0) to prevent extreme jumps

2. **Zoom fit centering fix**:
   - Updated `updateImageDimensions()` and `updateViewportDimensions()` to only call `initializeZoom()` when BOTH dimensions are valid

### Files Modified
- `apps/web/app/utils/zoomCalculations.ts` - Changed ZOOM_STEP to 1.1
- `apps/web/app/composables/useZoomPan.ts` - Proportional delta mapping + dimension guards
- `apps/web/test/zoomCalculations.test.ts` - Updated ZOOM_STEP test expectation

### Test Results
- 1121 tests passed
- 1 pre-existing failure (unrelated to zoom)

---

## Iteration 148: Crop Tool Confirm Before Applying

**Time**: 2026-01-23 16:02 EST
**Status**: Complete
**Task**: Implement crop tool confirmation UX

### Problem
Currently crop changes are applied immediately as the user drags crop handles. This makes it difficult to preview the crop before committing.

### Expected Behavior
1. When entering the crop tool, show the full image with current crop region outlined
2. Allow the user to adjust the crop region without immediately applying it
3. Display a "Set Crop" or "Apply Crop" button at the top of the edit pane
4. Only apply the crop when the user clicks the button or presses Enter
5. When re-entering the crop tool later, show full expanded view (including cropped-out areas)

### Research Phase
Used parallel subagents to investigate:
- Current crop state management in edit store and editUI store
- Crop overlay composable implementation
- Preview rendering flow for crop
- Test coverage for crop functionality

### Implementation

**Phase 1: Pending Crop State** (`apps/web/app/stores/editUI.ts`)
- Added `pendingCrop` ref and `hasPendingCrop` computed
- Added methods: `initializePendingCrop()`, `setPendingCrop()`, `applyPendingCrop()`, `cancelPendingCrop()`, `resetPendingCrop()`
- Updated `activateCropTool()` to initialize pending crop on activation
- Updated `deactivateCropTool()` to clear pending crop

**Phase 2: EditCropActionBar Component** (`apps/web/app/components/edit/EditCropActionBar.vue`)
- Created new component with Apply, Cancel, and Reset buttons
- Reset button only shows when there's an existing crop
- Animated appearance using Vue Transition

**Phase 3: Crop Overlay Uses Pending State** (`apps/web/app/composables/useCropOverlay.ts`)
- Changed from `editStore` to `editUIStore` for crop state
- Updates now write to `pendingCrop` instead of directly to edit store
- Watcher syncs from `pendingCrop` instead of `editStore.cropTransform.crop`

**Phase 4: Preview Integration** (`apps/web/app/components/edit/EditPreviewCanvas.vue`)
- Added EditCropActionBar at top center when crop tool is active
- Smooth enter/leave transitions

**Phase 5: Keyboard Shortcuts** (`apps/web/app/pages/edit/[id].vue`)
- Enter key applies pending crop when crop tool is active
- Escape key cancels pending crop (instead of going back to grid)

**Phase 6: Accordion Behavior** (`apps/web/app/components/edit/EditControlsPanel.vue`)
- Accordion collapses when crop tool is deactivated (via Apply/Cancel)
- Only activates crop tool on expand, doesn't deactivate on collapse

### Files Modified
- `apps/web/app/stores/editUI.ts` - Added pending crop state and methods
- `apps/web/app/components/edit/EditCropActionBar.vue` - NEW: Action bar component
- `apps/web/app/composables/useCropOverlay.ts` - Use pending state instead of edit store
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Integrate action bar
- `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
- `apps/web/app/components/edit/EditControlsPanel.vue` - Accordion behavior

### Tests Added
- `apps/web/test/editUIStore.test.ts` - 8 new tests for pending crop state
- `apps/web/test/EditCropActionBar.test.ts` - NEW: 12 tests for the component

### Test Results
- 1141 tests passed (8 new + 4 new component = 12 new tests)
- 1 pre-existing failure (unrelated to crop changes)

---
