# Implementation Plan: Fix Rescanning a Folder

**Date:** 2026-02-01
**Based on:** `/docs/research/2026-02-01-rescan-folder-bug-synthesis.md`
**Issue:** "Rescanning a folder fails" - Files deleted from disk remain in UI

---

## Executive Summary

The rescan functionality doesn't detect removed files. When users delete files from disk and rescan, the deleted files remain visible in the UI as "ghost" assets that fail when clicked.

**Root Cause:** `rescanFolder()` simply calls `scanFolder()` which only handles add/modify cases, not deletions.

**Solution:** Track scanned paths during scan, compare with database after scan completes, remove orphaned records.

---

## Phase 1: Add Removed File Detection to CatalogService

### Step 1.1: Track Scanned Paths During Scan

**File:** `/packages/core/src/catalog/catalog-service.ts`

Modify `scanFolder()` to collect all scanned file paths:

```typescript
async scanFolder(options: ScanOptions = {}): Promise<void> {
  // ... existing validation ...

  // Track all paths found in this scan
  const scannedPaths = new Set<string>()

  try {
    for await (const scannedFile of this.scanService.scan(...)) {
      // Add to tracking set
      scannedPaths.add(scannedFile.path)

      // ... existing duplicate detection and asset creation ...
    }

    // NEW: After scan completes, detect removed files
    await this.detectRemovedFiles(scannedPaths)

    // ... existing folder update ...
  }
}
```

### Step 1.2: Implement detectRemovedFiles() Method

**File:** `/packages/core/src/catalog/catalog-service.ts`

Add new private method:

```typescript
/**
 * Detect and remove assets that no longer exist on disk.
 * Called after scan completes to identify orphaned database records.
 */
private async detectRemovedFiles(scannedPaths: Set<string>): Promise<void> {
  if (!this._currentFolderId) return

  // Get all asset paths currently in database for this folder
  const dbAssets = await db.assets
    .where('folderId')
    .equals(this._currentFolderId)
    .toArray()

  // Find assets in DB that weren't found in scan
  const removedAssets: Asset[] = []

  for (const record of dbAssets) {
    if (!scannedPaths.has(record.path)) {
      const asset = this._assets.get(record.uuid)
      if (asset) {
        removedAssets.push(asset)
      }
    }
  }

  if (removedAssets.length === 0) return

  // Remove from database
  const uuidsToRemove = removedAssets.map(a => a.id)
  await removeAssets(uuidsToRemove)

  // Remove from in-memory map
  for (const asset of removedAssets) {
    this._assets.delete(asset.id)
  }

  // Notify listeners
  this._onAssetsRemoved?.(removedAssets)

  console.log(`[CatalogService] Removed ${removedAssets.length} orphaned asset(s)`)
}
```

### Step 1.3: Add onAssetsRemoved Callback

**File:** `/packages/core/src/catalog/types.ts`

Add new callback type:

```typescript
/**
 * Callback fired when assets are removed from the catalog.
 */
export type AssetsRemovedCallback = (assets: Asset[]) => void
```

Update `ICatalogService` interface:

```typescript
export interface ICatalogService {
  // ... existing methods ...

  /**
   * Set callback for when assets are removed.
   */
  onAssetsRemoved(callback: AssetsRemovedCallback): void
}
```

**File:** `/packages/core/src/catalog/catalog-service.ts`

Add private field and setter:

```typescript
private _onAssetsRemoved: AssetsRemovedCallback | null = null

onAssetsRemoved(callback: AssetsRemovedCallback): void {
  this._onAssetsRemoved = callback
}
```

---

## Phase 2: Update Catalog Store to Handle Removals

### Step 2.1: Add removeAssetBatch Action

**File:** `/apps/web/app/stores/catalog.ts`

Add action to remove multiple assets:

```typescript
/**
 * Remove a batch of assets from the store.
 * Revokes blob URLs and removes from all collections.
 */
function removeAssetBatch(assetIds: string[]): void {
  if (assetIds.length === 0) return

  // Revoke blob URLs
  for (const id of assetIds) {
    const asset = assets.value.get(id)
    if (asset?.thumbnailUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(asset.thumbnailUrl)
    }
    if (asset?.preview1xUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(asset.preview1xUrl)
    }
  }

  // Remove from map (create new Map for reactivity)
  const newAssets = new Map(assets.value)
  for (const id of assetIds) {
    newAssets.delete(id)
  }
  assets.value = newAssets

  // Remove from ordered list (create new array for reactivity)
  const idSet = new Set(assetIds)
  assetIds.value = assetIds.value.filter(id => !idSet.has(id))
}
```

Export the action:

```typescript
return {
  // ... existing exports ...
  removeAssetBatch,
}
```

### Step 2.2: Wire onAssetsRemoved Callback

**File:** `/apps/web/app/plugins/catalog.client.ts`

Add callback wiring:

```typescript
// Wire up asset removed callback
catalogService.onAssetsRemoved((removedAssets) => {
  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()

  const removedIds = removedAssets.map(a => a.id)

  // Remove from catalog store
  catalogStore.removeAssetBatch(removedIds)

  // Clear from selection if selected
  selectionStore.deselectBatch(removedIds)
})
```

### Step 2.3: Add deselectBatch to Selection Store

**File:** `/apps/web/app/stores/selection.ts`

Add method to deselect multiple assets:

```typescript
/**
 * Deselect multiple assets at once.
 */
function deselectBatch(ids: string[]): void {
  if (ids.length === 0) return

  const idSet = new Set(ids)

  // Remove from selected set
  const newSelected = new Set(selectedIds.value)
  for (const id of ids) {
    newSelected.delete(id)
  }
  selectedIds.value = newSelected

  // Clear current if it was deselected
  if (currentId.value && idSet.has(currentId.value)) {
    currentId.value = null
  }
}
```

---

## Phase 3: Fix Silent File Read Failures

### Step 3.1: Add Logging to ScanService

**File:** `/packages/core/src/catalog/scan-service.ts` (Lines 88-93)

Change from:

```typescript
let file: File
try {
  file = await fileHandle.getFile()
} catch (error) {
  continue  // Silent skip
}
```

To:

```typescript
let file: File
try {
  file = await fileHandle.getFile()
} catch (error) {
  console.warn(
    `[ScanService] Failed to read file: ${entryPath}`,
    error instanceof Error ? error.message : String(error)
  )
  continue
}
```

---

## Phase 4: Update MockCatalogService

### Step 4.1: Add onAssetsRemoved to Mock

**File:** `/packages/core/src/catalog/mock-catalog-service.ts`

Add the callback field and setter:

```typescript
private _onAssetsRemoved: AssetsRemovedCallback | null = null

onAssetsRemoved(callback: AssetsRemovedCallback): void {
  this._onAssetsRemoved = callback
}
```

---

## Phase 5: Update useCatalog Composable

### Step 5.1: Fix Count Diff Calculation

**File:** `/apps/web/app/composables/useCatalog.ts`

The current implementation calculates diff incorrectly because it doesn't account for removed files.

Update `rescanFolder()`:

```typescript
async function rescanFolder(): Promise<void> {
  const service = requireCatalogService()
  const toast = useToast()

  if (!catalogStore.folderPath) {
    toast.add({
      title: 'No folder selected',
      description: 'Select a folder first to rescan',
      color: 'warning',
    })
    return
  }

  catalogStore.setScanning(true)

  // Track counts before rescan
  const previousCount = catalogStore.totalCount
  const previousIds = new Set(catalogStore.assetIds)

  try {
    await service.rescanFolder()

    const currentIds = new Set(catalogStore.assetIds)
    const newCount = catalogStore.totalCount

    // Calculate actual changes
    const added = [...currentIds].filter(id => !previousIds.has(id)).length
    const removed = [...previousIds].filter(id => !currentIds.has(id)).length

    if (added > 0 || removed > 0) {
      const parts: string[] = []
      if (added > 0) parts.push(`${added} added`)
      if (removed > 0) parts.push(`${removed} removed`)

      toast.add({
        title: 'Catalog updated',
        description: parts.join(', '),
        color: 'success',
      })
    } else {
      toast.add({
        title: 'Catalog up to date',
        description: `${newCount} image${newCount === 1 ? '' : 's'} in catalog`,
        color: 'success',
      })
    }
  } catch (error) {
    toast.add({
      title: 'Rescan failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      color: 'error',
    })
  } finally {
    catalogStore.setScanning(false)
  }
}
```

---

## Testing Plan

### Unit Tests

**File:** `/packages/core/src/catalog/catalog-service.test.ts`

```typescript
describe('rescanFolder - removed file detection', () => {
  it('should detect and remove files deleted from disk', async () => {
    // Setup: Create service, add mock files, scan folder
    // Action: Remove one file from mock FS, rescan
    // Assert: Removed file no longer in _assets, callback fired
  })

  it('should fire onAssetsRemoved callback with correct assets', async () => {
    // Setup: Create service with callback, add files
    // Action: Remove file, rescan
    // Assert: Callback received correct asset
  })

  it('should not remove assets that still exist', async () => {
    // Setup: Create service with 3 files
    // Action: Rescan without changes
    // Assert: All 3 assets still present
  })

  it('should handle rename as remove + add', async () => {
    // Setup: Create service with file.jpg
    // Action: Rename to file2.jpg, rescan
    // Assert: file.jpg removed, file2.jpg added
  })
})
```

**File:** `/apps/web/test/catalogStore.test.ts`

```typescript
describe('removeAssetBatch', () => {
  it('should remove assets from map', async () => {
    // ...
  })

  it('should revoke blob URLs', async () => {
    // ...
  })

  it('should remove from assetIds array', async () => {
    // ...
  })
})
```

### Manual Testing Checklist

- [ ] Rescan folder with no changes → "Catalog up to date" toast
- [ ] Add new file to folder, rescan → "1 added" toast
- [ ] Delete file from folder, rescan → "1 removed" toast
- [ ] Rename file, rescan → "1 added, 1 removed" toast
- [ ] Delete all files, rescan → Shows empty catalog
- [ ] Verify deleted file no longer appears in grid
- [ ] Verify clicking deleted file (before rescan) shows error

---

## Implementation Order

```
1. Phase 1.3: Add onAssetsRemoved callback type (types.ts)
2. Phase 1.2: Implement detectRemovedFiles() (catalog-service.ts)
3. Phase 1.1: Track scanned paths and call detectRemovedFiles (catalog-service.ts)
4. Phase 4: Update MockCatalogService (mock-catalog-service.ts)
5. Phase 2.3: Add deselectBatch to selection store (selection.ts)
6. Phase 2.1: Add removeAssetBatch action (catalog.ts)
7. Phase 2.2: Wire onAssetsRemoved callback (catalog.client.ts)
8. Phase 5: Update useCatalog rescanFolder (useCatalog.ts)
9. Phase 3: Add logging to ScanService (scan-service.ts)
10. Add unit tests
11. Run full test suite
```

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `/packages/core/src/catalog/types.ts` | Add `AssetsRemovedCallback` type, update interface |
| `/packages/core/src/catalog/catalog-service.ts` | Add `detectRemovedFiles()`, track scanned paths, add callback |
| `/packages/core/src/catalog/mock-catalog-service.ts` | Add `onAssetsRemoved` callback |
| `/packages/core/src/catalog/scan-service.ts` | Add logging for file read failures |
| `/apps/web/app/stores/catalog.ts` | Add `removeAssetBatch` action |
| `/apps/web/app/stores/selection.ts` | Add `deselectBatch` method |
| `/apps/web/app/plugins/catalog.client.ts` | Wire `onAssetsRemoved` callback |
| `/apps/web/app/composables/useCatalog.ts` | Update diff calculation |

---

## Success Criteria

1. ✅ Deleted files are detected and removed during rescan
2. ✅ onAssetsRemoved callback fires with correct assets
3. ✅ UI updates to remove deleted files from grid
4. ✅ Selection is cleared if deleted file was selected
5. ✅ Blob URLs are revoked for deleted files
6. ✅ Toast shows accurate add/remove counts
7. ✅ File read failures are logged (not silent)
8. ✅ All existing tests pass
9. ✅ New unit tests added for removal detection
