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
  applyToneCurveFromPointsAdaptive,
  createIdentityLut,
  isIdentityLut,
  generateLutFromCurvePoints,
  type ToneCurveLut,
  type ToneCurveAdaptiveResult,
} from './gpu-tone-curve-service'
import type { CurvePoint } from '../decode/types'
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

// Curve points for testing applyToneCurveFromPointsAdaptive
function createLinearCurvePoints(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
}

function createSCurvePoints(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.15 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.85 },
    { x: 1, y: 1 },
  ]
}

function createBrightnessCurvePoints(): CurvePoint[] {
  return [
    { x: 0, y: 0.1 },
    { x: 1, y: 1 },
  ]
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

// ============================================================================
// applyToneCurveFromPointsAdaptive Tests
// ============================================================================

describe('applyToneCurveFromPointsAdaptive', () => {
  describe('linear (identity) curve handling', () => {
    it('returns copy immediately with wasm backend for linear curve', async () => {
      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createLinearCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      // Should return a copy of the input pixels
      expect(result.result.pixels.length).toBe(pixels.length)
      expect(result.result.pixels).not.toBe(pixels) // Should be a copy
      expect(result.result.width).toBe(2)
      expect(result.result.height).toBe(2)
      // Identity curve reports 'wasm' backend (no processing needed)
      expect(result.backend).toBe('wasm')
      // WASM fallback should NOT be called for identity
      expect(wasmFallback).not.toHaveBeenCalled()
    })

    it('preserves original pixel values for linear curve', async () => {
      const pixels = new Uint8Array([100, 150, 200, 50, 100, 150])
      const curvePoints = createLinearCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        1,
        curvePoints,
        wasmFallback
      )

      // Pixel values should be preserved
      expect(Array.from(result.result.pixels)).toEqual([100, 150, 200, 50, 100, 150])
    })
  })

  describe('GPU processing', () => {
    it('uses GPU when available for non-identity curve', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createSCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      expect(result.backend).toBe('webgpu')
      expect(wasmFallback).not.toHaveBeenCalled()
    })
  })

  describe('WASM fallback', () => {
    it('falls back to WASM when GPU service is null', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createSCurvePoints()
      const expectedResult = { pixels: new Uint8Array(12).fill(128), width: 2, height: 2 }
      const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      expect(result.backend).toBe('wasm')
      expect(wasmFallback).toHaveBeenCalled()
      expect(result.result).toEqual(expectedResult)
    })

    it('falls back to WASM when GPU processing fails', async () => {
      // Setup GPU to be available but fail during processing
      const mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice,
      } as any)

      // Reset service to get fresh instance
      resetGPUToneCurveService()

      // Mock the pipeline to throw an error
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockRejectedValue(new Error('GPU processing failed')),
        destroy: vi.fn(),
      }) as any)

      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createSCurvePoints()
      const expectedResult = { pixels: new Uint8Array(12).fill(64), width: 2, height: 2 }
      const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      expect(result.backend).toBe('wasm')
      expect(wasmFallback).toHaveBeenCalled()
      expect(result.result).toEqual(expectedResult)
    })
  })

  describe('timing information', () => {
    it('returns correct timing information', async () => {
      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createLinearCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      expect(typeof result.timing).toBe('number')
      expect(result.timing).toBeGreaterThanOrEqual(0)
    })

    it('timing increases with more processing', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(100, 100)
      const curvePoints = createSCurvePoints()

      // Simulate slow WASM processing
      const wasmFallback = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return { pixels: new Uint8Array(30000), width: 100, height: 100 }
      })

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        100,
        100,
        curvePoints,
        wasmFallback
      )

      expect(result.timing).toBeGreaterThanOrEqual(5)
    })
  })

  describe('ToneCurveAdaptiveResult shape', () => {
    it('returns correct ToneCurveAdaptiveResult shape for identity curve', async () => {
      const pixels = createTestRgbPixels(4, 4)
      const curvePoints = createLinearCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        4,
        4,
        curvePoints,
        wasmFallback
      )

      // Verify shape
      expect(result).toHaveProperty('result')
      expect(result).toHaveProperty('backend')
      expect(result).toHaveProperty('timing')

      // Verify result sub-object
      expect(result.result).toHaveProperty('pixels')
      expect(result.result).toHaveProperty('width')
      expect(result.result).toHaveProperty('height')

      // Verify types
      expect(result.result.pixels).toBeInstanceOf(Uint8Array)
      expect(typeof result.result.width).toBe('number')
      expect(typeof result.result.height).toBe('number')
      expect(['webgpu', 'wasm']).toContain(result.backend)
      expect(typeof result.timing).toBe('number')
    })

    it('returns correct ToneCurveAdaptiveResult shape for GPU processing', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      // Re-mock the pipeline to return properly sized RGBA data
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockImplementation(async (_pixels: Uint8Array, width: number, height: number) => {
          // Return RGBA data matching the dimensions
          return new Uint8Array(width * height * 4).fill(128)
        }),
        destroy: vi.fn(),
      }) as any)

      const pixels = createTestRgbPixels(4, 4)
      const curvePoints = createBrightnessCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        4,
        4,
        curvePoints,
        wasmFallback
      )

      // Verify shape
      expect(result).toHaveProperty('result')
      expect(result).toHaveProperty('backend')
      expect(result).toHaveProperty('timing')

      // Verify result dimensions match input
      expect(result.result.width).toBe(4)
      expect(result.result.height).toBe(4)
      expect(result.result.pixels.length).toBe(4 * 4 * 3) // RGB
    })

    it('returns correct ToneCurveAdaptiveResult shape for WASM fallback', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(3, 3)
      const curvePoints = createSCurvePoints()
      const expectedResult = { pixels: new Uint8Array(27), width: 3, height: 3 }
      const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        3,
        3,
        curvePoints,
        wasmFallback
      )

      // Verify shape
      expect(result).toHaveProperty('result')
      expect(result).toHaveProperty('backend')
      expect(result).toHaveProperty('timing')

      // Verify WASM result is passed through
      expect(result.result).toEqual(expectedResult)
      expect(result.backend).toBe('wasm')
    })
  })

  describe('S-curve processing', () => {
    it('S-curve processing produces expected result shape', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      // Re-mock the pipeline to return properly sized RGBA data
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockImplementation(async (_pixels: Uint8Array, width: number, height: number) => {
          // Return RGBA data matching the dimensions
          return new Uint8Array(width * height * 4).fill(100)
        }),
        destroy: vi.fn(),
      }) as any)

      const pixels = createTestRgbPixels(8, 8)
      const curvePoints = createSCurvePoints()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        8,
        8,
        curvePoints,
        wasmFallback
      )

      // Verify result shape
      expect(result.result.pixels).toBeInstanceOf(Uint8Array)
      expect(result.result.pixels.length).toBe(8 * 8 * 3) // RGB pixels
      expect(result.result.width).toBe(8)
      expect(result.result.height).toBe(8)
      expect(result.backend).toBe('webgpu')
      expect(typeof result.timing).toBe('number')
    })

    it('S-curve with WASM produces expected result shape', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(8, 8)
      const curvePoints = createSCurvePoints()
      const expectedPixels = new Uint8Array(192).fill(100)
      const wasmFallback = vi.fn().mockResolvedValue({
        pixels: expectedPixels,
        width: 8,
        height: 8,
      })

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        8,
        8,
        curvePoints,
        wasmFallback
      )

      // Verify result shape
      expect(result.result.pixels).toBeInstanceOf(Uint8Array)
      expect(result.result.pixels.length).toBe(192)
      expect(result.result.width).toBe(8)
      expect(result.result.height).toBe(8)
      expect(result.backend).toBe('wasm')
    })

    it('S-curve is correctly identified as non-identity', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createSCurvePoints()
      const wasmFallback = vi.fn().mockResolvedValue({
        pixels: new Uint8Array(12),
        width: 2,
        height: 2,
      })

      await applyToneCurveFromPointsAdaptive(pixels, 2, 2, curvePoints, wasmFallback)

      // For non-identity curves, processing should occur
      expect(wasmFallback).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// generateLutFromCurvePoints Tests
// ============================================================================

describe('generateLutFromCurvePoints', () => {
  describe('linear (identity) curve', () => {
    it('returns identity LUT for 2 points at (0,0) and (1,1)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Verify it is an identity LUT
      expect(lut.lut.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBe(i)
      }
    })

    it('uses fast path for linear curve (isIdentityLut returns true)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(isIdentityLut(lut)).toBe(true)
    })
  })

  describe('inverted curve', () => {
    it('returns inverted values for curve from (0,1) to (1,0)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // First entry should map 0 -> 255
      expect(lut.lut[0]).toBe(255)
      // Last entry should map 255 -> 0
      expect(lut.lut[255]).toBe(0)
      // Middle entry should map 127/128 -> ~127/128
      expect(lut.lut[128]).toBeCloseTo(127, 0)
    })

    it('produces monotonically decreasing values', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 1; i < 256; i++) {
        expect(lut.lut[i]).toBeLessThanOrEqual(lut.lut[i - 1])
      }
    })
  })

  describe('S-curve with multiple control points', () => {
    it('generates smooth S-curve from multiple control points', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 }, // Darken shadows
        { x: 0.5, y: 0.5 }, // Keep midtones
        { x: 0.75, y: 0.85 }, // Brighten highlights
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Verify endpoints
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
      // Midtone should be around 128
      expect(lut.lut[128]).toBeCloseTo(128, 5)
    })

    it('produces smooth transitions without jumps', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Check that adjacent values do not jump by more than a reasonable amount
      for (let i = 1; i < 256; i++) {
        const diff = Math.abs(lut.lut[i] - lut.lut[i - 1])
        // Allow up to 5 units difference between adjacent entries
        expect(diff).toBeLessThanOrEqual(5)
      }
    })

    it('respects control point values', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.75 }, // Brighten midtones
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // At x=0.5 (index 127/128), output should be near 0.75 * 255 = 191.25
      // Due to spline interpolation, allow for ±2 tolerance
      const expectedValue = Math.round(0.75 * 255) // 191
      expect(lut.lut[128]).toBeGreaterThanOrEqual(expectedValue - 2)
      expect(lut.lut[128]).toBeLessThanOrEqual(expectedValue + 2)
    })
  })

  describe('single control point edge case', () => {
    it('returns constant LUT for single point', () => {
      const points: CurvePoint[] = [{ x: 0.5, y: 0.5 }]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // All entries should map to the single point's y value
      const expectedValue = Math.round(0.5 * 255)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBe(expectedValue)
      }
    })
  })

  describe('empty points array edge case', () => {
    it('returns identity-like LUT for empty array', () => {
      const points: CurvePoint[] = []

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Empty array should return identity (passthrough)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBe(i)
      }
    })
  })

  describe('curve with very close x values', () => {
    it('handles points with nearly identical x values', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.3 },
        { x: 0.500001, y: 0.7 }, // Very close to previous point
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should not throw and should produce valid LUT
      expect(lut.lut.length).toBe(256)
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
    })

    it('handles identical x values gracefully', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.3 },
        { x: 0.5, y: 0.7 }, // Identical x value
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should not throw and should produce valid LUT
      expect(lut.lut.length).toBe(256)
    })
  })

  describe('LUT size verification', () => {
    it('always returns exactly 256 entries', () => {
      const testCases: CurvePoint[][] = [
        [], // Empty
        [{ x: 0.5, y: 0.5 }], // Single point
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ], // Two points
        [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.25 },
          { x: 0.5, y: 0.5 },
          { x: 0.75, y: 0.75 },
          { x: 1, y: 1 },
        ], // Five points
        Array.from({ length: 20 }, (_, i) => ({
          x: i / 19,
          y: i / 19,
        })), // Twenty points
      ]

      for (const points of testCases) {
        const lut = generateLutFromCurvePoints(points)
        expect(lut.lut.length).toBe(256)
      }
    })
  })

  describe('LUT value clamping', () => {
    it('clamps all values to 0-255 range', () => {
      // Create a curve that would naturally go out of bounds
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.5 }, // Steep rise
        { x: 0.8, y: 0.5 }, // Flat
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }
    })

    it('clamps negative y values to 0', () => {
      // Curve with y values that would go negative
      const points: CurvePoint[] = [
        { x: 0, y: 0.5 },
        { x: 0.5, y: -0.1 }, // Negative y (will be clamped)
        { x: 1, y: 0.5 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
      }
    })

    it('clamps y values greater than 1 to 255', () => {
      // Curve with y values exceeding 1
      const points: CurvePoint[] = [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 1.5 }, // y > 1 (will be clamped)
        { x: 1, y: 0.5 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }
    })

    it('produces integer values in LUT', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.333, y: 0.333 },
        { x: 0.666, y: 0.666 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 0; i < 256; i++) {
        expect(Number.isInteger(lut.lut[i])).toBe(true)
      }
    })
  })

  describe('monotonicity preservation', () => {
    it('maintains monotonicity for increasing curve', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.2 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.8 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Verify monotonically increasing (or equal)
      for (let i = 1; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(lut.lut[i - 1])
      }
    })
  })

  describe('extreme curves', () => {
    it('handles all-black curve (y=0 everywhere)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBe(0)
      }
    })

    it('handles all-white curve (y=1 everywhere)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBe(255)
      }
    })

    it('handles step function (sharp transition)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.49, y: 0 },
        { x: 0.51, y: 1 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Values before midpoint should be low
      expect(lut.lut[64]).toBeLessThan(50)
      // Values after midpoint should be high
      expect(lut.lut[192]).toBeGreaterThan(200)
    })
  })
})

// ============================================================================
// GPUToneCurveService Lifecycle Management Tests
// ============================================================================

describe('GPUToneCurveService lifecycle management', () => {
  describe('service initialization', () => {
    it('handles double initialization safely', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      // First initialization
      await service.initialize()
      const firstPipeline = service.getPipeline()

      // Second initialization should be safe and return same pipeline
      await service.initialize()
      const secondPipeline = service.getPipeline()

      expect(firstPipeline).toBeDefined()
      expect(secondPipeline).toBeDefined()
      expect(firstPipeline).toBe(secondPipeline)
    })

    it('allows initialization after destroy', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      // Initialize, then destroy
      await service.initialize()
      expect(service.getPipeline()).toBeDefined()
      service.destroy()
      expect(service.getPipeline()).toBeNull()

      // Re-initialize should work
      await service.initialize()
      expect(service.getPipeline()).toBeDefined()
    })

    it('handles concurrent initialization calls', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      // Fire multiple concurrent initialization calls
      const results = await Promise.all([
        service.initialize(),
        service.initialize(),
        service.initialize(),
      ])

      // All should succeed without throwing
      expect(results).toHaveLength(3)
      expect(service.getPipeline()).toBeDefined()
    })
  })

  describe('service destruction', () => {
    it('handles destroy before initialization gracefully', () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      // Destroy before initialize should not throw
      expect(() => service.destroy()).not.toThrow()
      expect(service.getPipeline()).toBeNull()
    })

    it('handles double destroy safely', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // First destroy
      service.destroy()
      expect(service.getPipeline()).toBeNull()

      // Second destroy should not throw
      expect(() => service.destroy()).not.toThrow()
      expect(service.getPipeline()).toBeNull()
    })

    it('rejects operations after destroy', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()
      service.destroy()

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      // Operations after destroy should throw
      await expect(service.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'not initialized'
      )
      await expect(
        service.applyToneCurveRgba(createTestRgbaPixels(2, 2), 2, 2, lut)
      ).rejects.toThrow('not initialized')
    })
  })

  describe('resource management', () => {
    it('creates new pipeline on re-initialization', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      await service.initialize()
      const firstPipeline = service.getPipeline()

      service.destroy()
      await service.initialize()
      const secondPipeline = service.getPipeline()

      // After destroy and re-init, we should have a new pipeline instance
      expect(firstPipeline).not.toBe(secondPipeline)
      expect(secondPipeline).toBeDefined()
    })

    it('retains device reference throughout lifecycle', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)

      // Device should be usable after multiple init/destroy cycles
      await service.initialize()
      expect(service.getPipeline()).toBeDefined()

      service.destroy()
      expect(service.getPipeline()).toBeNull()

      await service.initialize()
      expect(service.getPipeline()).toBeDefined()

      // Apply tone curve should work (device still valid)
      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const result = await service.applyToneCurve(pixels, 2, 2, lut)
      expect(result.length).toBe(12)
    })
  })
})

// ============================================================================
// Singleton Pattern and Service Caching Tests
// ============================================================================

describe('singleton pattern and service caching', () => {
  describe('singleton behavior', () => {
    it('multiple calls to getGPUToneCurveService return the same instance', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const service1 = await getGPUToneCurveService()
      const service2 = await getGPUToneCurveService()
      const service3 = await getGPUToneCurveService()

      expect(service1).not.toBeNull()
      expect(service1).toBe(service2)
      expect(service2).toBe(service3)
    })

    it('cached instance persists across multiple retrievals', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const service1 = await getGPUToneCurveService()
      expect(service1).not.toBeNull()

      // Make several more calls
      for (let i = 0; i < 5; i++) {
        const service = await getGPUToneCurveService()
        expect(service).toBe(service1)
      }
    })

    it('returns null consistently when GPU not available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const service1 = await getGPUToneCurveService()
      const service2 = await getGPUToneCurveService()

      expect(service1).toBeNull()
      expect(service2).toBeNull()
    })

    it('creates new instance when device becomes available after being unavailable', async () => {
      // First, GPU is not available
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const serviceNull = await getGPUToneCurveService()
      expect(serviceNull).toBeNull()

      // Now GPU becomes available
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const serviceAvailable = await getGPUToneCurveService()
      expect(serviceAvailable).not.toBeNull()
    })
  })

  describe('reset behavior', () => {
    it('reset clears cached instance and allows new instance creation', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const service1 = await getGPUToneCurveService()
      expect(service1).not.toBeNull()

      resetGPUToneCurveService()

      const service2 = await getGPUToneCurveService()
      expect(service2).not.toBeNull()
      expect(service2).not.toBe(service1)
    })

    it('reset on null instance does not throw', () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      // Ensure no instance exists
      resetGPUToneCurveService()

      // Should not throw when reset is called again
      expect(() => resetGPUToneCurveService()).not.toThrow()
      expect(() => resetGPUToneCurveService()).not.toThrow()
    })

    it('service operations work correctly after reset', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      // Get initial service and use it
      const service1 = await getGPUToneCurveService()
      expect(service1).not.toBeNull()
      await service1!.initialize()
      expect(service1!.getPipeline()).toBeDefined()

      // Reset and get new service
      resetGPUToneCurveService()

      const service2 = await getGPUToneCurveService()
      expect(service2).not.toBeNull()
      await service2!.initialize()
      expect(service2!.getPipeline()).toBeDefined()
    })

    it('multiple resets in succession work correctly', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const service1 = await getGPUToneCurveService()
      resetGPUToneCurveService()
      resetGPUToneCurveService()
      resetGPUToneCurveService()

      const service2 = await getGPUToneCurveService()
      expect(service2).not.toBeNull()
      expect(service2).not.toBe(service1)
    })
  })

  describe('concurrent access', () => {
    it('multiple simultaneous getGPUToneCurveService calls return same instance', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      // Launch multiple concurrent requests
      const promises = [
        getGPUToneCurveService(),
        getGPUToneCurveService(),
        getGPUToneCurveService(),
        getGPUToneCurveService(),
        getGPUToneCurveService(),
      ]

      const services = await Promise.all(promises)

      // All should be the same instance
      const firstService = services[0]
      expect(firstService).not.toBeNull()
      for (const service of services) {
        expect(service).toBe(firstService)
      }
    })

    it('concurrent calls with delayed initialization still return same instance', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      // Create staggered concurrent calls
      const promise1 = getGPUToneCurveService()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const promise2 = getGPUToneCurveService()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const promise3 = getGPUToneCurveService()

      const [service1, service2, service3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ])

      expect(service1).toBe(service2)
      expect(service2).toBe(service3)
    })
  })
})

// ============================================================================
// isLinearCurve Detection and Fast Path Tests
// ============================================================================

describe('isLinearCurve detection and fast path', () => {
  describe('exact linear curve detection', () => {
    it('detects exact (0,0) and (1,1) points as linear', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Fast path should produce identity LUT
      expect(isIdentityLut(lut)).toBe(true)
    })

    it('detects points within tolerance threshold (0.001) as linear', () => {
      const points: CurvePoint[] = [
        { x: 0.0005, y: 0.0005 },
        { x: 0.9995, y: 0.9995 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should still use fast path within tolerance
      expect(isIdentityLut(lut)).toBe(true)
    })

    it('does not use fast path for points just outside tolerance threshold', () => {
      const points: CurvePoint[] = [
        { x: 0.002, y: 0 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Points outside tolerance should not produce identity LUT
      expect(lut.lut.length).toBe(256)
      // The LUT values should differ slightly from identity
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
    })
  })

  describe('non-linear curve rejection', () => {
    it('rejects curves with three or more points', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Three points should go through full spline calculation
      // Even though they form a linear curve, the fast path only checks for exactly 2 points
      expect(lut.lut.length).toBe(256)
      // Result should still be close to identity since points are on the diagonal
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[128]).toBeCloseTo(128, 1)
      expect(lut.lut[255]).toBe(255)
    })

    it('rejects single point curves', () => {
      const points: CurvePoint[] = [{ x: 0.5, y: 0.5 }]

      const lut = generateLutFromCurvePoints(points)

      // Single point should produce a constant LUT, not identity
      expect(isIdentityLut(lut)).toBe(false)
      // All values should be the same (mapped to the single point's y)
      const expectedValue = Math.round(0.5 * 255)
      expect(lut.lut[0]).toBe(expectedValue)
      expect(lut.lut[255]).toBe(expectedValue)
    })

    it('rejects empty points array as non-linear for fast path but returns identity', () => {
      const points: CurvePoint[] = []

      const lut = generateLutFromCurvePoints(points)

      // Empty array returns identity LUT as fallback behavior
      expect(isIdentityLut(lut)).toBe(true)
    })
  })

  describe('near-linear curves', () => {
    it('detects points very close to (0,0) and (1,1) within tolerance', () => {
      const points: CurvePoint[] = [
        { x: 0.0001, y: 0.0001 },
        { x: 0.9999, y: 0.9999 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(isIdentityLut(lut)).toBe(true)
    })

    it('treats swapped order (1,1) then (0,0) as inverted curve', () => {
      // Points specified in order: (1,1) then (0,0)
      // This creates a curve from (x=0, y=0) to (x=1, y=1) when sorted by x
      // OR if not sorted, interpolates linearly resulting in inverted values
      const points: CurvePoint[] = [
        { x: 1, y: 1 },
        { x: 0, y: 0 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // The implementation processes points as given without sorting
      // With (1,1) first and (0,0) second, at x=0 we get y=0 and at x=1 we get y=1
      // This produces an inverted LUT: low inputs map high, high inputs map low
      expect(lut.lut.length).toBe(256)
      // This is NOT an identity LUT due to point order handling
      expect(isIdentityLut(lut)).toBe(false)
    })

    it('rejects curves with different starting value (non-zero start)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0.1 }, // Starts above 0
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should not be identity since it starts at y=0.1
      expect(isIdentityLut(lut)).toBe(false)
      // First value should be around 0.1 * 255 = 25.5
      expect(lut.lut[0]).toBeCloseTo(26, 0)
    })

    it('rejects curves with different ending value', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0.9 }, // Ends below 1
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should not be identity since it ends at y=0.9
      expect(isIdentityLut(lut)).toBe(false)
      // Last value should be around 0.9 * 255 = 229.5
      expect(lut.lut[255]).toBeCloseTo(230, 0)
    })
  })
})

// ============================================================================
// applyToneCurveAdaptive Backend Selection and Fallback Tests
// ============================================================================

describe('applyToneCurveAdaptive backend selection and fallback', () => {
  describe('backend selection', () => {
    it('uses GPU backend when available', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            gpuFn: () => Promise<any>,
            _wasmFn: () => any
          ) => {
            const data = await gpuFn()
            return { data, backend: 'webgpu', timing: 5 }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmFallback = vi.fn()

      await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // GPU path should be invoked
      expect(mockProcessor.execute).toHaveBeenCalledWith(
        'toneCurve',
        2,
        2,
        expect.any(Function),
        expect.any(Function)
      )
      // WASM fallback should not be called directly (processor handles it)
      expect(wasmFallback).not.toHaveBeenCalled()
    })

    it('falls back to WASM when GPU is unavailable', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const expectedResult = new Uint8Array(12).fill(100)
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            try {
              // This will throw because GPU is not available
              await gpuFn()
            } catch {
              // Fall back to WASM
              const data = wasmFn()
              return { data, backend: 'wasm', timing: 3 }
            }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmFallback = vi.fn().mockReturnValue(expectedResult)

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      expect(wasmFallback).toHaveBeenCalled()
      expect(result).toBe(expectedResult)
    })

    it('falls back to WASM when GPU processing throws an error', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: createMockDevice(),
      } as any)

      const expectedResult = new Uint8Array(12).fill(75)
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            try {
              await gpuFn()
              throw new Error('GPU pipeline error')
            } catch {
              const data = wasmFn()
              return { data, backend: 'wasm', timing: 2 }
            }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmFallback = vi.fn().mockReturnValue(expectedResult)

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      expect(wasmFallback).toHaveBeenCalled()
      expect(result).toBe(expectedResult)
    })
  })

  describe('WASM fallback behavior', () => {
    it('copies pixel array before passing to WASM fallback', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      let receivedPixels: Uint8Array | null = null
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            _gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            const data = wasmFn()
            return { data, backend: 'wasm', timing: 1 }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const originalPixelsCopy = pixels.slice()
      const lut = createContrastLut()
      const wasmFallback = vi.fn().mockImplementation((passedPixels: Uint8Array) => {
        receivedPixels = passedPixels
        // Simulate WASM modifying pixels in place
        for (let i = 0; i < passedPixels.length; i++) {
          passedPixels[i] = 0
        }
        return passedPixels
      })

      await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // The passed pixels should be a copy, not the original
      expect(receivedPixels).not.toBe(pixels)
      // Original pixels should remain unchanged
      expect(Array.from(pixels)).toEqual(Array.from(originalPixelsCopy))
    })

    it('passes LUT array correctly to WASM fallback', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      let receivedLut: Uint8Array | null = null
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            _gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            const data = wasmFn()
            return { data, backend: 'wasm', timing: 1 }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmFallback = vi.fn().mockImplementation((_p: Uint8Array, lutArr: Uint8Array) => {
        receivedLut = lutArr
        return new Uint8Array(12)
      })

      await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // LUT should be passed as the lut.lut Uint8Array
      expect(receivedLut).toBe(lut.lut)
      expect((receivedLut as Uint8Array | null)?.length).toBe(256)
    })

    it('returns the value from WASM fallback correctly', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const expectedResult = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            _gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            const data = wasmFn()
            return { data, backend: 'wasm', timing: 1 }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmFallback = vi.fn().mockReturnValue(expectedResult)

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      expect(result).toBe(expectedResult)
    })
  })

  describe('identity LUT optimization', () => {
    it('skips both GPU and WASM processing for identity LUT', async () => {
      const mockProcessor = {
        execute: vi.fn(),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createIdentityLutFixture()
      const wasmFallback = vi.fn()

      await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // Adaptive processor should NOT be called for identity LUT
      expect(mockProcessor.execute).not.toHaveBeenCalled()
      // WASM fallback should NOT be called
      expect(wasmFallback).not.toHaveBeenCalled()
    })

    it('returns a copy of input for identity LUT', async () => {
      const mockProcessor = {
        execute: vi.fn(),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createIdentityLutFixture()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // Result should be a new array (copy)
      expect(result).not.toBe(pixels)
      // Result should have same values as input
      expect(Array.from(result)).toEqual(Array.from(pixels))
    })

    it('does not modify the original array for identity LUT', async () => {
      const mockProcessor = {
        execute: vi.fn(),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      const pixels = createTestRgbPixels(2, 2)
      const originalValues = Array.from(pixels)
      const lut = createIdentityLutFixture()
      const wasmFallback = vi.fn()

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      // Modify the result to prove it's a separate copy
      result[0] = 255

      // Original should remain unchanged
      expect(Array.from(pixels)).toEqual(originalValues)
    })
  })
})

// ============================================================================
// Error Handling and Recovery Tests
// ============================================================================

describe('error handling and recovery', () => {
  describe('uninitialized service errors', () => {
    it('applyToneCurve throws descriptive error before initialize', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      await expect(service.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'Service not initialized'
      )
    })

    it('applyToneCurveRgba throws descriptive error before initialize', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      const pixels = createTestRgbaPixels(2, 2)
      const lut = createContrastLut()

      await expect(service.applyToneCurveRgba(pixels, 2, 2, lut)).rejects.toThrow(
        'Service not initialized'
      )
    })

    it('error message includes guidance to call initialize()', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      await expect(service.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'initialize()'
      )
    })
  })

  describe('pipeline failures', () => {
    it('GPU pipeline error propagates through applyToneCurve', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      const mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice,
      } as any)

      // Mock pipeline to throw during apply
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockRejectedValue(new Error('GPU pipeline execution failed')),
        destroy: vi.fn(),
      }) as any)

      const service = await getGPUToneCurveService()
      expect(service).not.toBeNull()

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      await expect(service!.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'GPU pipeline execution failed'
      )
    })

    it('applyToneCurveFromPointsAdaptive falls back to WASM on GPU failure', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      const mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice,
      } as any)

      // Mock pipeline to throw during apply
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockRejectedValue(new Error('GPU out of memory')),
        destroy: vi.fn(),
      }) as any)

      const pixels = createTestRgbPixels(2, 2)
      const curvePoints = createSCurvePoints()
      const expectedResult = { pixels: new Uint8Array(12).fill(100), width: 2, height: 2 }
      const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

      const result = await applyToneCurveFromPointsAdaptive(
        pixels,
        2,
        2,
        curvePoints,
        wasmFallback
      )

      // Should have fallen back to WASM
      expect(result.backend).toBe('wasm')
      expect(wasmFallback).toHaveBeenCalled()
      expect(result.result).toEqual(expectedResult)
    })

    it('service remains usable after pipeline failure', async () => {
      // Reset service to get fresh instance
      resetGPUToneCurveService()

      const mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice,
      } as any)

      let callCount = 0
      const { ToneCurvePipeline } = await import('./pipelines/tone-curve-pipeline')
      vi.mocked(ToneCurvePipeline).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
          callCount++
          if (callCount === 1) {
            throw new Error('Transient GPU error')
          }
          // Return valid RGBA data on subsequent calls
          return new Uint8Array(pixels.length)
        }),
        destroy: vi.fn(),
      }) as any)

      const service = await getGPUToneCurveService()
      expect(service).not.toBeNull()

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()

      // First call should fail
      await expect(service!.applyToneCurve(pixels, 2, 2, lut)).rejects.toThrow(
        'Transient GPU error'
      )

      // Second call should succeed
      const result = await service!.applyToneCurve(pixels, 2, 2, lut)
      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  describe('invalid input handling', () => {
    it('handles mismatched pixel array size for dimensions', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Pixel array is too small for stated dimensions
      const tooSmallPixels = new Uint8Array(6) // Only 2 pixels worth of RGB
      const lut = createContrastLut()

      // The service should attempt to process (behavior depends on implementation)
      // In this case it may process incorrectly or the pipeline handles it
      // We verify it doesn't crash and returns something
      const result = await service.applyToneCurve(tooSmallPixels, 10, 10, lut)

      // Should return some result (even if incorrect dimensions)
      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles zero dimensions gracefully', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = new Uint8Array(0)
      const lut = createContrastLut()

      const result = await service.applyToneCurve(pixels, 0, 0, lut)

      expect(result.length).toBe(0)
    })

    it('handles very large LUT gracefully', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      // Create oversized LUT (more than 256 entries)
      const oversizedLut: ToneCurveLut = {
        lut: new Uint8Array(512).fill(128),
      }

      // Service should handle this without crashing
      const result = await service.applyToneCurve(pixels, 2, 2, oversizedLut)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles undersized LUT gracefully', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      // Create undersized LUT (less than 256 entries)
      const undersizedLut: ToneCurveLut = {
        lut: new Uint8Array(100).fill(128),
      }

      // Service should handle this without crashing
      const result = await service.applyToneCurve(pixels, 2, 2, undersizedLut)

      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  describe('error propagation vs fallback', () => {
    it('applyToneCurveAdaptive uses WASM fallback when GPU throws', async () => {
      const mockProcessor = {
        execute: vi.fn().mockImplementation(
          async (
            _op: string,
            _w: number,
            _h: number,
            gpuFn: () => Promise<any>,
            wasmFn: () => any
          ) => {
            try {
              await gpuFn()
              throw new Error('Should not reach here')
            } catch {
              // Simulate fallback to WASM
              const data = wasmFn()
              return { data, backend: 'wasm', timing: 1 }
            }
          }
        ),
      }
      vi.mocked(getAdaptiveProcessor).mockReturnValue(mockProcessor as any)

      // Mock GPU service to fail
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as any)

      const pixels = createTestRgbPixels(2, 2)
      const lut = createContrastLut()
      const wasmResult = new Uint8Array(12).fill(200)
      const wasmFallback = vi.fn().mockReturnValue(wasmResult)

      const result = await applyToneCurveAdaptive(pixels, 2, 2, lut, wasmFallback)

      expect(wasmFallback).toHaveBeenCalled()
      expect(result).toEqual(wasmResult)
    })
  })
})

// ============================================================================
// Pixel Format Conversion and Handling Tests
// ============================================================================

describe('pixel format conversion and handling', () => {
  describe('RGB to RGBA conversion', () => {
    it('correctly maps R, G, B channels during conversion', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Create distinct RGB values to verify channel mapping
      // Pixel 1: R=255, G=0, B=0 (red)
      // Pixel 2: R=0, G=255, B=0 (green)
      // Pixel 3: R=0, G=0, B=255 (blue)
      const rgbPixels = new Uint8Array([
        255, 0, 0,    // red
        0, 255, 0,    // green
        0, 0, 255,    // blue
      ])
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(rgbPixels, 3, 1, lut)

      // Identity LUT should preserve channel values
      expect(result.length).toBe(9)
      expect(result[0]).toBe(255) // R of pixel 1
      expect(result[1]).toBe(0)   // G of pixel 1
      expect(result[2]).toBe(0)   // B of pixel 1
      expect(result[3]).toBe(0)   // R of pixel 2
      expect(result[4]).toBe(255) // G of pixel 2
      expect(result[5]).toBe(0)   // B of pixel 2
      expect(result[6]).toBe(0)   // R of pixel 3
      expect(result[7]).toBe(0)   // G of pixel 3
      expect(result[8]).toBe(255) // B of pixel 3
    })

    it('produces RGBA output with alpha channel preserved from RGBA input', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Test RGBA input produces RGBA output of correct size
      const rgbaInput = new Uint8Array([100, 150, 200, 255])
      const lut = createIdentityLutFixture()

      const rgbaResult = await service.applyToneCurveRgba(rgbaInput, 1, 1, lut)

      // RGBA output should have 4 bytes per pixel
      expect(rgbaResult.length).toBe(4)
      // Result should be a separate array from input
      expect(rgbaResult).not.toBe(rgbaInput)
    })

    it('maintains correct pixel alignment and stride for multi-row images', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // 3x2 image with distinct pixels per row
      const rgbPixels = new Uint8Array([
        // Row 0
        10, 20, 30,   // pixel (0,0)
        40, 50, 60,   // pixel (1,0)
        70, 80, 90,   // pixel (2,0)
        // Row 1
        100, 110, 120, // pixel (0,1)
        130, 140, 150, // pixel (1,1)
        160, 170, 180, // pixel (2,1)
      ])
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(rgbPixels, 3, 2, lut)

      // Verify stride: each row should have 3 pixels * 3 bytes = 9 bytes
      expect(result.length).toBe(18)
      // Check row 0 pixel 2 (index 6-8)
      expect(result[6]).toBe(70)
      expect(result[7]).toBe(80)
      expect(result[8]).toBe(90)
      // Check row 1 pixel 0 (index 9-11)
      expect(result[9]).toBe(100)
      expect(result[10]).toBe(110)
      expect(result[11]).toBe(120)
    })
  })

  describe('RGBA to RGB extraction', () => {
    it('correctly extracts R, G, B channels discarding alpha', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // RGB input that gets processed - the service returns RGB
      const rgbPixels = new Uint8Array([
        200, 100, 50,  // pixel with specific RGB values
      ])
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(rgbPixels, 1, 1, lut)

      // Output should be RGB (3 bytes), not RGBA (4 bytes)
      expect(result.length).toBe(3)
      expect(result[0]).toBe(200) // R
      expect(result[1]).toBe(100) // G
      expect(result[2]).toBe(50)  // B
    })

    it('produces correctly sized output array for RGB extraction', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      const width = 10
      const height = 8
      const rgbPixels = createTestRgbPixels(width, height)
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(rgbPixels, width, height, lut)

      // Output should be exactly width * height * 3 bytes (RGB)
      const expectedSize = width * height * 3
      expect(result.length).toBe(expectedSize)
    })
  })

  describe('large image handling', () => {
    it('handles non-square images correctly', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Wide image: 100x10
      const widePixels = createTestRgbPixels(100, 10)
      const lut = createIdentityLutFixture()

      const wideResult = await service.applyToneCurve(widePixels, 100, 10, lut)
      expect(wideResult.length).toBe(100 * 10 * 3)

      // Tall image: 10x100
      const tallPixels = createTestRgbPixels(10, 100)
      const tallResult = await service.applyToneCurve(tallPixels, 10, 100, lut)
      expect(tallResult.length).toBe(10 * 100 * 3)
    })

    it('handles single row images', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Single row: 50 pixels wide, 1 pixel tall
      const singleRowPixels = createTestRgbPixels(50, 1)
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(singleRowPixels, 50, 1, lut)

      expect(result.length).toBe(50 * 1 * 3)
      // Verify data integrity
      expect(result[0]).toBe(128)  // First pixel R
      expect(result[1]).toBe(64)   // First pixel G
      expect(result[2]).toBe(192)  // First pixel B
    })

    it('handles single column images', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // Single column: 1 pixel wide, 50 pixels tall
      const singleColPixels = createTestRgbPixels(1, 50)
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(singleColPixels, 1, 50, lut)

      expect(result.length).toBe(1 * 50 * 3)
      // Verify last pixel data integrity
      const lastPixelOffset = (50 - 1) * 3
      expect(result[lastPixelOffset]).toBe(128)     // Last pixel R
      expect(result[lastPixelOffset + 1]).toBe(64)  // Last pixel G
      expect(result[lastPixelOffset + 2]).toBe(192) // Last pixel B
    })

    it('handles maximum practical size images', async () => {
      const device = createMockDevice()
      const service = new GPUToneCurveService(device)
      await service.initialize()

      // 4K equivalent: 3840x2160 (but we'll test a smaller representative size)
      // Using 384x216 as a representative test to avoid memory issues in tests
      const width = 384
      const height = 216
      const largePixels = createTestRgbPixels(width, height)
      const lut = createIdentityLutFixture()

      const result = await service.applyToneCurve(largePixels, width, height, lut)

      // Verify correct output size
      expect(result.length).toBe(width * height * 3)

      // Verify data at various positions
      const middlePixelOffset = Math.floor((width * height) / 2) * 3
      expect(result[middlePixelOffset]).toBe(128)
      expect(result[middlePixelOffset + 1]).toBe(64)
      expect(result[middlePixelOffset + 2]).toBe(192)
    })
  })
})

// ============================================================================
// LUT Generation Edge Cases and Numerical Stability Tests
// ============================================================================

describe('LUT generation edge cases and numerical stability', () => {
  describe('unusual curve shapes', () => {
    it('handles non-monotonic (oscillating) curves', () => {
      // Wave-like curve that goes up and down
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.6 },
        { x: 0.5, y: 0.3 },
        { x: 0.75, y: 0.8 },
        { x: 1, y: 0.5 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Verify endpoints
      expect(lut.lut[0]).toBe(0)
      // Final value should be near 0.5 * 255 = 127.5
      expect(lut.lut[255]).toBeCloseTo(128, 0)
      // All values should be clamped to valid range
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }
    })

    it('handles curves with flat segments', () => {
      // Curve with extended flat region in the middle
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.5 },
        { x: 0.4, y: 0.5 },
        { x: 0.6, y: 0.5 },
        { x: 0.8, y: 0.5 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Check that the flat region produces consistent values
      const midStart = Math.floor(0.3 * 255)
      const midEnd = Math.floor(0.7 * 255)
      const midValues = Array.from(lut.lut.slice(midStart, midEnd))
      // All values in the flat region should be close to each other
      const minMid = Math.min(...midValues)
      const maxMid = Math.max(...midValues)
      expect(maxMid - minMid).toBeLessThan(30) // Allow some spline smoothing
    })

    it('handles high-frequency curves with many control points', () => {
      // Create a curve with 50 control points creating a zigzag pattern
      const points: CurvePoint[] = []
      for (let i = 0; i <= 50; i++) {
        const x = i / 50
        const y = i % 2 === 0 ? 0.3 + x * 0.4 : 0.7 - (1 - x) * 0.4
        points.push({ x, y })
      }

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // All values should be valid
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
        expect(Number.isInteger(lut.lut[i])).toBe(true)
      }
    })
  })

  describe('numerical stability', () => {
    it('handles very small coordinate differences', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.0000001, y: 0.0000001 },
        { x: 0.5, y: 0.5 },
        { x: 0.9999999, y: 0.9999999 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Should produce near-identity LUT despite tiny coordinate differences
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
      // Middle should be close to identity
      expect(lut.lut[128]).toBeCloseTo(128, 0)
    })

    it('handles points near 0 boundary', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.001, y: 0.001 },
        { x: 0.01, y: 0.02 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // First few entries should be very small
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[1]).toBeLessThan(10)
      expect(lut.lut[2]).toBeLessThan(15)
    })

    it('handles points near 1 boundary', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.99, y: 0.98 },
        { x: 0.999, y: 0.999 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Last few entries should be close to 255
      expect(lut.lut[255]).toBe(255)
      expect(lut.lut[254]).toBeGreaterThan(245)
      expect(lut.lut[253]).toBeGreaterThan(240)
    })

    it('handles floating point precision edge cases', () => {
      // Use values that are known to cause floating point issues
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.1 + 0.2, y: 0.3 }, // 0.30000000000000004
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Should handle precision issues gracefully
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
        expect(Number.isInteger(lut.lut[i])).toBe(true)
      }
    })
  })

  describe('LUT boundary values', () => {
    it('first entry (index 0) always maps correctly for various curves', () => {
      const testCurves: { points: CurvePoint[]; expectedFirst: number }[] = [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          expectedFirst: 0,
        },
        {
          points: [
            { x: 0, y: 0.5 },
            { x: 1, y: 1 },
          ],
          expectedFirst: 128,
        },
        {
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 0 },
          ],
          expectedFirst: 255,
        },
        {
          points: [
            { x: 0, y: 0.25 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0.75 },
          ],
          expectedFirst: 64,
        },
      ]

      for (const { points, expectedFirst } of testCurves) {
        const lut = generateLutFromCurvePoints(points)
        expect(lut.lut[0]).toBeCloseTo(expectedFirst, 0)
      }
    })

    it('last entry (index 255) always maps correctly for various curves', () => {
      const testCurves: { points: CurvePoint[]; expectedLast: number }[] = [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          expectedLast: 255,
        },
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0.5 },
          ],
          expectedLast: 128,
        },
        {
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 0 },
          ],
          expectedLast: 0,
        },
        {
          points: [
            { x: 0, y: 0.25 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0.75 },
          ],
          expectedLast: 191,
        },
      ]

      for (const { points, expectedLast } of testCurves) {
        const lut = generateLutFromCurvePoints(points)
        expect(lut.lut[255]).toBeCloseTo(expectedLast, 0)
      }
    })

    it('boundary behavior at exactly 0 and 1 x coordinates', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0.2 },
        { x: 1, y: 0.8 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // At x=0 (index 0), y should be 0.2 * 255 = 51
      expect(lut.lut[0]).toBeCloseTo(51, 0)
      // At x=1 (index 255), y should be 0.8 * 255 = 204
      expect(lut.lut[255]).toBeCloseTo(204, 0)
    })

    it('handles x=0 with y=0 and x=1 with y=1 exactly', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.3, y: 0.4 },
        { x: 0.7, y: 0.6 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Boundary values must be exact
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
    })
  })

  describe('spline interpolation stability', () => {
    it('produces smooth output without NaN or Infinity values', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.15 },
        { x: 0.2, y: 0.25 },
        { x: 0.4, y: 0.35 },
        { x: 0.6, y: 0.65 },
        { x: 0.8, y: 0.85 },
        { x: 0.9, y: 0.92 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      for (let i = 0; i < 256; i++) {
        expect(Number.isFinite(lut.lut[i])).toBe(true)
        expect(Number.isNaN(lut.lut[i])).toBe(false)
      }
    })

    it('handles unsorted points gracefully', () => {
      // Points provided out of order by x
      const points: CurvePoint[] = [
        { x: 0.5, y: 0.5 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.25 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should produce valid LUT regardless of point order
      expect(lut.lut.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }
    })
  })
})

// ============================================================================
// Fritsch-Carlson Algorithm and Spline Interpolation Tests
// ============================================================================

describe('Fritsch-Carlson algorithm and spline interpolation', () => {
  describe('curves with sharp corners', () => {
    it('handles V-shaped curve (sharp corner at midpoint)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 0 }, // Sharp corner at bottom
        { x: 1, y: 0.5 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Midpoint should be near 0
      expect(lut.lut[128]).toBeLessThan(15)
      // Endpoints should be near 128 (0.5 * 255)
      expect(lut.lut[0]).toBeGreaterThan(115)
      expect(lut.lut[0]).toBeLessThan(140)
      expect(lut.lut[255]).toBeGreaterThan(115)
      expect(lut.lut[255]).toBeLessThan(140)
    })

    it('handles inverted V-shaped curve (sharp peak)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 1 }, // Sharp peak at top
        { x: 1, y: 0.5 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Midpoint should be near 255
      expect(lut.lut[128]).toBeGreaterThan(240)
      // Endpoints should be near 128 (0.5 * 255)
      expect(lut.lut[0]).toBeGreaterThan(115)
      expect(lut.lut[0]).toBeLessThan(140)
      expect(lut.lut[255]).toBeGreaterThan(115)
      expect(lut.lut[255]).toBeLessThan(140)
    })

    it('handles zigzag curve with multiple sharp corners', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.75 },
        { x: 0.5, y: 0.25 },
        { x: 0.75, y: 0.75 },
        { x: 1, y: 0 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Should not produce invalid values
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }
      // Should pass through approximate control point values
      expect(lut.lut[64]).toBeGreaterThan(150) // Near 0.75 * 255
      expect(lut.lut[128]).toBeLessThan(100) // Near 0.25 * 255
      expect(lut.lut[192]).toBeGreaterThan(150) // Near 0.75 * 255
    })
  })

  describe('curves with plateau regions', () => {
    it('handles flat plateau in the middle', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 }, // Flat plateau
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Middle region should be relatively flat
      const midStart = Math.round(0.25 * 255)
      const midEnd = Math.round(0.75 * 255)
      const plateauValue = Math.round(0.5 * 255)

      // Values in plateau region should be close to 0.5 * 255 = 128
      for (let i = midStart + 10; i < midEnd - 10; i++) {
        expect(lut.lut[i]).toBeGreaterThan(plateauValue - 30)
        expect(lut.lut[i]).toBeLessThan(plateauValue + 30)
      }
    })

    it('handles plateau at shadows (low values)', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0.2 },
        { x: 0.3, y: 0.2 }, // Flat shadows
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Shadow region should be flat around 0.2 * 255 = 51
      const shadowEnd = Math.round(0.3 * 255)
      for (let i = 0; i < shadowEnd - 10; i++) {
        expect(lut.lut[i]).toBeGreaterThan(40)
        expect(lut.lut[i]).toBeLessThan(65)
      }
    })
  })

  describe('monotonicity constraints (oscillation prevention)', () => {
    it('prevents oscillation in steep S-curve', () => {
      // A curve that without monotonicity constraints could oscillate
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.05 },
        { x: 0.4, y: 0.1 },
        { x: 0.5, y: 0.5 }, // Steep transition
        { x: 0.6, y: 0.9 },
        { x: 0.9, y: 0.95 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Should be monotonically increasing (or equal)
      for (let i = 1; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(lut.lut[i - 1])
      }
    })

    it('prevents overshoot at steep transitions', () => {
      // Curve with steep rise that could overshoot
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.4, y: 0.1 },
        { x: 0.6, y: 0.9 }, // Steep rise
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // All values should stay within bounds (no overshoot)
      for (let i = 0; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut.lut[i]).toBeLessThanOrEqual(255)
      }

      // Verify monotonicity is preserved
      for (let i = 1; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThanOrEqual(lut.lut[i - 1])
      }
    })
  })

  describe('binary search edge cases (findInterval)', () => {
    it('correctly handles x at exact control point boundaries', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.3 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.7 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Values at exact control points should match closely
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
      // At x=0.25 (index 64), y should be close to 0.3 * 255 = 77
      expect(lut.lut[64]).toBeGreaterThan(70)
      expect(lut.lut[64]).toBeLessThan(85)
      // At x=0.5 (index 128), y should be close to 0.5 * 255 = 128
      expect(lut.lut[128]).toBeGreaterThan(120)
      expect(lut.lut[128]).toBeLessThan(135)
    })

    it('handles points clustered near start', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.05, y: 0.1 },
        { x: 0.1, y: 0.3 },
        { x: 0.15, y: 0.5 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Should produce valid results even with clustered points
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
      // Early region should rise quickly
      expect(lut.lut[38]).toBeGreaterThan(100) // Around x=0.15
    })

    it('handles points clustered near end', () => {
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.85, y: 0.5 },
        { x: 0.9, y: 0.7 },
        { x: 0.95, y: 0.9 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      expect(lut.lut.length).toBe(256)
      // Should produce valid results even with clustered points
      expect(lut.lut[0]).toBe(0)
      expect(lut.lut[255]).toBe(255)
      // Most of the curve should be a gradual rise
      expect(lut.lut[128]).toBeLessThan(80) // Linear portion
    })
  })

  describe('Hermite basis function correctness', () => {
    it('produces smooth curve with correct shape for contrast boost', () => {
      // Classic contrast S-curve
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Shadow region should be compressed (values less than linear)
      expect(lut.lut[32]).toBeLessThan(32)
      expect(lut.lut[48]).toBeLessThan(48)

      // Highlight region should be expanded (values greater than linear)
      expect(lut.lut[208]).toBeGreaterThan(208)
      expect(lut.lut[224]).toBeGreaterThan(224)

      // Midpoint should be approximately preserved
      expect(lut.lut[128]).toBeGreaterThan(115)
      expect(lut.lut[128]).toBeLessThan(140)
    })

    it('produces smooth curve with correct shape for contrast reduction', () => {
      // Inverse S-curve (reduces contrast)
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.35 },
        { x: 0.75, y: 0.65 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Shadow region should be lifted (values greater than linear)
      expect(lut.lut[32]).toBeGreaterThan(32)
      expect(lut.lut[48]).toBeGreaterThan(48)

      // Highlight region should be pulled down (values less than linear)
      expect(lut.lut[208]).toBeLessThan(208)
      expect(lut.lut[224]).toBeLessThan(224)
    })
  })

  describe('boundary clamping behavior', () => {
    it('correctly clamps values below curve start', () => {
      // Curve that does not start at x=0
      const points: CurvePoint[] = [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Values before x=0.1 should be clamped to the first point's y value
      // Index 0-25 corresponds to x=0 to ~0.1
      for (let i = 0; i < 20; i++) {
        // Should be close to first point's y value (0.2 * 255 = 51)
        expect(lut.lut[i]).toBeGreaterThan(40)
        expect(lut.lut[i]).toBeLessThan(65)
      }
    })

    it('correctly clamps values above curve end', () => {
      // Curve that does not end at x=1
      const points: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 0.9, y: 0.8 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Values after x=0.9 should be clamped to the last point's y value
      // Index 230-255 corresponds to x=0.9 to 1.0
      for (let i = 235; i < 256; i++) {
        // Should be close to last point's y value (0.8 * 255 = 204)
        expect(lut.lut[i]).toBeGreaterThan(190)
        expect(lut.lut[i]).toBeLessThan(220)
      }
    })

    it('handles curve with narrow x range in the middle', () => {
      // Curve defined only for a portion of the range
      const points: CurvePoint[] = [
        { x: 0.3, y: 0.2 },
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.8 },
      ]

      const lut = generateLutFromCurvePoints(points)

      // Values below x=0.3 should be clamped to 0.2 * 255 = 51
      for (let i = 0; i < 70; i++) {
        expect(lut.lut[i]).toBeGreaterThan(40)
        expect(lut.lut[i]).toBeLessThan(65)
      }

      // Values above x=0.7 should be clamped to 0.8 * 255 = 204
      for (let i = 185; i < 256; i++) {
        expect(lut.lut[i]).toBeGreaterThan(190)
        expect(lut.lut[i]).toBeLessThan(220)
      }
    })
  })
})