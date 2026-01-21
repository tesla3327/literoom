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

    // Apply simplified adjustments for demo mode
    // This provides visual feedback without full color science accuracy
    const outputPixels = new Uint8Array(pixels.length)

    for (let i = 0; i < pixels.length; i += 3) {
      let r = pixels[i]
      let g = pixels[i + 1]
      let b = pixels[i + 2]

      // Apply exposure (multiply by 2^exposure)
      if (adjustments.exposure !== 0) {
        const multiplier = Math.pow(2, adjustments.exposure)
        r = Math.min(255, Math.max(0, r * multiplier))
        g = Math.min(255, Math.max(0, g * multiplier))
        b = Math.min(255, Math.max(0, b * multiplier))
      }

      // Apply contrast (S-curve around midpoint)
      if (adjustments.contrast !== 0) {
        const factor = (adjustments.contrast / 100) + 1 // -1 to 2
        r = Math.min(255, Math.max(0, ((r / 255 - 0.5) * factor + 0.5) * 255))
        g = Math.min(255, Math.max(0, ((g / 255 - 0.5) * factor + 0.5) * 255))
        b = Math.min(255, Math.max(0, ((b / 255 - 0.5) * factor + 0.5) * 255))
      }

      // Apply temperature (warm/cool tint)
      if (adjustments.temperature !== 0) {
        const tempFactor = adjustments.temperature / 100
        r = Math.min(255, Math.max(0, r + tempFactor * 30))
        b = Math.min(255, Math.max(0, b - tempFactor * 30))
      }

      // Apply tint (green/magenta shift)
      if (adjustments.tint !== 0) {
        const tintFactor = adjustments.tint / 100
        g = Math.min(255, Math.max(0, g - tintFactor * 30))
        r = Math.min(255, Math.max(0, r + tintFactor * 15))
        b = Math.min(255, Math.max(0, b + tintFactor * 15))
      }

      // Apply saturation
      if (adjustments.saturation !== 0) {
        const sat = (adjustments.saturation / 100) + 1 // 0 to 2
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        r = Math.min(255, Math.max(0, gray + (r - gray) * sat))
        g = Math.min(255, Math.max(0, gray + (g - gray) * sat))
        b = Math.min(255, Math.max(0, gray + (b - gray) * sat))
      }

      // Apply vibrance (saturation that protects skin tones)
      if (adjustments.vibrance !== 0) {
        const vib = (adjustments.vibrance / 100) + 1 // 0 to 2
        const maxChannel = Math.max(r, g, b)
        const minChannel = Math.min(r, g, b)
        const currentSat = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel
        // Less effect on already-saturated colors
        const adjustedVib = 1 + (vib - 1) * (1 - currentSat)
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        r = Math.min(255, Math.max(0, gray + (r - gray) * adjustedVib))
        g = Math.min(255, Math.max(0, gray + (g - gray) * adjustedVib))
        b = Math.min(255, Math.max(0, gray + (b - gray) * adjustedVib))
      }

      // Apply highlights (affect bright areas)
      if (adjustments.highlights !== 0) {
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        const highlightMask = Math.max(0, (luminance - 128) / 127)
        const highlightFactor = (adjustments.highlights / 100) * highlightMask * 50
        r = Math.min(255, Math.max(0, r + highlightFactor))
        g = Math.min(255, Math.max(0, g + highlightFactor))
        b = Math.min(255, Math.max(0, b + highlightFactor))
      }

      // Apply shadows (affect dark areas)
      if (adjustments.shadows !== 0) {
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        const shadowMask = Math.max(0, 1 - luminance / 128)
        const shadowFactor = (adjustments.shadows / 100) * shadowMask * 50
        r = Math.min(255, Math.max(0, r + shadowFactor))
        g = Math.min(255, Math.max(0, g + shadowFactor))
        b = Math.min(255, Math.max(0, b + shadowFactor))
      }

      // Apply whites (adjust white point)
      if (adjustments.whites !== 0) {
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        const whiteMask = Math.pow(Math.max(0, luminance / 255), 2)
        const whiteFactor = (adjustments.whites / 100) * whiteMask * 40
        r = Math.min(255, Math.max(0, r + whiteFactor))
        g = Math.min(255, Math.max(0, g + whiteFactor))
        b = Math.min(255, Math.max(0, b + whiteFactor))
      }

      // Apply blacks (adjust black point)
      if (adjustments.blacks !== 0) {
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        const blackMask = Math.pow(Math.max(0, 1 - luminance / 255), 2)
        const blackFactor = (adjustments.blacks / 100) * blackMask * 40
        r = Math.min(255, Math.max(0, r + blackFactor))
        g = Math.min(255, Math.max(0, g + blackFactor))
        b = Math.min(255, Math.max(0, b + blackFactor))
      }

      outputPixels[i] = Math.round(r)
      outputPixels[i + 1] = Math.round(g)
      outputPixels[i + 2] = Math.round(b)
    }

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

    // Actually compute histogram from pixel data (RGB format)
    const red = new Uint32Array(256)
    const green = new Uint32Array(256)
    const blue = new Uint32Array(256)
    const luminance = new Uint32Array(256)

    // Process pixels in RGB triplets
    for (let i = 0; i < pixels.length; i += 3) {
      const r = pixels[i] ?? 0
      const g = pixels[i + 1] ?? 0
      const b = pixels[i + 2] ?? 0

      // Bin each channel
      red[r]++
      green[g]++
      blue[b]++

      // Compute luminance (BT.709)
      const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
      luminance[Math.min(255, Math.max(0, lum))]++
    }

    // Find max value across RGB channels
    let maxValue = 0
    for (let i = 0; i < 256; i++) {
      maxValue = Math.max(maxValue, red[i]!, green[i]!, blue[i]!)
    }

    // Check for clipping
    const hasHighlightClipping = (red[255]! > 0 || green[255]! > 0 || blue[255]! > 0)
    const hasShadowClipping = (red[0]! > 0 || green[0]! > 0 || blue[0]! > 0)

    return {
      red,
      green,
      blue,
      luminance,
      maxValue,
      hasHighlightClipping,
      hasShadowClipping
    }
  }

  async applyToneCurve(
    pixels: Uint8Array,
    width: number,
    height: number,
    points: Array<{ x: number; y: number }>
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    // Check if curve is linear (identity)
    const isLinear =
      points.length === 2 &&
      Math.abs(points[0].x) < 0.001 &&
      Math.abs(points[0].y) < 0.001 &&
      Math.abs(points[1].x - 1) < 0.001 &&
      Math.abs(points[1].y - 1) < 0.001

    if (isLinear) {
      // Return unchanged pixels for identity curve
      return { width, height, pixels: new Uint8Array(pixels) }
    }

    // Build simple LUT via linear interpolation for mock
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      const x = i / 255
      // Find segment
      let segIndex = 0
      while (segIndex < points.length - 1 && points[segIndex + 1].x < x) {
        segIndex++
      }
      const p0 = points[segIndex]
      const p1 = points[segIndex + 1] || points[segIndex]
      // Linear interpolation
      const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x)
      const y = p0.y + t * (p1.y - p0.y)
      lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)))
    }

    // Apply LUT to pixels
    const outputPixels = new Uint8Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) {
      outputPixels[i] = lut[pixels[i]]
    }

    return { width, height, pixels: outputPixels }
  }

  async applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number,
    useLanczos = false
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    // Fast path: no rotation needed
    if (Math.abs(angleDegrees) < 0.001) {
      return { width, height, pixels: new Uint8Array(pixels) }
    }

    // For mock, compute approximate new dimensions for rotated image
    const angleRad = Math.abs(angleDegrees * Math.PI / 180)
    const cos = Math.abs(Math.cos(angleRad))
    const sin = Math.abs(Math.sin(angleRad))

    // Compute rotated bounding box
    const newWidth = Math.ceil(width * cos + height * sin)
    const newHeight = Math.ceil(width * sin + height * cos)

    // For demo mode, return a pixel buffer of the new dimensions
    // (simplified - just copy pixels to new size, real WASM does actual rotation)
    const outputPixels = new Uint8Array(newWidth * newHeight * 3)

    // Simple nearest-neighbor sampling (mock quality, not production)
    const srcCx = width / 2
    const srcCy = height / 2
    const dstCx = newWidth / 2
    const dstCy = newHeight / 2
    const cosR = Math.cos(-angleDegrees * Math.PI / 180)
    const sinR = Math.sin(-angleDegrees * Math.PI / 180)

    for (let dy = 0; dy < newHeight; dy++) {
      for (let dx = 0; dx < newWidth; dx++) {
        // Translate to center, inverse rotate, translate back
        const relX = dx - dstCx
        const relY = dy - dstCy
        const srcX = Math.round(relX * cosR - relY * sinR + srcCx)
        const srcY = Math.round(relX * sinR + relY * cosR + srcCy)

        const dstIdx = (dy * newWidth + dx) * 3

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcIdx = (srcY * width + srcX) * 3
          outputPixels[dstIdx] = pixels[srcIdx] ?? 0
          outputPixels[dstIdx + 1] = pixels[srcIdx + 1] ?? 0
          outputPixels[dstIdx + 2] = pixels[srcIdx + 2] ?? 0
        }
        // Out of bounds pixels remain black (0)
      }
    }

    return { width: newWidth, height: newHeight, pixels: outputPixels }
  }

  async applyCrop(
    pixels: Uint8Array,
    width: number,
    height: number,
    crop: { left: number; top: number; width: number; height: number }
  ): Promise<DecodedImage> {
    await this.simulateOperation()

    // Fast path: full image (no crop)
    if (crop.left === 0 && crop.top === 0 && crop.width === 1 && crop.height === 1) {
      return { width, height, pixels: new Uint8Array(pixels) }
    }

    // Convert normalized coordinates to pixel coordinates
    const pxLeft = Math.round(crop.left * width)
    const pxTop = Math.round(crop.top * height)
    const pxWidth = Math.max(1, Math.round(crop.width * width))
    const pxHeight = Math.max(1, Math.round(crop.height * height))

    // Clamp to bounds
    const clampedLeft = Math.min(pxLeft, width - 1)
    const clampedTop = Math.min(pxTop, height - 1)
    const clampedRight = Math.min(clampedLeft + pxWidth, width)
    const clampedBottom = Math.min(clampedTop + pxHeight, height)
    const outWidth = Math.max(1, clampedRight - clampedLeft)
    const outHeight = Math.max(1, clampedBottom - clampedTop)

    // Copy cropped region
    const outputPixels = new Uint8Array(outWidth * outHeight * 3)

    for (let y = 0; y < outHeight; y++) {
      const srcY = clampedTop + y
      for (let x = 0; x < outWidth; x++) {
        const srcX = clampedLeft + x
        const srcIdx = (srcY * width + srcX) * 3
        const dstIdx = (y * outWidth + x) * 3

        outputPixels[dstIdx] = pixels[srcIdx] ?? 0
        outputPixels[dstIdx + 1] = pixels[srcIdx + 1] ?? 0
        outputPixels[dstIdx + 2] = pixels[srcIdx + 2] ?? 0
      }
    }

    return { width: outWidth, height: outHeight, pixels: outputPixels }
  }

  async encodeJpeg(
    pixels: Uint8Array,
    width: number,
    height: number,
    quality = 90
  ): Promise<Uint8Array> {
    await this.simulateOperation()

    // For demo mode, return mock JPEG bytes
    // A minimal valid JPEG consists of SOI (0xFF 0xD8) and EOI (0xFF 0xD9) markers
    // with required segments in between. For mock purposes, we return a simple
    // structure that looks like a JPEG but contains our pixel data info.

    // Create a minimal "mock JPEG" buffer
    // In real usage, this would be actual JPEG encoding
    const mockJpegHeader = new Uint8Array([
      0xFF, 0xD8, // SOI (Start Of Image)
      0xFF, 0xE0, // APP0 marker
      0x00, 0x10, // APP0 length (16 bytes)
      0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x01, // Version 1.1
      0x00, // Aspect ratio units (0 = no units)
      0x00, 0x01, // X density
      0x00, 0x01, // Y density
      0x00, 0x00, // No thumbnail
    ])

    // For mock, we'll just return the header followed by EOI
    // Real JPEG would have compressed image data here
    const mockJpeg = new Uint8Array(mockJpegHeader.length + 2)
    mockJpeg.set(mockJpegHeader)
    mockJpeg[mockJpegHeader.length] = 0xFF
    mockJpeg[mockJpegHeader.length + 1] = 0xD9 // EOI (End Of Image)

    return mockJpeg
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
