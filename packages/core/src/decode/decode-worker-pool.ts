/**
 * DecodeWorkerPool - Manages multiple decode workers for parallel processing.
 *
 * Routes decode requests to multiple workers using load balancing,
 * enabling parallel thumbnail generation across CPU cores.
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
import type { IDecodeService } from './decode-service'

const DEFAULT_TIMEOUT = 30_000
const MAX_WORKERS = 8
const DEFAULT_WORKER_COUNT = 4

/**
 * Options for creating a worker pool.
 */
export interface PoolOptions {
  /** Number of workers to create (default: navigator.hardwareConcurrency or 4, max: 8) */
  workerCount?: number
}

/**
 * Pending request waiting for a response from a worker.
 */
interface PendingPoolRequest {
  workerId: number
  resolve: (value: DecodedImage | FileType | HistogramData | Uint8Array) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/**
 * DecodeWorkerPool manages multiple decode workers for parallel processing.
 *
 * Each worker maintains its own WASM instance, enabling true parallel
 * execution across CPU cores. Requests are load-balanced across workers.
 *
 * @example
 * ```typescript
 * const pool = await DecodeWorkerPool.create({ workerCount: 4 })
 *
 * // Process multiple thumbnails in parallel
 * const results = await Promise.all([
 *   pool.generateThumbnail(bytes1),
 *   pool.generateThumbnail(bytes2),
 *   pool.generateThumbnail(bytes3),
 *   pool.generateThumbnail(bytes4),
 * ])
 *
 * pool.destroy()
 * ```
 */
export class DecodeWorkerPool implements IDecodeService {
  private workers: Worker[] = []
  private pending = new Map<string, PendingPoolRequest>()
  private workerLoad: number[] = []
  private _state: DecodeServiceState = { status: 'initializing' }
  private workerCount: number

  /**
   * Private constructor - use DecodeWorkerPool.create() instead.
   */
  private constructor(workerCount: number) {
    this.workerCount = workerCount
    this.workerLoad = new Array(workerCount).fill(0)
  }

  /**
   * Create a new DecodeWorkerPool instance.
   */
  static async create(options: PoolOptions = {}): Promise<DecodeWorkerPool> {
    const defaultCount = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || DEFAULT_WORKER_COUNT)
      : DEFAULT_WORKER_COUNT
    const workerCount = Math.min(options.workerCount ?? defaultCount, MAX_WORKERS)

    const pool = new DecodeWorkerPool(workerCount)
    await pool.initialize()
    return pool
  }

  /**
   * Initialize all workers.
   */
  private async initialize(): Promise<void> {
    try {
      const workerPromises = Array.from({ length: this.workerCount }, (_, index) =>
        this.createWorker(index)
      )

      this.workers = await Promise.all(workerPromises)
      this._state = { status: 'ready' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._state = { status: 'error', error: message }
      throw new DecodeError('Failed to create decode worker pool', 'WORKER_ERROR')
    }
  }

  /**
   * Create a single worker and set up its message handler.
   */
  private async createWorker(index: number): Promise<Worker> {
    const worker = new Worker(
      new URL('./decode-worker.ts', import.meta.url),
      { type: 'module' }
    )

    worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      this.handleResponse(index, event.data)
    }

    worker.onerror = (error) => {
      console.error(`Worker ${index} error:`, error.message)
      // Don't set the entire pool to error state for a single worker failure
      // Individual requests to this worker will timeout
    }

    return worker
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
   * Get the number of active workers.
   */
  get poolSize(): number {
    return this.workers.length
  }

  /**
   * Generate a unique request ID that includes the worker index.
   */
  private generateId(workerId: number): string {
    return `${workerId}-${crypto.randomUUID()}`
  }

  /**
   * Get the index of the least busy worker.
   */
  private getLeastBusyWorker(): number {
    let minLoad = Infinity
    let minIndex = 0

    for (let i = 0; i < this.workerLoad.length; i++) {
      if (this.workerLoad[i] < minLoad) {
        minLoad = this.workerLoad[i]
        minIndex = i
      }
    }

    return minIndex
  }

  /**
   * Handle a response from a worker.
   */
  private handleResponse(workerId: number, response: DecodeResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pending.delete(response.id)
    this.workerLoad[workerId]--

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
        (pending.resolve as (value: Uint8Array) => void)(response.bytes)
        break
    }
  }

  /**
   * Send a request to the least busy worker and wait for a response.
   * The request must already have an id assigned that encodes the target workerId.
   */
  private sendRequest<T extends DecodedImage | FileType | HistogramData | Uint8Array>(
    request: DecodeRequest,
    workerId: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.workers.length === 0 || this._state.status !== 'ready') {
        reject(new DecodeError('Decode service not ready', 'WORKER_ERROR'))
        return
      }

      const worker = this.workers[workerId]

      const timeoutId = setTimeout(() => {
        this.pending.delete(request.id)
        this.workerLoad[workerId]--
        reject(new DecodeError('Decode operation timed out', 'TIMEOUT'))
      }, DEFAULT_TIMEOUT)

      this.workerLoad[workerId]++
      this.pending.set(request.id, {
        workerId,
        resolve: resolve as (value: DecodedImage | FileType | HistogramData | Uint8Array) => void,
        reject,
        timeoutId
      })

      worker.postMessage(request)
    })
  }

  /**
   * Create a request with the given fields and route it to the least busy worker.
   * DRYs up the common pattern: getLeastBusyWorker() + generateId() + sendRequest().
   */
  private routeRequest<T extends DecodedImage | FileType | HistogramData | Uint8Array>(
    requestFields: Omit<DecodeRequest, 'id'>
  ): Promise<T> {
    const workerId = this.getLeastBusyWorker()
    const request = { ...requestFields, id: this.generateId(workerId) } as DecodeRequest
    return this.sendRequest(request, workerId)
  }

  // ===========================================================================
  // IDecodeService Implementation
  // ===========================================================================

  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    return this.routeRequest({ type: 'decode-jpeg', bytes })
  }

  decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage> {
    return this.routeRequest({ type: 'decode-raw-thumbnail', bytes })
  }

  generateThumbnail(bytes: Uint8Array, options: ThumbnailOptions = {}): Promise<DecodedImage> {
    return this.routeRequest({ type: 'generate-thumbnail', bytes, size: options.size ?? 256 })
  }

  generatePreview(bytes: Uint8Array, options: PreviewOptions): Promise<DecodedImage> {
    return this.routeRequest({
      type: 'generate-preview',
      bytes,
      maxEdge: options.maxEdge,
      filter: filterToNumber(options.filter)
    })
  }

  detectFileType(bytes: Uint8Array): Promise<FileType> {
    return this.routeRequest({ type: 'detect-file-type', bytes })
  }

  applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<DecodedImage> {
    return this.routeRequest({ type: 'apply-adjustments', pixels, width, height, adjustments })
  }

  computeHistogram(pixels: Uint8Array, width: number, height: number): Promise<HistogramData> {
    return this.routeRequest({ type: 'compute-histogram', pixels, width, height })
  }

  applyToneCurve(
    pixels: Uint8Array,
    width: number,
    height: number,
    points: Array<{ x: number; y: number }>
  ): Promise<DecodedImage> {
    return this.routeRequest({ type: 'apply-tone-curve', pixels, width, height, points })
  }

  applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number,
    useLanczos = false
  ): Promise<DecodedImage> {
    return this.routeRequest({ type: 'apply-rotation', pixels, width, height, angleDegrees, useLanczos })
  }

  applyCrop(
    pixels: Uint8Array,
    width: number,
    height: number,
    crop: { left: number; top: number; width: number; height: number }
  ): Promise<DecodedImage> {
    return this.routeRequest({
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

  encodeJpeg(pixels: Uint8Array, width: number, height: number, quality = 90): Promise<Uint8Array> {
    return this.routeRequest({ type: 'encode-jpeg', pixels, width, height, quality })
  }

  applyMaskedAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<DecodedImage> {
    return this.routeRequest({ type: 'apply-masked-adjustments', pixels, width, height, maskStack })
  }

  generateEditedThumbnail(
    bytes: Uint8Array,
    size: number,
    editState: EditedThumbnailEditState
  ): Promise<Uint8Array> {
    return this.routeRequest({ type: 'generate-edited-thumbnail', bytes, size, editState })
  }

  /**
   * Destroy all workers and release resources.
   */
  destroy(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(new DecodeError('Service destroyed', 'WORKER_ERROR'))
    }
    this.pending.clear()

    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers = []
    this.workerLoad = []

    this._state = { status: 'error', error: 'Service destroyed' }
  }
}
