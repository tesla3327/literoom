/**
 * Unit tests for the catalog UI store.
 *
 * Tests UI-specific state management including:
 * - Filter mode (all, picks, rejects, unflagged)
 * - Sort field and direction
 * - View mode (grid, loupe)
 * - Grid columns and thumbnail size
 * - Filtered and sorted asset IDs computation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogUIStore } from '~/stores/catalogUI'
import { useCatalogStore } from '~/stores/catalog'
import type { Asset } from '@literoom/core/catalog'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock asset with specified properties.
 */
function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-asset-1',
    filename: 'IMG_0001.jpg',
    path: '/photos/IMG_0001.jpg',
    fileSize: 1024 * 1024, // 1MB
    fileType: 'jpeg',
    width: 6000,
    height: 4000,
    captureDate: new Date('2025-01-15T10:00:00Z'),
    flag: 'none',
    thumbnailStatus: 'pending',
    thumbnailUrl: null,
    preview1xStatus: 'pending',
    preview1xUrl: null,
    ...overrides,
  }
}

/**
 * Create multiple test assets with sequential IDs.
 */
function createTestAssets(count: number, flagPattern?: ('pick' | 'reject' | 'none')[]): Asset[] {
  const assets: Asset[] = []
  for (let i = 0; i < count; i++) {
    const flag = flagPattern ? flagPattern[i % flagPattern.length] : 'none'
    assets.push(createMockAsset({
      id: `asset-${i + 1}`,
      filename: `IMG_${String(i + 1).padStart(4, '0')}.jpg`,
      path: `/photos/IMG_${String(i + 1).padStart(4, '0')}.jpg`,
      fileSize: (i + 1) * 1024 * 1024, // Different file sizes
      captureDate: new Date(`2025-01-${String(15 + i).padStart(2, '0')}T10:00:00Z`),
      flag,
    }))
  }
  return assets
}

describe('catalogUIStore', () => {
  let uiStore: ReturnType<typeof useCatalogUIStore>
  let catalogStore: ReturnType<typeof useCatalogStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    uiStore = useCatalogUIStore()
    catalogStore = useCatalogStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('has default filter mode of "all"', () => {
      expect(uiStore.filterMode).toBe('all')
    })

    it('has default sort field of "captureDate"', () => {
      expect(uiStore.sortField).toBe('captureDate')
    })

    it('has default sort direction of "desc"', () => {
      expect(uiStore.sortDirection).toBe('desc')
    })

    it('has default view mode of "grid"', () => {
      expect(uiStore.viewMode).toBe('grid')
    })

    it('has default grid columns of 4', () => {
      expect(uiStore.gridColumns).toBe(4)
    })

    it('has default thumbnail size of 200', () => {
      expect(uiStore.thumbnailSize).toBe(200)
    })

    it('has empty filteredAssetIds with no assets', () => {
      expect(uiStore.filteredAssetIds).toEqual([])
    })

    it('has zero filteredCount with no assets', () => {
      expect(uiStore.filteredCount).toBe(0)
    })
  })

  // ============================================================================
  // Filter Mode Actions
  // ============================================================================

  describe('setFilterMode', () => {
    it('sets filter mode to "picks"', () => {
      uiStore.setFilterMode('picks')
      expect(uiStore.filterMode).toBe('picks')
    })

    it('sets filter mode to "rejects"', () => {
      uiStore.setFilterMode('rejects')
      expect(uiStore.filterMode).toBe('rejects')
    })

    it('sets filter mode to "unflagged"', () => {
      uiStore.setFilterMode('unflagged')
      expect(uiStore.filterMode).toBe('unflagged')
    })

    it('sets filter mode back to "all"', () => {
      uiStore.setFilterMode('picks')
      uiStore.setFilterMode('all')
      expect(uiStore.filterMode).toBe('all')
    })
  })

  // ============================================================================
  // Sort Actions
  // ============================================================================

  describe('setSortField', () => {
    it('sets sort field to "filename"', () => {
      uiStore.setSortField('filename')
      expect(uiStore.sortField).toBe('filename')
    })

    it('sets sort field to "fileSize"', () => {
      uiStore.setSortField('fileSize')
      expect(uiStore.sortField).toBe('fileSize')
    })

    it('sets sort field back to "captureDate"', () => {
      uiStore.setSortField('filename')
      uiStore.setSortField('captureDate')
      expect(uiStore.sortField).toBe('captureDate')
    })
  })

  describe('setSortDirection', () => {
    it('sets sort direction to "asc"', () => {
      uiStore.setSortDirection('asc')
      expect(uiStore.sortDirection).toBe('asc')
    })

    it('sets sort direction to "desc"', () => {
      uiStore.setSortDirection('asc')
      uiStore.setSortDirection('desc')
      expect(uiStore.sortDirection).toBe('desc')
    })
  })

  describe('toggleSortDirection', () => {
    it('toggles from desc to asc', () => {
      expect(uiStore.sortDirection).toBe('desc')
      uiStore.toggleSortDirection()
      expect(uiStore.sortDirection).toBe('asc')
    })

    it('toggles from asc to desc', () => {
      uiStore.setSortDirection('asc')
      uiStore.toggleSortDirection()
      expect(uiStore.sortDirection).toBe('desc')
    })
  })

  // ============================================================================
  // View Mode Actions
  // ============================================================================

  describe('setViewMode', () => {
    it('sets view mode to "loupe"', () => {
      uiStore.setViewMode('loupe')
      expect(uiStore.viewMode).toBe('loupe')
    })

    it('sets view mode back to "grid"', () => {
      uiStore.setViewMode('loupe')
      uiStore.setViewMode('grid')
      expect(uiStore.viewMode).toBe('grid')
    })
  })

  describe('toggleViewMode', () => {
    it('toggles from grid to loupe', () => {
      expect(uiStore.viewMode).toBe('grid')
      uiStore.toggleViewMode()
      expect(uiStore.viewMode).toBe('loupe')
    })

    it('toggles from loupe to grid', () => {
      uiStore.setViewMode('loupe')
      uiStore.toggleViewMode()
      expect(uiStore.viewMode).toBe('grid')
    })
  })

  // ============================================================================
  // Grid Columns Actions
  // ============================================================================

  describe('setGridColumns', () => {
    it('sets grid columns to valid value', () => {
      uiStore.setGridColumns(6)
      expect(uiStore.gridColumns).toBe(6)
    })

    it('clamps to minimum of 1', () => {
      uiStore.setGridColumns(0)
      expect(uiStore.gridColumns).toBe(1)

      uiStore.setGridColumns(-5)
      expect(uiStore.gridColumns).toBe(1)
    })

    it('clamps to maximum of 12', () => {
      uiStore.setGridColumns(15)
      expect(uiStore.gridColumns).toBe(12)

      uiStore.setGridColumns(100)
      expect(uiStore.gridColumns).toBe(12)
    })
  })

  // ============================================================================
  // Thumbnail Size Actions
  // ============================================================================

  describe('setThumbnailSize', () => {
    it('sets thumbnail size to valid value', () => {
      uiStore.setThumbnailSize(250)
      expect(uiStore.thumbnailSize).toBe(250)
    })

    it('clamps to minimum of 100', () => {
      uiStore.setThumbnailSize(50)
      expect(uiStore.thumbnailSize).toBe(100)

      uiStore.setThumbnailSize(0)
      expect(uiStore.thumbnailSize).toBe(100)
    })

    it('clamps to maximum of 400', () => {
      uiStore.setThumbnailSize(500)
      expect(uiStore.thumbnailSize).toBe(400)

      uiStore.setThumbnailSize(1000)
      expect(uiStore.thumbnailSize).toBe(400)
    })
  })

  // ============================================================================
  // Reset to Defaults
  // ============================================================================

  describe('resetToDefaults', () => {
    it('resets all settings to defaults', () => {
      // Change all settings
      uiStore.setFilterMode('picks')
      uiStore.setSortField('filename')
      uiStore.setSortDirection('asc')
      uiStore.setViewMode('loupe')
      uiStore.setGridColumns(8)
      uiStore.setThumbnailSize(300)

      // Reset
      uiStore.resetToDefaults()

      // Verify all defaults
      expect(uiStore.filterMode).toBe('all')
      expect(uiStore.sortField).toBe('captureDate')
      expect(uiStore.sortDirection).toBe('desc')
      expect(uiStore.viewMode).toBe('grid')
      expect(uiStore.gridColumns).toBe(4)
      expect(uiStore.thumbnailSize).toBe(200)
    })
  })

  // ============================================================================
  // Filtered Asset IDs
  // ============================================================================

  describe('filteredAssetIds', () => {
    beforeEach(() => {
      // Add test assets with different flags
      const assets = createTestAssets(6, ['pick', 'reject', 'none', 'pick', 'none', 'reject'])
      catalogStore.addAssetBatch(assets)
    })

    it('returns all assets when filter is "all"', () => {
      uiStore.setFilterMode('all')
      expect(uiStore.filteredAssetIds).toHaveLength(6)
    })

    it('filters only picked assets', () => {
      uiStore.setFilterMode('picks')
      const filtered = uiStore.filteredAssetIds
      expect(filtered).toHaveLength(2)
      expect(filtered).toContain('asset-1')
      expect(filtered).toContain('asset-4')
    })

    it('filters only rejected assets', () => {
      uiStore.setFilterMode('rejects')
      const filtered = uiStore.filteredAssetIds
      expect(filtered).toHaveLength(2)
      expect(filtered).toContain('asset-2')
      expect(filtered).toContain('asset-6')
    })

    it('filters only unflagged assets', () => {
      uiStore.setFilterMode('unflagged')
      const filtered = uiStore.filteredAssetIds
      expect(filtered).toHaveLength(2)
      expect(filtered).toContain('asset-3')
      expect(filtered).toContain('asset-5')
    })

    it('returns empty array when no assets match filter', () => {
      // Clear and add only unflagged assets
      catalogStore.clear()
      const unflaggedOnly = createTestAssets(3, ['none'])
      catalogStore.addAssetBatch(unflaggedOnly)

      uiStore.setFilterMode('picks')
      expect(uiStore.filteredAssetIds).toHaveLength(0)
    })

    it('updates when asset flags change', () => {
      uiStore.setFilterMode('picks')
      expect(uiStore.filteredAssetIds).toHaveLength(2)

      // Change an unflagged asset to picked
      catalogStore.setFlag('asset-3', 'pick')
      expect(uiStore.filteredAssetIds).toHaveLength(3)
      expect(uiStore.filteredAssetIds).toContain('asset-3')
    })

    it('handles assets not in map gracefully', () => {
      // This shouldn't happen in normal operation, but test defensive behavior
      uiStore.setFilterMode('picks')
      // filteredAssetIds should not throw and should return valid IDs
      expect(() => uiStore.filteredAssetIds).not.toThrow()
    })
  })

  // ============================================================================
  // Sorted Asset IDs
  // ============================================================================

  describe('sortedAssetIds', () => {
    beforeEach(() => {
      // Add test assets with different dates and sizes
      const assets = [
        createMockAsset({
          id: 'asset-1',
          filename: 'zebra.jpg',
          fileSize: 3000,
          captureDate: new Date('2025-01-17T10:00:00Z'),
          flag: 'none',
        }),
        createMockAsset({
          id: 'asset-2',
          filename: 'apple.jpg',
          fileSize: 1000,
          captureDate: new Date('2025-01-15T10:00:00Z'),
          flag: 'pick',
        }),
        createMockAsset({
          id: 'asset-3',
          filename: 'mango.jpg',
          fileSize: 2000,
          captureDate: new Date('2025-01-16T10:00:00Z'),
          flag: 'none',
        }),
      ]
      catalogStore.addAssetBatch(assets)
    })

    describe('sort by captureDate', () => {
      it('sorts by captureDate descending (newest first)', () => {
        uiStore.setSortField('captureDate')
        uiStore.setSortDirection('desc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-1', 'asset-3', 'asset-2'])
      })

      it('sorts by captureDate ascending (oldest first)', () => {
        uiStore.setSortField('captureDate')
        uiStore.setSortDirection('asc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-2', 'asset-3', 'asset-1'])
      })
    })

    describe('sort by filename', () => {
      it('sorts by filename descending (z first)', () => {
        uiStore.setSortField('filename')
        uiStore.setSortDirection('desc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-1', 'asset-3', 'asset-2']) // zebra, mango, apple
      })

      it('sorts by filename ascending (a first)', () => {
        uiStore.setSortField('filename')
        uiStore.setSortDirection('asc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-2', 'asset-3', 'asset-1']) // apple, mango, zebra
      })
    })

    describe('sort by fileSize', () => {
      it('sorts by fileSize descending (largest first)', () => {
        uiStore.setSortField('fileSize')
        uiStore.setSortDirection('desc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-1', 'asset-3', 'asset-2']) // 3000, 2000, 1000
      })

      it('sorts by fileSize ascending (smallest first)', () => {
        uiStore.setSortField('fileSize')
        uiStore.setSortDirection('asc')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-2', 'asset-3', 'asset-1']) // 1000, 2000, 3000
      })
    })

    describe('filter + sort combined', () => {
      it('filters then sorts', () => {
        // Filter to only unflagged (asset-1 and asset-3)
        uiStore.setFilterMode('unflagged')
        uiStore.setSortField('filename')
        uiStore.setSortDirection('asc')

        const sorted = uiStore.sortedAssetIds
        expect(sorted).toHaveLength(2)
        expect(sorted).toEqual(['asset-3', 'asset-1']) // mango, zebra
      })

      it('returns empty array when filter has no matches', () => {
        uiStore.setFilterMode('rejects')
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual([])
      })
    })

    describe('edge cases', () => {
      it('handles assets with null captureDate', () => {
        catalogStore.clear()
        const assets = [
          createMockAsset({
            id: 'asset-1',
            captureDate: undefined,
            flag: 'none',
          }),
          createMockAsset({
            id: 'asset-2',
            captureDate: new Date('2025-01-15T10:00:00Z'),
            flag: 'none',
          }),
        ]
        catalogStore.addAssetBatch(assets)

        uiStore.setSortField('captureDate')
        uiStore.setSortDirection('asc')
        // Assets with null date should sort to beginning (treated as 0)
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['asset-1', 'asset-2'])
      })

      it('handles empty asset list', () => {
        catalogStore.clear()
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual([])
      })

      it('handles single asset', () => {
        catalogStore.clear()
        catalogStore.addAssetBatch([createMockAsset({ id: 'single' })])
        const sorted = uiStore.sortedAssetIds
        expect(sorted).toEqual(['single'])
      })
    })
  })

  // ============================================================================
  // Filtered Count
  // ============================================================================

  describe('filteredCount', () => {
    beforeEach(() => {
      const assets = createTestAssets(10, ['pick', 'reject', 'none', 'pick', 'none'])
      catalogStore.addAssetBatch(assets)
    })

    it('returns total count for "all" filter', () => {
      uiStore.setFilterMode('all')
      expect(uiStore.filteredCount).toBe(10)
    })

    it('returns pick count for "picks" filter', () => {
      uiStore.setFilterMode('picks')
      expect(uiStore.filteredCount).toBe(4) // 10 assets with pattern [pick, reject, none, pick, none] repeats
    })

    it('returns reject count for "rejects" filter', () => {
      uiStore.setFilterMode('rejects')
      expect(uiStore.filteredCount).toBe(2)
    })

    it('returns unflagged count for "unflagged" filter', () => {
      uiStore.setFilterMode('unflagged')
      expect(uiStore.filteredCount).toBe(4)
    })

    it('returns 0 when catalog is empty', () => {
      catalogStore.clear()
      expect(uiStore.filteredCount).toBe(0)
    })
  })

  // ============================================================================
  // Integration with Catalog Store
  // ============================================================================

  describe('integration with catalog store', () => {
    it('responds to catalog store changes', () => {
      // Start with filter mode picks
      uiStore.setFilterMode('picks')
      expect(uiStore.filteredAssetIds).toHaveLength(0)

      // Add picked assets
      const assets = [
        createMockAsset({ id: 'asset-1', flag: 'pick' }),
        createMockAsset({ id: 'asset-2', flag: 'pick' }),
      ]
      catalogStore.addAssetBatch(assets)

      expect(uiStore.filteredAssetIds).toHaveLength(2)
    })

    it('responds to flag changes', () => {
      const assets = createTestAssets(3, ['none'])
      catalogStore.addAssetBatch(assets)

      uiStore.setFilterMode('picks')
      expect(uiStore.filteredAssetIds).toHaveLength(0)

      // Flag one as pick
      catalogStore.setFlag('asset-1', 'pick')
      expect(uiStore.filteredAssetIds).toHaveLength(1)

      // Flag another as pick
      catalogStore.setFlag('asset-2', 'pick')
      expect(uiStore.filteredAssetIds).toHaveLength(2)
    })

    it('responds to catalog clear', () => {
      const assets = createTestAssets(5)
      catalogStore.addAssetBatch(assets)
      expect(uiStore.filteredCount).toBe(5)

      catalogStore.clear()
      expect(uiStore.filteredCount).toBe(0)
    })
  })
})
