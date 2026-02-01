# Rescan Folder Bug Investigation Synthesis

**Date:** 2026-02-01
**Issue:** "Rescanning a folder fails" (Critical)
**Research Method:** 5 parallel subagent investigation

---

## Executive Summary

The "Rescanning a folder fails" issue stems from **fundamental design limitations** in the rescan implementation. The `rescanFolder()` method is a 1-line delegation to `scanFolder()` that provides no actual "rescan" functionality:

1. **No deleted file detection** - Files removed from disk remain in the database and UI
2. **Silent file read failures** - Inaccessible files are silently skipped without logging
3. **Duplicate callbacks fired** - Existing assets trigger `onAssetsAdded` callbacks again
4. **No PhotoProcessor cancellation for in-flight tasks** - Old thumbnail/preview generation may complete and update state

---

## Root Cause Analysis

### Primary Issue: rescanFolder() is Not a Real Rescan

**File:** `/packages/core/src/catalog/catalog-service.ts` (Lines 386-392)

```typescript
async rescanFolder(): Promise<void> {
  // Same as scanFolder - it handles duplicates
  await this.scanFolder()
}
```

**What it SHOULD do:**
- Detect newly added files ✅ (working)
- Detect modified files ✅ (working)
- Detect removed files ❌ **MISSING**
- Only fire callbacks for changes ❌ **MISSING**

**What it ACTUALLY does:**
- Re-scans all files
- Fires `onAssetsAdded` for EVERY file (not just new ones)
- Never removes orphaned database records
- Never cleans up assets that no longer exist on disk

### Secondary Issue: Silent File Read Failures

**File:** `/packages/core/src/catalog/scan-service.ts` (Lines 88-93)

```typescript
let file: File
try {
  file = await fileHandle.getFile()
} catch (error) {
  continue  // ⚠️ SILENTLY SKIPS FILE WITHOUT LOGGING
}
```

**Impact:**
- Files with permission issues silently disappear
- Files deleted during scan silently ignored
- No way to distinguish "doesn't exist" vs "exists but inaccessible"
- User never knows which files failed

### Tertiary Issue: PhotoProcessor In-Flight Tasks

**File:** `/packages/core/src/catalog/photo-processor.ts` (Lines 153-156)

```typescript
cancelAll(): void {
  this.queue.length = 0
  // Note: Can't cancel in-flight processing, but they'll complete
}
```

**Impact:**
- During rescan, if a file is being processed, it will complete
- Callbacks will fire even after "cancellation"
- Unlike ThumbnailService, no generation number tracking for stale detection

---

## Detailed Findings

### 1. Duplicate Detection Logic (Working)

**File:** `/packages/core/src/catalog/catalog-service.ts` (Lines 306-320)

```typescript
const existingAsset = await db.assets
  .where({ folderId: this._currentFolderId!, path: scannedFile.path })
  .first()

if (existingAsset) {
  // Check if modified
  if (existingAsset.modifiedDate.getTime() !== scannedFile.modifiedDate.getTime()) {
    await db.assets.update(existingAsset.id!, {
      fileSize: scannedFile.fileSize,
      modifiedDate: scannedFile.modifiedDate,
    })
  }
  asset = this.assetRecordToAsset(existingAsset)
} else {
  // Create new asset
}
```

**Status:** ✅ Working correctly for duplicate and modified file detection

### 2. Callback Firing (Problematic)

**File:** `/packages/core/src/catalog/catalog-service.ts` (Line 346)

```typescript
this._onAssetsAdded?.([asset])  // Fires for EVERY asset, not just new ones
```

**Status:** ⚠️ Fires for ALL assets during rescan, causing:
- UI receives same assets again
- Potential performance issues with large catalogs
- Count tracking in composable sees old + new assets

### 3. No Removed File Detection

**What's missing:** After scan completes, there's no logic to:
1. Identify assets in database that weren't found in current scan
2. Mark or remove orphaned database records
3. Clean up in-memory `_assets` map
4. Revoke blob URLs for removed assets

### 4. Database Orphan Scenario

```
Initial scan finds: file1.jpg, file2.jpg, file3.jpg (all added to DB)
User deletes file2.jpg from disk
rescanFolder() called:
  → Scans file1.jpg, file3.jpg (file2.jpg not found in FS)
  → file1.jpg and file3.jpg are duplicates → updated if needed
  → file2.jpg still in database (orphan)
  → file2.jpg still in this._assets map
  → User sees "file2.jpg" in UI but clicking it fails
```

---

## UI Layer Analysis

### useCatalog.rescanFolder() (Composable)

**File:** `/apps/web/app/composables/useCatalog.ts` (Lines 289-340)

**Good patterns:**
- Validates folder is loaded
- Sets `isScanning` state correctly
- Shows toast notifications with results
- Proper error handling with try-catch-finally

**Problematic behavior:**
- Calculates diff as `newCount - previousCount`
- But `previousCount` includes orphaned assets
- If file deleted and new file added, diff could be 0 (misleading)

### FilterBar UI

**File:** `/apps/web/app/components/catalog/FilterBar.vue` (Lines 175-186)

**Good patterns:**
- Button hidden during scan
- Progress indicator with spinning icon
- Proper data-testid for testing

---

## Impact Assessment

| Scenario | Expected Behavior | Actual Behavior | Severity |
|----------|-------------------|-----------------|----------|
| Add new file | Found and displayed | ✅ Works | N/A |
| Modify existing file | Detected, thumbnail regenerated | ⚠️ Detected but not re-thumbnailed | Medium |
| Delete file from disk | Removed from UI | ❌ Remains in UI (ghost) | **Critical** |
| Rename file | Updated in place | ❌ Creates duplicate (new + ghost) | High |
| File permission denied | Error shown | ❌ Silent skip | Medium |
| Large folder rescan | Fast incremental | ⚠️ Full re-callback storm | Medium |

---

## Recommended Fix Strategy

### Phase 1: Core - Detect Removed Files (Critical)

1. Track scanned file paths during scan
2. After scan, query database for assets not in scanned set
3. Remove orphaned assets from database
4. Remove orphaned assets from `_assets` map
5. Fire `onAssetsRemoved` callback for UI update

### Phase 2: Core - Conditional Callbacks

1. Only fire `onAssetsAdded` for genuinely NEW assets
2. Add `onAssetsModified` callback for modified files
3. Add `onAssetsRemoved` callback for deleted files
4. UI listens to specific events for proper updates

### Phase 3: Logging and Error Handling

1. Log file read failures instead of silent skip
2. Optionally accumulate failed files for user notification
3. Add console warnings for debugging

### Phase 4: PhotoProcessor Stale Detection (Optional)

1. Add generation number tracking like ThumbnailService
2. Check generation before firing callbacks
3. Discard stale results

---

## Files Requiring Modification

| File | Changes |
|------|---------|
| `/packages/core/src/catalog/catalog-service.ts` | Add removed file detection, conditional callbacks |
| `/packages/core/src/catalog/scan-service.ts` | Add logging for file read failures |
| `/packages/core/src/catalog/types.ts` | Add `onAssetsRemoved` callback type |
| `/packages/core/src/catalog/db.ts` | Add `getAssetPathsForFolder()` helper |
| `/apps/web/app/stores/catalog.ts` | Add `removeAssetBatch()` action |
| `/apps/web/app/plugins/catalog.client.ts` | Wire `onAssetsRemoved` callback |

---

## Test Plan

1. **Unit test:** Rescan detects new file
2. **Unit test:** Rescan detects modified file
3. **Unit test:** Rescan detects removed file
4. **Unit test:** Rescan handles renamed file (remove + add)
5. **Integration test:** Full rescan cycle with UI updates
6. **E2E test:** Click rescan button, verify toast shows correct counts

---

## Conclusion

The "Rescanning a folder fails" bug is not a crash or error - it's a **missing feature**. The current implementation only handles the "add/modify" cases but completely ignores the "delete" case. Users see ghost assets for files that no longer exist, which breaks trust in the application.

**Priority:** Critical - This is core catalog functionality
**Estimated Complexity:** Medium - Well-defined changes to known files
**Risk:** Low - Changes are additive, existing tests should catch regressions
