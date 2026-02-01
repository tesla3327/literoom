/**
 * Delete Confirmation Store
 *
 * Manages state for the delete confirmation modal.
 * Tracks which assets are pending deletion and provides
 * methods to request, confirm, or cancel deletion.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useDeleteConfirmationStore = defineStore('deleteConfirmation', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Whether the delete confirmation modal is currently open.
   */
  const isModalOpen = ref(false)

  /**
   * Asset IDs that are pending deletion.
   */
  const pendingAssetIds = ref<string[]>([])

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Count of assets pending deletion.
   */
  const pendingCount = computed(() => pendingAssetIds.value.length)

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Request deletion of the specified assets.
   * Opens the confirmation modal with the asset IDs.
   */
  function requestDelete(assetIds: string[]): void {
    pendingAssetIds.value = [...assetIds]
    isModalOpen.value = true
  }

  /**
   * Confirm the deletion.
   * Closes the modal but preserves pending IDs for the caller to handle.
   */
  function confirmDelete(): void {
    isModalOpen.value = false
  }

  /**
   * Cancel the deletion.
   * Clears pending assets and closes the modal.
   */
  function cancelDelete(): void {
    pendingAssetIds.value = []
    isModalOpen.value = false
  }

  /**
   * Clear the pending asset IDs.
   * Called after the caller has processed the deletion.
   */
  function clearPending(): void {
    pendingAssetIds.value = []
  }

  return {
    // State
    isModalOpen,
    pendingAssetIds,

    // Computed
    pendingCount,

    // Actions
    requestDelete,
    confirmDelete,
    cancelDelete,
    clearPending,
  }
})
