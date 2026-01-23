/**
 * Unit tests for GPUAdjustmentsService.
 *
 * Tests the GPU-accelerated adjustments service including:
 * - Service initialization and lifecycle
 * - RGB/RGBA pixel processing
 * - Adaptive backend selection
 * - Error handling and fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GPUAdjustmentsService,
  getGPUAdjustmentsService,
  resetGPUAdjustmentsService,
  applyAdjustmentsAdaptive,
} from './gpu-adjustments-service'
import { resetGPUCapabilityService } from './capabilities'
import type { Adjustments, DecodedImage } from '../decode/types'

// ============================================================================
// Mock WebGPU API and Pipeline
// ============================================================================

// Mock the pipelines module
vi.mock('./pipelines', () => ({
  getAdjustmentsPipeline: vi.fn(),
  AdjustmentsPipeline: vi.fn(),
}))

// Mock the capabilities module
vi.mock('./capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: true,
    device: {},
  })),
  resetGPUCapabilityService: vi.fn(),
}))

// Import after mocking
import { getAdjustmentsPipeline } from './pipelines'

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

function createDefaultAdjustments(): Adjustments {
  return {
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    saturation: 0,
  }
}

function createMockPipeline() {
  return {
    apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
      // Return modified pixels (simulate adjustment)
      const result = new Uint8Array(pixels.length)
      for (let i = 0; i < pixels.length; i++) {
        result[i] = Math.min(255, pixels[i] + 10)
      }
      return result
    }),
    destroy: vi.fn(),
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetGPUAdjustmentsService()
})

afterEach(() => {
  vi.clearAllMocks()
  resetGPUAdjustmentsService()
})

// ============================================================================
// GPUAdjustmentsService Tests
// ============================================================================

describe('GPUAdjustmentsService', () => {
  describe('initial state', () => {
    it('is not ready before initialization', () => {
      const service = new GPUAdjustmentsService()
      expect(service.isReady).toBe(false)
    })
  })

  describe('initialize', () => {
    it('initializes successfully with pipeline', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      const result = await service.initialize()

      expect(result).toBe(true)
      expect(service.isReady).toBe(true)
      expect(getAdjustmentsPipeline).toHaveBeenCalled()
    })

    it('returns false when pipeline initialization fails', async () => {
      vi.mocked(getAdjustmentsPipeline).mockRejectedValue(
        new Error('Pipeline failed')
      )

      const service = new GPUAdjustmentsService()
      const result = await service.initialize()

      expect(result).toBe(false)
      expect(service.isReady).toBe(false)
    })

    it('handles multiple initialize calls', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      await service.initialize()
      await service.initialize()

      expect(getAdjustmentsPipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('applyAdjustments', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUAdjustmentsService()
      const pixels = createTestRgbPixels(2, 2)
      const adjustments = createDefaultAdjustments()

      await expect(
        service.applyAdjustments(pixels, 2, 2, adjustments)
      ).rejects.toThrow('not initialized')
    })

    it('applies adjustments and returns DecodedImage', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const adjustments = { ...createDefaultAdjustments(), exposure: 1.0 }

      const result = await service.applyAdjustments(pixels, 2, 2, adjustments)

      expect(result.width).toBe(2)
      expect(result.height).toBe(2)
      expect(result.pixels.length).toBe(2 * 2 * 3) // RGB
      expect(mockPipeline.apply).toHaveBeenCalled()
    })

    it('converts RGB to RGBA and back', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const adjustments = createDefaultAdjustments()

      await service.applyAdjustments(pixels, 2, 2, adjustments)

      // Check that RGBA was passed to pipeline
      const passedPixels = mockPipeline.apply.mock.calls[0][0] as Uint8Array
      expect(passedPixels.length).toBe(2 * 2 * 4) // RGBA
    })
  })

  describe('applyAdjustmentsRgba', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUAdjustmentsService()
      const pixels = createTestRgbaPixels(2, 2)
      const adjustments = createDefaultAdjustments()

      await expect(
        service.applyAdjustmentsRgba(pixels, 2, 2, adjustments)
      ).rejects.toThrow('not initialized')
    })

    it('applies adjustments directly to RGBA pixels', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      const adjustments = createDefaultAdjustments()

      const result = await service.applyAdjustmentsRgba(
        pixels,
        2,
        2,
        adjustments
      )

      expect(result.length).toBe(2 * 2 * 4) // RGBA
      expect(mockPipeline.apply).toHaveBeenCalledWith(
        pixels,
        2,
        2,
        expect.any(Object)
      )
    })
  })

  describe('destroy', () => {
    it('resets service state', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUAdjustmentsService()
      await service.initialize()
      expect(service.isReady).toBe(true)

      service.destroy()

      expect(service.isReady).toBe(false)
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton management', () => {
  it('getGPUAdjustmentsService returns same instance', () => {
    const service1 = getGPUAdjustmentsService()
    const service2 = getGPUAdjustmentsService()

    expect(service1).toBe(service2)
  })

  it('resetGPUAdjustmentsService creates new instance', () => {
    const service1 = getGPUAdjustmentsService()
    resetGPUAdjustmentsService()
    const service2 = getGPUAdjustmentsService()

    expect(service1).not.toBe(service2)
  })
})

// ============================================================================
// Adaptive Processing Tests
// ============================================================================

describe('applyAdjustmentsAdaptive', () => {
  it('uses GPU when service is ready', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUAdjustmentsService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const adjustments = createDefaultAdjustments()
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    } as DecodedImage)

    const { backend } = await applyAdjustmentsAdaptive(
      pixels,
      2,
      2,
      adjustments,
      wasmFallback
    )

    expect(backend).toBe('webgpu')
    expect(wasmFallback).not.toHaveBeenCalled()
  })

  it('falls back to WASM when GPU not ready', async () => {
    resetGPUAdjustmentsService()

    const pixels = createTestRgbPixels(2, 2)
    const adjustments = createDefaultAdjustments()
    const expectedResult: DecodedImage = {
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    }
    const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

    const { result, backend } = await applyAdjustmentsAdaptive(
      pixels,
      2,
      2,
      adjustments,
      wasmFallback
    )

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
    expect(result).toBe(expectedResult)
  })

  it('falls back to WASM when GPU throws error', async () => {
    const mockPipeline = {
      apply: vi.fn().mockRejectedValue(new Error('GPU error')),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUAdjustmentsService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const adjustments = createDefaultAdjustments()
    const expectedResult: DecodedImage = {
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    }
    const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

    const { backend } = await applyAdjustmentsAdaptive(
      pixels,
      2,
      2,
      adjustments,
      wasmFallback
    )

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
  })

  it('includes timing in result', async () => {
    resetGPUAdjustmentsService()

    const pixels = createTestRgbPixels(2, 2)
    const adjustments = createDefaultAdjustments()
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    })

    const { timing } = await applyAdjustmentsAdaptive(
      pixels,
      2,
      2,
      adjustments,
      wasmFallback
    )

    expect(timing).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// RGB/RGBA Conversion Tests
// ============================================================================

describe('RGB/RGBA conversion', () => {
  it('correctly converts RGB to RGBA', async () => {
    let capturedRgba: Uint8Array | null = null
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
        capturedRgba = pixels.slice()
        return pixels
      }),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    // Single pixel: R=100, G=150, B=200
    const rgbPixels = new Uint8Array([100, 150, 200])
    const adjustments = createDefaultAdjustments()

    await service.applyAdjustments(rgbPixels, 1, 1, adjustments)

    expect(capturedRgba).not.toBeNull()
    expect(capturedRgba!.length).toBe(4)
    expect(capturedRgba![0]).toBe(100) // R
    expect(capturedRgba![1]).toBe(150) // G
    expect(capturedRgba![2]).toBe(200) // B
    expect(capturedRgba![3]).toBe(255) // A (fully opaque)
  })

  it('correctly converts RGBA back to RGB', async () => {
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async () => {
        // Return RGBA: R=110, G=160, B=210, A=255
        return new Uint8Array([110, 160, 210, 255])
      }),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    const rgbPixels = new Uint8Array([100, 150, 200])
    const adjustments = createDefaultAdjustments()

    const result = await service.applyAdjustments(rgbPixels, 1, 1, adjustments)

    expect(result.pixels.length).toBe(3)
    expect(result.pixels[0]).toBe(110) // R
    expect(result.pixels[1]).toBe(160) // G
    expect(result.pixels[2]).toBe(210) // B
  })

  it('handles multiple pixels correctly', async () => {
    let capturedRgba: Uint8Array | null = null
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
        capturedRgba = pixels.slice()
        return pixels
      }),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    // 2 pixels: [R1, G1, B1, R2, G2, B2]
    const rgbPixels = new Uint8Array([100, 150, 200, 50, 100, 150])
    const adjustments = createDefaultAdjustments()

    await service.applyAdjustments(rgbPixels, 2, 1, adjustments)

    expect(capturedRgba).not.toBeNull()
    expect(capturedRgba!.length).toBe(8) // 2 pixels * 4 bytes
    // First pixel
    expect(capturedRgba![0]).toBe(100) // R1
    expect(capturedRgba![1]).toBe(150) // G1
    expect(capturedRgba![2]).toBe(200) // B1
    expect(capturedRgba![3]).toBe(255) // A1
    // Second pixel
    expect(capturedRgba![4]).toBe(50) // R2
    expect(capturedRgba![5]).toBe(100) // G2
    expect(capturedRgba![6]).toBe(150) // B2
    expect(capturedRgba![7]).toBe(255) // A2
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles empty pixel array', async () => {
    const mockPipeline = {
      apply: vi.fn().mockResolvedValue(new Uint8Array(0)),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    const pixels = new Uint8Array(0)
    const adjustments = createDefaultAdjustments()

    const result = await service.applyAdjustments(pixels, 0, 0, adjustments)

    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
    expect(result.pixels.length).toBe(0)
  })

  it('handles large images', async () => {
    const width = 4096
    const height = 4096
    const mockPipeline = {
      apply: vi.fn().mockResolvedValue(new Uint8Array(width * height * 4)),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    const pixels = new Uint8Array(width * height * 3)
    const adjustments = createDefaultAdjustments()

    const result = await service.applyAdjustments(
      pixels,
      width,
      height,
      adjustments
    )

    expect(result.width).toBe(width)
    expect(result.height).toBe(height)
    expect(mockPipeline.apply).toHaveBeenCalled()
  })

  it('passes all adjustment parameters correctly', async () => {
    let capturedAdjustments: any = null
    const mockPipeline = {
      apply: vi.fn().mockImplementation(
        async (
          pixels: Uint8Array,
          _w: number,
          _h: number,
          adjustments: any
        ) => {
          capturedAdjustments = adjustments
          return pixels
        }
      ),
    }
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUAdjustmentsService()
    await service.initialize()

    const pixels = createTestRgbaPixels(1, 1)
    const adjustments: Adjustments = {
      temperature: 10,
      tint: -20,
      exposure: 1.5,
      contrast: 30,
      highlights: -40,
      shadows: 50,
      whites: -60,
      blacks: 70,
      vibrance: 80,
      saturation: -90,
    }

    await service.applyAdjustmentsRgba(pixels, 1, 1, adjustments)

    expect(capturedAdjustments.temperature).toBe(10)
    expect(capturedAdjustments.tint).toBe(-20)
    expect(capturedAdjustments.exposure).toBe(1.5)
    expect(capturedAdjustments.contrast).toBe(30)
    expect(capturedAdjustments.highlights).toBe(-40)
    expect(capturedAdjustments.shadows).toBe(50)
    expect(capturedAdjustments.whites).toBe(-60)
    expect(capturedAdjustments.blacks).toBe(70)
    expect(capturedAdjustments.vibrance).toBe(80)
    expect(capturedAdjustments.saturation).toBe(-90)
  })
})
