/**
 * MockDecodeService - Mock implementation for testing.
 *
 * This mock implementation of IDecodeService can be used in:
 * - Unit tests to avoid loading WASM
 * - E2E tests with demo catalog mode
 * - Development when the worker isn't available
 *
 * By default, it returns predictable 1x1 pixel images.
 * Configure with custom handlers for more complex test scenarios.
 */

import type { IDecodeService } from './decode-service'
import type {
  DecodedImage,
  DecodeServiceState,
  ThumbnailOptions,
  PreviewOptions,
  FileType,
  Adjustments,
  HistogramData
} from './types'
import { DecodeError } from './types'

/**
 * Configuration options for MockDecodeService.
 */
export interface MockDecodeServiceOptions {
  /** Simulate initialization delay in ms */
  initDelay?: number
  /** Simulate decode delay in ms */
  decodeDelay?: number
  /** Whether to fail initialization */
  failInit?: boolean
  /** Custom handler for decodeJpeg */
  onDecodeJpeg?: (bytes: Uint8Array) => Promise<DecodedImage>
  /** Custom handler for decodeRawThumbnail */
  onDecodeRawThumbnail?: (bytes: Uint8Array) => Promise<DecodedImage>
  /** Custom handler for generateThumbnail */
  onGenerateThumbnail?: (
    bytes: Uint8Array,
    options: ThumbnailOptions
  ) => Promise<DecodedImage>
  /** Custom handler for generatePreview */
  onGeneratePreview?: (
    bytes: Uint8Array,
    options: PreviewOptions
  ) => Promise<DecodedImage>
  /** Custom handler for detectFileType */
  onDetectFileType?: (bytes: Uint8Array) => Promise<FileType>
  /** Custom handler for applyAdjustments */
  onApplyAdjustments?: (
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ) => Promise<DecodedImage>
  /** Custom handler for computeHistogram */
  onComputeHistogram?: (
    pixels: Uint8Array,
    width: number,
    height: number
  ) => Promise<HistogramData>
}

/**
 * Create a simple 1x1 pixel image for testing.
 */
function createTestImage(
  width = 1,
  height = 1,
  color: [number, number, number] = [255, 0, 0]
): DecodedImage {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = color[0]
    pixels[i * 3 + 1] = color[1]
    pixels[i * 3 + 2] = color[2]
  }
  return { width, height, pixels }
}

/**
 * Detect file type from magic bytes.
 */
function detectFileTypeFromBytes(bytes: Uint8Array): FileType {
  if (bytes.length < 2) return 'unknown'

  // JPEG: starts with FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpeg'
  }

  // TIFF/RAW: starts with II (0x4949) or MM (0x4D4D)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d)
  ) {
    return 'raw'
  }

  return 'unknown'
}

/**
 * Mock implementation of IDecodeService for testing.
 */
export class MockDecodeService implements IDecodeService {
  private _state: DecodeServiceState = { status: 'initializing' }
  private options: MockDecodeServiceOptions

  /**
   * Private constructor - use MockDecodeService.create() instead.
   */
  private constructor(options: MockDecodeServiceOptions = {}) {
    this.options = options
  }

  /**
   * Create a new MockDecodeService instance.
   */
  static async create(
    options: MockDecodeServiceOptions = {}
  ): Promise<MockDecodeService> {
    const service = new MockDecodeService(options)
    await service.initialize()
    return service
  }

  /**
   * Simulate initialization.
   */
  private async initialize(): Promise<void> {
    if (this.options.initDelay) {
      await this.delay(this.options.initDelay)
    }

    if (this.options.failInit) {
      this._state = { status: 'error', error: 'Mock initialization failed' }
      throw new DecodeError('Mock initialization failed', 'WASM_INIT_FAILED')
    }

    this._state = { status: 'ready' }
  }

  /**
   * Helper to simulate async delay.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Helper to simulate decode delay and check ready state.
   */
  private async simulateOperation(): Promise<void> {
    if (this._state.status !== 'ready') {
      throw new DecodeError('Mock service not ready', 'WORKER_ERROR')
    }

    if (this.options.decodeDelay) {
      await this.delay(this.options.decodeDelay)
    }
  }

  get state(): DecodeServiceState {
    return this._state
  }

  get isReady(): boolean {
    return this._state.status === 'ready'
  }

  async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    await this.simulateOperation()

    if (this.options.onDecodeJpeg) {
      return this.options.onDecodeJpeg(bytes)
    }

    // Default: return a 100x100 red image
    return createTestImage(100, 100, [255, 0, 0])
  }

  async decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage> {
    await this.simulateOperation()

    if (this.options.onDecodeRawThumbnail) {
      return this.options.onDecodeRawThumbnail(bytes)
    }

    // Default: return a 160x120 green image (typical RAW thumbnail size)
    return createTestImage(160, 120, [0, 255, 0])
  }

  async generateThumbnail(
    bytes: Uint8Array,
    options: ThumbnailOptions = {}
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    if (this.options.onGenerateThumbnail) {
      return this.options.onGenerateThumbnail(bytes, options)
    }

    // Default: return a square thumbnail at requested size
    const size = options.size ?? 256
    return createTestImage(size, size, [0, 0, 255])
  }

  async generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    if (this.options.onGeneratePreview) {
      return this.options.onGeneratePreview(bytes, options)
    }

    // Default: return a 16:9 preview at maxEdge
    const width = options.maxEdge
    const height = Math.round(options.maxEdge * (9 / 16))
    return createTestImage(width, height, [255, 255, 0])
  }

  async detectFileType(bytes: Uint8Array): Promise<FileType> {
    await this.simulateOperation()

    if (this.options.onDetectFileType) {
      return this.options.onDetectFileType(bytes)
    }

    // Default: use actual magic byte detection
    return detectFileTypeFromBytes(bytes)
  }

  async applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    if (this.options.onApplyAdjustments) {
      return this.options.onApplyAdjustments(pixels, width, height, adjustments)
    }

    // Default: return a copy of the input (no actual adjustments applied)
    const outputPixels = new Uint8Array(pixels.length)
    outputPixels.set(pixels)
    return { width, height, pixels: outputPixels }
  }

  async computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData> {
    await this.simulateOperation()

    if (this.options.onComputeHistogram) {
      return this.options.onComputeHistogram(pixels, width, height)
    }

    // Default: return a mock bell-curve histogram centered at 128
    const red = new Uint32Array(256)
    const green = new Uint32Array(256)
    const blue = new Uint32Array(256)
    const luminance = new Uint32Array(256)

    // Generate bell-curve-like distribution
    const totalPixels = width * height
    for (let i = 0; i < 256; i++) {
      const value = Math.floor(
        (totalPixels / 256) * Math.exp(-Math.pow(i - 128, 2) / 5000)
      )
      red[i] = value
      green[i] = value
      blue[i] = value
      luminance[i] = value
    }

    // Find max value
    let maxValue = 0
    for (let i = 0; i < 256; i++) {
      maxValue = Math.max(maxValue, red[i], green[i], blue[i])
    }

    return {
      red,
      green,
      blue,
      luminance,
      maxValue,
      hasHighlightClipping: false,
      hasShadowClipping: false
    }
  }

  destroy(): void {
    this._state = { status: 'error', error: 'Service destroyed' }
  }
}

/**
 * Utility to create test image data.
 * Useful for setting up custom handlers in tests.
 */
export { createTestImage }
