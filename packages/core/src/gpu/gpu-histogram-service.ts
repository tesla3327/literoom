/// <reference types="@webgpu/types" />
/**
 * GPU-accelerated histogram service.
 *
 * Provides the same interface as the WASM histogram functions but uses
 * WebGPU compute shaders for significantly faster processing.
 */

import type { HistogramData } from '../decode/types'
import {
  HistogramPipeline,
  getHistogramPipeline,
  type HistogramResult,
} from './pipelines'

/**
 * GPU histogram service.
 *
 * This service provides GPU-accelerated histogram computation with the same
 * interface as the WASM-based histogram in DecodeService.
 */
export class GPUHistogramService {
  private pipeline: HistogramPipeline | null = null
  private initialized = false

  /**
   * Check if the service is initialized and ready.
   */
  isReady(): boolean {
    return this.initialized && this.pipeline !== null
  }

  /**
   * Initialize the GPU histogram service.
   *
   * @returns True if initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.pipeline !== null
    }

    try {
      this.pipeline = await getHistogramPipeline()
      this.initialized = true
      return this.pipeline !== null
    } catch (error) {
      console.error('[GPUHistogramService] Initialization failed:', error)
      this.initialized = true
      return false
    }
  }

  /**
   * Compute histogram from RGB pixel data.
   *
   * The input pixels should be RGB (3 bytes per pixel).
   *
   * @param pixels - Input RGB pixel data (width * height * 3 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @returns HistogramData with RGB, luminance, and clipping information
   */
  async computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData> {
    // Convert RGB to RGBA (GPU expects RGBA)
    const rgbaPixels = rgbToRgba(pixels, width, height)

    return this.computeHistogramRgba(rgbaPixels, width, height)
  }

  /**
   * Compute histogram from RGBA pixel data.
   *
   * This is more efficient when the caller already has RGBA data,
   * as it avoids the RGB to RGBA conversion.
   *
   * @param pixels - Input RGBA pixel data (width * height * 4 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @returns HistogramData with RGB, luminance, and clipping information
   */
  async computeHistogramRgba(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData> {
    if (!this.pipeline) {
      throw new Error(
        'GPU histogram service not initialized. Call initialize() first.'
      )
    }

    // Compute histogram on GPU
    const result = await this.pipeline.computeFromPixels(pixels, width, height)

    // Convert pipeline result to HistogramData
    return convertToHistogramData(result)
  }

  /**
   * Destroy the service and release resources.
   */
  destroy(): void {
    this.pipeline = null
    this.initialized = false
  }
}

/**
 * Convert RGB pixel data to RGBA.
 */
function rgbToRgba(
  rgb: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  for (let i = 0; i < pixelCount; i++) {
    const rgbIdx = i * 3
    const rgbaIdx = i * 4
    rgba[rgbaIdx] = rgb[rgbIdx]! // R
    rgba[rgbaIdx + 1] = rgb[rgbIdx + 1]! // G
    rgba[rgbaIdx + 2] = rgb[rgbIdx + 2]! // B
    rgba[rgbaIdx + 3] = 255 // A (fully opaque)
  }

  return rgba
}

/**
 * Convert GPU pipeline HistogramResult to DecodeService HistogramData.
 */
function convertToHistogramData(result: HistogramResult): HistogramData {
  const { red, green, blue, luminance } = result

  // Calculate maxValue from RGB bins (for normalization)
  let maxValue = 0
  for (let i = 0; i < 256; i++) {
    maxValue = Math.max(maxValue, red[i]!, green[i]!, blue[i]!)
  }

  // Detect clipping
  // Highlight clipping: pixels at value 255
  const hasHighlightClipping =
    red[255]! > 0 || green[255]! > 0 || blue[255]! > 0

  // Shadow clipping: pixels at value 0
  const hasShadowClipping = red[0]! > 0 || green[0]! > 0 || blue[0]! > 0

  // Per-channel clipping detection
  const highlightClipping = {
    r: red[255]! > 0,
    g: green[255]! > 0,
    b: blue[255]! > 0,
  }

  const shadowClipping = {
    r: red[0]! > 0,
    g: green[0]! > 0,
    b: blue[0]! > 0,
  }

  const histogramData: HistogramData = {
    red,
    green,
    blue,
    luminance,
    maxValue,
    hasHighlightClipping,
    hasShadowClipping,
    highlightClipping,
    shadowClipping,
  }

  return histogramData
}

/**
 * Singleton instance of the GPU histogram service.
 */
let _gpuHistogramService: GPUHistogramService | null = null

/**
 * Get or create the GPU histogram service singleton.
 */
export function getGPUHistogramService(): GPUHistogramService {
  if (!_gpuHistogramService) {
    _gpuHistogramService = new GPUHistogramService()
  }
  return _gpuHistogramService
}

/**
 * Reset the GPU histogram service singleton (for testing).
 */
export function resetGPUHistogramService(): void {
  if (_gpuHistogramService) {
    _gpuHistogramService.destroy()
    _gpuHistogramService = null
  }
}

/**
 * Compute histogram using the adaptive processor.
 *
 * This is a convenience function that automatically selects between
 * GPU and WASM backends based on availability and configuration.
 *
 * @param pixels - Input RGB pixel data
 * @param width - Image width
 * @param height - Image height
 * @param wasmFallback - WASM fallback function (from DecodeService)
 * @returns HistogramData with timing and backend info
 */
export async function computeHistogramAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  wasmFallback: () => Promise<HistogramData>
): Promise<{ result: HistogramData; backend: 'webgpu' | 'wasm'; timing: number }> {
  const gpuService = getGPUHistogramService()

  const startTime = performance.now()

  // Try GPU path if available
  if (gpuService.isReady()) {
    try {
      const result = await gpuService.computeHistogram(pixels, width, height)
      const timing = performance.now() - startTime
      return { result, backend: 'webgpu', timing }
    } catch (error) {
      console.warn(
        '[computeHistogramAdaptive] GPU failed, falling back to WASM:',
        error
      )
    }
  }

  // WASM fallback
  const result = await wasmFallback()
  const timing = performance.now() - startTime
  return { result, backend: 'wasm', timing }
}
