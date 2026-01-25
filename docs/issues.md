# Issues

## Table of Contents

### Open Issues
- [Keyboard flagging only affects current photo, not all selected (Medium)](#keyboard-flagging-only-affects-current-photo-not-all-selected)
- [Crop re-edit should show full uncropped image (Medium)](#crop-re-edit-should-show-full-uncropped-image)
- [Preview generation is slow (HIGH)](#preview-generation-is-slow)
- [Research: Edit operation caching (Low)](#research-edit-operation-caching)

### Recently Solved
- [Zoom fit doesn't center or fill correctly (Medium)](#zoom-fit-doesnt-center-or-fill-correctly---solved)
- [Crop tool should confirm before applying (Medium)](#crop-tool-should-confirm-before-applying---solved)
- [Zoom sensitivity too high (Medium)](#zoom-sensitivity-too-high---solved)
- [Rotation causes GPU error (Critical)](#rotation-causes-gpu-error---solved)
- [Preview not ready when clicking thumbnail (Medium)](#preview-not-ready-when-clicking-thumbnail---solved)
- [Gallery loading state after returning from edit (High)](#gallery-loading-state-after-returning-from-edit---solved)
- [Test coverage metrics (Medium)](#test-coverage-metrics---solved)
- [Previously opened folder auto-loads unexpectedly (Medium)](#previously-opened-folder-auto-loads-unexpectedly---solved)
- [Import UX feels slow (Medium)](#import-ux-feels-slow---solved)
- ["All" count keeps increasing (High)](#all-count-keeps-increasing---solved)
- [Export doesn't apply edits (Critical)](#export-doesnt-apply-edits---solved)
- [Export button always disabled (Medium)](#export-button-always-disabled---solved)
- [Clipping detection has false positives (Medium)](#clipping-detection-has-false-positives---solved)

### Solved Issues
- [Edit view should never use thumbnail (High)](#edit-view-should-never-use-thumbnail---solved)
- [Crop doesn't update the image (High)](#crop-doesnt-update-the-image---solved)
- [Export doesn't actually export anything (Critical)](#export-doesnt-actually-export-anything---solved)
- [Direct edit URL only loads current thumbnail in filmstrip (Medium)](#direct-edit-url-only-loads-current-thumbnail-in-filmstrip---solved)
- [Copy/Paste Settings - Paste does not apply settings (Critical)](#copypaste-settings---paste-does-not-apply-settings---solved)
- [Crop/transform controls not overlayed on preview (Medium)](#croptransform-controls-not-overlayed-on-preview---solved)
- [Edit preview uses thumbnail instead of full preview (Critical)](#edit-preview-uses-thumbnail-instead-of-full-preview---solved)
- [Histogram doesn't update when edits are made (High)](#histogram-doesnt-update-when-edits-are-made---solved)
- [Edit sliders don't match Lightroom behavior (Medium)](#edit-sliders-dont-match-lightroom-behavior---solved)
- [Direct URL navigation to edit view (Critical)](#direct-url-navigation-to-edit-view---solved)
- [Clipping overlay not rendered on preview (High)](#clipping-overlay-not-rendered-on-preview---solved)
- [Filmstrip navigation causes stuck loading state (Critical)](#filmstrip-navigation-causes-stuck-loading-state---solved)
- [E/Enter/D keys don't navigate to edit view (Medium)](#eenterd-keys-dont-navigate-to-edit-view---solved)
- [Arrow keys captured by image navigation (Medium)](#arrow-keys-captured-by-image-navigation---solved)
- [Histogram does not render correctly (Critical)](#histogram-does-not-render-correctly---solved)
- [Edit view preview not loading (Critical)](#edit-view-preview-not-loading---solved)
- [Folder selection shows "No supported images found" (Critical)](#folder-selection-shows-no-supported-images-found---solved)
- [Preview not updating when adjustments change (High)](#preview-not-updating-when-adjustments-change---solved)
- [Histogram not updating with adjustments (High)](#histogram-not-updating-with-adjustments---solved)
- [Histogram component name mismatch (High)](#histogram-component-name-mismatch---solved)
- [Nuxt v3 instead of v4](#nuxt-v3-instead-of-v4---solved)
- [Nuxt UI v3 instead of v4](#nuxt-ui-v3-instead-of-v4---solved)
- [Demo mode thumbnails don't load](#demo-mode-thumbnails-dont-load---solved)

---

## Open Issues

### Keyboard flagging only affects current photo, not all selected

**Severity**: Medium | **Type**: Bug | **Found**: 2026-01-25

**Problem**:
When multiple photos are selected in the grid view and a flag shortcut is pressed (P, X, or U), only the currently focused photo is flagged - the other selected photos remain unchanged.

**Steps to Reproduce**:
1. Open catalog grid view with multiple photos
2. Click on a photo to select it
3. Cmd/Ctrl+Click on 2 more photos to add to selection (header shows "3 selected")
4. Press P to mark as Pick
5. Observe: Only the current photo gets the green checkmark badge
6. The other 2 selected photos remain unchanged

**Expected Behavior**:
All 3 selected photos should be marked as Pick when P is pressed.

**Actual Behavior**:
Only the current/focused photo is affected by the flag shortcut.

**Technical Details**:
Verified by checking `data-flag` attribute on grid cells:
- After selecting 3 unflagged photos and pressing P, only 1 has `data-flag="pick"`
- The other 2 still have `data-flag="none"` despite showing selection indicators

**Files to Investigate**:
- `apps/web/app/components/catalog/CatalogGrid.vue` - keyboard event handlers
- `apps/web/app/stores/selection.ts` - selection state
- `apps/web/app/composables/useCatalogKeyboard.ts` - keyboard shortcut handling

**Screenshots**:
- `docs/screenshots/qa-flagging-10-multi-select.png` - 3 photos selected
- `docs/screenshots/qa-flagging-11-multi-flag-bug.png` - After P pressed, only 1 flagged

---

### Crop re-edit should show full uncropped image

**Severity**: Medium | **Type**: UX Enhancement

**Problem**:
When re-entering the crop tool on an already-cropped image, the view only shows the currently cropped region. Users cannot see the parts of the image that were previously cropped out.

**Expected Behavior**:
When opening the crop tool on an image that already has a crop applied:
1. Show the full original uncropped image
2. Display the current crop region as an overlay on the full image
3. Allow users to see and potentially include areas that were previously excluded
4. This matches Lightroom's behavior where you can always see the full image when adjusting crop

**Current Behavior**:
The crop overlay only shows within the already-cropped boundaries, making it impossible to expand the crop to include previously excluded areas.

**Files to Investigate**:
- `apps/web/app/composables/useCropOverlay.ts`
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/stores/editUI.ts`

---

### Preview generation is slow

**Severity**: Medium | **Type**: Performance

**Problem**:
Preview generation takes a long time, creating UX issues. Users often have to wait for previews to load when navigating between photos.

**Potential Optimizations**:
1. **Background preview generation**: When the edit pipeline is idle, proactively generate previews for adjacent photos in the filmstrip
2. **Priority queue tuning**: Ensure visible/near-visible photos get priority
3. **Lower-resolution intermediate previews**: Show a lower-res preview quickly while generating the full preview
4. **Preview caching**: Ensure previews are properly cached and reused

**Research Questions**:
- What is the current bottleneck (decode, GPU processing, encoding)?
- How many previews can be generated per second?
- Would generating previews in parallel help?

---

### Research: Edit operation caching

**Severity**: Low (Research) | **Type**: Performance Investigation

**Context**:
The current edit pipeline re-runs all operations from source pixels on every render:
```
Source → Rotation → Crop → Adjustments → Tone Curve → Masks
```

**Potential Optimization**:
Cache intermediate results (e.g., post-crop pixels) so subsequent renders only re-run downstream operations:
```
Crop/rotation change: Source → Rotation → Crop → [Cache]
Adjustment change:    [Cached] → Adjustments → Tone Curve → Masks
```

**Research Questions**:
1. What is the actual performance impact of the current approach?
2. How much memory would intermediate caching require?
3. How complex is cache invalidation when different parameters change?
4. Is this premature optimization given GPU pipeline already achieves <50ms renders?
5. Are there simpler wins (e.g., better throttling) that provide more value?

**Decision Needed**:
Research whether staged caching would meaningfully improve performance or if it adds unnecessary complexity for marginal gains.

---

## Recently Solved

### Zoom fit doesn't center or fill correctly - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-23

**Problem**:
When using the "Fit" zoom option in the edit view:
1. The image doesn't center properly in the edit pane
2. The image doesn't fill the available space correctly

**Root Cause**:
When `restoreZoomForAsset()` was called during asset navigation (before the new image loads), it called `setZoomPreset('fit')` which immediately calculated the camera using STALE dimensions from the store (from the previous asset or 0x0). The `setZoomPreset()` function unconditionally calculated camera even with invalid dimensions.

**Fix Applied**:
1. Modified `setZoomPreset()` in `editUI.ts` to only calculate camera when dimensions are valid (all > 0)
2. Updated `initializeZoom()` to recalculate camera for ALL presets (fit, fill, 100%, 200%), not just 'fit'
3. Now preset is always set, but camera calculation is deferred until `initializeZoom()` when dimensions become valid

**Files Modified** (1):
- `apps/web/app/stores/editUI.ts` - setZoomPreset and initializeZoom dimension guards

**Tests Added** (5):
- Sets preset but defers camera when image dimensions are 0
- Sets preset but defers camera when viewport dimensions are 0
- Sets preset but defers camera when all dimensions are 0
- Calculates camera when initializeZoom called after dimensions set
- Defers all preset calculations, then calculates on initializeZoom

---

### Crop tool should confirm before applying - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-23

**Problem**:
Crop changes were applied immediately as the user dragged crop handles, making it difficult to preview the crop before committing.

**Fix Applied**:
Implemented a confirmation workflow for the crop tool:

1. **Pending Crop State** (`editUIStore`):
   - Added `pendingCrop` state that holds uncommitted crop changes
   - Changes only commit to edit store when user explicitly applies

2. **EditCropActionBar Component**:
   - Action bar appears at top center when crop tool is active
   - "Set Crop" button applies changes
   - "Cancel" button discards changes
   - "Reset" button clears crop to full image

3. **Keyboard Shortcuts**:
   - Enter key applies pending crop
   - Escape key cancels (instead of navigating away)

4. **Accordion Integration**:
   - Accordion collapses when crop is applied or cancelled

**Files Modified** (6):
- `apps/web/app/stores/editUI.ts` - Pending crop state and methods
- `apps/web/app/components/edit/EditCropActionBar.vue` - NEW component
- `apps/web/app/composables/useCropOverlay.ts` - Use pending state
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Integrate action bar
- `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
- `apps/web/app/components/edit/EditControlsPanel.vue` - Accordion behavior

**Tests Added** (20):
- 8 tests for pending crop state in editUIStore
- 12 tests for EditCropActionBar component

---

### Zoom sensitivity too high - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-23

**Problem**:
The zoom feature was too sensitive when scrolling/pinching. Small movements caused large zoom changes, making it difficult to achieve the desired zoom level.

**Root Cause**:
Binary delta mapping in `handleWheel()` treated all deltaY values the same - both gentle scrolls (deltaY=1) and fast scrolls (deltaY=100) produced identical 25% zoom changes.

**Fix Applied**:
1. Changed `ZOOM_STEP` from 1.25 to 1.1 (10% instead of 25% for button zoom)
2. Implemented proportional delta mapping in `handleWheel()`:
   - Uses exponential scaling: `Math.pow(2, -deltaY * sensitivity)`
   - Different sensitivity for pinch (0.01) vs scroll (0.002)
   - Clamped factor (0.5-2.0) to prevent extreme jumps

**Files Modified** (2):
- `apps/web/app/utils/zoomCalculations.ts` - Changed ZOOM_STEP
- `apps/web/app/composables/useZoomPan.ts` - Proportional delta mapping

---

### Zoom fit doesn't center or fill correctly - REOPENED

**Severity**: Medium | **Attempted Fix**: 2026-01-23 | **Status**: Reopened

**Problem**:
When using the "Fit" zoom option in the edit view, the image didn't center properly in the edit pane.

**Fix Attempted**:
Updated `updateImageDimensions()` and `updateViewportDimensions()` to only call `initializeZoom()` when BOTH dimensions are valid (width > 0 and height > 0).

**Result**: Did not fully resolve the issue. See open issue for continued tracking.

**Files Modified** (1):
- `apps/web/app/composables/useZoomPan.ts` - Added dimension guards

---

### Rotation causes GPU error - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-23

**Problem**:
Rotation didn't work at all. The preview showed a black image with a GPU error about bytesPerRow not being a multiple of 256.

**Root Cause**:
WebGPU requires `bytesPerRow` to be a multiple of 256 when copying texture data to buffers with `copyTextureToBuffer()`. The implementation used `width * 4` which fails for image widths where this isn't a multiple of 256.

**Fix Applied**:
1. Added `alignTo256()` utility function in `texture-utils.ts`
2. Added `removeRowPadding()` utility to strip alignment padding from readback data
3. Updated `readTexturePixels()` to use aligned bytesPerRow and remove padding
4. Updated all pipeline `apply()` methods to use alignment:
   - `rotation-pipeline.ts`
   - `adjustments-pipeline.ts`
   - `tone-curve-pipeline.ts`

**Files Modified** (4):
- `packages/core/src/gpu/texture-utils.ts`
- `packages/core/src/gpu/pipelines/rotation-pipeline.ts`
- `packages/core/src/gpu/pipelines/adjustments-pipeline.ts`
- `packages/core/src/gpu/pipelines/tone-curve-pipeline.ts`

**Tests Added** (14):
- `alignTo256()` tests for various alignment cases
- `removeRowPadding()` tests for padding removal
- `readTexturePixels()` tests for aligned buffer operations

---

### Preview not ready when clicking thumbnail - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-22

**Problem**:
When a thumbnail is visible (appears loaded), users may double-click to enter edit view, but the preview is still generating. This creates confusion.

**Fix Applied** (3 phases in iteration 140):

1. **Early preview request on double-click** (CatalogThumbnail.vue):
   - Added `requestPreview(props.asset.id, ThumbnailPriority.VISIBLE)` before `router.push()`
   - Preview generation starts during navigation transition

2. **Early preview request on keyboard navigation** (CatalogGrid.vue):
   - Added `requestPreview(currentId, ThumbnailPriority.VISIBLE)` before `navigateTo()`
   - E/Enter/D key navigation also triggers early preview generation

3. **Preview-first priority in edit view** (useEditPreview.ts):
   - Preview requested at `ThumbnailPriority.VISIBLE` (Priority 0 - highest)
   - Thumbnail requested at `ThumbnailPriority.PRELOAD` (Priority 2 - lower)
   - In edit view, preview is the primary display (2560px) - thumbnail only a fallback

**Files Modified** (3 files):
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/components/catalog/CatalogGrid.vue`
- `apps/web/app/composables/useEditPreview.ts`

**Result**: When users click or keyboard-navigate to edit view:
- Preview generation starts immediately (before navigation)
- Preview gets highest priority in the queue
- Thumbnail gets lower priority (only needed as fallback)
- Perceived loading time is reduced

---

### Gallery loading state after returning from edit - SOLVED

**Severity**: High | **Fixed**: 2026-01-22

**Problem**:
When returning to the gallery from the edit page:
- Sometimes only a loading state is shown with no thumbnails
- Thumbnails are not updated/regenerated to reflect edits made to the photo

**Issue 1 - Loading State Fix** (SOLVED):
Added defensive guards in CatalogGrid.vue:
- `v-if` check on CatalogThumbnail to skip rendering for missing assets
- Fallback placeholder with loading animation for missing assets
- Debug logging when asset ID exists but asset data missing

**Issue 2 - Thumbnails Don't Reflect Edits** (SOLVED):
Implemented full thumbnail regeneration pipeline:
- Worker message type `GenerateEditedThumbnailRequest` for generating edited thumbnails
- Full edit pipeline in worker (decode → rotate → crop → adjust → curve → masks → resize → encode)
- `generateEditedThumbnail()` method in DecodeService and MockDecodeService
- Regeneration methods in ThumbnailService with generation tracking
- `regenerateThumbnail()` in CatalogService and useCatalog composable
- Edit page triggers regeneration on unmount when modifications exist
- Visual feedback: old thumbnail shown at 70% opacity during regeneration

**Files Modified**: Multiple files across packages/core and apps/web

---

### Import UX feels slow - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-22

**Problem**:
The import experience feels slow and lacks feedback. Users are dropped into a gallery with loading placeholders without knowing the import progress.

**Fix Applied**:
1. Added thumbnail progress tracking to catalog store (`thumbnailProgress`, `thumbnailPercent`, `isProcessingThumbnails`)
2. Added progress indicator in FilterBar showing ready/total count and progress bar
3. Wait for first page of thumbnails (~20) before showing gallery view
4. Fixed priority system to use `ThumbnailPriority` enum values
5. Integrated IntersectionObserver for dynamic priority updates based on visibility
6. Added loading messages ("Scanning folder...", "Preparing gallery...") with progress bars

**Result**: Gallery now shows thumbnails (not loading placeholders) when users enter, with visible progress during thumbnail generation.

---

### "All" count keeps increasing - SOLVED

**Severity**: High | **Fixed**: 2026-01-22

**Problem**:
Every time a user navigates from the edit page back to the gallery, the "All" count in the filter bar increases.

**Root Cause Analysis**:
The bug was unable to be reproduced after extensive testing (5+ navigation cycles, browser back button, page reload). However, a potential vulnerability was identified in `addAssetBatch()` where duplicate IDs could be added to the `assetIds` array if called multiple times without clearing.

**Fix Applied** (defensive):
1. **Duplicate ID prevention in `addAssetBatch()`** - Now uses a Set to track existing IDs and only adds new ones
2. **Guard in `restoreSession()`** - Skips re-initialization if assets are already loaded, preventing unnecessary rescans when returning from edit view

**Files Modified**:
- `apps/web/app/stores/catalog.ts`
- `apps/web/app/composables/useCatalog.ts`

---

## Solved Issues

### Test coverage metrics - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-22

**Problem**:
No test coverage tracking existed for the project, making it difficult to track code quality progress.

**Fix Applied**:
1. Added V8 coverage provider configuration to `packages/core/vitest.config.ts`
2. Added V8 coverage provider configuration to `apps/web/vitest.config.ts`
3. Added `coverage` scripts to package.json files
4. Installed `@vitest/coverage-v8` dependencies

**Current Coverage**:
| Package | Lines | Branches | Functions | Statements |
|---------|-------|----------|-----------|------------|
| @literoom/core | 32.38% | 90.79% | 79.87% | 32.38% |
| @literoom/web | 22.52% | 86.77% | 51.56% | 22.52% |

**Usage**:
```bash
pnpm coverage       # Run all coverage
pnpm coverage:core  # Run core package only
pnpm coverage:web   # Run web app only
```

**Note**: Thresholds are set low initially due to browser-only code that can't be tested in Node.js. CI integration with Codecov deferred to future iteration.

---

### Previously opened folder auto-loads unexpectedly - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-22

**Problem**:
When loading the app or clicking "Select Folder" after previously loading a folder, the app automatically loads the previous folder. This is unexpected UX behavior.

**Fix Applied**:
1. Added `listFolders()` and `loadFolderById()` methods to CatalogService
2. Created `useRecentFolders` composable for folder management
3. Created `RecentFoldersDropdown` component for header
4. Updated welcome screen to show list of recent folders as clickable cards
5. Changed initialization behavior: home page no longer auto-restores previous folder
6. Edit page deep links still auto-restore (preserved for bookmarks/shared links)

**Files Created** (2):
- `apps/web/app/composables/useRecentFolders.ts`
- `apps/web/app/components/catalog/RecentFoldersDropdown.vue`

**Files Modified** (5):
- `packages/core/src/catalog/types.ts`
- `packages/core/src/catalog/catalog-service.ts`
- `packages/core/src/catalog/mock-catalog-service.ts`
- `packages/core/src/catalog/index.ts`
- `apps/web/app/pages/index.vue`

**Result**: Users now see their recent folders on the welcome screen and can choose which to open, rather than having the previous folder auto-load.

---

### Export doesn't apply edits - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-22

**Problem**:
The export feature exported the original image without applying any edits.

**Root Causes Fixed** (2 bugs):
1. **Edit State Retrieval Failed**: `getEditState()` only returned edits for the currently-viewed asset. All other assets returned `null` because there was no persistence.
2. **Masked Adjustments Missing**: The export pipeline didn't call `applyMaskedAdjustments` at all.

**Fix Applied**:
1. Added in-memory edit cache (`editCache: Map<string, EditState>`) to edit store
2. Cache is updated immediately whenever edits change
3. On asset switch, current edits are saved to cache before switching
4. Export retrieves edits from cache using `getEditStateForAsset()`
5. Added `masks` field to `ExportEditState` interface
6. Added `applyMaskedAdjustments` to export dependencies and pipeline

**Files Modified** (5):
- `packages/core/src/export/types.ts`
- `packages/core/src/export/export-service.ts`
- `packages/core/src/export/export-service.test.ts`
- `apps/web/app/stores/edit.ts`
- `apps/web/app/composables/useExport.ts`

**Note**: ~~Edits are session-cached only (lost on page refresh). Database persistence can be added in a future iteration.~~ **UPDATE 2026-01-22**: Edits now persist to IndexedDB and survive page refresh. Fixed by calling `editStore.initializeFromDb()` on app startup.

---

### Export button always disabled - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-22

**Problem**:
The Export button in the FilterBar was disabled when `catalogStore.pickCount === 0`, blocking users from accessing the export modal to change the export scope.

**Root Cause**:
Line 163 in `FilterBar.vue` used the wrong disabled condition.

**Fix Applied**:
Changed the disabled condition from `pickCount === 0` to `totalCount === 0`. Now the button is enabled whenever there are images in the catalog.

**File Modified**:
- `apps/web/app/components/catalog/FilterBar.vue`

---

### Clipping detection has false positives - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The clipping visualization now uses per-channel color coding like Lightroom, showing which specific channels (R, G, B) are clipped instead of using a single color for all clipping.

**Original Problem**:
- Clipping overlay showed all pixels the same way (red for highlights, blue for shadows)
- No distinction between single-channel clipping (often acceptable) and all-channel clipping (true detail loss)
- False positives - marking pixels as "clipped" when only one channel reached limits

**Implementation**:

1. **6-bit per-pixel encoding** in `ClippingMap`:
   - Bits 0-2: Shadow clipping for R/G/B channels
   - Bits 3-5: Highlight clipping for R/G/B channels

2. **Per-channel highlight colors** (shows clipped channels):
   - White = all 3 channels (R=255, G=255, B=255) - true blown highlights
   - Red = only R clipped
   - Green = only G clipped
   - Blue = only B clipped
   - Yellow = R+G clipped
   - Magenta = R+B clipped
   - Cyan = G+B clipped

3. **Per-channel shadow colors** (shows remaining channels):
   - Dark gray = all 3 channels clipped - true crushed shadows
   - Cyan = R clipped (G+B remain)
   - Magenta = G clipped (R+B remain)
   - Yellow = B clipped (R+G remain)

4. **Histogram triangle indicators** use same per-channel color coding

**Files Modified** (6):
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/composables/useClippingOverlay.ts`
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`
- `packages/core/src/decode/types.ts`
- `packages/core/src/decode/index.ts`
- `packages/core/src/decode/mock-decode-service.ts`

**Verification**:
- ✅ Red-tinted image with increased exposure shows red overlay for R-only clipping
- ✅ Very bright areas show white overlay for all-channel clipping
- ✅ Histogram triangles display correct per-channel colors
- ✅ Toggle buttons show matching per-channel indicator colors

---

### Crop doesn't update the image - SOLVED

**Severity**: High | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The crop feature is **working correctly**. This issue was based on a misunderstanding of the expected behavior.

**Original Concern**:
The reporter thought the crop wasn't being applied because the image still showed the full preview while editing.

**Actual Behavior (Correct)**:
1. **When crop tool is ACTIVE** (Crop & Transform section expanded):
   - Full image is shown with crop overlay
   - User can see and adjust the crop region with handles
   - Dark mask shows the area that will be cropped out

2. **When crop tool is INACTIVE** (Crop & Transform section collapsed):
   - Only the cropped region is displayed
   - Preview shows the final cropped result
   - This is what will be exported

**Why This Behavior is Correct**:
This matches professional photo editors like Lightroom - when editing a crop, you need to see the full image to decide what to include/exclude. The cropped result is shown when you're done editing (collapse the section).

**Verification Steps**:
1. Enter edit view, expand "Crop & Transform" section
2. Drag crop handles to select a region
3. Note: Full image visible with overlay showing crop region
4. Collapse "Crop & Transform" section
5. Observe: Preview now shows ONLY the cropped portion
6. The histogram updates to reflect the cropped image

**Screenshots**:
- `docs/screenshots/crop-test-08-after-long-wait.png` - Crop tool active (full image + overlay)
- `docs/screenshots/crop-test-09-crop-collapsed.png` - Crop tool inactive (cropped result)

---

### Edit view should never use thumbnail - SOLVED

**Severity**: High | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The edit view now shows a loading state until the full 2560px preview is ready, instead of showing the pixelated 512px thumbnail.

**Original Problem**:
- Edit view showed pixelated thumbnail while preview generates
- Users could start making edits on a low-quality image
- Created confusion about actual image quality

**Fix Applied**:
1. Added `isWaitingForPreview` state to `useEditPreview.ts`
2. Updated asset watcher to check preview status:
   - If preview is cached → show immediately
   - If preview not ready → set `isWaitingForPreview = true`, keep `previewUrl = null`
3. Added watcher for preview URL becoming available
4. Added watcher for preview generation errors (falls back to thumbnail with warning)
5. Updated `EditPreviewCanvas.vue` loading condition to check `isWaitingForPreview`
6. Updated loading message to show "Generating preview..." when waiting

**Files Modified**:
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/components/edit/EditPreviewCanvas.vue`

**Verification**:
- ✅ Edit view shows loading state until 2560px preview ready
- ✅ Never displays pixelated 512px thumbnail in edit canvas
- ✅ Cached previews display immediately (no loading flash)
- ✅ Works in both demo mode and real mode
- ✅ All existing tests pass

---

## Solved Issues

### Export doesn't actually export anything - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21

The export feature now works correctly in both demo mode and real mode.

**Original Problems**:
1. Export process didn't produce any output files
2. No progress meter in the toolbar to show background export progress
3. User had no visibility into whether export was working or its current state

**Root Causes Fixed**:
1. **Demo mode broke `loadImageBytes()`** - The function required a real folder handle from `catalogService.getCurrentFolder()`, which returns `null` in demo mode
2. **No error logging** - Export errors were captured but never logged to console, making debugging impossible
3. **No progress indicator** - User had no way to see export progress

**Implementation**:
1. Added `console.error()` logging in export service catch block
2. Added `generateDemoImageBytes()` function that creates synthetic JPEG images using canvas for demo mode
3. Enhanced toast messages to show failure details (first 3 filenames + error message)
4. Added progress indicator to FilterBar showing current/total count and progress bar

**Files Modified**:
- `packages/core/src/export/export-service.ts` - Error logging
- `apps/web/app/composables/useExport.ts` - Demo mode image loading + error display
- `apps/web/app/components/catalog/FilterBar.vue` - Progress indicator

---

### Crop/transform controls not overlayed on preview - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The crop overlay is now displayed on the main preview canvas when the "Crop & Transform" section is expanded. Users can interact with the crop region directly on the full-size preview.

**Original Problem**:
- Crop region only visible in small thumbnail in right panel
- No crop overlay on main preview canvas
- Users couldn't precisely position crops on the full-size preview

**Implementation** (7 phases):
1. Extended editUI store with `isCropToolActive` state and toggle methods
2. Created `cropUtils.ts` with shared utilities (coordinates, rendering, hit detection)
3. Created `useCropOverlay.ts` composable for overlay interaction
4. Added crop canvas to `EditPreviewCanvas.vue` (conditionally rendered)
5. Connected accordion expansion to crop tool activation
6. Added cleanup on navigation (deactivate crop tool on unmount)
7. Refactored useCropEditor to use shared utilities

**Features Implemented**:
- ✅ Dark mask outside crop region
- ✅ Rule of thirds grid inside crop area
- ✅ 8 resize handles (corners + midpoints)
- ✅ Interactive resize via handle drag
- ✅ Interactive move via interior drag
- ✅ Aspect ratio constraint support
- ✅ Debounced store sync during drag
- ✅ Cursor feedback (resize cursors, grab/grabbing)
- ✅ Overlay hidden when crop section collapsed

**Files Created** (2 files):
- `apps/web/app/composables/cropUtils.ts`
- `apps/web/app/composables/useCropOverlay.ts`

**Files Modified** (4 files):
- `apps/web/app/stores/editUI.ts`
- `apps/web/app/components/edit/EditPreviewCanvas.vue`
- `apps/web/app/components/edit/EditControlsPanel.vue`
- `apps/web/app/pages/edit/[id].vue`

**Screenshots**:
- `docs/screenshots/verify-crop-overlay-03-crop-expanded.png` - Crop overlay visible
- `docs/screenshots/verify-crop-overlay-04-after-resize.png` - After resize interaction
- `docs/screenshots/verify-crop-overlay-06-collapsed.png` - Overlay hidden when collapsed

---

### Edit preview uses thumbnail instead of full preview - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21

The edit view now uses high-resolution previews (2560px) instead of small thumbnails (512px) for the preview canvas.

**Original Problem**:
- Edit preview used the same small thumbnail displayed in the grid view
- Image appeared pixelated/blurry when displayed at edit view size
- Cannot see fine details needed for editing decisions
- Professional editing workflow completely blocked

**Fix Applied** (8-phase implementation):
1. Extended `Asset` interface with `preview1xStatus` and `preview1xUrl` fields
2. Created `PreviewCache` class with separate OPFS directory and smaller memory LRU (20 items)
3. Extended `ThumbnailService` with preview queue, cache, and processing methods
4. Added preview update actions to catalog store
5. Added preview request methods to `CatalogService`
6. Wired preview callbacks in catalog plugin
7. Updated `useEditPreview` to prefer `preview1xUrl`, request preview on mount
8. Updated `MockCatalogService` for demo mode support

**Files Modified** (9 files):
- `packages/core/src/catalog/types.ts`
- `packages/core/src/catalog/thumbnail-cache.ts`
- `packages/core/src/catalog/thumbnail-service.ts`
- `packages/core/src/catalog/catalog-service.ts`
- `packages/core/src/catalog/mock-catalog-service.ts`
- `apps/web/app/stores/catalog.ts`
- `apps/web/app/plugins/catalog.client.ts`
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/composables/useCatalog.ts`

**Architecture**:
- Preview generation uses same priority queue pattern as thumbnails
- Separate OPFS directory ('previews') prevents cache collision
- Smaller memory cache (20 vs 150 items) accounts for larger preview sizes
- Edit view immediately requests both thumbnail (fast) and preview (high quality)
- `useEditPreview` automatically uses preview1x when available, falls back to thumbnail

---

### Histogram doesn't update when edits are made - SOLVED

**Severity**: High | **Fixed**: 2026-01-21

The histogram now updates in real-time when adjustments are made to the image.

**Root Cause**: The histogram was computing from source (thumbnail) pixels, not from adjusted pixels. This was an intentional MVP design decision documented in the code.

**Fix Applied**:
1. Modified `useEditPreview.ts` to export `adjustedPixels` and `adjustedDimensions` shallowRefs
2. Modified `useHistogramDisplay.ts` and `useHistogramDisplaySVG.ts` to accept optional adjusted pixels refs
3. Added watchers that trigger histogram recomputation when adjusted pixels change
4. Updated histogram components to accept and pass adjusted pixels props
5. Wired up `EditPreviewCanvas` to expose adjusted pixels, and edit page to pass them to histogram

**Files Modified** (7 files):
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/composables/useHistogramDisplay.ts`
- `apps/web/app/composables/useHistogramDisplaySVG.ts`
- `apps/web/app/components/edit/EditHistogramDisplay.vue`
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`
- `apps/web/app/components/edit/EditPreviewCanvas.vue`
- `apps/web/app/pages/edit/[id].vue`

---

### Edit sliders don't match Lightroom behavior - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21

The edit sliders now have Lightroom-style reset interactions and organized panel groups.

**Fix Applied**:
1. **Reset Interactions**: Double-click or Alt+click on slider label resets to default (0)
2. **Panel Organization**: Basic panel now organized into Lightroom-style groups:
   - **White Balance**: Temperature, Tint
   - **Tone**: Exposure, Contrast, Highlights, Shadows, Whites, Blacks
   - **Presence**: Vibrance, Saturation

**Files Modified**:
- `apps/web/app/components/edit/EditAdjustmentSlider.vue` - Added Alt+click reset handler
- `apps/web/app/components/edit/EditControlsPanel.vue` - Reorganized into grouped layout

---

### Direct URL navigation to edit view - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

Direct URL navigation to `/edit/[id]` now works correctly. When navigating directly via URL (e.g., refreshing the page or sharing a link), the edit page loads with all data populated.

**Original Problem**:
- Edit page showed empty state when navigating directly
- Header showed "0 / 0" instead of asset position
- Preview showed "Loading preview..." indefinitely
- Histogram showed "Loading..." indefinitely
- Catalog assets were not loaded when bypassing home page

**Root Cause**: The `ensure-catalog` middleware only waited for the catalog service to be created, not for assets to be loaded. In demo mode, assets were only loaded via `selectFolder()` on the home page.

**Fix Applied**:
1. Added `initializeCatalog()` helper function to `catalog.client.ts` plugin
2. Function checks if assets exist, if not initializes catalog
3. In demo mode: auto-loads demo catalog via `selectFolder()` + `scanFolder()`
4. In real mode: restores from database via `loadFromDatabase()`
5. Updated middleware to call `$initializeCatalog()` after `$catalogReady`
6. Added TypeScript type augmentation for `NuxtApp` interface

**Files Modified**:
- `apps/web/app/plugins/catalog.client.ts` - Added initialization helper
- `apps/web/app/middleware/ensure-catalog.ts` - Call initialization helper

**Verification**:
- ✅ Direct URL navigation works in demo mode
- ✅ Page refresh maintains state
- ✅ Navigation to different assets via URL works
- ✅ Preview, histogram, filmstrip all load correctly

---

### Clipping overlay not rendered on preview - SOLVED

**Severity**: High | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The clipping overlay feature is now fully implemented. When enabled, pixels that are clipped in shadows (R, G, or B = 0) are highlighted in blue, and pixels clipped in highlights (R, G, or B = 255) are highlighted in red on the preview image.

**Implementation**:
1. Created `editUI` Pinia store to share clipping toggle state between histogram and preview
2. Added `ClippingMap` interface and `detectClippedPixels()` function to `useEditPreview.ts`
3. Created `useClippingOverlay.ts` composable for overlay rendering
4. Updated `EditPreviewCanvas.vue` with overlay canvas element

**Files Created**:
- `apps/web/app/stores/editUI.ts`
- `apps/web/app/composables/useClippingOverlay.ts`

**Files Modified**:
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/composables/useHistogramDisplay.ts`
- `apps/web/app/composables/useHistogramDisplaySVG.ts`
- `apps/web/app/components/edit/EditHistogramDisplay.vue`
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue`
- `apps/web/app/components/edit/EditPreviewCanvas.vue`

---

### Filmstrip navigation causes stuck loading state - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

Rapidly clicking between thumbnails in the edit view filmstrip previously caused both the preview and histogram to get stuck in a "Loading..." state. This critical bug has been fixed.

**Original Problem**:
- After rapid navigation between filmstrip thumbnails, preview showed "Loading preview..." indefinitely
- Histogram showed "Loading..." indefinitely
- In severe cases: Header showed "0 / 0", filmstrip became empty
- Console showed Vue warnings about readonly ref mutations

**Root Causes Fixed**:
1. Race conditions in async operations - Now handled with proper operation cancellation
2. Readonly ref mutation attempts - No longer attempting to mutate readonly refs
3. shallowRef reactivity issues - Reactivity now triggers correctly

**Verification Results**:
- ✅ Rapidly clicked 6 thumbnails in sequence - works
- ✅ Rapidly clicked 8 thumbnails in sequence - works
- ✅ Rapidly clicked 10 thumbnails in sequence - works
- ✅ No Vue reactivity errors in console
- ✅ Preview and histogram update correctly throughout
- ✅ Header shows correct asset position
- ✅ Filmstrip remains populated

**Screenshots**:
- `docs/screenshots/verify-filmstrip-fix-03-edit-view-working.png` - Working edit view
- `docs/screenshots/verify-filmstrip-fix-05-after-rapid-clicks.png` - After 6 rapid clicks (working)
- `docs/screenshots/verify-filmstrip-fix-07-after-10-rapid-clicks.png` - After 10 rapid clicks (working)

---

### Histogram does not render correctly - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21

The histogram was displaying a single gray/brown shape instead of separate overlapping R, G, B channel curves.

**Root Cause**: Two issues combined:
1. The `renderHistogram()` function in `useHistogramDisplay.ts` drew bars with alpha blending that resulted in a muddy appearance when channels overlapped
2. The `MockDecodeService.computeHistogram()` returned identical fake bell-curve data for all RGB channels, so even correct rendering would show the same shape for all channels

**Fix Applied**:
1. Rewrote `renderHistogram()` to draw each channel as a filled path with stroke outlines, layered correctly (blue back, green middle, red front)
2. Rewrote `MockDecodeService.computeHistogram()` to actually compute the histogram from pixel data instead of generating fake data

**Files Modified**:
- `apps/web/app/composables/useHistogramDisplay.ts`
- `packages/core/src/decode/mock-decode-service.ts`

---

### Edit view preview not loading - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21

Fixed by adding `requestThumbnail()` calls in `useEditPreview` and `useHistogramDisplay` composables. The root cause was that the edit view never requested thumbnail generation, so if navigating directly to edit view (or before thumbnails were ready), the `thumbnailUrl` would be `null` and the preview would never load. Now the composables request thumbnail generation with high priority (0) when the asset changes, and watch for the thumbnail URL to become available.

---

### Folder selection shows "No supported images found" - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21

Fixed by simplifying `useCatalog.selectFolder()` to call `catalogService.selectFolder()` directly, which properly handles the folder picker and sets `_currentFolder` internally. Also updated `restoreSession()` to use `catalogService.loadFromDatabase()` for consistent session restoration.

**Root Cause**: The `useCatalog.selectFolder()` function in real mode (non-demo) was using a separate `BrowserFileSystemProvider` to get a folder handle but never passed it to the CatalogService before calling `scanFolder()`. The CatalogService's `_currentFolder` was never set, causing `scanFolder()` to immediately throw `CatalogError('No folder selected', 'FOLDER_NOT_FOUND')`.

**Fix Applied**:
- Simplified `useCatalog.selectFolder()` to call `catalogService.selectFolder()` directly
- Updated `restoreSession()` to use `catalogService.loadFromDatabase()` for consistent session restoration
- Added `loadFromDatabase()` method to `ICatalogService` interface

**Files Modified**:
- `apps/web/app/composables/useCatalog.ts`
- `packages/core/src/catalog/types.ts`

---

### Preview not updating when adjustments change - SOLVED

**Severity**: High | **Fixed**: 2026-01-21

Fixed by implementing actual adjustment processing in `MockDecodeService.applyAdjustments()`. The preview mechanism was working correctly (watcher triggering, blob URLs being generated), but the mock service was returning unmodified pixel data. Now all 10 basic adjustments (exposure, contrast, temperature, tint, saturation, vibrance, highlights, shadows, whites, blacks) are processed with visual feedback in demo mode.

**Root Cause**: `MockDecodeService.applyAdjustments()` was simply copying the input pixels without modification, so even though the preview URL changed, the visual appearance remained the same.

**Fix Applied**: Implemented simplified adjustment algorithms in `packages/core/src/decode/mock-decode-service.ts` that provide visual feedback for all adjustment types.

---

### Histogram not updating with adjustments - SOLVED

**Severity**: High | **Fixed**: 2026-01-21

Fixed as a side effect of fixing the preview update issue. The histogram is computed from preview pixels, so once `MockDecodeService.applyAdjustments()` was implemented to actually modify pixels, the histogram now updates correctly when adjustments change.

**Root Cause**: This was a downstream effect of the preview not updating issue - the mock service wasn't modifying pixels, so the histogram computed from those pixels remained unchanged.

**Location**: `apps/web/app/composables/useHistogramDisplay.ts`

---

### Histogram component name mismatch - SOLVED

**Severity**: High | **Fixed**: 2026-01-21

Fixed by renaming `HistogramDisplay.vue` to `EditHistogramDisplay.vue` to match the naming convention of other components in the `edit` directory (EditAdjustmentSlider, EditFilmstrip, EditPreviewCanvas, EditControlsPanel).

---

### Nuxt v3 instead of v4 - SOLVED

**Fixed**: 2026-01-21

App was using Nuxt v3 instead of v4. Upgraded to Nuxt 4.

---

### Nuxt UI v3 instead of v4 - SOLVED

**Fixed**: 2026-01-21

App was using Nuxt UI v3 instead of v4. Upgraded to Nuxt UI 4.

---

### Demo mode thumbnails don't load - SOLVED

**Fixed**: 2026-01-21

Shows loading/glimmer state instead of actual images. Fixed by adding `requestThumbnail` calls in `CatalogThumbnail.vue` when component mounts. Also improved thumbnail visuals with gradient patterns.

---

### E/Enter/D keys don't navigate to edit view - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21

Pressing E, Enter, or D keys with a photo selected in the catalog grid now navigates to the edit view.

**Root Cause**: The `onViewChange` callback in `CatalogGrid.vue` only changed the view mode state but didn't actually navigate to the edit page.

**Fix Applied**: Added `navigateTo(`/edit/${currentId}`)` call in the `onViewChange` callback when mode is 'edit'.

**File Modified**: `apps/web/app/components/catalog/CatalogGrid.vue`

---

### Arrow keys captured by image navigation - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21

When a slider element has focus, arrow keys now properly adjust the slider value instead of navigating between images.

**Root Cause**: The `handleKeydown()` function in the edit page checked for input/textarea elements but not for slider elements (role="slider").

**Fix Applied**: Added a check for `target.getAttribute('role') === 'slider'` to skip navigation when focused on slider elements.

**File Modified**: `apps/web/app/pages/edit/[id].vue`

---

### Copy/Paste Settings - Paste does not apply settings - SOLVED

**Severity**: Critical | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

The Paste button and keyboard shortcut (Ctrl/Cmd+Shift+V) now correctly apply copied settings to target images.

**Original Problem**:
- Copy modal appeared correctly and settings were copied to clipboard store
- After navigating to a different image, clicking Paste did nothing
- Sliders remained at default values (0)
- No toast notification appeared

**Root Cause**: The `applySettingsToAsset()` function in `useCopyPasteSettings.ts` checked if `assetId === editStore.currentAssetId` to decide whether to apply settings. However, when navigating between images in the filmstrip, `editStore.currentAssetId` was not synchronized with `selectionStore.currentId`. The fallback return returned `true` (because `assetId === selectionStore.currentId`) WITHOUT calling `applyToEditStore()`, making the paste appear to succeed when it hadn't applied any settings.

**Fix Applied**: Changed the condition to check `selectionStore.currentId` instead of `editStore.currentAssetId`, since `selectionStore.currentId` is the authoritative source of the current asset.

**File Modified**: `apps/web/app/composables/useCopyPasteSettings.ts`

**Verification**:
- ✅ Copy settings from source image (Exposure +0.25)
- ✅ Navigate to different image in filmstrip
- ✅ Click Paste button
- ✅ Exposure slider shows +0.25 on target image
- ✅ Toast notification appears

---

### Direct edit URL only loads current thumbnail in filmstrip - SOLVED

**Severity**: Medium | **Fixed**: 2026-01-21 | **Verified**: 2026-01-21

When navigating directly to `/edit/[id]` via URL (page refresh, shared link), all filmstrip thumbnails now load correctly.

**Original Problem**:
- Direct URL navigation to `/edit/[id]` only loaded the thumbnail for the currently viewed image
- Other filmstrip thumbnails remained in loading/placeholder state indefinitely
- Thumbnails only loaded after viewing that specific image

**Root Cause**: The `EditFilmstrip.vue` component never called `requestThumbnail()` for its visible items. It only displayed thumbnails that already existed in the catalog store. When navigating via the catalog grid, `CatalogThumbnail.vue` requests thumbnails on mount, so they're already cached. But with direct URL navigation, assets load with `thumbnailStatus: 'pending'` and no component triggered thumbnail generation.

**Fix Applied**: Added a watcher in `EditFilmstrip.vue` that requests thumbnails for all visible filmstrip items with `thumbnailStatus === 'pending'`. This mirrors the pattern used by `CatalogThumbnail.vue` in the grid view.

```typescript
watch(visibleIds, (ids) => {
  for (const id of ids) {
    const asset = catalogStore.assets.get(id)
    if (asset && asset.thumbnailStatus === 'pending') {
      requestThumbnail(id, 1)  // Priority 1 (near visible)
    }
  }
}, { immediate: true })
```

**File Modified**: `apps/web/app/components/edit/EditFilmstrip.vue`

**Verification**:
- ✅ Direct URL navigation to `/edit/demo-25` loads all visible filmstrip thumbnails
- ✅ Thumbnails display actual images, not placeholder icons
- ✅ All 317 unit tests pass

**Screenshots**:
- `docs/screenshots/verify-filmstrip-fix-direct-url-01.png` - Filmstrip thumbnails loading
- `docs/screenshots/verify-filmstrip-fix-direct-url-02.png` - All thumbnails loaded
