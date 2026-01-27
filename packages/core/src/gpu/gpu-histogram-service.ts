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
import { rgbToRgba } from './texture-utils'

/**
 * GPU histogram service.
 *
 * This service provides GPU-accelerated histogram computation with the same
 * interface as the WASM-based histogram in DecodeService.
 */
export class GPUHistogramService {
  private _pipeline: HistogramPipeline | null = null
  private initialized = false

  // Reusable texture for async operations (avoids creating/destroying per call)
  private asyncTexture: GPUTexture | null = null
  private asyncTextureSize: { width: number; height: number } = { width: 0, height: 0 }
  private device: GPUDevice | null = null

  /**
   * Check if the service is initialized and ready.
   */
  isReady(): boolean {
    return this.initialized && this._pipeline !== null
  }

  /**
   * Get the underlying pipeline (for direct access to computeAsync, etc.).
   */
  get pipeline(): HistogramPipeline | null {
    return this._pipeline
  }

  /**
   * Initialize the GPU histogram service.
   *
   * @returns True if initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this._pipeline !== null
    }

    try {
      this._pipeline = await getHistogramPipeline()
      this.initialized = true

      // Store device reference for texture creation
      if (this._pipeline) {
        const { getGPUCapabilityService } = await import('./capabilities')
        const gpuService = getGPUCapabilityService()
        this.device = gpuService.device
      }

      return this._pipeline !== null
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
    if (!this._pipeline) {
      throw new Error(
        'GPU histogram service not initialized. Call initialize() first.'
      )
    }

    // Compute histogram on GPU
    const result = await this._pipeline.computeFromPixels(pixels, width, height)

    // Convert pipeline result to HistogramData
    return convertToHistogramData(result)
  }

  /**
   * Compute histogram asynchronously with non-blocking readback.
   *
   * This method uses triple-buffered async readback to avoid blocking
   * the main thread. The callback is invoked when the result is ready.
   *
   * @param pixels - Input RGB pixel data (width * height * 3 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param onComplete - Callback invoked with the histogram result
   */
  computeHistogramAsync(
    pixels: Uint8Array,
    width: number,
    height: number,
    onComplete: (result: HistogramData) => void
  ): void {
    // Convert RGB to RGBA (GPU expects RGBA)
    const rgbaPixels = rgbToRgba(pixels, width, height)
    this.computeHistogramRgbaAsync(rgbaPixels, width, height, onComplete)
  }

  /**
   * Compute histogram asynchronously from RGBA pixel data.
   *
   * This method uses triple-buffered async readback to avoid blocking
   * the main thread. The callback is invoked when the result is ready.
   *
   * @param pixels - Input RGBA pixel data (width * height * 4 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param onComplete - Callback invoked with the histogram result
   */
  computeHistogramRgbaAsync(
    pixels: Uint8Array,
    width: number,
    height: number,
    onComplete: (result: HistogramData) => void
  ): void {
    if (!this._pipeline || !this.device) {
      throw new Error(
        'GPU histogram service not initialized. Call initialize() first.'
      )
    }

    // Create or reuse texture (recreate if size changed)
    const texture = this.getOrCreateTexture(width, height)

    // Upload pixels to texture
    this.device.queue.writeTexture(
      { texture },
      pixels.buffer,
      {
        bytesPerRow: width * 4,
        rowsPerImage: height,
        offset: pixels.byteOffset,
      },
      { width, height, depthOrArrayLayers: 1 }
    )

    // Use the async non-blocking method
    this._pipeline.computeAsync(texture, width, height, (result) => {
      // Convert pipeline result to HistogramData
      onComplete(convertToHistogramData(result))
    })
  }

  /**
   * Get or create a reusable texture for async operations.
   * Recreates the texture if the size has changed.
   */
  private getOrCreateTexture(width: number, height: number): GPUTexture {
    if (!this.device) {
      throw new Error('Device not available')
    }

    // Check if we can reuse the existing texture
    if (
      this.asyncTexture &&
      this.asyncTextureSize.width === width &&
      this.asyncTextureSize.height === height
    ) {
      return this.asyncTexture
    }

    // Destroy old texture if it exists
    if (this.asyncTexture) {
      this.asyncTexture.destroy()
    }

    // Create new texture
    this.asyncTexture = this.device.createTexture({
      label: 'Histogram Async Input Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.asyncTextureSize = { width, height }

    return this.asyncTexture
  }

  /**
   * Destroy the service and release resources.
   */
  destroy(): void {
    if (this.asyncTexture) {
      this.asyncTexture.destroy()
      this.asyncTexture = null
    }
    this.asyncTextureSize = { width: 0, height: 0 }
    this._pipeline = null
    this.device = null
    this.initialized = false
  }
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

/**
 * Compute histogram from RGBA pixel data using the adaptive processor.
 *
 * This is more efficient when the caller already has RGBA data,
 * as it avoids the RGB to RGBA conversion on the GPU path.
 *
 * @param pixels - Input RGBA pixel data (4 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param wasmFallback - WASM fallback function (expects RGB, will convert)
 * @returns HistogramData with timing and backend info
 */
export async function computeHistogramAdaptiveRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  wasmFallback: () => Promise<HistogramData>
): Promise<{ result: HistogramData; backend: 'webgpu' | 'wasm'; timing: number }> {
  const gpuService = getGPUHistogramService()

  const startTime = performance.now()

  // Try GPU path if available (uses RGBA directly)
  if (gpuService.isReady()) {
    try {
      const result = await gpuService.computeHistogramRgba(pixels, width, height)
      const timing = performance.now() - startTime
      return { result, backend: 'webgpu', timing }
    } catch (error) {
      console.warn(
        '[computeHistogramAdaptiveRgba] GPU failed, falling back to WASM:',
        error
      )
    }
  }

  // WASM fallback (note: WASM expects RGB, so caller should provide appropriate fallback)
  const result = await wasmFallback()
  const timing = performance.now() - startTime
  return { result, backend: 'wasm', timing }
}
