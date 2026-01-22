# Recent Folders Feature - Implementation Plan

**Date**: 2026-01-22
**Research**: `docs/research/2026-01-22-recent-folders-synthesis.md`
**Issue**: Previously opened folder auto-loads unexpectedly (Medium)

## Summary

Implement a Recent Folders dropdown to replace the simple "Select Folder" button. This gives users explicit control over which folder to open, rather than auto-loading the previous folder.

## Phase 1: Service Layer Enhancements (30 min)

**Goal**: Add methods to query and load specific folders from the database.

### 1.1 Update CatalogService

**File**: `packages/core/src/catalog/catalog-service.ts`

Add methods:
```typescript
async listFolders(limit: number = 5): Promise<FolderRecord[]> {
  // Query folders ordered by lastScanDate descending
  // Return up to `limit` folders
}

async loadFolderById(folderId: number): Promise<void> {
  // Load specific folder from DB (not just folders[0])
  // Similar to loadFromDatabase() but with specific ID
}
```

Update existing:
- `loadFromDatabase()` - Should call `loadFolderById()` for first folder
- After successful scan, update `lastScanDate` to current timestamp

### 1.2 Update Interface

**File**: `packages/core/src/catalog/types.ts`

Add to `ICatalogService`:
```typescript
listFolders(limit?: number): Promise<FolderRecord[]>
loadFolderById(folderId: number): Promise<void>
```

### 1.3 Update MockCatalogService

**File**: `packages/core/src/catalog/mock-catalog-service.ts`

Add mock implementations:
```typescript
async listFolders(limit = 5): Promise<FolderRecord[]> {
  return [] // Demo mode has no persisted folders
}

async loadFolderById(folderId: number): Promise<void> {
  // No-op for demo mode
}
```

---

## Phase 2: Create useRecentFolders Composable (45 min)

**Goal**: Create a composable that manages recent folders state and actions.

### 2.1 Create Composable

**File**: `apps/web/app/composables/useRecentFolders.ts`

```typescript
export function useRecentFolders() {
  const catalogService = useCatalogService()
  const { selectFolder } = useCatalog()

  const recentFolders = ref<FolderRecord[]>([])
  const isLoading = ref(false)
  const isLoadingFolder = ref<number | null>(null) // ID of folder being loaded

  // Load recent folders from DB
  async function loadRecentFolders(limit = 5): Promise<void>

  // Open a specific recent folder
  async function openRecentFolder(folder: FolderRecord): Promise<boolean>

  // Remove a folder from the list (and DB)
  async function removeFromRecent(folder: FolderRecord): Promise<void>

  // Open new folder picker
  async function openNewFolder(): Promise<boolean>

  // Check if folder handle is valid/accessible
  async function checkFolderAccess(folder: FolderRecord): Promise<boolean>

  return {
    recentFolders,
    isLoading,
    isLoadingFolder,
    loadRecentFolders,
    openRecentFolder,
    removeFromRecent,
    openNewFolder,
    checkFolderAccess
  }
}
```

### 2.2 Permission Handling

The composable should handle permission states:
1. Permission granted → Load folder silently
2. Permission prompt needed → Show loading, request permission
3. Permission denied → Show error, offer to re-authorize or remove

---

## Phase 3: Create RecentFoldersDropdown Component (1 hour)

**Goal**: Create the dropdown UI component that displays recent folders.

### 3.1 Create Component

**File**: `apps/web/app/components/catalog/RecentFoldersDropdown.vue`

Features:
- Uses Nuxt UI `UDropdownMenu` component
- Shows current folder name as trigger button
- Dropdown items:
  - List of recent folders (name, path, last accessed)
  - Separator
  - "Choose New Folder..." action
- Loading states (spinner when loading folder)
- Unavailable folder indicator (grayed out with icon)
- Tooltip for full path on truncated names

### 3.2 UI States

```
┌──────────────────────────────────────┐
│ 📁 Wedding Photos ▼                  │  ← Trigger (current folder)
└──────────────────────────────────────┘

Dropdown open:
┌──────────────────────────────────────┐
│ ✓ Wedding Photos (current)           │  ← Disabled, shows current
├──────────────────────────────────────┤
│ 📁 Portfolio                         │  ← Click to switch
│ 📁 Archive/2024                      │  ← Click to switch
│ 🔒 Old Projects                      │  ← Unavailable (permission)
├──────────────────────────────────────┤
│ + Choose New Folder...               │  ← Opens file picker
└──────────────────────────────────────┘
```

### 3.3 Empty State

If no recent folders:
```
┌──────────────────────────────────────┐
│ Select Folder ▼                      │  ← Trigger
└──────────────────────────────────────┘

Dropdown open:
┌──────────────────────────────────────┐
│ + Choose Folder...                   │  ← Opens file picker
└──────────────────────────────────────┘
```

---

## Phase 4: Update Home Page UI (45 min)

**Goal**: Replace folder button and update welcome screen with recent folders.

### 4.1 Update index.vue

**File**: `apps/web/app/pages/index.vue`

Replace the current "Select Folder" button with `RecentFoldersDropdown` component.

### 4.2 Welcome Screen Updates

When no catalog is loaded, show:
1. Welcome message
2. If recent folders exist: List of recent folders as clickable cards
3. "Choose New Folder" button at bottom

```vue
<template>
  <div v-if="!hasAssets">
    <!-- Welcome screen -->
    <div v-if="recentFolders.length > 0">
      <h2>Recent Folders</h2>
      <div class="recent-folder-cards">
        <button v-for="folder in recentFolders" @click="openRecentFolder(folder)">
          {{ folder.name }}
        </button>
      </div>
    </div>
    <button @click="openNewFolder">Choose Folder</button>
  </div>
  <div v-else>
    <!-- Catalog grid with dropdown in header -->
  </div>
</template>
```

### 4.3 Remove Auto-Restore on Home Page

**File**: `apps/web/app/pages/index.vue`

Change `onMounted` behavior:
- DO NOT call `restoreSession()` automatically
- Instead, load recent folders list
- Let user explicitly choose which folder to open

---

## Phase 5: Update Initialization Behavior (30 min)

**Goal**: Modify auto-restore to be user-initiated on home page.

### 5.1 Update useCatalog.ts

**File**: `apps/web/app/composables/useCatalog.ts`

The `restoreSession()` function currently always loads the first folder. This should remain available for deep-link navigation (edit page) but not be called on home page mount.

### 5.2 Keep Edit Page Auto-Restore

**File**: `apps/web/app/middleware/ensure-catalog.ts`

Keep the existing behavior for edit page navigation:
- If navigating to `/edit/[id]` without catalog loaded
- Auto-restore from DB (needed for direct URL access)
- This is expected behavior for deep links

---

## Phase 6: Testing & Polish (30 min)

### 6.1 Unit Tests

**File**: `packages/core/src/catalog/catalog-service.test.ts`

Add tests for:
- `listFolders()` returns folders ordered by lastScanDate
- `listFolders(3)` respects limit
- `loadFolderById()` loads correct folder
- `lastScanDate` updates after scan

### 6.2 Manual Testing

Test scenarios:
1. Fresh install (no folders) → Shows welcome with "Choose Folder"
2. One previous folder → Shows recent folder card + "Choose Folder"
3. Multiple previous folders → Shows list ordered by recency
4. Switch between folders → Correct folder loads
5. Permission denied → Shows error, offers re-authorize
6. Deep link to edit page → Auto-restores correctly

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/app/composables/useRecentFolders.ts` | Composable for recent folders logic |
| `apps/web/app/components/catalog/RecentFoldersDropdown.vue` | Dropdown UI component |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/catalog/catalog-service.ts` | Add `listFolders()`, `loadFolderById()` |
| `packages/core/src/catalog/types.ts` | Update `ICatalogService` interface |
| `packages/core/src/catalog/mock-catalog-service.ts` | Add mock implementations |
| `apps/web/app/pages/index.vue` | Use dropdown, update welcome screen |

## Success Criteria

1. [ ] Clicking folder dropdown shows recent folders list
2. [ ] "Choose New Folder" opens file picker
3. [ ] Clicking recent folder loads that specific folder
4. [ ] Welcome screen shows recent folders if available
5. [ ] Home page does NOT auto-load previous folder
6. [ ] Edit page deep links still work (auto-restore)
7. [ ] Unavailable folders shown with clear indicator
8. [ ] All existing tests pass

## Estimated Effort

| Phase | Time |
|-------|------|
| Phase 1: Service Layer | 30 min |
| Phase 2: Composable | 45 min |
| Phase 3: Dropdown Component | 1 hour |
| Phase 4: Home Page UI | 45 min |
| Phase 5: Initialization | 30 min |
| Phase 6: Testing | 30 min |
| **Total** | **~4 hours** |
