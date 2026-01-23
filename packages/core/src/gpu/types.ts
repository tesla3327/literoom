/**
 * GPU acceleration types for WebGPU-based image processing.
 *
 * This module defines the interfaces for GPU capability detection,
 * processing backends, and the adaptive processor that routes operations
 * between GPU and WASM paths.
 */

/**
 * Available processing backends.
 * - webgpu: Best performance, requires WebGPU support
 * - wasm: Guaranteed to work, moderate performance
 */
export type ProcessingBackend = 'webgpu' | 'wasm'

/**
 * GPU device capabilities and limits.
 */
export interface GPUCapabilities {
  /** Whether WebGPU is available and initialized */
  available: boolean
  /** The backend currently in use */
  backend: ProcessingBackend
  /** Whether using a software/fallback adapter (slower) */
  isFallbackAdapter: boolean
  /** GPU adapter info (vendor, architecture) */
  adapterInfo?: {
    vendor: string
    architecture: string
    device: string
    description: string
  }
  /** Device limits */
  limits: {
    /** Maximum texture dimension (width/height) */
    maxTextureSize: number
    /** Maximum storage buffer binding size in bytes */
    maxBufferSize: number
    /** Maximum compute workgroup size per dimension */
    maxComputeWorkgroupSize: number
    /** Maximum compute workgroups per dimension */
    maxComputeWorkgroupsPerDimension: number
  }
  /** Supported features */
  features: {
    /** Whether float32 texture filtering is supported */
    float32Filtering: boolean
    /** Whether BC texture compression is supported */
    textureCompressionBC: boolean
  }
}

/**
 * Default capabilities when WebGPU is not available.
 */
export const DEFAULT_GPU_CAPABILITIES: GPUCapabilities = {
  available: false,
  backend: 'wasm',
  isFallbackAdapter: false,
  limits: {
    maxTextureSize: 0,
    maxBufferSize: 0,
    maxComputeWorkgroupSize: 0,
    maxComputeWorkgroupsPerDimension: 0,
  },
  features: {
    float32Filtering: false,
    textureCompressionBC: false,
  },
}

/**
 * GPU service state.
 */
export interface GPUServiceState {
  /** Current status of the GPU service */
  status: 'uninitialized' | 'initializing' | 'ready' | 'error' | 'disabled'
  /** Error message if status is 'error' */
  error?: string
  /** Detected capabilities */
  capabilities: GPUCapabilities
}

/**
 * Error codes for GPU operations.
 */
export type GPUErrorCode =
  | 'NOT_SUPPORTED'
  | 'ADAPTER_NOT_FOUND'
  | 'DEVICE_CREATION_FAILED'
  | 'DEVICE_LOST'
  | 'OUT_OF_MEMORY'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'DISABLED'

/**
 * Error thrown by GPU operations.
 */
export class GPUError extends Error {
  override readonly name = 'GPUError'

  constructor(
    message: string,
    public readonly code: GPUErrorCode,
    override readonly cause?: Error
  ) {
    super(message, { cause })
  }
}

/**
 * Options for GPU service initialization.
 */
export interface GPUInitOptions {
  /** Prefer high-performance GPU over power-saving */
  preferHighPerformance?: boolean
  /** Accept software/fallback adapters */
  allowFallbackAdapter?: boolean
  /** Force disable GPU (use WASM only) */
  forceDisabled?: boolean
}

/**
 * Default initialization options.
 */
export const DEFAULT_GPU_INIT_OPTIONS: GPUInitOptions = {
  preferHighPerformance: true,
  allowFallbackAdapter: false,
  forceDisabled: false,
}

/**
 * Processing operation types that can be routed to GPU.
 */
export type GPUOperation =
  | 'adjustments'
  | 'toneCurve'
  | 'linearMask'
  | 'radialMask'
  | 'histogram'
  | 'resize'
  | 'rotation'
  | 'clipping'

/**
 * Result of an adaptive processor operation.
 */
export interface ProcessingResult<T> {
  /** The processed data */
  data: T
  /** Which backend was used */
  backend: ProcessingBackend
  /** Processing time in milliseconds */
  timing: number
}
