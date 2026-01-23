/**
 * Unit tests for GPUToneCurveService.
 *
 * Tests the GPU-accelerated tone curve service including:
 * - Service initialization and lifecycle
 * - Tone curve LUT application
 * - Identity LUT optimization
 * - Adaptive backend selection
 * - Error handling and fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GPUToneCurveService,
  getGPUToneCurveService,
  resetGPUToneCurveService,
  applyToneCurveAdaptive,
  createIdentityLut,
  isIdentityLut,
  type ToneCurveLut,
} from './gpu-tone-curve-service'
import { resetGPUCapabilityService, getGPUCapabilityService } from './capabilities'
import { resetAdaptiveProcessor, getAdaptiveProcessor } from './adaptive-processor'

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock the capabilities module
vi.mock('./capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: true,
    device: createMockDevice(),
  })),
  resetGPUCapabilityService: vi.fn(),
}))

// Mock the adaptive processor
vi.mock('./adaptive-processor', () => ({
  getAdaptiveProcessor: vi.fn(() => ({
    execute: vi.fn().mockImplementation(
      async (
        _op: string,
        _w: number,
        _h: number,
        gpuFn: () => Promise<any>,
        _wasmFn: () => any
      ) => {
        try {
          const data = await gpuFn()
          return { data, backend: 'webgpu', timing: 1 }
        } catch {
          return { data: new Uint8Array(0), backend: 'wasm', timing: 1 }
        }
      }
    ),
  })),
  resetAdaptiveProcessor: vi.fn(),
}))

// Mock the tone curve pipeline
vi.mock('./pipelines/tone-curve-pipeline', () => ({
  ToneCurvePipeline: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
      // Simulate LUT application
      return pixels.slice()
    }),
    destroy: vi.fn(),
  })),
  getToneCurvePipeline: vi.fn(),
  createIdentityLut: vi.fn(() => ({
    lut: new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
  })),
  isIdentityLut: vi.fn((lut: ToneCurveLut) => {
    for (let i = 0; i < 256; i++) {
      if (lut.lut[i] !== i) return false
    }
    return true
  }),
}))

// Create mock GPU device
function createMockDevice(): any {
  return {
    createShaderModule: vi.fn(),
    createComputePipeline: vi.fn(),
    createBindGroupLayout: vi.fn(),
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
      mapAsync: vi.fn(),
      getMappedRange: vi.fn(() => new ArrayBuffer(0)),
      unmap: vi.fn(),
    })),
    createTexture: vi.fn(() => ({
      destroy: vi.fn(),
      createView: vi.fn(),
    })),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      submit: vi.fn(),
    },
  }
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestRgbPixels(width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const pixels = new Uint8Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 3] = 128 // R
    pixels[i * 3 + 1] = 64 // G
    pixels[i * 3 + 2] = 192 // B
  }
  return pixels
}

function createTestRgbaPixels(width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const pixels = new Uint8Array(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 4] = 128 // R
    pixels[i * 4 + 1] = 64 // G
    pixels[i * 4 + 2] = 192 // B
    pixels[i * 4 + 3] = 255 // A
  }
  return pixels
}

function createIdentityLutFixture(): ToneCurveLut {
  return {
    lut: new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
  }
}

function createInvertLut(): ToneCurveLut {
  return {
    lut: new Uint8Array(Array.from({ length: 256 }, (_, i) => 255 - i)),
  }
}

function createContrastLut(): ToneCurveLut {
  // S-curve that increases contrast
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    const y = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)
    lut[i] = Math.round(y * 255)
  }
  return { lut }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetGPUToneCurveService()
})

afterEach(() => {
  vi.clearAllMocks()
  resetGPUToneCurveService()
})

// ============================================================================
// GPUToneCurveService Tests
// ============================================================================

describe('GPUToneCurveService', () => {
  describe('constructor', () => {
    it('creates service with device', () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      expect(service).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('initializes the pipeline', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      await service.initialize()

      // Pipeline should be created
      expect(service.getPipeline()).toBeDefined()
    })

    it('handles multiple initialize calls', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      await service.initialize()
      await service.initialize()

      // Should not throw
      expect(service.getPipeline()).toBeDefined()
    })
  })

  describe('applyToneCurve (RGB)', () => {
    it('throws error when not initialized', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      await expect(service.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'not initialized'
      )
    })

    it('returns copy for identity LUT', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(pixels, 2, 2, lut)

      expect(result.length).toBe(pixels.length)
      expect(result).not.toBe(pixels) // Should be a copy
    })

    it('applies non-identity LUT', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      const result = await service.applyToneCurve(pixels, 2, 2, lut)

      expect(result.length).toBe(2 * 2 * 3) // RGB output
    })
  })

  describe('applyToneCurveRgba', () => {
    it('throws error when not initialized', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      const pixels = createTestRgbaPixels(2, 2)
      const lut = createContrastLut()

      await expect(
        service.applyToneCurveRgba(pixels, 2, 2, lut)
      ).rejects.toThrow('not initialized')
    })

    it('applies LUT to RGBA pixels directly', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      const lut = createContrastLut()

      const result = await service.applyToneCurveRgba(pixels, 2, 2, lut)

      expect(result.length).toBe(2 * 2 * 4) // RGBA output
    })
  })

  describe('destroy', () => {
    it('destroys pipeline', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      service.destroy()

      expect(service.getPipeline()).toBeNull()
    })
  })
})

// ============================================================================
// Identity LUT Helper Tests
// ============================================================================

describe('identity LUT helpers', () => {
  describe('createIdentityLut', () => {
    it('creates a 256-entry identity LUT', () => {
      const lut = createIdentityLut()

      expect(lut.lut.length).toBe(256)
    })
  })

  describe('isIdentityLut', () => {
    it('returns true for identity LUT', () => {
      const lut = createIdentityLutFixture()

      expect(isIdentityLut(lut)).toBe(true)
    })

    it('returns false for non-identity LUT', () => {
      const lut = createInvertLut()

      expect(isIdentityLut(lut)).toBe(false)
    })

    it('returns false for contrast LUT', () => {
      const lut = createContrastLut()

      expect(isIdentityLut(lut)).toBe(false)
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton management', () => {
  it('getGPUToneCurveService returns null when GPU not ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as any)

    const service = await getGPUToneCurveService()

    expect(service).toBeNull()
  })

  it('getGPUToneCurveService returns service when GPU ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: createMockDevice(),
    } as any)

    const service = await getGPUToneCurveService()

    expect(service).not.toBeNull()
  })

  it('resetGPUToneCurveService destroys existing service', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: createMockDevice(),
    } as any)

    const service = await getGPUToneCurveService()
    expect(service).not.toBeNull()

    resetGPUToneCurveService()

    // Next call should create a new service
    const service2 = await getGPUToneCurveService()
    expect(service2).not.toBe(service)
  })
})

// ============================================================================
// Adaptive Processing Tests
// ============================================================================

describe('applyToneCurveAdaptive', () => {
  it('returns copy for identity LUT', async () => {
    const pixels = createTestRgbPixels(2, 2)
    const lut = createIdentityLutFixture()
    const wasmFallback = vi.fn()

    const result = await applyToneCurveAdaptive(
      pixels,
      2,
      2,
      lut,
      wasmFallback
    )

    expect(result.length).toBe(pixels.length)
    expect(result).not.toBe(pixels) // Should be a copy
    expect(wasmFallback).not.toHaveBeenCalled()
  })

  it('uses adaptive processor for non-identity LUT', async () => {
    const mockProcessor = {
      execute: vi.fn().mockResolvedValue({
        data: new Uint8Array(12),
        backend: 'webgpu',
        timing: 1,
      }),
    }
    vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

    const pixels = createTestRgbPixels(2, 2)
    const lut = createContrastLut()
    const wasmFallback = vi.fn()

    await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

    expect(mockProcessor.execute).toHaveBeenCalledWith(
      'toneCurve',
      2,
      2,
      expect.any(Function),
      expect.any(Function)
    )
  })
})

// ============================================================================
// RGB/RGBA Conversion Tests
// ============================================================================

describe('RGB/RGBA conversion in tone curve', () => {
  it('converts RGB to RGBA for pipeline', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    // Single pixel: R=100, G=150, B=200
    const rgbPixels = new Uint8Array([100, 150, 200])
    const lut = createContrastLut()

    const result = await service.applyToneCurve(rgbPixels, 1, 1, lut)

    // Should return RGB (3 bytes)
    expect(result.length).toBe(3)
  })

  it('preserves alpha when processing RGBA', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    // Single pixel: R=100, G=150, B=200, A=128
    const rgbaPixels = new Uint8Array([100, 150, 200, 128])
    const lut = createIdentityLutFixture()

    // For identity, we should get a copy
    const result = await service.applyToneCurveRgba(rgbaPixels, 1, 1, lut)

    // Identity returns copy of input
    expect(result.length).toBe(4)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles empty pixel array', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    const pixels = new Uint8Array(0)
    const lut = createIdentityLutFixture()

    const result = await service.applyToneCurve(pixels, 0, 0, lut)

    expect(result.length).toBe(0)
  })

  it('handles single pixel', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    const pixels = new Uint8Array([128, 128, 128])
    const lut = createIdentityLutFixture()

    const result = await service.applyToneCurve(pixels, 1, 1, lut)

    expect(result.length).toBe(3)
  })

  it('handles extreme LUT values', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    // LUT that maps everything to 0
    const zeroLut: ToneCurveLut = {
      lut: new Uint8Array(256).fill(0),
    }

    const pixels = new Uint8Array([255, 255, 255])

    const result = await service.applyToneCurve(pixels, 1, 1, zeroLut)

    expect(result.length).toBe(3)
  })

  it('handles LUT that maps everything to 255', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    const maxLut: ToneCurveLut = {
      lut: new Uint8Array(256).fill(255),
    }

    const pixels = new Uint8Array([0, 0, 0])

    const result = await service.applyToneCurve(pixels, 1, 1, maxLut)

    expect(result.length).toBe(3)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('performance optimizations', () => {
  it('skips processing for identity LUT', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    const pipeline = service.getPipeline()
    const applySpy = vi.spyOn(pipeline!, 'apply')

    const pixels = createTestRgbPixels(100, 100)
    const lut = createIdentityLutFixture()

    await service.applyToneCurve(pixels, 100, 100, lut)

    // Should not call pipeline.apply for identity
    expect(applySpy).not.toHaveBeenCalled()
  })

  it('processes non-identity LUT through pipeline', async () => {
    const device = createMockDevice()
    const service = new GPUToneCurveService(device)
    await service.initialize()

    const pipeline = service.getPipeline()
    const applySpy = vi.spyOn(pipeline!, 'apply')

    const pixels = createTestRgbPixels(2, 2)
    const lut = createContrastLut()

    await service.applyToneCurve(pixels, 2, 2, lut)

    expect(applySpy).toHaveBeenCalled()
  })
})
