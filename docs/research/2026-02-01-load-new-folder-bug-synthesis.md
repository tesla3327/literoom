# Research Synthesis: "Load new folder doesn't work" Bug

**Date**: 2026-02-01
**Status**: Complete
**Related Issue**: docs/issues.md - "Load new folder doesn't work" (Critical)

## Executive Summary

The "Load new folder doesn't work" bug is caused by **incomplete state cleanup** when switching folders. Multiple stores, caches, and background processes from the previous folder are NOT properly cleared or cancelled when loading a new folder.

## Root Causes Identified

### 1. Edit Store NOT Cleared on Folder Change (CRITICAL)

**Location**:
- `apps/web/app/composables/useCatalog.ts` lines 130-135
- `apps/web/app/composables/useRecentFolders.ts` lines 94-95

**Problem**: When `selectFolder()` or `openRecentFolder()` is called, the code clears `catalogStore` and `selectionStore`, but does NOT clear `editStore`.

```typescript
// Current code (useCatalog.ts line 134-135)
catalogStore.clear()
selectionStore.clear()
// MISSING: editStore.clear()
```

**Impact**: Edit cache from previous folder persists, potentially causing:
- Cross-folder edit state contamination
- Memory leak as edit cache grows indefinitely
- Confusion when same asset IDs exist in different folders

### 2. PhotoProcessor Requests NOT Cancelled (CRITICAL)

**Location**: `packages/core/src/catalog/catalog-service.ts`

**Problem**: When switching folders via `selectFolder()` or `loadFolderById()`, in-flight PhotoProcessor requests are NOT cancelled. The `photoProcessor.cancelAll()` method exists but is only called in `destroy()`, not during folder changes.

**Impact**:
- Callbacks from old folder processing continue to fire
- Old blob URLs get created for assets no longer in the catalog
- UI updates with stale data from wrong folder

### 3. Missing `_assets.clear()` in `loadFromDatabase()` (HIGH)

**Location**: `packages/core/src/catalog/catalog-service.ts` lines 872-912

**Problem**: The `loadFromDatabase()` method does NOT clear `this._assets` before loading from database, unlike `loadFolderById()` which properly clears assets at line 985.

**Impact**: Assets accumulate from multiple folders if `loadFromDatabase()` is called multiple times.

### 4. Thumbnail/Preview Caches NOT Cleared (HIGH)

**Location**: `packages/core/src/catalog/catalog-service.ts`

**Problem**: When switching folders, neither `thumbnailService.clearCache()` nor memory caches are cleared. Only blob URLs in the store are revoked.

**Impact**:
- Memory continues to hold cached data from old folder
- Potential for serving stale cached content if asset IDs collide

### 5. EditUI Store NOT Reset (HIGH)

**Location**: `apps/web/app/stores/editUI.ts`

**Problem**: No call to `editUIStore.resetToDefaults()` or equivalent when changing folders.

**Impact**:
- Crop tool state persists (active crop tool from previous session)
- Mask drawing mode persists
- Zoom presets/settings persist inappropriately

### 6. CatalogUI Filter State Persists (MEDIUM)

**Location**: `apps/web/app/stores/catalogUI.ts`

**Problem**: Filter/sort state is persisted to sessionStorage and NOT reset on folder change.

**Impact**:
- User filters "picks" in Folder A, switches to Folder B with no picks → shows empty grid
- Sort settings may be inappropriate for new folder

## Affected Components

| Component | What's Missing | Severity |
|-----------|----------------|----------|
| useCatalog.selectFolder() | editStore.clear() | CRITICAL |
| useRecentFolders.openRecentFolder() | editStore.clear() | CRITICAL |
| CatalogService.selectFolder() | Cancel PhotoProcessor, clear caches | CRITICAL |
| CatalogService.loadFolderById() | Cancel PhotoProcessor, clear caches | CRITICAL |
| CatalogService.loadFromDatabase() | _assets.clear() | HIGH |
| CatalogService (general) | No method to reset all state | HIGH |
| editUIStore | Not reset on folder change | HIGH |
| catalogUIStore | Not reset on folder change | MEDIUM |

## Recommended Fix Strategy

### Phase 1: Add State Cleanup to Composables

1. Add `editStore.clear()` to `selectFolder()` and `openRecentFolder()`
2. Add `editUIStore.resetToDefaults()` or create one if missing
3. Consider adding `catalogUIStore.resetToDefaults()` (optional)

### Phase 2: Fix CatalogService State Management

1. Add `_assets.clear()` to `loadFromDatabase()`
2. Create a `resetForFolderChange()` method that:
   - Cancels scan if in progress
   - Cancels PhotoProcessor requests
   - Cancels thumbnail/preview requests
   - Clears memory caches
3. Call this method in `selectFolder()`, `loadFolderById()`, and `setCurrentFolder()`

### Phase 3: Add Stale Request Detection

1. Implement folder change ID/generation tracking
2. Reject callbacks from old folder requests
3. Add proper cleanup in PhotoProcessor.cancelAll()

## Files to Modify

1. `apps/web/app/composables/useCatalog.ts`
2. `apps/web/app/composables/useRecentFolders.ts`
3. `packages/core/src/catalog/catalog-service.ts`
4. `apps/web/app/stores/editUI.ts` (add resetToDefaults if missing)

## Testing Plan

1. Test selecting new folder from welcome screen
2. Test selecting new folder from dropdown
3. Test opening recent folder
4. Test switching between multiple folders rapidly
5. Verify no old folder data appears in new folder
6. Verify edit cache is properly cleared
7. Verify thumbnail/preview caches work correctly

## Related Issues

This fix will also address:
- "Rescanning a folder fails" (likely same root cause)
- Memory leaks from folder switching
- Stale data appearing after folder change
