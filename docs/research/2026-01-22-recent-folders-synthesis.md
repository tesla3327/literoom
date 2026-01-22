# Recent Folders Feature - Research Synthesis

**Date**: 2026-01-22
**Objective**: Address the "Previously opened folder auto-loads unexpectedly" issue by implementing a recent folders feature

## Executive Summary

The app automatically restores the previous folder when users click "Select Folder" or navigate to the edit page. This is unexpected UX - users expect clicking "Select Folder" to open a folder picker. The solution is to implement a Recent Folders dropdown that gives users explicit control over which folder to open.

## Current Architecture

### Folder Persistence Flow

```
User selects folder → showDirectoryPicker() → FileSystemDirectoryHandle
                                                     ↓
                            Persist to IndexedDB ('literoom-fs' database, 'handles' store)
                                                     ↓
                            Create FolderRecord in Dexie DB (LiteroomCatalog, folders table)
                                                     ↓
Next session load → loadFromDatabase() → Load first folder from DB
                                           ↓
                        Restore handle from IndexedDB → Check permission
                                                          ↓
                        If granted → Restore catalog silently (THE UNEXPECTED BEHAVIOR)
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/catalog/catalog-service.ts` | Core service: `loadFromDatabase()`, `selectFolder()`, `persistHandle()` |
| `packages/core/src/catalog/db.ts` | Dexie schema for `folders` and `assets` tables |
| `apps/web/app/plugins/catalog.client.ts` | Provides `$initializeCatalog()` which calls `loadFromDatabase()` |
| `apps/web/app/middleware/ensure-catalog.ts` | Triggers auto-restore before edit page loads |
| `apps/web/app/composables/useCatalog.ts` | Composable with `selectFolder()` and `restoreSession()` |

### Database Schema

```typescript
// FolderRecord in db.ts
interface FolderRecord {
  id?: number
  path: string            // Folder name (used as unique identifier)
  name: string            // Display name
  handleKey: string       // Key for handle persistence: 'literoom-folder-{name}-{timestamp}'
  lastScanDate: Date      // When folder was last accessed
}
```

### Where Auto-Load Happens

1. **Edit page direct navigation** (`ensure-catalog.ts` middleware)
   - Calls `$initializeCatalog()` → `loadFromDatabase()`

2. **Home page mount** (`index.vue`)
   - Calls `restoreSession()` → `loadFromDatabase()`

Both paths silently restore the first folder from the database without user consent.

## Problem Analysis

### User Expectations vs Current Behavior

| Action | User Expects | Current Behavior |
|--------|--------------|------------------|
| Click "Select Folder" | File picker opens | Previous folder auto-loads |
| Navigate to `/edit/[id]` | Either error or prompt | Previous folder auto-loads |
| Fresh app load | Welcome screen | If folder permission valid, auto-loads |

### Root Cause

The `loadFromDatabase()` method in `CatalogService` always loads `folders[0]` - the first folder in the database. This is called automatically during:
1. Middleware execution (edit page)
2. Home page mount
3. Any initialization that checks for existing catalog data

## Proposed Solution: Recent Folders Dropdown

Replace the simple "Select Folder" button with a dropdown that shows:
1. **Recent folders** (from IndexedDB) - Click to open
2. **"Choose New Folder..."** option - Opens file picker
3. **Clear indicator** of which action will be taken

### UI Design Options

**Option A: Split Button** (Recommended)
```
┌─────────────────────────────────┬─────┐
│ ▼ Photos (current folder)       │  +  │
└─────────────────────────────────┴─────┘
                │                     │
      Recent Folders List        New Folder
```

**Option B: Unified Dropdown**
```
┌─────────────────────────────────────┐
│ ▼ Photos (current folder)           │
└─────────────────────────────────────┘
                │
   ┌────────────────────────────┐
   │ 📁 Wedding Photos          │
   │ 📁 Portfolio               │
   │ 📁 Archive/2024            │
   ├────────────────────────────┤
   │ + Choose New Folder...     │
   └────────────────────────────┘
```

### Architecture Changes

1. **New Composable: `useRecentFolders.ts`**
   - `recentFolders: Ref<FolderRecord[]>` - List of folders from DB
   - `loadRecentFolders(limit = 5)` - Query DB for recent folders
   - `openRecentFolder(folder)` - Restore specific folder with permission handling
   - `removeFromRecent(folder)` - Remove folder from list

2. **Enhanced CatalogService**
   - `listFolders(limit?: number)` - Get folders ordered by `lastScanDate`
   - `loadFolderById(folderId: number)` - Load specific folder (not just first)
   - Update `lastScanDate` when folder is accessed

3. **New Component: `RecentFoldersDropdown.vue`**
   - Uses Nuxt UI `UDropdownMenu` component
   - Shows recent folders with name and path
   - "Choose New Folder" action at bottom
   - Handles unavailable folders (permission denied)

4. **Behavior Changes**
   - **Remove auto-restore on "Select Folder" click** - Always show picker OR dropdown
   - **Edit page middleware** - Still auto-restore, but show modal if permission denied
   - **Home page** - Show welcome OR recent folders list (not auto-restore)

## Implementation Phases

### Phase 1: Service Layer Enhancements
- Add `listFolders()` method to `CatalogService`
- Add `loadFolderById(id)` method to `CatalogService`
- Update `lastScanDate` when folder is accessed
- Export methods via `ICatalogService` interface

### Phase 2: Composable Creation
- Create `useRecentFolders.ts` composable
- Implement `loadRecentFolders()` with Dexie query
- Implement `openRecentFolder()` with permission handling
- Wire up to catalog store

### Phase 3: UI Component
- Create `RecentFoldersDropdown.vue` component
- Replace folder button in `index.vue` header
- Style to match existing dark theme
- Handle loading/error states

### Phase 4: Behavior Updates
- Modify `selectFolder()` to NOT auto-restore
- Update welcome screen to show recent folders if available
- Show permission recovery for unavailable folders
- Test all navigation paths

### Phase 5: Testing & Polish
- Unit tests for new service methods
- E2E tests for folder selection flows
- Test with 0, 1, 5, 10+ folders
- Test permission denial → recovery flow

## Key Decisions

### Keep vs Remove Auto-Restore

| Scenario | Recommendation |
|----------|----------------|
| Edit page direct navigation | **Keep** - User expects to see their photo |
| Home page fresh load | **Change** - Show welcome with recent folders list |
| Click "Select Folder" | **Change** - Show dropdown, not auto-load |

### Recent Folders Limit

- **Recommended: 5 folders**
- More than 5 becomes unwieldy in dropdown
- Users typically work with 2-3 active projects

### Permission Handling

When folder permission is denied:
1. Show folder grayed out in list with "Unavailable" badge
2. Click shows option to re-authorize or remove
3. Don't silently fail - give user clear feedback

## Success Criteria

1. **Clicking folder button shows dropdown** - Not auto-loading previous folder
2. **Recent folders visible** - Users see their project history
3. **Easy to select new folder** - Clear "Choose New Folder" option
4. **Permission issues visible** - Unavailable folders clearly marked
5. **Edit page navigation still works** - Auto-restore for deep links

## Files to Create

- `apps/web/app/composables/useRecentFolders.ts`
- `apps/web/app/components/catalog/RecentFoldersDropdown.vue`

## Files to Modify

- `packages/core/src/catalog/catalog-service.ts` - Add `listFolders()`, `loadFolderById()`
- `packages/core/src/catalog/types.ts` - Update `ICatalogService` interface
- `apps/web/app/pages/index.vue` - Replace folder button, update welcome screen
- `apps/web/app/composables/useCatalog.ts` - Modify `selectFolder()` behavior

## References

- Nuxt UI UDropdownMenu: Used in FilterBar.vue for sort options
- Permission Recovery pattern: `components/catalog/PermissionRecovery.vue`
- Folder persistence: `catalog-service.ts` lines 211-237
