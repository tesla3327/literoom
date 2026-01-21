# Research: Thumbnail Generation Pipeline (Area 3)

**Date**: 2026-01-20
**Focus Area**: Queue management, priority scheduling, cancellation, caching, and worker coordination for thumbnail generation
**Related**: Catalog Service Research Plan - Area 3

---

## Executive Summary

This document defines patterns for building a high-performance thumbnail generation pipeline for a photo catalog application. The system must handle rapid scrolling through thousands of images while maintaining responsive UI and efficient resource usage.

### Key Design Decisions

1. **Priority Queue with Viewport Awareness**: Use a single priority queue that reorders based on item visibility
2. **AbortController-based Cancellation**: Leverage native abort signals for clean cancellation
3. **Two-tier Caching**: LRU in-memory cache for hot items + IndexedDB for persistence
4. **Sequential Processing**: Process one thumbnail at a time in the worker (simpler, predictable)
5. **Debounced Viewport Updates**: Batch visibility changes to avoid priority thrashing

---

## 1. Queue Management

### Problem Statement

When a user opens a folder with 10,000 images, we cannot queue all thumbnails immediately. The queue must:
- Accept requests as items become visible
- Respect priority (visible items first)
- Prevent duplicate requests for the same image
- Be memory-efficient (don't store file bytes in queue)

### Recommended Pattern: Priority Queue with Deduplication

```typescript
/**
 * Thumbnail request in the queue.
 * We store the file handle reference, not the actual bytes.
 */
interface ThumbnailRequest {
  /** Unique asset identifier (typically file path or hash) */
  assetId: string
  /** Reference to get file bytes (called when processing) */
  getBytes: () => Promise<Uint8Array>
  /** Priority: lower = higher priority. 0 = visible, 1 = near-visible, 2+ = background */
  priority: number
  /** Timestamp when request was added */
  addedAt: number
  /** AbortController for this request */
  abortController: AbortController
  /** Resolve function for the promise */
  resolve: (thumbnail: Blob) => void
  /** Reject function for the promise */
  reject: (error: Error) => void
}

/**
 * ThumbnailQueue manages pending thumbnail generation requests.
 *
 * Design decisions:
 * - Uses Map for O(1) lookup/deduplication
 * - Sorts by priority + addedAt when extracting next item
 * - Lazy sorting (only when needed) for better performance
 */
class ThumbnailQueue {
  private queue = new Map<string, ThumbnailRequest>()
  private sortedKeys: string[] = []
  private isDirty = true

  /**
   * Add or update a thumbnail request.
   * If the asset is already queued, updates priority if lower.
   */
  enqueue(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: number
  ): { promise: Promise<Blob>; abort: () => void } {
    const existing = this.queue.get(assetId)

    // If already queued with same or better priority, return existing promise
    if (existing && existing.priority <= priority) {
      return {
        promise: new Promise((resolve, reject) => {
          // Chain to existing request
          const originalResolve = existing.resolve
          const originalReject = existing.reject
          existing.resolve = (blob) => {
            originalResolve(blob)
            resolve(blob)
          }
          existing.reject = (err) => {
            originalReject(err)
            reject(err)
          }
        }),
        abort: () => existing.abortController.abort()
      }
    }

    // Create new request or update priority
    const abortController = new AbortController()
    let resolve: (blob: Blob) => void
    let reject: (error: Error) => void

    const promise = new Promise<Blob>((res, rej) => {
      resolve = res
      reject = rej
    })

    const request: ThumbnailRequest = {
      assetId,
      getBytes,
      priority,
      addedAt: Date.now(),
      abortController,
      resolve: resolve!,
      reject: reject!
    }

    this.queue.set(assetId, request)
    this.isDirty = true

    return {
      promise,
      abort: () => {
        abortController.abort()
        this.remove(assetId)
      }
    }
  }

  /**
   * Get the highest priority request.
   * Does not remove from queue (caller must call remove after processing).
   */
  peek(): ThumbnailRequest | undefined {
    if (this.queue.size === 0) return undefined

    if (this.isDirty) {
      this.sortedKeys = Array.from(this.queue.keys())
      this.sortedKeys.sort((a, b) => {
        const reqA = this.queue.get(a)!
        const reqB = this.queue.get(b)!
        // Sort by priority first, then by addedAt (FIFO within same priority)
        if (reqA.priority !== reqB.priority) {
          return reqA.priority - reqB.priority
        }
        return reqA.addedAt - reqB.addedAt
      })
      this.isDirty = false
    }

    const topKey = this.sortedKeys[0]
    return topKey ? this.queue.get(topKey) : undefined
  }

  /**
   * Remove a request from the queue.
   */
  remove(assetId: string): boolean {
    const existed = this.queue.delete(assetId)
    if (existed) {
      this.isDirty = true
    }
    return existed
  }

  /**
   * Update priority for an existing request.
   */
  updatePriority(assetId: string, newPriority: number): boolean {
    const request = this.queue.get(assetId)
    if (request && newPriority < request.priority) {
      request.priority = newPriority
      this.isDirty = true
      return true
    }
    return false
  }

  /**
   * Check if an asset is queued.
   */
  has(assetId: string): boolean {
    return this.queue.has(assetId)
  }

  /**
   * Current queue size.
   */
  get size(): number {
    return this.queue.size
  }

  /**
   * Cancel all pending requests.
   */
  clear(): void {
    for (const request of this.queue.values()) {
      request.abortController.abort()
      request.reject(new Error('Queue cleared'))
    }
    this.queue.clear()
    this.sortedKeys = []
    this.isDirty = false
  }
}
```

### Queue Size Limits

To prevent memory issues, limit the queue size:

```typescript
const MAX_QUEUE_SIZE = 200 // ~2-3 screens worth

enqueue(assetId: string, ...): QueueResult {
  // If queue is full, remove lowest priority items
  if (this.queue.size >= MAX_QUEUE_SIZE) {
    this.evictLowestPriority(this.queue.size - MAX_QUEUE_SIZE + 1)
  }
  // ... rest of enqueue logic
}

private evictLowestPriority(count: number): void {
  // Get items sorted by priority (descending = lowest priority first)
  const sorted = Array.from(this.queue.entries())
    .sort(([, a], [, b]) => b.priority - a.priority)

  for (let i = 0; i < count && i < sorted.length; i++) {
    const [assetId, request] = sorted[i]
    request.abortController.abort()
    request.reject(new Error('Evicted from queue'))
    this.queue.delete(assetId)
  }
  this.isDirty = true
}
```

---

## 2. Priority Scheduling for Virtual Scroll

### Problem Statement

In a virtual scroll grid displaying 50 thumbnails at a time:
- Visible items need thumbnails immediately
- Items about to scroll into view need thumbnails soon
- Off-screen items can wait or be cancelled

### Viewport-Aware Priority System

```typescript
/**
 * Priority levels for thumbnail generation.
 */
const Priority = {
  /** Currently visible in viewport */
  VISIBLE: 0,
  /** Within 1 screen of viewport (preload zone) */
  NEAR_VISIBLE: 1,
  /** Within 2 screens of viewport */
  PRELOAD: 2,
  /** Queued but not near viewport */
  BACKGROUND: 3
} as const

type PriorityLevel = typeof Priority[keyof typeof Priority]

/**
 * Calculates priority based on item position relative to viewport.
 */
function calculatePriority(
  itemIndex: number,
  viewportStart: number,
  viewportEnd: number,
  itemsPerScreen: number
): PriorityLevel {
  // Check if visible
  if (itemIndex >= viewportStart && itemIndex <= viewportEnd) {
    return Priority.VISIBLE
  }

  // Check distance from viewport
  const distanceFromViewport = Math.min(
    Math.abs(itemIndex - viewportStart),
    Math.abs(itemIndex - viewportEnd)
  )

  if (distanceFromViewport <= itemsPerScreen) {
    return Priority.NEAR_VISIBLE
  }

  if (distanceFromViewport <= itemsPerScreen * 2) {
    return Priority.PRELOAD
  }

  return Priority.BACKGROUND
}
```

### Integration with Virtual Scroll

```typescript
/**
 * Vue composable for thumbnail management with virtual scroll.
 */
function useThumbnails(
  thumbnailService: ThumbnailService,
  virtualScroll: { startIndex: number; endIndex: number }
) {
  const itemsPerScreen = 50 // Adjust based on grid layout

  // Track which assets we've requested thumbnails for
  const requestedAssets = new Map<string, { abort: () => void }>()

  /**
   * Request thumbnail for an asset.
   */
  function requestThumbnail(
    assetId: string,
    itemIndex: number,
    getBytes: () => Promise<Uint8Array>
  ): Promise<Blob> | undefined {
    // Calculate priority based on viewport position
    const priority = calculatePriority(
      itemIndex,
      virtualScroll.startIndex,
      virtualScroll.endIndex,
      itemsPerScreen
    )

    // Skip background priority items if queue is getting large
    if (priority === Priority.BACKGROUND && thumbnailService.queueSize > 100) {
      return undefined
    }

    const { promise, abort } = thumbnailService.generate(
      assetId,
      getBytes,
      priority
    )

    requestedAssets.set(assetId, { abort })
    return promise
  }

  /**
   * Handle viewport change - update priorities and cancel far-away items.
   */
  function onViewportChange() {
    for (const [assetId, { abort }] of requestedAssets) {
      const itemIndex = getItemIndex(assetId) // Look up in asset list
      const newPriority = calculatePriority(
        itemIndex,
        virtualScroll.startIndex,
        virtualScroll.endIndex,
        itemsPerScreen
      )

      // Cancel items that are too far away
      if (newPriority === Priority.BACKGROUND) {
        abort()
        requestedAssets.delete(assetId)
      } else {
        // Update priority for items still relevant
        thumbnailService.updatePriority(assetId, newPriority)
      }
    }
  }

  // Debounce viewport changes to avoid thrashing
  const debouncedViewportChange = useDebounceFn(onViewportChange, 50)

  watch(
    () => [virtualScroll.startIndex, virtualScroll.endIndex],
    debouncedViewportChange
  )

  return {
    requestThumbnail,
    onViewportChange
  }
}
```

### Bidirectional Scroll Preloading

When user scrolls quickly, preload in the scroll direction:

```typescript
/**
 * Enhanced priority calculation with scroll direction awareness.
 */
function calculatePriorityWithDirection(
  itemIndex: number,
  viewportStart: number,
  viewportEnd: number,
  itemsPerScreen: number,
  scrollDirection: 'up' | 'down' | 'none'
): PriorityLevel {
  // Visible items always highest priority
  if (itemIndex >= viewportStart && itemIndex <= viewportEnd) {
    return Priority.VISIBLE
  }

  const isAboveViewport = itemIndex < viewportStart
  const isBelowViewport = itemIndex > viewportEnd

  // Prioritize items in scroll direction
  const isInScrollDirection =
    (scrollDirection === 'down' && isBelowViewport) ||
    (scrollDirection === 'up' && isAboveViewport)

  const distance = Math.min(
    Math.abs(itemIndex - viewportStart),
    Math.abs(itemIndex - viewportEnd)
  )

  if (distance <= itemsPerScreen) {
    return isInScrollDirection ? Priority.VISIBLE : Priority.NEAR_VISIBLE
  }

  if (distance <= itemsPerScreen * 2) {
    return isInScrollDirection ? Priority.NEAR_VISIBLE : Priority.PRELOAD
  }

  return Priority.BACKGROUND
}
```

---

## 3. Cancellation Patterns

### Problem Statement

When user scrolls quickly, we need to:
- Cancel in-progress work for items no longer visible
- Cancel queued requests that won't be needed
- Free resources (memory, worker time)
- Handle race conditions cleanly

### AbortController Integration

```typescript
/**
 * ThumbnailService with AbortController support.
 */
class ThumbnailService {
  private queue: ThumbnailQueue
  private decodeService: IDecodeService
  private processing = false
  private currentRequest: ThumbnailRequest | null = null

  /**
   * Generate a thumbnail with abort support.
   */
  generate(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: number
  ): { promise: Promise<Blob>; abort: () => void } {
    const result = this.queue.enqueue(assetId, getBytes, priority)

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue()
    }

    return result
  }

  /**
   * Process queue items sequentially.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (true) {
      const request = this.queue.peek()
      if (!request) break

      this.currentRequest = request

      try {
        // Check if already cancelled
        if (request.abortController.signal.aborted) {
          this.queue.remove(request.assetId)
          continue
        }

        // Generate thumbnail
        const thumbnail = await this.generateThumbnail(
          request.assetId,
          request.getBytes,
          request.abortController.signal
        )

        // Remove from queue and resolve
        this.queue.remove(request.assetId)
        request.resolve(thumbnail)

      } catch (error) {
        this.queue.remove(request.assetId)

        if (error instanceof Error && error.name === 'AbortError') {
          request.reject(new Error('Cancelled'))
        } else {
          request.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      this.currentRequest = null
    }

    this.processing = false
  }

  /**
   * Generate thumbnail with abort support.
   */
  private async generateThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    signal: AbortSignal
  ): Promise<Blob> {
    // Check if cancelled before reading file
    if (signal.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }

    // Read file bytes
    const bytes = await getBytes()

    // Check again after file read
    if (signal.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }

    // Generate thumbnail via DecodeService
    const decoded = await this.decodeService.generateThumbnail(bytes, {
      size: 256
    })

    // Check after decode (worker might have taken time)
    if (signal.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }

    // Convert to blob
    return this.pixelsToBlob(decoded)
  }

  /**
   * Cancel a specific request.
   */
  cancel(assetId: string): boolean {
    return this.queue.remove(assetId)
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    this.queue.clear()
  }
}
```

### Handling In-Progress Worker Operations

The current DecodeService doesn't support cancellation of in-progress WASM operations. Options:

**Option A: Accept Wasted Work (Recommended for v1)**
```typescript
// The worker completes but we ignore the result
private async generateThumbnail(
  assetId: string,
  getBytes: () => Promise<Uint8Array>,
  signal: AbortSignal
): Promise<Blob> {
  const decoded = await this.decodeService.generateThumbnail(bytes)

  // Check after decode - if cancelled, still free memory but don't cache
  if (signal.aborted) {
    throw new DOMException('Cancelled', 'AbortError')
  }

  return this.pixelsToBlob(decoded)
}
```

**Option B: Add Cancellation to DecodeService (Future)**
```typescript
// Would require changes to worker-messages.ts
interface CancelRequest {
  id: string
  type: 'cancel'
  targetId: string
}

// Worker would check periodically during long operations
// Not recommended for WASM since it's hard to interrupt
```

### Cleanup on Component Unmount

```typescript
/**
 * Vue composable with proper cleanup.
 */
function useThumbnailsWithCleanup() {
  const pendingRequests = new Map<string, () => void>()

  function request(assetId: string, ...args: any[]): Promise<Blob> {
    const { promise, abort } = thumbnailService.generate(assetId, ...args)
    pendingRequests.set(assetId, abort)

    return promise.finally(() => {
      pendingRequests.delete(assetId)
    })
  }

  // Cancel all pending on unmount
  onUnmounted(() => {
    for (const abort of pendingRequests.values()) {
      abort()
    }
    pendingRequests.clear()
  })

  return { request }
}
```

---

## 4. Caching Strategy

### Problem Statement

Thumbnails should be:
- Fast to retrieve on second access (memory cache)
- Persistent across page reloads (IndexedDB)
- Memory-bounded (don't run out of RAM)
- Deduplicated (same file = same thumbnail)

### Two-Tier Cache Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Request                               │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
                ┌─────────────────┐
                │  Memory Cache   │ ◀──── LRU, 100-200 items
                │   (Blob URLs)   │        ~10-20MB
                └────────┬────────┘
                         │ miss
                         ▼
                ┌─────────────────┐
                │   IndexedDB     │ ◀──── Persistent, 1000+ items
                │  (Blob storage) │        Size limit TBD
                └────────┬────────┘
                         │ miss
                         ▼
                ┌─────────────────┐
                │ DecodeService   │ ◀──── Generate from source
                │   (Worker)      │
                └─────────────────┘
```

### LRU In-Memory Cache

```typescript
/**
 * LRU cache for thumbnail Blob URLs.
 * Uses Map ordering for LRU behavior.
 */
class ThumbnailMemoryCache {
  private cache = new Map<string, { url: string; blob: Blob }>()
  private readonly maxSize: number

  constructor(maxSize = 150) {
    this.maxSize = maxSize
  }

  /**
   * Get a cached thumbnail.
   * Moves item to end (most recently used).
   */
  get(assetId: string): string | undefined {
    const entry = this.cache.get(assetId)
    if (entry) {
      // Move to end for LRU
      this.cache.delete(assetId)
      this.cache.set(assetId, entry)
      return entry.url
    }
    return undefined
  }

  /**
   * Store a thumbnail.
   * Evicts oldest if at capacity.
   */
  set(assetId: string, blob: Blob): string {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        const oldest = this.cache.get(oldestKey)
        if (oldest) {
          URL.revokeObjectURL(oldest.url)
        }
        this.cache.delete(oldestKey)
      }
    }

    const url = URL.createObjectURL(blob)
    this.cache.set(assetId, { url, blob })
    return url
  }

  /**
   * Check if asset is cached.
   */
  has(assetId: string): boolean {
    return this.cache.has(assetId)
  }

  /**
   * Remove a specific thumbnail.
   */
  delete(assetId: string): boolean {
    const entry = this.cache.get(assetId)
    if (entry) {
      URL.revokeObjectURL(entry.url)
      this.cache.delete(assetId)
      return true
    }
    return false
  }

  /**
   * Clear all cached thumbnails.
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      URL.revokeObjectURL(entry.url)
    }
    this.cache.clear()
  }

  /**
   * Current cache size.
   */
  get size(): number {
    return this.cache.size
  }
}
```

### IndexedDB Persistent Cache

```typescript
import { openDB, type IDBPDatabase } from 'idb'

/**
 * IndexedDB schema for thumbnail storage.
 */
interface ThumbnailDB {
  thumbnails: {
    key: string  // assetId
    value: {
      assetId: string
      blob: Blob
      sourceHash: string  // Hash of source file for invalidation
      createdAt: number
      lastAccessed: number
    }
  }
}

/**
 * Persistent thumbnail cache using IndexedDB.
 */
class ThumbnailPersistentCache {
  private db: IDBPDatabase<ThumbnailDB> | null = null
  private initPromise: Promise<void> | null = null

  /**
   * Initialize the database.
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      this.db = await openDB<ThumbnailDB>('literoom-thumbnails', 1, {
        upgrade(db) {
          const store = db.createObjectStore('thumbnails', { keyPath: 'assetId' })
          store.createIndex('lastAccessed', 'lastAccessed')
          store.createIndex('createdAt', 'createdAt')
        }
      })
    })()

    return this.initPromise
  }

  /**
   * Get a thumbnail from the cache.
   */
  async get(assetId: string): Promise<Blob | undefined> {
    await this.init()
    const entry = await this.db!.get('thumbnails', assetId)

    if (entry) {
      // Update last accessed time (fire and forget)
      this.db!.put('thumbnails', {
        ...entry,
        lastAccessed: Date.now()
      })
      return entry.blob
    }

    return undefined
  }

  /**
   * Store a thumbnail.
   */
  async set(assetId: string, blob: Blob, sourceHash: string): Promise<void> {
    await this.init()
    await this.db!.put('thumbnails', {
      assetId,
      blob,
      sourceHash,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    })
  }

  /**
   * Check if a thumbnail exists and is valid.
   */
  async has(assetId: string, sourceHash?: string): Promise<boolean> {
    await this.init()
    const entry = await this.db!.get('thumbnails', assetId)

    if (!entry) return false
    if (sourceHash && entry.sourceHash !== sourceHash) return false

    return true
  }

  /**
   * Delete a specific thumbnail.
   */
  async delete(assetId: string): Promise<void> {
    await this.init()
    await this.db!.delete('thumbnails', assetId)
  }

  /**
   * Evict old thumbnails to free space.
   * Uses LRU based on lastAccessed.
   */
  async evictOldest(count: number): Promise<void> {
    await this.init()

    const tx = this.db!.transaction('thumbnails', 'readwrite')
    const index = tx.store.index('lastAccessed')

    let cursor = await index.openCursor()
    let deleted = 0

    while (cursor && deleted < count) {
      await cursor.delete()
      deleted++
      cursor = await cursor.continue()
    }

    await tx.done
  }

  /**
   * Get total count of cached thumbnails.
   */
  async count(): Promise<number> {
    await this.init()
    return this.db!.count('thumbnails')
  }
}
```

### OPFS Alternative for Large Collections

For very large thumbnail caches (10,000+ images), consider OPFS:

```typescript
/**
 * OPFS-based thumbnail cache.
 * Better for large binary blobs than IndexedDB.
 */
class ThumbnailOPFSCache {
  private root: FileSystemDirectoryHandle | null = null

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory()
    // Create thumbnails subdirectory
    this.root = await this.root.getDirectoryHandle('thumbnails', { create: true })
  }

  /**
   * Generate filename from assetId.
   * Uses hash to avoid invalid characters.
   */
  private getFilename(assetId: string): string {
    // Simple hash for filename safety
    let hash = 0
    for (let i = 0; i < assetId.length; i++) {
      hash = ((hash << 5) - hash) + assetId.charCodeAt(i)
      hash |= 0
    }
    return `thumb_${Math.abs(hash).toString(16)}.jpg`
  }

  async get(assetId: string): Promise<Blob | undefined> {
    try {
      const filename = this.getFilename(assetId)
      const fileHandle = await this.root!.getFileHandle(filename)
      const file = await fileHandle.getFile()
      return file
    } catch {
      return undefined
    }
  }

  async set(assetId: string, blob: Blob): Promise<void> {
    const filename = this.getFilename(assetId)
    const fileHandle = await this.root!.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
  }

  async delete(assetId: string): Promise<void> {
    const filename = this.getFilename(assetId)
    try {
      await this.root!.removeEntry(filename)
    } catch {
      // File doesn't exist, ignore
    }
  }
}
```

### Unified Cache Manager

```typescript
/**
 * Unified thumbnail cache with two tiers.
 */
class ThumbnailCacheManager {
  private memoryCache: ThumbnailMemoryCache
  private persistentCache: ThumbnailPersistentCache

  constructor() {
    this.memoryCache = new ThumbnailMemoryCache(150)
    this.persistentCache = new ThumbnailPersistentCache()
  }

  async init(): Promise<void> {
    await this.persistentCache.init()
  }

  /**
   * Get thumbnail URL, checking memory then persistent cache.
   */
  async get(assetId: string): Promise<string | undefined> {
    // Check memory cache first (fast path)
    const memoryUrl = this.memoryCache.get(assetId)
    if (memoryUrl) {
      return memoryUrl
    }

    // Check persistent cache
    const persistedBlob = await this.persistentCache.get(assetId)
    if (persistedBlob) {
      // Promote to memory cache
      return this.memoryCache.set(assetId, persistedBlob)
    }

    return undefined
  }

  /**
   * Store thumbnail in both caches.
   */
  async set(assetId: string, blob: Blob, sourceHash: string): Promise<string> {
    // Store in both caches
    const url = this.memoryCache.set(assetId, blob)

    // Fire and forget for persistent cache
    this.persistentCache.set(assetId, blob, sourceHash).catch(err => {
      console.warn('Failed to persist thumbnail:', err)
    })

    return url
  }

  /**
   * Check if thumbnail exists.
   */
  async has(assetId: string): Promise<boolean> {
    if (this.memoryCache.has(assetId)) {
      return true
    }
    return this.persistentCache.has(assetId)
  }

  /**
   * Clear memory cache but keep persistent cache.
   */
  clearMemory(): void {
    this.memoryCache.clear()
  }
}
```

---

## 5. Worker Integration

### Problem Statement

The existing DecodeService:
- Runs in a Web Worker
- Handles one request at a time
- Has timeout handling (30 seconds)
- Uses Transferable for efficient data transfer

We need to integrate thumbnail generation without modifying DecodeService significantly.

### Recommended Integration Pattern

```typescript
/**
 * ThumbnailService wraps DecodeService with queue management.
 */
class ThumbnailService {
  private queue: ThumbnailQueue
  private cache: ThumbnailCacheManager
  private decodeService: IDecodeService

  private processing = false
  private currentAssetId: string | null = null

  constructor(decodeService: IDecodeService) {
    this.decodeService = decodeService
    this.queue = new ThumbnailQueue()
    this.cache = new ThumbnailCacheManager()
  }

  async init(): Promise<void> {
    await this.cache.init()
  }

  /**
   * Request a thumbnail.
   * Returns URL immediately if cached, otherwise queues generation.
   */
  async getThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: number = Priority.BACKGROUND,
    sourceHash?: string
  ): Promise<string> {
    // Check cache first
    const cached = await this.cache.get(assetId)
    if (cached) {
      return cached
    }

    // Queue generation
    const { promise } = this.queue.enqueue(assetId, getBytes, priority)
    this.processQueue() // Fire and forget

    const blob = await promise
    return this.cache.set(assetId, blob, sourceHash ?? assetId)
  }

  /**
   * Process queue items.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (true) {
      const request = this.queue.peek()
      if (!request) break

      // Skip if aborted
      if (request.abortController.signal.aborted) {
        this.queue.remove(request.assetId)
        continue
      }

      this.currentAssetId = request.assetId

      try {
        const bytes = await request.getBytes()

        // Check abort again after file read
        if (request.abortController.signal.aborted) {
          this.queue.remove(request.assetId)
          request.reject(new DOMException('Cancelled', 'AbortError'))
          continue
        }

        const decoded = await this.decodeService.generateThumbnail(bytes, {
          size: 256
        })

        // Convert to JPEG blob
        const blob = await this.pixelsToJpegBlob(
          decoded.pixels,
          decoded.width,
          decoded.height
        )

        this.queue.remove(request.assetId)
        request.resolve(blob)

      } catch (error) {
        this.queue.remove(request.assetId)
        request.reject(error instanceof Error ? error : new Error(String(error)))
      }

      this.currentAssetId = null
    }

    this.processing = false
  }

  /**
   * Convert RGB pixels to JPEG Blob using canvas.
   */
  private async pixelsToJpegBlob(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<Blob> {
    // Use OffscreenCanvas for worker compatibility
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!

    // Create ImageData from RGB pixels
    const imageData = ctx.createImageData(width, height)
    const data = imageData.data

    // Convert RGB to RGBA
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      data[j] = pixels[i]      // R
      data[j + 1] = pixels[i + 1]  // G
      data[j + 2] = pixels[i + 2]  // B
      data[j + 3] = 255        // A
    }

    ctx.putImageData(imageData, 0, 0)

    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }

  /**
   * Update priority for a queued request.
   */
  updatePriority(assetId: string, priority: number): void {
    this.queue.updatePriority(assetId, priority)
  }

  /**
   * Cancel a pending request.
   */
  cancel(assetId: string): void {
    this.queue.remove(assetId)
  }

  /**
   * Current queue size.
   */
  get queueSize(): number {
    return this.queue.size
  }
}
```

### Creating Thumbnail Service from DecodeService

```typescript
// Nuxt composable usage
const useThumbnailService = async () => {
  const { decodeService } = useDecode()

  const thumbnailService = new ThumbnailService(decodeService)
  await thumbnailService.init()

  return thumbnailService
}

// Or as a Nuxt plugin
export default defineNuxtPlugin(async () => {
  const { decodeService } = useDecode()

  const thumbnailService = new ThumbnailService(decodeService)
  await thumbnailService.init()

  return {
    provide: {
      thumbnailService
    }
  }
})
```

---

## 6. Batch Processing Analysis

### Should We Batch Multiple Thumbnails?

**Arguments for batching:**
- Reduced postMessage overhead (one message vs many)
- Potentially better WASM memory utilization
- Could process multiple in parallel if worker pool

**Arguments against batching (Recommended for v1):**
- Simpler implementation
- Better cancellation granularity
- Current DecodeService handles one-at-a-time
- WASM memory is per-operation anyway
- Priority queue handles ordering better than batch groups

### Sequential Processing Pattern (Recommended)

```typescript
// Process one at a time with priority queue
while (this.queue.peek()) {
  const request = this.queue.peek()
  await this.processOne(request)
  this.queue.remove(request.assetId)
}
```

### Future: Worker Pool for Parallel Processing

If sequential becomes a bottleneck:

```typescript
/**
 * Worker pool for parallel thumbnail generation.
 * Only implement if sequential processing is too slow.
 */
class ThumbnailWorkerPool {
  private workers: DecodeService[] = []
  private available: DecodeService[] = []
  private waiting: Array<(worker: DecodeService) => void> = []

  constructor(private size: number = 2) {}

  async init(): Promise<void> {
    for (let i = 0; i < this.size; i++) {
      const worker = await DecodeService.create()
      this.workers.push(worker)
      this.available.push(worker)
    }
  }

  async acquire(): Promise<DecodeService> {
    if (this.available.length > 0) {
      return this.available.pop()!
    }

    return new Promise(resolve => {
      this.waiting.push(resolve)
    })
  }

  release(worker: DecodeService): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!
      resolve(worker)
    } else {
      this.available.push(worker)
    }
  }

  destroy(): void {
    for (const worker of this.workers) {
      worker.destroy()
    }
    this.workers = []
    this.available = []
  }
}
```

---

## 7. Complete Integration Example

### ThumbnailGrid Component

```vue
<script setup lang="ts">
import { useVirtualList } from '@vueuse/core'

const props = defineProps<{
  assets: Asset[]
}>()

const thumbnailService = inject('thumbnailService') as ThumbnailService

// Virtual list setup
const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(
  computed(() => props.assets),
  {
    itemHeight: 256,
    itemsPerRow: 4 // Adjust based on container width
  }
)

// Track scroll direction
const lastScrollTop = ref(0)
const scrollDirection = ref<'up' | 'down' | 'none'>('none')

function onScroll(event: Event) {
  const target = event.target as HTMLElement
  scrollDirection.value = target.scrollTop > lastScrollTop.value ? 'down' : 'up'
  lastScrollTop.value = target.scrollTop
}

// Request thumbnails for visible items
const thumbnailUrls = reactive(new Map<string, string>())
const pendingRequests = new Map<string, () => void>()

// Watch for visibility changes
watch(
  () => list.value,
  async (visibleItems) => {
    for (const { data: asset, index } of visibleItems) {
      if (thumbnailUrls.has(asset.id)) continue
      if (pendingRequests.has(asset.id)) continue

      const priority = calculatePriorityWithDirection(
        index,
        list.value[0]?.index ?? 0,
        list.value[list.value.length - 1]?.index ?? 0,
        20,
        scrollDirection.value
      )

      const { promise, abort } = thumbnailService.generate(
        asset.id,
        () => asset.readBytes(),
        priority
      )

      pendingRequests.set(asset.id, abort)

      promise
        .then(blob => {
          const url = URL.createObjectURL(blob)
          thumbnailUrls.set(asset.id, url)
        })
        .catch(err => {
          if (err.name !== 'AbortError') {
            console.error('Thumbnail failed:', err)
          }
        })
        .finally(() => {
          pendingRequests.delete(asset.id)
        })
    }
  },
  { immediate: true }
)

// Cleanup on unmount
onUnmounted(() => {
  // Cancel pending requests
  for (const abort of pendingRequests.values()) {
    abort()
  }
  pendingRequests.clear()

  // Revoke object URLs
  for (const url of thumbnailUrls.values()) {
    URL.revokeObjectURL(url)
  }
  thumbnailUrls.clear()
})
</script>

<template>
  <div
    v-bind="containerProps"
    class="thumbnail-grid"
    @scroll="onScroll"
  >
    <div v-bind="wrapperProps">
      <div
        v-for="{ data: asset, index } in list"
        :key="asset.id"
        class="thumbnail-item"
      >
        <img
          v-if="thumbnailUrls.get(asset.id)"
          :src="thumbnailUrls.get(asset.id)"
          :alt="asset.filename"
        />
        <div v-else class="thumbnail-placeholder">
          <!-- Skeleton or spinner -->
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## 8. Performance Considerations

### Metrics to Track

```typescript
interface ThumbnailMetrics {
  queueSize: number
  cacheHitRate: number
  averageGenerationTime: number
  cancelledCount: number
  errorCount: number
}

class MetricsThumbnailService extends ThumbnailService {
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    totalGenTime: 0,
    genCount: 0,
    cancelled: 0,
    errors: 0
  }

  async getThumbnail(...args: any[]): Promise<string> {
    const cached = await this.cache.get(args[0])
    if (cached) {
      this.metrics.cacheHits++
      return cached
    }

    this.metrics.cacheMisses++
    const start = performance.now()

    try {
      const result = await super.getThumbnail(...args)
      this.metrics.totalGenTime += performance.now() - start
      this.metrics.genCount++
      return result
    } catch (err) {
      if (err.name === 'AbortError') {
        this.metrics.cancelled++
      } else {
        this.metrics.errors++
      }
      throw err
    }
  }

  getMetrics(): ThumbnailMetrics {
    return {
      queueSize: this.queueSize,
      cacheHitRate: this.metrics.cacheHits /
        (this.metrics.cacheHits + this.metrics.cacheMisses),
      averageGenerationTime: this.metrics.totalGenTime / this.metrics.genCount,
      cancelledCount: this.metrics.cancelled,
      errorCount: this.metrics.errors
    }
  }
}
```

### Recommended Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| Memory cache size | 150 items | ~7.5MB at 50KB/thumbnail |
| Max queue size | 200 items | ~2-3 screens worth |
| Thumbnail size | 256px | Good balance of quality/size |
| JPEG quality | 85% | Good compression, minimal artifacts |
| Debounce viewport | 50ms | Smooth scrolling feel |
| Worker timeout | 30s | Already in DecodeService |

---

## 9. Recommendations Summary

### Phase 1 (MVP)

1. **Implement ThumbnailQueue** with priority and deduplication
2. **Wrap DecodeService** in ThumbnailService with queue management
3. **Add LRU memory cache** (150 items)
4. **Add IndexedDB persistence** with idb library
5. **Integrate with virtual scroll** using viewport-aware priorities
6. **Use sequential processing** (one thumbnail at a time)

### Phase 2 (Optimization)

1. Add metrics tracking
2. Implement scroll direction preloading
3. Add OPFS support for large collections
4. Consider worker pool if sequential is too slow
5. Add thumbnail quality/size options

### Key Patterns to Follow

1. **AbortController everywhere** for cancellation
2. **Two-tier caching** (memory + persistent)
3. **Priority queue with lazy sorting** for efficiency
4. **Debounced viewport updates** to prevent thrashing
5. **Fire-and-forget persistence** (don't block on IndexedDB writes)

---

## 10. References

- [VueUse Virtual List](https://vueuse.org/core/useVirtualList/)
- [idb Library](https://github.com/jakearchibald/idb)
- [OPFS API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
