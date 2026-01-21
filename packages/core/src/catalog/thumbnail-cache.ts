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

/** Default maximum items in memory cache */
const DEFAULT_MEMORY_CACHE_SIZE = 150

/** OPFS directory name for thumbnail storage */
const OPFS_THUMBNAILS_DIR = 'thumbnails'

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
// OPFS Cache
// ============================================================================

/**
 * Persistent thumbnail cache using Origin Private File System (OPFS).
 *
 * OPFS provides:
 * - Fast synchronous access via FileSystemSyncAccessHandle (in workers)
 * - Persistence across page reloads
 * - No storage quota prompts (uses site storage)
 *
 * Note: This implementation uses the async API. For maximum performance
 * in workers, the sync API can be used instead.
 */
export class OPFSThumbnailCache {
  private rootDir: FileSystemDirectoryHandle | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null

  /**
   * Initialize OPFS access.
   * Must be called before other methods.
   */
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
      this.rootDir = await root.getDirectoryHandle(OPFS_THUMBNAILS_DIR, { create: true })
      this.initialized = true
    } catch (error) {
      // OPFS not available - cache will be disabled
      console.warn('OPFS not available for thumbnail caching:', error)
      this.initialized = true // Mark as initialized to prevent retry
    }
  }

  /**
   * Get a thumbnail blob from OPFS.
   */
  async get(assetId: string): Promise<Blob | null> {
    await this.init()

    if (!this.rootDir) {
      return null
    }

    try {
      const filename = this.getFilename(assetId)
      const fileHandle = await this.rootDir.getFileHandle(filename)
      const file = await fileHandle.getFile()
      return file
    } catch {
      // File not found
      return null
    }
  }

  /**
   * Store a thumbnail blob in OPFS.
   */
  async set(assetId: string, blob: Blob): Promise<void> {
    await this.init()

    if (!this.rootDir) {
      return
    }

    try {
      const filename = this.getFilename(assetId)
      const fileHandle = await this.rootDir.getFileHandle(filename, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      console.warn('Failed to write thumbnail to OPFS:', error)
    }
  }

  /**
   * Check if a thumbnail exists in OPFS.
   */
  async has(assetId: string): Promise<boolean> {
    await this.init()

    if (!this.rootDir) {
      return false
    }

    try {
      const filename = this.getFilename(assetId)
      await this.rootDir.getFileHandle(filename)
      return true
    } catch {
      return false
    }
  }

  /**
   * Remove a thumbnail from OPFS.
   */
  async delete(assetId: string): Promise<void> {
    await this.init()

    if (!this.rootDir) {
      return
    }

    try {
      const filename = this.getFilename(assetId)
      await this.rootDir.removeEntry(filename)
    } catch {
      // File not found - ignore
    }
  }

  /**
   * Clear all thumbnails from OPFS.
   */
  async clear(): Promise<void> {
    await this.init()

    if (!this.rootDir) {
      return
    }

    try {
      // Get parent to recreate directory
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(OPFS_THUMBNAILS_DIR, { recursive: true })
      this.rootDir = await root.getDirectoryHandle(OPFS_THUMBNAILS_DIR, { create: true })
    } catch (error) {
      console.warn('Failed to clear OPFS thumbnail cache:', error)
    }
  }

  /**
   * Check if OPFS is available and initialized.
   */
  get isAvailable(): boolean {
    return this.initialized && this.rootDir !== null
  }

  /**
   * Convert asset ID to safe filename.
   */
  private getFilename(assetId: string): string {
    // UUIDs are already safe for filenames, but encode to be safe
    return `${encodeURIComponent(assetId)}.jpg`
  }
}

// ============================================================================
// Combined Cache Interface
// ============================================================================

/**
 * Interface for the combined thumbnail cache.
 */
export interface IThumbnailCache {
  /**
   * Get a thumbnail URL, checking memory first, then OPFS.
   */
  get(assetId: string): Promise<string | null>

  /**
   * Store a thumbnail in both memory and OPFS.
   */
  set(assetId: string, blob: Blob): Promise<string>

  /**
   * Check if a thumbnail exists (memory or OPFS).
   */
  has(assetId: string): Promise<boolean>

  /**
   * Delete a thumbnail from both caches.
   */
  delete(assetId: string): Promise<void>

  /**
   * Clear the memory cache only (for memory pressure).
   */
  clearMemory(): void

  /**
   * Clear both caches.
   */
  clearAll(): Promise<void>
}

/**
 * Combined thumbnail cache with memory LRU and OPFS persistence.
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
export class ThumbnailCache implements IThumbnailCache {
  private memoryCache: MemoryThumbnailCache
  private opfsCache: OPFSThumbnailCache

  constructor(memoryCacheSize?: number) {
    this.memoryCache = new MemoryThumbnailCache(memoryCacheSize)
    this.opfsCache = new OPFSThumbnailCache()
  }

  /**
   * Get a thumbnail URL.
   *
   * Checks memory cache first, then OPFS.
   * OPFS results are promoted to memory cache.
   */
  async get(assetId: string): Promise<string | null> {
    // Check memory cache first (fast path)
    const memoryUrl = this.memoryCache.get(assetId)
    if (memoryUrl) {
      return memoryUrl
    }

    // Check OPFS cache
    const blob = await this.opfsCache.get(assetId)
    if (blob) {
      // Promote to memory cache
      const url = this.memoryCache.set(assetId, blob)
      return url
    }

    return null
  }

  /**
   * Store a thumbnail.
   *
   * Stores immediately in memory cache and asynchronously in OPFS.
   * Returns the Object URL for immediate use.
   */
  async set(assetId: string, blob: Blob): Promise<string> {
    // Store in memory cache (immediate)
    const url = this.memoryCache.set(assetId, blob)

    // Persist to OPFS (fire-and-forget)
    this.opfsCache.set(assetId, blob).catch((error) => {
      console.warn('Failed to persist thumbnail to OPFS:', error)
    })

    return url
  }

  /**
   * Check if a thumbnail exists.
   */
  async has(assetId: string): Promise<boolean> {
    if (this.memoryCache.has(assetId)) {
      return true
    }
    return this.opfsCache.has(assetId)
  }

  /**
   * Delete a thumbnail from both caches.
   */
  async delete(assetId: string): Promise<void> {
    this.memoryCache.delete(assetId)
    await this.opfsCache.delete(assetId)
  }

  /**
   * Clear only the memory cache.
   * Useful when experiencing memory pressure.
   */
  clearMemory(): void {
    this.memoryCache.clear()
  }

  /**
   * Clear both memory and OPFS caches.
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear()
    await this.opfsCache.clear()
  }

  /**
   * Get the size of the memory cache.
   */
  get memoryCacheSize(): number {
    return this.memoryCache.size
  }

  /**
   * Check if OPFS cache is available.
   */
  get isOPFSAvailable(): boolean {
    return this.opfsCache.isAvailable
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new memory-only thumbnail cache.
 */
export function createMemoryCache(maxSize?: number): MemoryThumbnailCache {
  return new MemoryThumbnailCache(maxSize)
}

/**
 * Create a new OPFS thumbnail cache.
 */
export function createOPFSCache(): OPFSThumbnailCache {
  return new OPFSThumbnailCache()
}

/**
 * Create a new combined thumbnail cache.
 */
export function createThumbnailCache(memoryCacheSize?: number): ThumbnailCache {
  return new ThumbnailCache(memoryCacheSize)
}
