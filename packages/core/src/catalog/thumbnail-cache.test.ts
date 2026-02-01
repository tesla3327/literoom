/**
 * Unit tests for the MemoryThumbnailCache.
 *
 * Note: OPFS tests would require a browser environment with OPFS support.
 * These tests focus on the MemoryThumbnailCache which can be tested in Node.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MemoryThumbnailCache,
  createMemoryCache,
  OPFSThumbnailCache,
  createOPFSCache,
  OPFSPreviewCache,
  ThumbnailCache,
  createThumbnailCache,
  PreviewCache,
  createPreviewCache,
} from './thumbnail-cache'

// ============================================================================
// Mock URL object
// ============================================================================

const mockUrls = new Map<string, Blob>()
let urlCounter = 0

// Mock URL.createObjectURL and URL.revokeObjectURL
const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL

beforeEach(() => {
  mockUrls.clear()
  urlCounter = 0

  globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:mock-url-${urlCounter++}`
    mockUrls.set(url, blob)
    return url
  })

  globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
    mockUrls.delete(url)
  })
})

afterEach(() => {
  globalThis.URL.createObjectURL = originalCreateObjectURL
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL
})

// ============================================================================
// Helper Functions
// ============================================================================

function createTestBlob(size: number = 100): Blob {
  const data = new Uint8Array(size).fill(0)
  return new Blob([data], { type: 'image/jpeg' })
}

// ============================================================================
// Tests
// ============================================================================

describe('MemoryThumbnailCache', () => {
  let cache: MemoryThumbnailCache

  beforeEach(() => {
    cache = new MemoryThumbnailCache(5)
  })

  describe('set and get', () => {
    it('should store and retrieve a thumbnail', () => {
      const blob = createTestBlob()
      const url = cache.set('asset1', blob)

      expect(url).toMatch(/^blob:/)
      expect(cache.get('asset1')).toBe(url)
    })

    it('should return null for non-existent asset', () => {
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('should replace existing entry', () => {
      const blob1 = createTestBlob(100)
      const blob2 = createTestBlob(200)

      const url1 = cache.set('asset1', blob1)
      const url2 = cache.set('asset1', blob2)

      expect(url1).not.toBe(url2)
      expect(cache.get('asset1')).toBe(url2)
      expect(cache.size).toBe(1)

      // Old URL should be revoked
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url1)
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used item when at capacity', () => {
      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        cache.set(`asset${i}`, createTestBlob())
      }

      expect(cache.size).toBe(5)

      // Add one more - should evict asset0 (oldest)
      cache.set('asset5', createTestBlob())

      expect(cache.size).toBe(5)
      expect(cache.has('asset0')).toBe(false)
      expect(cache.has('asset5')).toBe(true)
    })

    it('should update access order on get', () => {
      // Fill cache
      cache.set('asset0', createTestBlob())
      cache.set('asset1', createTestBlob())
      cache.set('asset2', createTestBlob())
      cache.set('asset3', createTestBlob())
      cache.set('asset4', createTestBlob())

      // Access asset0 to make it "recently used"
      cache.get('asset0')

      // Add new item - should evict asset1 (now the oldest)
      cache.set('asset5', createTestBlob())

      expect(cache.has('asset0')).toBe(true)
      expect(cache.has('asset1')).toBe(false)
    })

    it('should evict in correct order', () => {
      cache.set('a', createTestBlob())
      cache.set('b', createTestBlob())
      cache.set('c', createTestBlob())
      cache.set('d', createTestBlob())
      cache.set('e', createTestBlob())

      // Access in order: c, a, e
      cache.get('c')
      cache.get('a')
      cache.get('e')

      // Add 3 new items - should evict b, d, then c (in LRU order)
      cache.set('f', createTestBlob())
      expect(cache.has('b')).toBe(false)

      cache.set('g', createTestBlob())
      expect(cache.has('d')).toBe(false)

      cache.set('h', createTestBlob())
      expect(cache.has('c')).toBe(false)

      // a, e should still be present (were accessed recently)
      expect(cache.has('a')).toBe(true)
      expect(cache.has('e')).toBe(true)
    })
  })

  describe('has', () => {
    it('should return false for empty cache', () => {
      expect(cache.has('asset1')).toBe(false)
    })

    it('should return true for existing item', () => {
      cache.set('asset1', createTestBlob())
      expect(cache.has('asset1')).toBe(true)
    })
  })

  describe('delete', () => {
    it('should remove item from cache', () => {
      const url = cache.set('asset1', createTestBlob())
      cache.delete('asset1')

      expect(cache.has('asset1')).toBe(false)
      expect(cache.get('asset1')).toBeNull()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    })

    it('should do nothing for non-existent item', () => {
      cache.delete('nonexistent')
      expect(cache.size).toBe(0)
    })
  })

  describe('clear', () => {
    it('should remove all items', () => {
      cache.set('asset1', createTestBlob())
      cache.set('asset2', createTestBlob())
      cache.set('asset3', createTestBlob())

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.has('asset1')).toBe(false)
      expect(cache.has('asset2')).toBe(false)
      expect(cache.has('asset3')).toBe(false)
    })

    it('should revoke all URLs', () => {
      const url1 = cache.set('asset1', createTestBlob())
      const url2 = cache.set('asset2', createTestBlob())

      cache.clear()

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url2)
    })
  })

  describe('getBlob', () => {
    it('should return the blob for existing item', () => {
      const blob = createTestBlob(123)
      cache.set('asset1', blob)

      const retrieved = cache.getBlob('asset1')
      expect(retrieved).toBe(blob)
    })

    it('should return null for non-existent item', () => {
      expect(cache.getBlob('nonexistent')).toBeNull()
    })
  })

  describe('size', () => {
    it('should track size correctly', () => {
      expect(cache.size).toBe(0)

      cache.set('asset1', createTestBlob())
      expect(cache.size).toBe(1)

      cache.set('asset2', createTestBlob())
      expect(cache.size).toBe(2)

      cache.delete('asset1')
      expect(cache.size).toBe(1)
    })
  })
})

describe('createMemoryCache', () => {
  it('should create a cache with default size', () => {
    const cache = createMemoryCache()
    expect(cache).toBeInstanceOf(MemoryThumbnailCache)
  })

  it('should create a cache with custom size', () => {
    const cache = createMemoryCache(3)

    // Fill beyond capacity
    cache.set('a', createTestBlob())
    cache.set('b', createTestBlob())
    cache.set('c', createTestBlob())
    cache.set('d', createTestBlob())

    expect(cache.size).toBe(3)
  })

  it('should return a fresh instance each time', () => {
    const cache1 = createMemoryCache()
    const cache2 = createMemoryCache()

    expect(cache1).not.toBe(cache2)
  })

  it('should create independent caches', () => {
    const cache1 = createMemoryCache(5)
    const cache2 = createMemoryCache(5)

    cache1.set('asset1', createTestBlob())

    expect(cache1.has('asset1')).toBe(true)
    expect(cache2.has('asset1')).toBe(false)
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createOPFSCache', () => {
  it('should return an OPFSThumbnailCache instance', () => {
    const cache = createOPFSCache()
    expect(cache).toBeInstanceOf(OPFSThumbnailCache)
  })

  it('should return a fresh instance each time', () => {
    const cache1 = createOPFSCache()
    const cache2 = createOPFSCache()

    expect(cache1).not.toBe(cache2)
  })
})

describe('createThumbnailCache', () => {
  it('should return a ThumbnailCache instance', () => {
    const cache = createThumbnailCache()
    expect(cache).toBeInstanceOf(ThumbnailCache)
  })

  it('should accept custom memory cache size', () => {
    const cache = createThumbnailCache(50)
    expect(cache).toBeInstanceOf(ThumbnailCache)
  })

  it('should return a fresh instance each time', () => {
    const cache1 = createThumbnailCache()
    const cache2 = createThumbnailCache()

    expect(cache1).not.toBe(cache2)
  })
})

describe('createPreviewCache', () => {
  it('should return a PreviewCache instance', () => {
    const cache = createPreviewCache()
    expect(cache).toBeInstanceOf(PreviewCache)
  })

  it('should accept custom memory cache size', () => {
    const cache = createPreviewCache(10)
    expect(cache).toBeInstanceOf(PreviewCache)
  })

  it('should use default size of 50 when not specified', () => {
    const cache = createPreviewCache()
    expect(cache).toBeInstanceOf(PreviewCache)

    // Fill up to 50 items to test default size
    for (let i = 0; i < 50; i++) {
      cache.set(`asset${i}`, createTestBlob())
    }
    expect(cache.memoryCacheSize).toBe(50)

    // Adding one more should evict, keeping size at 50
    cache.set('asset50', createTestBlob())
    expect(cache.memoryCacheSize).toBe(50)
  })

  it('should return a fresh instance each time', () => {
    const cache1 = createPreviewCache()
    const cache2 = createPreviewCache()

    expect(cache1).not.toBe(cache2)
  })
})

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('MemoryThumbnailCache edge cases', () => {
  describe('empty cache operations', () => {
    it('should not throw when calling clear() on empty cache', () => {
      const cache = new MemoryThumbnailCache(5)
      expect(() => cache.clear()).not.toThrow()
      expect(cache.size).toBe(0)
    })

    it('should not throw when calling delete() on empty cache', () => {
      const cache = new MemoryThumbnailCache(5)
      expect(() => cache.delete('nonexistent')).not.toThrow()
      expect(cache.size).toBe(0)
    })

    it('should return null when calling get() on empty cache', () => {
      const cache = new MemoryThumbnailCache(5)
      expect(cache.get('nonexistent')).toBeNull()
    })
  })

  describe('single item cache (maxSize = 1)', () => {
    let cache: MemoryThumbnailCache

    beforeEach(() => {
      cache = new MemoryThumbnailCache(1)
    })

    it('should handle single item cache correctly', () => {
      const blob = createTestBlob()
      const url = cache.set('asset1', blob)

      expect(cache.size).toBe(1)
      expect(cache.get('asset1')).toBe(url)
    })

    it('should evict immediately when adding second item', () => {
      const url1 = cache.set('asset1', createTestBlob())
      const url2 = cache.set('asset2', createTestBlob())

      expect(cache.size).toBe(1)
      expect(cache.has('asset1')).toBe(false)
      expect(cache.has('asset2')).toBe(true)
      expect(cache.get('asset2')).toBe(url2)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url1)
    })

    it('should handle LRU behavior with single item', () => {
      cache.set('asset1', createTestBlob())

      // Access the item
      cache.get('asset1')

      // Adding new item should still evict the only item
      cache.set('asset2', createTestBlob())

      expect(cache.size).toBe(1)
      expect(cache.has('asset1')).toBe(false)
      expect(cache.has('asset2')).toBe(true)
    })
  })

  describe('large maxSize', () => {
    it('should handle very large maxSize (10000)', () => {
      const cache = new MemoryThumbnailCache(10000)

      // Add a few items
      cache.set('asset1', createTestBlob())
      cache.set('asset2', createTestBlob())
      cache.set('asset3', createTestBlob())

      expect(cache.size).toBe(3)
      expect(cache.has('asset1')).toBe(true)
      expect(cache.has('asset2')).toBe(true)
      expect(cache.has('asset3')).toBe(true)
    })

    it('should not pre-allocate memory', () => {
      const cache = new MemoryThumbnailCache(10000)

      // Cache should start empty regardless of maxSize
      expect(cache.size).toBe(0)

      // Add one item
      cache.set('asset1', createTestBlob())
      expect(cache.size).toBe(1)
    })
  })

  describe('special asset IDs', () => {
    let cache: MemoryThumbnailCache

    beforeEach(() => {
      cache = new MemoryThumbnailCache(10)
    })

    it('should handle empty string as asset ID', () => {
      const blob = createTestBlob()
      const url = cache.set('', blob)

      expect(cache.has('')).toBe(true)
      expect(cache.get('')).toBe(url)
      expect(cache.size).toBe(1)
    })

    it('should handle very long asset IDs', () => {
      const longId = 'a'.repeat(10000)
      const blob = createTestBlob()
      const url = cache.set(longId, blob)

      expect(cache.has(longId)).toBe(true)
      expect(cache.get(longId)).toBe(url)
    })

    it('should handle asset IDs with special characters', () => {
      const specialIds = [
        'asset/with/slashes',
        'asset\\with\\backslashes',
        'asset with spaces',
        'asset?with=query&params',
        'asset#with#hashes',
        'asset@with!special$chars%',
        'asset<with>angle"brackets',
        "asset'with'quotes",
        'asset\twith\nnewlines\r',
      ]

      specialIds.forEach((id, index) => {
        const blob = createTestBlob()
        const url = cache.set(id, blob)

        expect(cache.has(id)).toBe(true)
        expect(cache.get(id)).toBe(url)
      })

      expect(cache.size).toBe(specialIds.length)
    })

    it('should handle asset IDs with unicode characters', () => {
      const unicodeIds = [
        'asset-\u{1F4F7}', // camera emoji
        'asset-\u4E2D\u6587', // Chinese characters
        'asset-\u0645\u0631\u062D\u0628\u0627', // Arabic text
        'asset-\u03B1\u03B2\u03B3', // Greek letters
        '\u{1F680}\u{1F31F}\u{1F308}', // multiple emojis
      ]

      unicodeIds.forEach((id) => {
        const blob = createTestBlob()
        const url = cache.set(id, blob)

        expect(cache.has(id)).toBe(true)
        expect(cache.get(id)).toBe(url)
      })

      expect(cache.size).toBe(unicodeIds.length)
    })
  })

  describe('blob edge cases', () => {
    let cache: MemoryThumbnailCache

    beforeEach(() => {
      cache = new MemoryThumbnailCache(10)
    })

    it('should handle empty blob (size 0)', () => {
      const emptyBlob = new Blob([], { type: 'image/jpeg' })
      expect(emptyBlob.size).toBe(0)

      const url = cache.set('empty-blob', emptyBlob)

      expect(cache.has('empty-blob')).toBe(true)
      expect(cache.get('empty-blob')).toBe(url)
      expect(cache.getBlob('empty-blob')).toBe(emptyBlob)
    })

    it('should handle large blobs', () => {
      // Create a 1MB blob
      const largeData = new Uint8Array(1024 * 1024).fill(255)
      const largeBlob = new Blob([largeData], { type: 'image/jpeg' })

      const url = cache.set('large-blob', largeBlob)

      expect(cache.has('large-blob')).toBe(true)
      expect(cache.get('large-blob')).toBe(url)
      expect(cache.getBlob('large-blob')?.size).toBe(1024 * 1024)
    })

    it('should handle blobs with different MIME types', () => {
      const mimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif',
        'application/octet-stream',
        '', // empty MIME type
      ]

      mimeTypes.forEach((mimeType, index) => {
        const blob = new Blob([new Uint8Array(10)], { type: mimeType })
        const id = `asset-${mimeType || 'empty'}`
        const url = cache.set(id, blob)

        expect(cache.has(id)).toBe(true)
        expect(cache.get(id)).toBe(url)
        expect(cache.getBlob(id)?.type).toBe(mimeType)
      })
    })
  })

  describe('get() does not update access order for missing items', () => {
    it('should not affect LRU order when getting missing item', () => {
      const cache = new MemoryThumbnailCache(3)

      // Add items in order
      cache.set('a', createTestBlob())
      cache.set('b', createTestBlob())
      cache.set('c', createTestBlob())

      // Get a non-existent item multiple times
      cache.get('nonexistent')
      cache.get('another-nonexistent')
      cache.get('yet-another')

      // LRU order should still be a, b, c
      // Adding new item should evict 'a' (still the oldest)
      cache.set('d', createTestBlob())

      expect(cache.has('a')).toBe(false) // a was evicted
      expect(cache.has('b')).toBe(true)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
    })
  })

  describe('multiple deletes of same item', () => {
    it('should handle deleting the same item twice', () => {
      const cache = new MemoryThumbnailCache(5)
      const url = cache.set('asset1', createTestBlob())

      cache.delete('asset1')
      expect(cache.has('asset1')).toBe(false)

      // Second delete should not throw
      expect(() => cache.delete('asset1')).not.toThrow()
      expect(cache.size).toBe(0)
    })

    it('should only revoke URL once', () => {
      const cache = new MemoryThumbnailCache(5)
      const url = cache.set('asset1', createTestBlob())

      vi.mocked(URL.revokeObjectURL).mockClear()

      cache.delete('asset1')
      cache.delete('asset1')
      cache.delete('asset1')

      // URL.revokeObjectURL should only be called once
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    })
  })

  describe('stress tests', () => {
    it('should handle rapid set/get/delete cycles', () => {
      const cache = new MemoryThumbnailCache(10)

      for (let cycle = 0; cycle < 100; cycle++) {
        // Set
        for (let i = 0; i < 10; i++) {
          cache.set(`asset-${cycle}-${i}`, createTestBlob())
        }

        // Get (some will exist, some won't)
        for (let i = 0; i < 15; i++) {
          cache.get(`asset-${cycle}-${i}`)
        }

        // Delete
        for (let i = 0; i < 5; i++) {
          cache.delete(`asset-${cycle}-${i}`)
        }
      }

      // Cache should still be in valid state
      expect(cache.size).toBeLessThanOrEqual(10)
    })

    it('should handle filling and clearing multiple times', () => {
      const cache = new MemoryThumbnailCache(5)

      for (let round = 0; round < 50; round++) {
        // Fill cache
        for (let i = 0; i < 5; i++) {
          cache.set(`asset-${round}-${i}`, createTestBlob())
        }
        expect(cache.size).toBe(5)

        // Clear cache
        cache.clear()
        expect(cache.size).toBe(0)
      }

      // Final verification
      expect(cache.size).toBe(0)
      expect(cache.get('any-asset')).toBeNull()
    })

    it('should handle continuous eviction pressure', () => {
      const cache = new MemoryThumbnailCache(3)

      // Continuously add items, causing constant eviction
      for (let i = 0; i < 1000; i++) {
        cache.set(`asset-${i}`, createTestBlob())

        // Cache should never exceed maxSize
        expect(cache.size).toBeLessThanOrEqual(3)
      }

      // Final state should have exactly maxSize items
      expect(cache.size).toBe(3)

      // Most recent 3 items should be present
      expect(cache.has('asset-997')).toBe(true)
      expect(cache.has('asset-998')).toBe(true)
      expect(cache.has('asset-999')).toBe(true)
    })
  })
})

// ============================================================================
// PreviewCache Tests
// ============================================================================

describe('PreviewCache', () => {
  let cache: PreviewCache
  let mockOPFSCache: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    has: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    isAvailable: boolean
  }

  beforeEach(() => {
    // Create a fresh PreviewCache for each test
    cache = new PreviewCache()

    // Create mock OPFS cache with spies
    mockOPFSCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      isAvailable: true,
    }

    // Replace the internal OPFS cache with our mock
    // @ts-expect-error - accessing private property for testing
    cache.opfsCache = mockOPFSCache
  })

  describe('constructor', () => {
    it('should create with default memory cache size (50)', () => {
      const defaultCache = new PreviewCache()
      // Fill to default capacity and verify LRU eviction
      for (let i = 0; i < 51; i++) {
        // @ts-expect-error - accessing private property for testing
        defaultCache.memoryCache.set(`asset${i}`, createTestBlob())
      }
      // @ts-expect-error - accessing private property for testing
      expect(defaultCache.memoryCache.size).toBe(50)
    })

    it('should create with custom memory cache size', () => {
      const customCache = new PreviewCache(5)
      // Fill to custom capacity and verify LRU eviction
      for (let i = 0; i < 6; i++) {
        // @ts-expect-error - accessing private property for testing
        customCache.memoryCache.set(`asset${i}`, createTestBlob())
      }
      // @ts-expect-error - accessing private property for testing
      expect(customCache.memoryCache.size).toBe(5)
    })
  })

  describe('get()', () => {
    it('should return from memory cache if present', async () => {
      const blob = createTestBlob()
      // Pre-populate memory cache
      // @ts-expect-error - accessing private property for testing
      const url = cache.memoryCache.set('asset1', blob)

      const result = await cache.get('asset1')

      expect(result).toBe(url)
      // Should not check OPFS if found in memory
      expect(mockOPFSCache.get).not.toHaveBeenCalled()
    })

    it('should fall back to OPFS if not in memory', async () => {
      const blob = createTestBlob()
      mockOPFSCache.get.mockResolvedValue(blob)

      const result = await cache.get('asset1')

      expect(result).toMatch(/^blob:/)
      expect(mockOPFSCache.get).toHaveBeenCalledWith('asset1')
    })

    it('should promote OPFS result to memory cache', async () => {
      const blob = createTestBlob()
      mockOPFSCache.get.mockResolvedValue(blob)

      await cache.get('asset1')

      // Verify it's now in memory cache
      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.has('asset1')).toBe(true)

      // Second call should use memory cache, not OPFS
      mockOPFSCache.get.mockClear()
      await cache.get('asset1')
      expect(mockOPFSCache.get).not.toHaveBeenCalled()
    })

    it('should return null if not in either cache', async () => {
      mockOPFSCache.get.mockResolvedValue(null)

      const result = await cache.get('nonexistent')

      expect(result).toBeNull()
      expect(mockOPFSCache.get).toHaveBeenCalledWith('nonexistent')
    })
  })

  describe('set()', () => {
    it('should store in memory cache immediately', async () => {
      const blob = createTestBlob()

      const url = await cache.set('asset1', blob)

      expect(url).toMatch(/^blob:/)
      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.has('asset1')).toBe(true)
    })

    it('should persist to OPFS asynchronously', async () => {
      const blob = createTestBlob()

      await cache.set('asset1', blob)

      // Wait for fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockOPFSCache.set).toHaveBeenCalledWith('asset1', blob)
    })

    it('should handle OPFS errors gracefully', async () => {
      const blob = createTestBlob()
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockOPFSCache.set.mockRejectedValue(new Error('OPFS write failed'))

      // Should not throw, even if OPFS fails
      const url = await cache.set('asset1', blob)

      expect(url).toMatch(/^blob:/)
      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.has('asset1')).toBe(true)

      // Wait for fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(consoleWarnSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('has()', () => {
    it('should return true if in memory', async () => {
      const blob = createTestBlob()
      // @ts-expect-error - accessing private property for testing
      cache.memoryCache.set('asset1', blob)

      const result = await cache.has('asset1')

      expect(result).toBe(true)
      // Should short-circuit and not check OPFS
      expect(mockOPFSCache.has).not.toHaveBeenCalled()
    })

    it('should return true if in OPFS but not memory', async () => {
      mockOPFSCache.has.mockResolvedValue(true)

      const result = await cache.has('asset1')

      expect(result).toBe(true)
      expect(mockOPFSCache.has).toHaveBeenCalledWith('asset1')
    })

    it('should return false if in neither', async () => {
      mockOPFSCache.has.mockResolvedValue(false)

      const result = await cache.has('nonexistent')

      expect(result).toBe(false)
      expect(mockOPFSCache.has).toHaveBeenCalledWith('nonexistent')
    })
  })

  describe('delete()', () => {
    it('should remove from both caches', async () => {
      const blob = createTestBlob()
      // @ts-expect-error - accessing private property for testing
      cache.memoryCache.set('asset1', blob)

      await cache.delete('asset1')

      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.has('asset1')).toBe(false)
      expect(mockOPFSCache.delete).toHaveBeenCalledWith('asset1')
    })
  })

  describe('clearMemory()', () => {
    it('should clear only memory cache', () => {
      const blob = createTestBlob()
      // @ts-expect-error - accessing private property for testing
      cache.memoryCache.set('asset1', blob)
      // @ts-expect-error - accessing private property for testing
      cache.memoryCache.set('asset2', blob)

      cache.clearMemory()

      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.size).toBe(0)
      // OPFS should not be touched
      expect(mockOPFSCache.clear).not.toHaveBeenCalled()
    })
  })

  describe('clearAll()', () => {
    it('should clear both caches', async () => {
      const blob = createTestBlob()
      // @ts-expect-error - accessing private property for testing
      cache.memoryCache.set('asset1', blob)

      await cache.clearAll()

      // @ts-expect-error - accessing private property for testing
      expect(cache.memoryCache.size).toBe(0)
      expect(mockOPFSCache.clear).toHaveBeenCalled()
    })
  })

  describe('memoryCacheSize getter', () => {
    it('should return correct size', async () => {
      expect(cache.memoryCacheSize).toBe(0)

      await cache.set('asset1', createTestBlob())
      expect(cache.memoryCacheSize).toBe(1)

      await cache.set('asset2', createTestBlob())
      expect(cache.memoryCacheSize).toBe(2)

      cache.clearMemory()
      expect(cache.memoryCacheSize).toBe(0)
    })
  })

  describe('isOPFSAvailable getter', () => {
    it('should reflect OPFS availability', () => {
      mockOPFSCache.isAvailable = true
      expect(cache.isOPFSAvailable).toBe(true)

      mockOPFSCache.isAvailable = false
      expect(cache.isOPFSAvailable).toBe(false)
    })
  })
})

// ============================================================================
// OPFSPreviewCache Tests
// ============================================================================

describe('OPFSPreviewCache', () => {
  // Mock OPFS types and state
  let mockFiles: Map<string, Blob>
  let mockPreviewsDir: FileSystemDirectoryHandle
  let mockRootDir: FileSystemDirectoryHandle
  let mockGetDirectory: ReturnType<typeof vi.fn>

  // Store original navigator.storage
  const originalNavigator = globalThis.navigator

  function createMockFileHandle(filename: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name: filename,
      getFile: vi.fn(() => {
        const blob = mockFiles.get(filename)
        if (!blob) {
          return Promise.reject(new Error('File not found'))
        }
        return Promise.resolve(blob)
      }),
      createWritable: vi.fn(() => {
        return Promise.resolve({
          write: async (data: Blob) => {
            mockFiles.set(filename, data)
          },
          close: vi.fn(() => Promise.resolve()),
        })
      }),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
    } as unknown as FileSystemFileHandle
  }

  function setupMockOPFS() {
    mockFiles = new Map<string, Blob>()

    mockPreviewsDir = {
      kind: 'directory',
      name: 'previews',
      getFileHandle: vi.fn((filename: string, options?: { create?: boolean }) => {
        if (mockFiles.has(filename) || options?.create) {
          return Promise.resolve(createMockFileHandle(filename))
        }
        return Promise.reject(new DOMException('File not found', 'NotFoundError'))
      }),
      removeEntry: vi.fn((filename: string) => {
        if (mockFiles.has(filename)) {
          mockFiles.delete(filename)
          return Promise.resolve()
        }
        return Promise.reject(new DOMException('File not found', 'NotFoundError'))
      }),
      getDirectoryHandle: vi.fn(),
      entries: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
      resolve: vi.fn(),
    } as unknown as FileSystemDirectoryHandle

    mockRootDir = {
      kind: 'directory',
      name: '',
      getDirectoryHandle: vi.fn((name: string, _options?: { create?: boolean }) => {
        if (name === 'previews') {
          return Promise.resolve(mockPreviewsDir)
        }
        return Promise.reject(new DOMException('Directory not found', 'NotFoundError'))
      }),
      removeEntry: vi.fn((name: string, _options?: { recursive?: boolean }) => {
        if (name === 'previews') {
          mockFiles.clear()
          return Promise.resolve()
        }
        return Promise.reject(new DOMException('Directory not found', 'NotFoundError'))
      }),
      getFileHandle: vi.fn(),
      entries: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
      resolve: vi.fn(),
    } as unknown as FileSystemDirectoryHandle

    mockGetDirectory = vi.fn(() => Promise.resolve(mockRootDir))

    // Mock navigator.storage.getDirectory
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          getDirectory: mockGetDirectory,
        },
      },
      writable: true,
      configurable: true,
    })
  }

  function teardownMockOPFS() {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  }

  beforeEach(() => {
    setupMockOPFS()
  })

  afterEach(() => {
    teardownMockOPFS()
    vi.clearAllMocks()
  })

  describe('init()', () => {
    it('should initialize successfully with previews directory', async () => {
      const cache = new OPFSPreviewCache()
      await cache.init()

      expect(mockGetDirectory).toHaveBeenCalled()
      expect(mockRootDir.getDirectoryHandle).toHaveBeenCalledWith('previews', { create: true })
      expect(cache.isAvailable).toBe(true)
    })

    it('should handle concurrent init calls', async () => {
      const cache = new OPFSPreviewCache()

      // Call init multiple times concurrently
      await Promise.all([cache.init(), cache.init(), cache.init()])

      // Should only call getDirectory once
      expect(mockGetDirectory).toHaveBeenCalledTimes(1)
      expect(cache.isAvailable).toBe(true)
    })

    it('should handle OPFS not available gracefully', async () => {
      // Make getDirectory throw an error
      mockGetDirectory.mockRejectedValueOnce(new Error('OPFS not available'))

      const cache = new OPFSPreviewCache()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await cache.init()

      expect(consoleSpy).toHaveBeenCalledWith(
        'OPFS not available for preview caching:',
        expect.any(Error)
      )
      expect(cache.isAvailable).toBe(false)

      consoleSpy.mockRestore()
    })
  })

  describe('get()', () => {
    it('should return blob when file exists', async () => {
      const cache = new OPFSPreviewCache()
      const testBlob = createTestBlob(500)
      mockFiles.set('test-asset-id.jpg', testBlob)

      const result = await cache.get('test-asset-id')

      expect(result).toBe(testBlob)
    })

    it('should return null when file does not exist', async () => {
      const cache = new OPFSPreviewCache()

      const result = await cache.get('nonexistent-asset')

      expect(result).toBeNull()
    })

    it('should return null when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValueOnce(new Error('OPFS not available'))
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSPreviewCache()
      const result = await cache.get('any-asset')

      expect(result).toBeNull()

      consoleSpy.mockRestore()
    })
  })

  describe('set()', () => {
    it('should write blob to OPFS', async () => {
      const cache = new OPFSPreviewCache()
      const testBlob = createTestBlob(500)

      await cache.set('new-asset-id', testBlob)

      expect(mockPreviewsDir.getFileHandle).toHaveBeenCalledWith('new-asset-id.jpg', {
        create: true,
      })
      expect(mockFiles.get('new-asset-id.jpg')).toBe(testBlob)
    })

    it('should handle write errors gracefully', async () => {
      const cache = new OPFSPreviewCache()
      await cache.init()

      // Make getFileHandle throw an error
      ;(mockPreviewsDir.getFileHandle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Write error')
      )

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const testBlob = createTestBlob(500)

      // Should not throw
      await cache.set('error-asset', testBlob)

      expect(consoleSpy).toHaveBeenCalledWith('Failed to write preview to OPFS:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('has()', () => {
    it('should return true when file exists', async () => {
      const cache = new OPFSPreviewCache()
      mockFiles.set('existing-asset.jpg', createTestBlob())

      const result = await cache.has('existing-asset')

      expect(result).toBe(true)
    })

    it('should return false when file does not exist', async () => {
      const cache = new OPFSPreviewCache()

      const result = await cache.has('nonexistent-asset')

      expect(result).toBe(false)
    })
  })

  describe('delete()', () => {
    it('should remove file from OPFS', async () => {
      const cache = new OPFSPreviewCache()
      mockFiles.set('to-delete.jpg', createTestBlob())

      await cache.delete('to-delete')

      expect(mockPreviewsDir.removeEntry).toHaveBeenCalledWith('to-delete.jpg')
      expect(mockFiles.has('to-delete.jpg')).toBe(false)
    })

    it('should handle missing file gracefully', async () => {
      const cache = new OPFSPreviewCache()

      // Should not throw even if file doesn't exist
      await cache.delete('nonexistent-asset')

      expect(mockPreviewsDir.removeEntry).toHaveBeenCalledWith('nonexistent-asset.jpg')
    })
  })

  describe('clear()', () => {
    it('should remove all files and recreate directory', async () => {
      const cache = new OPFSPreviewCache()
      mockFiles.set('file1.jpg', createTestBlob())
      mockFiles.set('file2.jpg', createTestBlob())
      mockFiles.set('file3.jpg', createTestBlob())

      await cache.clear()

      expect(mockRootDir.removeEntry).toHaveBeenCalledWith('previews', { recursive: true })
      expect(mockRootDir.getDirectoryHandle).toHaveBeenCalledWith('previews', { create: true })
      expect(mockFiles.size).toBe(0)
    })

    it('should handle errors gracefully', async () => {
      const cache = new OPFSPreviewCache()
      await cache.init()

      // Make removeEntry throw an error
      ;(mockRootDir.removeEntry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Remove error')
      )

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Should not throw
      await cache.clear()

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to clear OPFS preview cache:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('isAvailable getter', () => {
    it('should return false before initialization', () => {
      const cache = new OPFSPreviewCache()

      expect(cache.isAvailable).toBe(false)
    })

    it('should return true after successful initialization', async () => {
      const cache = new OPFSPreviewCache()
      await cache.init()

      expect(cache.isAvailable).toBe(true)
    })

    it('should return false when OPFS is not available', async () => {
      mockGetDirectory.mockRejectedValueOnce(new Error('OPFS not available'))
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSPreviewCache()
      await cache.init()

      expect(cache.isAvailable).toBe(false)

      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// OPFSThumbnailCache Tests
// ============================================================================

describe('OPFSThumbnailCache', () => {
  // Mock OPFS APIs
  let mockWritableStream: {
    write: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  let mockFileHandle: {
    getFile: ReturnType<typeof vi.fn>
    createWritable: ReturnType<typeof vi.fn>
  }
  let mockThumbnailsDirHandle: {
    getFileHandle: ReturnType<typeof vi.fn>
    removeEntry: ReturnType<typeof vi.fn>
  }
  let mockRootDirHandle: {
    getDirectoryHandle: ReturnType<typeof vi.fn>
    removeEntry: ReturnType<typeof vi.fn>
  }
  let mockGetDirectory: ReturnType<typeof vi.fn>

  // Store original navigator.storage
  const originalStorage = globalThis.navigator?.storage

  function setupMocks() {
    mockWritableStream = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    mockFileHandle = {
      getFile: vi.fn(),
      createWritable: vi.fn().mockResolvedValue(mockWritableStream),
    }

    mockThumbnailsDirHandle = {
      getFileHandle: vi.fn(),
      removeEntry: vi.fn().mockResolvedValue(undefined),
    }

    mockRootDirHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue(mockThumbnailsDirHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
    }

    mockGetDirectory = vi.fn().mockResolvedValue(mockRootDirHandle)

    // Mock navigator.storage.getDirectory
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          getDirectory: mockGetDirectory,
        },
      },
      writable: true,
      configurable: true,
    })
  }

  function resetNavigator() {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'navigator', {
        value: { storage: originalStorage },
        writable: true,
        configurable: true,
      })
    } else {
      // @ts-expect-error - resetting navigator
      delete globalThis.navigator
    }
  }

  beforeEach(() => {
    setupMocks()
  })

  afterEach(() => {
    resetNavigator()
    vi.restoreAllMocks()
  })

  describe('init()', () => {
    it('should initialize successfully', async () => {
      const cache = new OPFSThumbnailCache()

      await cache.init()

      expect(mockGetDirectory).toHaveBeenCalled()
      expect(mockRootDirHandle.getDirectoryHandle).toHaveBeenCalledWith('thumbnails', {
        create: true,
      })
      expect(cache.isAvailable).toBe(true)
    })

    it('should handle concurrent init calls (only init once)', async () => {
      const cache = new OPFSThumbnailCache()

      // Call init multiple times concurrently
      const [result1, result2, result3] = await Promise.all([
        cache.init(),
        cache.init(),
        cache.init(),
      ])

      // Should only call getDirectory once
      expect(mockGetDirectory).toHaveBeenCalledTimes(1)
      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
      expect(result3).toBeUndefined()
    })

    it('should handle OPFS not available gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))

      const cache = new OPFSThumbnailCache()

      await cache.init()

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'OPFS not available for thumbnail caching:',
        expect.any(Error)
      )
      expect(cache.isAvailable).toBe(false)
    })
  })

  describe('get()', () => {
    it('should return blob when file exists', async () => {
      const testBlob = createTestBlob(200)
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)
      mockFileHandle.getFile.mockResolvedValue(testBlob)

      const cache = new OPFSThumbnailCache()
      const result = await cache.get('asset-123')

      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith('asset-123.jpg')
      expect(mockFileHandle.getFile).toHaveBeenCalled()
      expect(result).toBe(testBlob)
    })

    it('should return null when file does not exist', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockRejectedValue(new Error('NotFoundError'))

      const cache = new OPFSThumbnailCache()
      const result = await cache.get('nonexistent-asset')

      expect(result).toBeNull()
    })

    it('should return null when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      const result = await cache.get('asset-123')

      expect(result).toBeNull()
    })
  })

  describe('set()', () => {
    it('should write blob to OPFS', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)
      const testBlob = createTestBlob(300)

      const cache = new OPFSThumbnailCache()
      await cache.set('asset-456', testBlob)

      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith('asset-456.jpg', {
        create: true,
      })
      expect(mockFileHandle.createWritable).toHaveBeenCalled()
      expect(mockWritableStream.write).toHaveBeenCalledWith(testBlob)
      expect(mockWritableStream.close).toHaveBeenCalled()
    })

    it('should handle write errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)
      mockWritableStream.write.mockRejectedValue(new Error('Write failed'))

      const cache = new OPFSThumbnailCache()
      await cache.set('asset-789', createTestBlob())

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to write thumbnail to OPFS:',
        expect.any(Error)
      )
    })

    it('should do nothing when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      await cache.set('asset-123', createTestBlob())

      // Verify getFileHandle was not called on thumbnails dir (since rootDir is null)
      expect(mockThumbnailsDirHandle.getFileHandle).not.toHaveBeenCalled()
    })
  })

  describe('has()', () => {
    it('should return true when file exists', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)

      const cache = new OPFSThumbnailCache()
      const result = await cache.has('existing-asset')

      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith('existing-asset.jpg')
      expect(result).toBe(true)
    })

    it('should return false when file does not exist', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockRejectedValue(new Error('NotFoundError'))

      const cache = new OPFSThumbnailCache()
      const result = await cache.has('nonexistent-asset')

      expect(result).toBe(false)
    })

    it('should return false when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      const result = await cache.has('any-asset')

      expect(result).toBe(false)
    })
  })

  describe('delete()', () => {
    it('should remove file from OPFS', async () => {
      const cache = new OPFSThumbnailCache()
      await cache.delete('asset-to-delete')

      expect(mockThumbnailsDirHandle.removeEntry).toHaveBeenCalledWith('asset-to-delete.jpg')
    })

    it('should handle missing file gracefully', async () => {
      mockThumbnailsDirHandle.removeEntry.mockRejectedValue(new Error('NotFoundError'))

      const cache = new OPFSThumbnailCache()

      // Should not throw
      await expect(cache.delete('nonexistent-asset')).resolves.toBeUndefined()
    })

    it('should do nothing when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      await cache.delete('asset-123')

      expect(mockThumbnailsDirHandle.removeEntry).not.toHaveBeenCalled()
    })
  })

  describe('clear()', () => {
    it('should remove all files and recreate directory', async () => {
      const newThumbnailsDirHandle = {
        getFileHandle: vi.fn(),
        removeEntry: vi.fn(),
      }

      // First call returns original, after removeEntry the next getDirectoryHandle returns new
      let callCount = 0
      mockRootDirHandle.getDirectoryHandle.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(mockThumbnailsDirHandle)
        }
        return Promise.resolve(newThumbnailsDirHandle)
      })

      const cache = new OPFSThumbnailCache()
      await cache.init()
      await cache.clear()

      expect(mockRootDirHandle.removeEntry).toHaveBeenCalledWith('thumbnails', { recursive: true })
      expect(mockRootDirHandle.getDirectoryHandle).toHaveBeenLastCalledWith('thumbnails', {
        create: true,
      })
    })

    it('should handle errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockRootDirHandle.removeEntry.mockRejectedValue(new Error('Remove failed'))

      const cache = new OPFSThumbnailCache()
      await cache.init()
      await cache.clear()

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to clear OPFS thumbnail cache:',
        expect.any(Error)
      )
    })

    it('should do nothing when OPFS not available', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      await cache.clear()

      expect(mockRootDirHandle.removeEntry).not.toHaveBeenCalled()
    })
  })

  describe('isAvailable getter', () => {
    it('should return false before init', () => {
      const cache = new OPFSThumbnailCache()

      expect(cache.isAvailable).toBe(false)
    })

    it('should return true after successful init', async () => {
      const cache = new OPFSThumbnailCache()
      await cache.init()

      expect(cache.isAvailable).toBe(true)
    })

    it('should return false after failed init', async () => {
      mockGetDirectory.mockRejectedValue(new Error('OPFS not supported'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cache = new OPFSThumbnailCache()
      await cache.init()

      expect(cache.isAvailable).toBe(false)
    })
  })

  describe('getFilename() (tested via public methods)', () => {
    it('should URL-encode asset IDs for filenames', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)

      const cache = new OPFSThumbnailCache()

      // Test with special characters that need encoding
      await cache.has('asset/with/slashes')
      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith(
        'asset%2Fwith%2Fslashes.jpg'
      )

      mockThumbnailsDirHandle.getFileHandle.mockClear()

      await cache.has('asset with spaces')
      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith(
        'asset%20with%20spaces.jpg'
      )

      mockThumbnailsDirHandle.getFileHandle.mockClear()

      await cache.has('asset?query=value')
      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith(
        'asset%3Fquery%3Dvalue.jpg'
      )
    })

    it('should handle normal UUIDs without encoding issues', async () => {
      mockThumbnailsDirHandle.getFileHandle.mockResolvedValue(mockFileHandle)

      const cache = new OPFSThumbnailCache()
      const uuid = '550e8400-e29b-41d4-a716-446655440000'

      await cache.has(uuid)
      expect(mockThumbnailsDirHandle.getFileHandle).toHaveBeenCalledWith(`${uuid}.jpg`)
    })
  })
})

// ============================================================================
// ThumbnailCache Tests (Combined Memory + OPFS)
// ============================================================================

/**
 * Mock OPFS APIs for ThumbnailCache tests.
 * Creates a simple in-memory mock of the FileSystem API.
 */
function createMockOPFSForThumbnailCache() {
  const files = new Map<string, Blob>()

  const mockFileHandle = (filename: string) => ({
    getFile: vi.fn(async () => {
      const blob = files.get(filename)
      if (!blob) {
        throw new Error('File not found')
      }
      return blob
    }),
    createWritable: vi.fn(async () => {
      return {
        write: vi.fn(async (blob: Blob) => {
          files.set(filename, blob)
        }),
        close: vi.fn(async () => {}),
      }
    }),
  })

  const mockDirHandle = {
    getFileHandle: vi.fn(async (filename: string, options?: { create?: boolean }) => {
      if (options?.create) {
        // Create mode - always return handle
        return mockFileHandle(filename)
      }
      // Read mode - throw if not found
      if (!files.has(filename)) {
        throw new Error('File not found')
      }
      return mockFileHandle(filename)
    }),
    removeEntry: vi.fn(async (filename: string) => {
      files.delete(filename)
    }),
  }

  const mockRootHandle = {
    getDirectoryHandle: vi.fn(async (_name: string, _options?: { create?: boolean }) => {
      return mockDirHandle
    }),
    removeEntry: vi.fn(async (_name: string, _options?: { recursive?: boolean }) => {
      files.clear()
    }),
  }

  const mockStorage = {
    getDirectory: vi.fn(async () => mockRootHandle),
  }

  return {
    files,
    mockStorage,
    mockDirHandle,
    mockRootHandle,
  }
}

describe('ThumbnailCache', () => {
  let cache: ThumbnailCache
  let mockOPFS: ReturnType<typeof createMockOPFSForThumbnailCache>

  beforeEach(() => {
    mockOPFS = createMockOPFSForThumbnailCache()

    // Mock navigator.storage.getDirectory for OPFS
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: mockOPFS.mockStorage,
      },
      writable: true,
      configurable: true,
    })

    cache = new ThumbnailCache(5)
  })

  afterEach(() => {
    // Clean up navigator mock
    // @ts-expect-error - cleaning up test mock
    delete globalThis.navigator
  })

  describe('constructor', () => {
    it('should create with default memory cache size', () => {
      const defaultCache = new ThumbnailCache()
      expect(defaultCache).toBeInstanceOf(ThumbnailCache)
      expect(defaultCache.memoryCacheSize).toBe(0) // Initially empty
    })

    it('should create with custom memory cache size', async () => {
      const customCache = new ThumbnailCache(10)
      expect(customCache).toBeInstanceOf(ThumbnailCache)

      // Fill cache to verify size limit
      for (let i = 0; i < 12; i++) {
        await customCache.set(`asset${i}`, createTestBlob())
      }

      // Should be limited to 10
      expect(customCache.memoryCacheSize).toBe(10)
    })
  })

  describe('get()', () => {
    it('should return from memory cache if present (fast path)', async () => {
      const blob = createTestBlob()
      await cache.set('asset1', blob)

      // Get should return immediately from memory
      const url = await cache.get('asset1')

      expect(url).toMatch(/^blob:/)
    })

    it('should fall back to OPFS if not in memory', async () => {
      const blob = createTestBlob()

      // Store directly in OPFS mock
      const filename = `${encodeURIComponent('asset1')}.jpg`
      mockOPFS.files.set(filename, blob)

      // Get should find it in OPFS
      const url = await cache.get('asset1')

      expect(url).toMatch(/^blob:/)
    })

    it('should promote OPFS result to memory cache', async () => {
      const blob = createTestBlob()

      // Store directly in OPFS mock
      const filename = `${encodeURIComponent('asset1')}.jpg`
      mockOPFS.files.set(filename, blob)

      // First get - loads from OPFS
      const url1 = await cache.get('asset1')
      expect(url1).toMatch(/^blob:/)

      // Should now be in memory cache
      expect(cache.memoryCacheSize).toBe(1)

      // Second get - should be from memory (same URL)
      const url2 = await cache.get('asset1')
      expect(url2).toBe(url1)
    })

    it('should return null if not in either cache', async () => {
      const url = await cache.get('nonexistent')
      expect(url).toBeNull()
    })
  })

  describe('set()', () => {
    it('should store in memory cache immediately', async () => {
      const blob = createTestBlob()
      const url = await cache.set('asset1', blob)

      expect(url).toMatch(/^blob:/)
      expect(cache.memoryCacheSize).toBe(1)
    })

    it('should persist to OPFS asynchronously', async () => {
      const blob = createTestBlob()
      await cache.set('asset1', blob)

      // Wait a tick for fire-and-forget to complete
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Verify OPFS has the file
      const filename = `${encodeURIComponent('asset1')}.jpg`
      expect(mockOPFS.files.has(filename)).toBe(true)
    })

    it('should handle OPFS errors gracefully (fire-and-forget)', async () => {
      // Make OPFS fail
      mockOPFS.mockStorage.getDirectory = vi.fn(async () => {
        throw new Error('OPFS unavailable')
      })

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Set should still work (memory cache)
      const blob = createTestBlob()
      const url = await cache.set('asset1', blob)

      expect(url).toMatch(/^blob:/)
      expect(cache.memoryCacheSize).toBe(1)

      // Wait for fire-and-forget to attempt
      await new Promise((resolve) => setTimeout(resolve, 0))

      consoleWarnSpy.mockRestore()
    })
  })

  describe('has()', () => {
    it('should return true if in memory', async () => {
      await cache.set('asset1', createTestBlob())

      const exists = await cache.has('asset1')
      expect(exists).toBe(true)
    })

    it('should return true if in OPFS but not memory', async () => {
      // Store directly in OPFS mock
      const filename = `${encodeURIComponent('asset1')}.jpg`
      mockOPFS.files.set(filename, createTestBlob())

      const exists = await cache.has('asset1')
      expect(exists).toBe(true)
    })

    it('should return false if in neither', async () => {
      const exists = await cache.has('nonexistent')
      expect(exists).toBe(false)
    })
  })

  describe('delete()', () => {
    it('should remove from both caches', async () => {
      const blob = createTestBlob()
      await cache.set('asset1', blob)

      // Wait for OPFS write
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Verify in both caches
      expect(cache.memoryCacheSize).toBe(1)
      const filename = `${encodeURIComponent('asset1')}.jpg`
      expect(mockOPFS.files.has(filename)).toBe(true)

      // Delete
      await cache.delete('asset1')

      // Verify removed from both
      expect(cache.memoryCacheSize).toBe(0)
      expect(mockOPFS.files.has(filename)).toBe(false)
    })
  })

  describe('clearMemory()', () => {
    it('should clear only memory cache, preserve OPFS', async () => {
      const blob = createTestBlob()
      await cache.set('asset1', blob)
      await cache.set('asset2', createTestBlob())

      // Wait for OPFS writes
      await new Promise((resolve) => setTimeout(resolve, 0))

      const filename1 = `${encodeURIComponent('asset1')}.jpg`
      const filename2 = `${encodeURIComponent('asset2')}.jpg`

      // Verify in both caches
      expect(cache.memoryCacheSize).toBe(2)
      expect(mockOPFS.files.has(filename1)).toBe(true)
      expect(mockOPFS.files.has(filename2)).toBe(true)

      // Clear memory only
      cache.clearMemory()

      // Memory should be empty
      expect(cache.memoryCacheSize).toBe(0)

      // OPFS should still have files
      expect(mockOPFS.files.has(filename1)).toBe(true)
      expect(mockOPFS.files.has(filename2)).toBe(true)
    })
  })

  describe('clearAll()', () => {
    it('should clear both caches', async () => {
      const blob = createTestBlob()
      await cache.set('asset1', blob)
      await cache.set('asset2', createTestBlob())

      // Wait for OPFS writes
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Verify in both caches
      expect(cache.memoryCacheSize).toBe(2)
      expect(mockOPFS.files.size).toBeGreaterThan(0)

      // Clear all
      await cache.clearAll()

      // Both should be empty
      expect(cache.memoryCacheSize).toBe(0)
      expect(mockOPFS.files.size).toBe(0)
    })
  })

  describe('memoryCacheSize getter', () => {
    it('should return correct size', async () => {
      expect(cache.memoryCacheSize).toBe(0)

      await cache.set('asset1', createTestBlob())
      expect(cache.memoryCacheSize).toBe(1)

      await cache.set('asset2', createTestBlob())
      expect(cache.memoryCacheSize).toBe(2)

      await cache.delete('asset1')
      expect(cache.memoryCacheSize).toBe(1)
    })
  })

  describe('isOPFSAvailable getter', () => {
    it('should reflect OPFS availability when available', async () => {
      // Trigger OPFS initialization by doing an operation
      await cache.set('asset1', createTestBlob())

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(cache.isOPFSAvailable).toBe(true)
    })

    it('should reflect OPFS availability when unavailable', async () => {
      // Create cache with broken OPFS
      mockOPFS.mockStorage.getDirectory = vi.fn(async () => {
        throw new Error('OPFS unavailable')
      })

      const brokenCache = new ThumbnailCache(5)

      // Trigger initialization
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await brokenCache.set('asset1', createTestBlob())
      await new Promise((resolve) => setTimeout(resolve, 0))
      consoleWarnSpy.mockRestore()

      expect(brokenCache.isOPFSAvailable).toBe(false)
    })
  })
})
