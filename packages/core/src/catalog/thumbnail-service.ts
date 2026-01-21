/**
 * Thumbnail Service for managing thumbnail generation.
 *
 * Coordinates between:
 * - ThumbnailQueue: Priority-based request ordering
 * - ThumbnailCache: Memory + OPFS caching
 * - DecodeService: Actual image decoding and thumbnail generation
 *
 * The service processes one thumbnail at a time, prioritizing
 * visible thumbnails over off-screen ones for optimal perceived performance.
 */

import type { DecodedImage } from '../decode/types'
import type { IDecodeService } from '../decode/decode-service'
import {
  ThumbnailPriority,
  type IThumbnailService,
  type ThumbnailReadyCallback,
  type ThumbnailErrorCallback,
  CatalogError,
} from './types'
import { ThumbnailQueue } from './thumbnail-queue'
import { ThumbnailCache, type IThumbnailCache } from './thumbnail-cache'

// ============================================================================
// Constants
// ============================================================================

/** Default thumbnail size (longest edge in pixels) */
const DEFAULT_THUMBNAIL_SIZE = 256

/** Maximum queue size to prevent memory issues */
const MAX_QUEUE_SIZE = 200

/** Maximum memory cache entries */
const MAX_MEMORY_CACHE_SIZE = 150

// ============================================================================
// Thumbnail Service Implementation
// ============================================================================

/**
 * Service for managing thumbnail generation with priority ordering and caching.
 *
 * Features:
 * - Priority-based queue (visible items first)
 * - Two-tier caching (memory + OPFS)
 * - Single-threaded processing (one at a time)
 * - Callback-based notification
 *
 * Usage:
 * ```typescript
 * const thumbnailService = await ThumbnailService.create(decodeService)
 *
 * thumbnailService.onThumbnailReady = (assetId, url) => {
 *   // Update UI with thumbnail
 * }
 *
 * thumbnailService.requestThumbnail(assetId, getBytes, ThumbnailPriority.VISIBLE)
 * ```
 */
export class ThumbnailService implements IThumbnailService {
  private readonly queue: ThumbnailQueue
  private readonly cache: IThumbnailCache
  private readonly decodeService: IDecodeService
  private readonly thumbnailSize: number

  private _isProcessing = false
  private _onThumbnailReady: ThumbnailReadyCallback | null = null
  private _onThumbnailError: ThumbnailErrorCallback | null = null

  /** Set of assetIds currently being processed or requested */
  private activeRequests = new Set<string>()

  /**
   * Private constructor - use ThumbnailService.create() instead.
   */
  private constructor(
    decodeService: IDecodeService,
    options: ThumbnailServiceOptions = {}
  ) {
    this.decodeService = decodeService
    this.thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE
    this.queue = new ThumbnailQueue(options.maxQueueSize ?? MAX_QUEUE_SIZE)
    this.cache = options.cache ?? new ThumbnailCache(options.maxMemoryCacheSize ?? MAX_MEMORY_CACHE_SIZE)
  }

  /**
   * Create a new ThumbnailService instance.
   */
  static async create(
    decodeService: IDecodeService,
    options?: ThumbnailServiceOptions
  ): Promise<ThumbnailService> {
    const service = new ThumbnailService(decodeService, options)
    return service
  }

  // ==========================================================================
  // IThumbnailService Implementation
  // ==========================================================================

  /**
   * Request thumbnail generation with priority.
   *
   * If the thumbnail is already cached, the callback is invoked immediately.
   * If already queued, the priority is updated.
   */
  requestThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): void {
    // Check if already processing
    if (this.activeRequests.has(assetId)) {
      // Update priority if already in queue
      if (this.queue.has(assetId)) {
        this.queue.updatePriority(assetId, priority)
      }
      return
    }

    // Check cache first (async, but start processing immediately)
    this.checkCacheAndQueue(assetId, getBytes, priority)
  }

  /**
   * Check cache and either return cached or add to queue.
   */
  private async checkCacheAndQueue(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): Promise<void> {
    // Check cache
    const cachedUrl = await this.cache.get(assetId)
    if (cachedUrl) {
      // Already cached - notify immediately
      this._onThumbnailReady?.(assetId, cachedUrl)
      return
    }

    // Mark as active and add to queue
    this.activeRequests.add(assetId)
    this.queue.enqueue({
      assetId,
      priority,
      getBytes,
    })

    // Start processing if not already running
    this.processQueue()
  }

  /**
   * Update the priority of a queued thumbnail request.
   */
  updatePriority(assetId: string, priority: ThumbnailPriority): void {
    this.queue.updatePriority(assetId, priority)
  }

  /**
   * Cancel a pending thumbnail request.
   */
  cancel(assetId: string): void {
    this.queue.remove(assetId)
    this.activeRequests.delete(assetId)
  }

  /**
   * Cancel all pending thumbnail requests.
   */
  cancelAll(): void {
    this.queue.clear()
    this.activeRequests.clear()
  }

  /**
   * Clear the in-memory thumbnail cache.
   */
  clearMemoryCache(): void {
    this.cache.clearMemory()
  }

  /**
   * Set callback for when a thumbnail is ready.
   */
  set onThumbnailReady(callback: ThumbnailReadyCallback | null) {
    this._onThumbnailReady = callback
  }

  get onThumbnailReady(): ThumbnailReadyCallback | null {
    return this._onThumbnailReady
  }

  /**
   * Set callback for when a thumbnail fails.
   */
  set onThumbnailError(callback: ThumbnailErrorCallback | null) {
    this._onThumbnailError = callback
  }

  get onThumbnailError(): ThumbnailErrorCallback | null {
    return this._onThumbnailError
  }

  /**
   * Current queue size.
   */
  get queueSize(): number {
    return this.queue.size
  }

  /**
   * Whether the service is currently processing thumbnails.
   */
  get isProcessing(): boolean {
    return this._isProcessing
  }

  // ==========================================================================
  // Queue Processing
  // ==========================================================================

  /**
   * Process the queue one item at a time.
   *
   * Processing is single-threaded to avoid overwhelming the decode worker
   * and to ensure predictable resource usage.
   */
  private async processQueue(): Promise<void> {
    if (this._isProcessing) {
      return
    }

    this._isProcessing = true

    try {
      while (!this.queue.isEmpty) {
        const item = this.queue.dequeue()
        if (!item) {
          break
        }

        await this.processItem(item.assetId, item.getBytes)
      }
    } finally {
      this._isProcessing = false
    }
  }

  /**
   * Process a single thumbnail request.
   */
  private async processItem(
    assetId: string,
    getBytes: () => Promise<Uint8Array>
  ): Promise<void> {
    try {
      // Get image bytes
      const bytes = await getBytes()

      // Generate thumbnail using decode service
      const decoded = await this.decodeService.generateThumbnail(bytes, {
        size: this.thumbnailSize,
      })

      // Convert to blob for caching
      const blob = await this.decodedImageToBlob(decoded)

      // Store in cache
      const url = await this.cache.set(assetId, blob)

      // Notify success
      this._onThumbnailReady?.(assetId, url)
    } catch (error) {
      // Notify failure
      const catalogError =
        error instanceof Error
          ? new CatalogError(error.message, 'THUMBNAIL_ERROR', error)
          : new CatalogError('Unknown thumbnail error', 'THUMBNAIL_ERROR')

      this._onThumbnailError?.(assetId, catalogError)
    } finally {
      this.activeRequests.delete(assetId)
    }
  }

  /**
   * Convert a decoded image to a JPEG blob.
   */
  private async decodedImageToBlob(image: DecodedImage): Promise<Blob> {
    // Create canvas to encode as JPEG
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')!

    // Create ImageData from RGB pixels
    const imageData = new ImageData(image.width, image.height)
    const src = image.pixels
    const dst = imageData.data

    // Convert RGB to RGBA (add alpha channel)
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dst[j] = src[i] // R
      dst[j + 1] = src[i + 1] // G
      dst[j + 2] = src[i + 2] // B
      dst[j + 3] = 255 // A
    }

    ctx.putImageData(imageData, 0, 0)

    // Convert to blob
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.cancelAll()
    this.cache.clearMemory()
  }
}

// ============================================================================
// Options Interface
// ============================================================================

/**
 * Options for creating a ThumbnailService.
 */
export interface ThumbnailServiceOptions {
  /** Size of thumbnails to generate (longest edge, default: 256) */
  thumbnailSize?: number
  /** Maximum queue size (default: 200) */
  maxQueueSize?: number
  /** Maximum memory cache size (default: 150) */
  maxMemoryCacheSize?: number
  /** Custom cache implementation (for testing) */
  cache?: IThumbnailCache
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ThumbnailService instance.
 */
export async function createThumbnailService(
  decodeService: IDecodeService,
  options?: ThumbnailServiceOptions
): Promise<ThumbnailService> {
  return ThumbnailService.create(decodeService, options)
}
