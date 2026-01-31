/**
 * Unit tests for multi-select flagging functionality.
 *
 * Tests that keyboard shortcuts (P/X/U) apply flags to all selected photos,
 * not just the current/focused photo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'
import { useSelectionStore } from '~/stores/selection'
import type { Asset, FlagStatus } from '@literoom/core/catalog'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock asset for testing.
 */
function createMockAsset(id: string, flag: FlagStatus = 'none'): Asset {
  return {
    id,
    filename: `${id}.jpg`,
    path: `/photos/${id}.jpg`,
    size: 1024,
    type: 'jpeg',
    captureDate: new Date(),
    flag,
    thumbnailStatus: 'ready',
    thumbnailUrl: `blob:thumbnail-${id}`,
    preview1xStatus: 'ready',
    preview1xUrl: `blob:preview-${id}`,
  }
}

/**
 * Populate the catalog store with mock assets.
 */
function populateCatalog(catalogStore: ReturnType<typeof useCatalogStore>, count: number): Asset[] {
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

describe('multi-select flagging', () => {
  let catalogStore: ReturnType<typeof useCatalogStore>
  let selectionStore: ReturnType<typeof useSelectionStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    catalogStore = useCatalogStore()
    selectionStore = useSelectionStore()
  })

  // ============================================================================
  // Catalog Store Batch Flagging
  // ============================================================================

  describe('catalogStore.setFlagBatch', () => {
    it('flags multiple assets with a single call', () => {
      populateCatalog(catalogStore, 5)

      catalogStore.setFlagBatch(['asset-1', 'asset-2', 'asset-3'], 'pick')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-4')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-5')?.flag).toBe('none')
    })

    it('handles empty array gracefully', () => {
      populateCatalog(catalogStore, 3)

      // Should not throw and should not modify any assets
      catalogStore.setFlagBatch([], 'pick')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('none')
    })

    it('ignores non-existent asset IDs', () => {
      populateCatalog(catalogStore, 2)

      catalogStore.setFlagBatch(['asset-1', 'non-existent', 'asset-2'], 'reject')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('reject')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('reject')
    })

    it('updates flag counts correctly after batch operation', () => {
      populateCatalog(catalogStore, 5)

      catalogStore.setFlagBatch(['asset-1', 'asset-2'], 'pick')
      catalogStore.setFlagBatch(['asset-3'], 'reject')

      expect(catalogStore.pickCount).toBe(2)
      expect(catalogStore.rejectCount).toBe(1)
      expect(catalogStore.unflaggedCount).toBe(2)
    })

    it('can clear flags from multiple assets', () => {
      populateCatalog(catalogStore, 3)
      // First set some flags
      catalogStore.setFlagBatch(['asset-1', 'asset-2', 'asset-3'], 'pick')
      expect(catalogStore.pickCount).toBe(3)

      // Then clear them
      catalogStore.setFlagBatch(['asset-1', 'asset-3'], 'none')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('none')
      expect(catalogStore.pickCount).toBe(1)
    })
  })

  // ============================================================================
  // Selection Store Multi-Selection
  // ============================================================================

  describe('selectionStore multi-selection', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('tracks multiple selected IDs', () => {
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')

      expect(selectionStore.selectedIds.size).toBe(3)
      expect(selectionStore.selectedIds.has('asset-1')).toBe(true)
      expect(selectionStore.selectedIds.has('asset-2')).toBe(true)
      expect(selectionStore.selectedIds.has('asset-3')).toBe(true)
    })

    it('distinguishes between currentId and selectedIds', () => {
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')

      // currentId should be the last toggled item
      expect(selectionStore.currentId).toBe('asset-3')
      // But all three should be in selectedIds
      expect(selectionStore.selectedIds.size).toBe(3)
    })

    it('hasMultipleSelected is true when multiple items selected', () => {
      selectionStore.selectSingle('asset-1')
      expect(selectionStore.hasMultipleSelected).toBe(false)

      selectionStore.toggleSelection('asset-2')
      expect(selectionStore.hasMultipleSelected).toBe(true)
    })

    it('provides selectedIdsArray for iteration', () => {
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')

      const array = selectionStore.selectedIdsArray
      expect(array).toHaveLength(2)
      expect(array).toContain('asset-1')
      expect(array).toContain('asset-2')
    })
  })

  // ============================================================================
  // Integration: Multi-Select + Batch Flagging
  // ============================================================================

  describe('multi-select flagging integration', () => {
    beforeEach(() => {
      populateCatalog(catalogStore, 5)
    })

    it('flags all selected items when using batch', () => {
      // Simulate multi-select (Ctrl+Click pattern)
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')

      // Flag all selected items (what the fixed CatalogGrid.vue does)
      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-4')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-5')?.flag).toBe('none')
    })

    it('rejects all selected items when using batch', () => {
      selectionStore.selectSingle('asset-2')
      selectionStore.toggleSelection('asset-4')

      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'reject')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('reject')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-4')?.flag).toBe('reject')
      expect(catalogStore.getAsset('asset-5')?.flag).toBe('none')
    })

    it('clears flags from all selected items when using batch', () => {
      // Pre-flag some items
      catalogStore.setFlagBatch(['asset-1', 'asset-2', 'asset-3'], 'pick')

      // Select and unflag
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')

      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'none')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('none')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('pick') // Not selected, unchanged
    })

    it('falls back to single flag when only currentId is set', () => {
      // Single selection (no multi-select)
      selectionStore.selectSingle('asset-3')

      // In this case, selectedIds contains only the current item
      expect(selectionStore.selectedIds.size).toBe(1)
      expect(selectionStore.selectedIds.has('asset-3')).toBe(true)

      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      expect(catalogStore.getAsset('asset-3')?.flag).toBe('pick')
      expect(catalogStore.pickCount).toBe(1)
    })

    it('handles range selection + batch flagging', () => {
      const orderedIds = catalogStore.assetIds

      // Simulate range selection (Shift+Click from asset-1 to asset-4)
      selectionStore.selectSingle('asset-1')
      selectionStore.selectRange('asset-4', orderedIds)

      expect(selectionStore.selectedIds.size).toBe(4)

      // Flag all in range
      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-3')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-4')?.flag).toBe('pick')
      expect(catalogStore.getAsset('asset-5')?.flag).toBe('none')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles flagging when selection is cleared', () => {
      populateCatalog(catalogStore, 3)
      selectionStore.selectSingle('asset-1')
      selectionStore.clear()

      // After clear, both currentId and selectedIds are empty
      expect(selectionStore.currentId).toBeNull()
      expect(selectionStore.selectedIds.size).toBe(0)

      // Attempting to flag should do nothing (no assets to flag)
      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      // All should remain unflagged
      expect(catalogStore.pickCount).toBe(0)
    })

    it('preserves selection after flagging', () => {
      populateCatalog(catalogStore, 5)
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      selectionStore.toggleSelection('asset-3')

      const selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      // Selection should remain unchanged after flagging
      expect(selectionStore.selectedIds.size).toBe(3)
      expect(selectionStore.selectedIds.has('asset-1')).toBe(true)
      expect(selectionStore.selectedIds.has('asset-2')).toBe(true)
      expect(selectionStore.selectedIds.has('asset-3')).toBe(true)
    })

    it('can toggle flag state on selected items', () => {
      populateCatalog(catalogStore, 3)

      // Select and pick
      selectionStore.selectSingle('asset-1')
      selectionStore.toggleSelection('asset-2')
      let selectedIds = [...selectionStore.selectedIds]
      catalogStore.setFlagBatch(selectedIds, 'pick')

      expect(catalogStore.pickCount).toBe(2)

      // Select same items and reject
      catalogStore.setFlagBatch(selectedIds, 'reject')

      expect(catalogStore.getAsset('asset-1')?.flag).toBe('reject')
      expect(catalogStore.getAsset('asset-2')?.flag).toBe('reject')
      expect(catalogStore.pickCount).toBe(0)
      expect(catalogStore.rejectCount).toBe(2)
    })
  })
})
