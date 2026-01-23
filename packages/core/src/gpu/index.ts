/**
 * GPU acceleration module for Literoom.
 *
 * This module provides WebGPU-based GPU acceleration for image processing
 * operations, with automatic fallback to WASM when WebGPU is not available.
 *
 * @example
 * ```typescript
 * import { getAdaptiveProcessor, detectGPUCapabilities } from '@literoom/core'
 *
 * // Check capabilities
 * const caps = await detectGPUCapabilities()
 * console.log(`GPU available: ${caps.available}`)
 *
 * // Initialize processor
 * const processor = getAdaptiveProcessor()
 * await processor.initialize()
 *
 * // Execute operation with automatic backend selection
 * const result = await processor.execute(
 *   'adjustments',
 *   width, height,
 *   () => gpuAdjustments(pixels, adjustments),
 *   () => wasmAdjustments(pixels, adjustments)
 * )
 * console.log(`Used ${result.backend} in ${result.timing}ms`)
 * ```
 */

// Types
export {
  type ProcessingBackend,
  type GPUCapabilities,
  type GPUServiceState,
  type GPUInitOptions,
  type GPUOperation,
  type ProcessingResult,
  type GPUErrorCode,
  GPUError,
  DEFAULT_GPU_CAPABILITIES,
  DEFAULT_GPU_INIT_OPTIONS,
} from './types'

// Capability detection
export {
  detectGPUCapabilities,
  isWebGPUAvailable,
  isImageSizeSupported,
  GPUCapabilityService,
  getGPUCapabilityService,
  resetGPUCapabilityService,
} from './capabilities'

// Adaptive processor
export {
  type AdaptiveProcessorConfig,
  type AdaptiveProcessorState,
  AdaptiveProcessor,
  getAdaptiveProcessor,
  resetAdaptiveProcessor,
} from './adaptive-processor'

// GPU Pipelines
export {
  AdjustmentsPipeline,
  getAdjustmentsPipeline,
  resetAdjustmentsPipeline,
  type BasicAdjustments,
  DEFAULT_BASIC_ADJUSTMENTS,
  ToneCurvePipeline,
  getToneCurvePipeline,
  resetToneCurvePipeline,
  type ToneCurveLut,
  createIdentityLut,
  isIdentityLut,
  MaskPipeline,
  getMaskPipeline,
  resetMaskPipeline,
  type GPUMaskAdjustments,
  type LinearMaskData,
  type RadialMaskData,
  type MaskStackInput,
  DEFAULT_GPU_MASK_ADJUSTMENTS,
  MAX_MASKS,
} from './pipelines'

// Texture utilities
export {
  TextureUsage,
  createTextureFromPixels,
  createOutputTexture,
  readTexturePixels,
  TexturePool,
  BufferPool,
  DoubleBufferedTextures,
  calculateDispatchSize,
} from './texture-utils'

// GPU adjustments service
export {
  GPUAdjustmentsService,
  getGPUAdjustmentsService,
  resetGPUAdjustmentsService,
  applyAdjustmentsAdaptive,
} from './gpu-adjustments-service'

// GPU tone curve service
export {
  GPUToneCurveService,
  getGPUToneCurveService,
  resetGPUToneCurveService,
  applyToneCurveAdaptive,
} from './gpu-tone-curve-service'

// GPU mask service
export {
  GPUMaskService,
  getGPUMaskService,
  resetGPUMaskService,
  applyMaskedAdjustmentsAdaptive,
} from './gpu-mask-service'
