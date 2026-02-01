/**
 * Unit tests for GPUHistogramService.
 *
 * Tests the GPU-accelerated histogram service including:
 * - Service initialization and lifecycle
 * - RGB/RGBA pixel processing
 * - Histogram computation with clipping detection
 * - Adaptive backend selection
 * - Error handling and fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GPUHistogramService,
  getGPUHistogramService,
  resetGPUHistogramService,
  computeHistogramAdaptive,
} from './gpu-histogram-service'
import type { HistogramData } from '../decode/types'

// ============================================================================
// Mock WebGPU API and Pipeline
// ============================================================================

// Mock the pipelines module
vi.mock('./pipelines', () => ({
  getHistogramPipeline: vi.fn(),
  HistogramPipeline: vi.fn(),
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
import { getHistogramPipeline } from './pipelines'
import { resetGPUCapabilityService } from './capabilities'

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

function createMockHistogramResult(): {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminance: Uint32Array
} {
  const red = new Uint32Array(256)
  const green = new Uint32Array(256)
  const blue = new Uint32Array(256)
  const luminance = new Uint32Array(256)

  // Fill with some test data
  for (let i = 0; i < 256; i++) {
    red[i] = i
    green[i] = i * 2
    blue[i] = i * 3
    luminance[i] = i
  }

  return { red, green, blue, luminance }
}

function createMockPipeline() {
  return {
    computeFromPixels: vi.fn().mockImplementation(async () => {
      return createMockHistogramResult()
    }),
    destroy: vi.fn(),
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetGPUHistogramService()
})

afterEach(() => {
  vi.clearAllMocks()
  resetGPUHistogramService()
})

// ============================================================================
// GPUHistogramService Tests
// ============================================================================

describe('GPUHistogramService', () => {
  describe('initial state', () => {
    it('is not ready before initialization', () => {
      const service = new GPUHistogramService()
      expect(service.isReady()).toBe(false)
    })
  })

  describe('initialize', () => {
    it('initializes successfully with pipeline and sets isReady to true', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      const result = await service.initialize()

      expect(result).toBe(true)
      expect(service.isReady()).toBe(true)
      expect(getHistogramPipeline).toHaveBeenCalled()
    })

    it('returns false when pipeline initialization fails (getHistogramPipeline returns null)', async () => {
      vi.mocked(getHistogramPipeline).mockResolvedValue(null as any)

      const service = new GPUHistogramService()
      const result = await service.initialize()

      expect(result).toBe(false)
      expect(service.isReady()).toBe(false)
    })

    it('handles multiple initialize calls (only initializes once)', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()
      await service.initialize()

      expect(getHistogramPipeline).toHaveBeenCalledTimes(1)
    })

    it('returns true on second init call if already initialized', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      const firstResult = await service.initialize()
      const secondResult = await service.initialize()

      expect(firstResult).toBe(true)
      expect(secondResult).toBe(true)
      expect(getHistogramPipeline).toHaveBeenCalledTimes(1)
    })

    it('catches and logs errors if getHistogramPipeline throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(getHistogramPipeline).mockRejectedValue(new Error('Pipeline failed'))

      const service = new GPUHistogramService()
      const result = await service.initialize()

      expect(result).toBe(false)
      expect(service.isReady()).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[GPUHistogramService] Initialization failed:',
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('computeHistogram', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUHistogramService()
      const pixels = createTestRgbPixels(2, 2)

      await expect(service.computeHistogram(pixels, 2, 2)).rejects.toThrow(
        'not initialized'
      )
    })

    it('converts RGB to RGBA before calling pipeline', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      await service.computeHistogram(pixels, 2, 2)

      // Check that RGBA was passed to pipeline
      const passedPixels = mockPipeline.computeFromPixels.mock
        .calls[0][0] as Uint8Array
      expect(passedPixels.length).toBe(2 * 2 * 4) // RGBA
    })

    it('returns HistogramData with correct structure', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const result = await service.computeHistogram(pixels, 2, 2)

      // Verify all required fields exist
      expect(result.red).toBeInstanceOf(Uint32Array)
      expect(result.green).toBeInstanceOf(Uint32Array)
      expect(result.blue).toBeInstanceOf(Uint32Array)
      expect(result.luminance).toBeInstanceOf(Uint32Array)
      expect(result.red.length).toBe(256)
      expect(result.green.length).toBe(256)
      expect(result.blue.length).toBe(256)
      expect(result.luminance.length).toBe(256)
    })

    it('passes correct dimensions to pipeline', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      await service.computeHistogram(pixels, 2, 2)

      expect(mockPipeline.computeFromPixels).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        2,
        2
      )
    })
  })

  describe('computeHistogramRgba', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUHistogramService()
      const pixels = createTestRgbaPixels(2, 2)

      await expect(service.computeHistogramRgba(pixels, 2, 2)).rejects.toThrow(
        'not initialized'
      )
    })

    it('passes RGBA directly to pipeline without conversion', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      await service.computeHistogramRgba(pixels, 2, 2)

      expect(mockPipeline.computeFromPixels).toHaveBeenCalledWith(pixels, 2, 2)
      expect(mockPipeline.computeFromPixels).toHaveBeenCalledTimes(1)
    })

    it('returns HistogramData with all required fields', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      const result = await service.computeHistogramRgba(pixels, 2, 2)

      expect(result).toHaveProperty('red')
      expect(result).toHaveProperty('green')
      expect(result).toHaveProperty('blue')
      expect(result).toHaveProperty('luminance')
      expect(result).toHaveProperty('maxValue')
      expect(result).toHaveProperty('hasHighlightClipping')
      expect(result).toHaveProperty('hasShadowClipping')
      expect(result).toHaveProperty('highlightClipping')
      expect(result).toHaveProperty('shadowClipping')

      expect(result.red).toBeInstanceOf(Uint32Array)
      expect(result.green).toBeInstanceOf(Uint32Array)
      expect(result.blue).toBeInstanceOf(Uint32Array)
      expect(result.luminance).toBeInstanceOf(Uint32Array)
      expect(typeof result.maxValue).toBe('number')
      expect(typeof result.hasHighlightClipping).toBe('boolean')
      expect(typeof result.hasShadowClipping).toBe('boolean')
      expect(result.highlightClipping).toHaveProperty('r')
      expect(result.highlightClipping).toHaveProperty('g')
      expect(result.highlightClipping).toHaveProperty('b')
      expect(result.shadowClipping).toHaveProperty('r')
      expect(result.shadowClipping).toHaveProperty('g')
      expect(result.shadowClipping).toHaveProperty('b')
    })

    it('calls pipeline.computeFromPixels with correct arguments', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const width = 4
      const height = 3
      const pixels = createTestRgbaPixels(width, height)

      await service.computeHistogramRgba(pixels, width, height)

      expect(mockPipeline.computeFromPixels).toHaveBeenCalledWith(
        pixels,
        width,
        height
      )
      expect(mockPipeline.computeFromPixels).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroy', () => {
    it('resets service state (isReady becomes false)', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()
      expect(service.isReady()).toBe(true)

      service.destroy()

      expect(service.isReady()).toBe(false)
    })

    it('can reinitialize after destroy', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()
      expect(service.isReady()).toBe(true)

      service.destroy()
      expect(service.isReady()).toBe(false)

      const result = await service.initialize()
      expect(result).toBe(true)
      expect(service.isReady()).toBe(true)
      expect(getHistogramPipeline).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton management', () => {
  it('getGPUHistogramService returns same instance', () => {
    const service1 = getGPUHistogramService()
    const service2 = getGPUHistogramService()

    expect(service1).toBe(service2)
  })

  it('resetGPUHistogramService destroys old instance and creates new one', () => {
    const service1 = getGPUHistogramService()
    resetGPUHistogramService()
    const service2 = getGPUHistogramService()

    expect(service1).not.toBe(service2)
  })
})

// ============================================================================
// Adaptive Processing Tests
// ============================================================================

describe('computeHistogramAdaptive', () => {
  const mockHistogramData: HistogramData = {
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    luminance: new Uint32Array(256),
    maxValue: 100,
    hasHighlightClipping: false,
    hasShadowClipping: false,
    highlightClipping: { r: false, g: false, b: false },
    shadowClipping: { r: false, g: false, b: false },
  }

  it('uses GPU when service is ready', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUHistogramService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue(mockHistogramData)

    const { backend } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )

    expect(backend).toBe('webgpu')
    expect(wasmFallback).not.toHaveBeenCalled()
  })

  it('falls back to WASM when GPU not ready', async () => {
    resetGPUHistogramService()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue(mockHistogramData)

    const { result, backend } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
    expect(result).toBe(mockHistogramData)
  })

  it('falls back to WASM when GPU throws error', async () => {
    const mockPipeline = {
      computeFromPixels: vi.fn().mockRejectedValue(new Error('GPU error')),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUHistogramService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue(mockHistogramData)

    const { backend } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
  })

  it('includes timing in result', async () => {
    resetGPUHistogramService()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue(mockHistogramData)

    const { timing } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )

    expect(timing).toBeGreaterThanOrEqual(0)
  })

  it('returns correct backend indicator (webgpu or wasm)', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUHistogramService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn()

    const { backend: gpuBackend } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )
    expect(gpuBackend).toBe('webgpu')

    // Reset and try WASM path
    resetGPUHistogramService()
    wasmFallback.mockResolvedValue(mockHistogramData)

    const { backend: wasmBackend } = await computeHistogramAdaptive(
      pixels,
      2,
      2,
      wasmFallback
    )
    expect(wasmBackend).toBe('wasm')
  })
})

// ============================================================================
// Helper Function Tests (tested through the service)
// ============================================================================

describe('helper functions', () => {
  describe('RGB to RGBA conversion', () => {
    it('preserves R,G,B and adds alpha=255', async () => {
      let capturedRgba: Uint8Array | null = null
      const mockPipeline = {
        computeFromPixels: vi
          .fn()
          .mockImplementation(async (pixels: Uint8Array) => {
            capturedRgba = pixels.slice()
            return createMockHistogramResult()
          }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      // Single pixel: R=100, G=150, B=200
      const rgbPixels = new Uint8Array([100, 150, 200])

      await service.computeHistogram(rgbPixels, 1, 1)

      expect(capturedRgba).not.toBeNull()
      expect(capturedRgba!.length).toBe(4)
      expect(capturedRgba![0]).toBe(100) // R
      expect(capturedRgba![1]).toBe(150) // G
      expect(capturedRgba![2]).toBe(200) // B
      expect(capturedRgba![3]).toBe(255) // A (fully opaque)
    })

    it('handles multiple pixels correctly', async () => {
      let capturedRgba: Uint8Array | null = null
      const mockPipeline = {
        computeFromPixels: vi
          .fn()
          .mockImplementation(async (pixels: Uint8Array) => {
            capturedRgba = pixels.slice()
            return createMockHistogramResult()
          }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      // 2 pixels: [R1, G1, B1, R2, G2, B2]
      const rgbPixels = new Uint8Array([100, 150, 200, 50, 100, 150])

      await service.computeHistogram(rgbPixels, 2, 1)

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

  describe('convertToHistogramData', () => {
    it('calculates maxValue from RGB bins', async () => {
      const mockPipeline = {
        computeFromPixels: vi.fn().mockImplementation(async () => {
          const red = new Uint32Array(256)
          const green = new Uint32Array(256)
          const blue = new Uint32Array(256)
          const luminance = new Uint32Array(256)

          // Set different values to test maxValue calculation
          red[100] = 50
          green[150] = 100 // This should be the max
          blue[200] = 75

          return { red, green, blue, luminance }
        }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(1, 1)
      const result = await service.computeHistogramRgba(pixels, 1, 1)

      expect(result.maxValue).toBe(100)
    })

    it('detects highlight clipping (value 255)', async () => {
      const mockPipeline = {
        computeFromPixels: vi.fn().mockImplementation(async () => {
          const red = new Uint32Array(256)
          const green = new Uint32Array(256)
          const blue = new Uint32Array(256)
          const luminance = new Uint32Array(256)

          // Set highlight clipping for red and blue channels
          red[255] = 10
          blue[255] = 5

          return { red, green, blue, luminance }
        }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(1, 1)
      const result = await service.computeHistogramRgba(pixels, 1, 1)

      expect(result.hasHighlightClipping).toBe(true)
      expect(result.highlightClipping!.r).toBe(true)
      expect(result.highlightClipping!.g).toBe(false)
      expect(result.highlightClipping!.b).toBe(true)
    })

    it('detects shadow clipping (value 0)', async () => {
      const mockPipeline = {
        computeFromPixels: vi.fn().mockImplementation(async () => {
          const red = new Uint32Array(256)
          const green = new Uint32Array(256)
          const blue = new Uint32Array(256)
          const luminance = new Uint32Array(256)

          // Set shadow clipping for green channel
          green[0] = 15

          return { red, green, blue, luminance }
        }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(1, 1)
      const result = await service.computeHistogramRgba(pixels, 1, 1)

      expect(result.hasShadowClipping).toBe(true)
      expect(result.shadowClipping!.r).toBe(false)
      expect(result.shadowClipping!.g).toBe(true)
      expect(result.shadowClipping!.b).toBe(false)
    })

    it('sets per-channel clipping correctly', async () => {
      const mockPipeline = {
        computeFromPixels: vi.fn().mockImplementation(async () => {
          const red = new Uint32Array(256)
          const green = new Uint32Array(256)
          const blue = new Uint32Array(256)
          const luminance = new Uint32Array(256)

          // Red: highlight clipping only
          red[255] = 20

          // Green: shadow clipping only
          green[0] = 30

          // Blue: both highlight and shadow clipping
          blue[0] = 10
          blue[255] = 15

          return { red, green, blue, luminance }
        }),
        destroy: vi.fn(),
      }
      vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUHistogramService()
      await service.initialize()

      const pixels = createTestRgbaPixels(1, 1)
      const result = await service.computeHistogramRgba(pixels, 1, 1)

      // Overall clipping
      expect(result.hasHighlightClipping).toBe(true)
      expect(result.hasShadowClipping).toBe(true)

      // Per-channel highlight clipping
      expect(result.highlightClipping!.r).toBe(true)
      expect(result.highlightClipping!.g).toBe(false)
      expect(result.highlightClipping!.b).toBe(true)

      // Per-channel shadow clipping
      expect(result.shadowClipping!.r).toBe(false)
      expect(result.shadowClipping!.g).toBe(true)
      expect(result.shadowClipping!.b).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  // Helper functions for edge case tests
  function createBlackPixels(width: number, height: number): Uint8Array {
    return new Uint8Array(width * height * 3) // All zeros = black
  }

  function createWhitePixels(width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 3)
    pixels.fill(255) // All 255 = white
    return pixels
  }

  it('handles empty pixel array', async () => {
    const mockPipeline = {
      computeFromPixels: vi.fn().mockResolvedValue(createMockHistogramResult()),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = new Uint8Array(0)
    const result = await service.computeHistogram(pixels, 0, 0)

    expect(result.red).toBeInstanceOf(Uint32Array)
    expect(result.green).toBeInstanceOf(Uint32Array)
    expect(result.blue).toBeInstanceOf(Uint32Array)
    expect(result.luminance).toBeInstanceOf(Uint32Array)
    expect(mockPipeline.computeFromPixels).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      0,
      0
    )
  })

  it('handles single pixel (verify RGB conversion works)', async () => {
    let capturedRgba: Uint8Array | null = null
    const mockPipeline = {
      computeFromPixels: vi
        .fn()
        .mockImplementation(async (pixels: Uint8Array) => {
          capturedRgba = pixels.slice()
          return createMockHistogramResult()
        }),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = new Uint8Array([128, 64, 192]) // Single RGB pixel
    const result = await service.computeHistogram(pixels, 1, 1)

    expect(result).toBeDefined()
    expect(capturedRgba).not.toBeNull()
    expect(capturedRgba!.length).toBe(4) // Single RGBA pixel
    expect(capturedRgba![0]).toBe(128) // R
    expect(capturedRgba![1]).toBe(64) // G
    expect(capturedRgba![2]).toBe(192) // B
    expect(capturedRgba![3]).toBe(255) // A
  })

  it('handles large images (4096x4096)', async () => {
    const width = 4096
    const height = 4096
    const mockPipeline = {
      computeFromPixels: vi.fn().mockResolvedValue(createMockHistogramResult()),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = new Uint8Array(width * height * 3)

    // Should not throw
    await expect(
      service.computeHistogram(pixels, width, height)
    ).resolves.toBeDefined()

    expect(mockPipeline.computeFromPixels).toHaveBeenCalled()
  })

  it('handles non-square images (100x50)', async () => {
    const width = 100
    const height = 50
    let capturedWidth: number | null = null
    let capturedHeight: number | null = null

    const mockPipeline = {
      computeFromPixels: vi
        .fn()
        .mockImplementation(async (_pixels: Uint8Array, w: number, h: number) => {
          capturedWidth = w
          capturedHeight = h
          return createMockHistogramResult()
        }),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = new Uint8Array(width * height * 3)
    await service.computeHistogram(pixels, width, height)

    expect(capturedWidth).toBe(width)
    expect(capturedHeight).toBe(height)
  })

  it('all black image - should have shadow clipping, no highlight clipping', async () => {
    const mockResult = createMockHistogramResult()
    // All black pixels means all values are in bin 0
    mockResult.red[0] = 100
    mockResult.green[0] = 100
    mockResult.blue[0] = 100
    mockResult.red[255] = 0
    mockResult.green[255] = 0
    mockResult.blue[255] = 0

    const mockPipeline = {
      computeFromPixels: vi.fn().mockResolvedValue(mockResult),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = createBlackPixels(10, 10)
    const result = await service.computeHistogram(pixels, 10, 10)

    expect(result.hasShadowClipping).toBe(true)
    expect(result.shadowClipping!.r).toBe(true)
    expect(result.shadowClipping!.g).toBe(true)
    expect(result.shadowClipping!.b).toBe(true)
    expect(result.hasHighlightClipping).toBe(false)
    expect(result.highlightClipping!.r).toBe(false)
    expect(result.highlightClipping!.g).toBe(false)
    expect(result.highlightClipping!.b).toBe(false)
  })

  it('all white image - should have highlight clipping, no shadow clipping', async () => {
    const mockResult = createMockHistogramResult()
    // All white pixels means all values are in bin 255
    mockResult.red[255] = 100
    mockResult.green[255] = 100
    mockResult.blue[255] = 100
    mockResult.red[0] = 0
    mockResult.green[0] = 0
    mockResult.blue[0] = 0

    const mockPipeline = {
      computeFromPixels: vi.fn().mockResolvedValue(mockResult),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = createWhitePixels(10, 10)
    const result = await service.computeHistogram(pixels, 10, 10)

    expect(result.hasHighlightClipping).toBe(true)
    expect(result.highlightClipping!.r).toBe(true)
    expect(result.highlightClipping!.g).toBe(true)
    expect(result.highlightClipping!.b).toBe(true)
    expect(result.hasShadowClipping).toBe(false)
    expect(result.shadowClipping!.r).toBe(false)
    expect(result.shadowClipping!.g).toBe(false)
    expect(result.shadowClipping!.b).toBe(false)
  })

  it('mixed values - some clipping in specific channels', async () => {
    const mockResult = createMockHistogramResult()
    // Red channel: both shadow and highlight clipping
    mockResult.red[0] = 50
    mockResult.red[255] = 50
    // Green channel: only shadow clipping
    mockResult.green[0] = 30
    mockResult.green[255] = 0
    // Blue channel: only highlight clipping
    mockResult.blue[0] = 0
    mockResult.blue[255] = 40

    const mockPipeline = {
      computeFromPixels: vi.fn().mockResolvedValue(mockResult),
    }
    vi.mocked(getHistogramPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUHistogramService()
    await service.initialize()

    const pixels = createTestRgbPixels(10, 10)
    const result = await service.computeHistogram(pixels, 10, 10)

    // Overall clipping flags
    expect(result.hasHighlightClipping).toBe(true)
    expect(result.hasShadowClipping).toBe(true)

    // Per-channel highlight clipping
    expect(result.highlightClipping!.r).toBe(true)
    expect(result.highlightClipping!.g).toBe(false)
    expect(result.highlightClipping!.b).toBe(true)

    // Per-channel shadow clipping
    expect(result.shadowClipping!.r).toBe(true)
    expect(result.shadowClipping!.g).toBe(true)
    expect(result.shadowClipping!.b).toBe(false)
  })
})
