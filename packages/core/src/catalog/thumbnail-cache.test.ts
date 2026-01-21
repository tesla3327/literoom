/**
 * Unit tests for the MemoryThumbnailCache.
 *
 * Note: OPFS tests would require a browser environment with OPFS support.
 * These tests focus on the MemoryThumbnailCache which can be tested in Node.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryThumbnailCache, createMemoryCache } from './thumbnail-cache'

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
})
