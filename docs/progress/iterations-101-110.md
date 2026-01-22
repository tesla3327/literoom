# Iterations 101-110

## 101: 2026-01-21 19:13 EST: Export Workflow - Phase 5 (UI Components)

**Objective**: Implement the Pinia store, composable, and modal UI for the export feature.

**Background**: Phases 1-4 of the export workflow are complete:
- Phase 1: JPEG encoding in Rust/WASM
- Phase 2: Worker integration for encodeJpeg
- Phase 3: Filename template parser
- Phase 4: ExportService coordination

This phase creates the Vue/Nuxt components for the export UI.

**Implementation**:
1. Created `apps/web/app/stores/export.ts` - Pinia store for export state
   - Modal visibility, destination folder, filename template
   - JPEG quality, resize options, export scope
   - Export progress tracking
   - Resize presets (Original, 2048px, 3840px, 5120px)

2. Created `apps/web/app/composables/useExport.ts` - Export logic composable
   - Asset filtering based on scope (picks/selected/all)
   - Native folder picker integration with type-safe API
   - Image bytes loading from folder handle
   - Edit state retrieval (currently from edit store only)
   - Adapter functions to bridge DecodedImage to export dependencies
   - Resize workaround via encode-then-preview pipeline

3. Created `apps/web/app/components/export/ExportModal.vue` - Export dialog UI
   - Destination folder selection
   - Filename template input with validation
   - Scope toggle buttons (Picks/Selected/All)
   - JPEG quality slider (50-100)
   - Resize preset selection
   - Progress bar during export
   - Toast notifications for results

4. Updated `apps/web/app/components/catalog/FilterBar.vue`
   - Added Export button with picks count badge
   - Opens export modal on click

5. Updated `apps/web/app/pages/index.vue`
   - Added ExportModal component

6. Added `./export` entry to `packages/core/package.json` exports

**Tests**: All unit tests pass (317 total).

**Status**: Complete. Export workflow Phase 5 (UI Components) is done.

**Notes**:
- Edit state export only works for currently loaded asset (edit persistence not yet implemented)
- Resize uses encode-then-decode workaround (no direct pixel resize API)
- Demo mode export will fail since mock service doesn't write files

---

## 102: 2026-01-21 19:26 EST: Filmstrip Thumbnail Loading Issue - Fixed

**Objective**: Fix the issue where direct URL navigation to `/edit/[id]` only loads the current thumbnail in the filmstrip, leaving other thumbnails in loading state.

**Background**: This is an open medium-severity issue discovered on 2026-01-21. When users navigate directly to an edit URL (page refresh, shared link, or typing URL), only the currently viewed image's thumbnail loads in the filmstrip. Other thumbnails remain in loading state indefinitely.

**Research Findings**:
The root cause was that `EditFilmstrip.vue` never called `requestThumbnail()` for its visible items. It only displayed thumbnails that already existed in the catalog store.

When navigating via the catalog grid:
- `CatalogThumbnail.vue` requests thumbnails on mount
- Thumbnails are already cached when entering edit view
- Filmstrip displays cached thumbnails correctly

When navigating directly via URL:
- Assets load with `thumbnailStatus: 'pending'`
- No component triggered thumbnail generation for filmstrip items
- Thumbnails stuck in pending state indefinitely

**Fix Applied**: Added a watcher in `EditFilmstrip.vue` that requests thumbnails for all visible filmstrip items when their status is `'pending'`:

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

**Files Modified** (1 file):
- `apps/web/app/components/edit/EditFilmstrip.vue`

**Tests**: All 317 unit tests pass.

**Verification**:
- ✅ Direct URL navigation to `/edit/demo-25` loads all visible filmstrip thumbnails
- ✅ Thumbnails display actual images, not placeholder icons

**Status**: Complete. Issue marked as solved in `docs/issues.md`.

---

