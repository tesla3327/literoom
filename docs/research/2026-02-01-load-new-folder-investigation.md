# Load New Folder Investigation

**Date:** 2026-02-01
**Issue:** "Load new folder" button not working; previously loaded folders also fail to load

---

## Table of Contents

1. [UI Button Locations](#1-ui-button-locations)
2. [State Management Architecture](#2-state-management-architecture)
3. [Folder Loading Flow](#3-folder-loading-flow)
4. [Folder Persistence Mechanism](#4-folder-persistence-mechanism)
5. [File System Access API](#5-file-system-access-api)
6. [Catalog Service Architecture](#6-catalog-service-architecture)
7. [App Initialization Flow](#7-app-initialization-flow)
8. [Welcome Screen Component](#8-welcome-screen-component)
9. [Frontend-Backend Communication](#9-frontend-backend-communication)
10. [State Reset on Folder Change](#10-state-reset-on-folder-change)

---

## 1. UI Button Locations

The "Load new folder" / "Choose Folder" button appears in three locations:

### 1.1 Welcome Screen Button (Main Entry Point)

**File:** `/apps/web/app/pages/index.vue`
**Lines:** 334-341

```vue
<UButton
  size="xl"
  :loading="isLoading"
  data-testid="choose-folder-button"
  @click="handleSelectFolder"
>
  {{ hasRecentFolders ? 'Choose Different Folder' : 'Choose Folder' }}
</UButton>
```

**Handler:** `handleSelectFolder()` (lines 62-76)
```typescript
async function handleSelectFolder() {
  scanError.value = null
  try {
    await selectFolder()
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('cancelled')) {
      // User cancelled - don't show error
    }
    else {
      scanError.value = error instanceof Error ? error.message : 'Failed to select folder'
    }
  }
}
```

### 1.2 Dropdown Menu Item

**File:** `/apps/web/app/components/catalog/RecentFoldersDropdown.vue`
**Lines:** 100-107

```typescript
// "Choose New Folder" action
items.push([
  {
    label: 'Choose New Folder...',
    icon: 'i-heroicons-plus',
    click: handleSelectNew,
  },
])
```

**Handler:** `handleSelectNew()` (lines 66-72)
```typescript
async function handleSelectNew() {
  const success = await openNewFolder()
  if (success) {
    isDropdownOpen.value = false
    emit('folderChanged')
  }
}
```

### 1.3 Permission Recovery Modal

**File:** `/apps/web/app/components/catalog/PermissionRecovery.vue`
**Lines:** 154-159

```vue
<UButton
  variant="ghost"
  @click="handleSelectNewFolder"
>
  Choose Different Folder
</UButton>
```

### Call Chain Summary

```
UI Button Click
    ↓
index.vue:handleSelectFolder() OR RecentFoldersDropdown:handleSelectNew()
    ↓
useCatalog.selectFolder() (from useCatalog.ts, lines 130-176)
    ↓
requireCatalogService() → gets ICatalogService
    ↓
CatalogService.selectFolder()
```

---

## 2. State Management Architecture

The application uses **Pinia stores** with **IndexedDB** for persistence.

### 2.1 Catalog Store

**File:** `/apps/web/app/stores/catalog.ts`
**Lines:** 1-454

**Primary State:**
| Property | Type | Line | Purpose |
|----------|------|------|---------|
| `folderPath` | `ref<string \| null>` | 39 | Display name of current folder |
| `assets` | `shallowRef<Map<string, Asset>>` | 28 | All assets keyed by ID |
| `assetIds` | `shallowRef<string[]>` | 34 | Ordered list of asset IDs |
| `isScanning` | `ref<boolean>` | 44 | Scan in progress flag |
| `scanProgress` | `ref<ScanProgress \| null>` | 49 | Current scan progress |
| `error` | `ref<string \| null>` | 54 | Error message |

**Key Actions:**
- `setFolderPath(path)` - Lines 351-353
- `clear()` - Lines 382-399 (revokes blob URLs)
- `addAssetBatch(newAssets)` - Lines 176-196
- `updateAsset(assetId, updates)` - Lines 201-209

### 2.2 Catalog UI Store

**File:** `/apps/web/app/stores/catalogUI.ts`
**Lines:** 1-321

**Persisted to sessionStorage:**
- `filterMode` - 'all' | 'picks' | 'rejects' | 'unflagged'
- `sortField` - 'captureDate' | 'filename' | 'fileSize'
- `sortDirection` - 'asc' | 'desc'
- `viewMode` - 'grid' | 'loupe'

### 2.3 Edit Store

**File:** `/apps/web/app/stores/edit.ts`
**Lines:** 1-150+

**Primary State:**
- `currentAssetId` - Asset being edited
- `adjustments` - Temperature, exposure, contrast, etc.
- `cropTransform` - Crop region and rotation
- `masks` - Linear and radial gradient masks
- `editCache` - Session-level edit persistence
- `isDirty` - Unsaved changes flag

### 2.4 State Hierarchy

```
Database (Dexie LiteroomCatalog)
├── folders table (FolderRecord)
├── assets table (AssetRecord)
└── editStates table (EditStateRecord)

IndexedDB (literoom-fs)
└── handles store (FileSystemDirectoryHandle)

CatalogService (In-Memory)
├── _currentFolder: FileSystemDirectoryHandle | null
├── _currentFolderId: number | null
└── _assets: Map<string, Asset>

Pinia Stores (Vue Reactivity)
├── CatalogStore (assets, assetIds, folderPath, isScanning)
├── CatalogUIStore (filter, sort, viewMode)
└── EditStore (currentAssetId, adjustments, cropTransform, masks)
```

---

## 3. Folder Loading Flow

### 3.1 selectFolder() - User-Initiated Selection

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 199-228

```typescript
async selectFolder(): Promise<void> {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    throw new CatalogError(
      'File System Access API is not supported in this browser',
      'NOT_SUPPORTED'
    )
  }

  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
    this.resetForFolderChange()
    await this.setCurrentFolder(handle)
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return  // User cancelled
      }
      if (error.name === 'SecurityError' || error.name === 'NotAllowedError') {
        throw new CatalogError('Permission denied', 'PERMISSION_DENIED', error)
      }
    }
    throw new CatalogError(...)
  }
}
```

### 3.2 setCurrentFolder() - Persist Selection

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 240-265

Flow:
1. Sets `this._currentFolder` to FileSystemDirectoryHandle
2. Checks if folder exists in database
3. If new: Creates FolderRecord with handleKey
4. If exists: Retrieves folder ID
5. Calls `persistHandle(key, handle)` to save to IndexedDB

### 3.3 scanFolder() - Discover Files

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 281-384

```
scanFolder()
  → validateFolder selected
  → create AbortController for cancellation
  → set state to "scanning"
  → invoke scanService.scan(directory)
    → ScanService yields individual ScannedFile objects
    → for each file:
      → check if asset exists in database
      → if exists: check modification date, update if changed
      → if new: create AssetRecord with UUID
      → add to in-memory _assets Map
      → emit onAssetsAdded callback
      → queue for photo processing
      → update scan progress
  → update lastScanDate in database
  → set state to "ready"
```

### 3.4 ScanService.scan() - File System Traversal

**File:** `/packages/core/src/catalog/scan-service.ts`
**Lines:** 50-141

- Async generator yielding ScannedFile objects
- Recursive directory traversal
- Supports abort signal for cancellation
- Supported extensions: `['arw', 'jpg', 'jpeg']`

### 3.5 loadFromDatabase() - Session Restoration

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 893-936

1. Query all folders from database
2. Get first folder
3. Load handle from IndexedDB using `loadHandle(handleKey)`
4. Check permission with `queryPermission({ mode: 'read' })`
5. Set as current folder
6. Load all assets from database
7. Emit onAssetsAdded for all assets

### 3.6 loadFolderById() - Recent Folder Loading

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 981-1029

1. Get folder record by ID
2. Load persisted handle
3. Check/request permission if needed
4. Reset state with `resetForFolderChange()`
5. Load all assets for that folder
6. Update lastScanDate
7. Notify listeners

---

## 4. Folder Persistence Mechanism

### 4.1 Dual Database System

**Database 1: Dexie "LiteroomCatalog"**

**File:** `/packages/core/src/catalog/db.ts`

FolderRecord Structure (Lines 51-62):
```typescript
interface FolderRecord {
  id?: number              // Auto-increment primary key
  path: string             // Unique folder path/name
  name: string             // Display name
  handleKey: string        // Reference to handle in literoom-fs
  lastScanDate: Date       // When folder was last accessed
}
```

**Database 2: IndexedDB "literoom-fs"**

**File:** `/packages/core/src/catalog/catalog-service.ts` (Lines 47-89)

- Store Name: `handles`
- Key Format: `literoom-folder-{folderName}-{timestamp}`
- Value: FileSystemDirectoryHandle objects

### 4.2 Handle Storage Helper

**File:** `/packages/core/src/catalog/catalog-service.ts` (Lines 64-89)

```typescript
withHandleDB<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T>
```

### 4.3 Recent Folders Composable

**File:** `/apps/web/app/composables/useRecentFolders.ts`

| Function | Line | Purpose |
|----------|------|---------|
| `loadRecentFolders(limit = 5)` | 51-73 | Fetch recent folders from DB |
| `openRecentFolder(folder)` | 82-119 | Load folder with permission handling |
| `checkFolderAccess(folder)` | 154-163 | Verify accessibility |

---

## 5. File System Access API

### 5.1 Core Implementation

**File:** `/packages/core/src/filesystem/browser.ts`
**Line 145:**

```typescript
const handle = await (window as any).showDirectoryPicker({
  mode: 'read',
})
```

### 5.2 Type Definitions

**File:** `/packages/core/src/types/file-system-access.d.ts`

DirectoryPickerOptions (Lines 15-20):
```typescript
interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}
```

### 5.3 Browser Compatibility

**Supported:** Chrome, Edge, Brave (Chromium-based browsers)
**Not Supported:** Safari, Firefox (limited)

Check function (`/packages/core/src/filesystem/browser.ts`, Lines 73-75):
```typescript
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window
}
```

### 5.4 Error Handling

DOMException types handled:
- **AbortError**: User cancelled (silent return)
- **SecurityError/NotAllowedError**: Permission denied
- Other errors wrapped in `CatalogError`

---

## 6. Catalog Service Architecture

### 6.1 Main Class

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 115-1041

**Factory Method (Line 161):**
```typescript
CatalogService.create(decodeService: IDecodeService)
```

Creates ScanService, ThumbnailService, and PhotoProcessor instances.

### 6.2 Private Properties (Lines 122-135)

```typescript
private _state: CatalogServiceState
private _currentFolder: FileSystemDirectoryHandle | null
private _currentFolderId: number | null
private _assets: Map<string, Asset>
private _abortController: AbortController | null
private _onAssetsAdded: AssetsAddedCallback | null
private _onAssetUpdated: AssetUpdatedCallback | null
private _onThumbnailReady: ThumbnailReadyCallback | null
private _onPreviewReady: PreviewReadyCallback | null
private _onPhotoReady: PhotoReadyCallback | null
```

### 6.3 API Categories

| Category | Methods | Lines |
|----------|---------|-------|
| Folder Management | `selectFolder()`, `setCurrentFolder()`, `getCurrentFolder()` | 191-273 |
| Scanning | `scanFolder()`, `rescanFolder()`, `cancelScan()` | 275-400 |
| Asset Access | `getAsset()`, `getAssets()` | 401-417 |
| Flag Management | `setFlag()`, `setFlagBatch()` | 419-469 |
| Thumbnails | `requestThumbnail()`, `requestPreview()`, `updatePriority()` | 494-568 |
| Session | `loadFromDatabase()`, `listFolders()`, `loadFolderById()` | 885-1040 |
| Lifecycle | `destroy()`, `resetForFolderChange()` | 695-730 |

### 6.4 Event Callbacks (Lines 652-693)

- `onAssetsAdded`: Fired when new assets discovered
- `onAssetUpdated`: Fired when asset properties change
- `onThumbnailReady`: Fired when thumbnail blob URL ready
- `onPreviewReady`: Fired when preview blob URL ready
- `onPhotoReady`: Fired when both thumbnail and preview ready

### 6.5 Composition Dependencies

1. **ScanService** - Folder traversal, yields ScannedFile objects
2. **ThumbnailService** - Priority queue, two-tier caching
3. **PhotoProcessor** - Unified pipeline for thumbnail+preview
4. **Dexie Database** - Persistence layer

---

## 7. App Initialization Flow

### 7.1 Plugin Initialization

**File:** `/apps/web/app/plugins/catalog.client.ts`
**Lines:** 35-227

**Stages:**

1. **GPU Initialization** (lines 49-79, non-blocking)
2. **Service Creation** (lines 84-105)
   - Demo Mode: MockCatalogService + MockDecodeService
   - Real Mode: CatalogService + DecodeService
3. **Callback Wiring** (lines 108-127)
4. **Catalog Data Initialization** (lines 155-213)

**Services Provided:**
```typescript
provide: {
  catalogService,
  decodeService,
  isDemoMode,
  initializeCatalog,
  gpuProcessor,
  gpuCapabilities,
}
```

### 7.2 Route Middleware

**File:** `/apps/web/app/middleware/ensure-catalog.ts`
**Lines:** 14-45

1. Waits for `$catalogReady` promise
2. Verifies `$catalogService` available
3. Calls `$initializeCatalog()`
4. Redirects to `/` if initialization fails

### 7.3 Home Page Initialization

**File:** `/apps/web/app/pages/index.vue`
**Lines:** 128-148

On mount:
- **Demo Mode:** Calls `restoreSession()` auto-loading demo catalog
- **Real Mode:** Calls `loadRecentFolders()`, shows welcome screen

### 7.4 Initialization Timeline

**Demo Mode:**
```
Plugin loads → Creates MockCatalogService
    ↓
Home page mounts → initializeApp()
    ↓
restoreSession() → selectFolder() + scanFolder()
    ↓
Assets populate catalog store → Grid displays
```

**Real Mode:**
```
Plugin loads → Creates CatalogService
    ↓
Home page mounts → initializeApp()
    ↓
loadRecentFolders() → Shows welcome screen
    ↓
User clicks "Choose Folder" → selectFolder()
    ↓
scanFolder() → Callbacks update stores → Grid displays
```

---

## 8. Welcome Screen Component

### 8.1 Component Structure

**File:** `/apps/web/app/pages/index.vue`
**Lines:** 239-358

```
Welcome Screen Container (lines 240-358)
├── Title: "Literoom"
├── Subtitle
├── Demo Mode Indicator (optional)
├── Recent Folders List
│   └── Recent folder buttons with accessibility status
├── Loading Recent Folders State
├── Primary Action Buttons
│   └── "Choose Folder" / "Choose Different Folder"
├── Browser Compatibility Note
└── Error Message Display
```

### 8.2 Key Test IDs

| Element | Test ID | Line |
|---------|---------|------|
| Welcome screen | `welcome-screen` | 243 |
| Choose folder button | `choose-folder-button` | 337 |
| Recent folder items | `recent-folder-item` | 279 |
| Catalog page | `catalog-page` | 221 |

### 8.3 User Flow

```
User on Welcome Screen
    ↓
Choose Folder Button / Recent Folder Click
    ↓
selectFolder() or openRecentFolder()
    ↓
Clear previous state (stores)
    ↓
service.selectFolder() or service.loadFolderById()
    ↓
service.scanFolder() [show "Scanning..."]
    ↓
Generate thumbnails [show "Preparing photos..."]
    ↓
waitForReadyPhotos()
    ↓
Catalog View displayed with grid
```

---

## 9. Frontend-Backend Communication

### 9.1 IPC Mechanism

**Uses File System Access API (browser-native)**, NOT Tauri IPC or Electron IPC.

### 9.2 Communication Flow

```
User Action (selectFolder in UI)
    ↓
useCatalog.selectFolder() composable
    ↓
CatalogService.selectFolder()
    ↓
window.showDirectoryPicker() [Browser FSAPI]
    ↓
Native OS Folder Picker Dialog
    ↓
FileSystemDirectoryHandle returned to JS
    ↓
Handle persisted in IndexedDB
    ↓
ScanService.scan(handle)
    ↓
Assets cached in Dexie database
    ↓
Pinia stores updated via callbacks
```

### 9.3 Tauri Integration Status

**Current State:** Not yet implemented

**File:** `/packages/core/src/filesystem/index.ts` (Lines 53-58)

Environment detection is in place but Tauri throws "NOT_SUPPORTED" error.

---

## 10. State Reset on Folder Change

### 10.1 Recent Fix

**Commit:** 36c8543 "fix: properly reset state when switching folders"

The bug was caused by **incomplete state cleanup** when switching folders.

### 10.2 resetForFolderChange() Method

**File:** `/packages/core/src/catalog/catalog-service.ts`
**Lines:** 717-730

```typescript
private resetForFolderChange(): void {
  // Cancel any in-progress scan
  this.cancelScan()

  // Cancel all pending photo processing
  this.photoProcessor.cancelAll()

  // Cancel all pending thumbnail/preview requests
  this.thumbnailService.cancelAll()
  this.thumbnailService.cancelAllPreviews()

  // Clear in-memory assets
  this._assets.clear()
}
```

**Called from:**
- Line 210 in `selectFolder()` - BEFORE showing folder picker
- Line 1005 in `loadFolderById()` - BEFORE loading folder from database

### 10.3 Composable Cleanup

**useCatalog.ts (Lines 137-141):**
```typescript
const editStore = useEditStore()
const editUIStore = useEditUIStore()
editStore.clear()
editUIStore.clear()
```

**useRecentFolders.ts (Lines 97-101):**
```typescript
const editStore = useEditStore()
const editUIStore = useEditUIStore()
editStore.clear()
editUIStore.clear()
```

### 10.4 EditStore.clear()

**File:** `/apps/web/app/stores/edit.ts` (Lines 416-425)

Resets:
- Current asset ID
- All adjustments
- Crop/rotation settings
- Masks
- Dirty flag
- Saving status
- Error messages

### 10.5 EditUIStore.clear()

**File:** `/apps/web/app/stores/editUI.ts` (Lines 529-550)

Resets:
- Camera (zoom/pan)
- Zoom preset
- Zoom cache
- Image/viewport dimensions
- Clipping overlays
- Crop tool state
- Mask tool state

### 10.6 Complete Reset Order

1. **CatalogService** clears:
   - In-progress scans
   - Pending PhotoProcessor requests
   - Pending thumbnail/preview requests
   - In-memory assets map

2. **Composables** clear:
   - Catalog store
   - Selection store
   - Edit store
   - Edit UI store

3. **Then** folder loading/scanning begins

---

## Summary

The folder loading system involves:

1. **Three UI entry points** all calling the same underlying service
2. **Pinia stores** for reactive state with IndexedDB persistence
3. **File System Access API** for native folder picker (browser-only)
4. **Dual IndexedDB databases** for handles and metadata
5. **Progressive scanning** with async generators
6. **Event-driven updates** via callbacks to stores
7. **Comprehensive state reset** when switching folders

The recent commit 36c8543 addressed incomplete state cleanup, but the current issue suggests there may be additional problems in this flow.

---

# Part 2: Deep Dive Analysis

The following sections contain deeper investigation into potential root causes.

---

## 11. Critical Race Condition: Picker Cancellation

### 11.1 The Problem

**State is cleared BEFORE the folder picker is shown in `useCatalog.selectFolder()`**, meaning if the user cancels, the UI is left empty.

### 11.2 Timeline Analysis

**File:** `/apps/web/app/composables/useCatalog.ts` (Lines 130-176)

```
Timeline in useCatalog.selectFolder():
├─ Line 134: catalogStore.clear()              ← ALL STATE CLEARED
├─ Line 135: selectionStore.clear()            ← Selection cleared
├─ Line 138-141: editStore/editUIStore.clear() ← Edit state cleared
├─ Lines 147-149: isLoading = true, setScanning(true)
│
├─ Line 154: await service.selectFolder()      ← Picker shown HERE
│
│  ┌─ User selects folder → continues to scanFolder()
│  │
│  └─ User CANCELS (AbortError)
│     ├─ catalog-service.ts catches AbortError (line 214)
│     ├─ Returns silently (no error thrown)
│     ├─ useCatalog continues to line 157...
│     └─ Tries to get folder name, then scanFolder()
│
├─ Line 165: await service.scanFolder()
│  └─ THROWS: "No folder selected" (line 282-284)
│
└─ Finally block runs, but stores remain EMPTY
```

### 11.3 Code Flow in catalog-service.ts

**Lines 199-228:**
```typescript
async selectFolder(): Promise<void> {
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
    this.resetForFolderChange()  // Only called AFTER success
    await this.setCurrentFolder(handle)
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return  // Silent return - no error thrown!
      }
      // ... other error handling
    }
  }
}
```

**Key Issue:** When AbortError occurs:
1. `service.selectFolder()` returns successfully (no error)
2. `useCatalog` continues execution
3. `service.getCurrentFolder()` returns `null`
4. `service.scanFolder()` throws "No folder selected"
5. Stores were already cleared at lines 134-141

### 11.4 Summary

| Question | Answer | Severity |
|----------|--------|----------|
| When is state cleared? | BEFORE picker shown (lines 134-141) | **CRITICAL** |
| Is state restored on cancel? | NO | **CRITICAL** |
| What does AbortError do? | Silent return, no error | **HIGH** |
| Race condition exists? | YES | **CRITICAL** |

---

## 12. openRecentFolder() Error Handling Gaps

### 12.1 Function Flow

**File:** `/apps/web/app/composables/useRecentFolders.ts` (Lines 82-119)

```typescript
async function openRecentFolder(folder: FolderInfo): Promise<boolean> {
  const service = requireCatalogService()
  isLoadingFolderId.value = folder.id
  error.value = null

  try {
    // STATE CLEARED HERE - BEFORE validation
    catalogStore.clear()           // Line 94
    selectionStore.clear()         // Line 95
    editStore.clear()              // Line 100
    editUIStore.clear()            // Line 101

    // VALIDATION HAPPENS HERE - AFTER state cleared
    const success = await service.loadFolderById(folder.id)  // Line 104
    if (success) {
      catalogStore.setFolderPath(folder.name)
    }
    return success
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to open folder'
    console.error('[useRecentFolders] Failed to open folder:', err)
    return false
  }
  finally {
    isLoadingFolderId.value = null
  }
}
```

### 12.2 Error Handling Gaps

| Gap | Location | Severity | Description |
|-----|----------|----------|-------------|
| Silent failures in loadFolderById | catalog-service.ts:981-1029 | **CRITICAL** | Returns `false` without error details |
| No error propagation | useRecentFolders.ts:104-109 | **HIGH** | `error.value` not set on `success=false` |
| RecentFoldersDropdown no error handling | RecentFoldersDropdown.vue:58-62 | **CRITICAL** | Complete silent failure |
| State cleared before validation | useRecentFolders.ts:94-101 | **CRITICAL** | Data loss on failure |
| No rollback mechanism | Throughout | **HIGH** | Partial failures corrupt state |

### 12.3 Caller Inconsistency

**index.vue (Lines 109-118):** Has error handling
```typescript
const success = await openRecentFolder(folder)
if (!success) {
  scanError.value = 'Could not access folder. Permission may have been revoked.'
}
```

**RecentFoldersDropdown.vue (Lines 58-62):** No error handling
```typescript
const success = await openRecentFolder(folder)
if (success) {
  isDropdownOpen.value = false
  emit('folderChanged')
}
// NO else block - silent failure!
```

---

## 13. loadFolderById() Critical Issues

### 13.1 Order of Operations Problem

**File:** `/packages/core/src/catalog/catalog-service.ts` (Lines 981-1029)

```typescript
async loadFolderById(folderId: number): Promise<boolean> {
  const folder = await db.folders.get(folderId)
  if (!folder) return false                          // Line 984 - SAFE

  const handle = await this.loadHandle(folder.handleKey)
  if (!handle) return false                          // Line 991 - SAFE

  const permission = await handle.queryPermission({ mode: 'read' })
  if (permission !== 'granted') {
    const requestResult = await handle.requestPermission({ mode: 'read' })
    if (requestResult !== 'granted') {
      return false                                   // Line 1000 - SAFE
    }
  }

  this.resetForFolderChange()                        // Line 1005 - CLEARS STATE

  this._currentFolder = handle                       // Line 1008
  this._currentFolderId = folderId                   // Line 1009

  const records = await db.assets.where('folderId').equals(folderId).toArray()
  // ↑ Line 1012 - CAN THROW, NO TRY-CATCH!

  await db.folders.update(folderId, { lastScanDate: new Date() })
  // ↑ Line 1019 - CAN THROW, NO TRY-CATCH!

  if (this._assets.size > 0) {
    this._onAssetsAdded?.(Array.from(this._assets.values()))
  }

  return true
}
```

### 13.2 Critical Issues

| Issue | Line | Severity | Impact |
|-------|------|----------|--------|
| `resetForFolderChange()` called before asset load | 1005 | **CRITICAL** | Assets cleared, then load fails |
| No try-catch around `db.assets.where()` | 1012 | **CRITICAL** | Exception leaves broken state |
| No try-catch around `db.folders.update()` | 1019 | **HIGH** | Silent DB failure |
| No state restoration on failure | Throughout | **HIGH** | UI shows empty catalog |

### 13.3 Broken State Scenario

```
1. User has folder with 1000 assets loaded
2. Clicks on recent folder
3. loadFolderById() called
4. Permission check passes
5. resetForFolderChange() executes → 1000 assets CLEARED
6. db.assets.where().toArray() THROWS exception
7. State: _currentFolder set, _assets empty, exception bubbles up
8. UI: Empty catalog, no error message, confused user
```

---

## 14. Permission Handling Flow

### 14.1 Permission States

**File:** `/packages/core/src/filesystem/types.ts` (Line 11)

| State | Meaning | Action |
|-------|---------|--------|
| `'granted'` | Already granted | Can access immediately |
| `'prompt'` | Unknown/needs prompt | Call `requestPermission()` |
| `'denied'` | Explicitly denied | Cannot access; needs browser settings |

### 14.2 Permission Check Locations

**loadFromDatabase()** (Lines 909-914):
```typescript
const permission = await handle.queryPermission({ mode: 'read' })
if (permission !== 'granted') {
  return false  // No request attempt!
}
```

**loadFolderById()** (Lines 995-1002):
```typescript
const permission = await handle.queryPermission({ mode: 'read' })
if (permission !== 'granted') {
  const requestResult = await handle.requestPermission({ mode: 'read' })
  if (requestResult !== 'granted') {
    return false
  }
}
```

### 14.3 PermissionRecovery Component

**File:** `/apps/web/app/components/catalog/PermissionRecovery.vue`

- Non-dismissible modal for re-authorizing folders
- Lists folders with permission issues
- Actions: "Choose Different Folder", "Retry All", "Continue"
- **Note:** Integration not fully wired - `addFolderIssue()` not called on failures

---

## 15. Error Propagation Analysis

### 15.1 Call Chain

```
index.vue (handleSelectFolder)     ← Has try/catch, displays errors
  ↓
useCatalog.ts (selectFolder)       ← try/finally, NO catch (propagates)
  ↓
catalog-service.ts (selectFolder)  ← Has try/catch, re-throws CatalogError
  ↓
catalog-service.ts (scanFolder)    ← Has try/catch, re-throws
```

### 15.2 Summary

| Function | Swallows Errors? | Has Catch? |
|----------|------------------|------------|
| `handleSelectFolder()` | No | ✓ Displays |
| `selectFolder()` (composable) | No | ✗ Propagates |
| `selectFolder()` (service) | No | ✓ Re-throws |
| `scanFolder()` | No | ✓ Re-throws |
| `restoreSession()` | **Yes** | ⚠️ Silent |
| `openRecentFolder()` | No | ✓ Logs |

### 15.3 Silent Error in restoreSession()

**File:** `/apps/web/app/composables/useCatalog.ts` (Lines 212-214)

```typescript
catch {
  return false  // Error swallowed completely!
}
```

**Recommendation:** Add logging:
```typescript
catch (err) {
  console.warn('[useCatalog] Session restoration failed:', err)
  return false
}
```

---

## 16. Store Clearing Timing Vulnerability

### 16.1 Both Flows Clear State First

**selectFolder() (useCatalog.ts, Lines 134-141):**
```typescript
catalogStore.clear()      // BEFORE async
selectionStore.clear()    // BEFORE async
editStore.clear()         // BEFORE async
editUIStore.clear()       // BEFORE async
// ... then await service.selectFolder()
```

**openRecentFolder() (useRecentFolders.ts, Lines 94-101):**
```typescript
catalogStore.clear()      // BEFORE async
selectionStore.clear()    // BEFORE async
editStore.clear()         // BEFORE async
editUIStore.clear()       // BEFORE async
// ... then await service.loadFolderById()
```

### 16.2 Vulnerability Matrix

| Failure Point | UI After Failure | Recovery |
|---------------|------------------|----------|
| `service.selectFolder()` fails | Empty catalog | None |
| `service.selectFolder()` cancelled | Empty catalog | None |
| `service.scanFolder()` fails | Empty catalog | None |
| `service.loadFolderById()` fails | Empty catalog | None |
| `waitForReadyPhotos()` timeout | Partial (some loaded) | None |

### 16.3 Recommended Fix

Clear stores **AFTER** async operation succeeds:
```typescript
async function selectFolder(): Promise<void> {
  isLoading.value = true

  try {
    await service.selectFolder()  // May fail or cancel
    await service.scanFolder()    // May fail

    // ONLY NOW clear previous state
    catalogStore.clear()
    selectionStore.clear()
    editStore.clear()
    editUIStore.clear()

    // Populate with new data...
  } finally {
    isLoading.value = false
  }
}
```

---

## 17. Demo Mode vs Real Mode

### 17.1 Key Differences

| Aspect | MockCatalogService | CatalogService |
|--------|-------------------|-----------------|
| `selectFolder()` | No-op (sets name) | Shows file picker |
| `resetForFolderChange()` | Not implemented | Clears all state |
| Database | No persistence | Full Dexie integration |
| `loadFolderById()` | Returns `false` always | Loads from DB |
| `listFolders()` | Returns `[]` | Returns recent folders |

### 17.2 Does Issue Affect Demo Mode?

**No** - Demo mode works because:
1. `selectFolder()` is a no-op (Lines 236-238)
2. No state reset occurs
3. `scanFolder()` just loads demo assets
4. Works on repeated calls

### 17.3 Demo-Only Code Paths

| Method | Purpose |
|--------|---------|
| `setAssets()` | Test fixture |
| `clearAssets()` | Test fixture |
| `resetToDemo()` | Reload demo assets |
| `completeAllThumbnails()` | Force completion |

---

## 18. Console Logging Coverage

### 18.1 Available Logging

| File | Type | Count | Prefix |
|------|------|-------|--------|
| catalog-service.ts | `console.error` | 3 | None |
| useCatalog.ts | `console.log/warn` | 5 | `[useCatalog]` |
| useRecentFolders.ts | `console.error` | 3 | `[useRecentFolders]` |
| index.vue | `console.warn` | 2 | None |

### 18.2 Gaps

- No success-path logging in folder operations
- No state transition logging
- No folder accessibility check logging
- `restoreSession()` errors are completely silent

---

## 19. Loading State Management

### 19.1 State Definitions

**useCatalog.ts (Lines 16-17):**
```typescript
const isLoading = ref(false)
const loadingMessage = ref('')
```

**useRecentFolders.ts (Line 30):**
```typescript
const isLoadingFolderId = ref<number | null>(null)
```

### 19.2 Stuck State Risks

| Scenario | Cause | Impact |
|----------|-------|--------|
| Service crashes | `service.selectFolder()` throws | Button disabled forever |
| Scan hangs | `service.scanFolder()` never completes | Loading persists |
| Timeout | `waitForReadyPhotos()` 15s timeout | Eventually resolves |
| Permission hang | `requestPermission()` never responds | Folder load stuck |

### 19.3 Button Clickability

**Recent Folder Buttons (Line 278):**
```html
:disabled="!folder.isAccessible || isLoadingFolderId === folder.id"
```

**Choose Folder Button (Line 336):**
```html
<UButton :loading="isLoading" @click="handleSelectFolder">
```

---

## 20. Root Cause Hypotheses

Based on this investigation, the "Load new folder" issue is likely caused by one of:

### Hypothesis 1: Race Condition on Cancel
- User clicks "Choose Folder"
- Stores are cleared (lines 134-141)
- User cancels the picker
- AbortError caught silently
- `scanFolder()` called with no folder
- Throws error, UI left empty

### Hypothesis 2: loadFolderById State Corruption
- User clicks recent folder
- Stores cleared in composable
- `resetForFolderChange()` clears service assets
- `db.assets.where()` fails (DB issue)
- Exception, but assets already cleared
- UI shows empty catalog

### Hypothesis 3: Permission Denial Without Recovery
- User clicks recent folder
- Permission check fails (`'prompt'` or `'denied'`)
- Returns `false` without triggering PermissionRecovery
- No error message shown
- User sees empty catalog, doesn't know why

### Hypothesis 4: Silent restoreSession() Failure
- App loads
- `restoreSession()` called
- Throws exception (DB corruption, handle invalid)
- Exception swallowed (Lines 212-214)
- Returns `false` silently
- No folder loaded, but no error shown

---

## 21. Recommended Investigation Steps

1. **Add console logging** to track state transitions
2. **Check browser console** for unhandled errors
3. **Test with DevTools open** to see network/storage errors
4. **Verify IndexedDB state** using Application tab
5. **Test permission states** by revoking folder access
6. **Test cancellation flow** explicitly
7. **Check if demo mode works** to isolate browser vs code issue
