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
}

/**
 * Timing breakdown for performance analysis.
 */
export interface EditPipelineTiming {
  /** Total pipeline time including all stages */
  total: number
  /** Time to upload RGB pixels to GPU as RGBA texture */
  upload: number
  /** Time for rotation stage (0 if skipped) */
  rotation: number
  /** Time for adjustments stage (0 if skipped) */
  adjustments: number
  /** Time for tone curve stage (0 if skipped) */
  toneCurve: number
  /** Time for masks stage (0 if skipped) */
  masks: number
  /** Time to read RGBA pixels from GPU and convert to RGB */
  readback: number
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

    this._initialized = true
    return true
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
      upload: 0,
      rotation: 0,
      adjustments: 0,
      toneCurve: 0,
      masks: 0,
      readback: 0,
    }

    const totalStart = performance.now()

    // Get all required pipelines
    const [rotationPipeline, adjustmentsPipeline, toneCurvePipeline, maskPipeline] =
      await Promise.all([
        shouldApplyRotation(params.rotation) ? getRotationPipeline() : null,
        shouldApplyAdjustments(params.adjustments) ? getAdjustmentsPipeline() : null,
        shouldApplyToneCurve(params.toneCurvePoints, params.toneCurveLut)
          ? getToneCurvePipeline()
          : null,
        shouldApplyMasks(params.masks) ? getMaskPipeline() : null,
      ])

    // Track current dimensions (may change after rotation)
    let currentWidth = input.width
    let currentHeight = input.height

    // Convert RGB to RGBA and upload to GPU
    const uploadStart = performance.now()
    const rgba = rgbToRgba(input.pixels, input.width, input.height)
    let inputTexture = this.texturePool!.acquire(
      input.width,
      input.height,
      TextureUsage.PINGPONG,
      'Edit Pipeline Input'
    )
    // Upload pixels to acquired texture
    this.device.queue.writeTexture(
      { texture: inputTexture },
      rgba.buffer,
      { bytesPerRow: input.width * 4, rowsPerImage: input.height, offset: rgba.byteOffset },
      { width: input.width, height: input.height, depthOrArrayLayers: 1 }
    )
    timing.upload = performance.now() - uploadStart

    // Create command encoder for chaining all operations
    let encoder = this.device.createCommandEncoder({
      label: 'Edit Pipeline Command Encoder',
    })

    // Track textures for cleanup with their dimensions for pool release
    const texturesToRelease: TextureWithDims[] = []

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
    }

    // Stage 2: Adjustments
    if (adjustmentsPipeline && params.adjustments) {
      const result = applyStage(ctx, 'Edit Pipeline Adjustments Output', (input, output, enc) =>
        adjustmentsPipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, params.adjustments!, enc)
      )
      ctx.inputTexture = result.inputTexture
      ctx.encoder = result.encoder
      timing.adjustments = result.elapsedTime
    }

    // Stage 3: Tone Curve
    if (toneCurvePipeline) {
      const lut = params.toneCurveLut ?? generateLutFromCurvePoints(params.toneCurvePoints!)

      if (!isIdentityLut(lut)) {
        const result = applyStage(ctx, 'Edit Pipeline Tone Curve Output', (input, output, enc) =>
          toneCurvePipeline.applyToTextures(input, output, ctx.currentWidth, ctx.currentHeight, lut, enc)
        )
        ctx.inputTexture = result.inputTexture
        ctx.encoder = result.encoder
        timing.toneCurve = result.elapsedTime
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
    }

    // Extract final values from context
    inputTexture = ctx.inputTexture
    encoder = ctx.encoder

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
}

/**
 * Result from applying a pipeline stage.
 */
interface StageResult {
  inputTexture: GPUTexture
  encoder: GPUCommandEncoder
  elapsedTime: number
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

  const encoder = applyFn(ctx.inputTexture, outputTexture, ctx.encoder)

  // Track old texture with its dimensions for pool release
  ctx.texturesToRelease.push({ texture: ctx.inputTexture, width: ctx.currentWidth, height: ctx.currentHeight })

  return {
    inputTexture: outputTexture,
    encoder,
    elapsedTime: performance.now() - start,
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
}
