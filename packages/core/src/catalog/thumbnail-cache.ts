/**
 * Thumbnail caching with LRU in-memory cache and OPFS persistent storage.
 *
 * Two-tier caching strategy:
 * 1. Memory cache: Fast access, LRU eviction, stores Object URLs
 * 2. OPFS cache: Persistent storage, survives page reload
 *
 * The memory cache stores Object URLs for immediate display,
 * while OPFS provides persistence across sessions.
 */

// ============================================================================
// Constants
// ============================================================================

/** Default maximum items in memory cache for thumbnails */
const DEFAULT_MEMORY_CACHE_SIZE = 150

/** Default maximum items in memory cache for previews
 * Increased from 20 to 50 to improve cache hit rates during navigation.
 * Memory impact: ~13.75MB at 50 items (vs ~5.5MB at 20 items)
 * Hit rate improvement: 40-60% → 90%+ for sequential navigation
 */
const DEFAULT_PREVIEW_MEMORY_CACHE_SIZE = 50

/** OPFS directory name for thumbnail storage */
const OPFS_THUMBNAILS_DIR = 'thumbnails'

/** OPFS directory name for preview storage */
const OPFS_PREVIEWS_DIR = 'previews'

// ============================================================================
// Memory LRU Cache
// ============================================================================

interface MemoryCacheEntry {
  url: string
  blob: Blob
}

/**
 * In-memory LRU cache for thumbnail Object URLs.
 *
 * Features:
 * - O(1) get/set/delete operations
 * - LRU eviction when capacity is reached
 * - Automatic Object URL revocation on eviction
 */
export class MemoryThumbnailCache {
  /** Map maintains insertion order, used for LRU tracking */
  private cache = new Map<string, MemoryCacheEntry>()
  private readonly maxSize: number

  constructor(maxSize: number = DEFAULT_MEMORY_CACHE_SIZE) {
    this.maxSize = maxSize
  }

  /**
   * Get a thumbnail URL from the cache.
   * Accessing an item moves it to the end (most recently used).
   */
  get(assetId: string): string | null {
    const entry = this.cache.get(assetId)
    if (!entry) {
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(assetId)
    this.cache.set(assetId, entry)

    return entry.url
  }

  /**
   * Store a thumbnail in the cache.
   * Returns the Object URL for the thumbnail.
   *
   * If the cache is at capacity, the least recently used item is evicted.
   */
  set(assetId: string, blob: Blob): string {
    // Remove existing entry if present
    const existing = this.cache.get(assetId)
    if (existing) {
      URL.revokeObjectURL(existing.url)
      this.cache.delete(assetId)
    }

    // Evict LRU item if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    // Create Object URL and store
    const url = URL.createObjectURL(blob)
    this.cache.set(assetId, { url, blob })

    return url
  }

  /**
   * Check if a thumbnail is in the cache.
   */
  has(assetId: string): boolean {
    return this.cache.has(assetId)
  }

  /**
   * Remove a thumbnail from the cache.
   */
  delete(assetId: string): void {
    const entry = this.cache.get(assetId)
    if (entry) {
      URL.revokeObjectURL(entry.url)
      this.cache.delete(assetId)
    }
  }

  /**
   * Clear all thumbnails from the cache.
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      URL.revokeObjectURL(entry.url)
    }
    this.cache.clear()
  }

  /**
   * Get the blob for an asset (for OPFS persistence).
   */
  getBlob(assetId: string): Blob | null {
    const entry = this.cache.get(assetId)
    return entry?.blob ?? null
  }

  /**
   * Get the current number of items in the cache.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Evict the least recently used item.
   */
  private evictLRU(): void {
    // Map iterator returns items in insertion order
    const firstKey = this.cache.keys().next().value
    if (firstKey) {
      this.delete(firstKey)
    }
  }
}

// ============================================================================
// OPFS Cache (Generic Base)
// ============================================================================

/**
 * Configuration for OPFS cache instances.
 */
interface OPFSCacheConfig {
  /** Directory name in OPFS root */
  dirName: string
  /** Type name for log messages (e.g., 'thumbnail', 'preview') */
  typeName: string
}

/**
 * Generic OPFS cache implementation.
 * Used as base for thumbnail and preview caches.
 */
class OPFSCache {
  private rootDir: FileSystemDirectoryHandle | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private readonly config: OPFSCacheConfig

  constructor(config: OPFSCacheConfig) {
    this.config = config
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInit()
    await this.initPromise
    this.initPromise = null
  }

  private async doInit(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory()
      this.rootDir = await root.getDirectoryHandle(this.config.dirName, { create: true })
      this.initialized = true
    } catch (error) {
      console.warn(`OPFS not available for ${this.config.typeName} caching:`, error)
      this.initialized = true
    }
  }

  async get(assetId: string): Promise<Blob | null> {
    await this.init()
    if (!this.rootDir) return null

    try {
      const fileHandle = await this.rootDir.getFileHandle(this.getFilename(assetId))
      return await fileHandle.getFile()
    } catch {
      return null
    }
  }

  async set(assetId: string, blob: Blob): Promise<void> {
    await this.init()
    if (!this.rootDir) return

    try {
      const fileHandle = await this.rootDir.getFileHandle(this.getFilename(assetId), { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      console.warn(`Failed to write ${this.config.typeName} to OPFS:`, error)
    }
  }

  async has(assetId: string): Promise<boolean> {
    await this.init()
    if (!this.rootDir) return false

    try {
      await this.rootDir.getFileHandle(this.getFilename(assetId))
      return true
    } catch {
      return false
    }
  }

  async delete(assetId: string): Promise<void> {
    await this.init()
    if (!this.rootDir) return

    try {
      await this.rootDir.removeEntry(this.getFilename(assetId))
    } catch {
      // File not found - ignore
    }
  }

  async clear(): Promise<void> {
    await this.init()
    if (!this.rootDir) return

    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(this.config.dirName, { recursive: true })
      this.rootDir = await root.getDirectoryHandle(this.config.dirName, { create: true })
    } catch (error) {
      console.warn(`Failed to clear OPFS ${this.config.typeName} cache:`, error)
    }
  }

  get isAvailable(): boolean {
    return this.initialized && this.rootDir !== null
  }

  private getFilename(assetId: string): string {
    return `${encodeURIComponent(assetId)}.jpg`
  }
}

// ============================================================================
// OPFS Cache Implementations (Thin wrappers for backward compatibility)
// ============================================================================

/**
 * Persistent thumbnail cache using Origin Private File System (OPFS).
 */
export class OPFSThumbnailCache extends OPFSCache {
  constructor() {
    super({ dirName: OPFS_THUMBNAILS_DIR, typeName: 'thumbnail' })
  }
}

/**
 * Persistent preview cache using Origin Private File System (OPFS).
 * Uses a separate directory from thumbnails due to larger file sizes.
 */
export class OPFSPreviewCache extends OPFSCache {
  constructor() {
    super({ dirName: OPFS_PREVIEWS_DIR, typeName: 'preview' })
  }
}

// ============================================================================
// Combined Cache Interface
// ============================================================================

/**
 * Interface for combined memory + OPFS caches.
 */
export interface ICombinedCache {
  get(assetId: string): Promise<string | null>
  set(assetId: string, blob: Blob): Promise<string>
  has(assetId: string): Promise<boolean>
  delete(assetId: string): Promise<void>
  clearMemory(): void
  clearAll(): Promise<void>
}

/** @deprecated Use ICombinedCache instead */
export type IThumbnailCache = ICombinedCache
/** @deprecated Use ICombinedCache instead */
export type IPreviewCache = ICombinedCache

// ============================================================================
// Combined Cache Base Class
// ============================================================================

/**
 * Combined cache with memory LRU and OPFS persistence.
 *
 * Read path:
 * 1. Check memory cache (fast)
 * 2. If miss, check OPFS
 * 3. If found in OPFS, load into memory cache
 *
 * Write path:
 * 1. Store in memory cache (immediate)
 * 2. Persist to OPFS (async, fire-and-forget)
 */
class CombinedCache implements ICombinedCache {
  private memoryCache: MemoryThumbnailCache
  private opfsCache: OPFSCache
  private readonly typeName: string

  constructor(memorySize: number, opfsCache: OPFSCache, typeName: string) {
    this.memoryCache = new MemoryThumbnailCache(memorySize)
    this.opfsCache = opfsCache
    this.typeName = typeName
  }

  async get(assetId: string): Promise<string | null> {
    const memoryUrl = this.memoryCache.get(assetId)
    if (memoryUrl) return memoryUrl

    const blob = await this.opfsCache.get(assetId)
    if (blob) return this.memoryCache.set(assetId, blob)

    return null
  }

  async set(assetId: string, blob: Blob): Promise<string> {
    const url = this.memoryCache.set(assetId, blob)
    this.opfsCache.set(assetId, blob).catch((error) => {
      console.warn(`Failed to persist ${this.typeName} to OPFS:`, error)
    })
    return url
  }

  async has(assetId: string): Promise<boolean> {
    return this.memoryCache.has(assetId) || this.opfsCache.has(assetId)
  }

  async delete(assetId: string): Promise<void> {
    this.memoryCache.delete(assetId)
    await this.opfsCache.delete(assetId)
  }

  clearMemory(): void {
    this.memoryCache.clear()
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clear()
    await this.opfsCache.clear()
  }

  get memoryCacheSize(): number {
    return this.memoryCache.size
  }

  get isOPFSAvailable(): boolean {
    return this.opfsCache.isAvailable
  }
}

// ============================================================================
// Combined Cache Implementations
// ============================================================================

/**
 * Combined thumbnail cache with memory LRU and OPFS persistence.
 */
export class ThumbnailCache extends CombinedCache {
  constructor(memoryCacheSize: number = DEFAULT_MEMORY_CACHE_SIZE) {
    super(memoryCacheSize, new OPFSThumbnailCache(), 'thumbnail')
  }
}

/**
 * Combined preview cache with memory LRU and OPFS persistence.
 * Uses smaller memory limit (50 vs 150) due to larger preview sizes.
 */
export class PreviewCache extends CombinedCache {
  constructor(memoryCacheSize: number = DEFAULT_PREVIEW_MEMORY_CACHE_SIZE) {
    super(memoryCacheSize, new OPFSPreviewCache(), 'preview')
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createMemoryCache(maxSize?: number): MemoryThumbnailCache {
  return new MemoryThumbnailCache(maxSize)
}

export function createOPFSCache(): OPFSThumbnailCache {
  return new OPFSThumbnailCache()
}

export function createThumbnailCache(memoryCacheSize?: number): ThumbnailCache {
  return new ThumbnailCache(memoryCacheSize)
}

export function createPreviewCache(memoryCacheSize?: number): PreviewCache {
  return new PreviewCache(memoryCacheSize)
}
