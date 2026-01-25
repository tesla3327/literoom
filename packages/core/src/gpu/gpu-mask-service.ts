/// <reference types="@webgpu/types" />
/**
 * GPU-accelerated mask service.
 *
 * Provides the same interface as the WASM masked adjustments functions but uses
 * WebGPU compute shaders for significantly faster processing.
 */

import type { Adjustments, DecodedImage } from '../decode/types'
import type { MaskStackData } from '../decode/worker-messages'
import {
  MaskPipeline,
  type GPUMaskAdjustments,
  type LinearMaskData,
  type RadialMaskData,
  type MaskStackInput,
  getMaskPipeline,
} from './pipelines'
import { rgbToRgba, rgbaToRgb } from './texture-utils'

/**
 * Convert WASM mask adjustments (Partial<Adjustments>) to GPU mask adjustments.
 */
function toGPUMaskAdjustments(adj: Partial<Adjustments>): Partial<GPUMaskAdjustments> {
  return {
    exposure: adj.exposure,
    contrast: adj.contrast,
    temperature: adj.temperature,
    tint: adj.tint,
    highlights: adj.highlights,
    shadows: adj.shadows,
    saturation: adj.saturation,
    vibrance: adj.vibrance,
  }
}

/**
 * Convert MaskStackData (WASM interface) to MaskStackInput (GPU interface).
 *
 * The main difference is that radial mask rotation is in degrees for WASM
 * but in radians for GPU.
 */
function toGPUMaskStack(maskStack: MaskStackData): MaskStackInput {
  const linearMasks: LinearMaskData[] = maskStack.linearMasks.map((mask) => ({
    startX: mask.startX,
    startY: mask.startY,
    endX: mask.endX,
    endY: mask.endY,
    feather: mask.feather,
    enabled: mask.enabled,
    adjustments: toGPUMaskAdjustments(mask.adjustments),
  }))

  const radialMasks: RadialMaskData[] = maskStack.radialMasks.map((mask) => ({
    centerX: mask.centerX,
    centerY: mask.centerY,
    radiusX: mask.radiusX,
    radiusY: mask.radiusY,
    // Convert degrees to radians
    rotation: (mask.rotation * Math.PI) / 180,
    feather: mask.feather,
    invert: mask.invert,
    enabled: mask.enabled,
    adjustments: toGPUMaskAdjustments(mask.adjustments),
  }))

  return { linearMasks, radialMasks }
}

/**
 * Check if a mask stack has any enabled masks.
 */
function hasEnabledMasks(maskStack: MaskStackData): boolean {
  const hasLinear = maskStack.linearMasks.some((m) => m.enabled)
  const hasRadial = maskStack.radialMasks.some((m) => m.enabled)
  return hasLinear || hasRadial
}

/**
 * GPU mask service.
 *
 * This service provides GPU-accelerated masked adjustments with the same
 * interface as the WASM-based masked adjustments in DecodeService.
 */
export class GPUMaskService {
  private pipeline: MaskPipeline | null = null
  private _initialized = false

  /**
   * Check if the service is initialized and ready.
   */
  get isReady(): boolean {
    return this._initialized && this.pipeline !== null
  }

  /**
   * Initialize the GPU mask service.
   *
   * @returns True if initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) {
      return this.pipeline !== null
    }

    try {
      this.pipeline = await getMaskPipeline()
      this._initialized = true
      return this.pipeline !== null
    } catch (error) {
      console.error('[GPUMaskService] Initialization failed:', error)
      this._initialized = true
      return false
    }
  }

  /**
   * Apply masked adjustments to image pixel data using GPU.
   *
   * The input pixels should be RGB (3 bytes per pixel). The output
   * will also be RGB.
   *
   * @param pixels - Input RGB pixel data (width * height * 3 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param maskStack - Mask stack with linear and radial gradient masks
   * @returns DecodedImage with adjusted pixel data
   */
  async applyMaskedAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<DecodedImage> {
    if (!this.pipeline) {
      throw new Error(
        'GPU mask service not initialized. Call initialize() first.'
      )
    }

    // Early exit if no enabled masks - return copy of input
    if (!hasEnabledMasks(maskStack)) {
      return {
        pixels: pixels.slice(),
        width,
        height,
      }
    }

    // Convert RGB to RGBA (GPU expects RGBA)
    const rgbaPixels = rgbToRgba(pixels, width, height)

    // Convert mask stack to GPU format
    const gpuMaskStack = toGPUMaskStack(maskStack)

    // Apply masks on GPU
    const resultRgba = await this.pipeline.apply(
      rgbaPixels,
      width,
      height,
      gpuMaskStack
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
   * Apply masked adjustments and return RGBA pixels.
   *
   * This is more efficient when the caller needs RGBA output,
   * as it avoids the RGB↔RGBA conversions.
   *
   * @param rgbaPixels - Input RGBA pixel data (width * height * 4 bytes)
   * @param width - Image width
   * @param height - Image height
   * @param maskStack - Mask stack with linear and radial gradient masks
   * @returns RGBA pixel data
   */
  async applyMaskedAdjustmentsRgba(
    rgbaPixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<Uint8Array> {
    if (!this.pipeline) {
      throw new Error(
        'GPU mask service not initialized. Call initialize() first.'
      )
    }

    // Early exit if no enabled masks - return copy of input
    if (!hasEnabledMasks(maskStack)) {
      return rgbaPixels.slice()
    }

    // Convert mask stack to GPU format
    const gpuMaskStack = toGPUMaskStack(maskStack)

    return this.pipeline.apply(rgbaPixels, width, height, gpuMaskStack)
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
 * Singleton instance of the GPU mask service.
 */
let _gpuMaskService: GPUMaskService | null = null

/**
 * Get or create the GPU mask service singleton.
 */
export function getGPUMaskService(): GPUMaskService {
  if (!_gpuMaskService) {
    _gpuMaskService = new GPUMaskService()
  }
  return _gpuMaskService
}

/**
 * Reset the GPU mask service singleton (for testing).
 */
export function resetGPUMaskService(): void {
  if (_gpuMaskService) {
    _gpuMaskService.destroy()
    _gpuMaskService = null
  }
}

/**
 * Apply masked adjustments using the adaptive processor.
 *
 * This is a convenience function that automatically selects between
 * GPU and WASM backends based on availability and configuration.
 *
 * @param pixels - Input RGB pixel data
 * @param width - Image width
 * @param height - Image height
 * @param maskStack - Mask stack with linear and radial gradient masks
 * @param wasmFallback - WASM fallback function (from DecodeService)
 * @returns DecodedImage with adjusted pixel data and backend used
 */
export async function applyMaskedAdjustmentsAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  maskStack: MaskStackData,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{ result: DecodedImage; backend: 'webgpu' | 'wasm'; timing: number }> {
  const gpuService = getGPUMaskService()

  const startTime = performance.now()

  // Try GPU path if available
  if (gpuService.isReady) {
    try {
      const result = await gpuService.applyMaskedAdjustments(
        pixels,
        width,
        height,
        maskStack
      )
      const timing = performance.now() - startTime
      return { result, backend: 'webgpu', timing }
    } catch (error) {
      console.warn(
        '[applyMaskedAdjustmentsAdaptive] GPU failed, falling back to WASM:',
        error
      )
    }
  }

  // WASM fallback
  const result = await wasmFallback()
  const timing = performance.now() - startTime
  return { result, backend: 'wasm', timing }
}
