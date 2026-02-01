# Delete Photos from Grid - Research Synthesis

**Date**: 2026-01-31
**Issue**: Delete key doesn't delete photos from grid

## Executive Summary

The Delete key handler infrastructure already exists in `useGridKeyboard.ts` but is not wired up because:
1. No `onDelete` callback is passed from `CatalogGrid.vue`
2. No asset removal methods exist in catalog store or CatalogService
3. No confirmation dialog pattern exists for destructive actions

This document synthesizes research from 5 parallel investigations to create a complete implementation plan.

## Key Findings

### 1. Keyboard Handler Already Exists

**File**: `apps/web/app/composables/useGridKeyboard.ts` (lines 318-323)

```typescript
// Delete shortcut - ALREADY IMPLEMENTED
if (onDelete && (key === 'delete' || key === 'backspace')) {
  event.preventDefault()
  onDelete()
  return
}
```

The interface already defines `onDelete?: () => void` (line 45), but `CatalogGrid.vue` doesn't pass this callback.

### 2. No Asset Removal Methods Exist

**Catalog Store** (`apps/web/app/stores/catalog.ts`):
- `addAssetBatch()` exists (lines 176-196)
- `updateAsset()` exists (lines 201-209)
- `setFlagBatch()` exists (lines 284-295)
- `clear()` exists - clears ALL assets (lines 347-364)
- **NO `removeAsset()` or `removeAssetBatch()` methods**

**CatalogService** (`packages/core/src/catalog/catalog-service.ts`):
- Similar pattern - add/update but no remove methods
- Database layer (`db.ts`) has no delete operations for assets

### 3. Multi-Selection Pattern Established

**Selection Store** (`apps/web/app/stores/selection.ts`):
- `selectedIds: shallowRef<Set<string>>` tracks multiple selections
- `selectedIdsArray: computed(() => Array.from(selectedIds.value))` for batch operations

**Batch Operation Pattern** (from `setFlagBatch`):
```typescript
if (selectedIds.size > 0) {
  await service.setFlagBatch([...selectedIds], flag)
} else if (currentId) {
  await service.setFlag(currentId, flag)
}
```

### 4. Confirmation Modal Pattern

The codebase uses **Pinia stores** with **UModal** for confirmations:

**PermissionRecovery.vue** is the closest pattern:
- `dismissible="false"` for critical actions
- Store manages `showModal` state
- Emits events for different actions

**No generic confirmation dialog utility exists** - each use case has its own modal.

### 5. Mask Delete Handler (Working Example)

**File**: `apps/web/app/composables/useMaskOverlay.ts` (lines 642-651)

```typescript
if ((e.key === 'Delete' || e.key === 'Backspace') && editStore.selectedMaskId) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  editStore.deleteMask(editStore.selectedMaskId)
  render()
  e.preventDefault()
}
```

**Key observation**: Mask deletion has **NO confirmation** - it's immediate.

## Design Decisions

### Decision 1: Confirmation Required for Photo Deletion

Unlike mask deletion, photo deletion should have confirmation because:
- Photos are primary content, not metadata
- Deletion affects underlying files (in real mode)
- Batch deletion of multiple photos is high-impact
- Matches Lightroom's behavior (confirmation for removal)

### Decision 2: "Remove from Catalog" vs "Delete from Disk"

For V1, implement **"Remove from Catalog" only**:
- Removes asset from catalog database and memory
- Does NOT delete the actual file from disk
- User can re-scan folder to recover photos
- Lower risk, simpler implementation

Future enhancement: Add "Delete from Disk" option with additional confirmation.

### Decision 3: Toast vs Modal

Use **Modal** because:
- Shows count of photos to be deleted
- Allows cancel
- Matches critical action pattern (PermissionRecovery)
- Can show photo names for small selections

### Decision 4: Demo Mode Behavior

In demo mode:
- Assets are removed from catalog store (memory only)
- No database operations (demo has no persistence)
- Toast shows success message

## Implementation Architecture

### Layer 1: Delete Confirmation Store

```typescript
// apps/web/app/stores/deleteConfirmation.ts
defineStore('deleteConfirmation', () => {
  const isModalOpen = ref(false)
  const pendingAssetIds = ref<string[]>([])

  function requestDelete(assetIds: string[]) {
    pendingAssetIds.value = assetIds
    isModalOpen.value = true
  }

  function confirmDelete() { /* emit to handler */ }
  function cancelDelete() { isModalOpen.value = false }
})
```

### Layer 2: Delete Confirmation Modal Component

```vue
<!-- apps/web/app/components/catalog/DeleteConfirmationModal.vue -->
<UModal v-model:open="store.isModalOpen" :dismissible="true">
  <template #header>Remove from Catalog</template>
  <template #body>
    Remove {{ count }} photo(s) from catalog?
    This will not delete files from disk.
  </template>
  <template #footer>
    <UButton @click="cancel">Cancel</UButton>
    <UButton color="error" @click="confirm">Remove</UButton>
  </template>
</UModal>
```

### Layer 3: Catalog Store - removeAssetBatch

```typescript
// apps/web/app/stores/catalog.ts
function removeAssetBatch(assetIds: string[]): void {
  if (assetIds.length === 0) return

  const idsToRemove = new Set(assetIds)

  // Revoke URLs before removal
  for (const id of assetIds) {
    const asset = assets.value.get(id)
    if (asset?.thumbnailUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(asset.thumbnailUrl)
    }
    if (asset?.preview1xUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(asset.preview1xUrl)
    }
  }

  // Remove from Map
  const newAssets = new Map(assets.value)
  for (const id of assetIds) {
    newAssets.delete(id)
  }
  assets.value = newAssets

  // Remove from ordered array
  assetIds.value = assetIds.value.filter(id => !idsToRemove.has(id))
}
```

### Layer 4: CatalogService - removeAssets

```typescript
// packages/core/src/catalog/catalog-service.ts
async removeAssets(assetIds: string[]): Promise<void> {
  // Remove from database
  await this._db.removeAssets(assetIds)

  // Remove from memory
  for (const id of assetIds) {
    this._assets.delete(id)
  }
}
```

### Layer 5: Database Layer

```typescript
// packages/core/src/catalog/db.ts
async removeAssets(uuids: string[]): Promise<void> {
  await db.transaction('rw', db.assets, db.editStates, async () => {
    // Delete asset records
    await db.assets.where('uuid').anyOf(uuids).delete()
    // Delete associated edit states
    await db.editStates.where('assetId').anyOf(uuids).delete()
  })
}
```

### Layer 6: CatalogGrid Integration

```typescript
// apps/web/app/components/catalog/CatalogGrid.vue
const { handleKeydown } = useGridKeyboard({
  // ... existing options
  onDelete: () => {
    const toDelete = selectionStore.selectedIds.size > 0
      ? [...selectionStore.selectedIds]
      : selectionStore.currentId ? [selectionStore.currentId] : []

    if (toDelete.length > 0) {
      deleteConfirmationStore.requestDelete(toDelete)
    }
  }
})
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `stores/deleteConfirmation.ts` | CREATE | Modal state management |
| `components/catalog/DeleteConfirmationModal.vue` | CREATE | Confirmation UI |
| `stores/catalog.ts` | MODIFY | Add `removeAssetBatch()` |
| `catalog/catalog-service.ts` | MODIFY | Add `removeAssets()` |
| `catalog/mock-catalog-service.ts` | MODIFY | Add mock `removeAssets()` |
| `catalog/types.ts` | MODIFY | Add `removeAssets` to interface |
| `catalog/db.ts` | MODIFY | Add `removeAssets()` |
| `components/catalog/CatalogGrid.vue` | MODIFY | Wire up `onDelete` callback |
| `pages/index.vue` | MODIFY | Mount DeleteConfirmationModal |
| `composables/useCatalog.ts` | MODIFY | Add `deleteAssets()` function |

## Test Plan

1. **Unit Tests**:
   - `deleteConfirmation` store tests
   - `removeAssetBatch` catalog store tests
   - Database `removeAssets` tests

2. **Integration Tests**:
   - Delete single photo with confirmation
   - Delete multiple selected photos
   - Cancel deletion
   - Verify asset counts update
   - Verify selection clears after delete

3. **Edge Cases**:
   - Delete when no selection (should do nothing)
   - Delete in demo mode
   - Delete all photos in catalog
   - Delete while filtering (picks/rejects view)

## References

- Keyboard handler: `useGridKeyboard.ts:318-323`
- Selection store: `selection.ts:29, 58`
- Batch operation pattern: `catalog.ts:284-295`
- Modal pattern: `PermissionRecovery.vue`
- Working delete example: `useMaskOverlay.ts:642-651`
