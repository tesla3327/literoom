/// <reference types="@webgpu/types" />
/**
 * High-level GPU tone curve service.
 *
 * Provides an interface that matches the WASM tone curve functions
 * for easy integration and backend switching.
 */

import { getGPUCapabilityService } from './capabilities'
import {
  ToneCurvePipeline,
  getToneCurvePipeline,
  type ToneCurveLut,
  createIdentityLut,
  isIdentityLut,
} from './pipelines/tone-curve-pipeline'
import { getAdaptiveProcessor } from './adaptive-processor'
import { rgbToRgba, rgbaToRgb } from './texture-utils'
import type { CurvePoint } from '../decode/types'
import { isLinearCurve } from '../decode/curve-utils'

// Re-export types
export { type ToneCurveLut, createIdentityLut, isIdentityLut }
export { isLinearCurve }

/**
 * Compute monotonic tangents using Fritsch-Carlson algorithm.
 * This ensures the interpolated curve never crosses (no solarization).
 */
function computeMonotonicTangents(points: readonly CurvePoint[]): number[] {
  const n = points.length
  if (n < 2) {
    return new Array(n).fill(0)
  }

  // Compute secants (slopes between adjacent points)
  const h: number[] = []
  const delta: number[] = []

  for (let i = 0; i < n - 1; i++) {
    const hVal = points[i + 1]!.x - points[i]!.x
    h.push(hVal)
    delta.push(Math.abs(hVal) < 1e-7 ? 0 : (points[i + 1]!.y - points[i]!.y) / hVal)
  }

  // Initialize tangents
  const m: number[] = new Array(n).fill(0)

  // Interior points: weighted harmonic mean
  for (let i = 1; i < n - 1; i++) {
    if (
      Math.sign(delta[i - 1]!) !== Math.sign(delta[i]!) ||
      Math.abs(delta[i - 1]!) < 1e-7 ||
      Math.abs(delta[i]!) < 1e-7
    ) {
      m[i] = 0
    } else {
      const w1 = 2 * h[i]! + h[i - 1]!
      const w2 = h[i]! + 2 * h[i - 1]!
      m[i] = (w1 + w2) / (w1 / delta[i - 1]! + w2 / delta[i]!)
    }
  }

  // Endpoint tangents
  m[0] = delta[0]!
  m[n - 1] = delta[n - 2]!

  // Enforce monotonicity constraints
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]!) < 1e-7) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const alpha = m[i]! / delta[i]!
      const beta = m[i + 1]! / delta[i]!

      if (alpha > 3) {
        m[i] = 3 * delta[i]!
      }
      if (beta > 3) {
        m[i + 1] = 3 * delta[i]!
      }
      if (alpha < -3) {
        m[i] = -3 * Math.abs(delta[i]!)
      }
      if (beta < -3) {
        m[i + 1] = -3 * Math.abs(delta[i]!)
      }
    }
  }

  return m
}

/**
 * Find the interval containing x using binary search.
 */
function findInterval(points: readonly CurvePoint[], x: number): number {
  const n = points.length
  if (n <= 2) {
    return 0
  }

  let low = 0
  let high = n - 2

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (points[mid]!.x <= x) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return low
}

/**
 * Evaluate curve at x using cubic hermite interpolation with pre-computed tangents.
 */
function evaluateWithTangents(
  points: readonly CurvePoint[],
  tangents: readonly number[],
  x: number
): number {
  const n = points.length

  if (n === 0) {
    return x
  }
  if (n === 1) {
    return points[0]!.y
  }

  // Clamp to valid range
  const clampedX = Math.max(points[0]!.x, Math.min(points[n - 1]!.x, x))

  // Find interval
  const i = findInterval(points, clampedX)

  const p0 = points[i]!
  const p1 = points[i + 1]!

  const h = p1.x - p0.x
  if (Math.abs(h) < 1e-7) {
    return p0.y
  }

  const t = (clampedX - p0.x) / h
  const t2 = t * t
  const t3 = t2 * t

  // Hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2

  const y = h00 * p0.y + h10 * h * tangents[i]! + h01 * p1.y + h11 * h * tangents[i + 1]!

  return Math.max(0, Math.min(1, y))
}

/**
 * Generate a 256-entry LUT from curve points.
 * Uses Fritsch-Carlson monotonic cubic hermite spline interpolation.
 *
 * @param points - Curve control points (sorted by x, values 0-1)
 * @returns LUT suitable for GPU tone curve pipeline
 */
export function generateLutFromCurvePoints(points: readonly CurvePoint[]): ToneCurveLut {
  // Fast path for linear curve
  if (isLinearCurve(points)) {
    return createIdentityLut()
  }

  const tangents = computeMonotonicTangents(points)
  const lut = new Uint8Array(256)

  for (let i = 0; i < 256; i++) {
    const x = i / 255
    const y = evaluateWithTangents(points, tangents, x)
    lut[i] = Math.round(Math.max(0, Math.min(255, y * 255)))
  }

  return { lut }
}

/**
 * GPU service for tone curve application.
 */
export class GPUToneCurveService {
  private device: GPUDevice
  private pipeline: ToneCurvePipeline | null = null

  constructor(device: GPUDevice) {
    this.device = device
  }

  /**
   * Initialize the service.
   */
  async initialize(): Promise<void> {
    if (!this.pipeline) {
      this.pipeline = new ToneCurvePipeline(this.device)
      await this.pipeline.initialize()
    }
  }

  /**
   * Apply tone curve LUT to RGB pixels.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param lut - Tone curve LUT (256 entries)
   * @returns Processed RGB pixel data
   */
  async applyToneCurve(
    pixels: Uint8Array,
    width: number,
    height: number,
    lut: ToneCurveLut
  ): Promise<Uint8Array> {
    if (!this.pipeline) {
      throw new Error('Service not initialized. Call initialize() first.')
    }

    // Early exit for identity LUT
    if (isIdentityLut(lut)) {
      return pixels.slice() // Return copy
    }

    // Convert RGB to RGBA
    const rgbaPixels = rgbToRgba(pixels, width, height)

    // Apply tone curve on GPU
    const resultRgba = await this.pipeline.apply(rgbaPixels, width, height, lut)

    // Convert RGBA back to RGB
    return rgbaToRgb(resultRgba, width, height)
  }

  /**
   * Apply tone curve LUT to RGBA pixels (more efficient - no conversion).
   *
   * @param pixels - RGBA pixel data (4 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   * @param lut - Tone curve LUT (256 entries)
   * @returns Processed RGBA pixel data
   */
  async applyToneCurveRgba(
    pixels: Uint8Array,
    width: number,
    height: number,
    lut: ToneCurveLut
  ): Promise<Uint8Array> {
    if (!this.pipeline) {
      throw new Error('Service not initialized. Call initialize() first.')
    }

    return this.pipeline.apply(pixels, width, height, lut)
  }

  /**
   * Get the underlying pipeline for texture-based operations.
   */
  getPipeline(): ToneCurvePipeline | null {
    return this.pipeline
  }

  /**
   * Destroy the service and release resources.
   */
  destroy(): void {
    this.pipeline?.destroy()
    this.pipeline = null
  }
}

/**
 * Singleton instance of the GPU tone curve service.
 */
let _gpuToneCurveService: GPUToneCurveService | null = null

/**
 * Get or create the GPU tone curve service singleton.
 *
 * @returns The service, or null if GPU is not available
 */
export async function getGPUToneCurveService(): Promise<GPUToneCurveService | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_gpuToneCurveService) {
    _gpuToneCurveService = new GPUToneCurveService(gpuService.device)
    await _gpuToneCurveService.initialize()
  }

  return _gpuToneCurveService
}

/**
 * Reset the GPU tone curve service singleton (for testing).
 */
export function resetGPUToneCurveService(): void {
  if (_gpuToneCurveService) {
    _gpuToneCurveService.destroy()
    _gpuToneCurveService = null
  }
}

/**
 * Apply tone curve with adaptive backend selection (GPU preferred, WASM fallback).
 *
 * @param pixels - RGB pixel data (3 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param lut - Tone curve LUT (256 entries)
 * @param wasmFallback - WASM implementation to use if GPU unavailable
 * @returns Processed RGB pixel data
 */
export async function applyToneCurveAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  lut: ToneCurveLut,
  wasmFallback: (pixels: Uint8Array, lut: Uint8Array) => Uint8Array
): Promise<Uint8Array> {
  const processor = getAdaptiveProcessor()

  // Early exit for identity LUT
  if (isIdentityLut(lut)) {
    return pixels.slice()
  }

  const result = await processor.execute(
    'toneCurve',
    width,
    height,
    // GPU path
    async () => {
      const service = await getGPUToneCurveService()
      if (!service) {
        throw new Error('GPU service not available')
      }
      return service.applyToneCurve(pixels, width, height, lut)
    },
    // WASM fallback
    async () => {
      // The WASM function modifies pixels in place, so we need to copy
      const pixelsCopy = pixels.slice()
      return wasmFallback(pixelsCopy, lut.lut)
    }
  )

  return result.data
}

/**
 * Result from applyToneCurveFromPointsAdaptive.
 */
export interface ToneCurveAdaptiveResult {
  /** Processed pixels */
  result: {
    pixels: Uint8Array
    width: number
    height: number
  }
  /** Backend used ('webgpu' or 'wasm') */
  backend: 'webgpu' | 'wasm'
  /** Processing time in ms */
  timing: number
}

/**
 * Apply tone curve with adaptive backend selection, accepting curve points directly.
 *
 * This is a convenience wrapper that generates the LUT from curve points
 * and applies the tone curve using GPU when available, with WASM fallback.
 *
 * @param pixels - RGB pixel data (3 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param curvePoints - Tone curve control points (sorted by x, values 0-1)
 * @param wasmFallback - WASM implementation to use if GPU unavailable
 * @returns Result with processed pixels, backend used, and timing
 */
export async function applyToneCurveFromPointsAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  curvePoints: readonly CurvePoint[],
  wasmFallback: () => Promise<{ pixels: Uint8Array; width: number; height: number }>
): Promise<ToneCurveAdaptiveResult> {
  const startTime = performance.now()

  // Early exit for linear curve (identity)
  if (isLinearCurve(curvePoints)) {
    return {
      result: { pixels: pixels.slice(), width, height },
      backend: 'wasm', // No processing needed
      timing: performance.now() - startTime,
    }
  }

  // Generate LUT from curve points
  const lut = generateLutFromCurvePoints(curvePoints)

  // Try GPU path if available
  const gpuService = await getGPUToneCurveService()
  if (gpuService) {
    try {
      const resultPixels = await gpuService.applyToneCurve(pixels, width, height, lut)
      const timing = performance.now() - startTime
      return {
        result: { pixels: resultPixels, width, height },
        backend: 'webgpu',
        timing,
      }
    } catch (error) {
      console.warn('[applyToneCurveFromPointsAdaptive] GPU failed, falling back to WASM:', error)
    }
  }

  // WASM fallback
  const wasmResult = await wasmFallback()
  const timing = performance.now() - startTime
  return {
    result: wasmResult,
    backend: 'wasm',
    timing,
  }
}
