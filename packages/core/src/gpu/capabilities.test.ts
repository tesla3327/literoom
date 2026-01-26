/**
 * Unit tests for GPU capability detection.
 *
 * Tests WebGPU capability detection and the GPUCapabilityService including:
 * - Capability detection
 * - Image size validation
 * - Service lifecycle
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  detectGPUCapabilities,
  isImageSizeSupported,
  isWebGPUAvailable,
  GPUCapabilityService,
  getGPUCapabilityService,
  resetGPUCapabilityService,
} from './capabilities'
import {
  DEFAULT_GPU_CAPABILITIES,
  type GPUCapabilities,
} from './types'

// ============================================================================
// Mock WebGPU API
// ============================================================================

interface MockGPUAdapter {
  features: Set<string>
  limits: Record<string, number>
  info: {
    vendor: string
    architecture: string
    device: string
    description: string
  }
  isFallbackAdapter?: boolean
  requestDevice: () => Promise<MockGPUDevice>
}

interface MockGPUDevice {
  features: Set<string>
  limits: Record<string, number>
  destroy: () => void
  lost: Promise<{ reason: string; message: string }>
  addEventListener: (event: string, callback: () => void) => void
}

let mockAdapter: MockGPUAdapter | null = null
let mockDevice: MockGPUDevice | null = null
let mockNavigator: { gpu?: { requestAdapter: () => Promise<MockGPUAdapter | null> } }

function createMockDevice(options: { subgroups?: boolean; shaderF16?: boolean } = {}): MockGPUDevice {
  let lostResolve: (info: { reason: string; message: string }) => void
  const lostPromise = new Promise<{ reason: string; message: string }>((resolve) => {
    lostResolve = resolve
  })

  const features = new Set<string>(['float32-filterable'])
  if (options.subgroups) features.add('subgroups')
  if (options.shaderF16) features.add('shader-f16')

  return {
    features,
    limits: {
      maxTextureDimension2D: 8192,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    destroy: vi.fn(),
    lost: lostPromise,
    addEventListener: vi.fn(),
  }
}

function createMockAdapter(overrides?: Partial<MockGPUAdapter>): MockGPUAdapter {
  mockDevice = createMockDevice()

  return {
    features: new Set(['float32-filterable']),
    limits: {
      maxTextureDimension2D: 8192,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    info: {
      vendor: 'Test Vendor',
      architecture: 'Test Architecture',
      device: 'Test Device',
      description: 'Test Description',
    },
    isFallbackAdapter: false,
    requestDevice: vi.fn().mockResolvedValue(mockDevice),
    ...overrides,
  }
}

beforeEach(() => {
  mockAdapter = createMockAdapter()
  mockNavigator = {
    gpu: {
      requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
    },
  }

  // Mock global navigator
  vi.stubGlobal('navigator', mockNavigator)

  // Reset singleton
  resetGPUCapabilityService()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resetGPUCapabilityService()
})

// ============================================================================
// isWebGPUAvailable Tests
// ============================================================================

describe('isWebGPUAvailable', () => {
  it('returns true when navigator.gpu exists', () => {
    expect(isWebGPUAvailable()).toBe(true)
  })

  it('returns false when navigator.gpu is undefined', () => {
    vi.stubGlobal('navigator', {})
    expect(isWebGPUAvailable()).toBe(false)
  })

  it('returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isWebGPUAvailable()).toBe(false)
  })
})

// ============================================================================
// detectGPUCapabilities Tests
// ============================================================================

describe('detectGPUCapabilities', () => {
  it('returns capabilities when WebGPU is available', async () => {
    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(true)
    expect(caps.backend).toBe('webgpu')
  })

  it('returns adapter info', async () => {
    const caps = await detectGPUCapabilities()

    expect(caps.adapterInfo).toEqual({
      vendor: 'Test Vendor',
      architecture: 'Test Architecture',
      device: 'Test Device',
      description: 'Test Description',
    })
  })

  it('returns device limits', async () => {
    const caps = await detectGPUCapabilities()

    expect(caps.limits.maxTextureSize).toBe(8192)
    expect(caps.limits.maxBufferSize).toBe(128 * 1024 * 1024)
    expect(caps.limits.maxComputeWorkgroupSize).toBe(64) // Min of X, Y, Z
    expect(caps.limits.maxComputeWorkgroupsPerDimension).toBe(65535)
  })

  it('returns feature support', async () => {
    const caps = await detectGPUCapabilities()

    expect(caps.features.float32Filtering).toBe(true)
    expect(caps.features.textureCompressionBC).toBe(false)
    expect(caps.features.shaderF16).toBe(false)
  })

  it('returns WASM fallback when forceDisabled is true', async () => {
    const caps = await detectGPUCapabilities({ forceDisabled: true })

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
  })

  it('returns WASM fallback when WebGPU is not available', async () => {
    vi.stubGlobal('navigator', {})

    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
  })

  it('returns WASM fallback when adapter is null', async () => {
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(null)

    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
  })

  it('rejects fallback adapter by default', async () => {
    mockAdapter = createMockAdapter({ isFallbackAdapter: true })
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
    expect(caps.isFallbackAdapter).toBe(true)
  })

  it('accepts fallback adapter when allowed', async () => {
    mockAdapter = createMockAdapter({ isFallbackAdapter: true })
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const caps = await detectGPUCapabilities({ allowFallbackAdapter: true })

    expect(caps.available).toBe(true)
    expect(caps.isFallbackAdapter).toBe(true)
  })

  it('requests high-performance adapter by default', async () => {
    await detectGPUCapabilities()

    expect(mockNavigator.gpu!.requestAdapter).toHaveBeenCalledWith({
      powerPreference: 'high-performance',
    })
  })

  it('requests low-power adapter when specified', async () => {
    await detectGPUCapabilities({ preferHighPerformance: false })

    expect(mockNavigator.gpu!.requestAdapter).toHaveBeenCalledWith({
      powerPreference: 'low-power',
    })
  })

  it('handles adapter errors gracefully', async () => {
    mockNavigator.gpu!.requestAdapter = vi.fn().mockRejectedValue(new Error('GPU error'))

    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
  })

  it('destroys test device after querying', async () => {
    await detectGPUCapabilities()

    expect(mockDevice!.destroy).toHaveBeenCalled()
  })
})

// ============================================================================
// isImageSizeSupported Tests
// ============================================================================

describe('isImageSizeSupported', () => {
  const capabilities: GPUCapabilities = {
    ...DEFAULT_GPU_CAPABILITIES,
    available: true,
    limits: {
      ...DEFAULT_GPU_CAPABILITIES.limits,
      maxTextureSize: 8192,
    },
  }

  it('returns true for image within limits', () => {
    expect(isImageSizeSupported(1920, 1080, capabilities)).toBe(true)
  })

  it('returns true for image at exact limit', () => {
    expect(isImageSizeSupported(8192, 8192, capabilities)).toBe(true)
  })

  it('returns false for image exceeding width limit', () => {
    expect(isImageSizeSupported(10000, 1080, capabilities)).toBe(false)
  })

  it('returns false for image exceeding height limit', () => {
    expect(isImageSizeSupported(1920, 10000, capabilities)).toBe(false)
  })

  it('returns false for image exceeding both dimensions', () => {
    expect(isImageSizeSupported(10000, 10000, capabilities)).toBe(false)
  })

  it('returns false when GPU not available', () => {
    const unavailable: GPUCapabilities = {
      ...DEFAULT_GPU_CAPABILITIES,
      available: false,
    }
    expect(isImageSizeSupported(1920, 1080, unavailable)).toBe(false)
  })
})

// ============================================================================
// GPUCapabilityService Tests
// ============================================================================

describe('GPUCapabilityService', () => {
  let service: GPUCapabilityService

  beforeEach(() => {
    service = new GPUCapabilityService()
  })

  afterEach(() => {
    service.destroy()
  })

  describe('initial state', () => {
    it('has uninitialized status', () => {
      expect(service.state.status).toBe('uninitialized')
    })

    it('has default capabilities', () => {
      expect(service.capabilities.available).toBe(false)
      expect(service.capabilities.backend).toBe('wasm')
    })

    it('is not ready', () => {
      expect(service.isReady).toBe(false)
    })

    it('has no device', () => {
      expect(service.device).toBeNull()
    })
  })

  describe('initialize', () => {
    it('initializes successfully with WebGPU', async () => {
      const caps = await service.initialize()

      expect(caps.available).toBe(true)
      expect(service.state.status).toBe('ready')
      expect(service.isReady).toBe(true)
    })

    it('returns capabilities', async () => {
      const caps = await service.initialize()

      expect(caps.adapterInfo?.vendor).toBe('Test Vendor')
      expect(caps.limits.maxTextureSize).toBe(8192)
    })

    it('sets disabled status when forceDisabled', async () => {
      const caps = await service.initialize({ forceDisabled: true })

      expect(caps.available).toBe(false)
      expect(service.state.status).toBe('disabled')
    })

    it('sets error status when WebGPU unavailable', async () => {
      vi.stubGlobal('navigator', {})

      await service.initialize()

      expect(service.state.status).toBe('error')
      expect(service.state.error).toBeDefined()
    })

    it('sets error status when adapter not found', async () => {
      mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(null)

      await service.initialize()

      expect(service.state.status).toBe('error')
    })

    it('provides device when ready', async () => {
      await service.initialize()

      expect(service.device).not.toBeNull()
    })
  })

  describe('destroy', () => {
    it('destroys device', async () => {
      await service.initialize()
      const device = service.device

      service.destroy()

      expect(device!.destroy).toHaveBeenCalled()
    })

    it('resets state', async () => {
      await service.initialize()
      service.destroy()

      expect(service.state.status).toBe('uninitialized')
      expect(service.device).toBeNull()
    })
  })

  describe('recover', () => {
    it('attempts to re-initialize', async () => {
      await service.initialize()
      service.destroy()

      const recovered = await service.recover()

      expect(recovered).toBe(true)
      expect(service.isReady).toBe(true)
    })

    it('returns false when recovery fails', async () => {
      await service.initialize()
      vi.stubGlobal('navigator', {})

      const recovered = await service.recover()

      expect(recovered).toBe(false)
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton management', () => {
  it('getGPUCapabilityService returns same instance', () => {
    const service1 = getGPUCapabilityService()
    const service2 = getGPUCapabilityService()

    expect(service1).toBe(service2)
  })

  it('resetGPUCapabilityService creates new instance', () => {
    const service1 = getGPUCapabilityService()
    resetGPUCapabilityService()
    const service2 = getGPUCapabilityService()

    expect(service1).not.toBe(service2)
  })

  it('resetGPUCapabilityService destroys previous instance', async () => {
    const service = getGPUCapabilityService()
    await service.initialize()
    const device = service.device

    resetGPUCapabilityService()

    expect(device!.destroy).toHaveBeenCalled()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles missing adapter info gracefully', async () => {
    mockAdapter = createMockAdapter({
      info: {
        vendor: '',
        architecture: '',
        device: '',
        description: '',
      },
    })
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const caps = await detectGPUCapabilities()

    // Empty strings get replaced with 'Unknown' in the implementation
    expect(caps.adapterInfo?.vendor).toBe('Unknown')
  })

  it('handles device creation failure', async () => {
    mockAdapter!.requestDevice = vi.fn().mockRejectedValue(new Error('Device creation failed'))

    const caps = await detectGPUCapabilities()

    expect(caps.available).toBe(false)
    expect(caps.backend).toBe('wasm')
  })

  it('handles zero limits', async () => {
    mockDevice = {
      ...createMockDevice(),
      limits: {
        maxTextureDimension2D: 0,
        maxStorageBufferBindingSize: 0,
        maxComputeWorkgroupSizeX: 0,
        maxComputeWorkgroupSizeY: 0,
        maxComputeWorkgroupSizeZ: 0,
        maxComputeWorkgroupsPerDimension: 0,
      },
    }
    mockAdapter!.requestDevice = vi.fn().mockResolvedValue(mockDevice)

    const caps = await detectGPUCapabilities()

    expect(caps.limits.maxTextureSize).toBe(0)
    expect(caps.limits.maxComputeWorkgroupSize).toBe(0)
  })

  it('handles feature set without optional features', async () => {
    mockDevice = {
      ...createMockDevice(),
      features: new Set<string>(),
    }
    mockAdapter!.requestDevice = vi.fn().mockResolvedValue(mockDevice)

    const caps = await detectGPUCapabilities()

    expect(caps.features.float32Filtering).toBe(false)
    expect(caps.features.textureCompressionBC).toBe(false)
    expect(caps.features.shaderF16).toBe(false)
  })

  it('detects and requests shader-f16 feature when available', async () => {
    mockAdapter = createMockAdapter({
      features: new Set(['float32-filterable', 'shader-f16']),
    })
    mockDevice = {
      ...createMockDevice({ shaderF16: true }),
      features: new Set(['float32-filterable', 'shader-f16']),
    }
    mockAdapter.requestDevice = vi.fn().mockResolvedValue(mockDevice)
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const caps = await detectGPUCapabilities()

    expect(caps.features.shaderF16).toBe(true)
    expect(mockAdapter.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ['shader-f16'],
      requiredLimits: {},
    })
  })
})

// ============================================================================
// Subgroups Detection Tests
// ============================================================================

describe('Subgroups Detection', () => {
  it('should detect subgroups feature when available', async () => {
    // Mock adapter with subgroups support
    mockAdapter = createMockAdapter({
      features: new Set(['subgroups']),
    })
    mockDevice = createMockDevice({ subgroups: true })
    mockAdapter.requestDevice = vi.fn().mockResolvedValue(mockDevice)
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const service = new GPUCapabilityService()
    const caps = await service.initialize()

    expect(caps.features.subgroups).toBe(true)
  })

  it('should not detect subgroups when unavailable', async () => {
    mockAdapter = createMockAdapter({
      features: new Set<string>(),
    })
    mockDevice = createMockDevice({ subgroups: false })
    mockAdapter.requestDevice = vi.fn().mockResolvedValue(mockDevice)
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const service = new GPUCapabilityService()
    const caps = await service.initialize()

    expect(caps.features.subgroups).toBe(false)
  })

  it('should request subgroups feature when available', async () => {
    mockDevice = createMockDevice({ subgroups: true })
    mockAdapter = createMockAdapter({
      features: new Set(['subgroups']),
    })
    mockAdapter.requestDevice = vi.fn().mockResolvedValue(mockDevice)
    mockNavigator.gpu!.requestAdapter = vi.fn().mockResolvedValue(mockAdapter)

    const service = new GPUCapabilityService()
    await service.initialize()

    expect(mockAdapter.requestDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredFeatures: expect.arrayContaining(['subgroups']),
      })
    )
  })
})
