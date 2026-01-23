/**
 * Unit tests for the AdaptiveProcessor.
 *
 * Tests the adaptive processing system including:
 * - Backend selection logic
 * - GPU/WASM execution routing
 * - Error handling and fallback
 * - Configuration options
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AdaptiveProcessor,
  getAdaptiveProcessor,
  resetAdaptiveProcessor,
} from './adaptive-processor'
import { resetGPUCapabilityService } from './capabilities'
import type { GPUOperation, ProcessingBackend } from './types'

// ============================================================================
// Mock WebGPU API
// ============================================================================

interface MockGPUDevice {
  features: Set<string>
  limits: Record<string, number>
  destroy: () => void
  lost: Promise<{ reason: string; message: string }>
  addEventListener: (event: string, callback: () => void) => void
}

let mockDevice: MockGPUDevice
let mockNavigator: { gpu?: { requestAdapter: () => Promise<unknown> } }

function createMockDevice(): MockGPUDevice {
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
    destroy: vi.fn(),
    lost: new Promise(() => {}),
    addEventListener: vi.fn(),
  }
}

function setupMockWebGPU(available: boolean = true) {
  mockDevice = createMockDevice()

  if (available) {
    mockNavigator = {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['float32-filterable']),
          limits: mockDevice.limits,
          info: {
            vendor: 'Test',
            architecture: 'Test',
            device: 'Test',
            description: 'Test',
          },
          requestDevice: vi.fn().mockResolvedValue(mockDevice),
        }),
      },
    }
  } else {
    mockNavigator = {}
  }

  vi.stubGlobal('navigator', mockNavigator)
}

beforeEach(() => {
  setupMockWebGPU(true)
  resetGPUCapabilityService()
  resetAdaptiveProcessor()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resetAdaptiveProcessor()
  resetGPUCapabilityService()
})

// ============================================================================
// Constructor and Configuration Tests
// ============================================================================

describe('AdaptiveProcessor constructor', () => {
  it('creates with default configuration', () => {
    const processor = new AdaptiveProcessor()

    expect(processor.state.initialized).toBe(false)
    expect(processor.state.gpuErrorCount).toBe(0)
    expect(processor.state.gpuDisabledDueToErrors).toBe(false)
  })

  it('accepts custom configuration', () => {
    const processor = new AdaptiveProcessor({
      forceBackend: 'wasm',
      logPerformance: true,
    })

    expect(processor.state.activeBackend).toBe('wasm')
  })

  it('configure updates options', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    processor.configure({ forceBackend: 'wasm' })

    expect(processor.state.activeBackend).toBe('wasm')
  })
})

// ============================================================================
// Initialization Tests
// ============================================================================

describe('initialize', () => {
  it('initializes GPU service', async () => {
    const processor = new AdaptiveProcessor()

    await processor.initialize()

    expect(processor.state.initialized).toBe(true)
  })

  it('sets activeBackend to webgpu when available', async () => {
    const processor = new AdaptiveProcessor()

    await processor.initialize()

    expect(processor.state.activeBackend).toBe('webgpu')
    expect(processor.state.capabilities.available).toBe(true)
  })

  it('sets activeBackend to wasm when GPU unavailable', async () => {
    setupMockWebGPU(false)
    const processor = new AdaptiveProcessor()

    await processor.initialize()

    expect(processor.state.activeBackend).toBe('wasm')
  })

  it('handles multiple initialize calls', async () => {
    const processor = new AdaptiveProcessor()

    await processor.initialize()
    await processor.initialize()

    expect(processor.state.initialized).toBe(true)
  })

  it('respects forceBackend wasm option', async () => {
    const processor = new AdaptiveProcessor({ forceBackend: 'wasm' })

    await processor.initialize()

    expect(processor.state.activeBackend).toBe('wasm')
  })
})

// ============================================================================
// Backend Availability Tests
// ============================================================================

describe('isBackendAvailable', () => {
  it('wasm is always available', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    expect(processor.isBackendAvailable('wasm')).toBe(true)
  })

  it('webgpu is available when GPU is ready', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    expect(processor.isBackendAvailable('webgpu')).toBe(true)
  })

  it('webgpu is unavailable when GPU not ready', async () => {
    setupMockWebGPU(false)
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    expect(processor.isBackendAvailable('webgpu')).toBe(false)
  })

  it('webgpu is unavailable when disabled due to errors', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    processor.disableGPU()

    expect(processor.isBackendAvailable('webgpu')).toBe(false)
  })

  it('webgpu is unavailable when forceBackend is wasm', async () => {
    const processor = new AdaptiveProcessor({ forceBackend: 'wasm' })
    await processor.initialize()

    expect(processor.isBackendAvailable('webgpu')).toBe(false)
  })
})

// ============================================================================
// Backend Selection Tests
// ============================================================================

describe('selectBackend', () => {
  it('selects webgpu when available and suitable', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 1920, 1080)

    expect(backend).toBe('webgpu')
  })

  it('selects wasm when forceBackend is wasm', async () => {
    const processor = new AdaptiveProcessor({ forceBackend: 'wasm' })
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 1920, 1080)

    expect(backend).toBe('wasm')
  })

  it('selects wasm when GPU disabled due to errors', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()
    processor.disableGPU()

    const backend = processor.selectBackend('adjustments', 1920, 1080)

    expect(backend).toBe('wasm')
  })

  it('selects wasm when operation is disabled for GPU', async () => {
    const processor = new AdaptiveProcessor({
      enabledOperations: { adjustments: false },
    })
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 1920, 1080)

    expect(backend).toBe('wasm')
  })

  it('selects wasm when image exceeds maxGPUDimension', async () => {
    const processor = new AdaptiveProcessor({ maxGPUDimension: 4096 })
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 5000, 3000)

    expect(backend).toBe('wasm')
  })

  it('selects wasm when image exceeds GPU texture limits', async () => {
    // Mock GPU with small texture limit
    mockDevice.limits.maxTextureDimension2D = 1024
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 2000, 2000)

    expect(backend).toBe('wasm')
  })

  it('selects webgpu for all enabled operations', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const operations: GPUOperation[] = [
      'adjustments',
      'toneCurve',
      'linearMask',
      'radialMask',
      'histogram',
      'resize',
      'rotation',
      'clipping',
    ]

    for (const op of operations) {
      const backend = processor.selectBackend(op, 1920, 1080)
      expect(backend).toBe('webgpu')
    }
  })
})

// ============================================================================
// Execute Tests
// ============================================================================

describe('execute', () => {
  it('executes with selected backend', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockResolvedValue('gpu-result')
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    const result = await processor.execute(
      'adjustments',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.data).toBe('gpu-result')
    expect(result.backend).toBe('webgpu')
    expect(gpuExecutor).toHaveBeenCalled()
    expect(wasmExecutor).not.toHaveBeenCalled()
  })

  it('uses wasm executor when GPU not available', async () => {
    const processor = new AdaptiveProcessor({ forceBackend: 'wasm' })
    await processor.initialize()

    const gpuExecutor = vi.fn().mockResolvedValue('gpu-result')
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    const result = await processor.execute(
      'adjustments',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.data).toBe('wasm-result')
    expect(result.backend).toBe('wasm')
    expect(wasmExecutor).toHaveBeenCalled()
    expect(gpuExecutor).not.toHaveBeenCalled()
  })

  it('falls back to wasm on GPU error', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockRejectedValue(new Error('GPU error'))
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    const result = await processor.execute(
      'adjustments',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.data).toBe('wasm-result')
    expect(result.backend).toBe('wasm')
    expect(gpuExecutor).toHaveBeenCalled()
    expect(wasmExecutor).toHaveBeenCalled()
  })

  it('increments error count on GPU failure', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockRejectedValue(new Error('GPU error'))
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    await processor.execute('adjustments', 1920, 1080, gpuExecutor, wasmExecutor)

    expect(processor.state.gpuErrorCount).toBe(1)
  })

  it('disables GPU after max errors', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockRejectedValue(new Error('GPU error'))
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    // Execute 3 times (MAX_GPU_ERRORS)
    for (let i = 0; i < 3; i++) {
      await processor.execute('adjustments', 1920, 1080, gpuExecutor, wasmExecutor)
    }

    expect(processor.state.gpuDisabledDueToErrors).toBe(true)
    expect(processor.state.gpuErrorCount).toBe(3)
  })

  it('resets error count on successful GPU execution', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    // First, cause an error
    const failingGpuExecutor = vi.fn().mockRejectedValue(new Error('GPU error'))
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    await processor.execute('adjustments', 1920, 1080, failingGpuExecutor, wasmExecutor)
    expect(processor.state.gpuErrorCount).toBe(1)

    // Then succeed
    const successGpuExecutor = vi.fn().mockResolvedValue('gpu-result')

    await processor.execute('adjustments', 1920, 1080, successGpuExecutor, wasmExecutor)
    expect(processor.state.gpuErrorCount).toBe(0)
  })

  it('includes timing in result', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockResolvedValue('gpu-result')
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    const result = await processor.execute(
      'adjustments',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.timing).toBeGreaterThanOrEqual(0)
  })

  it('logs performance when enabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const processor = new AdaptiveProcessor({ logPerformance: true })
    await processor.initialize()

    const gpuExecutor = vi.fn().mockResolvedValue('gpu-result')
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    await processor.execute('adjustments', 1920, 1080, gpuExecutor, wasmExecutor)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AdaptiveProcessor]'),
    )

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// executeSync Tests
// ============================================================================

describe('executeSync', () => {
  it('executes synchronous operations', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockReturnValue('gpu-result')
    const wasmExecutor = vi.fn().mockReturnValue('wasm-result')

    const result = processor.executeSync(
      'histogram',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.data).toBe('gpu-result')
    expect(result.backend).toBe('webgpu')
  })

  it('falls back to wasm on sync GPU error', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockImplementation(() => {
      throw new Error('GPU error')
    })
    const wasmExecutor = vi.fn().mockReturnValue('wasm-result')

    const result = processor.executeSync(
      'histogram',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.data).toBe('wasm-result')
    expect(result.backend).toBe('wasm')
  })

  it('tracks timing for sync operations', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const gpuExecutor = vi.fn().mockReturnValue('gpu-result')
    const wasmExecutor = vi.fn().mockReturnValue('wasm-result')

    const result = processor.executeSync(
      'histogram',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.timing).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Enable/Disable GPU Tests
// ============================================================================

describe('enableGPU and disableGPU', () => {
  it('disableGPU marks GPU as disabled', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    processor.disableGPU()

    expect(processor.state.gpuDisabledDueToErrors).toBe(true)
    expect(processor.state.activeBackend).toBe('wasm')
  })

  it('enableGPU re-enables GPU', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    processor.disableGPU()
    processor.enableGPU()

    expect(processor.state.gpuDisabledDueToErrors).toBe(false)
    expect(processor.state.gpuErrorCount).toBe(0)
    expect(processor.state.activeBackend).toBe('webgpu')
  })

  it('enableGPU resets error count', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    // Cause some errors
    const gpuExecutor = vi.fn().mockRejectedValue(new Error('GPU error'))
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    await processor.execute('adjustments', 1920, 1080, gpuExecutor, wasmExecutor)
    await processor.execute('adjustments', 1920, 1080, gpuExecutor, wasmExecutor)

    processor.enableGPU()

    expect(processor.state.gpuErrorCount).toBe(0)
  })
})

// ============================================================================
// Destroy Tests
// ============================================================================

describe('destroy', () => {
  it('resets all state', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    processor.destroy()

    expect(processor.state.initialized).toBe(false)
    expect(processor.state.gpuErrorCount).toBe(0)
    expect(processor.state.gpuDisabledDueToErrors).toBe(false)
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton management', () => {
  it('getAdaptiveProcessor returns same instance', () => {
    const proc1 = getAdaptiveProcessor()
    const proc2 = getAdaptiveProcessor()

    expect(proc1).toBe(proc2)
  })

  it('resetAdaptiveProcessor creates new instance', () => {
    const proc1 = getAdaptiveProcessor()
    resetAdaptiveProcessor()
    const proc2 = getAdaptiveProcessor()

    expect(proc1).not.toBe(proc2)
  })

  it('resetAdaptiveProcessor destroys previous instance', async () => {
    const proc = getAdaptiveProcessor()
    await proc.initialize()

    resetAdaptiveProcessor()

    // New instance should be uninitialized
    const newProc = getAdaptiveProcessor()
    expect(newProc.state.initialized).toBe(false)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles very large images', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    // Image larger than GPU supports
    const backend = processor.selectBackend('adjustments', 20000, 20000)

    expect(backend).toBe('wasm')
  })

  it('handles zero-size images', async () => {
    const processor = new AdaptiveProcessor()
    await processor.initialize()

    const backend = processor.selectBackend('adjustments', 0, 0)

    // Zero-size is within limits
    expect(backend).toBe('webgpu')
  })

  it('handles execution before initialization', async () => {
    const processor = new AdaptiveProcessor()

    // Not initialized - should use wasm
    const gpuExecutor = vi.fn().mockResolvedValue('gpu-result')
    const wasmExecutor = vi.fn().mockResolvedValue('wasm-result')

    const result = await processor.execute(
      'adjustments',
      1920,
      1080,
      gpuExecutor,
      wasmExecutor,
    )

    expect(result.backend).toBe('wasm')
  })

  it('handles all operations with WASM fallback', async () => {
    const processor = new AdaptiveProcessor({ forceBackend: 'wasm' })
    await processor.initialize()

    const operations: GPUOperation[] = [
      'adjustments',
      'toneCurve',
      'linearMask',
      'radialMask',
      'histogram',
      'resize',
      'rotation',
      'clipping',
    ]

    for (const op of operations) {
      const wasmExecutor = vi.fn().mockResolvedValue(`${op}-result`)
      const result = await processor.execute(
        op,
        1920,
        1080,
        vi.fn(),
        wasmExecutor,
      )

      expect(result.backend).toBe('wasm')
      expect(result.data).toBe(`${op}-result`)
    }
  })
})
