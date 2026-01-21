# Issues

- [x] App is using Nuxt v3 and NOT v4, it should be using v4
- [x] App is using Nuxt UI v3 and NOT v4, it should be using v4
- [x] Demo mode thumbnails don't load - shows loading/glimmer state instead of actual images. Fixed by adding `requestThumbnail` calls in `CatalogThumbnail.vue` when component mounts. Also improved thumbnail visuals with gradient patterns.

## Open Issues

- [x] **Edit view preview not loading (Critical)** - Fixed by adding `requestThumbnail()` calls in `useEditPreview` and `useHistogramDisplay` composables. The root cause was that the edit view never requested thumbnail generation, so if navigating directly to edit view (or before thumbnails were ready), the `thumbnailUrl` would be `null` and the preview would never load. Now the composables request thumbnail generation with high priority (0) when the asset changes, and watch for the thumbnail URL to become available. (Fixed 2026-01-21)

- [x] **Folder selection shows "No supported images found" for valid JPEG folders (Critical)** - Fixed by simplifying `useCatalog.selectFolder()` to call `catalogService.selectFolder()` directly, which properly handles the folder picker and sets `_currentFolder` internally. Also updated `restoreSession()` to use `catalogService.loadFromDatabase()` for consistent session restoration. (Fixed 2026-01-21)

  **Root Cause**: The `useCatalog.selectFolder()` function in real mode (non-demo) was using a separate `BrowserFileSystemProvider` to get a folder handle but never passed it to the CatalogService before calling `scanFolder()`. The CatalogService's `_currentFolder` was never set, causing `scanFolder()` to immediately throw `CatalogError('No folder selected', 'FOLDER_NOT_FOUND')`.

  **Fix Applied**:
  - Simplified `useCatalog.selectFolder()` to call `catalogService.selectFolder()` directly (which shows the folder picker and sets `_currentFolder` internally)
  - Updated `restoreSession()` to use `catalogService.loadFromDatabase()` for consistent session restoration
  - Added `loadFromDatabase()` method to `ICatalogService` interface

  **Files Modified**:
  - `apps/web/app/composables/useCatalog.ts` - Simplified selectFolder and restoreSession
  - `packages/core/src/catalog/types.ts` - Added loadFromDatabase() to interface

---

## New Issues Found (2026-01-21 Verification)

- [x] **Histogram component name mismatch (High)** - Fixed by renaming `HistogramDisplay.vue` to `EditHistogramDisplay.vue` to match the naming convention of other components in the `edit` directory (EditAdjustmentSlider, EditFilmstrip, EditPreviewCanvas, EditControlsPanel). (Fixed 2026-01-21)

- [ ] **Direct URL navigation to edit view crashes (Critical)** - Navigating directly to `/edit/demo-asset-1` (without first loading the catalog) causes a 500 Server Error: "Cannot read properties of undefined (reading 'requestThumbnail')". The `$catalogService` is undefined because the catalog plugin hasn't initialized the service yet.

  **Root Cause**: When accessing the edit view directly via URL, the catalog store is empty and `useCatalog()` returns an undefined `catalogService` because the plugin's async initialization hasn't completed or the folder hasn't been selected.

  **Fix**: Add a navigation guard or loading state to ensure catalog is initialized before rendering edit view, or redirect to home page if catalog is empty.

- [x] **Preview not updating when adjustments change (High)** - Fixed by implementing actual adjustment processing in `MockDecodeService.applyAdjustments()`. The preview mechanism was working correctly (watcher triggering, blob URLs being generated), but the mock service was returning unmodified pixel data. Now all 10 basic adjustments (exposure, contrast, temperature, tint, saturation, vibrance, highlights, shadows, whites, blacks) are processed with visual feedback in demo mode. (Fixed 2026-01-21)

  **Root Cause**: `MockDecodeService.applyAdjustments()` was simply copying the input pixels without modification, so even though the preview URL changed, the visual appearance remained the same.

  **Fix Applied**: Implemented simplified adjustment algorithms in `packages/core/src/decode/mock-decode-service.ts` that provide visual feedback for all adjustment types. This doesn't match the full color science accuracy of the WASM implementation but gives users meaningful visual feedback when adjusting sliders in demo mode.

---

## Issues Found During Histogram Verification (2026-01-21)

- [x] **Histogram not updating with adjustments (High)** - Fixed as a side effect of fixing the preview update issue. The histogram is computed from preview pixels, so once `MockDecodeService.applyAdjustments()` was implemented to actually modify pixels, the histogram now updates correctly when adjustments change. (Fixed 2026-01-21)

  **Root Cause**: This was a downstream effect of the preview not updating issue - the mock service wasn't modifying pixels, so the histogram computed from those pixels remained unchanged.

  **Location**: `apps/web/app/composables/useHistogramDisplay.ts`

- [ ] **Histogram RGB channels not visible (Medium)** - The histogram appears to show only a single grayscale/luminance distribution instead of separate overlapping R, G, B channel curves with transparency.

  **Expected**: Three overlapping semi-transparent curves (red, green, blue) that combine to show the color distribution of the image.

  **Observed**: A single blue-gray filled area representing what appears to be luminance only.

  **Location**: `apps/web/app/composables/useHistogramDisplay.ts` - The `COLORS` config defines red, green, blue but they may not be rendering correctly to the canvas.