/// <reference types="@webgpu/types" />
/**
 * WebGPU capability detection service.
 *
 * Detects WebGPU availability, queries device capabilities and limits,
 * and provides information about the GPU hardware.
 */

import {
  type GPUCapabilities,
  type GPUInitOptions,
  type GPUServiceState,
  type GPUErrorCode,
  DEFAULT_GPU_CAPABILITIES,
  DEFAULT_GPU_INIT_OPTIONS,
  GPUError,
} from './types'

/**
 * Extended GPU adapter info interface.
 * WebGPU spec changed how adapter info is accessed.
 */
interface GPUAdapterInfoLike {
  vendor: string
  architecture: string
  device: string
  description: string
}

/**
 * Extended GPUAdapter interface with experimental properties.
 * The standard @webgpu/types may not include all browser-implemented features.
 */
interface ExtendedGPUAdapter {
  readonly features: GPUSupportedFeatures
  readonly limits: GPUSupportedLimits
  readonly info: GPUAdapterInfoLike
  readonly isFallbackAdapter?: boolean
  requestAdapterInfo?: () => Promise<GPUAdapterInfoLike>
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>
}

/**
 * Build a GPUCapabilities object from device and adapter info.
 */
function buildCapabilities(
  device: GPUDevice,
  adapterInfo: GPUAdapterInfoLike,
  isFallbackAdapter: boolean
): GPUCapabilities {
  const limits = device.limits
  const features = device.features

  return {
    available: true,
    backend: 'webgpu',
    isFallbackAdapter,
    adapterInfo: {
      vendor: adapterInfo.vendor || 'Unknown',
      architecture: adapterInfo.architecture || 'Unknown',
      device: adapterInfo.device || 'Unknown',
      description: adapterInfo.description || 'Unknown',
    },
    limits: {
      maxTextureSize: limits.maxTextureDimension2D,
      maxBufferSize: Number(limits.maxStorageBufferBindingSize),
      maxComputeWorkgroupSize: Math.min(
        limits.maxComputeWorkgroupSizeX,
        limits.maxComputeWorkgroupSizeY,
        limits.maxComputeWorkgroupSizeZ
      ),
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    },
    features: {
      float32Filtering: features.has('float32-filterable'),
      textureCompressionBC: features.has('texture-compression-bc'),
    },
  }
}

/**
 * Get adapter info from an extended adapter (handles different API versions).
 */
async function getAdapterInfo(
  adapter: ExtendedGPUAdapter
): Promise<GPUAdapterInfoLike> {
  return adapter.requestAdapterInfo
    ? await adapter.requestAdapterInfo()
    : adapter.info
}

/**
 * Detect WebGPU capabilities.
 *
 * This function attempts to initialize WebGPU and query the device
 * capabilities. If WebGPU is not available or initialization fails,
 * it returns default capabilities with `available: false`.
 *
 * @param options - Initialization options
 * @returns GPU capabilities
 */
export async function detectGPUCapabilities(
  options: GPUInitOptions = {}
): Promise<GPUCapabilities> {
  const opts = { ...DEFAULT_GPU_INIT_OPTIONS, ...options }

  // Check if forced disabled
  if (opts.forceDisabled) {
    return {
      ...DEFAULT_GPU_CAPABILITIES,
      backend: 'wasm',
    }
  }

  // Check if WebGPU is available
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      ...DEFAULT_GPU_CAPABILITIES,
      backend: 'wasm',
    }
  }

  try {
    // Request adapter
    const adapter = (await navigator.gpu.requestAdapter({
      powerPreference: opts.preferHighPerformance
        ? 'high-performance'
        : 'low-power',
    })) as ExtendedGPUAdapter | null

    if (!adapter) {
      return {
        ...DEFAULT_GPU_CAPABILITIES,
        backend: 'wasm',
      }
    }

    // Check for fallback adapter
    const isFallback = adapter.isFallbackAdapter ?? false
    if (isFallback && !opts.allowFallbackAdapter) {
      return {
        ...DEFAULT_GPU_CAPABILITIES,
        backend: 'wasm',
        isFallbackAdapter: true,
      }
    }

    const adapterInfo = await getAdapterInfo(adapter)

    // Request device to get accurate limits (temporary - just for querying)
    const device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    })

    const capabilities = buildCapabilities(device, adapterInfo, isFallback)

    // Destroy the test device
    device.destroy()

    return capabilities
  } catch (error) {
    console.warn('WebGPU capability detection failed:', error)
    return {
      ...DEFAULT_GPU_CAPABILITIES,
      backend: 'wasm',
    }
  }
}

/**
 * Check if an image size is supported by the GPU.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param capabilities - GPU capabilities
 * @returns True if the image can be processed on GPU
 */
export function isImageSizeSupported(
  width: number,
  height: number,
  capabilities: GPUCapabilities
): boolean {
  if (!capabilities.available) {
    return false
  }

  const maxSize = capabilities.limits.maxTextureSize
  return width <= maxSize && height <= maxSize
}

/**
 * Check if WebGPU is available in the current environment.
 *
 * This is a quick synchronous check that doesn't initialize anything.
 * For full capability detection, use `detectGPUCapabilities()`.
 *
 * @returns True if WebGPU API is available
 */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * GPU service for managing WebGPU device lifecycle.
 *
 * This service handles:
 * - WebGPU initialization
 * - Device creation and management
 * - Device loss recovery
 * - Graceful degradation to WASM
 */
export class GPUCapabilityService {
  private _state: GPUServiceState = {
    status: 'uninitialized',
    capabilities: { ...DEFAULT_GPU_CAPABILITIES },
  }

  private _device: GPUDevice | null = null
  private _adapter: GPUAdapter | null = null
  private _options: GPUInitOptions = { ...DEFAULT_GPU_INIT_OPTIONS }

  /**
   * Get current service state.
   */
  get state(): GPUServiceState {
    return { ...this._state }
  }

  /**
   * Get current capabilities.
   */
  get capabilities(): GPUCapabilities {
    return { ...this._state.capabilities }
  }

  /**
   * Check if GPU is available and ready.
   */
  get isReady(): boolean {
    return this._state.status === 'ready' && this._device !== null
  }

  /**
   * Get the GPU device (if available).
   */
  get device(): GPUDevice | null {
    return this._device
  }

  /**
   * Initialize the GPU service.
   *
   * @param options - Initialization options
   * @returns The detected capabilities
   */
  async initialize(options: GPUInitOptions = {}): Promise<GPUCapabilities> {
    this._options = { ...DEFAULT_GPU_INIT_OPTIONS, ...options }

    // Check if forced disabled
    if (this._options.forceDisabled) {
      this._state = {
        status: 'disabled',
        capabilities: {
          ...DEFAULT_GPU_CAPABILITIES,
          backend: 'wasm',
        },
      }
      return this._state.capabilities
    }

    this._state = {
      status: 'initializing',
      capabilities: { ...DEFAULT_GPU_CAPABILITIES },
    }

    // Check WebGPU availability
    if (!isWebGPUAvailable()) {
      this._state = {
        status: 'error',
        error: 'WebGPU not supported in this browser',
        capabilities: {
          ...DEFAULT_GPU_CAPABILITIES,
          backend: 'wasm',
        },
      }
      return this._state.capabilities
    }

    try {
      // Request adapter
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: this._options.preferHighPerformance
          ? 'high-performance'
          : 'low-power',
      })

      if (!adapter) {
        throw new GPUError('No suitable GPU adapter found', 'ADAPTER_NOT_FOUND')
      }

      this._adapter = adapter

      // Cast to extended adapter for checking fallback
      const extAdapter = adapter as unknown as ExtendedGPUAdapter
      const isFallback = extAdapter.isFallbackAdapter ?? false

      // Check for fallback adapter
      if (isFallback && !this._options.allowFallbackAdapter) {
        throw new GPUError(
          'Only fallback (software) adapter available',
          'ADAPTER_NOT_FOUND'
        )
      }

      const adapterInfo = await getAdapterInfo(extAdapter)

      // Request device
      this._device = await this._adapter.requestDevice({
        requiredFeatures: [],
        requiredLimits: {},
      })

      // Set up device loss handling
      this._setupDeviceLossHandling()

      // Set up error handling
      this._setupErrorHandling()

      // Update state with capabilities
      this._state = {
        status: 'ready',
        capabilities: buildCapabilities(this._device, adapterInfo, isFallback),
      }

      console.log(
        '[GPUCapabilityService] Initialized successfully:',
        this._state.capabilities.adapterInfo
      )

      return this._state.capabilities
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorCode: GPUErrorCode =
        error instanceof GPUError ? error.code : 'INTERNAL_ERROR'

      console.warn('[GPUCapabilityService] Initialization failed:', errorMessage)

      this._state = {
        status: 'error',
        error: errorMessage,
        capabilities: {
          ...DEFAULT_GPU_CAPABILITIES,
          backend: 'wasm',
        },
      }

      return this._state.capabilities
    }
  }

  /**
   * Destroy the GPU service and release resources.
   */
  destroy(): void {
    if (this._device) {
      this._device.destroy()
      this._device = null
    }
    this._adapter = null
    this._state = {
      status: 'uninitialized',
      capabilities: { ...DEFAULT_GPU_CAPABILITIES },
    }
  }

  /**
   * Attempt to recover from device loss.
   *
   * @returns True if recovery was successful
   */
  async recover(): Promise<boolean> {
    console.log('[GPUCapabilityService] Attempting device recovery...')

    // Destroy old resources
    if (this._device) {
      this._device.destroy()
      this._device = null
    }
    this._adapter = null

    // Re-initialize
    const caps = await this.initialize(this._options)
    return caps.available
  }

  /**
   * Set up device loss handling.
   */
  private _setupDeviceLossHandling(): void {
    if (!this._device) return

    this._device.lost.then(async (info) => {
      console.warn(
        '[GPUCapabilityService] Device lost:',
        info.reason,
        info.message
      )

      // Update state
      this._state = {
        status: 'error',
        error: `Device lost: ${info.reason}`,
        capabilities: {
          ...this._state.capabilities,
          available: false,
          backend: 'wasm',
        },
      }

      // Attempt recovery for non-destroyed devices
      if (info.reason !== 'destroyed') {
        const recovered = await this.recover()
        if (!recovered) {
          console.warn(
            '[GPUCapabilityService] Recovery failed, using WASM fallback'
          )
        }
      }
    })
  }

  /**
   * Set up error handling.
   */
  private _setupErrorHandling(): void {
    if (!this._device) return

    this._device.addEventListener('uncapturederror', (event) => {
      console.error(
        '[GPUCapabilityService] Uncaptured GPU error:',
        (event as GPUUncapturedErrorEvent).error.message
      )
    })
  }
}

/**
 * Singleton instance of the GPU capability service.
 */
let _gpuService: GPUCapabilityService | null = null

/**
 * Get or create the GPU capability service singleton.
 */
export function getGPUCapabilityService(): GPUCapabilityService {
  if (!_gpuService) {
    _gpuService = new GPUCapabilityService()
  }
  return _gpuService
}

/**
 * Reset the GPU capability service singleton (for testing).
 */
export function resetGPUCapabilityService(): void {
  if (_gpuService) {
    _gpuService.destroy()
    _gpuService = null
  }
}
