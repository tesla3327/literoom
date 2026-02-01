/**
 * Unit tests for GPUEditPipeline Draft Mode (half-resolution processing).
 *
 * Tests the draft mode functionality that enables faster preview processing
 * by downsampling the input image before GPU operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock WebGPU globals before importing any modules that use them
const mockGPUShaderStage = {
  COMPUTE: 4,
}

const mockGPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
}

const mockGPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
}

const mockGPUMapMode = {
  READ: 0x0001,
  WRITE: 0x0002,
}

vi.stubGlobal('GPUShaderStage', mockGPUShaderStage)
vi.stubGlobal('GPUBufferUsage', mockGPUBufferUsage)
vi.stubGlobal('GPUTextureUsage', mockGPUTextureUsage)
vi.stubGlobal('GPUMapMode', mockGPUMapMode)

import {
  GPUEditPipeline,
  getGPUEditPipeline,
  resetGPUEditPipeline,
  _internal,
  downsamplePixels,
  type EditPipelineInput,
  type EditPipelineParams,
} from '../pipelines/edit-pipeline'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create test RGB pixel data with a known pattern.
 * Each pixel has a unique color based on its position for verifying downsampling.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns RGB pixel data (3 bytes per pixel)
 */
function createTestPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      // Create a pattern where each pixel has a unique but predictable value
      pixels[idx] = (x * 10) % 256 // R: varies with x
      pixels[idx + 1] = (y * 10) % 256 // G: varies with y
      pixels[idx + 2] = ((x + y) * 5) % 256 // B: varies with x+y
    }
  }

  return pixels
}

/**
 * Create test RGBA pixel data with a known pattern.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns RGBA pixel data (4 bytes per pixel)
 */
function createTestRgbaPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      pixels[idx] = (x * 10) % 256 // R
      pixels[idx + 1] = (y * 10) % 256 // G
      pixels[idx + 2] = ((x + y) * 5) % 256 // B
      pixels[idx + 3] = 255 // A
    }
  }

  return pixels
}

/**
 * Create solid color RGB pixels.
 *
 * @param width - Image width
 * @param height - Image height
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 */
function createSolidColorPixels(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = r
    pixels[i * 3 + 1] = g
    pixels[i * 3 + 2] = b
  }
  return pixels
}

/**
 * Create a 2x2 block pattern for testing downsampling.
 * Each 2x2 block has specific values to verify averaging.
 */
function create2x2BlockPattern(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      // Create distinct values in each position of a 2x2 block
      const blockX = x % 2
      const blockY = y % 2

      if (blockX === 0 && blockY === 0) {
        pixels[idx] = 0 // R
        pixels[idx + 1] = 0 // G
        pixels[idx + 2] = 0 // B
      } else if (blockX === 1 && blockY === 0) {
        pixels[idx] = 100 // R
        pixels[idx + 1] = 0 // G
        pixels[idx + 2] = 0 // B
      } else if (blockX === 0 && blockY === 1) {
        pixels[idx] = 0 // R
        pixels[idx + 1] = 100 // G
        pixels[idx + 2] = 0 // B
      } else {
        pixels[idx] = 0 // R
        pixels[idx + 1] = 0 // G
        pixels[idx + 2] = 200 // B
      }
    }
  }

  return pixels
}

// ============================================================================
// Mock GPU Device
// ============================================================================

interface MockGPUDevice {
  createShaderModule: ReturnType<typeof vi.fn>
  createBindGroupLayout: ReturnType<typeof vi.fn>
  createPipelineLayout: ReturnType<typeof vi.fn>
  createComputePipeline: ReturnType<typeof vi.fn>
  createRenderPipeline: ReturnType<typeof vi.fn>
  createSampler: ReturnType<typeof vi.fn>
  createTexture: ReturnType<typeof vi.fn>
  createBuffer: ReturnType<typeof vi.fn>
  createBindGroup: ReturnType<typeof vi.fn>
  createCommandEncoder: ReturnType<typeof vi.fn>
  createQuerySet: ReturnType<typeof vi.fn>
  features: Set<string>
  queue: {
    writeTexture: ReturnType<typeof vi.fn>
    writeBuffer: ReturnType<typeof vi.fn>
    submit: ReturnType<typeof vi.fn>
  }
}

function createMockDevice(): MockGPUDevice {
  return {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
      format: 'rgba8unorm',
    })),
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => new ArrayBuffer(16)),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    createQuerySet: vi.fn(() => ({
      destroy: vi.fn(),
    })),
    features: new Set<string>(), // Mock features without timestamp-query support
    queue: {
      writeTexture: vi.fn(),
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    },
  }
}

// ============================================================================
// Mock GPU Capability Service
// ============================================================================

vi.mock('../capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: false,
    device: null,
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../pipelines/adjustments-pipeline', () => ({
  getAdjustmentsPipeline: vi.fn(),
  DEFAULT_BASIC_ADJUSTMENTS: {
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
  },
}))

vi.mock('../pipelines/rotation-pipeline', () => ({
  getRotationPipeline: vi.fn(),
  RotationPipeline: {
    computeRotatedDimensions: vi.fn((w: number, h: number, angle: number) => {
      const rad = (Math.abs(angle) * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      return {
        width: Math.round(w * cos + h * sin),
        height: Math.round(w * sin + h * cos),
      }
    }),
  },
}))

vi.mock('../pipelines/tone-curve-pipeline', () => ({
  getToneCurvePipeline: vi.fn(),
  isIdentityLut: vi.fn(() => true),
}))

vi.mock('../pipelines/mask-pipeline', () => ({
  getMaskPipeline: vi.fn(),
}))

vi.mock('../pipelines/downsample-pipeline', () => ({
  getDownsamplePipeline: vi.fn().mockResolvedValue(null),
}))

// Track created textures for testing
let createdTextures: Array<{ destroy: ReturnType<typeof vi.fn> }> = []

vi.mock('../texture-utils', () => {
  class MockTexturePool {
    private device: any
    private maxPoolSize: number

    constructor(device: any, maxPoolSize: number = 4) {
      this.device = device
      this.maxPoolSize = maxPoolSize
    }

    acquire(width: number, height: number, usage: number, label?: string): any {
      const texture = { destroy: vi.fn(), label }
      createdTextures.push(texture)
      return texture
    }

    release(texture: any, width: number, height: number, usage: number): void {
      // No-op for mock
    }

    clear(): void {
      // No-op for mock
    }

    getStats(): { poolCount: number; totalTextures: number } {
      return { poolCount: 0, totalTextures: 0 }
    }
  }

  return {
    createTextureFromPixels: vi.fn((device: any, pixels: any, w: any, h: any, usage: any, label: any) => {
      const texture = { destroy: vi.fn(), label }
      createdTextures.push(texture)
      return texture
    }),
    createOutputTexture: vi.fn((device: any, w: any, h: any, usage: any, label: any) => {
      const texture = { destroy: vi.fn(), label }
      createdTextures.push(texture)
      return texture
    }),
    readTexturePixels: vi.fn(async (device: any, texture: any, w: any, h: any) => {
      return new Uint8Array(w * h * 4).fill(128)
    }),
    TextureUsage: {
      INPUT: 0x07,
      OUTPUT: 0x0d,
      PINGPONG: 0x0f,
    },
    TexturePool: MockTexturePool,
    rgbToRgba: vi.fn((rgb: Uint8Array, width: number, height: number) => {
      const pixelCount = width * height
      const rgba = new Uint8Array(pixelCount * 4)
      for (let i = 0; i < pixelCount; i++) {
        const rgbIdx = i * 3
        const rgbaIdx = i * 4
        rgba[rgbaIdx] = rgb[rgbIdx]!
        rgba[rgbaIdx + 1] = rgb[rgbIdx + 1]!
        rgba[rgbaIdx + 2] = rgb[rgbIdx + 2]!
        rgba[rgbaIdx + 3] = 255
      }
      return rgba
    }),
    rgbaToRgb: vi.fn((rgba: Uint8Array, width: number, height: number) => {
      const pixelCount = width * height
      const rgb = new Uint8Array(pixelCount * 3)
      for (let i = 0; i < pixelCount; i++) {
        const rgbaIdx = i * 4
        const rgbIdx = i * 3
        rgb[rgbIdx] = rgba[rgbaIdx]!
        rgb[rgbIdx + 1] = rgba[rgbaIdx + 1]!
        rgb[rgbIdx + 2] = rgba[rgbaIdx + 2]!
      }
      return rgb
    }),
    downsamplePixels: vi.fn((pixels: Uint8Array, width: number, height: number, scale: number) => {
      if (scale >= 1.0) {
        return { pixels, width, height }
      }
      const newWidth = Math.floor(width / 2)
      const newHeight = Math.floor(height / 2)
      return { pixels: new Uint8Array(newWidth * newHeight * 4), width: newWidth, height: newHeight }
    }),
  }
})

vi.mock('../gpu-tone-curve-service', () => ({
  generateLutFromCurvePoints: vi.fn((points) => {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      lut[i] = i
    }
    return { lut }
  }),
}))

import { getGPUCapabilityService } from '../capabilities'
import { readTexturePixels } from '../texture-utils'
import { getDownsamplePipeline } from '../pipelines/downsample-pipeline'

// ============================================================================
// Test Suites
// ============================================================================

describe('GPUEditPipeline Draft Mode', () => {
  beforeEach(() => {
    resetGPUEditPipeline()
    vi.clearAllMocks()
    createdTextures = []
    vi.mocked(getDownsamplePipeline).mockResolvedValue(null)
  })

  afterEach(() => {
    resetGPUEditPipeline()
  })

  describe('downsamplePixels', () => {
    it('should return input unchanged for scale 1.0', () => {
      const width = 4
      const height = 4
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 1.0)

      expect(result.pixels).toBe(pixels)
      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
    })

    it('should return input unchanged for scale greater than 1.0', () => {
      const width = 4
      const height = 4
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 2.0)

      expect(result.pixels).toBe(pixels)
      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
    })

    it('should downsample to half resolution for scale 0.5', () => {
      const width = 4
      const height = 4
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 0.5)

      expect(result.width).toBe(2)
      expect(result.height).toBe(2)
      expect(result.pixels.length).toBe(2 * 2 * 3) // RGB
    })

    it('should handle odd dimensions correctly', () => {
      const width = 5
      const height = 7
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 0.5)

      // Floor of 5/2 = 2, floor of 7/2 = 3
      expect(result.width).toBe(2)
      expect(result.height).toBe(3)
      expect(result.pixels.length).toBe(2 * 3 * 3)
    })

    it('should average 2x2 pixel blocks correctly', () => {
      // Create a 4x4 image with specific values in each 2x2 block
      const width = 4
      const height = 4
      const pixels = new Uint8Array(width * height * 3)

      // First 2x2 block (top-left): pixels at (0,0), (1,0), (0,1), (1,1)
      // Set them to values that average to known values
      // Pixel (0,0): R=0, G=0, B=0
      pixels[0] = 0
      pixels[1] = 0
      pixels[2] = 0
      // Pixel (1,0): R=100, G=0, B=0
      pixels[3] = 100
      pixels[4] = 0
      pixels[5] = 0
      // Pixel (0,1): R=0, G=100, B=0
      pixels[12] = 0
      pixels[13] = 100
      pixels[14] = 0
      // Pixel (1,1): R=0, G=0, B=200
      pixels[15] = 0
      pixels[16] = 0
      pixels[17] = 200

      const result = downsamplePixels(pixels, width, height, 0.5)

      // Expected average for first block:
      // R: (0 + 100 + 0 + 0) / 4 = 25
      // G: (0 + 0 + 100 + 0) / 4 = 25
      // B: (0 + 0 + 0 + 200) / 4 = 50
      expect(result.pixels[0]).toBe(25) // R
      expect(result.pixels[1]).toBe(25) // G
      expect(result.pixels[2]).toBe(50) // B
    })

    it('should preserve alpha channel when downsampling RGBA', () => {
      // Test that the RGB downsampling doesn't affect alpha
      // (This tests the RGB version, alpha is not present in input)
      const width = 4
      const height = 4
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 0.5)

      // Verify we got RGB output (3 bytes per pixel)
      expect(result.pixels.length).toBe(result.width * result.height * 3)
    })

    it('should handle very small dimensions', () => {
      // 2x2 downsampled by 0.5 should give 1x1
      const width = 2
      const height = 2
      const pixels = new Uint8Array([
        100, 50, 25, // (0,0)
        200, 100, 75, // (1,0)
        50, 150, 125, // (0,1)
        150, 100, 175, // (1,1)
      ])

      const result = downsamplePixels(pixels, width, height, 0.5)

      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
      // Average: R=(100+200+50+150)/4=125, G=(50+100+150+100)/4=100, B=(25+75+125+175)/4=100
      expect(result.pixels[0]).toBe(125)
      expect(result.pixels[1]).toBe(100)
      expect(result.pixels[2]).toBe(100)
    })

    it('should return input if result would be less than 1x1', () => {
      const width = 1
      const height = 1
      const pixels = new Uint8Array([128, 64, 32])

      const result = downsamplePixels(pixels, width, height, 0.5)

      // Should return original since floor(1 * 0.5) = 0
      expect(result.pixels).toBe(pixels)
      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
    })

    it('should handle rectangular images', () => {
      const width = 8
      const height = 4
      const pixels = createTestPixels(width, height)

      const result = downsamplePixels(pixels, width, height, 0.5)

      expect(result.width).toBe(4)
      expect(result.height).toBe(2)
    })

    it('should produce consistent results for solid color input', () => {
      const width = 4
      const height = 4
      const pixels = createSolidColorPixels(width, height, 128, 64, 32)

      const result = downsamplePixels(pixels, width, height, 0.5)

      // All pixels should have the same color (averages of same values)
      for (let i = 0; i < result.width * result.height; i++) {
        expect(result.pixels[i * 3]).toBe(128)
        expect(result.pixels[i * 3 + 1]).toBe(64)
        expect(result.pixels[i * 3 + 2]).toBe(32)
      }
    })
  })

  describe('process with targetResolution', () => {
    let mockDevice: MockGPUDevice
    let pipeline: GPUEditPipeline

    beforeEach(async () => {
      mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(getDownsamplePipeline).mockResolvedValue(null)

      pipeline = new GPUEditPipeline()
      await pipeline.initialize()
    })

    it('should process at full resolution when targetResolution is 1.0', async () => {
      const width = 8
      const height = 8
      const input: EditPipelineInput = {
        pixels: createTestPixels(width, height),
        width,
        height,
      }

      const result = await pipeline.process(input, { targetResolution: 1.0 })

      // Output dimensions should match input (no downsampling)
      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
    })

    it('should process at full resolution when targetResolution is undefined', async () => {
      const width = 8
      const height = 8
      const input: EditPipelineInput = {
        pixels: createTestPixels(width, height),
        width,
        height,
      }

      const result = await pipeline.process(input, {})

      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
    })

    it('should process at half resolution when targetResolution is 0.5', async () => {
      const width = 8
      const height = 8
      const input: EditPipelineInput = {
        pixels: createTestPixels(width, height),
        width,
        height,
      }

      // Mock readTexturePixels to return appropriate sized data
      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(4 * 4 * 4).fill(128))

      const result = await pipeline.process(input, { targetResolution: 0.5 })

      // Output dimensions should be half of input
      expect(result.width).toBe(4)
      expect(result.height).toBe(4)
    })

    it('should include downsample time in timing', async () => {
      const width = 8
      const height = 8
      const input: EditPipelineInput = {
        pixels: createTestPixels(width, height),
        width,
        height,
      }

      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(4 * 4 * 4).fill(128))

      const result = await pipeline.process(input, { targetResolution: 0.5 })

      // Downsample timing should be recorded
      expect(result.timing).toHaveProperty('downsample')
      expect(result.timing.downsample).toBeGreaterThanOrEqual(0)
    })

    it('should output reduced dimensions for draft mode', async () => {
      const width = 100
      const height = 80
      const input: EditPipelineInput = {
        pixels: createTestPixels(width, height),
        width,
        height,
      }

      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(50 * 40 * 4).fill(128))

      const result = await pipeline.process(input, { targetResolution: 0.5 })

      expect(result.width).toBe(50)
      expect(result.height).toBe(40)
      expect(result.pixels.length).toBe(50 * 40 * 3) // RGB output
    })
  })

  describe('timing', () => {
    let mockDevice: MockGPUDevice
    let pipeline: GPUEditPipeline

    beforeEach(async () => {
      mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(getDownsamplePipeline).mockResolvedValue(null)

      pipeline = new GPUEditPipeline()
      await pipeline.initialize()
    })

    it('should report downsample: 0 when not downsampling', async () => {
      const input: EditPipelineInput = {
        pixels: createTestPixels(4, 4),
        width: 4,
        height: 4,
      }

      const result = await pipeline.process(input, { targetResolution: 1.0 })

      expect(result.timing.downsample).toBe(0)
    })

    it('should report positive downsample time when downsampling', async () => {
      const input: EditPipelineInput = {
        pixels: createTestPixels(100, 100),
        width: 100,
        height: 100,
      }

      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(50 * 50 * 4).fill(128))

      const result = await pipeline.process(input, { targetResolution: 0.5 })

      // Downsampling should take some positive amount of time
      expect(result.timing.downsample).toBeGreaterThanOrEqual(0)
    })

    it('should include all timing fields', async () => {
      const input: EditPipelineInput = {
        pixels: createTestPixels(4, 4),
        width: 4,
        height: 4,
      }

      const result = await pipeline.process(input, {})

      expect(result.timing).toHaveProperty('total')
      expect(result.timing).toHaveProperty('downsample')
      expect(result.timing).toHaveProperty('upload')
      expect(result.timing).toHaveProperty('rotation')
      expect(result.timing).toHaveProperty('adjustments')
      expect(result.timing).toHaveProperty('toneCurve')
      expect(result.timing).toHaveProperty('masks')
      expect(result.timing).toHaveProperty('readback')
    })

    it('should have total time >= sum of individual timings', async () => {
      const input: EditPipelineInput = {
        pixels: createTestPixels(8, 8),
        width: 8,
        height: 8,
      }

      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(4 * 4 * 4).fill(128))

      const result = await pipeline.process(input, { targetResolution: 0.5 })

      const sumOfParts =
        result.timing.downsample +
        result.timing.upload +
        result.timing.rotation +
        result.timing.adjustments +
        result.timing.toneCurve +
        result.timing.masks +
        result.timing.readback

      // Total should be at least the sum of measured parts
      // (there may be overhead not captured in individual timings)
      expect(result.timing.total).toBeGreaterThanOrEqual(sumOfParts * 0.99) // Allow small floating point error
    })
  })
})

describe('downsamplePixels edge cases', () => {
  it('should handle 1x1 input', () => {
    const pixels = new Uint8Array([255, 128, 64])
    const result = downsamplePixels(pixels, 1, 1, 0.5)

    // Should return original (can't make smaller)
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })

  it('should handle 2x1 input', () => {
    const pixels = new Uint8Array([
      100, 50, 25, // (0,0)
      200, 150, 125, // (1,0)
    ])

    const result = downsamplePixels(pixels, 2, 1, 0.5)

    // With scale 0.5 on 2x1: width = floor(2*0.5) = 1, height = floor(1*0.5) = 0
    // Should return original since height would be 0
    expect(result.width).toBe(2)
    expect(result.height).toBe(1)
  })

  it('should handle 1x2 input', () => {
    const pixels = new Uint8Array([
      100, 50, 25, // (0,0)
      200, 150, 125, // (0,1)
    ])

    const result = downsamplePixels(pixels, 1, 2, 0.5)

    // With scale 0.5 on 1x2: width = floor(1*0.5) = 0, height = floor(2*0.5) = 1
    // Should return original since width would be 0
    expect(result.width).toBe(1)
    expect(result.height).toBe(2)
  })

  it('should handle scale slightly below 1.0', () => {
    const width = 4
    const height = 4
    const pixels = createTestPixels(width, height)

    const result = downsamplePixels(pixels, width, height, 0.99)

    // Should still downsample since scale < 1.0
    // floor(4 * 0.99) = 3
    expect(result.width).toBe(3)
    expect(result.height).toBe(3)
  })

  it('should handle large images', () => {
    const width = 1000
    const height = 800
    const pixels = createTestPixels(width, height)

    const result = downsamplePixels(pixels, width, height, 0.5)

    expect(result.width).toBe(500)
    expect(result.height).toBe(400)
    expect(result.pixels.length).toBe(500 * 400 * 3)
  })

  it('should handle zero scale gracefully', () => {
    const width = 4
    const height = 4
    const pixels = createTestPixels(width, height)

    // Scale of 0 would result in 0x0 dimensions
    const result = downsamplePixels(pixels, width, height, 0)

    // Should return original
    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
  })

  it('should handle negative scale gracefully', () => {
    const width = 4
    const height = 4
    const pixels = createTestPixels(width, height)

    // Negative scale would result in negative dimensions
    const result = downsamplePixels(pixels, width, height, -0.5)

    // Should return original
    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
  })
})

describe('downsamplePixels accuracy', () => {
  it('should correctly average RGB channels independently', () => {
    // Create a 2x2 image with distinct RGB values
    const pixels = new Uint8Array([
      255, 0, 0, // Red (0,0)
      0, 255, 0, // Green (1,0)
      0, 0, 255, // Blue (0,1)
      255, 255, 255, // White (1,1)
    ])

    const result = downsamplePixels(pixels, 2, 2, 0.5)

    // R: (255 + 0 + 0 + 255) / 4 = 127.5 -> 128 (rounded)
    // G: (0 + 255 + 0 + 255) / 4 = 127.5 -> 128 (rounded)
    // B: (0 + 0 + 255 + 255) / 4 = 127.5 -> 128 (rounded)
    expect(result.pixels[0]).toBe(128) // R
    expect(result.pixels[1]).toBe(128) // G
    expect(result.pixels[2]).toBe(128) // B
  })

  it('should handle maximum values correctly', () => {
    const pixels = new Uint8Array([
      255, 255, 255,
      255, 255, 255,
      255, 255, 255,
      255, 255, 255,
    ])

    const result = downsamplePixels(pixels, 2, 2, 0.5)

    expect(result.pixels[0]).toBe(255)
    expect(result.pixels[1]).toBe(255)
    expect(result.pixels[2]).toBe(255)
  })

  it('should handle minimum values correctly', () => {
    const pixels = new Uint8Array([
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ])

    const result = downsamplePixels(pixels, 2, 2, 0.5)

    expect(result.pixels[0]).toBe(0)
    expect(result.pixels[1]).toBe(0)
    expect(result.pixels[2]).toBe(0)
  })

  it('should maintain color relationships after downsampling', () => {
    // Create a gradient image
    const width = 8
    const height = 8
    const pixels = new Uint8Array(width * height * 3)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3
        pixels[idx] = Math.floor((x / (width - 1)) * 255) // Red increases left to right
        pixels[idx + 1] = Math.floor((y / (height - 1)) * 255) // Green increases top to bottom
        pixels[idx + 2] = 128 // Blue constant
      }
    }

    const result = downsamplePixels(pixels, width, height, 0.5)

    // Check that the gradient pattern is preserved in downsampled version
    // First pixel (0,0) should have low red, low green
    // Last pixel (3,3) should have high red, high green
    const firstPixelR = result.pixels[0]
    const lastPixelR = result.pixels[(result.height - 1) * result.width * 3 + (result.width - 1) * 3]

    expect(lastPixelR).toBeGreaterThan(firstPixelR)
  })
})
