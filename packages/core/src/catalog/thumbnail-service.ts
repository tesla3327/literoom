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
  type PreviewReadyCallback,
  type PreviewErrorCallback,
  CatalogError,
} from './types'
import { ThumbnailQueue } from './thumbnail-queue'
import { ThumbnailCache, PreviewCache, type IThumbnailCache, type IPreviewCache } from './thumbnail-cache'

// ============================================================================
// Constants
// ============================================================================

/** Default thumbnail size (longest edge in pixels) */
const DEFAULT_THUMBNAIL_SIZE = 512

/** Default preview size (longest edge in pixels) */
const DEFAULT_PREVIEW_SIZE = 2560

/** Maximum queue size to prevent memory issues */
const MAX_QUEUE_SIZE = 200

/** Maximum memory cache entries for thumbnails */
const MAX_MEMORY_CACHE_SIZE = 150

/** Maximum memory cache entries for previews (smaller due to larger size) */
const MAX_PREVIEW_MEMORY_CACHE_SIZE = 20

/** Default concurrent thumbnail processing limit */
const DEFAULT_CONCURRENCY = 4

/** Maximum concurrent processing limit */
const MAX_CONCURRENCY = 8

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
  // Thumbnail generation
  private readonly queue: ThumbnailQueue
  private readonly cache: IThumbnailCache
  private readonly decodeService: IDecodeService
  private readonly thumbnailSize: number
  private readonly concurrency: number

  private _isProcessing = false
  private _activeCount = 0
  private _onThumbnailReady: ThumbnailReadyCallback | null = null
  private _onThumbnailError: ThumbnailErrorCallback | null = null

  /** Set of assetIds currently being processed or requested */
  private activeRequests = new Set<string>()

  // Preview generation (larger images for edit view)
  private readonly previewQueue: ThumbnailQueue
  private readonly previewCache: IPreviewCache
  private readonly previewSize: number

  private _isProcessingPreviews = false
  private _activePreviewCount = 0
  private _onPreviewReady: PreviewReadyCallback | null = null
  private _onPreviewError: PreviewErrorCallback | null = null

  /** Set of assetIds currently being processed or requested for previews */
  private activePreviewRequests = new Set<string>()

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

    // Set concurrency, defaulting to navigator.hardwareConcurrency if available
    const defaultConcurrency = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || DEFAULT_CONCURRENCY)
      : DEFAULT_CONCURRENCY
    this.concurrency = Math.min(options.concurrency ?? defaultConcurrency, MAX_CONCURRENCY)

    // Preview generation initialization
    this.previewSize = options.previewSize ?? DEFAULT_PREVIEW_SIZE
    this.previewQueue = new ThumbnailQueue(options.maxQueueSize ?? MAX_QUEUE_SIZE)
    this.previewCache = options.previewCache ?? new PreviewCache(options.maxPreviewMemoryCacheSize ?? MAX_PREVIEW_MEMORY_CACHE_SIZE)
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
  // Preview Methods (IThumbnailService)
  // ==========================================================================

  /**
   * Request preview generation with priority.
   *
   * If the preview is already cached, the callback is invoked immediately.
   * If already queued, the priority is updated.
   */
  requestPreview(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): void {
    // Check if already processing
    if (this.activePreviewRequests.has(assetId)) {
      // Update priority if already in queue
      if (this.previewQueue.has(assetId)) {
        this.previewQueue.updatePriority(assetId, priority)
      }
      return
    }

    // Check cache first (async, but start processing immediately)
    this.checkPreviewCacheAndQueue(assetId, getBytes, priority)
  }

  /**
   * Check preview cache and either return cached or add to queue.
   */
  private async checkPreviewCacheAndQueue(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): Promise<void> {
    // Check cache
    const cachedUrl = await this.previewCache.get(assetId)
    if (cachedUrl) {
      // Already cached - notify immediately
      this._onPreviewReady?.(assetId, cachedUrl)
      return
    }

    // Mark as active and add to queue
    this.activePreviewRequests.add(assetId)
    this.previewQueue.enqueue({
      assetId,
      priority,
      getBytes,
    })

    // Start processing if not already running
    this.processPreviewQueue()
  }

  /**
   * Update the priority of a queued preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void {
    this.previewQueue.updatePriority(assetId, priority)
  }

  /**
   * Cancel a pending preview request.
   */
  cancelPreview(assetId: string): void {
    this.previewQueue.remove(assetId)
    this.activePreviewRequests.delete(assetId)
  }

  /**
   * Cancel all pending preview requests.
   */
  cancelAllPreviews(): void {
    this.previewQueue.clear()
    this.activePreviewRequests.clear()
  }

  /**
   * Clear the in-memory preview cache.
   */
  clearPreviewCache(): void {
    this.previewCache.clearMemory()
  }

  /**
   * Set callback for when a preview is ready.
   */
  set onPreviewReady(callback: PreviewReadyCallback | null) {
    this._onPreviewReady = callback
  }

  get onPreviewReady(): PreviewReadyCallback | null {
    return this._onPreviewReady
  }

  /**
   * Set callback for when a preview fails.
   */
  set onPreviewError(callback: PreviewErrorCallback | null) {
    this._onPreviewError = callback
  }

  get onPreviewError(): PreviewErrorCallback | null {
    return this._onPreviewError
  }

  /**
   * Current preview queue size.
   */
  get previewQueueSize(): number {
    return this.previewQueue.size
  }

  /**
   * Whether the service is currently processing previews.
   */
  get isProcessingPreviews(): boolean {
    return this._isProcessingPreviews
  }

  // ==========================================================================
  // Queue Processing
  // ==========================================================================

  /**
   * Process the queue with configurable concurrency.
   *
   * Multiple items are processed in parallel up to the concurrency limit,
   * maximizing throughput when using a pooled decode service.
   */
  private processQueue(): void {
    if (this._isProcessing) {
      return
    }

    this._isProcessing = true
    this.fillProcessingSlots()
  }

  /**
   * Fill available processing slots with items from the queue.
   */
  private fillProcessingSlots(): void {
    while (this._activeCount < this.concurrency && !this.queue.isEmpty) {
      const item = this.queue.dequeue()
      if (!item) {
        break
      }

      this._activeCount++
      // Process without awaiting - completion is handled in processItem
      this.processItem(item.assetId, item.getBytes)
    }

    // If no items are being processed and queue is empty, we're done
    if (this._activeCount === 0) {
      this._isProcessing = false
    }
  }

  /**
   * Process a single thumbnail request.
   * Handles its own completion signaling for parallel processing.
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
      this._activeCount--

      // Try to fill more processing slots
      this.fillProcessingSlots()
    }
  }

  /**
   * Convert a decoded image to a JPEG blob.
   */
  private async decodedImageToBlob(image: DecodedImage, quality: number = 0.85): Promise<Blob> {
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
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }

  // ==========================================================================
  // Preview Queue Processing
  // ==========================================================================

  /**
   * Process the preview queue with configurable concurrency.
   */
  private processPreviewQueue(): void {
    if (this._isProcessingPreviews) {
      return
    }

    this._isProcessingPreviews = true
    this.fillPreviewProcessingSlots()
  }

  /**
   * Fill available preview processing slots with items from the queue.
   */
  private fillPreviewProcessingSlots(): void {
    while (this._activePreviewCount < this.concurrency && !this.previewQueue.isEmpty) {
      const item = this.previewQueue.dequeue()
      if (!item) {
        break
      }

      this._activePreviewCount++
      // Process without awaiting - completion is handled in processPreviewItem
      this.processPreviewItem(item.assetId, item.getBytes)
    }

    // If no items are being processed and queue is empty, we're done
    if (this._activePreviewCount === 0) {
      this._isProcessingPreviews = false
    }
  }

  /**
   * Process a single preview request.
   * Handles its own completion signaling for parallel processing.
   */
  private async processPreviewItem(
    assetId: string,
    getBytes: () => Promise<Uint8Array>
  ): Promise<void> {
    try {
      // Get image bytes
      const bytes = await getBytes()

      // Generate preview using decode service (larger than thumbnail)
      const decoded = await this.decodeService.generatePreview(bytes, {
        maxEdge: this.previewSize,
        filter: 'lanczos3', // Higher quality for previews
      })

      // Convert to blob for caching (higher quality for previews)
      const blob = await this.decodedImageToBlob(decoded, 0.92)

      // Store in cache
      const url = await this.previewCache.set(assetId, blob)

      // Notify success
      this._onPreviewReady?.(assetId, url)
    } catch (error) {
      // Notify failure
      const catalogError =
        error instanceof Error
          ? new CatalogError(error.message, 'THUMBNAIL_ERROR', error)
          : new CatalogError('Unknown preview error', 'THUMBNAIL_ERROR')

      this._onPreviewError?.(assetId, catalogError)
    } finally {
      this.activePreviewRequests.delete(assetId)
      this._activePreviewCount--

      // Try to fill more processing slots
      this.fillPreviewProcessingSlots()
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.cancelAll()
    this.cancelAllPreviews()
    this.cache.clearMemory()
    this.previewCache.clearMemory()
  }
}

// ============================================================================
// Options Interface
// ============================================================================

/**
 * Options for creating a ThumbnailService.
 */
export interface ThumbnailServiceOptions {
  /** Size of thumbnails to generate (longest edge, default: 512) */
  thumbnailSize?: number
  /** Size of previews to generate (longest edge, default: 2560) */
  previewSize?: number
  /** Maximum queue size (default: 200) */
  maxQueueSize?: number
  /** Maximum memory cache size for thumbnails (default: 150) */
  maxMemoryCacheSize?: number
  /** Maximum memory cache size for previews (default: 20) */
  maxPreviewMemoryCacheSize?: number
  /** Custom thumbnail cache implementation (for testing) */
  cache?: IThumbnailCache
  /** Custom preview cache implementation (for testing) */
  previewCache?: IPreviewCache
  /** Number of concurrent thumbnail processing operations (default: navigator.hardwareConcurrency or 4, max: 8) */
  concurrency?: number
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
