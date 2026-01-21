# Issues

## Table of Contents

### Open Issues
- [Direct URL navigation to edit view (Critical - Partial)](#direct-url-navigation-to-edit-view)
- [Clipping overlay not rendered on preview (High)](#clipping-overlay-not-rendered-on-preview)
- [E/Enter/D keys don't navigate to edit view (Medium)](#eenterd-keys-dont-navigate-to-edit-view)
- [Arrow keys captured by image navigation (Medium)](#arrow-keys-captured-by-image-navigation)

### Solved Issues
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

### Clipping overlay not rendered on preview

**Severity**: High | **Status**: Open

The J key and Shadows/Highlights buttons toggle clipping state correctly (buttons change opacity), but no visual overlay appears on the preview image to show clipped pixels.

**Expected**: When clipping is enabled, pixels that are clipped in shadows (R, G, or B = 0) should be highlighted in blue, and pixels clipped in highlights (R, G, or B = 255) should be highlighted in red on the preview image.

**Observed**: Preview image remains unchanged regardless of clipping toggle state. The UI text says "Press J to toggle clipping overlay" but no overlay is rendered.

**Root Cause**: The clipping overlay feature is incomplete:
1. `useHistogramDisplay.ts` correctly manages `showHighlightClipping` and `showShadowClipping` refs
2. `EditHistogramDisplay.vue` uses these refs only for button opacity styling
3. `useEditPreview.ts` does NOT consume the clipping states
4. No code exists to render clipped pixels as a colored overlay on the preview canvas

**Implementation Needed**:
1. Export clipping states from histogram composable or share via store
2. Modify `useEditPreview.ts` to watch clipping toggle states
3. When rendering preview, check each pixel for clipping and overlay with blue (shadows) or red (highlights)
4. Re-render preview when clipping toggles change

**Locations**:
- `apps/web/app/composables/useHistogramDisplay.ts` - Has the toggle states
- `apps/web/app/composables/useEditPreview.ts` - Needs to consume states and render overlay
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - May need overlay layer

---

### E/Enter/D keys don't navigate to edit view

**Severity**: Medium | **Status**: Open

Pressing E, Enter, or D keys with a photo selected in the catalog grid does not navigate to the edit view. Only double-click works.

**Expected**: After selecting a photo in the catalog grid, pressing E, Enter, or D should navigate to `/edit/[asset-id]` to open the edit view for that photo.

**Observed**: Pressing E, Enter, or D keys does nothing visible. The URL remains at `/` and no navigation occurs.

**What Works**:
- ✅ G key returns to grid view from edit view
- ✅ Double-click on thumbnail navigates to edit view
- ✅ Thumbnail selection works (click selects, shows checkmark)
- ✅ Arrow key navigation in grid works
- ✅ P/X/U flag shortcuts work

**Root Cause**: The `onViewChange` callback in `CatalogGrid.vue` (line 248-256) only changes the view mode state but doesn't actually navigate to the edit page:

```typescript
onViewChange: (mode) => {
  if (mode === 'edit') {
    catalogUIStore.setViewMode('loupe')
    // Future: navigate to edit page  <-- INCOMPLETE
  }
  else {
    catalogUIStore.setViewMode('grid')
  }
},
```

**Fix Required**: Add navigation to the edit page when mode is 'edit':

```typescript
onViewChange: (mode) => {
  if (mode === 'edit') {
    catalogUIStore.setViewMode('loupe')
    const currentId = selectionStore.currentId
    if (currentId) {
      navigateTo(`/edit/${currentId}`)
    }
  }
  else {
    catalogUIStore.setViewMode('grid')
  }
},
```

**Location**: `apps/web/app/components/catalog/CatalogGrid.vue:248-256`

---

### Arrow keys captured by image navigation

**Severity**: Medium | **Status**: Open

When a slider element has focus, pressing ArrowRight/ArrowLeft navigates to different images instead of adjusting the slider value.

**Expected**: When a slider has keyboard focus, arrow keys should increment/decrement the slider value.

**Observed**: Arrow keys trigger `navigateNext()`/`navigatePrev()` in the page's keyboard handler, causing image navigation instead of slider adjustment.

**Root Cause**: The `handleKeydown()` function in `apps/web/app/pages/edit/[id].vue:75-96` checks for `HTMLInputElement` and `HTMLTextAreaElement` targets, but not for elements with `role="slider"`.

**Fix**: Add a check for `e.target.role === 'slider'` or check if `e.target.matches('[role="slider"]')` and skip navigation when the target is a slider.

**Location**: `apps/web/app/pages/edit/[id].vue:75-96`

---

## Solved Issues

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
