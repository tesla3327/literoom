# Gallery Loading State After Returning from Edit - Research Synthesis

**Date**: 2026-01-22
**Issue Severity**: High

## Problem Description

Two related issues when returning to the gallery from the edit view:
1. **Sometimes only loading state shows** - no thumbnails visible
2. **Thumbnails don't reflect edits** - cached thumbnails are stale

## Root Cause Analysis

### Issue 1: Loading State Instead of Thumbnails

**Current Flow:**
1. User opens gallery → catalog loads with assetIds and assets in sync
2. User navigates to `/edit/[id]`
3. User returns to gallery (via G key, Escape, or back button)
4. `initializeApp()` calls `restoreSession()`
5. `restoreSession()` checks `catalogStore.assetIds.length > 0`
6. If > 0, returns `true` immediately (skips re-scan)
7. Catalog state should be preserved, thumbnails should display

**Defensive fix already applied (Iteration 129):**
```typescript
// useCatalog.ts:83-87
if (catalogStore.assetIds.length > 0) {
  return true  // Skip restoration if assets already loaded
}
```

**Why it might still fail:**
- `assetIds` might have IDs but `assets` Map might not have corresponding data
- Race condition between navigation and state updates
- Virtual scrolling might not trigger thumbnail requests for non-visible items

**Evidence:**
- Line 316 in CatalogGrid.vue passes asset with non-null assertion: `:asset="getAsset(...)!"`
- If `getAsset()` returns `undefined`, component receives `undefined` disguised as Asset
- CatalogThumbnail then tries to access `undefined.thumbnailStatus` → undefined behavior

### Issue 2: Thumbnails Don't Reflect Edits

**Root Cause: No thumbnail invalidation mechanism exists**

**Caching Architecture (3 layers, no invalidation):**
1. Memory LRU cache (ThumbnailCache.memoryCache)
2. OPFS persistent cache (ThumbnailCache.opfsCache)
3. Edit state cache (editStore.editCache)

**What's missing:**
- No code invalidates thumbnail cache when edits are saved
- No code re-generates thumbnails after edits
- No coordination between edit store and thumbnail service

**Current Edit Flow:**
```
User edits image → editStore.isDirty = true ✓
User saves/navigates → editStore.saveToCache() ✓
Thumbnail cache → UNCHANGED (stale)
Export → Applies edits from cache ✓
Gallery view → Shows original thumbnail ✗
```

## Solutions

### Solution A: Fix Gallery Loading State (Quick Fix)

Add safety check in CatalogGrid to skip rendering items with missing assets:

```typescript
// CatalogGrid.vue - columnsInRow function
function columnsInRow(rowIndex: number): number {
  const startIndex = rowIndex * columnsCount.value
  const remaining = sortedAssetIds.value.length - startIndex
  return Math.min(columnsCount.value, remaining)
}

// Also filter out undefined assets in the template
v-for="colIndex in columnsInRow(virtualRow.index)"
v-if="getAsset(virtualRow.index, colIndex - 1)"
```

### Solution B: Thumbnail Regeneration After Edits (Full Fix)

**Scope**: Significant implementation effort

**Steps needed:**
1. Add `invalidateThumbnail(assetId)` method to ThumbnailCache
2. Add `regenerateThumbnail(assetId)` method to ThumbnailService
3. Hook edit store's save/navigation to trigger thumbnail invalidation
4. Queue thumbnail regeneration with edit settings applied

**Files to modify:**
- `thumbnail-cache.ts` - Add invalidation methods
- `thumbnail-service.ts` - Add regeneration with edits
- `edit.ts` - Hook to trigger invalidation on dirty state
- `useCatalog.ts` - Add `invalidateThumbnail` export

**Complexity**: High - requires significant changes to thumbnail pipeline

## Recommended Approach

**For this iteration**: Fix Issue 1 (loading state) with defensive checks

**Future iteration**: Implement thumbnail regeneration (Issue 2)

## Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| `pages/index.vue` | 98-110, 137-146 | Gallery initialization |
| `pages/edit/[id].vue` | 79-81, 174-184 | Edit navigation, unmount |
| `components/catalog/CatalogGrid.vue` | 94-105, 316 | Asset lookup, template |
| `components/catalog/CatalogThumbnail.vue` | 39-53, 130 | Thumbnail loading |
| `stores/catalog.ts` | 224-226 | getAsset returns undefined |
| `composables/useCatalog.ts` | 80-113 | restoreSession |
| `stores/edit.ts` | 238-245, 196-203 | Dirty state, save |
| `thumbnail-cache.ts` | 539-555 | Cache read path |
| `thumbnail-service.ts` | 150-194 | Thumbnail generation |
