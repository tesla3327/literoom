/// <reference types="@webgpu/types" />
/**
 * Unified GPU edit pipeline that chains all operations.
 *
 * Chains rotation, adjustments, tone curve, and masks with single GPU upload/readback
 * for maximum performance. Uses texture ping-pong pattern for multi-stage processing.
 *
 * Performance: Reduces ~4 GPU round-trips to 1, enabling 60fps preview updates.
 */

import { getGPUCapabilityService } from '../capabilities'
import {
  readTexturePixels,
  TextureUsage,
  rgbToRgba,
  rgbaToRgb,
  TexturePool,
} from '../texture-utils'
import { TimingHelper } from '../utils/timing-helper'
import {
  getAdjustmentsPipeline,
  type BasicAdjustments,
  DEFAULT_BASIC_ADJUSTMENTS,
} from './adjustments-pipeline'
import {
  getToneCurvePipeline,
  type ToneCurveLut,
  isIdentityLut,
} from './tone-curve-pipeline'
import { getUberPipeline } from './uber-pipeline'
import { getMaskPipeline, type MaskStackInput } from './mask-pipeline'
import { getRotationPipeline, RotationPipeline } from './rotation-pipeline'
import type { CurvePoint } from '../../decode/types'
import { generateLutFromCurvePoints } from '../gpu-tone-curve-service'

/**
 * Input to the edit pipeline.
 */
export interface EditPipelineInput {
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
}

/**
 * Parameters for the edit pipeline.
 * All parameters are optional - only provide those that should be applied.
 */
export interface EditPipelineParams {
  /** Rotation angle in degrees (uses bilinear interpolation) */
  rotation?: number
  /** Basic adjustments (exposure, contrast, etc.) */
  adjustments?: BasicAdjustments
  /** Tone curve points (will generate LUT internally) */
  toneCurvePoints?: CurvePoint[]
  /** Tone curve LUT (pre-generated, alternative to points) */
  toneCurveLut?: ToneCurveLut
  /** Mask stack for local adjustments */
  masks?: MaskStackInput
  /** Target resolution scale (0.5 for half-resolution draft, 1.0 for full) */
  targetResolution?: number
}

/**
 * Timing breakdown for performance analysis.
 */
export interface EditPipelineTiming {
  /** Total pipeline time including all stages */
  total: number
  /** Downsampling time (0 if skipped) */
  downsample: number
  /** Time to upload RGB pixels to GPU as RGBA texture */
  upload: number
  /** Time for rotation stage (0 if skipped) */
  rotation: number
  /** Time for adjustments stage (0 if skipped) */
  adjustments: number
  /** Time for tone curve stage (0 if skipped) */
  toneCurve: number
  /** Time for combined adjustments+toneCurve via uber-pipeline (0 if not used) */
  uberPipeline: number
  /** Time for masks stage (0 if skipped) */
  masks: number
  /** Time to read RGBA pixels from GPU and convert to RGB */
  readback: number
  /** GPU-measured rotation time (nanoseconds) */
  gpuRotation?: number
  /** GPU-measured adjustments time (nanoseconds) */
  gpuAdjustments?: number
  /** GPU-measured tone curve time (nanoseconds) */
  gpuToneCurve?: number
  /** GPU-measured uber-pipeline time (nanoseconds) */
  gpuUberPipeline?: number
  /** GPU-measured masks time (nanoseconds) */
  gpuMasks?: number
}

/**
 * Result of the edit pipeline.
 */
export interface EditPipelineResult {
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Output width (may differ from input if rotated) */
  width: number
  /** Output height (may differ from input if rotated) */
  height: number
  /** Timing breakdown for each stage */
  timing: EditPipelineTiming
}

/**
 * Unified GPU edit pipeline.
 *
 * Chains all GPU operations (rotation, adjustments, tone curve, masks)
 * with single upload/readback for maximum performance.
 */
export class GPUEditPipeline {
  private device: GPUDevice | null = null
  private _initialized = false
  private texturePool: TexturePool | null = null
  private timingHelper: TimingHelper | null = null

  /**
   * Whether the pipeline is ready to process images.
   */
  get isReady(): boolean {
    return this._initialized && this.device !== null
  }

  /**
   * Initialize the pipeline.
   *
   * @returns true if GPU is available and pipeline is ready, false otherwise
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) {
      return this.isReady
    }

    const gpuService = getGPUCapabilityService()
    await gpuService.initialize()

    if (!gpuService.isReady || !gpuService.device) {
      this._initialized = true
      return false
    }

    this.device = gpuService.device

    // Initialize texture pool for efficient memory reuse
    // Pool size of 8 allows for all pipeline stages plus some headroom
    this.texturePool = new TexturePool(this.device, 8)

    // Only create if device supports timestamp queries
    this.timingHelper = new TimingHelper(this.device, 16)
    if (this.timingHelper.isSupported()) {
      this.timingHelper.initialize()
    } else {
      this.timingHelper = null
    }

    this._initialized = true
    return true
  }

  /**
   * Downsample pixels using simple 2x2 block averaging.
   *
   * For 0.5 scale (half resolution), each 2x2 block of pixels is averaged
   * into a single pixel. This provides a fast CPU-based downsampling for
   * draft mode preview processing.
   *
   * @param input - The input image data
   * @param targetScale - The target scale factor (e.g., 0.5 for half resolution)
   * @returns New EditPipelineInput with downsampled pixels and reduced dimensions
   */
  private downsamplePixels(
    input: EditPipelineInput,
    targetScale: number
  ): EditPipelineInput {
    // If targetScale is 1.0 or greater, return input unchanged
    if (targetScale >= 1.0) {
      return input
    }

    // Calculate new dimensions (floor to ensure we don't exceed bounds)
    // For 0.5 scale, this gives us half the dimensions
    const newWidth = Math.floor(input.width * targetScale)
    const newHeight = Math.floor(input.height * targetScale)

    // Ensure we have at least 1x1 output
    if (newWidth < 1 || newHeight < 1) {
      return input
    }

    // Calculate the block size (inverse of scale)
    // For 0.5 scale, blockSize = 2 (2x2 blocks)
    const blockSize = Math.round(1 / targetScale)

    // Create output buffer (RGB, 3 bytes per pixel)
    const outputPixels = new Uint8Array(newWidth * newHeight * 3)

    // Process each output pixel by averaging the corresponding input block
    for (let outY = 0; outY < newHeight; outY++) {
      for (let outX = 0; outX < newWidth; outX++) {
        // Calculate the starting position in the input
        const inStartX = outX * blockSize
        const inStartY = outY * blockSize

        // Accumulate RGB values from the block
        let sumR = 0
        let sumG = 0
        let sumB = 0
        let count = 0

        // Iterate through the block (e.g., 2x2 for 0.5 scale)
        for (let dy = 0; dy < blockSize; dy++) {
          const inY = inStartY + dy
          if (inY >= input.height) continue

          for (let dx = 0; dx < blockSize; dx++) {
            const inX = inStartX + dx
            if (inX >= input.width) continue

            // Calculate input pixel index (RGB, 3 bytes per pixel)
            const inIdx = (inY * input.width + inX) * 3

            sumR += input.pixels[inIdx]
            sumG += input.pixels[inIdx + 1]
            sumB += input.pixels[inIdx + 2]
            count++
          }
        }

        // Calculate output pixel index
        const outIdx = (outY * newWidth + outX) * 3

        // Store averaged values
        if (count > 0) {
          outputPixels[outIdx] = Math.round(sumR / count)
          outputPixels[outIdx + 1] = Math.round(sumG / count)
          outputPixels[outIdx + 2] = Math.round(sumB / count)
        }
      }
    }

    return {
      pixels: outputPixels,
      width: newWidth,
      height: newHeight,
    }
  }

  /**
   * Process an image through the full edit pipeline.
   *
   * Pipeline stages (in order):
   * 1. Rotation (if rotation !== 0)
   * 2. Adjustments (if any non-default values)
   * 3. Tone Curve (if non-identity curve)
   * 4. Masks (if any enabled masks)
   *
   * @param input - Input image (RGB pixels)
   * @param params - Edit parameters
   * @returns Processed image with timing breakdown
   * @throws Error if pipeline not initialized or GPU processing fails
   */
  async process(
    input: EditPipelineInput,
    params: EditPipelineParams
  ): Promise<EditPipelineResult> {
    if (!this.device) {
      throw new Error('GPUEditPipeline not initialized. Call initialize() first.')
    }

    const timing: EditPipelineTiming = {
      total: 0,
      downsample: 0,
      upload: 0,
      rotation: 0,
      adjustments: 0,
      toneCurve: 0,
      uberPipeline: 0,
      masks: 0,
      readback: 0,
    }

    const totalStart = performance.now()

    // Downsample input if targetResolution is set and < 1.0
    let processInput = input
    const targetResolution = params.targetResolution ?? 1.0
    if (targetResolution < 1.0) {
      const downsampleStart = performance.now()
      processInput = this.downsamplePixels(input, targetResolution)
      timing.downsample = performance.now() - downsampleStart
    }

    // Determine which features are needed
    const needsAdjustments = shouldApplyAdjustments(params.adjustments)
    const needsToneCurve = shouldApplyToneCurve(params.toneCurvePoints, params.toneCurveLut)

    // Use uber-pipeline when BOTH adjustments AND tone curve are needed (75% bandwidth reduction)
    const useUberPipeline = needsAdjustments && needsToneCurve

    // Get all required pipelines
    const [rotationPipeline, adjustmentsPipeline, toneCurvePipeline, uberPipeline, maskPipeline] =
      await Promise.all([
        shouldApplyRotation(params.rotation) ? getRotationPipeline() : null,
        // Only get individual pipelines if not using uber-pipeline
        needsAdjustments && !useUberPipeline ? getAdjustmentsPipeline() : null,
        needsToneCurve && !useUberPipeline ? getToneCurvePipeline() : null,
        // Get uber-pipeline when both features are needed
        useUberPipeline ? getUberPipeline() : null,
        shouldApplyMasks(params.masks) ? getMaskPipeline() : null,
      ])

    // Track current dimensions (may change after rotation)
    // Use processInput dimensions which may be downsampled
    let currentWidth = processInput.width
    let currentHeight = processInput.height

    // Convert RGB to RGBA and upload to GPU
    const uploadStart = performance.now()
    const rgba = rgbToRgba(processInput.pixels, processInput.width, processInput.height)
    let inputTexture = this.texturePool!.acquire(
      processInput.width,
      processInput.height,
      TextureUsage.PINGPONG,
      'Edit Pipeline Input'
    )
    // Upload pixels to acquired texture
    this.device.queue.writeTexture(
      { texture: inputTexture },
      rgba.buffer,
      { bytesPerRow: processInput.width * 4, rowsPerImage: processInput.height, offset: rgba.byteOffset },
      { width: processInput.width, height: processInput.height, depthOrArrayLayers: 1 }
    )
    timing.upload = performance.now() - uploadStart

    // Create command encoder for chaining all operations
    let encoder = this.device.createCommandEncoder({
      label: 'Edit Pipeline Command Encoder',
    })

    // Track textures for cleanup with their dimensions for pool release
    const texturesToRelease: TextureWithDims[] = []

    // Track GPU timing stage indices: [rotation, adjustments/uber, toneCurve, masks]
    const gpuTimingIndices: (number | null)[] = [null, null, null, null]

    // Stage 1: Rotation (changes dimensions)
    if (rotationPipeline && params.rotation && Math.abs(params.rotation) > 0.001) {
      const rotStart = performance.now()

      // Calculate output dimensions
      const rotDims = RotationPipeline.computeRotatedDimensions(
        currentWidth,
        currentHeight,
        params.rotation
      )

      // Create output texture with new dimensions from pool
      const outputTexture = this.texturePool!.acquire(
        rotDims.width,
        rotDims.height,
        TextureUsage.PINGPONG,
        'Edit Pipeline Rotation Output'
      )

      // GPU timing: reserve pair index for rotation
      // Note: Actual GPU timing capture requires sub-pipelines to support timestampWrites
      if (this.timingHelper) {
        gpuTimingIndices[0] = this.timingHelper.beginTimestamp()
      }

      // Apply rotation
      encoder = rotationPipeline.applyToTextures(
        inputTexture,
        outputTexture,
        currentWidth,
        currentHeight,
        rotDims.width,
        rotDims.height,
        params.rotation,
        encoder
      )

      // Update current state - track old texture with its dimensions
      texturesToRelease.push({ texture: inputTexture, width: currentWidth, height: currentHeight })
      inputTexture = outputTexture
      currentWidth = rotDims.width
      currentHeight = rotDims.height

      timing.rotation = performance.now() - rotStart
    }

    // Stage context for reuse across stages
    const ctx: StageContext = {
      device: this.device,
      inputTexture,
      currentWidth,
      currentHeight,
      encoder,
      texturesToRelease,
      texturePool: this.texturePool!,
      timingHelper: this.timingHelper,
    }

    // Stage 2+3: Use uber-pipeline for combined adjustments+toneCurve (single pass, 75% bandwidth reduction)
    if (uberPipeline && params.adjustments) {
      const lut = params.toneCurveLut ?? generateLutFromCurvePoints(params.toneCurvePoints!)
      const result = applyStage(ctx, 'Edit Pipeline Uber Output', (input, output, enc) =>
        uberPipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, params.adjustments!, lut, enc)
      )
      ctx.inputTexture = result.inputTexture
      ctx.encoder = result.encoder
      timing.uberPipeline = result.elapsedTime
      if (result.gpuTimingIndex !== null) {
        gpuTimingIndices[1] = result.gpuTimingIndex // Use adjustments slot for uber timing
      }
    } else {
      // Stage 2: Adjustments (only when not using uber-pipeline)
      if (adjustmentsPipeline && params.adjustments) {
        const result = applyStage(ctx, 'Edit Pipeline Adjustments Output', (input, output, enc) =>
          adjustmentsPipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, params.adjustments!, enc)
        )
        ctx.inputTexture = result.inputTexture
        ctx.encoder = result.encoder
        timing.adjustments = result.elapsedTime
        if (result.gpuTimingIndex !== null) {
          gpuTimingIndices[1] = result.gpuTimingIndex
        }
      }

      // Stage 3: Tone Curve (only when not using uber-pipeline)
      if (toneCurvePipeline) {
        const lut = params.toneCurveLut ?? generateLutFromCurvePoints(params.toneCurvePoints!)

        if (!isIdentityLut(lut)) {
          const result = applyStage(ctx, 'Edit Pipeline Tone Curve Output', (input, output, enc) =>
            toneCurvePipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, lut, enc)
          )
          ctx.inputTexture = result.inputTexture
          ctx.encoder = result.encoder
          timing.toneCurve = result.elapsedTime
          if (result.gpuTimingIndex !== null) {
            gpuTimingIndices[2] = result.gpuTimingIndex
          }
        }
      }
    }

    // Stage 4: Masks
    if (maskPipeline && params.masks) {
      const result = applyStage(ctx, 'Edit Pipeline Masks Output', (input, output, enc) =>
        maskPipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, params.masks!, enc)
      )
      ctx.inputTexture = result.inputTexture
      ctx.encoder = result.encoder
      timing.masks = result.elapsedTime
      if (result.gpuTimingIndex !== null) {
        gpuTimingIndices[3] = result.gpuTimingIndex
      }
    }

    // Extract final values from context
    inputTexture = ctx.inputTexture
    encoder = ctx.encoder

    // Resolve GPU timestamps after all stages
    this.timingHelper?.resolveTimestamps(encoder)

    // Submit all GPU commands at once
    this.device.queue.submit([encoder.finish()])

    // Read back result
    const readStart = performance.now()
    const resultRgba = await readTexturePixels(
      this.device,
      inputTexture,
      currentWidth,
      currentHeight
    )
    timing.readback = performance.now() - readStart

    // Read GPU timings if available
    if (this.timingHelper) {
      const gpuTimings = await this.timingHelper.readTimings()

      // Map GPU timings to the timing result
      if (gpuTimingIndices[0] !== null && gpuTimings[gpuTimingIndices[0]] !== undefined) {
        timing.gpuRotation = gpuTimings[gpuTimingIndices[0]]
      }
      if (gpuTimingIndices[1] !== null && gpuTimings[gpuTimingIndices[1]] !== undefined) {
        // Index 1 is used for either adjustments or uber-pipeline
        if (timing.uberPipeline > 0) {
          timing.gpuUberPipeline = gpuTimings[gpuTimingIndices[1]]
        } else {
          timing.gpuAdjustments = gpuTimings[gpuTimingIndices[1]]
        }
      }
      if (gpuTimingIndices[2] !== null && gpuTimings[gpuTimingIndices[2]] !== undefined) {
        timing.gpuToneCurve = gpuTimings[gpuTimingIndices[2]]
      }
      if (gpuTimingIndices[3] !== null && gpuTimings[gpuTimingIndices[3]] !== undefined) {
        timing.gpuMasks = gpuTimings[gpuTimingIndices[3]]
      }

      this.timingHelper.reset()
    }

    // Release textures back to pool instead of destroying
    this.texturePool!.release(inputTexture, currentWidth, currentHeight, TextureUsage.PINGPONG)
    for (const item of texturesToRelease) {
      this.texturePool!.release(item.texture, item.width, item.height, TextureUsage.PINGPONG)
    }

    // Convert RGBA back to RGB
    const resultRgb = rgbaToRgb(resultRgba, currentWidth, currentHeight)

    timing.total = performance.now() - totalStart

    return {
      pixels: resultRgb,
      width: currentWidth,
      height: currentHeight,
      timing,
    }
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.timingHelper?.destroy()
    this.timingHelper = null
    this.texturePool?.clear()
    this.texturePool = null
    this.device = null
    this._initialized = false
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Texture with its dimensions for proper pool release.
 */
interface TextureWithDims {
  texture: GPUTexture
  width: number
  height: number
}

/**
 * Context for applying a pipeline stage.
 */
interface StageContext {
  device: GPUDevice
  inputTexture: GPUTexture
  currentWidth: number
  currentHeight: number
  encoder: GPUCommandEncoder
  texturesToRelease: TextureWithDims[]
  texturePool: TexturePool
  timingHelper: TimingHelper | null
}

/**
 * Result from applying a pipeline stage.
 */
interface StageResult {
  inputTexture: GPUTexture
  encoder: GPUCommandEncoder
  elapsedTime: number
  gpuTimingIndex: number | null
}

/**
 * Apply a single pipeline stage, handling texture creation, application, and cleanup tracking.
 *
 * @param ctx - The stage context with device, textures, and encoder
 * @param label - Label for the output texture
 * @param applyFn - Function that applies the stage operation
 * @returns Updated context with new texture and elapsed time
 */
function applyStage(
  ctx: StageContext,
  label: string,
  applyFn: (inputTexture: GPUTexture, outputTexture: GPUTexture, encoder: GPUCommandEncoder) => GPUCommandEncoder
): StageResult {
  const start = performance.now()

  const outputTexture = ctx.texturePool.acquire(
    ctx.currentWidth,
    ctx.currentHeight,
    TextureUsage.PINGPONG,
    label
  )

  // GPU timing: reserve pair index for this stage
  // Note: Actual GPU timing capture requires sub-pipelines to support timestampWrites
  let gpuTimingIndex: number | null = null
  if (ctx.timingHelper) {
    gpuTimingIndex = ctx.timingHelper.beginTimestamp()
  }

  const encoder = applyFn(ctx.inputTexture, outputTexture, ctx.encoder)

  // Track old texture with its dimensions for pool release
  ctx.texturesToRelease.push({ texture: ctx.inputTexture, width: ctx.currentWidth, height: ctx.currentHeight })

  return {
    inputTexture: outputTexture,
    encoder,
    elapsedTime: performance.now() - start,
    gpuTimingIndex,
  }
}

/**
 * Check if rotation should be applied.
 */
function shouldApplyRotation(rotation: number | undefined): boolean {
  return rotation !== undefined && Math.abs(rotation) > 0.001
}

/**
 * Check if adjustments should be applied.
 */
function shouldApplyAdjustments(adjustments: BasicAdjustments | undefined): boolean {
  if (!adjustments) return false

  // Check if any adjustment differs from default
  const defaults = DEFAULT_BASIC_ADJUSTMENTS
  return (
    adjustments.temperature !== defaults.temperature ||
    adjustments.tint !== defaults.tint ||
    adjustments.exposure !== defaults.exposure ||
    adjustments.contrast !== defaults.contrast ||
    adjustments.highlights !== defaults.highlights ||
    adjustments.shadows !== defaults.shadows ||
    adjustments.whites !== defaults.whites ||
    adjustments.blacks !== defaults.blacks ||
    adjustments.vibrance !== defaults.vibrance ||
    adjustments.saturation !== defaults.saturation
  )
}

/**
 * Check if tone curve should be applied.
 */
function shouldApplyToneCurve(
  points: CurvePoint[] | undefined,
  lut: ToneCurveLut | undefined
): boolean {
  // If LUT provided, use it (unless it's identity)
  if (lut) return !isIdentityLut(lut)

  // If points provided, check if they form an identity curve
  if (!points || points.length === 0) return false
  if (points.length !== 2) return true

  // Check for identity: (0,0) to (1,1)
  const [p0, p1] = points
  return !(
    Math.abs(p0.x) < 0.001 &&
    Math.abs(p0.y) < 0.001 &&
    Math.abs(p1.x - 1) < 0.001 &&
    Math.abs(p1.y - 1) < 0.001
  )
}

/**
 * Check if masks should be applied.
 */
function shouldApplyMasks(masks: MaskStackInput | undefined): boolean {
  if (!masks) return false

  // Check if any mask is enabled
  const hasEnabledLinear = masks.linearMasks?.some((m) => m.enabled) ?? false
  const hasEnabledRadial = masks.radialMasks?.some((m) => m.enabled) ?? false

  return hasEnabledLinear || hasEnabledRadial
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _gpuEditPipeline: GPUEditPipeline | null = null

/**
 * Get the singleton GPUEditPipeline instance.
 *
 * @returns The shared pipeline instance
 */
export function getGPUEditPipeline(): GPUEditPipeline {
  if (!_gpuEditPipeline) {
    _gpuEditPipeline = new GPUEditPipeline()
  }
  return _gpuEditPipeline
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetGPUEditPipeline(): void {
  if (_gpuEditPipeline) {
    _gpuEditPipeline.destroy()
    _gpuEditPipeline = null
  }
}

/**
 * Downsample RGB pixels using simple 2x2 block averaging.
 *
 * For 0.5 scale (half resolution), each 2x2 block of pixels is averaged
 * into a single pixel. This provides a fast CPU-based downsampling for
 * draft mode preview processing.
 *
 * @param pixels - RGB pixel data (3 bytes per pixel)
 * @param width - Input image width in pixels
 * @param height - Input image height in pixels
 * @param scale - Target scale factor (e.g., 0.5 for half resolution)
 * @returns Object containing downsampled pixels and new dimensions
 */
export function downsamplePixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  scale: number
): { pixels: Uint8Array; width: number; height: number } {
  // If scale is 1.0 or greater, return input unchanged
  if (scale >= 1.0) {
    return { pixels, width, height }
  }

  // Calculate new dimensions (floor to ensure we don't exceed bounds)
  // For 0.5 scale, this gives us half the dimensions
  const newWidth = Math.floor(width * scale)
  const newHeight = Math.floor(height * scale)

  // Ensure we have at least 1x1 output
  if (newWidth < 1 || newHeight < 1) {
    return { pixels, width, height }
  }

  // Calculate the block size (inverse of scale)
  // For 0.5 scale, blockSize = 2 (2x2 blocks)
  const blockSize = Math.round(1 / scale)

  // Create output buffer (RGB, 3 bytes per pixel)
  const outputPixels = new Uint8Array(newWidth * newHeight * 3)

  // Process each output pixel by averaging the corresponding input block
  for (let outY = 0; outY < newHeight; outY++) {
    for (let outX = 0; outX < newWidth; outX++) {
      // Calculate the starting position in the input
      const inStartX = outX * blockSize
      const inStartY = outY * blockSize

      // Accumulate RGB values from the block
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0

      // Iterate through the block (e.g., 2x2 for 0.5 scale)
      for (let dy = 0; dy < blockSize; dy++) {
        const inY = inStartY + dy
        if (inY >= height) continue

        for (let dx = 0; dx < blockSize; dx++) {
          const inX = inStartX + dx
          if (inX >= width) continue

          // Calculate input pixel index (RGB, 3 bytes per pixel)
          const inIdx = (inY * width + inX) * 3

          sumR += pixels[inIdx]!
          sumG += pixels[inIdx + 1]!
          sumB += pixels[inIdx + 2]!
          count++
        }
      }

      // Calculate output pixel index
      const outIdx = (outY * newWidth + outX) * 3

      // Store averaged values
      if (count > 0) {
        outputPixels[outIdx] = Math.round(sumR / count)
        outputPixels[outIdx + 1] = Math.round(sumG / count)
        outputPixels[outIdx + 2] = Math.round(sumB / count)
      }
    }
  }

  return {
    pixels: outputPixels,
    width: newWidth,
    height: newHeight,
  }
}

/**
 * Internal exports for testing.
 * @internal
 */
export const _internal = {
  shouldApplyRotation,
  shouldApplyAdjustments,
  shouldApplyToneCurve,
  shouldApplyMasks,
  rgbToRgba,
  rgbaToRgb,
  downsamplePixels,
}
