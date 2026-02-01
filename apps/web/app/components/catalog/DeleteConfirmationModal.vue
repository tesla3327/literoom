<script setup lang="ts">
/**
 * DeleteConfirmationModal Component
 *
 * Modal dialog for confirming removal of photos from the catalog.
 *
 * Features:
 * - Shows count of photos to be removed
 * - Displays up to 3 filenames from the pending assets
 * - Clarifies that files are not deleted from disk
 * - Cancel and Remove buttons with appropriate styling
 */

const emit = defineEmits<{
  confirm: [assetIds: string[]]
}>()

const deleteConfirmationStore = useDeleteConfirmationStore()
const catalogStore = useCatalogStore()

// ============================================================================
// Computed
// ============================================================================

/**
 * Get filenames for the pending assets (up to 3).
 */
const pendingFilenames = computed(() => {
  const filenames: string[] = []
  for (const id of deleteConfirmationStore.pendingAssetIds) {
    if (filenames.length >= 3) break
    const asset = catalogStore.getAsset(id)
    if (asset) {
      filenames.push(asset.filename)
    }
  }
  return filenames
})

/**
 * Whether there are more assets than displayed filenames.
 */
const hasMoreAssets = computed(() => {
  return deleteConfirmationStore.pendingCount > 3
})

/**
 * Count of additional assets not shown in the filename list.
 */
const additionalCount = computed(() => {
  return deleteConfirmationStore.pendingCount - 3
})

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle Remove button click.
 */
function handleConfirm() {
  const assetIds = [...deleteConfirmationStore.pendingAssetIds]
  deleteConfirmationStore.confirmDelete()
  emit('confirm', assetIds)
}

/**
 * Handle Cancel button click.
 */
function handleCancel() {
  deleteConfirmationStore.cancelDelete()
}
</script>

<template>
  <UModal
    v-model:open="deleteConfirmationStore.isModalOpen"
    :dismissible="true"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-heroicons-trash"
          class="w-5 h-5 text-gray-400"
        />
        <h2 class="text-lg font-semibold text-white">
          Remove from Catalog
        </h2>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Removal count question -->
        <p class="text-gray-300">
          Remove {{ deleteConfirmationStore.pendingCount }} photo{{ deleteConfirmationStore.pendingCount === 1 ? '' : 's' }} from the catalog?
        </p>

        <!-- Filenames list -->
        <div
          v-if="pendingFilenames.length > 0"
          class="space-y-1"
        >
          <p
            v-for="filename in pendingFilenames"
            :key="filename"
            class="text-sm text-gray-400 truncate"
          >
            {{ filename }}
          </p>
          <p
            v-if="hasMoreAssets"
            class="text-sm text-gray-500 italic"
          >
            ...and {{ additionalCount }} more
          </p>
        </div>

        <!-- Note about disk files -->
        <p class="text-sm text-gray-500">
          This will not delete the files from disk. You can re-scan the folder to recover them.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
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
