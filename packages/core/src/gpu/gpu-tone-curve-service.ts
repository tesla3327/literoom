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

// Re-export types
export { type ToneCurveLut, createIdentityLut, isIdentityLut }

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
    const pixelCount = width * height
    const rgbaPixels = new Uint8Array(pixelCount * 4)
    for (let i = 0; i < pixelCount; i++) {
      rgbaPixels[i * 4 + 0] = pixels[i * 3 + 0]
      rgbaPixels[i * 4 + 1] = pixels[i * 3 + 1]
      rgbaPixels[i * 4 + 2] = pixels[i * 3 + 2]
      rgbaPixels[i * 4 + 3] = 255 // Alpha
    }

    // Apply tone curve on GPU
    const resultRgba = await this.pipeline.apply(rgbaPixels, width, height, lut)

    // Convert RGBA back to RGB
    const resultRgb = new Uint8Array(pixelCount * 3)
    for (let i = 0; i < pixelCount; i++) {
      resultRgb[i * 3 + 0] = resultRgba[i * 4 + 0]
      resultRgb[i * 3 + 1] = resultRgba[i * 4 + 1]
      resultRgb[i * 3 + 2] = resultRgba[i * 4 + 2]
    }

    return resultRgb
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
    () => {
      // The WASM function modifies pixels in place, so we need to copy
      const pixelsCopy = pixels.slice()
      return wasmFallback(pixelsCopy, lut.lut)
    }
  )

  return result.data
}
