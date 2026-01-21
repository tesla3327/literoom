# Research: File System Access API Permission Persistence and Recovery (Area 5)

**Date**: 2026-01-20
**Focus Area**: Handle serialization, permission checking, and recovery UX patterns
**Related**: Catalog Service Research Plan - Area 5

---

## Executive Summary

The File System Access API provides mechanisms for persisting folder access across browser sessions through IndexedDB handle serialization. However, permissions are not automatically preserved - handles stored in IndexedDB typically return a `'prompt'` permission state on reload. Chrome 122+ introduces optional persistent permissions for installed web apps. This document covers patterns for handle persistence, permission verification, and recovery UI design for Literoom's catalog system.

---

## 1. Handle Serialization

### How It Works

`FileSystemDirectoryHandle` and `FileSystemFileHandle` objects are **structured cloneable**, meaning they can be:
- Stored in IndexedDB
- Transferred via `postMessage()`
- Serialized across sessions

**Critical**: Handles are NOT JSON-serializable. They use the browser's internal structured clone algorithm.

### Storage Pattern with IndexedDB

```typescript
// Using raw IndexedDB (as in browser.ts)
class HandleStorage {
  private db: IDBDatabase | null = null
  private readonly DB_NAME = 'literoom-fs'
  private readonly STORE_NAME = 'handles'

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME)
        }
      }
    })
  }

  async saveHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.put(handle, key) // Handle serialized automatically
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  }
}
```

### Using idb-keyval (Simpler Alternative)

```typescript
import { get, set, del, keys } from 'idb-keyval'
import { createStore } from 'idb-keyval'

// Create a custom store for handles
const handleStore = createStore('literoom-handles', 'handles')

// Save a handle
async function saveFolderHandle(catalogId: string, handle: FileSystemDirectoryHandle) {
  await set(catalogId, handle, handleStore)
}

// Load a handle
async function loadFolderHandle(catalogId: string): Promise<FileSystemDirectoryHandle | null> {
  return (await get(catalogId, handleStore)) ?? null
}

// List all saved catalogs
async function listSavedCatalogs(): Promise<string[]> {
  return await keys(handleStore) as string[]
}
```

### Existing Implementation in Literoom

The `BrowserFileSystemProvider` in `/packages/core/src/filesystem/browser.ts` already implements handle persistence:

```typescript
// Already implemented in browser.ts
async saveHandle(key: string, handle: DirectoryHandle): Promise<void>
async loadHandle(key: string): Promise<DirectoryHandle | null>
async removeHandle(key: string): Promise<void>
async listSavedHandles(): Promise<string[]>
```

**Recommendation**: Use the existing `FileSystemProvider` abstraction. It wraps native handles in our `DirectoryHandle` type and handles IndexedDB serialization.

---

## 2. Permission Checking

### Permission States

When checking or requesting permission, the API returns one of three states:

| State | Meaning |
|-------|---------|
| `'granted'` | Access is already permitted |
| `'prompt'` | User will be prompted if access is attempted |
| `'denied'` | User explicitly denied access |

### queryPermission vs requestPermission

```typescript
// queryPermission: Check without prompting
const state = await handle.queryPermission({ mode: 'read' }) // or 'readwrite'

// requestPermission: Check and prompt if needed (requires user gesture)
const state = await handle.requestPermission({ mode: 'read' })
```

### Handle Retrieved from IndexedDB

**Critical Behavior**: A handle retrieved from IndexedDB will typically return `'prompt'` for `queryPermission()`, even if the user previously granted access.

```typescript
async function checkPersistedHandle(
  handle: FileSystemDirectoryHandle
): Promise<{ available: boolean; needsReauth: boolean }> {
  try {
    const permission = await handle.queryPermission({ mode: 'read' })

    if (permission === 'granted') {
      return { available: true, needsReauth: false }
    }

    if (permission === 'prompt') {
      // Handle exists but needs re-authorization
      return { available: true, needsReauth: true }
    }

    // 'denied' - user explicitly blocked this
    return { available: false, needsReauth: false }
  } catch (error) {
    // Handle is invalid or folder was deleted
    return { available: false, needsReauth: false }
  }
}
```

### Detecting Stale/Invalid Handles

A handle can become invalid if:
- The folder was deleted
- The folder was moved or renamed
- Browser storage was cleared
- The browser crashed during serialization

```typescript
async function isHandleValid(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // Attempting to query permission validates the handle exists
    await handle.queryPermission({ mode: 'read' })
    return true
  } catch (error) {
    if (error instanceof DOMException) {
      // NotFoundError: folder deleted/moved
      // InvalidStateError: handle corrupted
      return false
    }
    throw error
  }
}
```

### Full Permission Verification Flow

```typescript
interface PermissionCheckResult {
  status: 'granted' | 'needs_prompt' | 'denied' | 'invalid'
  handle: FileSystemDirectoryHandle | null
  folderName: string | null
}

async function verifyStoredHandle(key: string): Promise<PermissionCheckResult> {
  // 1. Load handle from IndexedDB
  const handle = await loadFolderHandle(key)

  if (!handle) {
    return { status: 'invalid', handle: null, folderName: null }
  }

  // 2. Check if handle is still valid
  try {
    const permission = await handle.queryPermission({ mode: 'read' })

    return {
      status: permission === 'granted'
        ? 'granted'
        : permission === 'prompt'
          ? 'needs_prompt'
          : 'denied',
      handle,
      folderName: handle.name
    }
  } catch (error) {
    // Handle is invalid (folder deleted/moved)
    return { status: 'invalid', handle: null, folderName: null }
  }
}
```

---

## 3. Permission Request Flow

### User Gesture Requirement

**Critical**: `requestPermission()` must be called from a user gesture (click, keypress, etc.). It will fail or be ignored if called automatically on page load.

```typescript
// BAD: Will fail - no user gesture
window.addEventListener('load', async () => {
  const handle = await loadFolderHandle('catalog-1')
  await handle.requestPermission({ mode: 'read' }) // FAILS
})

// GOOD: Triggered by user click
button.addEventListener('click', async () => {
  const handle = await loadFolderHandle('catalog-1')
  await handle.requestPermission({ mode: 'read' }) // WORKS
})
```

### Recommended App Startup Flow

```typescript
interface CatalogStatus {
  id: string
  name: string
  folderName: string
  status: 'ready' | 'needs_auth' | 'missing'
}

async function initializeCatalogs(): Promise<CatalogStatus[]> {
  const results: CatalogStatus[] = []
  const savedKeys = await listSavedCatalogs()

  for (const key of savedKeys) {
    const check = await verifyStoredHandle(key)

    results.push({
      id: key,
      name: getCatalogName(key), // from separate metadata
      folderName: check.folderName ?? 'Unknown',
      status: check.status === 'granted'
        ? 'ready'
        : check.status === 'needs_prompt'
          ? 'needs_auth'
          : 'missing'
    })
  }

  return results
}
```

### UX Best Practices

1. **Show status on load**: Indicate which catalogs need re-authorization
2. **Provide clear CTA**: "Re-authorize" button per catalog
3. **Explain why**: Brief text about browser security requiring re-confirmation
4. **Don't auto-prompt**: Wait for explicit user action
5. **Handle denial gracefully**: Offer to remove unavailable catalogs

---

## 4. Recovery UI Patterns

### Pattern A: Inline Re-Authorization

Best for: Apps with a catalog/project list view

```vue
<template>
  <div class="catalog-list">
    <div v-for="catalog in catalogs" :key="catalog.id" class="catalog-item">
      <div class="catalog-info">
        <h3>{{ catalog.name }}</h3>
        <p class="folder-path">{{ catalog.folderName }}</p>
      </div>

      <div class="catalog-actions">
        <!-- Ready to open -->
        <button v-if="catalog.status === 'ready'" @click="openCatalog(catalog.id)">
          Open
        </button>

        <!-- Needs re-authorization -->
        <div v-else-if="catalog.status === 'needs_auth'" class="needs-auth">
          <span class="warning-icon">!</span>
          <span>Access expired</span>
          <button @click="reauthorize(catalog.id)" class="primary">
            Re-authorize
          </button>
        </div>

        <!-- Folder missing/moved -->
        <div v-else-if="catalog.status === 'missing'" class="missing">
          <span class="error-icon">X</span>
          <span>Folder unavailable</span>
          <button @click="relocateCatalog(catalog.id)">
            Locate Folder
          </button>
          <button @click="removeCatalog(catalog.id)" class="danger">
            Remove
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
async function reauthorize(catalogId: string) {
  const handle = await loadFolderHandle(catalogId)
  if (!handle) return

  try {
    const permission = await handle.requestPermission({ mode: 'read' })
    if (permission === 'granted') {
      // Update status and open catalog
      await openCatalog(catalogId)
    } else {
      // Show "access denied" message
      showNotification('Permission denied. Please try again or remove this catalog.')
    }
  } catch (error) {
    showNotification('Could not request permission. Please try again.')
  }
}

async function relocateCatalog(catalogId: string) {
  // Open folder picker to select new location
  const newHandle = await window.showDirectoryPicker({ mode: 'read' })

  // Optionally verify it's the same folder by checking files
  // Or just trust the user's selection

  await saveFolderHandle(catalogId, newHandle)
  await refreshCatalogList()
}
</script>
```

### Pattern B: Modal Recovery Dialog

Best for: Single-catalog apps or blocking operations

```vue
<template>
  <dialog ref="recoveryDialog" class="recovery-modal">
    <h2>Folder Access Required</h2>
    <p>
      Your browser requires re-authorization to access your photos folder.
      This is a security feature to protect your files.
    </p>

    <div class="folder-info">
      <FolderIcon />
      <span>{{ folderName }}</span>
    </div>

    <div class="actions">
      <button @click="cancel" class="secondary">Cancel</button>
      <button @click="requestAccess" class="primary">
        Grant Access
      </button>
    </div>

    <p class="hint">
      Tip: Install this app to your home screen for automatic access.
    </p>
  </dialog>
</template>
```

### Pattern C: Toast/Banner Notification

Best for: Non-blocking awareness

```vue
<template>
  <div v-if="needsReauth" class="permission-banner">
    <p>
      <WarningIcon />
      Some catalogs need re-authorization.
      <button @click="showRecoveryUI">Review</button>
    </p>
  </div>
</template>
```

### Recommended UI Text Patterns

| Situation | Title | Message |
|-----------|-------|---------|
| Needs re-auth | "Access Required" | "Click to re-authorize access to your photos folder" |
| Folder missing | "Folder Not Found" | "The folder may have been moved or deleted" |
| Permission denied | "Access Denied" | "You denied access. You can re-authorize from settings" |
| Relocate needed | "Locate Folder" | "Select the new location of your photos folder" |

---

## 5. Edge Cases

### Folder Moved or Renamed

**Detection**: The handle's `name` property still reflects the original name at serialization time. However, operations on the handle may fail with `NotFoundError`.

```typescript
async function detectFolderMoved(
  handle: FileSystemDirectoryHandle,
  expectedName: string
): Promise<'ok' | 'renamed' | 'missing'> {
  try {
    // Try to iterate the directory
    const entries = handle.values()
    await entries.next() // Will throw if folder is gone

    // Check if name changed (not always reliable)
    if (handle.name !== expectedName) {
      return 'renamed'
    }

    return 'ok'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return 'missing'
    }
    throw error
  }
}
```

**Recovery Options**:
1. **Prompt to relocate**: Show folder picker to select new location
2. **Clear and re-add**: Remove catalog, let user add it fresh
3. **Store folder path hint**: Show last known path to help user find it

### Folder Deleted

Same detection as "moved" - operations fail with `NotFoundError`.

```typescript
async function handleDeletedFolder(catalogId: string) {
  // Option 1: Mark as unavailable, keep metadata
  await updateCatalogStatus(catalogId, 'unavailable')

  // Option 2: Remove entirely
  await removeCatalog(catalogId)

  // Option 3: Prompt user
  const action = await showDialog({
    title: 'Folder Not Found',
    message: 'The photos folder for this catalog cannot be found.',
    options: ['Remove Catalog', 'Try Locating', 'Keep Anyway']
  })
}
```

### Offline Scenarios

The File System Access API requires an active browser context but works offline. Key considerations:

1. **IndexedDB works offline**: Handle retrieval succeeds
2. **Permission checks work offline**: `queryPermission()` succeeds
3. **File operations work offline**: Reading local files succeeds
4. **Folder picker works offline**: User can select folders

**No special offline handling needed** for permission recovery.

### Browser Storage Cleared

When the user clears browsing data:
- All IndexedDB data is deleted (including handles)
- No handles remain to re-prompt for permission
- App should detect empty state and show onboarding

```typescript
async function checkFirstRun(): Promise<boolean> {
  const handles = await listSavedCatalogs()
  return handles.length === 0
}
```

### Tab/Window Closed During Permission Prompt

If the tab closes during `requestPermission()`:
- The promise never resolves
- No side effects occur
- User must re-trigger the flow

**Recommendation**: Show visual feedback ("Waiting for permission...") so users know the operation is in progress.

### Multiple Tabs

Each tab can independently:
- Load handles from IndexedDB
- Request permission (all tabs see the same permission state)
- Lose permission if user revokes in another context

**Recommendation**: Consider using `BroadcastChannel` to sync permission state changes across tabs.

```typescript
const permissionChannel = new BroadcastChannel('literoom-permissions')

// When permission changes
permissionChannel.postMessage({
  type: 'permission_changed',
  catalogId: 'catalog-1',
  status: 'granted'
})

// Listen for changes
permissionChannel.onmessage = (event) => {
  if (event.data.type === 'permission_changed') {
    refreshCatalogStatus(event.data.catalogId)
  }
}
```

---

## 6. Browser Support and Differences

### Browser Compatibility Matrix

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| `showDirectoryPicker()` | 86+ | 86+ | No | No |
| `queryPermission()` | 86+ | 86+ | No | No |
| `requestPermission()` | 86+ | 86+ | No | No |
| IndexedDB handle storage | 86+ | 86+ | No | No |
| Persistent permissions | 122+ | 122+ | No | No |

### Chrome 122+ Persistent Permissions

Chrome 122 introduces a three-way permission prompt:
1. **Allow this time**: Session-only access (existing behavior)
2. **Allow on every visit**: Persistent access without re-prompts
3. **Don't allow**: Deny access

**Requirements for persistent permissions**:
- User must have installed the app as a PWA, OR
- User explicitly selects "Allow on every visit"

```typescript
// No code changes needed - browser handles this automatically
// Just call requestPermission() as usual
const permission = await handle.requestPermission({ mode: 'read' })
```

### Chrome vs Edge Differences

Edge follows Chrome's implementation closely since both use Chromium. Minor differences:
- Edge may show slightly different permission dialogs
- Edge has its own PWA installation flow
- Both support persistent permissions from version 122+

### Firefox and Safari

These browsers do **not support** the File System Access API for local directories:
- Firefox: Only supports Origin Private File System (OPFS)
- Safari: Only supports OPFS, partial File API support

**Literoom Strategy** (from spec):
> "App may run without persistent folder access on Safari/Firefox, but persistent access is a key requirement; fallback can be explicitly limited or placed behind a 'limited support' warning."

```typescript
// Feature detection
function isFullFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window &&
         'FileSystemDirectoryHandle' in window
}

// Show warning for unsupported browsers
if (!isFullFileSystemAccessSupported()) {
  showUnsupportedBrowserWarning()
}
```

### Brave Browser

Brave supports the File System Access API but has it **disabled by default** behind a flag:
- `chrome://flags/#file-system-access-api`
- Users must manually enable it

**Recommendation**: Detect Brave and show specific instructions:

```typescript
function isBrave(): boolean {
  return 'brave' in navigator
}

if (isBrave() && !isFullFileSystemAccessSupported()) {
  showBraveInstructions()
}
```

---

## 7. Integration with Literoom's Existing Code

### Using FileSystemProvider Abstraction

The existing `BrowserFileSystemProvider` already handles most persistence needs:

```typescript
import { BrowserFileSystemProvider } from '@literoom/core/filesystem'

const fs = new BrowserFileSystemProvider()

// Save handle when catalog is created
async function createCatalog(name: string) {
  const handle = await fs.selectDirectory()
  await fs.saveHandle(`catalog:${name}`, handle)
  return handle
}

// Load and verify on startup
async function loadCatalog(name: string) {
  const handle = await fs.loadHandle(`catalog:${name}`)
  if (!handle) {
    throw new Error('Catalog not found')
  }

  const permission = await fs.queryPermission(handle, 'read')
  if (permission === 'granted') {
    return handle
  }

  // Needs re-authorization
  return { handle, needsAuth: true }
}
```

### Extending for Permission Recovery

Add a dedicated permission recovery service:

```typescript
// packages/core/src/catalog/permission-recovery.ts

export interface CatalogPermissionStatus {
  catalogId: string
  folderName: string
  status: 'ready' | 'needs_auth' | 'unavailable'
}

export class PermissionRecoveryService {
  constructor(private fs: FileSystemProvider) {}

  async checkAllCatalogs(): Promise<CatalogPermissionStatus[]> {
    const results: CatalogPermissionStatus[] = []
    const keys = await this.fs.listSavedHandles()

    for (const key of keys) {
      if (!key.startsWith('catalog:')) continue

      const handle = await this.fs.loadHandle(key)
      if (!handle) {
        results.push({
          catalogId: key,
          folderName: 'Unknown',
          status: 'unavailable'
        })
        continue
      }

      const permission = await this.fs.queryPermission(handle, 'read')
      results.push({
        catalogId: key,
        folderName: handle.name,
        status: permission === 'granted' ? 'ready' : 'needs_auth'
      })
    }

    return results
  }

  async requestReauthorization(catalogId: string): Promise<boolean> {
    const handle = await this.fs.loadHandle(catalogId)
    if (!handle) return false

    const permission = await this.fs.requestPermission(handle, 'read')
    return permission === 'granted'
  }
}
```

---

## 8. Recommendations for Literoom

### Immediate Actions

1. **Use existing `BrowserFileSystemProvider`** for all handle persistence
2. **Add permission check on app startup** before auto-opening catalogs
3. **Show recovery UI** when permissions need re-authorization
4. **Detect invalid handles** and offer to remove or relocate

### UI/UX Guidelines

1. **Don't auto-prompt** - always require user gesture
2. **Explain security benefit** - "Your browser protects your files"
3. **Show folder name** - helps user confirm they're authorizing the right folder
4. **Offer removal option** - for folders that no longer exist
5. **PWA prompt** - suggest installing for persistent access (Chrome 122+)

### Error Handling Priorities

| Error | Priority | Action |
|-------|----------|--------|
| Permission denied | High | Show re-auth button |
| Folder not found | High | Show relocate/remove options |
| Handle invalid | Medium | Remove from storage, re-onboard |
| Storage cleared | Low | Detect first-run state |

### Code Organization

```
packages/core/src/
  catalog/
    permission-recovery.ts    # Permission checking service
    catalog-manager.ts        # Catalog CRUD with permission awareness
  filesystem/
    browser.ts               # Existing - handle persistence
    types.ts                 # Existing - permission types

apps/web/
  components/
    catalog/
      CatalogList.vue         # List with status indicators
      PermissionBanner.vue    # Non-blocking notification
      RecoveryModal.vue       # Blocking recovery dialog
  composables/
    useCatalogPermissions.ts  # Reactive permission state
```

---

## Sources

- [Chrome Developers: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome Developers: Persistent Permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [MDN: FileSystemHandle.queryPermission()](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission)
- [MDN: FileSystemHandle.isSameEntry()](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/isSameEntry)
- [MDN: File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- [WICG File System Access Spec](https://wicg.github.io/file-system-access/)
- [Can I Use: File System Access API](https://caniuse.com/native-filesystem-api)
- [idb-keyval Library](https://github.com/jakearchibald/idb-keyval)
- [Transloadit: Persistent File Handling](https://transloadit.com/devtips/persistent-file-handling-with-the-file-system-access-api/)
