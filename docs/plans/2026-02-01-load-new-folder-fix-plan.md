# Implementation Plan: Fix "Load new folder doesn't work"

**Date**: 2026-02-01
**Priority**: Critical
**Estimated Scope**: ~8 files, ~150 lines changed

## Overview

Fix the critical bug where loading a new folder doesn't work properly due to incomplete state cleanup from the previous folder.

## Implementation Steps

### Step 1: Add `clear()` method to editUIStore

**File**: `apps/web/app/stores/editUI.ts`

Add a `clear()` method that resets all UI state to defaults:
- Reset zoom/camera state
- Clear pending crop
- Deactivate crop tool
- Clear mask drawing mode
- Clear zoom cache per asset
- Reset clipping toggles

### Step 2: Add state cleanup to useCatalog.selectFolder()

**File**: `apps/web/app/composables/useCatalog.ts`

Before calling `service.selectFolder()`, add:
```typescript
catalogStore.clear()
selectionStore.clear()
editStore.clear()          // ADD
editUIStore.clear()        // ADD
```

### Step 3: Add state cleanup to useRecentFolders.openRecentFolder()

**File**: `apps/web/app/composables/useRecentFolders.ts`

Before calling `service.loadFolderById()`, add:
```typescript
catalogStore.clear()
selectionStore.clear()
editStore.clear()          // ADD
editUIStore.clear()        // ADD
```

### Step 4: Create `resetForFolderChange()` in CatalogService

**File**: `packages/core/src/catalog/catalog-service.ts`

Create a new method that handles all state cleanup:
```typescript
private async resetForFolderChange(): Promise<void> {
  // Cancel any in-progress scan
  this.cancelScan()

  // Cancel all pending photo processing
  this.photoProcessor.cancelAll()

  // Cancel all pending thumbnail/preview requests
  this.thumbnailService.cancelAll()
  this.thumbnailService.cancelAllPreviews()

  // Clear in-memory assets
  this._assets.clear()

  // Clear thumbnail/preview memory caches
  this.thumbnailService.clearMemoryCache()
}
```

### Step 5: Add `clearMemoryCache()` to ThumbnailService

**File**: `packages/core/src/catalog/thumbnail-service.ts`

Add method to clear memory caches (but not OPFS - that persists across sessions):
```typescript
clearMemoryCache(): void {
  this.cache.clearMemory()
  this.previewCache.clearMemory()
}
```

### Step 6: Call `resetForFolderChange()` in folder operations

**File**: `packages/core/src/catalog/catalog-service.ts`

Add call at the start of:
- `selectFolder()` - before showing picker
- `loadFolderById()` - before loading from database
- `setCurrentFolder()` - when folder handle changes

### Step 7: Fix `loadFromDatabase()` to clear assets

**File**: `packages/core/src/catalog/catalog-service.ts`

Add `this._assets.clear()` before loading assets from database.

### Step 8: Add tests

**Files**:
- `packages/core/src/catalog/catalog-service.test.ts`
- `apps/web/test/useCatalog.test.ts`
- `apps/web/test/useRecentFolders.test.ts`

Add tests for:
- State is properly cleared when switching folders
- PhotoProcessor requests are cancelled
- Thumbnail/preview caches are cleared
- Edit state doesn't persist across folder changes

## Verification

1. Start app, select a folder with photos
2. Make edits to a photo (adjust exposure, etc.)
3. Click dropdown, select "Choose New Folder..."
4. Select a different folder
5. Verify:
   - New folder's photos appear
   - No old folder data visible
   - Edit state is cleared
   - No console errors
   - Memory doesn't leak

## Risk Assessment

- **Low risk**: Changes are additive state cleanup
- **Regression risk**: Minimal - only affects folder switching
- **Rollback**: Easy - can revert individual commits

## Files Changed Summary

1. `apps/web/app/stores/editUI.ts` - Add clear() method
2. `apps/web/app/composables/useCatalog.ts` - Add editStore/editUIStore clear
3. `apps/web/app/composables/useRecentFolders.ts` - Add editStore/editUIStore clear
4. `packages/core/src/catalog/catalog-service.ts` - Add resetForFolderChange(), fix loadFromDatabase()
5. `packages/core/src/catalog/thumbnail-service.ts` - Add clearMemoryCache()
6. Test files (3-4 files)
