/// <reference types="@webgpu/types" />
/**
 * GPU-accelerated transform service.
 *
 * Provides GPU-accelerated image transformations (rotation, etc.) using
 * WebGPU compute shaders for significantly faster processing.
 */

import type { DecodedImage } from '../decode/types'
import { RotationPipeline, getRotationPipeline } from './pipelines/rotation-pipeline'

/**
 * GPU transform service.
 *
 * This service provides GPU-accelerated image transformations with the same
 * interface as the WASM-based transforms in DecodeService.
 */
export class GPUTransformService {
  private rotationPipeline: RotationPipeline | null = null
  private _initialized = false

  /**
   * Check if the service is initialized and ready.
   */
  get isReady(): boolean {
    return this._initialized && this.rotationPipeline !== null
  }

  /**
   * Initialize the GPU transform service.
   *
   * @returns True if initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) {
      return this.rotationPipeline !== null
    }
    try {
      this.rotationPipeline = await getRotationPipeline()
      this._initialized = true
      return this.rotationPipeline !== null
    } catch (error) {
      console.error('[GPUTransformService] Initialization failed:', error)
      this._initialized = true
      return false
    }
  }

  /**
   * Apply rotation to image pixel data using GPU.
   *
   * @param pixels - Input pixel data
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param angleDegrees - Rotation angle in degrees
   * @returns DecodedImage with rotated pixel data
   */
  async applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number
  ): Promise<DecodedImage> {
    if (!this.rotationPipeline) {
      throw new Error('GPUTransformService not initialized')
    }

    // Fast path: no rotation needed
    if (Math.abs(angleDegrees) < 0.001) {
      return { pixels: new Uint8Array(pixels), width, height }
    }

    const result = await this.rotationPipeline.apply(pixels, width, height, angleDegrees)
    return {
      pixels: result.pixels,
      width: result.width,
      height: result.height,
    }
  }

  /**
   * Destroy the service and release resources.
   */
  destroy(): void {
    this.rotationPipeline = null
    this._initialized = false
  }
}

/**
 * Singleton instance of the GPU transform service.
 */
let _service: GPUTransformService | null = null

/**
 * Get or create the GPU transform service singleton.
 */
export function getGPUTransformService(): GPUTransformService {
  if (!_service) {
    _service = new GPUTransformService()
  }
  return _service
}

/**
 * Reset the GPU transform service singleton (for testing).
 */
export function resetGPUTransformService(): void {
  if (_service) {
    _service.destroy()
    _service = null
  }
}

/**
 * Apply rotation using the adaptive processor.
 *
 * This is a convenience function that automatically selects between
 * GPU and WASM backends based on availability and configuration.
 *
 * @param pixels - Input pixel data
 * @param width - Image width
 * @param height - Image height
 * @param angleDegrees - Rotation angle in degrees
 * @param wasmFallback - WASM fallback function (from DecodeService)
 * @returns DecodedImage with rotated pixel data and backend used
 */
export async function applyRotationAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{
  result: DecodedImage
  backend: 'webgpu' | 'wasm'
  timing: number
}> {
  const startTime = performance.now()

  // Try GPU path first
  const gpuService = getGPUTransformService()
  if (!gpuService.isReady) {
    await gpuService.initialize()
  }

  if (gpuService.isReady) {
    try {
      const result = await gpuService.applyRotation(pixels, width, height, angleDegrees)
      const timing = performance.now() - startTime
      return { result, backend: 'webgpu', timing }
    } catch (error) {
      console.warn('[GPUTransformService] GPU rotation failed, falling back to WASM:', error)
    }
  }

  // WASM fallback
  const result = await wasmFallback()
  const timing = performance.now() - startTime
  return { result, backend: 'wasm', timing }
}
