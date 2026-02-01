/**
 * Integration tests for delete photo functionality.
 *
 * Tests the interaction between catalog store, selection store,
 * and the delete confirmation store for deleting photos.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'
import { useSelectionStore } from '~/stores/selection'
import { useDeleteConfirmationStore } from '~/stores/deleteConfirmation'
import type { Asset, FlagStatus, ThumbnailStatus } from '@literoom/core/catalog'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock asset for testing.
 */
function createMockAsset(
  id: string,
  options: {
    flag?: FlagStatus
    thumbnailStatus?: ThumbnailStatus
    preview1xStatus?: ThumbnailStatus
  } = {},
): Asset {
  return {
    id,
    folderId: 'folder-1',
    filename: `${id}`,
    path: `/photos/${id}.jpg`,
    extension: 'jpg',
    fileSize: 1024,
    flag: options.flag ?? 'none',
    captureDate: new Date(),
    modifiedDate: new Date(),
    thumbnailStatus: options.thumbnailStatus ?? 'ready',
    thumbnailUrl: `blob:thumbnail-${id}`,
    preview1xStatus: options.preview1xStatus ?? 'ready',
    preview1xUrl: `blob:preview-${id}`,
  }
}

/**
 * Populate the catalog store with mock assets.
 */
function populateCatalog(
  catalogStore: ReturnType<typeof useCatalogStore>,
  count: number,
): Asset[] {
  const assets: Asset[] = []
  for (let i = 1; i <= count; i++) {
    assets.push(createMockAsset(`asset-${i}`))
  }
  catalogStore.addAssetBatch(assets)
  return assets
}

// ============================================================================
// Tests
// ============================================================================

describe('delete photos functionality', () => {
  let catalogStore: ReturnType<typeof useCatalogStore>
  let selectionStore: ReturnType<typeof useSelectionStore>
  let deleteConfirmationStore: ReturnType<typeof useDeleteConfirmationStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    catalogStore = useCatalogStore()
    selectionStore = useSelectionStore()
    deleteConfirmationStore = useDeleteConfirmationStore()

    // Mock URL.revokeObjectURL to prevent errors
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  // ============================================================================
  // Delete Confirmation Store
  // ============================================================================

  describe('deleteConfirmationStore', () => {
    it('opens modal and stores pending asset IDs', () => {
      const assetIds = ['asset-1', 'asset-2']

      deleteConfirmationStore.requestDelete(assetIds)

      expect(deleteConfirmationStore.isModalOpen).toBe(true)
      expect(deleteConfirmationStore.pendingAssetIds).toEqual(assetIds)
      expect(deleteConfirmationStore.pendingCount).toBe(2)
    })

    it('closes modal on confirm but preserves pending IDs', () => {
      deleteConfirmationStore.requestDelete(['asset-1'])

      deleteConfirmationStore.confirmDelete()

      expect(deleteConfirmationStore.isModalOpen).toBe(false)
      // IDs are preserved for the caller to process
      expect(deleteConfirmationStore.pendingAssetIds).toEqual(['asset-1'])
    })

    it('closes modal and clears pending IDs on cancel', () => {
      deleteConfirmationStore.requestDelete(['asset-1', 'asset-2'])

      deleteConfirmationStore.cancelDelete()

      expect(deleteConfirmationStore.isModalOpen).toBe(false)
      expect(deleteConfirmationStore.pendingAssetIds).toEqual([])
      expect(deleteConfirmationStore.pendingCount).toBe(0)
    })

    it('clears pending IDs after processing', () => {
      deleteConfirmationStore.requestDelete(['asset-1'])
      deleteConfirmationStore.confirmDelete()

      deleteConfirmationStore.clearPending()

      expect(deleteConfirmationStore.pendingAssetIds).toEqual([])
    })
  })

  // ============================================================================
  // Delete Single Photo
  // ============================================================================

  describe('delete single photo with confirmation', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('removes single asset from catalog after confirmation', () => {
      // Simulate confirmation flow
      deleteConfirmationStore.requestDelete(['asset-3'])
      expect(deleteConfirmationStore.isModalOpen).toBe(true)

      // User confirms
      deleteConfirmationStore.confirmDelete()

      // Process the deletion
      const idsToDelete = [...deleteConfirmationStore.pendingAssetIds]
      catalogStore.removeAssetBatch(idsToDelete)
      deleteConfirmationStore.clearPending()

      // Verify asset is removed
      expect(catalogStore.getAsset('asset-3')).toBeUndefined()
      expect(catalogStore.assetIds).not.toContain('asset-3')
      expect(catalogStore.totalCount).toBe(4)
    })

    it('does not remove asset when confirmation is cancelled', () => {
      deleteConfirmationStore.requestDelete(['asset-3'])

      // User cancels
      deleteConfirmationStore.cancelDelete()

      // Asset should still exist
      expect(catalogStore.getAsset('asset-3')).toBeDefined()
      expect(catalogStore.assetIds).toContain('asset-3')
      expect(catalogStore.totalCount).toBe(5)
    })
  })

  // ============================================================================
  // Delete Multiple Selected Photos
  // ============================================================================

  describe('delete multiple selected photos', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('removes multiple selected assets from catalog', () => {
      // Select multiple assets
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-3')
      selectionStore.toggleSelection('asset-5')

      const selectedIds = [...selectionStore.selectedIds]
      expect(selectedIds).toHaveLength(3)

      // Request delete with selected IDs
      deleteConfirmationStore.requestDelete(selectedIds)
      deleteConfirmationStore.confirmDelete()

      // Process deletion
      catalogStore.removeAssetBatch([...deleteConfirmationStore.pendingAssetIds])

      // Verify assets are removed
      expect(catalogStore.getAsset('asset-1')).toBeUndefined()
      expect(catalogStore.getAsset('asset-3')).toBeUndefined()
      expect(catalogStore.getAsset('asset-5')).toBeUndefined()
      expect(catalogStore.totalCount).toBe(2)

      // Remaining assets should be intact
      expect(catalogStore.getAsset('asset-2')).toBeDefined()
      expect(catalogStore.getAsset('asset-4')).toBeDefined()
    })

    it('handles range selection deletion', () => {
      const orderedIds = catalogStore.assetIds

      // Range select asset-2 to asset-4
      selectionStore.selectSingle('asset-2')
      selectionStore.selectRange('asset-4', orderedIds)

      expect(selectionStore.selectedIds.size).toBe(3)

      // Delete the range
      const selectedIds = [...selectionStore.selectedIds]
      deleteConfirmationStore.requestDelete(selectedIds)
      deleteConfirmationStore.confirmDelete()
      catalogStore.removeAssetBatch([...deleteConfirmationStore.pendingAssetIds])

      // Verify
      expect(catalogStore.totalCount).toBe(2)
      expect(catalogStore.getAsset('asset-1')).toBeDefined()
      expect(catalogStore.getAsset('asset-5')).toBeDefined()
    })
  })

  // ============================================================================
  // Selection Cleared After Deletion
  // ============================================================================

  describe('selection is cleared after deletion', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('removes deleted asset from selection', () => {
      selectionStore.selectSingle('asset-3')
      expect(selectionStore.selectedIds.has('asset-3')).toBe(true)
      expect(selectionStore.currentId).toBe('asset-3')

      // Delete the selected asset
      catalogStore.removeAssetBatch(['asset-3'])
      selectionStore.removeFromSelection('asset-3')

      // Selection should be cleared for deleted asset
      expect(selectionStore.selectedIds.has('asset-3')).toBe(false)
      expect(selectionStore.currentId).toBeNull()
    })

    it('clears all deleted assets from multi-selection', () => {
      // Multi-select
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')
      expect(selectionStore.selectedIds.size).toBe(3)

      // Delete assets 1 and 3
      const idsToDelete = ['asset-1', 'asset-3']
      catalogStore.removeAssetBatch(idsToDelete)
      for (const id of idsToDelete) {
        selectionStore.removeFromSelection(id)
      }

      // Only asset-2 should remain selected
      expect(selectionStore.selectedIds.size).toBe(1)
      expect(selectionStore.selectedIds.has('asset-2')).toBe(true)
      expect(selectionStore.currentId).toBe('asset-2')
    })

    it('clears selection completely when all selected assets are deleted', () => {
      selectionStore.selectSingle('asset-2')
      selectionStore.toggleSelection('asset-4')

      const idsToDelete = ['asset-2', 'asset-4']
      catalogStore.removeAssetBatch(idsToDelete)
      for (const id of idsToDelete) {
        selectionStore.removeFromSelection(id)
      }

      expect(selectionStore.selectedIds.size).toBe(0)
      expect(selectionStore.currentId).toBeNull()
      expect(selectionStore.isEmpty).toBe(true)
    })
  })

  // ============================================================================
  // Asset Counts Update After Deletion
  // ============================================================================

  describe('asset counts update after deletion', () => {
    it('totalCount decreases after deletion', () => {
      populateCatalog(catalogStore, 5)
      expect(catalogStore.totalCount).toBe(5)

      catalogStore.removeAssetBatch(['asset-1', 'asset-2'])

      expect(catalogStore.totalCount).toBe(3)
    })

    it('flag counts update when flagged assets are deleted', () => {
      // Create assets with different flags
      const assets = [
        createMockAsset('asset-1', { flag: 'pick' }),
        createMockAsset('asset-2', { flag: 'pick' }),
        createMockAsset('asset-3', { flag: 'reject' }),
        createMockAsset('asset-4', { flag: 'none' }),
        createMockAsset('asset-5', { flag: 'none' }),
      ]
      catalogStore.addAssetBatch(assets)

      expect(catalogStore.pickCount).toBe(2)
      expect(catalogStore.rejectCount).toBe(1)
      expect(catalogStore.unflaggedCount).toBe(2)

      // Delete one pick and one unflagged
      catalogStore.removeAssetBatch(['asset-1', 'asset-4'])

      expect(catalogStore.pickCount).toBe(1)
      expect(catalogStore.rejectCount).toBe(1)
      expect(catalogStore.unflaggedCount).toBe(1)
      expect(catalogStore.totalCount).toBe(3)
    })

    it('flagCounts computed property reflects deletions', () => {
      const assets = [
        createMockAsset('asset-1', { flag: 'pick' }),
        createMockAsset('asset-2', { flag: 'reject' }),
        createMockAsset('asset-3', { flag: 'none' }),
      ]
      catalogStore.addAssetBatch(assets)

      expect(catalogStore.flagCounts).toEqual({
        all: 3,
        picks: 1,
        rejects: 1,
        unflagged: 1,
      })

      catalogStore.removeAssetBatch(['asset-2'])

      expect(catalogStore.flagCounts).toEqual({
        all: 2,
        picks: 1,
        rejects: 0,
        unflagged: 1,
      })
    })
  })

  // ============================================================================
  // Asset Removed from assetIds and assets Map
  // ============================================================================

  describe('deleted asset is removed from assetIds and assets Map', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('removes asset from assetIds array', () => {
      expect(catalogStore.assetIds).toContain('asset-3')

      catalogStore.removeAssetBatch(['asset-3'])

      expect(catalogStore.assetIds).not.toContain('asset-3')
      expect(catalogStore.assetIds).toEqual([
        'asset-1',
        'asset-2',
        'asset-4',
        'asset-5',
      ])
    })

    it('removes asset from assets Map', () => {
      expect(catalogStore.assets.has('asset-3')).toBe(true)

      catalogStore.removeAssetBatch(['asset-3'])

      expect(catalogStore.assets.has('asset-3')).toBe(false)
    })

    it('getAsset returns undefined for deleted asset', () => {
      expect(catalogStore.getAsset('asset-3')).toBeDefined()

      catalogStore.removeAssetBatch(['asset-3'])

      expect(catalogStore.getAsset('asset-3')).toBeUndefined()
    })

    it('getOrderedAssets excludes deleted assets', () => {
      const beforeDelete = catalogStore.getOrderedAssets()
      expect(beforeDelete.map(a => a.id)).toContain('asset-3')

      catalogStore.removeAssetBatch(['asset-3'])

      const afterDelete = catalogStore.getOrderedAssets()
      expect(afterDelete.map(a => a.id)).not.toContain('asset-3')
      expect(afterDelete).toHaveLength(4)
    })

    it('handles deletion of multiple non-contiguous assets', () => {
      catalogStore.removeAssetBatch(['asset-1', 'asset-3', 'asset-5'])

      expect(catalogStore.assetIds).toEqual(['asset-2', 'asset-4'])
      expect(catalogStore.assets.size).toBe(2)
      expect(catalogStore.totalCount).toBe(2)
    })

    it('handles deletion of all assets', () => {
      const allIds = [...catalogStore.assetIds]
      catalogStore.removeAssetBatch(allIds)

      expect(catalogStore.assetIds).toEqual([])
      expect(catalogStore.assets.size).toBe(0)
      expect(catalogStore.totalCount).toBe(0)
    })

    it('handles empty deletion array gracefully', () => {
      const beforeCount = catalogStore.totalCount

      catalogStore.removeAssetBatch([])

      expect(catalogStore.totalCount).toBe(beforeCount)
    })

    it('ignores non-existent asset IDs during deletion', () => {
      catalogStore.removeAssetBatch(['non-existent', 'asset-2', 'also-non-existent'])

      // Only asset-2 should be removed
      expect(catalogStore.totalCount).toBe(4)
      expect(catalogStore.getAsset('asset-2')).toBeUndefined()
      expect(catalogStore.getAsset('asset-1')).toBeDefined()
    })
  })

  // ============================================================================
  // Integration: Full Delete Workflow
  // ============================================================================

  describe('full delete workflow integration', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('complete single photo delete workflow', () => {
      // 1. Select a photo
      selectionStore.selectSingle('asset-3')

      // 2. Initiate delete (e.g., user presses Delete key)
      const selectedIds = [...selectionStore.selectedIds]
      deleteConfirmationStore.requestDelete(selectedIds)

      // 3. Verify modal opens with correct count
      expect(deleteConfirmationStore.isModalOpen).toBe(true)
      expect(deleteConfirmationStore.pendingCount).toBe(1)

      // 4. User confirms deletion
      deleteConfirmationStore.confirmDelete()

      // 5. Process deletion
      const idsToDelete = [...deleteConfirmationStore.pendingAssetIds]
      catalogStore.removeAssetBatch(idsToDelete)
      for (const id of idsToDelete) {
        selectionStore.removeFromSelection(id)
      }
      deleteConfirmationStore.clearPending()

      // 6. Verify final state
      expect(catalogStore.totalCount).toBe(4)
      expect(catalogStore.getAsset('asset-3')).toBeUndefined()
      expect(selectionStore.isEmpty).toBe(true)
      expect(deleteConfirmationStore.pendingAssetIds).toEqual([])
    })

    it('complete multi-select delete workflow', () => {
      // 1. Multi-select photos
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')

      // 2. Initiate delete
      const selectedIds = [...selectionStore.selectedIds]
      deleteConfirmationStore.requestDelete(selectedIds)

      // 3. Verify modal
      expect(deleteConfirmationStore.pendingCount).toBe(3)

      // 4. Confirm and process
      deleteConfirmationStore.confirmDelete()
      const idsToDelete = [...deleteConfirmationStore.pendingAssetIds]
      catalogStore.removeAssetBatch(idsToDelete)
      for (const id of idsToDelete) {
        selectionStore.removeFromSelection(id)
      }
      deleteConfirmationStore.clearPending()

      // 5. Verify
      expect(catalogStore.totalCount).toBe(2)
      expect(catalogStore.assetIds).toEqual(['asset-4', 'asset-5'])
      expect(selectionStore.isEmpty).toBe(true)
    })

    it('cancelled delete workflow preserves state', () => {
      selectionStore.selectSingle('asset-3')

      // Initiate but cancel
      deleteConfirmationStore.requestDelete(['asset-3'])
      deleteConfirmationStore.cancelDelete()

      // Everything should be unchanged
      expect(catalogStore.totalCount).toBe(5)
      expect(catalogStore.getAsset('asset-3')).toBeDefined()
      expect(selectionStore.selectedIds.has('asset-3')).toBe(true)
      expect(selectionStore.currentId).toBe('asset-3')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles deleting the only remaining asset', () => {
      catalogStore.addAssetBatch([createMockAsset('only-asset')])
      selectionStore.selectSingle('only-asset')

      catalogStore.removeAssetBatch(['only-asset'])
      selectionStore.removeFromSelection('only-asset')

      expect(catalogStore.totalCount).toBe(0)
      expect(catalogStore.assetIds).toEqual([])
      expect(selectionStore.isEmpty).toBe(true)
    })

    it('handles deletion during multi-selection where some assets are already deleted', () => {
      populateCatalog(catalogStore, 5)

      // Delete asset-3 first
      catalogStore.removeAssetBatch(['asset-3'])

      // Try to delete asset-2, asset-3, asset-4 (asset-3 no longer exists)
      catalogStore.removeAssetBatch(['asset-2', 'asset-3', 'asset-4'])

      // Should handle gracefully
      expect(catalogStore.totalCount).toBe(2)
      expect(catalogStore.assetIds).toEqual(['asset-1', 'asset-5'])
    })

    it('revokes blob URLs when deleting assets', () => {
      const revokeURLSpy = vi.spyOn(URL, 'revokeObjectURL')
      populateCatalog(catalogStore, 3)

      catalogStore.removeAssetBatch(['asset-2'])

      // Should revoke both thumbnail and preview URLs
      expect(revokeURLSpy).toHaveBeenCalledWith('blob:thumbnail-asset-2')
      expect(revokeURLSpy).toHaveBeenCalledWith('blob:preview-asset-2')
    })
  })
})
