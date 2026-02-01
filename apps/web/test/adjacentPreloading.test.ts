/**
 * Tests for Adjacent Photo Preloading functionality
 *
 * Tests the logic for preloading adjacent photos in the catalog.
 * The actual composable integration is tested via E2E tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogStore } from '../app/stores/catalog'
import { useCatalogUIStore } from '../app/stores/catalogUI'
import type { Asset } from '@literoom/core/catalog'
import { ThumbnailPriority } from '@literoom/core/catalog'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock asset for testing.
 */
function createMockAsset(
  id: string,
  index: number,
  options: { preview1xStatus?: 'pending' | 'ready' | 'loading' | 'error' } = {},
): Asset {
  return {
    id,
    folderId: 'folder-1',
    path: `/photos/img${index}.jpg`,
    filename: `img${index}`,
    extension: 'jpg',
    flag: 'none' as const,
    captureDate: new Date(2024, 0, 1 + index),
    modifiedDate: new Date(2024, 0, 1 + index),
    fileSize: 1000,
    thumbnailStatus: 'ready' as const,
    thumbnailUrl: `blob:thumb-${index}`,
    preview1xStatus: options.preview1xStatus ?? 'pending',
    preview1xUrl: options.preview1xStatus === 'ready' ? `blob:preview-${index}` : null,
  }
}

/**
 * Populate the catalog store with mock assets.
 */
function populateCatalog(
  catalogStore: ReturnType<typeof useCatalogStore>,
  count: number,
  previewReadyIndices: number[] = [],
): Asset[] {
  const assets: Asset[] = []
  for (let i = 0; i < count; i++) {
    const isPreviewReady = previewReadyIndices.includes(i)
    assets.push(createMockAsset(`asset-${i}`, i, {
      preview1xStatus: isPreviewReady ? 'ready' : 'pending',
    }))
  }
  catalogStore.addAssetBatch(assets)
  return assets
}

/**
 * Get adjacent asset IDs for a given asset in the sorted list.
 * This mirrors the logic in useCatalog.preloadAdjacentPreviews().
 */
function getAdjacentAssetIds(
  sortedIds: string[],
  currentAssetId: string,
  range: number,
): string[] {
  const currentIndex = sortedIds.indexOf(currentAssetId)
  if (currentIndex === -1) return []

  const adjacentIds: string[] = []

  for (let offset = 1; offset <= range; offset++) {
    // Previous assets
    const prevIndex = currentIndex - offset
    if (prevIndex >= 0) {
      adjacentIds.push(sortedIds[prevIndex])
    }

    // Next assets
    const nextIndex = currentIndex + offset
    if (nextIndex < sortedIds.length) {
      adjacentIds.push(sortedIds[nextIndex])
    }
  }

  return adjacentIds
}

/**
 * Filter assets that need preview preloading (not already ready).
 */
function filterAssetsNeedingPreload(
  catalogStore: ReturnType<typeof useCatalogStore>,
  assetIds: string[],
): string[] {
  return assetIds.filter((id) => {
    const asset = catalogStore.getAsset(id)
    return asset && asset.preview1xStatus !== 'ready'
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('Adjacent Photo Preloading', () => {
  let catalogStore: ReturnType<typeof useCatalogStore>
  let catalogUIStore: ReturnType<typeof useCatalogUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    catalogStore = useCatalogStore()
    catalogUIStore = useCatalogUIStore()
    // Clear sessionStorage before each test
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getAdjacentAssetIds (preloading logic)', () => {
    it('returns correct adjacent IDs for asset in middle of list', () => {
      populateCatalog(catalogStore, 10)
      const sortedIds = catalogUIStore.sortedAssetIds

      expect(sortedIds.length).toBe(10)

      // Asset-5 is in the middle
      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-5', 2)

      // Should include N±1 and N±2
      expect(adjacentIds).toHaveLength(4)
      expect(adjacentIds).toContain('asset-4') // N-1
      expect(adjacentIds).toContain('asset-3') // N-2
      expect(adjacentIds).toContain('asset-6') // N+1
      expect(adjacentIds).toContain('asset-7') // N+2
    })

    it('returns only forward neighbors at start of list', () => {
      populateCatalog(catalogStore, 5)
      const sortedIds = catalogUIStore.sortedAssetIds

      // Asset-0 is at the start
      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-0', 2)

      // Should only include N+1 and N+2
      expect(adjacentIds).toHaveLength(2)
      expect(adjacentIds).toContain('asset-1') // N+1
      expect(adjacentIds).toContain('asset-2') // N+2
    })

    it('returns only backward neighbors at end of list', () => {
      populateCatalog(catalogStore, 5)
      const sortedIds = catalogUIStore.sortedAssetIds

      // Asset-4 is at the end (last of 5 assets: 0,1,2,3,4)
      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-4', 2)

      // Should only include N-1 and N-2
      expect(adjacentIds).toHaveLength(2)
      expect(adjacentIds).toContain('asset-3') // N-1
      expect(adjacentIds).toContain('asset-2') // N-2
    })

    it('handles asset at position 1 (partial backward range)', () => {
      populateCatalog(catalogStore, 5)
      const sortedIds = catalogUIStore.sortedAssetIds

      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-1', 2)

      // N-1 only (no N-2), plus N+1 and N+2
      expect(adjacentIds).toHaveLength(3)
      expect(adjacentIds).toContain('asset-0') // N-1
      expect(adjacentIds).toContain('asset-2') // N+1
      expect(adjacentIds).toContain('asset-3') // N+2
    })

    it('returns empty array for asset not in list', () => {
      populateCatalog(catalogStore, 5)
      const sortedIds = catalogUIStore.sortedAssetIds

      const adjacentIds = getAdjacentAssetIds(sortedIds, 'non-existent', 2)

      expect(adjacentIds).toHaveLength(0)
    })

    it('returns empty array for single-asset catalog', () => {
      populateCatalog(catalogStore, 1)
      const sortedIds = catalogUIStore.sortedAssetIds

      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-0', 2)

      expect(adjacentIds).toHaveLength(0)
    })

    it('respects custom range parameter', () => {
      populateCatalog(catalogStore, 10)
      const sortedIds = catalogUIStore.sortedAssetIds

      // With range of 1, should only get immediate neighbors
      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-5', 1)

      expect(adjacentIds).toHaveLength(2)
      expect(adjacentIds).toContain('asset-4') // N-1
      expect(adjacentIds).toContain('asset-6') // N+1
    })

    it('works with larger range', () => {
      populateCatalog(catalogStore, 10)
      const sortedIds = catalogUIStore.sortedAssetIds

      const adjacentIds = getAdjacentAssetIds(sortedIds, 'asset-5', 3)

      expect(adjacentIds).toHaveLength(6)
      expect(adjacentIds).toContain('asset-2') // N-3
      expect(adjacentIds).toContain('asset-3') // N-2
      expect(adjacentIds).toContain('asset-4') // N-1
      expect(adjacentIds).toContain('asset-6') // N+1
      expect(adjacentIds).toContain('asset-7') // N+2
      expect(adjacentIds).toContain('asset-8') // N+3
    })
  })

  describe('filterAssetsNeedingPreload', () => {
    it('filters out assets with ready previews', () => {
      // Create catalog with some ready previews
      populateCatalog(catalogStore, 5, [0, 2]) // assets 0 and 2 have ready previews

      const allIds = ['asset-0', 'asset-1', 'asset-2', 'asset-3', 'asset-4']
      const needingPreload = filterAssetsNeedingPreload(catalogStore, allIds)

      expect(needingPreload).toHaveLength(3)
      expect(needingPreload).not.toContain('asset-0') // Already ready
      expect(needingPreload).toContain('asset-1')
      expect(needingPreload).not.toContain('asset-2') // Already ready
      expect(needingPreload).toContain('asset-3')
      expect(needingPreload).toContain('asset-4')
    })

    it('returns all assets when none have ready previews', () => {
      populateCatalog(catalogStore, 3)

      const allIds = ['asset-0', 'asset-1', 'asset-2']
      const needingPreload = filterAssetsNeedingPreload(catalogStore, allIds)

      expect(needingPreload).toHaveLength(3)
    })

    it('returns empty when all assets have ready previews', () => {
      populateCatalog(catalogStore, 3, [0, 1, 2]) // All ready

      const allIds = ['asset-0', 'asset-1', 'asset-2']
      const needingPreload = filterAssetsNeedingPreload(catalogStore, allIds)

      expect(needingPreload).toHaveLength(0)
    })

    it('ignores non-existent asset IDs', () => {
      populateCatalog(catalogStore, 2)

      const allIds = ['asset-0', 'non-existent', 'asset-1']
      const needingPreload = filterAssetsNeedingPreload(catalogStore, allIds)

      expect(needingPreload).toHaveLength(2)
      expect(needingPreload).not.toContain('non-existent')
    })
  })

  describe('combined preloading logic', () => {
    it('correctly determines assets to preload in typical scenario', () => {
      // Catalog with 10 assets, some with ready previews
      populateCatalog(catalogStore, 10, [3, 7]) // assets 3 and 7 have ready previews
      const sortedIds = catalogUIStore.sortedAssetIds

      // User is viewing asset-5
      const currentAssetId = 'asset-5'
      const range = 2

      // Step 1: Get adjacent IDs
      const adjacentIds = getAdjacentAssetIds(sortedIds, currentAssetId, range)
      expect(adjacentIds).toContain('asset-3') // N-2
      expect(adjacentIds).toContain('asset-4') // N-1
      expect(adjacentIds).toContain('asset-6') // N+1
      expect(adjacentIds).toContain('asset-7') // N+2

      // Step 2: Filter to only those needing preload
      const needingPreload = filterAssetsNeedingPreload(catalogStore, adjacentIds)

      // asset-3 and asset-7 are ready, so only asset-4 and asset-6 need preloading
      expect(needingPreload).toHaveLength(2)
      expect(needingPreload).toContain('asset-4')
      expect(needingPreload).toContain('asset-6')
      expect(needingPreload).not.toContain('asset-3') // Already ready
      expect(needingPreload).not.toContain('asset-7') // Already ready
    })
  })

  describe('ThumbnailPriority constants', () => {
    it('BACKGROUND priority has lowest priority value (3)', () => {
      expect(ThumbnailPriority.BACKGROUND).toBe(3)
    })

    it('VISIBLE priority has highest priority value (0)', () => {
      expect(ThumbnailPriority.VISIBLE).toBe(0)
    })

    it('BACKGROUND is lower priority than PRELOAD', () => {
      expect(ThumbnailPriority.BACKGROUND).toBeGreaterThan(ThumbnailPriority.PRELOAD)
    })
  })
})
