# Implementation Plan: Load New Folder Fix

**Date:** 2026-02-01
**Based on:** `/docs/research/2026-02-01-load-new-folder-investigation.md`
**Issue:** "Load new folder" button not working; previously loaded folders also fail to load

---

## Executive Summary

The investigation identified **four root causes** all related to improper state management and error handling:

1. **Race Condition on Cancel** - Stores cleared BEFORE picker shown
2. **loadFolderById State Corruption** - State cleared before validation completes
3. **Permission Denial Without Recovery** - Silent failures with no user feedback
4. **Silent restoreSession() Failure** - Errors swallowed completely

This plan addresses all four issues across 4 phases.

---

## Phase 1: Fix State Clearing Race Condition

**Priority:** CRITICAL
**Goal:** Prevent data loss when user cancels folder picker or when folder loading fails

### Step 1.1: Add Cancellation Signal to selectFolder()

**File:** `/packages/core/src/catalog/catalog-service.ts:199-228`

The `selectFolder()` method currently returns silently on `AbortError`, but callers have no way to know the operation was cancelled.

**Current Code (lines 199-228):**
```typescript
async selectFolder(): Promise<void> {
  // ...
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
    this.resetForFolderChange()
    await this.setCurrentFolder(handle)
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return  // Silent return - callers don't know!
      }
      // ...
    }
  }
}
```

**Change:** Modify return type to indicate cancellation:

```typescript
async selectFolder(): Promise<{ cancelled: boolean }> {
  // ...
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
    this.resetForFolderChange()
    await this.setCurrentFolder(handle)
    return { cancelled: false }
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return { cancelled: true }  // Signal cancellation
      }
      // ...
    }
    throw error
  }
}
```

**Also update:**
- `/packages/core/src/catalog/types.ts` - Update `ICatalogService` interface
- `/packages/core/src/catalog/__mocks__/mock-catalog-service.ts` - Update mock

### Step 1.2: Move Store Clearing AFTER Successful Selection

**File:** `/apps/web/app/composables/useCatalog.ts:130-176`

**Current Code (lines 134-154):**
```typescript
async function selectFolder(): Promise<void> {
  catalogStore.clear()        // Line 134 - BEFORE async!
  selectionStore.clear()      // Line 135 - BEFORE async!
  // ...
  editStore.clear()           // Line 138 - BEFORE async!
  editUIStore.clear()         // Line 141 - BEFORE async!
  // ...
  await service.selectFolder()  // Line 154 - CAN CANCEL OR FAIL
  // ...
}
```

**Change to:**
```typescript
async function selectFolder(): Promise<void> {
  isLoading.value = true
  catalogStore.setScanning(true)

  try {
    const result = await service.selectFolder()

    // If user cancelled, abort without clearing state
    if (result.cancelled) {
      return
    }

    // ONLY clear stores after successful folder selection
    catalogStore.clear()
    selectionStore.clear()
    editStore.clear()
    editUIStore.clear()

    // Continue with scanning...
    loadingMessage.value = 'Scanning folder...'
    await service.scanFolder()
    // ...
  } finally {
    isLoading.value = false
    catalogStore.setScanning(false)
    loadingMessage.value = ''
  }
}
```

### Step 1.3: Fix openRecentFolder() State Clearing

**File:** `/apps/web/app/composables/useRecentFolders.ts:82-119`

**Current Code (lines 94-104):**
```typescript
async function openRecentFolder(folder: FolderInfo): Promise<boolean> {
  // ...
  try {
    catalogStore.clear()           // Line 94 - BEFORE validation!
    selectionStore.clear()         // Line 95
    // ...
    editStore.clear()              // Line 100
    editUIStore.clear()            // Line 101

    const success = await service.loadFolderById(folder.id)  // Line 104 - CAN FAIL
    // ...
  }
}
```

**Change to:**
```typescript
async function openRecentFolder(folder: FolderInfo): Promise<boolean> {
  const service = requireCatalogService()
  isLoadingFolderId.value = folder.id
  error.value = null

  try {
    // Validate FIRST, before clearing any state
    const success = await service.loadFolderById(folder.id)

    if (!success) {
      error.value = 'Could not access folder. Permission may have been revoked.'
      return false
    }

    // ONLY clear after successful load
    catalogStore.clear()
    selectionStore.clear()
    editStore.clear()
    editUIStore.clear()

    // Populate with new data
    catalogStore.setFolderPath(folder.name)
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to open folder'
    console.error('[useRecentFolders] Failed to open folder:', err)
    return false
  } finally {
    isLoadingFolderId.value = null
  }
}
```

---

## Phase 2: Fix loadFolderById() Error Handling

**Priority:** CRITICAL
**Goal:** Ensure loadFolderById() never leaves corrupted state on failure

### Step 2.1: Add Try-Catch Around Database Operations

**File:** `/packages/core/src/catalog/catalog-service.ts:981-1029`

**Current Code (lines 1005-1019):**
```typescript
async loadFolderById(folderId: number): Promise<boolean> {
  // ... permission checks ...

  this.resetForFolderChange()  // Line 1005 - CLEARS STATE

  this._currentFolder = handle
  this._currentFolderId = folderId

  const records = await db.assets.where('folderId').equals(folderId).toArray()
  // ↑ Line 1012 - CAN THROW, NO TRY-CATCH!

  await db.folders.update(folderId, { lastScanDate: new Date() })
  // ↑ Line 1019 - CAN THROW, NO TRY-CATCH!
  // ...
}
```

**Change to:**
```typescript
async loadFolderById(folderId: number): Promise<boolean> {
  // First, validate everything BEFORE clearing state
  const folder = await db.folders.get(folderId)
  if (!folder) {
    console.warn('[CatalogService] Folder not found:', folderId)
    return false
  }

  const handle = await this.loadHandle(folder.handleKey)
  if (!handle) {
    console.warn('[CatalogService] Handle not found:', folder.handleKey)
    return false
  }

  // Check permission
  const permission = await handle.queryPermission({ mode: 'read' })
  if (permission !== 'granted') {
    const requestResult = await handle.requestPermission({ mode: 'read' })
    if (requestResult !== 'granted') {
      console.warn('[CatalogService] Permission denied for folder:', folderId)
      return false
    }
  }

  // Pre-load assets to validate database access BEFORE clearing state
  let records: AssetRecord[]
  try {
    records = await db.assets.where('folderId').equals(folderId).toArray()
  } catch (err) {
    console.error('[CatalogService] Failed to load assets from database:', err)
    return false
  }

  // NOW it's safe to clear state - we have all the data we need
  this.resetForFolderChange()

  this._currentFolder = handle
  this._currentFolderId = folderId

  // Populate assets from pre-loaded records
  for (const record of records) {
    const asset = this.recordToAsset(record)
    this._assets.set(asset.id, asset)
  }

  // Update scan date (non-critical, don't fail on this)
  try {
    await db.folders.update(folderId, { lastScanDate: new Date() })
  } catch (err) {
    console.warn('[CatalogService] Failed to update lastScanDate:', err)
  }

  if (this._assets.size > 0) {
    this._onAssetsAdded?.(Array.from(this._assets.values()))
  }

  return true
}
```

### Step 2.2: Add Detailed Error Return Type (Optional Enhancement)

**File:** `/packages/core/src/catalog/types.ts`

Add a new type for detailed folder loading results:

```typescript
export type LoadFolderResult =
  | { success: true }
  | { success: false; reason: 'not_found' | 'handle_missing' | 'permission_denied' | 'database_error' }
```

**Update:** `/packages/core/src/catalog/catalog-service.ts:981`

Change `loadFolderById()` to return `LoadFolderResult` instead of `boolean`.

### Step 2.3: Update Composable to Handle Detailed Errors

**File:** `/apps/web/app/composables/useRecentFolders.ts:104`

```typescript
const result = await service.loadFolderById(folder.id)

if (!result.success) {
  switch (result.reason) {
    case 'not_found':
      error.value = 'Folder no longer exists in catalog.'
      break
    case 'handle_missing':
      error.value = 'Folder reference is missing. Please re-add the folder.'
      break
    case 'permission_denied':
      error.value = 'Permission denied. Please grant access to the folder.'
      break
    case 'database_error':
      error.value = 'Database error. Please try again.'
      break
  }
  return false
}
```

---

## Phase 3: Fix Silent Error Handling

**Priority:** HIGH
**Goal:** Ensure all errors are properly logged and communicated to users

### Step 3.1: Add Error Handling to RecentFoldersDropdown

**File:** `/apps/web/app/components/catalog/RecentFoldersDropdown.vue:58-62`

**Current Code:**
```typescript
const success = await openRecentFolder(folder)
if (success) {
  isDropdownOpen.value = false
  emit('folderChanged')
}
// NO else block - silent failure!
```

**Change to:**
```typescript
const success = await openRecentFolder(folder)
if (success) {
  isDropdownOpen.value = false
  emit('folderChanged')
} else {
  emit('folderError', error.value || 'Failed to open folder')
}
```

**Also update the component to emit the new event:**

**File:** `/apps/web/app/components/catalog/RecentFoldersDropdown.vue` (near line 25)

```typescript
const emit = defineEmits<{
  (e: 'folderChanged'): void
  (e: 'folderError', message: string): void
}>()
```

**Update parent component to handle error:**

**File:** `/apps/web/app/pages/index.vue` (near line 225)

```vue
<RecentFoldersDropdown
  @folder-changed="handleFolderChanged"
  @folder-error="(msg) => scanError = msg"
/>
```

### Step 3.2: Fix Silent restoreSession() Failure

**File:** `/apps/web/app/composables/useCatalog.ts:212-214`

**Current Code:**
```typescript
catch {
  return false  // Error swallowed completely!
}
```

**Change to:**
```typescript
catch (err) {
  console.warn('[useCatalog] Session restoration failed:', err)
  return false
}
```

### Step 3.3: Add Comprehensive Logging

**File:** `/packages/core/src/catalog/catalog-service.ts`

Add logging to key operations:

**selectFolder() (lines 199-228):**
```typescript
async selectFolder(): Promise<{ cancelled: boolean }> {
  console.log('[CatalogService] selectFolder() called')

  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
    console.log('[CatalogService] Folder selected:', handle.name)
    this.resetForFolderChange()
    await this.setCurrentFolder(handle)
    console.log('[CatalogService] Folder set successfully')
    return { cancelled: false }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('[CatalogService] Folder selection cancelled by user')
      return { cancelled: true }
    }
    console.error('[CatalogService] selectFolder() error:', error)
    throw error
  }
}
```

**loadFolderById() (lines 981-1029):**
Add logging at each validation step (as shown in Step 2.1).

**File:** `/apps/web/app/composables/useCatalog.ts`

Add logging to `selectFolder()`:
```typescript
async function selectFolder(): Promise<void> {
  console.log('[useCatalog] selectFolder() initiated')
  // ...
  console.log('[useCatalog] Folder selection complete, starting scan')
  // ...
  console.log('[useCatalog] Scan complete, waiting for thumbnails')
  // ...
}
```

---

## Phase 4: Improve Permission Recovery Integration

**Priority:** MEDIUM
**Goal:** Integrate PermissionRecovery component for failed folder loads

### Step 4.1: Create Permission Issue Tracking

**File:** `/apps/web/app/stores/catalog.ts`

Add state for tracking permission issues:

```typescript
// Add to state (near line 39)
const folderIssues = ref<FolderIssue[]>([])

interface FolderIssue {
  folderId: number
  folderName: string
  reason: 'permission_denied' | 'handle_missing' | 'not_found'
}

// Add action
function addFolderIssue(issue: FolderIssue): void {
  // Avoid duplicates
  if (!folderIssues.value.some(i => i.folderId === issue.folderId)) {
    folderIssues.value.push(issue)
  }
}

function clearFolderIssues(): void {
  folderIssues.value = []
}
```

### Step 4.2: Trigger PermissionRecovery on Failures

**File:** `/apps/web/app/composables/useRecentFolders.ts:104`

When `loadFolderById()` fails due to permission:

```typescript
if (!result.success) {
  if (result.reason === 'permission_denied') {
    catalogStore.addFolderIssue({
      folderId: folder.id,
      folderName: folder.name,
      reason: 'permission_denied'
    })
  }
  // ... handle other errors
}
```

### Step 4.3: Show PermissionRecovery Modal

**File:** `/apps/web/app/pages/index.vue`

Add the PermissionRecovery component:

```vue
<template>
  <div>
    <!-- Existing content -->

    <PermissionRecovery
      v-if="catalogStore.folderIssues.length > 0"
      :issues="catalogStore.folderIssues"
      @resolved="catalogStore.clearFolderIssues()"
      @select-new-folder="handleSelectFolder"
    />
  </div>
</template>
```

---

## Testing Plan

### Unit Tests

**File:** `/apps/web/app/composables/useCatalog.test.ts` (create if needed)

1. Test that stores are NOT cleared when folder picker is cancelled
2. Test that stores ARE cleared after successful folder selection
3. Test that errors are properly propagated

**File:** `/packages/core/src/catalog/catalog-service.test.ts`

1. Test `selectFolder()` returns `{ cancelled: true }` on AbortError
2. Test `loadFolderById()` returns detailed error reasons
3. Test `loadFolderById()` does NOT clear state on database failure
4. Test `loadFolderById()` clears state only AFTER successful validation

### Integration Tests

**File:** `/apps/web/test/folder-loading.test.ts` (create if needed)

1. Test full flow: click folder button → cancel → verify state preserved
2. Test full flow: load recent folder with revoked permission → verify error shown
3. Test full flow: successful folder change → verify old state cleared

### Manual Testing Checklist

- [ ] Click "Choose Folder" then cancel picker → previous catalog still visible
- [ ] Click "Choose Folder" and select folder → new catalog loads
- [ ] Click recent folder with permission → loads successfully
- [ ] Click recent folder without permission → error message shown
- [ ] Reload app with valid recent folder → restores session
- [ ] Reload app with invalid recent folder → shows welcome screen with error

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `/packages/core/src/catalog/catalog-service.ts:199-228` | Modify `selectFolder()` return type |
| `/packages/core/src/catalog/catalog-service.ts:981-1029` | Fix `loadFolderById()` error handling |
| `/packages/core/src/catalog/types.ts` | Add `LoadFolderResult` type, update `ICatalogService` interface |
| `/packages/core/src/catalog/__mocks__/mock-catalog-service.ts` | Update mock to match new interfaces |
| `/apps/web/app/composables/useCatalog.ts:130-176` | Move store clearing after success, handle cancellation |
| `/apps/web/app/composables/useCatalog.ts:212-214` | Add logging to restoreSession() catch |
| `/apps/web/app/composables/useRecentFolders.ts:82-119` | Move store clearing after success, handle detailed errors |
| `/apps/web/app/components/catalog/RecentFoldersDropdown.vue:58-62` | Add error event emission |
| `/apps/web/app/pages/index.vue:225` | Handle error events, show PermissionRecovery |
| `/apps/web/app/stores/catalog.ts:39` | Add folder issue tracking |

---

## Implementation Order

### Recommended Sequence

```
1. Phase 1.1 - Update selectFolder() return type (core service)
   └── packages/core/src/catalog/catalog-service.ts:199-228
   └── packages/core/src/catalog/types.ts
   └── packages/core/src/catalog/__mocks__/mock-catalog-service.ts

2. Phase 2.1 - Fix loadFolderById() error handling (core service)
   └── packages/core/src/catalog/catalog-service.ts:981-1029

3. Phase 2.2 - Add LoadFolderResult type (optional)
   └── packages/core/src/catalog/types.ts

4. Phase 1.2 - Update useCatalog.selectFolder() (composable)
   └── apps/web/app/composables/useCatalog.ts:130-176

5. Phase 1.3 - Update useRecentFolders.openRecentFolder() (composable)
   └── apps/web/app/composables/useRecentFolders.ts:82-119

6. Phase 3.1 - Add error handling to RecentFoldersDropdown
   └── apps/web/app/components/catalog/RecentFoldersDropdown.vue:58-62

7. Phase 3.2 - Fix restoreSession() logging
   └── apps/web/app/composables/useCatalog.ts:212-214

8. Phase 3.3 - Add comprehensive logging throughout
   └── packages/core/src/catalog/catalog-service.ts (multiple locations)
   └── apps/web/app/composables/useCatalog.ts (multiple locations)

9. Phase 4.1-4.3 - Permission recovery integration
   └── apps/web/app/stores/catalog.ts:39
   └── apps/web/app/composables/useRecentFolders.ts:104
   └── apps/web/app/pages/index.vue:225

10. Run tests and verify
```

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE SERVICE LAYER                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1.1: selectFolder() return type                       │
│  ├── catalog-service.ts:199-228                             │
│  ├── types.ts (ICatalogService interface)                   │
│  └── mock-catalog-service.ts                                │
│                        │                                    │
│                        ▼                                    │
│  Step 2.1: loadFolderById() error handling                  │
│  └── catalog-service.ts:981-1029                            │
│                        │                                    │
│  Step 2.2: LoadFolderResult type (optional)                 │
│  └── types.ts                                               │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    COMPOSABLE LAYER                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1.2: useCatalog.selectFolder()                        │
│  └── useCatalog.ts:130-176                                  │
│                        │                                    │
│  Step 1.3: useRecentFolders.openRecentFolder()              │
│  └── useRecentFolders.ts:82-119                             │
│                        │                                    │
│  Step 3.2: restoreSession() logging                         │
│  └── useCatalog.ts:212-214                                  │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    UI COMPONENT LAYER                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 3.1: RecentFoldersDropdown error handling             │
│  └── RecentFoldersDropdown.vue:58-62                        │
│                        │                                    │
│  Step 4.3: index.vue error display                          │
│  └── index.vue:225                                          │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    STORE LAYER (Phase 4)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 4.1: catalog.ts folder issue tracking                 │
│  └── catalog.ts:39                                          │
│                                                             │
│  Step 4.2: useRecentFolders.ts trigger issues               │
│  └── useRecentFolders.ts:104                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Changing `selectFolder()` return type | Breaking change for callers | Update all callers in same PR |
| Moving store clearing timing | May reveal hidden bugs | Thorough testing |
| Adding new error types | Type changes propagate | Update mock and tests |
| loadFolderById pre-loading assets | Slightly slower (loads before clearing) | Acceptable tradeoff for safety |

---

## Success Criteria

1. ✅ User can click "Choose Folder", cancel, and still see previous catalog
2. ✅ User clicking recent folder with revoked permission sees clear error message
3. ✅ All folder loading errors are logged to console
4. ✅ No silent failures in folder loading flow
5. ✅ All existing tests still pass
6. ✅ State is only cleared AFTER successful folder selection/load
