/**
 * Adaptive processor for routing image operations between GPU and WASM.
 *
 * This module provides a unified interface for image processing operations,
 * automatically selecting the best available backend (WebGPU or WASM) based
 * on device capabilities, image size, and operation type.
 *
 * Key features:
 * - Automatic backend selection based on capabilities
 * - Graceful fallback from GPU to WASM on errors
 * - Performance timing for benchmarking
 * - Per-operation routing control
 */

import type {
  ProcessingBackend,
  ProcessingResult,
  GPUOperation,
  GPUCapabilities,
} from './types'
import {
  GPUCapabilityService,
  getGPUCapabilityService,
  isImageSizeSupported,
} from './capabilities'

/**
 * Configuration for the adaptive processor.
 */
export interface AdaptiveProcessorConfig {
  /** Force a specific backend (null = auto-select) */
  forceBackend?: ProcessingBackend | null
  /** Enable GPU for specific operations (default: all enabled) */
  enabledOperations?: Partial<Record<GPUOperation, boolean>>
  /** Maximum image dimension for GPU processing (beyond this, use WASM) */
  maxGPUDimension?: number
  /** Enable performance logging */
  logPerformance?: boolean
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: AdaptiveProcessorConfig = {
  forceBackend: null,
  enabledOperations: {
    adjustments: true,
    toneCurve: true,
    linearMask: true,
    radialMask: true,
    histogram: true,
    resize: true,
    rotation: true,
    clipping: true,
  },
  maxGPUDimension: 8192,
  logPerformance: false,
}

/**
 * Adaptive processor state.
 */
export interface AdaptiveProcessorState {
  /** Whether the processor is initialized */
  initialized: boolean
  /** Current active backend */
  activeBackend: ProcessingBackend
  /** GPU capabilities (if available) */
  capabilities: GPUCapabilities
  /** Number of GPU errors encountered */
  gpuErrorCount: number
  /** Whether GPU has been disabled due to errors */
  gpuDisabledDueToErrors: boolean
}

/**
 * Adaptive processor for image operations.
 *
 * Routes operations to the best available backend based on
 * capabilities and configuration.
 */
export class AdaptiveProcessor {
  private _config: AdaptiveProcessorConfig
  private _gpuService: GPUCapabilityService
  private _initialized: boolean = false
  private _gpuErrorCount: number = 0
  private _gpuDisabledDueToErrors: boolean = false

  /** Maximum GPU errors before disabling GPU */
  private static readonly MAX_GPU_ERRORS = 3

  constructor(config: AdaptiveProcessorConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config }
    this._gpuService = getGPUCapabilityService()
  }

  /**
   * Get current processor state.
   */
  get state(): AdaptiveProcessorState {
    return {
      initialized: this._initialized,
      activeBackend: this._getActiveBackend(),
      capabilities: this._gpuService.capabilities,
      gpuErrorCount: this._gpuErrorCount,
      gpuDisabledDueToErrors: this._gpuDisabledDueToErrors,
    }
  }

  /**
   * Check if a specific backend is available.
   */
  isBackendAvailable(backend: ProcessingBackend): boolean {
    if (backend === 'wasm') {
      return true // WASM is always available
    }
    return (
      this._gpuService.isReady &&
      !this._gpuDisabledDueToErrors &&
      this._config.forceBackend !== 'wasm'
    )
  }

  /**
   * Initialize the processor.
   *
   * This initializes the GPU service and detects capabilities.
   * If GPU initialization fails, the processor will use WASM.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }

    console.log('[AdaptiveProcessor] Initializing...')

    // Initialize GPU service
    const capabilities = await this._gpuService.initialize({
      preferHighPerformance: true,
      allowFallbackAdapter: false,
      forceDisabled: this._config.forceBackend === 'wasm',
    })

    this._initialized = true

    const activeBackend = this._getActiveBackend()
    console.log(
      `[AdaptiveProcessor] Initialized with backend: ${activeBackend}`
    )

    if (capabilities.available) {
      console.log(
        `[AdaptiveProcessor] GPU: ${capabilities.adapterInfo?.vendor} ${capabilities.adapterInfo?.device}`
      )
      console.log(
        `[AdaptiveProcessor] Max texture size: ${capabilities.limits.maxTextureSize}`
      )
    }
  }

  /**
   * Update processor configuration.
   */
  configure(config: Partial<AdaptiveProcessorConfig>): void {
    this._config = { ...this._config, ...config }
  }

  /**
   * Select the best backend for an operation.
   *
   * @param operation - The operation type
   * @param imageWidth - Image width in pixels
   * @param imageHeight - Image height in pixels
   * @returns The selected backend
   */
  selectBackend(
    operation: GPUOperation,
    imageWidth: number,
    imageHeight: number
  ): ProcessingBackend {
    // Check if forced to a specific backend
    if (this._config.forceBackend) {
      return this._config.forceBackend
    }

    // Check if GPU is disabled due to errors
    if (this._gpuDisabledDueToErrors) {
      return 'wasm'
    }

    // Check if GPU is available
    if (!this._gpuService.isReady) {
      return 'wasm'
    }

    // Check if operation is enabled for GPU
    const enabledOps = this._config.enabledOperations ?? {}
    if (enabledOps[operation] === false) {
      return 'wasm'
    }

    // Check if image size is within limits
    const maxDim = this._config.maxGPUDimension ?? 8192
    if (imageWidth > maxDim || imageHeight > maxDim) {
      return 'wasm'
    }

    // Check GPU texture size limits
    const capabilities = this._gpuService.capabilities
    if (!isImageSizeSupported(imageWidth, imageHeight, capabilities)) {
      return 'wasm'
    }

    return 'webgpu'
  }

  /**
   * Execute an operation with the appropriate backend.
   *
   * This method handles backend selection, execution, timing,
   * and fallback on errors.
   *
   * @param operation - The operation type
   * @param imageWidth - Image width
   * @param imageHeight - Image height
   * @param gpuExecutor - Function to execute on GPU
   * @param wasmExecutor - Function to execute on WASM
   * @returns Processing result with timing and backend info
   */
  async execute<T>(
    operation: GPUOperation,
    imageWidth: number,
    imageHeight: number,
    gpuExecutor: () => Promise<T>,
    wasmExecutor: () => Promise<T>
  ): Promise<ProcessingResult<T>> {
    const selectedBackend = this.selectBackend(operation, imageWidth, imageHeight)
    const startTime = performance.now()

    if (selectedBackend === 'webgpu') {
      try {
        const data = await gpuExecutor()
        return this._buildGPUSuccessResult(data, operation, startTime)
      } catch (error) {
        this._handleGPUError(operation, error)
        const data = await wasmExecutor()
        return this._buildWASMFallbackResult(data, operation, startTime)
      }
    } else {
      const data = await wasmExecutor()
      return this._buildWASMResult(data, operation, startTime)
    }
  }

  /**
   * Execute a synchronous operation with the appropriate backend.
   */
  executeSync<T>(
    operation: GPUOperation,
    imageWidth: number,
    imageHeight: number,
    gpuExecutor: () => T,
    wasmExecutor: () => T
  ): ProcessingResult<T> {
    const selectedBackend = this.selectBackend(operation, imageWidth, imageHeight)
    const startTime = performance.now()

    if (selectedBackend === 'webgpu') {
      try {
        const data = gpuExecutor()
        return this._buildGPUSuccessResult(data, operation, startTime)
      } catch (error) {
        this._handleGPUError(operation, error)
        const data = wasmExecutor()
        return this._buildWASMFallbackResult(data, operation, startTime)
      }
    } else {
      const data = wasmExecutor()
      return this._buildWASMResult(data, operation, startTime)
    }
  }

  /**
   * Build a success result for GPU execution.
   */
  private _buildGPUSuccessResult<T>(
    data: T,
    operation: GPUOperation,
    startTime: number
  ): ProcessingResult<T> {
    const timing = performance.now() - startTime
    this._logPerformance(operation, 'GPU', timing)
    this._gpuErrorCount = 0
    return { data, backend: 'webgpu', timing }
  }

  /**
   * Build a result for WASM fallback after GPU error.
   */
  private _buildWASMFallbackResult<T>(
    data: T,
    operation: GPUOperation,
    startTime: number
  ): ProcessingResult<T> {
    const timing = performance.now() - startTime
    this._logPerformance(operation, 'WASM fallback', timing)
    return { data, backend: 'wasm', timing }
  }

  /**
   * Build a result for direct WASM execution.
   */
  private _buildWASMResult<T>(
    data: T,
    operation: GPUOperation,
    startTime: number
  ): ProcessingResult<T> {
    const timing = performance.now() - startTime
    this._logPerformance(operation, 'WASM', timing)
    return { data, backend: 'wasm', timing }
  }

  /**
   * Handle a GPU execution error.
   */
  private _handleGPUError(operation: GPUOperation, error: unknown): void {
    console.error(`[AdaptiveProcessor] GPU ${operation} failed:`, error)
    this._gpuErrorCount++

    if (this._gpuErrorCount >= AdaptiveProcessor.MAX_GPU_ERRORS) {
      console.warn(
        `[AdaptiveProcessor] Too many GPU errors (${this._gpuErrorCount}), disabling GPU`
      )
      this._gpuDisabledDueToErrors = true
    }

    console.log(`[AdaptiveProcessor] Falling back to WASM for ${operation}`)
  }

  /**
   * Log performance timing if enabled.
   */
  private _logPerformance(operation: GPUOperation, backend: string, timing: number): void {
    if (this._config.logPerformance) {
      console.log(`[AdaptiveProcessor] ${operation} (${backend}): ${timing.toFixed(2)}ms`)
    }
  }

  /**
   * Re-enable GPU after it was disabled due to errors.
   * Useful for retry mechanisms or user-triggered recovery.
   */
  enableGPU(): void {
    this._gpuDisabledDueToErrors = false
    this._gpuErrorCount = 0
    console.log('[AdaptiveProcessor] GPU re-enabled')
  }

  /**
   * Manually disable GPU.
   */
  disableGPU(): void {
    this._gpuDisabledDueToErrors = true
    console.log('[AdaptiveProcessor] GPU manually disabled')
  }

  /**
   * Destroy the processor and release resources.
   */
  destroy(): void {
    this._gpuService.destroy()
    this._initialized = false
    this._gpuErrorCount = 0
    this._gpuDisabledDueToErrors = false
  }

  /**
   * Get the currently active backend.
   */
  private _getActiveBackend(): ProcessingBackend {
    if (this._config.forceBackend) {
      return this._config.forceBackend
    }
    if (this._gpuDisabledDueToErrors) {
      return 'wasm'
    }
    if (this._gpuService.isReady) {
      return 'webgpu'
    }
    return 'wasm'
  }
}

/**
 * Singleton instance of the adaptive processor.
 */
let _adaptiveProcessor: AdaptiveProcessor | null = null

/**
 * Get or create the adaptive processor singleton.
 */
export function getAdaptiveProcessor(): AdaptiveProcessor {
  if (!_adaptiveProcessor) {
    _adaptiveProcessor = new AdaptiveProcessor()
  }
  return _adaptiveProcessor
}

/**
 * Reset the adaptive processor singleton (for testing).
 */
export function resetAdaptiveProcessor(): void {
  if (_adaptiveProcessor) {
    _adaptiveProcessor.destroy()
    _adaptiveProcessor = null
  }
}
