/**
 * PhotoProcessor - Unified photo processing pipeline.
 *
 * Generates both thumbnail (256px) and preview (1280px) together for each photo.
 * Uses a simple FIFO queue instead of priority-based ordering.
 * Emits "photo ready" events when both are complete.
 */

import type { IDecodeService } from '../decode/decode-service'
import type { DecodedImage } from '../decode/types'
import { CatalogError } from './types'

// ============================================================================
// Constants
// ============================================================================

/** Thumbnail size (longest edge in pixels) */
export const THUMBNAIL_SIZE = 256

/** Preview size (longest edge in pixels) */
export const PREVIEW_SIZE = 1280

/** Default concurrent processing limit */
const DEFAULT_CONCURRENCY = 4

/** Maximum concurrent processing limit */
const MAX_CONCURRENCY = 8

/** JPEG quality for thumbnails */
const THUMBNAIL_QUALITY = 0.85

/** JPEG quality for previews */
const PREVIEW_QUALITY = 0.90

// ============================================================================
// Types
// ============================================================================

/**
 * A photo job waiting to be processed.
 */
export interface PhotoJob {
  /** Unique asset ID */
  assetId: string
  /** Function to get the image bytes */
  getBytes: () => Promise<Uint8Array>
}

/**
 * Result of processing a photo.
 */
export interface ProcessedPhoto {
  assetId: string
  thumbnailBlob: Blob
  previewBlob: Blob
}

/**
 * Callback when a photo is fully processed.
 */
export type PhotoProcessedCallback = (result: ProcessedPhoto) => void

/**
 * Callback when a photo processing fails.
 */
export type PhotoErrorCallback = (assetId: string, error: Error) => void

// ============================================================================
// PhotoProcessor Implementation
// ============================================================================

/**
 * Processes photos through a unified pipeline generating both thumbnail and preview.
 *
 * Features:
 * - FIFO queue (first in, first out)
 * - Concurrent processing (up to 8 workers)
 * - Single decode per photo (resizes to both sizes from same decode)
 * - Emits events when photos are ready
 */
export class PhotoProcessor {
  private readonly decodeService: IDecodeService
  private readonly concurrency: number
  private readonly queue: PhotoJob[] = []
  private activeCount = 0
  private processing = new Set<string>()

  private _onPhotoProcessed: PhotoProcessedCallback | null = null
  private _onPhotoError: PhotoErrorCallback | null = null

  constructor(decodeService: IDecodeService, concurrency?: number) {
    this.decodeService = decodeService

    const defaultConcurrency = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || DEFAULT_CONCURRENCY)
      : DEFAULT_CONCURRENCY
    this.concurrency = Math.min(concurrency ?? defaultConcurrency, MAX_CONCURRENCY)
  }

  /**
   * Queue a photo for processing.
   * Returns false if already queued or processing.
   */
  enqueue(job: PhotoJob): boolean {
    if (this.processing.has(job.assetId)) {
      return false
    }

    this.processing.add(job.assetId)
    this.queue.push(job)
    this.processNext()
    return true
  }

  /**
   * Get the number of photos waiting in the queue.
   */
  get queueSize(): number {
    return this.queue.length
  }

  /**
   * Get the number of photos currently being processed.
   */
  get activeProcessing(): number {
    return this.activeCount
  }

  /**
   * Check if a photo is queued or being processed.
   */
  has(assetId: string): boolean {
    return this.processing.has(assetId)
  }

  /**
   * Set callback for when a photo is fully processed.
   */
  set onPhotoProcessed(callback: PhotoProcessedCallback | null) {
    this._onPhotoProcessed = callback
  }

  /**
   * Set callback for when a photo fails to process.
   */
  set onPhotoError(callback: PhotoErrorCallback | null) {
    this._onPhotoError = callback
  }

  /**
   * Cancel all pending jobs.
   */
  cancelAll(): void {
    this.queue.length = 0
    // Note: Can't cancel in-flight processing, but they'll complete
  }

  /**
   * Process the next job in the queue if there's capacity.
   */
  private processNext(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.activeCount++

      this.processPhoto(job)
        .then((result) => {
          this._onPhotoProcessed?.(result)
        })
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error))
          this._onPhotoError?.(job.assetId, err)
        })
        .finally(() => {
          this.processing.delete(job.assetId)
          this.activeCount--
          this.processNext()
        })
    }
  }

  /**
   * Process a single photo: decode once, resize to both sizes.
   */
  private async processPhoto(job: PhotoJob): Promise<ProcessedPhoto> {
    const bytes = await job.getBytes()

    // Generate thumbnail and preview in parallel from same bytes
    // The decode service handles decoding once internally
    const [thumbnail, preview] = await Promise.all([
      this.decodeService.generateThumbnail(bytes, { size: THUMBNAIL_SIZE }),
      this.decodeService.generatePreview(bytes, { maxEdge: PREVIEW_SIZE, filter: 'lanczos3' }),
    ])

    // Convert both to blobs in parallel
    const [thumbnailBlob, previewBlob] = await Promise.all([
      this.decodedImageToBlob(thumbnail, THUMBNAIL_QUALITY),
      this.decodedImageToBlob(preview, PREVIEW_QUALITY),
    ])

    return {
      assetId: job.assetId,
      thumbnailBlob,
      previewBlob,
    }
  }

  /**
   * Convert a decoded image to a JPEG blob.
   */
  private async decodedImageToBlob(image: DecodedImage, quality: number): Promise<Blob> {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')!

    const imageData = new ImageData(image.width, image.height)
    const src = image.pixels
    const dst = imageData.data

    // Convert RGB to RGBA
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dst[j] = src[i]!
      dst[j + 1] = src[i + 1]!
      dst[j + 2] = src[i + 2]!
      dst[j + 3] = 255
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new PhotoProcessor instance.
 */
export function createPhotoProcessor(
  decodeService: IDecodeService,
  concurrency?: number
): PhotoProcessor {
  return new PhotoProcessor(decodeService, concurrency)
}
