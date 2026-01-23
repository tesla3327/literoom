# Iterations 141-150

## 140: 2026-01-22 10:52 EST: Preview Priority on Edit Entry - Implementation Complete

**Objective**: Implement the preview priority improvements according to the plan created in iteration 139.

**Problem Statement** (from issues.md):
When a thumbnail is visible (appears loaded), users may double-click to enter edit view, but the preview is still generating. This creates confusion.

**Implementation Status**: Complete

### Phase 1: Early Preview Request on Double-Click
- [x] Added `requestPreview()` call before navigation in `CatalogThumbnail.vue`
- Modified `handleDoubleClick()` to call `requestPreview(props.asset.id, ThumbnailPriority.VISIBLE)` before `router.push()`

### Phase 2: Early Preview Request on Keyboard Navigation
- [x] Added `requestPreview()` call before navigation in `CatalogGrid.vue`
- Modified `onViewChange()` callback in `useGridKeyboard` to call `requestPreview(currentId, ThumbnailPriority.VISIBLE)` before `navigateTo()`

### Phase 3: Preview-First Priority in Edit View
- [x] Updated `useEditPreview.ts` to prioritize preview over thumbnail
- Changed from both at Priority 0 to:
  - Preview at `ThumbnailPriority.VISIBLE` (Priority 0 - highest)
  - Thumbnail at `ThumbnailPriority.PRELOAD` (Priority 2 - lower)

**Files Modified** (3 files):
- `apps/web/app/components/catalog/CatalogThumbnail.vue` - Added early preview request on double-click
- `apps/web/app/components/catalog/CatalogGrid.vue` - Added early preview request on keyboard navigation (E/Enter/D)
- `apps/web/app/composables/useEditPreview.ts` - Changed priority order (preview first, thumbnail second)

**Tests**: 363 unit tests pass, build completes successfully

**Result**: When users click or keyboard-navigate to edit view:
1. Preview generation starts immediately (before navigation)
2. Preview gets highest priority in the queue
3. Thumbnail gets lower priority (only needed as fallback)
4. Preview should be ready faster, reducing loading state time

---

## 141: 2026-01-22 11:05 EST: Rescan Folder UI - Implementation Complete

**Objective**: Add a "Rescan Folder" button to the UI so users can trigger folder rescan to detect new/removed files.

**Background**:
The spec requires (section 3.3 - Import and scanning):
> Provide a "Rescan folder" action that:
> - finds new files
> - detects removed files
> - updates cache validity if file modified

The rescan functionality was fully implemented at the service level but had **no UI button** exposed to users.

**Implementation**:

### Phase 1: Add `rescanFolder()` to useCatalog Composable
- Added `rescanFolder()` method that:
  - Checks if folder is loaded (shows warning toast if not)
  - Sets `isScanning` state while scanning
  - Calls `catalogService.rescanFolder()`
  - Shows success toast with new image count or "up to date" message
  - Shows error toast on failure

### Phase 2: Add Rescan Button to FilterBar
- Added Rescan button between thumbnail progress and Export button
- Shows only when folder is loaded and not scanning/exporting
- Uses `i-heroicons-arrow-path` icon (consistent with other refresh actions)
- Added scanning progress indicator with spinning icon and "Rescanning..." text

**Files Modified** (2 files):
- `apps/web/app/composables/useCatalog.ts` - Added `rescanFolder()` method (~50 lines)
- `apps/web/app/components/catalog/FilterBar.vue` - Added button and progress indicator (~30 lines)

**Files Created** (2 files):
- `docs/research/2026-01-22-rescan-folder-ui-research-plan.md`
- `docs/research/2026-01-22-rescan-folder-ui-synthesis.md`
- `docs/plans/2026-01-22-rescan-folder-ui-plan.md`

**Tests**: All 362 unit tests pass

**Result**: Users can now click the "Rescan" button in the FilterBar to detect new/modified files in the current folder. A toast notification shows the result.

---

## 142: 2026-01-22 19:01 EST: Zoom/Pan Feature - Research & Planning Complete

**Objective**: Implement zoom and pan functionality for the edit view preview canvas.

**Background**:
The spec requires (section 3.5 - Zoom/pan behavior):
> - Base display uses preview 1x and 2x only.
> - Interaction rules:
>   - zooming and panning should be immediate using UI transforms
>   - after a short delay, app swaps to higher detail if available:
>     - if zoom level exceeds what 1x can support, and 2x exists, switch source
> - If 2x preview not ready, continue showing scaled 1x and update once ready.

**Research Completed** (5 parallel sub-agents):
1. **Codebase Review**: Analyzed EditPreviewCanvas, overlay composables, coordinate systems
2. **Transform Techniques**: CSS transforms vs Canvas API (CSS selected for GPU acceleration)
3. **Interaction Patterns**: Mouse wheel, drag pan, trackpad, keyboard shortcuts
4. **Zoom Level Management**: Fit/fill calculations, presets, state management
5. **Preview Quality Switching**: Threshold logic, debouncing, memory considerations

**Key Decisions**:
1. **Transform Approach**: CSS transforms on a container wrapping image + all overlays
2. **State Management**: Zoom/pan state in editUI.ts with per-image LRU caching
3. **Interactions**:
   - Mouse wheel: Zoom toward cursor
   - Click+drag: Pan when zoomed in
   - Double-click: Toggle fit/100%
   - Z key: Toggle fit/100%
   - Cmd/Ctrl+0/1/+/-: Zoom presets/in/out
   - Spacebar+drag: Temporary pan mode
4. **Quality Switching**: Deferred to future iteration (current 1x preview sufficient)

**Files Created** (3 files):
- `docs/research/2026-01-22-zoom-pan-research-plan.md`
- `docs/research/2026-01-22-zoom-pan-synthesis.md`
- `docs/plans/2026-01-22-zoom-pan-plan.md`

**Next Steps** (per implementation plan):
1. Create `apps/web/app/utils/zoomCalculations.ts` - Pure zoom math functions
2. Add zoom state to `apps/web/app/stores/editUI.ts`
3. Create `apps/web/app/composables/useZoomPan.ts` - Main composable
4. Update `EditPreviewCanvas.vue` with transform container
5. Update crop/mask overlay coordinate handling
6. Add keyboard shortcuts and UI controls

---

## 143: 2026-01-22 19:16 EST: Zoom/Pan Feature - Phase 1 Implementation Complete

**Objective**: Implement core zoom/pan infrastructure (Phase 1 of zoom/pan plan).

**Implementation Completed**:

### Phase 1.1: Create Zoom Utilities
- Created `apps/web/app/utils/zoomCalculations.ts` with pure functions:
  - `Camera` interface (scale, panX, panY)
  - `ZoomPreset` type (fit, fill, 50%, 100%, 200%, custom)
  - `calculateFitScale()`, `calculateFillScale()` - Scale calculations
  - `clampScale()`, `clampPan()` - Constraint functions
  - `zoomToPoint()`, `zoomIn()`, `zoomOut()` - Zoom operations
  - `screenToImage()`, `imageToScreen()` - Coordinate conversion
  - `canPan()`, `createCameraForPreset()`, `getZoomPercentage()`, `detectPreset()`

### Phase 1.2: Add Zoom State to editUI Store
- Extended `apps/web/app/stores/editUI.ts` with:
  - `camera`, `zoomPreset`, `isZoomInteracting` refs
  - `imageDimensions`, `viewportDimensions` refs
  - `zoomPercentage`, `fitScale`, `canPanImage` computed
  - Per-image zoom cache (LRU, max 50 entries)
  - Methods: setCamera, setZoomPreset, zoomToPointAction, zoomIn, zoomOut, toggleZoom, resetZoom, pan, cacheZoomForAsset, restoreZoomForAsset, initializeZoom

### Phase 1.3: Create useZoomPan Composable
- Created `apps/web/app/composables/useZoomPan.ts`:
  - Handles mouse wheel zoom (toward cursor position)
  - Handles click+drag pan (when zoomed in)
  - Handles double-click toggle (fit/100%)
  - Handles spacebar pan mode
  - ResizeObserver for viewport dimension tracking
  - Image load listener for dimension tracking
  - Returns transformStyle, cursorStyle, zoom methods

### Phase 2.1: Update EditPreviewCanvas Structure
- Updated `apps/web/app/components/edit/EditPreviewCanvas.vue`:
  - Added outer zoom container (receives wheel/mouse events)
  - Added transform container (applies CSS transform)
  - Nested image + all overlay canvases inside transform container
  - Added zoom controls (-, %, +, Fit, 1:1 buttons)
  - Added zoom percentage indicator
  - Added cache/restore zoom state on asset change

### Phase 4.1: Add Keyboard Shortcuts
- Updated `apps/web/app/pages/edit/[id].vue`:
  - `Z` - Toggle between fit and 100%
  - `Cmd/Ctrl + 0` - Fit to view
  - `Cmd/Ctrl + 1` - 100% zoom
  - `Cmd/Ctrl + +` - Zoom in
  - `Cmd/Ctrl + -` - Zoom out

### Phase 4.2: Update Help Modal
- Updated `apps/web/app/components/help/HelpModal.vue`:
  - Added new "Zoom" section in Edit View column
  - Documented all zoom keyboard shortcuts
  - Added Space+Drag pan instruction

**Files Created** (2 files):
- `apps/web/app/utils/zoomCalculations.ts` (~220 lines)
- `apps/web/app/composables/useZoomPan.ts` (~260 lines)

**Files Modified** (4 files):
- `apps/web/app/stores/editUI.ts` - Added zoom/pan state (~150 lines added)
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Transform container + controls
- `apps/web/app/pages/edit/[id].vue` - Zoom keyboard shortcuts
- `apps/web/app/components/help/HelpModal.vue` - Zoom shortcuts documentation

**Tests**: Build completes successfully

**Deferred Items**:
- Overlay coordinate handling (crop/mask overlays need camera-aware coordinates when interacting while zoomed)
- Preview quality switching (using 2x preview at high zoom levels)

---

## 144: 2026-01-22 19:28 EST: Zoom/Pan Feature - Overlay Verification Complete

**Objective**: Verify that crop and mask overlays work correctly when zoomed.

**Initial Hypothesis**:
The crop and mask overlay composables calculate coordinates based on the canvas bounding rect, but when the user zooms in, the CSS transform moves the canvas. The mouse coordinates might need to be converted from screen space to image space using the camera transform.

**Investigation**:
1. Analyzed `getCanvasCoords()` in cropUtils.ts and maskUtils.ts
2. The formula: `(e.clientX - rect.left) * (canvas.width / rect.width)`
3. This actually **already handles CSS transforms correctly** because:
   - `getBoundingClientRect()` returns the transformed position and size
   - When zoomed 2x, `rect.width = canvas.width * 2` (CSS transform effect)
   - So `canvas.width / rect.width = 0.5`, correctly scaling screen pixels to canvas pixels

**Browser Testing**:
1. Loaded demo mode with test images
2. Opened edit view on a test image
3. Expanded "Crop & Transform" panel to show crop overlay
4. Zoomed in using zoom buttons (to 220%)
5. Performed mouse drag on crop canvas while zoomed
6. **Result**: Drag created a crop selection that followed the cursor correctly

**Conclusion**: No changes needed! The existing coordinate conversion handles CSS transforms correctly because `getBoundingClientRect()` accounts for the transform.

**Files Modified**: None (only added documentation to cropUtils.ts explaining why it works)

**Updated cropUtils.ts Comment**:
```typescript
/**
 * Get canvas coordinates from mouse event.
 *
 * This function correctly handles CSS transforms (zoom/pan) because
 * getBoundingClientRect() returns the transformed position and size.
 * The formula (e.clientX - rect.left) * (canvas.width / rect.width)
 * correctly converts from screen pixels to canvas pixels regardless
 * of any CSS transform applied to the canvas or its ancestors.
 */
```

**Screenshots** (saved for verification):
- `zoom-test-03-demo-catalog.png` - Demo catalog loaded
- `zoom-test-05-crop-panel.png` - Crop panel expanded showing overlay
- `zoom-test-11-zoomed-for-crop.png` - Zoomed in at 220%
- `zoom-test-12-during-drag.png` - Drag operation creating crop selection

**Remaining Deferred Items**:
- Preview quality switching (using 2x preview at high zoom levels) - future iteration

---

