/**
 * Unit tests for GPUMaskService.
 *
 * Tests the GPU-accelerated mask service including:
 * - Service initialization and lifecycle
 * - RGB/RGBA pixel processing
 * - Masked adjustments with linear and radial gradients
 * - Adaptive backend selection
 * - Error handling and fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GPUMaskService,
  getGPUMaskService,
  resetGPUMaskService,
  applyMaskedAdjustmentsAdaptive,
} from './gpu-mask-service'
import type { MaskStackData } from '../decode/worker-messages'
import type { DecodedImage } from '../decode/types'

// ============================================================================
// Mock WebGPU API and Pipeline
// ============================================================================

// Mock the pipelines module
vi.mock('./pipelines', () => ({
  getMaskPipeline: vi.fn(),
  MaskPipeline: vi.fn(),
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
import { getMaskPipeline } from './pipelines'
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

function createTestMaskStack(): MaskStackData {
  return {
    linearMasks: [
      {
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 1,
        feather: 0.5,
        enabled: true,
        adjustments: { exposure: 0.5, contrast: 10 },
      },
    ],
    radialMasks: [
      {
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.3,
        radiusY: 0.4,
        rotation: 45, // degrees
        feather: 0.2,
        invert: false,
        enabled: true,
        adjustments: { saturation: 20, vibrance: 15 },
      },
    ],
  }
}

function createEmptyMaskStack(): MaskStackData {
  return {
    linearMasks: [],
    radialMasks: [],
  }
}

function createDisabledMaskStack(): MaskStackData {
  return {
    linearMasks: [
      {
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 1,
        feather: 0.5,
        enabled: false,
        adjustments: { exposure: 1.0 },
      },
    ],
    radialMasks: [
      {
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.3,
        radiusY: 0.4,
        rotation: 90,
        feather: 0.2,
        invert: false,
        enabled: false,
        adjustments: { saturation: 50 },
      },
    ],
  }
}

function createMockPipeline() {
  return {
    apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
      // Return modified pixels (simulate mask adjustment)
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
  resetGPUMaskService()
})

afterEach(() => {
  vi.clearAllMocks()
  resetGPUMaskService()
})

// ============================================================================
// GPUMaskService Tests
// ============================================================================

describe('GPUMaskService', () => {
  describe('initial state', () => {
    it('is not ready before initialization', () => {
      const service = new GPUMaskService()
      expect(service.isReady).toBe(false)
    })
  })

  describe('initialize', () => {
    it('initializes successfully with pipeline and sets isReady', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      const result = await service.initialize()

      expect(result).toBe(true)
      expect(service.isReady).toBe(true)
      expect(getMaskPipeline).toHaveBeenCalled()
    })

    it('returns false when pipeline initialization fails', async () => {
      vi.mocked(getMaskPipeline).mockRejectedValue(
        new Error('Pipeline failed')
      )

      const service = new GPUMaskService()
      const result = await service.initialize()

      expect(result).toBe(false)
      expect(service.isReady).toBe(false)
    })

    it('handles multiple initialize calls (only initializes once)', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()
      await service.initialize()

      expect(getMaskPipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('applyMaskedAdjustments', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUMaskService()
      const pixels = createTestRgbPixels(2, 2)
      const maskStack = createTestMaskStack()

      await expect(
        service.applyMaskedAdjustments(pixels, 2, 2, maskStack)
      ).rejects.toThrow('not initialized')
    })

    it('returns copy of input when no enabled masks (early exit)', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const emptyMaskStack = createEmptyMaskStack()

      const result = await service.applyMaskedAdjustments(
        pixels,
        2,
        2,
        emptyMaskStack
      )

      // Should return a copy without calling pipeline
      expect(mockPipeline.apply).not.toHaveBeenCalled()
      expect(result.pixels).toEqual(pixels)
      expect(result.pixels).not.toBe(pixels) // Should be a copy
    })

    it('converts RGB to RGBA, calls pipeline, converts back to RGB', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const maskStack = createTestMaskStack()

      await service.applyMaskedAdjustments(pixels, 2, 2, maskStack)

      // Check that RGBA was passed to pipeline
      const passedPixels = mockPipeline.apply.mock.calls[0][0] as Uint8Array
      expect(passedPixels.length).toBe(2 * 2 * 4) // RGBA
    })

    it('returns correct DecodedImage structure', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const maskStack = createTestMaskStack()

      const result = await service.applyMaskedAdjustments(pixels, 2, 2, maskStack)

      expect(result.width).toBe(2)
      expect(result.height).toBe(2)
      expect(result.pixels.length).toBe(2 * 2 * 3) // RGB
      expect(mockPipeline.apply).toHaveBeenCalled()
    })
  })

  describe('applyMaskedAdjustmentsRgba', () => {
    it('throws error when not initialized', async () => {
      const service = new GPUMaskService()
      const pixels = createTestRgbaPixels(2, 2)
      const maskStack = createTestMaskStack()

      await expect(
        service.applyMaskedAdjustmentsRgba(pixels, 2, 2, maskStack)
      ).rejects.toThrow('not initialized')
    })

    it('returns copy of input when no enabled masks', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      const emptyMaskStack = createEmptyMaskStack()

      const result = await service.applyMaskedAdjustmentsRgba(
        pixels,
        2,
        2,
        emptyMaskStack
      )

      expect(mockPipeline.apply).not.toHaveBeenCalled()
      expect(result).toEqual(pixels)
      expect(result).not.toBe(pixels) // Should be a copy
    })

    it('passes RGBA directly to pipeline without conversion', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbaPixels(2, 2)
      const maskStack = createTestMaskStack()

      const result = await service.applyMaskedAdjustmentsRgba(
        pixels,
        2,
        2,
        maskStack
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
    it('resets service state (isReady becomes false)', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
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
  it('getGPUMaskService returns same instance', () => {
    const service1 = getGPUMaskService()
    const service2 = getGPUMaskService()

    expect(service1).toBe(service2)
  })

  it('resetGPUMaskService destroys old instance and creates new one', () => {
    const service1 = getGPUMaskService()
    resetGPUMaskService()
    const service2 = getGPUMaskService()

    expect(service1).not.toBe(service2)
  })
})

// ============================================================================
// Adaptive Processing Tests
// ============================================================================

describe('applyMaskedAdjustmentsAdaptive', () => {
  it('uses GPU when service is ready', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUMaskService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const maskStack = createTestMaskStack()
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    } as DecodedImage)

    const { backend } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
      wasmFallback
    )

    expect(backend).toBe('webgpu')
    expect(wasmFallback).not.toHaveBeenCalled()
  })

  it('falls back to WASM when GPU not ready', async () => {
    resetGPUMaskService()

    const pixels = createTestRgbPixels(2, 2)
    const maskStack = createTestMaskStack()
    const expectedResult: DecodedImage = {
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    }
    const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

    const { result, backend } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
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
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUMaskService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const maskStack = createTestMaskStack()
    const expectedResult: DecodedImage = {
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    }
    const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

    const { backend } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
      wasmFallback
    )

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
  })

  it('includes timing in result', async () => {
    resetGPUMaskService()

    const pixels = createTestRgbPixels(2, 2)
    const maskStack = createTestMaskStack()
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    })

    const { timing } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
      wasmFallback
    )

    expect(timing).toBeGreaterThanOrEqual(0)
  })

  it('returns correct backend indicator (webgpu or wasm)', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUMaskService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const maskStack = createTestMaskStack()
    const wasmFallback = vi.fn()

    const { backend: gpuBackend } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
      wasmFallback
    )
    expect(gpuBackend).toBe('webgpu')

    // Reset and try WASM path
    resetGPUMaskService()
    wasmFallback.mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    })

    const { backend: wasmBackend } = await applyMaskedAdjustmentsAdaptive(
      pixels,
      2,
      2,
      maskStack,
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
        apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
          capturedRgba = pixels.slice()
          return pixels
        }),
      }
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      // Single pixel: R=100, G=150, B=200
      const rgbPixels = new Uint8Array([100, 150, 200])
      const maskStack = createTestMaskStack()

      await service.applyMaskedAdjustments(rgbPixels, 1, 1, maskStack)

      expect(capturedRgba).not.toBeNull()
      expect(capturedRgba!.length).toBe(4)
      expect(capturedRgba![0]).toBe(100) // R
      expect(capturedRgba![1]).toBe(150) // G
      expect(capturedRgba![2]).toBe(200) // B
      expect(capturedRgba![3]).toBe(255) // A (fully opaque)
    })
  })

  describe('RGBA to RGB conversion', () => {
    it('strips alpha channel', async () => {
      const mockPipeline = {
        apply: vi.fn().mockImplementation(async () => {
          // Return RGBA: R=110, G=160, B=210, A=255
          return new Uint8Array([110, 160, 210, 255])
        }),
      }
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const rgbPixels = new Uint8Array([100, 150, 200])
      const maskStack = createTestMaskStack()

      const result = await service.applyMaskedAdjustments(
        rgbPixels,
        1,
        1,
        maskStack
      )

      expect(result.pixels.length).toBe(3)
      expect(result.pixels[0]).toBe(110) // R
      expect(result.pixels[1]).toBe(160) // G
      expect(result.pixels[2]).toBe(210) // B
    })
  })

  describe('toGPUMaskStack conversion', () => {
    it('converts radial mask rotation from degrees to radians', async () => {
      let capturedMaskStack: any = null
      const mockPipeline = {
        apply: vi.fn().mockImplementation(
          async (
            pixels: Uint8Array,
            _w: number,
            _h: number,
            maskStack: any
          ) => {
            capturedMaskStack = maskStack
            return pixels
          }
        ),
      }
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbaPixels(1, 1)
      // Create mask with 90 degrees rotation
      const maskStack: MaskStackData = {
        linearMasks: [],
        radialMasks: [
          {
            centerX: 0.5,
            centerY: 0.5,
            radiusX: 0.3,
            radiusY: 0.4,
            rotation: 90, // degrees
            feather: 0.2,
            invert: false,
            enabled: true,
            adjustments: { exposure: 0.5 },
          },
        ],
      }

      await service.applyMaskedAdjustmentsRgba(pixels, 1, 1, maskStack)

      expect(capturedMaskStack).not.toBeNull()
      // 90 degrees = PI/2 radians
      const expectedRadians = (90 * Math.PI) / 180
      expect(capturedMaskStack.radialMasks[0].rotation).toBeCloseTo(
        expectedRadians,
        10
      )
    })
  })

  describe('hasEnabledMasks', () => {
    it('returns true when at least one mask enabled', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const maskStack = createTestMaskStack() // Has enabled masks

      await service.applyMaskedAdjustments(pixels, 2, 2, maskStack)

      // Pipeline should be called because masks are enabled
      expect(mockPipeline.apply).toHaveBeenCalled()
    })

    it('returns false when all masks disabled', async () => {
      const mockPipeline = createMockPipeline()
      vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUMaskService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const disabledMaskStack = createDisabledMaskStack()

      await service.applyMaskedAdjustments(pixels, 2, 2, disabledMaskStack)

      // Pipeline should NOT be called because all masks are disabled
      expect(mockPipeline.apply).not.toHaveBeenCalled()
    })
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
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUMaskService()
    await service.initialize()

    const pixels = new Uint8Array(0)
    const maskStack = createTestMaskStack()

    const result = await service.applyMaskedAdjustments(pixels, 0, 0, maskStack)

    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
    expect(result.pixels.length).toBe(0)
  })

  it('handles single pixel', async () => {
    let capturedRgba: Uint8Array | null = null
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
        capturedRgba = pixels.slice()
        return pixels
      }),
    }
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUMaskService()
    await service.initialize()

    const pixels = new Uint8Array([50, 100, 150]) // Single RGB pixel
    const maskStack = createTestMaskStack()

    const result = await service.applyMaskedAdjustments(pixels, 1, 1, maskStack)

    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.pixels.length).toBe(3)
    expect(capturedRgba).not.toBeNull()
    expect(capturedRgba!.length).toBe(4) // Single RGBA pixel
  })

  it('handles large images (4096x4096)', async () => {
    const width = 4096
    const height = 4096
    const mockPipeline = {
      apply: vi.fn().mockResolvedValue(new Uint8Array(width * height * 4)),
    }
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUMaskService()
    await service.initialize()

    const pixels = new Uint8Array(width * height * 3)
    const maskStack = createTestMaskStack()

    const result = await service.applyMaskedAdjustments(
      pixels,
      width,
      height,
      maskStack
    )

    expect(result.width).toBe(width)
    expect(result.height).toBe(height)
    expect(mockPipeline.apply).toHaveBeenCalled()
  })

  it('handles mix of enabled/disabled masks', async () => {
    const mockPipeline = createMockPipeline()
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUMaskService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const mixedMaskStack: MaskStackData = {
      linearMasks: [
        {
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 1,
          feather: 0.5,
          enabled: false, // disabled
          adjustments: { exposure: 1.0 },
        },
        {
          startX: 0,
          startY: 0,
          endX: 0.5,
          endY: 0.5,
          feather: 0.3,
          enabled: true, // enabled
          adjustments: { contrast: 20 },
        },
      ],
      radialMasks: [
        {
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.2,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.1,
          invert: true,
          enabled: false, // disabled
          adjustments: { saturation: -10 },
        },
      ],
    }

    await service.applyMaskedAdjustments(pixels, 2, 2, mixedMaskStack)

    // Pipeline should be called because at least one mask is enabled
    expect(mockPipeline.apply).toHaveBeenCalled()
  })

  it('handles multiple pixels correctly during RGB/RGBA conversion', async () => {
    let capturedRgba: Uint8Array | null = null
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => {
        capturedRgba = pixels.slice()
        return pixels
      }),
    }
    vi.mocked(getMaskPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUMaskService()
    await service.initialize()

    // 2 pixels: [R1, G1, B1, R2, G2, B2]
    const rgbPixels = new Uint8Array([100, 150, 200, 50, 100, 150])
    const maskStack = createTestMaskStack()

    await service.applyMaskedAdjustments(rgbPixels, 2, 1, maskStack)

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
