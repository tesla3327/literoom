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
import type { EditedThumbnailEditState } from '../decode/worker-messages'
import {
  ThumbnailPriority,
  type IThumbnailService,
  type ThumbnailReadyCallback,
  type ThumbnailErrorCallback,
  type PreviewReadyCallback,
  type PreviewErrorCallback,
  CatalogError,
  type ThumbnailQueueItem,
} from './types'
import { ThumbnailQueue, type ThumbnailQueueItemWithEditState } from './thumbnail-queue'
import { ThumbnailCache, PreviewCache, type IThumbnailCache, type IPreviewCache } from './thumbnail-cache'

// ============================================================================
// Constants
// ============================================================================

/** Default thumbnail size (longest edge in pixels) */
const DEFAULT_THUMBNAIL_SIZE = 256

/** Default preview size (longest edge in pixels) */
const DEFAULT_PREVIEW_SIZE = 1280

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
// Queue Processor Helper
// ============================================================================

/**
 * Generic queue processor for concurrent item processing.
 * Handles queue management, active request tracking, and concurrent slot filling.
 */
class QueueProcessor<T extends ThumbnailQueueItem = ThumbnailQueueItem> {
  readonly queue: ThumbnailQueue
  readonly activeRequests = new Set<string>()
  private _isProcessing = false
  private _activeCount = 0

  constructor(
    maxQueueSize: number,
    private readonly concurrency: number,
    private readonly processItem: (item: T) => Promise<void>,
    private readonly onComplete: (assetId: string) => void
  ) {
    this.queue = new ThumbnailQueue(maxQueueSize)
  }

  get isProcessing(): boolean {
    return this._isProcessing
  }

  get queueSize(): number {
    return this.queue.size
  }

  /**
   * Start processing the queue.
   */
  startProcessing(): void {
    if (this._isProcessing) {
      return
    }
    this._isProcessing = true
    this.fillSlots()
  }

  /**
   * Fill available processing slots with items from the queue.
   */
  private fillSlots(): void {
    while (this._activeCount < this.concurrency && !this.queue.isEmpty) {
      const item = this.queue.dequeue() as T | undefined
      if (!item) {
        break
      }

      this._activeCount++
      // Process without awaiting - completion is handled via callback
      this.processItem(item).finally(() => {
        this.onComplete(item.assetId)
        this.activeRequests.delete(item.assetId)
        this._activeCount--
        this.fillSlots()
      })
    }

    // If no items are being processed and queue is empty, we're done
    if (this._activeCount === 0) {
      this._isProcessing = false
    }
  }

  /**
   * Request an item to be processed.
   * Returns true if a cache check should be performed.
   */
  request(assetId: string, priority: ThumbnailPriority): boolean {
    if (this.activeRequests.has(assetId)) {
      if (this.queue.has(assetId)) {
        this.queue.updatePriority(assetId, priority)
      }
      return false
    }
    return true
  }

  /**
   * Add an item to the queue and start processing.
   */
  enqueue(item: T): void {
    this.activeRequests.add(item.assetId)
    this.queue.enqueue(item)
    this.startProcessing()
  }

  updatePriority(assetId: string, priority: ThumbnailPriority): void {
    this.queue.updatePriority(assetId, priority)
  }

  cancel(assetId: string): void {
    this.queue.remove(assetId)
    this.activeRequests.delete(assetId)
  }

  cancelAll(): void {
    this.queue.clear()
    this.activeRequests.clear()
  }

  /**
   * Cancel all requests with BACKGROUND priority.
   * Returns the number of cancelled requests.
   */
  cancelBackgroundRequests(): number {
    const allItems = this.queue.getAll()
    let cancelled = 0

    for (const item of allItems) {
      if (item.priority === ThumbnailPriority.BACKGROUND) {
        this.queue.remove(item.assetId)
        this.activeRequests.delete(item.assetId)
        cancelled++
      }
    }

    return cancelled
  }
}

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
  private readonly thumbnailProcessor: QueueProcessor<ThumbnailQueueItemWithEditState>
  private readonly cache: IThumbnailCache
  private readonly decodeService: IDecodeService
  private readonly thumbnailSize: number

  private _onThumbnailReady: ThumbnailReadyCallback | null = null
  private _onThumbnailError: ThumbnailErrorCallback | null = null

  /** Generation numbers for tracking stale thumbnail regeneration results */
  private generationNumbers = new Map<string, number>()

  // Preview generation (larger images for edit view)
  private readonly previewProcessor: QueueProcessor
  private readonly previewCache: IPreviewCache
  private readonly previewSize: number

  private _onPreviewReady: PreviewReadyCallback | null = null
  private _onPreviewError: PreviewErrorCallback | null = null

  /**
   * Private constructor - use ThumbnailService.create() instead.
   */
  private constructor(
    decodeService: IDecodeService,
    options: ThumbnailServiceOptions = {}
  ) {
    this.decodeService = decodeService
    this.thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE
    this.cache = options.cache ?? new ThumbnailCache(options.maxMemoryCacheSize ?? MAX_MEMORY_CACHE_SIZE)

    // Set concurrency, defaulting to navigator.hardwareConcurrency if available
    const defaultConcurrency = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || DEFAULT_CONCURRENCY)
      : DEFAULT_CONCURRENCY
    const concurrency = Math.min(options.concurrency ?? defaultConcurrency, MAX_CONCURRENCY)
    const maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE

    // Initialize thumbnail processor
    this.thumbnailProcessor = new QueueProcessor<ThumbnailQueueItemWithEditState>(
      maxQueueSize,
      concurrency,
      (item) => this.processThumbnailItem(item),
      () => {} // Cleanup handled in processThumbnailItem
    )

    // Preview generation initialization
    this.previewSize = options.previewSize ?? DEFAULT_PREVIEW_SIZE
    this.previewCache = options.previewCache ?? new PreviewCache(options.maxPreviewMemoryCacheSize ?? MAX_PREVIEW_MEMORY_CACHE_SIZE)

    // Initialize preview processor
    this.previewProcessor = new QueueProcessor(
      maxQueueSize,
      concurrency,
      (item) => this.processPreviewItem(item),
      () => {} // Cleanup handled in processPreviewItem
    )
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
    if (!this.thumbnailProcessor.request(assetId, priority)) {
      return
    }
    // Check cache first (async, but start processing immediately)
    this.checkThumbnailCacheAndQueue(assetId, getBytes, priority)
  }

  /**
   * Check cache and either return cached or add to queue.
   */
  private async checkThumbnailCacheAndQueue(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): Promise<void> {
    const cachedUrl = await this.cache.get(assetId)
    if (cachedUrl) {
      this._onThumbnailReady?.(assetId, cachedUrl)
      return
    }
    this.thumbnailProcessor.enqueue({ assetId, priority, getBytes })
  }

  /**
   * Update the priority of a queued thumbnail request.
   */
  updatePriority(assetId: string, priority: ThumbnailPriority): void {
    this.thumbnailProcessor.updatePriority(assetId, priority)
  }

  /**
   * Cancel a pending thumbnail request.
   */
  cancel(assetId: string): void {
    this.thumbnailProcessor.cancel(assetId)
  }

  /**
   * Cancel all pending thumbnail requests.
   */
  cancelAll(): void {
    this.thumbnailProcessor.cancelAll()
  }

  /**
   * Clear the in-memory thumbnail cache.
   */
  clearMemoryCache(): void {
    this.cache.clearMemory()
  }

  /**
   * Invalidate an existing thumbnail, removing it from both caches.
   * Also cancels any pending generation and increments the generation number.
   */
  async invalidateThumbnail(assetId: string): Promise<void> {
    // Increment generation number to invalidate in-flight requests
    const gen = (this.generationNumbers.get(assetId) ?? 0) + 1
    this.generationNumbers.set(assetId, gen)

    // Cancel any in-flight requests
    this.thumbnailProcessor.cancel(assetId)

    // Delete from both caches
    await this.cache.delete(assetId)
  }

  /**
   * Regenerate a thumbnail with edits applied.
   *
   * This method:
   * 1. Invalidates the existing thumbnail
   * 2. Queues a new generation with the edit state applied
   * 3. Uses BACKGROUND priority by default to not block visible thumbnails
   *
   * @param assetId - The asset to regenerate
   * @param getBytes - Function to get the source image bytes
   * @param editState - Edit state to apply to the thumbnail
   * @param priority - Queue priority (default: BACKGROUND)
   */
  async regenerateThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    editState: EditedThumbnailEditState,
    priority: ThumbnailPriority = ThumbnailPriority.BACKGROUND
  ): Promise<void> {
    // Get current generation (before invalidation)
    const currentGen = this.generationNumbers.get(assetId) ?? 0

    // Invalidate existing thumbnail
    await this.invalidateThumbnail(assetId)

    // The new generation number after invalidation
    const newGen = this.generationNumbers.get(assetId) ?? 1

    // Enqueue for processing with edit state
    this.thumbnailProcessor.enqueue({
      assetId,
      priority,
      getBytes,
      editState,
      generation: newGen,
    })
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
    return this.thumbnailProcessor.queueSize
  }

  /**
   * Whether the service is currently processing thumbnails.
   */
  get isProcessing(): boolean {
    return this.thumbnailProcessor.isProcessing
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
    if (!this.previewProcessor.request(assetId, priority)) {
      return
    }
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
    const cachedUrl = await this.previewCache.get(assetId)
    if (cachedUrl) {
      this._onPreviewReady?.(assetId, cachedUrl)
      return
    }
    this.previewProcessor.enqueue({ assetId, priority, getBytes })
  }

  /**
   * Update the priority of a queued preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void {
    this.previewProcessor.updatePriority(assetId, priority)
  }

  /**
   * Cancel a pending preview request.
   */
  cancelPreview(assetId: string): void {
    this.previewProcessor.cancel(assetId)
  }

  /**
   * Cancel all pending preview requests.
   */
  cancelAllPreviews(): void {
    this.previewProcessor.cancelAll()
  }

  /**
   * Cancel all BACKGROUND priority requests from both queues.
   * Used to prioritize active work when user starts interacting.
   * Returns the total number of cancelled requests.
   */
  cancelBackgroundRequests(): number {
    const thumbnailCancelled = this.thumbnailProcessor.cancelBackgroundRequests()
    const previewCancelled = this.previewProcessor.cancelBackgroundRequests()
    return thumbnailCancelled + previewCancelled
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
    return this.previewProcessor.queueSize
  }

  /**
   * Whether the service is currently processing previews.
   */
  get isProcessingPreviews(): boolean {
    return this.previewProcessor.isProcessing
  }

  // ==========================================================================
  // Thumbnail Processing
  // ==========================================================================

  /**
   * Process a single thumbnail request.
   */
  private async processThumbnailItem(item: ThumbnailQueueItemWithEditState): Promise<void> {
    const { assetId, getBytes, editState, generation } = item
    try {
      const bytes = await getBytes()

      let blob: Blob

      if (editState) {
        // Generate edited thumbnail using the full edit pipeline
        const jpegBytes = await this.decodeService.generateEditedThumbnail(
          bytes,
          this.thumbnailSize,
          editState
        )

        // Check if result is stale (generation changed during processing)
        if (generation !== undefined) {
          const currentGen = this.generationNumbers.get(assetId) ?? 0
          if (generation !== currentGen) {
            return // Result is stale, discard it
          }
        }

        blob = new Blob([new Uint8Array(jpegBytes)], { type: 'image/jpeg' })
      } else {
        // Generate original thumbnail (no edits)
        const decoded = await this.decodeService.generateThumbnail(bytes, {
          size: this.thumbnailSize,
        })
        blob = await this.decodedImageToBlob(decoded)
      }

      const url = await this.cache.set(assetId, blob)
      this._onThumbnailReady?.(assetId, url)
    } catch (error) {
      const catalogError =
        error instanceof Error
          ? new CatalogError(error.message, 'THUMBNAIL_ERROR', error)
          : new CatalogError('Unknown thumbnail error', 'THUMBNAIL_ERROR')
      this._onThumbnailError?.(assetId, catalogError)
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
      dst[j] = src[i]! // R
      dst[j + 1] = src[i + 1]! // G
      dst[j + 2] = src[i + 2]! // B
      dst[j + 3] = 255 // A
    }

    ctx.putImageData(imageData, 0, 0)

    // Convert to blob
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }

  // ==========================================================================
  // Preview Processing
  // ==========================================================================

  /**
   * Process a single preview request.
   */
  private async processPreviewItem(item: ThumbnailQueueItem): Promise<void> {
    const { assetId, getBytes } = item
    try {
      const bytes = await getBytes()

      // Generate preview using decode service (larger than thumbnail)
      const decoded = await this.decodeService.generatePreview(bytes, {
        maxEdge: this.previewSize,
        filter: 'lanczos3', // Higher quality for previews
      })

      // Convert to blob for caching (higher quality for previews)
      const blob = await this.decodedImageToBlob(decoded, 0.92)
      const url = await this.previewCache.set(assetId, blob)
      this._onPreviewReady?.(assetId, url)
    } catch (error) {
      const catalogError =
        error instanceof Error
          ? new CatalogError(error.message, 'THUMBNAIL_ERROR', error)
          : new CatalogError('Unknown preview error', 'THUMBNAIL_ERROR')
      this._onPreviewError?.(assetId, catalogError)
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
