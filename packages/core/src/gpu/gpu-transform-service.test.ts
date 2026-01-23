/**
 * Unit tests for GPUTransformService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the rotation pipeline module - MUST be before imports that use it
vi.mock('./pipelines/rotation-pipeline', () => ({
  getRotationPipeline: vi.fn().mockResolvedValue(null),
  resetRotationPipeline: vi.fn(),
  RotationPipeline: vi.fn(),
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
import type { DecodedImage } from '../decode/types'
import {
  GPUTransformService,
  getGPUTransformService,
  resetGPUTransformService,
  applyRotationAdaptive,
} from './gpu-transform-service'
import { getRotationPipeline } from './pipelines/rotation-pipeline'

// Test fixtures
function createTestRgbPixels(width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const pixels = new Uint8Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 3] = 128
    pixels[i * 3 + 1] = 64
    pixels[i * 3 + 2] = 192
  }
  return pixels
}

function createMockRotationPipeline() {
  return {
    apply: vi.fn().mockImplementation(
      async (pixels: Uint8Array, width: number, height: number) => {
        const result = new Uint8Array(pixels.length)
        for (let i = 0; i < pixels.length; i++) {
          result[i] = pixels[i]
        }
        return { pixels: result, width, height }
      }
    ),
    destroy: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetGPUTransformService()
})

afterEach(() => {
  vi.clearAllMocks()
  resetGPUTransformService()
})

describe('GPUTransformService', () => {
  describe('initial state', () => {
    it('is not ready before initialization', () => {
      const service = new GPUTransformService()
      expect(service.isReady).toBe(false)
    })
  })

  describe('initialize', () => {
    it('initializes successfully with pipeline', async () => {
      const mockPipeline = createMockRotationPipeline()
      vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUTransformService()
      const result = await service.initialize()

      expect(result).toBe(true)
      expect(service.isReady).toBe(true)
    })

    it('returns false when pipeline initialization fails', async () => {
      vi.mocked(getRotationPipeline).mockRejectedValue(new Error('Failed'))

      const service = new GPUTransformService()
      const result = await service.initialize()

      expect(result).toBe(false)
      expect(service.isReady).toBe(false)
    })

    it('handles multiple initialize calls', async () => {
      const mockPipeline = createMockRotationPipeline()
      vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUTransformService()
      await service.initialize()
      await service.initialize()

      expect(getRotationPipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroy', () => {
    it('resets service state', async () => {
      const mockPipeline = createMockRotationPipeline()
      vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUTransformService()
      await service.initialize()
      expect(service.isReady).toBe(true)

      service.destroy()
      expect(service.isReady).toBe(false)
    })
  })

  describe('applyRotation', () => {
    it('throws when not initialized', async () => {
      const service = new GPUTransformService()
      const pixels = createTestRgbPixels(2, 2)

      await expect(service.applyRotation(pixels, 2, 2, 45)).rejects.toThrow('not initialized')
    })

    it('fast path for near-zero angles', async () => {
      const mockPipeline = createMockRotationPipeline()
      vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUTransformService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      const result = await service.applyRotation(pixels, 2, 2, 0.0001)

      expect(mockPipeline.apply).not.toHaveBeenCalled()
      expect(result.pixels).toEqual(pixels)
      expect(result.pixels).not.toBe(pixels)
    })

    it('calls pipeline for non-zero angles', async () => {
      const mockPipeline = createMockRotationPipeline()
      vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

      const service = new GPUTransformService()
      await service.initialize()

      const pixels = createTestRgbPixels(2, 2)
      await service.applyRotation(pixels, 2, 2, 45)

      expect(mockPipeline.apply).toHaveBeenCalledWith(pixels, 2, 2, 45)
    })
  })
})

describe('singleton management', () => {
  it('getGPUTransformService returns same instance', () => {
    const service1 = getGPUTransformService()
    const service2 = getGPUTransformService()
    expect(service1).toBe(service2)
  })

  it('resetGPUTransformService creates new instance', () => {
    const service1 = getGPUTransformService()
    resetGPUTransformService()
    const service2 = getGPUTransformService()
    expect(service1).not.toBe(service2)
  })
})

describe('applyRotationAdaptive', () => {
  it('uses GPU when ready', async () => {
    const mockPipeline = createMockRotationPipeline()
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUTransformService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    } as DecodedImage)

    const { backend } = await applyRotationAdaptive(pixels, 2, 2, 45, wasmFallback)

    expect(backend).toBe('webgpu')
    expect(wasmFallback).not.toHaveBeenCalled()
  })

  it('falls back to WASM when GPU not ready', async () => {
    // Reset mock to return null (no pipeline available)
    vi.mocked(getRotationPipeline).mockResolvedValue(null)
    resetGPUTransformService()

    const pixels = createTestRgbPixels(2, 2)
    const expectedResult: DecodedImage = { pixels: pixels.slice(), width: 2, height: 2 }
    const wasmFallback = vi.fn().mockResolvedValue(expectedResult)

    const { result, backend } = await applyRotationAdaptive(pixels, 2, 2, 45, wasmFallback)

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
    expect(result).toBe(expectedResult)
  })

  it('falls back to WASM on GPU error', async () => {
    const mockPipeline = { apply: vi.fn().mockRejectedValue(new Error('GPU error')) }
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = getGPUTransformService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    })

    const { backend } = await applyRotationAdaptive(pixels, 2, 2, 45, wasmFallback)

    expect(backend).toBe('wasm')
    expect(wasmFallback).toHaveBeenCalled()
  })

  it('includes timing', async () => {
    // Reset mock to return null (no pipeline available) to test WASM path
    vi.mocked(getRotationPipeline).mockResolvedValue(null)
    resetGPUTransformService()

    const pixels = createTestRgbPixels(2, 2)
    const wasmFallback = vi.fn().mockResolvedValue({
      pixels: pixels.slice(),
      width: 2,
      height: 2,
    })

    const { timing } = await applyRotationAdaptive(pixels, 2, 2, 45, wasmFallback)

    expect(timing).toBeGreaterThanOrEqual(0)
  })
})

describe('edge cases', () => {
  it('handles 0x0 image', async () => {
    const mockPipeline = {
      apply: vi.fn().mockResolvedValue({ pixels: new Uint8Array(0), width: 0, height: 0 }),
    }
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUTransformService()
    await service.initialize()

    const result = await service.applyRotation(new Uint8Array(0), 0, 0, 45)

    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('handles 1x1 image', async () => {
    const mockPipeline = {
      apply: vi.fn().mockImplementation(async (pixels: Uint8Array) => ({
        pixels: new Uint8Array(pixels),
        width: 1,
        height: 1,
      })),
    }
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUTransformService()
    await service.initialize()

    const pixels = new Uint8Array([50, 100, 150])
    const result = await service.applyRotation(pixels, 1, 1, 45)

    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })

  it('handles various rotation angles', async () => {
    const mockPipeline = createMockRotationPipeline()
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUTransformService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)
    const angles = [45, 90, 180, 270, 360, -45, -90, 720]

    for (const angle of angles) {
      mockPipeline.apply.mockClear()
      await service.applyRotation(pixels, 2, 2, angle)
      expect(mockPipeline.apply).toHaveBeenCalledWith(pixels, 2, 2, angle)
    }
  })

  it('fast path for small angles', async () => {
    const mockPipeline = createMockRotationPipeline()
    vi.mocked(getRotationPipeline).mockResolvedValue(mockPipeline as any)

    const service = new GPUTransformService()
    await service.initialize()

    const pixels = createTestRgbPixels(2, 2)

    // Below threshold
    await service.applyRotation(pixels, 2, 2, 0.0005)
    expect(mockPipeline.apply).not.toHaveBeenCalled()

    // Above threshold
    await service.applyRotation(pixels, 2, 2, 0.002)
    expect(mockPipeline.apply).toHaveBeenCalled()
  })
})
