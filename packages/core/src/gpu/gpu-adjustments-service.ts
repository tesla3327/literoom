/// <reference types="@webgpu/types" />
/**
 * GPU-accelerated adjustments service.
 *
 * Provides the same interface as the WASM adjustments functions but uses
 * WebGPU compute shaders for significantly faster processing.
 */

import type { Adjustments, DecodedImage } from '../decode/types'
import { getGPUCapabilityService } from './capabilities'
import {
  AdjustmentsPipeline,
  type BasicAdjustments,
  getAdjustmentsPipeline,
} from './pipelines'
import { rgbToRgba, rgbaToRgb } from './texture-utils'

/**
 * Convert decode Adjustments to GPU BasicAdjustments.
 * They have the same structure, but this ensures type safety.
 */
function toGPUAdjustments(adjustments: Adjustments): BasicAdjustments {
  return {
    temperature: adjustments.temperature,
    tint: adjustments.tint,
    exposure: adjustments.exposure,
    contrast: adjustments.contrast,
    highlights: adjustments.highlights,
    shadows: adjustments.shadows,
    whites: adjustments.whites,
    blacks: adjustments.blacks,
    vibrance: adjustments.vibrance,
    saturation: adjustments.saturation,
  }
}

/**
 * GPU adjustments service.
 *
 * This service provides GPU-accelerated image adjustments with the same
 * interface as the WASM-based adjustments in DecodeService.
 */
export class GPUAdjustmentsService {
  private pipeline: AdjustmentsPipeline | null = null
  private _initialized = false

  /**
   * Check if the service is initialized and ready.
   */
  get isReady(): boolean {
    return this._initialized && this.pipeline !== null
  }

  /**
   * Initialize the GPU adjustments service.
   *
   * @returns True if initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) {
      return this.pipeline !== null
    }

    try {
      this.pipeline = await getAdjustmentsPipeline()
      this._initialized = true
      return this.pipeline !== null
    } catch (error) {
      console.error('[GPUAdjustmentsService] Initialization failed:', error)
      this._initialized = true
      return false
    }
  }

  /**
   * Apply adjustments to image pixel data using GPU.
   *
   * The input pixels should be RGB (3 bytes per pixel). The output
   * will also be RGB.
   *
   * @param pixels - Input RGB pixel data (width * height * 3 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param adjustments - Adjustment parameters to apply
   * @returns DecodedImage with adjusted pixel data
   */
  async applyAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<DecodedImage> {
    if (!this.pipeline) {
      throw new Error(
        'GPU adjustments service not initialized. Call initialize() first.'
      )
    }

    // Convert RGB to RGBA (GPU expects RGBA)
    const rgbaPixels = rgbToRgba(pixels, width, height)

    // Apply adjustments on GPU
    const gpuAdjustments = toGPUAdjustments(adjustments)
    const resultRgba = await this.pipeline.apply(
      rgbaPixels,
      width,
      height,
      gpuAdjustments
    )

    // Convert back to RGB
    const resultRgb = rgbaToRgb(resultRgba, width, height)

    return {
      pixels: resultRgb,
      width,
      height,
    }
  }

  /**
   * Apply adjustments and return RGBA pixels.
   *
   * This is more efficient when the caller needs RGBA output,
   * as it avoids the RGB↔RGBA conversions.
   *
   * @param rgbaPixels - Input RGBA pixel data (width * height * 4 bytes)
   * @param width - Image width
   * @param height - Image height
   * @param adjustments - Adjustment parameters
   * @returns RGBA pixel data
   */
  async applyAdjustmentsRgba(
    rgbaPixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ): Promise<Uint8Array> {
    if (!this.pipeline) {
      throw new Error(
        'GPU adjustments service not initialized. Call initialize() first.'
      )
    }

    const gpuAdjustments = toGPUAdjustments(adjustments)
    return this.pipeline.apply(rgbaPixels, width, height, gpuAdjustments)
  }

  /**
   * Destroy the service and release resources.
   */
  destroy(): void {
    this.pipeline = null
    this._initialized = false
  }
}

/**
 * Singleton instance of the GPU adjustments service.
 */
let _gpuAdjustmentsService: GPUAdjustmentsService | null = null

/**
 * Get or create the GPU adjustments service singleton.
 */
export function getGPUAdjustmentsService(): GPUAdjustmentsService {
  if (!_gpuAdjustmentsService) {
    _gpuAdjustmentsService = new GPUAdjustmentsService()
  }
  return _gpuAdjustmentsService
}

/**
 * Reset the GPU adjustments service singleton (for testing).
 */
export function resetGPUAdjustmentsService(): void {
  if (_gpuAdjustmentsService) {
    _gpuAdjustmentsService.destroy()
    _gpuAdjustmentsService = null
  }
}

/**
 * Apply adjustments using the adaptive processor.
 *
 * This is a convenience function that automatically selects between
 * GPU and WASM backends based on availability and configuration.
 *
 * @param pixels - Input RGB pixel data
 * @param width - Image width
 * @param height - Image height
 * @param adjustments - Adjustment parameters
 * @param wasmFallback - WASM fallback function (from DecodeService)
 * @returns DecodedImage with adjusted pixel data and backend used
 */
export async function applyAdjustmentsAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  adjustments: Adjustments,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{ result: DecodedImage; backend: 'webgpu' | 'wasm'; timing: number }> {
  const gpuService = getGPUAdjustmentsService()

  const startTime = performance.now()

  // Try GPU path if available
  if (gpuService.isReady) {
    try {
      const result = await gpuService.applyAdjustments(
        pixels,
        width,
        height,
        adjustments
      )
      const timing = performance.now() - startTime
      return { result, backend: 'webgpu', timing }
    } catch (error) {
      console.warn(
        '[applyAdjustmentsAdaptive] GPU failed, falling back to WASM:',
        error
      )
    }
  }

  // WASM fallback
  const result = await wasmFallback()
  const timing = performance.now() - startTime
  return { result, backend: 'wasm', timing }
}
