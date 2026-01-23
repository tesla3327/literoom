/**
 * DecodeService - Main thread service for image decoding operations.
 *
 * This service manages a Web Worker that performs image decoding using WASM.
 * It provides a clean async API with automatic request/response correlation,
 * timeout handling, and proper error propagation.
 */

import type { DecodeRequest, DecodeResponse, MaskStackData, EditedThumbnailEditState } from './worker-messages'
import type {
  DecodedImage,
  DecodeServiceState,
  ThumbnailOptions,
  PreviewOptions,
  FileType,
  ErrorCode,
  Adjustments,
  HistogramData
} from './types'
import { DecodeError, filterToNumber } from './types'
import { DecodeWorkerPool, type PoolOptions } from './decode-worker-pool'

const DEFAULT_TIMEOUT = 30_000

/**
 * Interface for the decode service.
 * Enables mock implementations for testing.
 */
export interface IDecodeService {
  /** Current state of the service */
  readonly state: DecodeServiceState
  /** Whether the service is ready to accept requests */
  readonly isReady: boolean

  /** Decode a JPEG file to raw RGB pixels */
  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>
  /** Extract and decode the embedded thumbnail from a RAW file */
  decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage>
  /** Generate a thumbnail from image bytes (auto-detects file type) */
  generateThumbnail(
    bytes: Uint8Array,
    options?: ThumbnailOptions
  ): Promise<DecodedImage>
  /** Generate a preview from image bytes (auto-detects file type) */
  generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage>
  /** Detect the file type from magic bytes */
  detectFileType(bytes: Uint8Array): Promise<FileType>
  /** Apply adjustments to image pixel data */
  applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<DecodedImage>
  /** Compute histogram from image pixel data */
  computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData>
  /** Apply tone curve to image pixel data */
  applyToneCurve(
    pixels: Uint8Array,
    width: number,
    height: number,
    points: Array<{ x: number; y: number }>
  ): Promise<DecodedImage>
  /** Apply rotation to image pixel data */
  applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number,
    useLanczos?: boolean
  ): Promise<DecodedImage>
  /** Apply crop to image pixel data using normalized coordinates */
  applyCrop(
    pixels: Uint8Array,
    width: number,
    height: number,
    crop: { left: number; top: number; width: number; height: number }
  ): Promise<DecodedImage>
  /** Encode image pixel data to JPEG bytes */
  encodeJpeg(
    pixels: Uint8Array,
    width: number,
    height: number,
    quality?: number
  ): Promise<Uint8Array>
  /** Apply masked adjustments (local adjustments) to image pixel data */
  applyMaskedAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<DecodedImage>
  /** Generate a thumbnail with edits applied */
  generateEditedThumbnail(
    bytes: Uint8Array,
    size: number,
    editState: EditedThumbnailEditState
  ): Promise<Uint8Array>
  /** Destroy the service and release resources */
  destroy(): void
}

/**
 * Pending request waiting for a response from the worker.
 */
interface PendingRequest {
  resolve: (value: DecodedImage | FileType | HistogramData | Uint8Array) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/**
 * DecodeService implementation using a Web Worker.
 *
 * @example
 * ```typescript
 * const service = await DecodeService.create()
 *
 * const image = await service.decodeJpeg(jpegBytes)
 * console.log(`Decoded: ${image.width}x${image.height}`)
 *
 * service.destroy()
 * ```
 */
export class DecodeService implements IDecodeService {
  private worker: Worker | null = null
  private pending = new Map<string, PendingRequest>()
  private _state: DecodeServiceState = { status: 'initializing' }

  /**
   * Private constructor - use DecodeService.create() instead.
   */
  private constructor() {}

  /**
   * Create a new DecodeService instance.
   * The service will be ready to accept requests after creation.
   */
  static async create(): Promise<DecodeService> {
    const service = new DecodeService()
    await service.initialize()
    return service
  }

  /**
   * Create a pooled DecodeService with multiple workers for parallel processing.
   *
   * This factory returns a DecodeWorkerPool that implements IDecodeService,
   * enabling parallel thumbnail generation across CPU cores.
   *
   * @param options - Pool configuration options
   * @returns A pooled decode service implementing IDecodeService
   *
   * @example
   * ```typescript
   * // Create with default worker count (navigator.hardwareConcurrency)
   * const service = await DecodeService.createPooled()
   *
   * // Create with specific worker count
   * const service = await DecodeService.createPooled({ workerCount: 4 })
   * ```
   */
  static async createPooled(options?: PoolOptions): Promise<IDecodeService> {
    return DecodeWorkerPool.create(options)
  }

  /**
   * Initialize the worker and set up message handlers.
   */
  private async initialize(): Promise<void> {
    try {
      this.worker = new Worker(
        new URL('./decode-worker.ts', import.meta.url),
        { type: 'module' }
      )

      this.worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
        this.handleResponse(event.data)
      }

      this.worker.onerror = (error) => {
        this._state = { status: 'error', error: error.message }
      }

      this._state = { status: 'ready' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._state = { status: 'error', error: message }
      throw new DecodeError('Failed to create decode worker', 'WORKER_ERROR')
    }
  }

  /**
   * Current state of the service.
   */
  get state(): DecodeServiceState {
    return this._state
  }

  /**
   * Whether the service is ready to accept requests.
   */
  get isReady(): boolean {
    return this._state.status === 'ready'
  }

  /**
   * Generate a unique request ID.
   */
  private generateId(): string {
    return crypto.randomUUID()
  }

  /**
   * Handle a response from the worker.
   */
  private handleResponse(response: DecodeResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pending.delete(response.id)

    switch (response.type) {
      case 'error':
        pending.reject(
          new DecodeError(response.message, response.code as ErrorCode)
        )
        break
      case 'file-type':
        pending.resolve(response.fileType)
        break
      case 'success':
        pending.resolve({
          width: response.width,
          height: response.height,
          pixels: response.pixels
        })
        break
      case 'histogram':
        pending.resolve({
          red: response.red,
          green: response.green,
          blue: response.blue,
          luminance: response.luminance,
          maxValue: response.maxValue,
          hasHighlightClipping: response.hasHighlightClipping,
          hasShadowClipping: response.hasShadowClipping
        })
        break
      case 'tone-curve-result':
        pending.resolve({
          width: response.width,
          height: response.height,
          pixels: response.pixels
        })
        break
      case 'encode-jpeg-result':
        // For encode-jpeg, we return the raw JPEG bytes directly
        // The resolve type is DecodedImage | FileType | HistogramData | Uint8Array
        (pending.resolve as (value: Uint8Array) => void)(response.bytes)
        break
      case 'generate-edited-thumbnail-result':
        // For edited thumbnail, we return the JPEG bytes
        (pending.resolve as (value: Uint8Array) => void)(response.bytes)
        break
    }
  }

  /**
   * Send a request to the worker and wait for a response.
   */
  private sendRequest<T extends DecodedImage | FileType | HistogramData | Uint8Array>(
    request: DecodeRequest
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this._state.status !== 'ready') {
        reject(new DecodeError('Decode service not ready', 'WORKER_ERROR'))
        return
      }

      const timeoutId = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new DecodeError('Decode operation timed out', 'TIMEOUT'))
      }, DEFAULT_TIMEOUT)

      this.pending.set(request.id, {
        resolve: resolve as (value: DecodedImage | FileType | HistogramData | Uint8Array) => void,
        reject,
        timeoutId
      })

      this.worker.postMessage(request)
    })
  }

  /**
   * Decode a JPEG file to raw RGB pixels.
   */
  async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'decode-jpeg',
      bytes
    })
  }

  /**
   * Extract and decode the embedded thumbnail from a RAW file.
   */
  async decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'decode-raw-thumbnail',
      bytes
    })
  }

  /**
   * Generate a thumbnail from image bytes.
   * Automatically detects file type (JPEG or RAW).
   */
  async generateThumbnail(
    bytes: Uint8Array,
    options: ThumbnailOptions = {}
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'generate-thumbnail',
      bytes,
      size: options.size ?? 256
    })
  }

  /**
   * Generate a preview from image bytes.
   * Automatically detects file type (JPEG or RAW).
   */
  async generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'generate-preview',
      bytes,
      maxEdge: options.maxEdge,
      filter: filterToNumber(options.filter)
    })
  }

  /**
   * Detect the file type from magic bytes.
   */
  async detectFileType(bytes: Uint8Array): Promise<FileType> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'detect-file-type',
      bytes
    })
  }

  /**
   * Apply adjustments to image pixel data.
   * Returns a new image with adjustments applied.
   */
  async applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'apply-adjustments',
      pixels,
      width,
      height,
      adjustments
    })
  }

  /**
   * Compute histogram from image pixel data.
   * Returns histogram data for all channels.
   */
  async computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'compute-histogram',
      pixels,
      width,
      height
    })
  }

  /**
   * Apply tone curve to image pixel data.
   * Returns a new image with the tone curve applied.
   */
  async applyToneCurve(
    pixels: Uint8Array,
    width: number,
    height: number,
    points: Array<{ x: number; y: number }>
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'apply-tone-curve',
      pixels,
      width,
      height,
      points
    })
  }

  /**
   * Apply rotation to image pixel data.
   * Returns a new image with the rotation applied.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param angleDegrees - Rotation angle (positive = counter-clockwise)
   * @param useLanczos - Use high-quality Lanczos3 filter (default: false for bilinear)
   */
  async applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number,
    useLanczos = false
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'apply-rotation',
      pixels,
      width,
      height,
      angleDegrees,
      useLanczos
    })
  }

  /**
   * Apply crop to image pixel data using normalized coordinates.
   * Returns a new image with the crop applied.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param crop - Crop rectangle in normalized coordinates (0-1)
   */
  async applyCrop(
    pixels: Uint8Array,
    width: number,
    height: number,
    crop: { left: number; top: number; width: number; height: number }
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'apply-crop',
      pixels,
      width,
      height,
      left: crop.left,
      top: crop.top,
      cropWidth: crop.width,
      cropHeight: crop.height
    })
  }

  /**
   * Encode image pixel data to JPEG bytes.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param quality - JPEG quality 1-100 (default: 90)
   * @returns JPEG-encoded bytes
   */
  async encodeJpeg(
    pixels: Uint8Array,
    width: number,
    height: number,
    quality = 90
  ): Promise<Uint8Array> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'encode-jpeg',
      pixels,
      width,
      height,
      quality
    })
  }

  /**
   * Apply masked adjustments (local adjustments) to image pixel data.
   * This applies linear and radial gradient masks with per-mask adjustments.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param maskStack - Mask stack containing linear and radial gradient masks
   * @returns New image with masked adjustments applied
   */
  async applyMaskedAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'apply-masked-adjustments',
      pixels,
      width,
      height,
      maskStack
    })
  }

  /**
   * Generate a thumbnail with edits applied.
   * Full pipeline: decode -> rotate -> crop -> adjust -> tone curve -> masks -> resize -> encode
   *
   * @param bytes - Raw image bytes (JPEG or RAW)
   * @param size - Target thumbnail size (longest edge, typically 512)
   * @param editState - Edit parameters to apply
   * @returns JPEG-encoded thumbnail bytes with edits applied
   */
  async generateEditedThumbnail(
    bytes: Uint8Array,
    size: number,
    editState: EditedThumbnailEditState
  ): Promise<Uint8Array> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'generate-edited-thumbnail',
      bytes,
      size,
      editState
    })
  }

  /**
   * Destroy the service and release resources.
   * Rejects all pending requests.
   */
  destroy(): void {
    if (this.worker) {
      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeoutId)
        pending.reject(new DecodeError('Service destroyed', 'WORKER_ERROR'))
      }
      this.pending.clear()

      this.worker.terminate()
      this.worker = null
      this._state = { status: 'error', error: 'Service destroyed' }
    }
  }
}
