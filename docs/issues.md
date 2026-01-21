# Issues

## Table of Contents

### Open Issues
- [Direct URL navigation to edit view (Critical - Partial)](#direct-url-navigation-to-edit-view)
- [Crop/transform controls not overlayed on preview (Medium)](#croptransform-controls-not-overlayed-on-preview)

### Solved Issues
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

### Direct URL navigation to edit view

**Severity**: Critical | **Status**: Partially Fixed (2026-01-21)

The 500 server error is resolved, but the page doesn't load data correctly when navigating directly to `/edit/[id]`.

**Original Root Cause**: When accessing the edit view directly via URL, the catalog store is empty and `useCatalog()` returns an undefined `catalogService` because the plugin's async initialization hasn't completed or the folder hasn't been selected.

**Original Fix Applied**:
- Added `$catalogReady` promise to catalog plugin
- Created `ensure-catalog` middleware to wait for service initialization
- Made `useHistogramDisplay` and `useEditPreview` composables SSR-safe
- Added defensive null-checking to `useCatalog` composable
- Disabled SSR for edit page (`ssr: false`) since it requires client-only services

**Current Status**:
- ✅ 500 server error is fixed - page renders without crash
- ❌ Edit page shows empty state when navigating directly:
  - Header shows "0 / 0" instead of asset position
  - Preview shows "Loading preview..." indefinitely
  - Histogram shows "Loading..." indefinitely
  - No filename, format, or size displayed
  - No filmstrip at bottom
- ✅ Navigation via double-click from catalog works perfectly

**Remaining Root Cause**: The edit page renders before the catalog data is populated. In demo mode, the catalog auto-loads on the home page but not when navigating directly to `/edit/[id]`.

**Recommended Fix**:
1. Edit page should await `$catalogReady` AND verify assets are populated
2. In demo mode, trigger catalog initialization if assets are empty
3. Show a loading state while waiting for catalog data
4. Consider redirecting to home with return URL if catalog cannot be initialized

**Files Modified** (original fix):
- `apps/web/app/plugins/catalog.client.ts`
- `apps/web/app/middleware/ensure-catalog.ts` (NEW)
- `apps/web/app/pages/edit/[id].vue`
- `apps/web/app/composables/useCatalog.ts`
- `apps/web/app/composables/useHistogramDisplay.ts`
- `apps/web/app/composables/useEditPreview.ts`

---

### Crop/transform controls not overlayed on preview

**Severity**: Medium | **Status**: Open | **Discovered**: 2026-01-21

The crop region and rotation controls are only visible in a small thumbnail in the right panel. Users cannot see crop guides or interact with the crop region directly on the main preview canvas.

**Expected**: When using crop/transform tools, the main preview canvas should display:
- Crop region overlay with draggable corner handles
- Rule-of-thirds grid lines within the crop region
- Semi-transparent darkening outside the crop area
- Interactive dragging to resize and move the crop region
- Visual feedback for rotation angle (rotation guides)

**Observed**:
- Crop region is only shown in a small thumbnail in the Crop & Transform panel
- No crop overlay appears on the main preview canvas
- The instructions say "Drag corners to resize | Drag inside to move" but this only works on the small panel thumbnail
- Users cannot precisely position crops on the full-size preview

**Impact**: This makes it difficult to make precise crop decisions, especially for large images where the panel thumbnail is too small to see details. Professional photo editing applications (Lightroom, Capture One, etc.) always overlay crop controls directly on the main preview.

**Implementation Needed**:
1. Add a crop overlay component to `EditPreviewCanvas.vue`
2. Render the crop region as a resizable overlay on the main canvas
3. Add corner handles that can be dragged to resize
4. Add center drag to reposition the crop region
5. Show rule-of-thirds grid when crop is active
6. Darken the area outside the crop region
7. Connect mouse events to update the crop state in the edit store

**Files Involved**:
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Needs crop overlay
- `apps/web/app/components/edit/EditCropEditor.vue` - Current panel-only implementation
- `apps/web/app/stores/edit.ts` - Crop state management

**Screenshots**:
- `docs/screenshots/verify-transform-07-crop.png` - Shows crop only in panel thumbnail

---

## Solved Issues

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
