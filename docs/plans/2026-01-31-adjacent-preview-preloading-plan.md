# Adjacent Preview Preloading - Implementation Plan

**Date**: 2026-01-31
**Task**: Implement background preloading of adjacent photos when the edit pipeline is idle

## Overview

When viewing a photo in edit view, proactively preload previews for adjacent photos (N±1, N±2) using background priority so navigation between photos feels instant.

## Implementation Steps

### Phase 1: Add Preload Functionality to useCatalog

**File**: `apps/web/app/composables/useCatalog.ts`

1. Add `preloadAdjacentPreviews(currentAssetId, count)` function:
   - Get current photo's index in filtered list
   - Request previews for N-count to N+count at BACKGROUND priority
   - Skip if preview already exists in cache

2. Add `cancelBackgroundPreloads()` function:
   - Cancel any pending BACKGROUND priority requests
   - Called when user starts interacting

### Phase 2: Integrate with useEditPreview Render State

**File**: `apps/web/app/composables/useEditPreview.ts`

1. Watch render state transitions
2. When state becomes 'idle' after 'complete':
   - Call `preloadAdjacentPreviews(currentAssetId, 2)` to preload N±1 and N±2
3. When state becomes 'interacting':
   - Call `cancelBackgroundPreloads()` to stop background work

### Phase 3: Add Cancellation Support to ThumbnailService

**File**: `packages/core/src/catalog/thumbnail-service.ts`

1. Add `cancelBackgroundRequests()` method:
   - Remove all BACKGROUND priority items from preview queue
   - Stop processing any in-flight BACKGROUND items
2. Export through CatalogService and useCatalog

### Phase 4: Tests

**Files**:
- `apps/web/test/adjacentPreloading.test.ts` (new)
- `packages/core/src/catalog/thumbnail-service.test.ts` (extend)

1. Test preload triggers on idle state
2. Test preload cancellation on interaction
3. Test boundary conditions (first/last photo)
4. Test with filtered lists (picks only, etc.)

## Detailed Implementation

### useCatalog.ts Changes

```typescript
/**
 * Preload previews for photos adjacent to the current one.
 * Uses BACKGROUND priority to avoid interrupting active work.
 */
function preloadAdjacentPreviews(currentAssetId: string, range: number = 2): void {
  const store = useCatalogStore()
  const uiStore = useCatalogUIStore()

  // Get filtered and sorted list (respects current filter/sort)
  const sortedIds = store.sortedAssetIds
  const filteredIds = sortedIds.filter((id) => {
    const asset = store.assets.get(id)
    if (!asset) return false

    const filterMode = uiStore.filterMode
    if (filterMode === 'all') return true
    if (filterMode === 'picks') return asset.flag === 'pick'
    if (filterMode === 'rejects') return asset.flag === 'reject'
    if (filterMode === 'unflagged') return asset.flag === 'none'
    return true
  })

  const currentIdx = filteredIds.indexOf(currentAssetId)
  if (currentIdx === -1) return

  // Preload N±1 to N±range
  for (let offset = 1; offset <= range; offset++) {
    // Previous photo
    const prevIdx = currentIdx - offset
    if (prevIdx >= 0) {
      const prevId = filteredIds[prevIdx]
      const prevAsset = store.assets.get(prevId)
      if (prevAsset && prevAsset.preview1xStatus !== 'ready') {
        service.requestPreview(prevId, ThumbnailPriority.BACKGROUND)
      }
    }

    // Next photo
    const nextIdx = currentIdx + offset
    if (nextIdx < filteredIds.length) {
      const nextId = filteredIds[nextIdx]
      const nextAsset = store.assets.get(nextId)
      if (nextAsset && nextAsset.preview1xStatus !== 'ready') {
        service.requestPreview(nextId, ThumbnailPriority.BACKGROUND)
      }
    }
  }
}

/**
 * Cancel any background preview preloading.
 * Called when user starts interacting to prioritize current work.
 */
function cancelBackgroundPreloads(): void {
  service.cancelBackgroundRequests()
}
```

### useEditPreview.ts Changes

```typescript
// At the end of the composable, add preloading logic
const catalog = useCatalog()

// Watch for idle state to trigger preloading
watch(renderState, (newState, oldState) => {
  // When transitioning from complete to idle, preload adjacent photos
  if (oldState === 'complete' && newState === 'idle') {
    if (assetId.value && catalog) {
      catalog.preloadAdjacentPreviews(assetId.value, 2)
    }
  }

  // When starting to interact, cancel background preloads
  if (newState === 'interacting') {
    if (catalog) {
      catalog.cancelBackgroundPreloads()
    }
  }
})
```

### ThumbnailService Changes

```typescript
/**
 * Cancel all background priority requests.
 * Used when user starts interacting to prioritize current work.
 */
cancelBackgroundRequests(): void {
  // Cancel from preview queue
  const previewItems = this.previewProcessor.getAllItems()
  for (const item of previewItems) {
    if (item.priority === ThumbnailPriority.BACKGROUND) {
      this.previewProcessor.cancel(item.assetId)
    }
  }

  // Also cancel from thumbnail queue if any background items
  const thumbItems = this.thumbnailProcessor.getAllItems()
  for (const item of thumbItems) {
    if (item.priority === ThumbnailPriority.BACKGROUND) {
      this.thumbnailProcessor.cancel(item.assetId)
    }
  }
}
```

## Test Cases

1. **Basic preloading**
   - Navigate to photo 5/10
   - Wait for idle state
   - Verify photos 3, 4, 6, 7 have preview requests queued

2. **Cancellation on interaction**
   - Navigate to photo, wait for idle
   - Start dragging a slider
   - Verify background requests are cancelled

3. **Boundary conditions**
   - Navigate to first photo, only N+1, N+2 preloaded
   - Navigate to last photo, only N-1, N-2 preloaded

4. **Filtered list**
   - Set filter to "Picks"
   - Navigate to a pick, verify only adjacent picks preloaded

5. **Already cached**
   - Navigate to photo with cached adjacent previews
   - Verify no duplicate requests made

## Files to Modify

| File | Changes |
|------|---------|
| `apps/web/app/composables/useCatalog.ts` | Add preloadAdjacentPreviews, cancelBackgroundPreloads |
| `apps/web/app/composables/useEditPreview.ts` | Add render state watcher for preloading |
| `packages/core/src/catalog/thumbnail-service.ts` | Add cancelBackgroundRequests |
| `packages/core/src/catalog/types.ts` | Add ICatalogService.cancelBackgroundRequests |
| `packages/core/src/catalog/mock-catalog-service.ts` | Add mock implementation |
| `apps/web/test/adjacentPreloading.test.ts` | New test file |

## Success Criteria

1. Adjacent photos (N±2) preload automatically when idle
2. Preloading stops immediately when user interacts
3. Navigation to adjacent photo shows preview faster (or instantly)
4. No impact on current edit performance
5. All tests pass
