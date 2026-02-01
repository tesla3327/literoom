/**
 * Unit tests for the catalog store's removeAssetBatch method.
 *
 * Tests asset removal including:
 * - Removing assets from the assets Map
 * - Removing IDs from the assetIds array
 * - Handling empty arrays and non-existent IDs
 * - Revoking blob URLs to prevent memory leaks
 * - Updating computed counts after removal
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'
import type { Asset } from '@literoom/core/catalog'

/**
 * Helper to create a test asset with sensible defaults.
 */
function createTestAsset(overrides: Partial<Asset> = {}): Asset {
  const id = overrides.id ?? crypto.randomUUID()
  return {
    id,
    folderId: 'folder-1',
    path: `/photos/${id}.arw`,
    filename: id,
    extension: 'arw',
    flag: 'none',
    captureDate: new Date('2024-01-15'),
    modifiedDate: new Date('2024-01-15'),
    fileSize: 25000000,
    width: 6000,
    height: 4000,
    thumbnailStatus: 'ready',
    thumbnailUrl: `blob:http://localhost/thumbnail-${id}`,
    preview1xStatus: 'ready',
    preview1xUrl: `blob:http://localhost/preview-${id}`,
    ...overrides,
  }
}

describe('catalogStore - removeAssetBatch', () => {
  let store: ReturnType<typeof useCatalogStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useCatalogStore()
    vi.clearAllMocks()
  })

  // ============================================================================
  // Basic Removal
  // ============================================================================

  describe('basic removal', () => {
    it('removes assets from the assets Map', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.assets.size).toBe(3)

      store.removeAssetBatch(['asset-1', 'asset-3'])

      expect(store.assets.size).toBe(1)
      expect(store.assets.get('asset-1')).toBeUndefined()
      expect(store.assets.get('asset-2')).toBeDefined()
      expect(store.assets.get('asset-3')).toBeUndefined()
    })

    it('removes IDs from the assetIds array', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.assetIds).toHaveLength(3)

      store.removeAssetBatch(['asset-1', 'asset-3'])

      expect(store.assetIds).toHaveLength(1)
      expect(store.assetIds).toContain('asset-2')
      expect(store.assetIds).not.toContain('asset-1')
      expect(store.assetIds).not.toContain('asset-3')
    })

    it('maintains asset order after removal', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })
      const asset4 = createTestAsset({ id: 'asset-4' })

      store.addAssetBatch([asset1, asset2, asset3, asset4])
      store.removeAssetBatch(['asset-2'])

      expect(store.assetIds).toEqual(['asset-1', 'asset-3', 'asset-4'])
    })

    it('removes a single asset', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])
      store.removeAssetBatch(['asset-1'])

      expect(store.assets.size).toBe(1)
      expect(store.assetIds).toEqual(['asset-2'])
    })

    it('removes all assets when all IDs are provided', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])
      store.removeAssetBatch(['asset-1', 'asset-2'])

      expect(store.assets.size).toBe(0)
      expect(store.assetIds).toHaveLength(0)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty array (no-op)', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])
      const originalSize = store.assets.size
      const originalIds = [...store.assetIds]

      store.removeAssetBatch([])

      expect(store.assets.size).toBe(originalSize)
      expect(store.assetIds).toEqual(originalIds)
    })

    it('handles non-existent IDs gracefully', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])

      // Should not throw, should silently ignore non-existent IDs
      store.removeAssetBatch(['non-existent-1', 'non-existent-2'])

      expect(store.assets.size).toBe(2)
      expect(store.assetIds).toHaveLength(2)
    })

    it('handles mix of existent and non-existent IDs', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })

      store.addAssetBatch([asset1, asset2, asset3])

      store.removeAssetBatch(['asset-1', 'non-existent', 'asset-3'])

      expect(store.assets.size).toBe(1)
      expect(store.assetIds).toEqual(['asset-2'])
    })

    it('handles duplicate IDs in removal array', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])

      store.removeAssetBatch(['asset-1', 'asset-1', 'asset-1'])

      expect(store.assets.size).toBe(1)
      expect(store.assetIds).toEqual(['asset-2'])
    })

    it('handles removal from empty store', () => {
      // Store is empty initially
      expect(store.assets.size).toBe(0)
      expect(store.assetIds).toHaveLength(0)

      // Should not throw
      store.removeAssetBatch(['asset-1', 'asset-2'])

      expect(store.assets.size).toBe(0)
      expect(store.assetIds).toHaveLength(0)
    })
  })

  // ============================================================================
  // Blob URL Revocation
  // ============================================================================

  describe('blob URL revocation', () => {
    it('revokes thumbnail blob URLs', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailUrl: 'blob:http://localhost/thumbnail-1',
      })
      const asset2 = createTestAsset({
        id: 'asset-2',
        thumbnailUrl: 'blob:http://localhost/thumbnail-2',
      })

      store.addAssetBatch([asset1, asset2])
      store.removeAssetBatch(['asset-1'])

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/thumbnail-1')
      expect(revokeObjectURLSpy).not.toHaveBeenCalledWith('blob:http://localhost/thumbnail-2')

      revokeObjectURLSpy.mockRestore()
    })

    it('revokes preview blob URLs', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        preview1xUrl: 'blob:http://localhost/preview-1',
      })
      const asset2 = createTestAsset({
        id: 'asset-2',
        preview1xUrl: 'blob:http://localhost/preview-2',
      })

      store.addAssetBatch([asset1, asset2])
      store.removeAssetBatch(['asset-1'])

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1')
      expect(revokeObjectURLSpy).not.toHaveBeenCalledWith('blob:http://localhost/preview-2')

      revokeObjectURLSpy.mockRestore()
    })

    it('revokes both thumbnail and preview URLs', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailUrl: 'blob:http://localhost/thumbnail-1',
        preview1xUrl: 'blob:http://localhost/preview-1',
      })

      store.addAssetBatch([asset1])
      store.removeAssetBatch(['asset-1'])

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/thumbnail-1')
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1')
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2)

      revokeObjectURLSpy.mockRestore()
    })

    it('handles assets without URLs (null URLs)', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailUrl: null,
        preview1xUrl: null,
      })

      store.addAssetBatch([asset1])
      store.removeAssetBatch(['asset-1'])

      // Should not call revokeObjectURL for null URLs
      expect(revokeObjectURLSpy).not.toHaveBeenCalled()

      revokeObjectURLSpy.mockRestore()
    })

    it('handles assets with only thumbnail URL', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailUrl: 'blob:http://localhost/thumbnail-1',
        preview1xUrl: null,
      })

      store.addAssetBatch([asset1])
      store.removeAssetBatch(['asset-1'])

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/thumbnail-1')
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)

      revokeObjectURLSpy.mockRestore()
    })

    it('does not revoke URLs for non-existent assets', () => {
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailUrl: 'blob:http://localhost/thumbnail-1',
      })

      store.addAssetBatch([asset1])
      store.removeAssetBatch(['non-existent'])

      expect(revokeObjectURLSpy).not.toHaveBeenCalled()

      revokeObjectURLSpy.mockRestore()
    })
  })

  // ============================================================================
  // Computed Counts
  // ============================================================================

  describe('computed counts update after removal', () => {
    it('totalCount updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.totalCount).toBe(3)

      store.removeAssetBatch(['asset-1'])
      expect(store.totalCount).toBe(2)

      store.removeAssetBatch(['asset-2', 'asset-3'])
      expect(store.totalCount).toBe(0)
    })

    it('pickCount updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', flag: 'pick' })
      const asset2 = createTestAsset({ id: 'asset-2', flag: 'pick' })
      const asset3 = createTestAsset({ id: 'asset-3', flag: 'none' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.pickCount).toBe(2)

      store.removeAssetBatch(['asset-1'])
      expect(store.pickCount).toBe(1)

      store.removeAssetBatch(['asset-2'])
      expect(store.pickCount).toBe(0)
    })

    it('rejectCount updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', flag: 'reject' })
      const asset2 = createTestAsset({ id: 'asset-2', flag: 'reject' })
      const asset3 = createTestAsset({ id: 'asset-3', flag: 'none' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.rejectCount).toBe(2)

      store.removeAssetBatch(['asset-1'])
      expect(store.rejectCount).toBe(1)
    })

    it('unflaggedCount updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', flag: 'none' })
      const asset2 = createTestAsset({ id: 'asset-2', flag: 'none' })
      const asset3 = createTestAsset({ id: 'asset-3', flag: 'pick' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.unflaggedCount).toBe(2)

      store.removeAssetBatch(['asset-1'])
      expect(store.unflaggedCount).toBe(1)
    })

    it('flagCounts updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', flag: 'pick' })
      const asset2 = createTestAsset({ id: 'asset-2', flag: 'reject' })
      const asset3 = createTestAsset({ id: 'asset-3', flag: 'none' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.flagCounts).toEqual({
        all: 3,
        picks: 1,
        rejects: 1,
        unflagged: 1,
      })

      store.removeAssetBatch(['asset-1'])
      expect(store.flagCounts).toEqual({
        all: 2,
        picks: 0,
        rejects: 1,
        unflagged: 1,
      })
    })

    it('thumbnailProgress updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', thumbnailStatus: 'ready' })
      const asset2 = createTestAsset({ id: 'asset-2', thumbnailStatus: 'pending' })
      const asset3 = createTestAsset({ id: 'asset-3', thumbnailStatus: 'ready' })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.thumbnailProgress.ready).toBe(2)
      expect(store.thumbnailProgress.pending).toBe(1)
      expect(store.thumbnailProgress.total).toBe(3)

      store.removeAssetBatch(['asset-1'])
      expect(store.thumbnailProgress.ready).toBe(1)
      expect(store.thumbnailProgress.pending).toBe(1)
      expect(store.thumbnailProgress.total).toBe(2)
    })

    it('readyCount updates correctly', () => {
      const asset1 = createTestAsset({
        id: 'asset-1',
        thumbnailStatus: 'ready',
        preview1xStatus: 'ready',
      })
      const asset2 = createTestAsset({
        id: 'asset-2',
        thumbnailStatus: 'ready',
        preview1xStatus: 'pending',
      })
      const asset3 = createTestAsset({
        id: 'asset-3',
        thumbnailStatus: 'ready',
        preview1xStatus: 'ready',
      })

      store.addAssetBatch([asset1, asset2, asset3])
      expect(store.readyCount).toBe(2)

      store.removeAssetBatch(['asset-1'])
      expect(store.readyCount).toBe(1)
    })

    it('thumbnailPercent updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', thumbnailStatus: 'ready' })
      const asset2 = createTestAsset({ id: 'asset-2', thumbnailStatus: 'ready' })
      const asset3 = createTestAsset({ id: 'asset-3', thumbnailStatus: 'pending' })
      const asset4 = createTestAsset({ id: 'asset-4', thumbnailStatus: 'pending' })

      store.addAssetBatch([asset1, asset2, asset3, asset4])
      expect(store.thumbnailPercent).toBe(50) // 2 ready out of 4

      store.removeAssetBatch(['asset-3', 'asset-4'])
      expect(store.thumbnailPercent).toBe(100) // 2 ready out of 2
    })

    it('isProcessingThumbnails updates correctly', () => {
      const asset1 = createTestAsset({ id: 'asset-1', thumbnailStatus: 'ready' })
      const asset2 = createTestAsset({ id: 'asset-2', thumbnailStatus: 'pending' })

      store.addAssetBatch([asset1, asset2])
      expect(store.isProcessingThumbnails).toBe(true)

      store.removeAssetBatch(['asset-2'])
      expect(store.isProcessingThumbnails).toBe(false)
    })
  })

  // ============================================================================
  // Interaction with getOrderedAssets
  // ============================================================================

  describe('interaction with getOrderedAssets', () => {
    it('getOrderedAssets reflects removal', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })
      const asset3 = createTestAsset({ id: 'asset-3' })

      store.addAssetBatch([asset1, asset2, asset3])

      let ordered = store.getOrderedAssets()
      expect(ordered).toHaveLength(3)
      expect(ordered.map(a => a.id)).toEqual(['asset-1', 'asset-2', 'asset-3'])

      store.removeAssetBatch(['asset-2'])

      ordered = store.getOrderedAssets()
      expect(ordered).toHaveLength(2)
      expect(ordered.map(a => a.id)).toEqual(['asset-1', 'asset-3'])
    })
  })

  // ============================================================================
  // Reactivity
  // ============================================================================

  describe('reactivity', () => {
    it('triggers reactivity on assets ref', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])
      const originalRef = store.assets

      store.removeAssetBatch(['asset-1'])

      // shallowRef should create a new Map reference
      expect(store.assets).not.toBe(originalRef)
    })

    it('triggers reactivity on assetIds ref', () => {
      const asset1 = createTestAsset({ id: 'asset-1' })
      const asset2 = createTestAsset({ id: 'asset-2' })

      store.addAssetBatch([asset1, asset2])
      const originalRef = store.assetIds

      store.removeAssetBatch(['asset-1'])

      // shallowRef should create a new array reference
      expect(store.assetIds).not.toBe(originalRef)
    })
  })
})
