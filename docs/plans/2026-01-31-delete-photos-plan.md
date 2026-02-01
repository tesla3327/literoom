# Delete Photos from Grid - Implementation Plan

**Date**: 2026-01-31
**Issue**: Delete key doesn't delete photos from grid
**Research**: `docs/research/2026-01-31-delete-photos-synthesis.md`

## Overview

Implement Delete/Backspace key functionality to remove selected photos from the catalog with a confirmation dialog.

## Implementation Phases

### Phase 1: Delete Confirmation Store

**File**: `apps/web/app/stores/deleteConfirmation.ts` (NEW)

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useDeleteConfirmationStore = defineStore('deleteConfirmation', () => {
  const isModalOpen = ref(false)
  const pendingAssetIds = ref<string[]>([])

  const pendingCount = computed(() => pendingAssetIds.value.length)

  function requestDelete(assetIds: string[]): void {
    if (assetIds.length === 0) return
    pendingAssetIds.value = [...assetIds]
    isModalOpen.value = true
  }

  function confirmDelete(): void {
    // Will be handled by composable watching this
    isModalOpen.value = false
  }

  function cancelDelete(): void {
    pendingAssetIds.value = []
    isModalOpen.value = false
  }

  function clearPending(): void {
    pendingAssetIds.value = []
  }

  return {
    isModalOpen,
    pendingAssetIds,
    pendingCount,
    requestDelete,
    confirmDelete,
    cancelDelete,
    clearPending,
  }
})
```

### Phase 2: Database Layer

**File**: `packages/core/src/catalog/db.ts` (MODIFY)

Add to CatalogDb class:

```typescript
/**
 * Remove assets and their associated edit states from the database.
 */
async removeAssets(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return

  await this.db.transaction('rw', this.db.assets, this.db.editStates, async () => {
    // Delete asset records by UUID
    await this.db.assets.where('uuid').anyOf(uuids).delete()
    // Delete associated edit states
    await this.db.editStates.where('assetId').anyOf(uuids).delete()
  })
}
```

### Phase 3: CatalogService Interface and Implementation

**File**: `packages/core/src/catalog/types.ts` (MODIFY)

Add to ICatalogService interface:

```typescript
/**
 * Remove assets from the catalog.
 * This removes from database and memory but does NOT delete files from disk.
 */
removeAssets(assetIds: string[]): Promise<void>
```

**File**: `packages/core/src/catalog/catalog-service.ts` (MODIFY)

Add implementation:

```typescript
async removeAssets(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return

  // Remove from database
  await this._db.removeAssets(assetIds)

  // Remove from memory
  for (const id of assetIds) {
    this._assets.delete(id)
  }

  // Notify listeners (thumbnail service etc.)
  // The store will handle URL revocation
}
```

**File**: `packages/core/src/catalog/mock-catalog-service.ts` (MODIFY)

Add mock implementation:

```typescript
async removeAssets(assetIds: string[]): Promise<void> {
  // In demo mode, just remove from memory
  for (const id of assetIds) {
    this._assets.delete(id)
  }
}
```

### Phase 4: Catalog Store

**File**: `apps/web/app/stores/catalog.ts` (MODIFY)

Add removeAssetBatch action:

```typescript
/**
 * Remove assets from the catalog.
 * Revokes blob URLs and removes from both assets Map and assetIds array.
 */
function removeAssetBatch(idsToRemove: string[]): void {
  if (idsToRemove.length === 0) return

  const idsSet = new Set(idsToRemove)

  // Revoke blob URLs before removal
  for (const id of idsToRemove) {
    const asset = assets.value.get(id)
    if (asset) {
      if (asset.thumbnailUrl && asset.thumbnailUrl.startsWith('blob:')) {
        URL.revokeObjectURL(asset.thumbnailUrl)
      }
      if (asset.preview1xUrl && asset.preview1xUrl.startsWith('blob:')) {
        URL.revokeObjectURL(asset.preview1xUrl)
      }
    }
  }

  // Remove from assets Map
  const newAssets = new Map(assets.value)
  for (const id of idsToRemove) {
    newAssets.delete(id)
  }
  assets.value = newAssets

  // Remove from ordered array
  assetIds.value = assetIds.value.filter(id => !idsSet.has(id))
}
```

### Phase 5: useCatalog Composable

**File**: `apps/web/app/composables/useCatalog.ts` (MODIFY)

Add deleteAssets function:

```typescript
/**
 * Delete assets from the catalog.
 * This removes from database and UI but does NOT delete files from disk.
 */
async function deleteAssets(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return

  const service = requireCatalogService()

  // Remove from service (database + memory)
  await service.removeAssets(assetIds)

  // Update store (UI state, revoke URLs)
  catalogStore.removeAssetBatch(assetIds)

  // Clear selection for deleted assets
  const selectionStore = useSelectionStore()
  for (const id of assetIds) {
    if (selectionStore.isSelected(id)) {
      selectionStore.removeFromSelection(id)
    }
    if (selectionStore.currentId === id) {
      selectionStore.setCurrent(null)
    }
  }
}
```

Export from composable return.

### Phase 6: Delete Confirmation Modal Component

**File**: `apps/web/app/components/catalog/DeleteConfirmationModal.vue` (NEW)

```vue
<script setup lang="ts">
import { useDeleteConfirmationStore } from '~/stores/deleteConfirmation'
import { useCatalogStore } from '~/stores/catalog'

const deleteStore = useDeleteConfirmationStore()
const catalogStore = useCatalogStore()

const emit = defineEmits<{
  confirm: [assetIds: string[]]
}>()

function handleConfirm(): void {
  const ids = [...deleteStore.pendingAssetIds]
  deleteStore.confirmDelete()
  emit('confirm', ids)
}

function handleCancel(): void {
  deleteStore.cancelDelete()
}

// Get asset names for display (up to 3)
const assetNames = computed(() => {
  const names: string[] = []
  for (const id of deleteStore.pendingAssetIds.slice(0, 3)) {
    const asset = catalogStore.assets.get(id)
    if (asset) {
      names.push(asset.filename)
    }
  }
  return names
})

const remainingCount = computed(() =>
  Math.max(0, deleteStore.pendingCount - 3)
)
</script>

<template>
  <UModal
    v-model:open="deleteStore.isModalOpen"
    :dismissible="true"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-trash-2" class="text-error-500" />
        <span>Remove from Catalog</span>
      </div>
    </template>

    <template #body>
      <div class="space-y-3">
        <p class="text-gray-300">
          Remove {{ deleteStore.pendingCount }}
          {{ deleteStore.pendingCount === 1 ? 'photo' : 'photos' }}
          from the catalog?
        </p>

        <div v-if="assetNames.length > 0" class="text-sm text-gray-400">
          <ul class="list-disc list-inside">
            <li v-for="name in assetNames" :key="name">{{ name }}</li>
            <li v-if="remainingCount > 0">
              and {{ remainingCount }} more...
            </li>
          </ul>
        </div>

        <p class="text-sm text-gray-500">
          This will not delete the files from disk. You can re-scan the folder to recover them.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          variant="ghost"
          @click="handleCancel"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          @click="handleConfirm"
        >
          Remove
        </UButton>
      </div>
    </template>
  </UModal>
</template>
```

### Phase 7: CatalogGrid Integration

**File**: `apps/web/app/components/catalog/CatalogGrid.vue` (MODIFY)

1. Import delete confirmation store
2. Add onDelete callback to useGridKeyboard

```typescript
import { useDeleteConfirmationStore } from '~/stores/deleteConfirmation'

const deleteConfirmationStore = useDeleteConfirmationStore()

const { handleKeydown, ... } = useGridKeyboard({
  // ... existing options
  onDelete: () => {
    const toDelete = selectionStore.selectedIds.size > 0
      ? [...selectionStore.selectedIds]
      : selectionStore.currentId
        ? [selectionStore.currentId]
        : []

    if (toDelete.length > 0) {
      deleteConfirmationStore.requestDelete(toDelete)
    }
  }
})
```

### Phase 8: Index Page Integration

**File**: `apps/web/app/pages/index.vue` (MODIFY)

1. Import and mount DeleteConfirmationModal
2. Handle confirm event

```vue
<script setup>
import { useDeleteConfirmationStore } from '~/stores/deleteConfirmation'
import { useCatalog } from '~/composables/useCatalog'

const deleteStore = useDeleteConfirmationStore()
const { deleteAssets } = useCatalog()

async function handleDeleteConfirm(assetIds: string[]): Promise<void> {
  await deleteAssets(assetIds)
  deleteStore.clearPending()

  const toast = useToast()
  toast.add({
    title: 'Removed from catalog',
    description: `${assetIds.length} photo${assetIds.length === 1 ? '' : 's'} removed`,
    color: 'success',
  })
}
</script>

<template>
  <!-- existing template -->
  <DeleteConfirmationModal @confirm="handleDeleteConfirm" />
</template>
```

## Test Plan

### Unit Tests

**File**: `apps/web/test/deleteConfirmation.test.ts` (NEW)

- Store state management
- requestDelete populates pendingAssetIds
- confirmDelete closes modal
- cancelDelete clears pending and closes

**File**: `apps/web/test/catalogStore.test.ts` (MODIFY)

- removeAssetBatch removes from assets Map
- removeAssetBatch removes from assetIds array
- removeAssetBatch revokes blob URLs
- removeAssetBatch handles empty array
- removeAssetBatch handles non-existent IDs

**File**: `packages/core/src/catalog/catalog-service.test.ts` (MODIFY)

- removeAssets removes from database
- removeAssets removes from memory
- removeAssets handles empty array

### Integration Tests

**File**: `apps/web/test/deletePhotos.test.ts` (NEW)

- Delete single photo with confirmation
- Delete multiple selected photos
- Cancel deletion preserves photos
- Selection clears after delete
- Counts update after delete

## Acceptance Criteria

1. Pressing Delete/Backspace with photo selected opens confirmation modal
2. Modal shows count and up to 3 filenames
3. Confirming removes photos from catalog
4. Cancelling closes modal, photos remain
5. Toast shows success message after deletion
6. Selection is cleared after deletion
7. Filter counts update correctly
8. Works with multi-selection (Ctrl+Click, Shift+Click)
9. Works in both demo mode and real mode
10. All existing tests continue to pass
