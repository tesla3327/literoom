# Edit View Preview Fix - Research Synthesis

**Date**: 2026-01-21
**Issue**: Edit view preview not loading (Critical)

## Root Cause Summary

The edit view preview shows "Loading preview..." indefinitely due to a **missing thumbnail request** when entering the edit view.

**Key Finding**: The CatalogThumbnail component requests thumbnails when mounted, but the edit view **never requests a thumbnail** for the asset being edited. If the user navigates directly to `/edit/[id]` (or the thumbnail hasn't been generated yet), the `thumbnailUrl` will be `null`, causing the preview to never load.

## Research Findings

### 1. Navigation Flow (CatalogThumbnail.vue)
- Double-click navigates to `/edit/${props.asset.id}` without validating thumbnail state
- No state setup before navigation

### 2. Catalog Store (catalog.ts)
- Assets stored in `Map<string, Asset>` with O(1) lookup
- Asset retrieval via `catalogStore.assets.get(id)` works correctly
- Assets in demo mode have `thumbnailUrl: null` initially

### 3. Edit Store (edit.ts)
- `loadForAsset(assetId)` only sets `currentAssetId` and resets adjustments
- Does NOT verify asset exists or has thumbnail ready
- No coordination with catalog store for thumbnail requests

### 4. Preview Loading (useEditPreview.ts)
- **Critical Guard (Line 218-221)**: If `thumbnailUrl` is `null`, function returns early
- `previewUrl` is set to `null` and never updated
- `sourceUrl` watcher exists but only calls `loadSource()`, which again fails if no URL

### 5. Missing Thumbnail Request
- **CatalogThumbnail.vue** (Lines 33-41): Calls `requestThumbnail()` on mount and prop changes
- **EditPreviewCanvas.vue**: NO calls to `requestThumbnail()`
- **Edit Page ([id].vue)**: NO calls to `requestThumbnail()`

## Data Flow Showing Bug

```
User double-clicks thumbnail
    ↓
Navigate to /edit/[id]
    ↓
Edit page mounts
    ↓
useEditPreview watcher fires (immediate: true)
    ↓
Get asset?.thumbnailUrl → NULL (never requested)
    ↓
previewUrl.value = null
    ↓
loadSource() returns early (no URL)
    ↓
sourceCache stays null
    ↓
renderPreview() never called
    ↓
isInitialLoading = true (forever)
    ↓
UI shows "Loading preview..." indefinitely
```

## Fix Strategy

The simplest and most correct fix is to **request the thumbnail when entering edit view**. This mirrors the behavior in `CatalogThumbnail.vue`.

### Option 1: Request thumbnail in useEditPreview composable (Recommended)
- Add `requestThumbnail` call in the `assetId` watcher
- This ensures thumbnail is requested whenever viewing an asset for editing
- Self-contained fix within the composable

### Option 2: Request thumbnail in Edit page
- Add `requestThumbnail` call in the page's `assetId` watcher
- Requires importing and using the `useCatalog` composable

### Option 3: Request thumbnail in EditPreviewCanvas component
- Add `requestThumbnail` call on component mount
- Similar to how CatalogThumbnail works

**Recommendation**: Option 1 is the cleanest since `useEditPreview` already has all the necessary context and dependencies.

## Files to Modify

1. **`apps/web/app/composables/useEditPreview.ts`**
   - Add call to request thumbnail in the `assetId` watcher
   - Watch for `thumbnailUrl` changes to trigger preview load

2. **`apps/web/app/composables/useHistogramDisplay.ts`** (same issue)
   - Add same thumbnail request logic for consistency

## Implementation Details

In `useEditPreview.ts`, update the asset watcher (lines 358-378):

```typescript
watch(
  assetId,
  async (id) => {
    debouncedRender.cancel()
    error.value = null
    sourceCache.value = null

    // Request thumbnail if needed
    const catalogService = catalogStore.catalogService
    if (catalogService) {
      catalogService.requestThumbnail(id, 'urgent')  // High priority for edit view
    }

    // Show thumbnail immediately while loading pixels
    const asset = catalogStore.assets.get(id)
    previewUrl.value = asset?.thumbnailUrl ?? null

    // Load source pixels in background
    await loadSource(id)

    // Render with current adjustments if any
    if (sourceCache.value && editStore.isDirty) {
      renderPreview('full')
    }
  },
  { immediate: true },
)
```

Additionally, watch for thumbnail URL changes to load when it becomes available:

```typescript
// Existing watcher at lines 383-390 should handle this
watch(
  sourceUrl,
  async (url) => {
    if (url && !sourceCache.value) {
      await loadSource(assetId.value)
    }
  },
)
```

The second watcher already exists but `sourceUrl` might not be reactive to thumbnail updates. Need to verify the asset's `thumbnailUrl` update triggers this watcher.

## Alternative: Use useCatalog composable

The `useCatalog()` composable already provides `requestThumbnail`. We could use it:

```typescript
const { requestThumbnail } = useCatalog()

watch(
  assetId,
  async (id) => {
    // ... existing code ...
    requestThumbnail(id, 0)  // Priority 0 = highest
    // ... rest of code ...
  },
  { immediate: true },
)
```
