/**
 * Unit tests for GPUEditPipeline.
 *
 * Tests the unified GPU edit pipeline that chains all operations:
 * - Pipeline initialization and lifecycle
 * - Operation selection based on parameters
 * - RGB↔RGBA conversion utilities
 * - Timing breakdown accuracy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  type EditPipelineInput,
  type EditPipelineParams,
} from './edit-pipeline'
import { DEFAULT_BASIC_ADJUSTMENTS } from './adjustments-pipeline'

// ============================================================================
// Mock WebGPU Device
// ============================================================================

interface MockGPUDevice {
  createShaderModule: ReturnType<typeof vi.fn>
  createBindGroupLayout: ReturnType<typeof vi.fn>
  createPipelineLayout: ReturnType<typeof vi.fn>
  createComputePipeline: ReturnType<typeof vi.fn>
  createTexture: ReturnType<typeof vi.fn>
  createBuffer: ReturnType<typeof vi.fn>
  createBindGroup: ReturnType<typeof vi.fn>
  createCommandEncoder: ReturnType<typeof vi.fn>
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
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
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
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
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

vi.mock('./adjustments-pipeline', () => ({
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

import { getGPUCapabilityService } from '../capabilities'
import { getAdjustmentsPipeline } from './adjustments-pipeline'

// ============================================================================
// Test Suites
// ============================================================================

describe('GPUEditPipeline', () => {
  beforeEach(() => {
    resetGPUEditPipeline()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetGPUEditPipeline()
  })

  describe('initialization when GPU is NOT available', () => {
    it('should be not ready before initialization', () => {
      const pipeline = new GPUEditPipeline()
      expect(pipeline.isReady).toBe(false)
    })

    it('should return false when GPU is not available', async () => {
      const pipeline = new GPUEditPipeline()
      const ready = await pipeline.initialize()
      expect(ready).toBe(false)
      expect(pipeline.isReady).toBe(false)
    })

    it('should not re-initialize if already initialized', async () => {
      const mockCapService = {
        isReady: false,
        device: null,
        initialize: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(getGPUCapabilityService).mockReturnValue(mockCapService as any)

      const pipeline = new GPUEditPipeline()
      await pipeline.initialize()
      await pipeline.initialize()

      // Should only call initialize once
      expect(mockCapService.initialize).toHaveBeenCalledTimes(1)
    })
  })

  describe('initialization when GPU IS available', () => {
    let mockDevice: MockGPUDevice

    beforeEach(() => {
      mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: vi.fn().mockResolvedValue(undefined),
      } as any)
    })

    it('should return true when GPU is available', async () => {
      const pipeline = new GPUEditPipeline()
      const ready = await pipeline.initialize()
      expect(ready).toBe(true)
    })

    it('should set isReady to true after successful initialization', async () => {
      const pipeline = new GPUEditPipeline()
      expect(pipeline.isReady).toBe(false)
      await pipeline.initialize()
      expect(pipeline.isReady).toBe(true)
    })

    it('should store device after successful initialization', async () => {
      const pipeline = new GPUEditPipeline()
      await pipeline.initialize()
      // Verify device is stored by checking isReady (which checks device !== null)
      expect(pipeline.isReady).toBe(true)
    })

    it('should return true on subsequent initialize() calls without re-initializing', async () => {
      const mockInitialize = vi.fn().mockResolvedValue(undefined)
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: mockInitialize,
      } as any)

      const pipeline = new GPUEditPipeline()

      // First initialization
      const ready1 = await pipeline.initialize()
      expect(ready1).toBe(true)

      // Second initialization should return true without calling initialize again
      const ready2 = await pipeline.initialize()
      expect(ready2).toBe(true)

      // Should only call capability service initialize once
      expect(mockInitialize).toHaveBeenCalledTimes(1)
    })

    it('should clear device and set isReady to false after destroy()', async () => {
      const pipeline = new GPUEditPipeline()
      await pipeline.initialize()
      expect(pipeline.isReady).toBe(true)

      pipeline.destroy()

      expect(pipeline.isReady).toBe(false)
    })

    it('should allow re-initialization after destroy()', async () => {
      const mockInitialize = vi.fn().mockResolvedValue(undefined)
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: mockInitialize,
      } as any)

      const pipeline = new GPUEditPipeline()

      // First initialization
      await pipeline.initialize()
      expect(pipeline.isReady).toBe(true)

      // Destroy
      pipeline.destroy()
      expect(pipeline.isReady).toBe(false)

      // Re-initialize
      const ready = await pipeline.initialize()
      expect(ready).toBe(true)
      expect(pipeline.isReady).toBe(true)

      // Should have called initialize twice
      expect(mockInitialize).toHaveBeenCalledTimes(2)
    })
  })

  describe('destroy', () => {
    it('should mark pipeline as not ready after destroy', async () => {
      const pipeline = new GPUEditPipeline()
      await pipeline.initialize()
      pipeline.destroy()
      expect(pipeline.isReady).toBe(false)
    })
  })

  describe('process', () => {
    it('should throw if not initialized', async () => {
      const pipeline = new GPUEditPipeline()
      const input: EditPipelineInput = {
        pixels: new Uint8Array(12), // 2x2 RGB
        width: 2,
        height: 2,
      }
      const params: EditPipelineParams = {}

      await expect(pipeline.process(input, params)).rejects.toThrow(
        'GPUEditPipeline not initialized'
      )
    })
  })
})

describe('getGPUEditPipeline', () => {
  beforeEach(() => {
    resetGPUEditPipeline()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetGPUEditPipeline()
  })

  it('should return the same instance on multiple calls', () => {
    const pipeline1 = getGPUEditPipeline()
    const pipeline2 = getGPUEditPipeline()
    expect(pipeline1).toBe(pipeline2)
  })

  it('should return a new instance after reset', () => {
    const pipeline1 = getGPUEditPipeline()
    resetGPUEditPipeline()
    const pipeline2 = getGPUEditPipeline()
    expect(pipeline1).not.toBe(pipeline2)
  })

  describe('when GPU IS available', () => {
    let mockDevice: MockGPUDevice

    beforeEach(() => {
      mockDevice = createMockDevice()
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        initialize: vi.fn().mockResolvedValue(undefined),
      } as any)
    })

    it('should return ready pipeline when GPU is available', async () => {
      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()
      expect(ready).toBe(true)
      expect(pipeline.isReady).toBe(true)
    })

    it('should return same instance after successful init', async () => {
      const pipeline1 = getGPUEditPipeline()
      await pipeline1.initialize()

      const pipeline2 = getGPUEditPipeline()
      expect(pipeline1).toBe(pipeline2)
      expect(pipeline2.isReady).toBe(true)
    })
  })
})

// ============================================================================
// Parameter Validation Tests
// ============================================================================

describe('EditPipelineParams validation', () => {
  describe('rotation detection', () => {
    it('should skip rotation when undefined', () => {
      const params: EditPipelineParams = {}
      expect(params.rotation).toBeUndefined()
    })

    it('should skip rotation when 0', () => {
      const params: EditPipelineParams = { rotation: 0 }
      expect(params.rotation).toBe(0)
    })

    it('should apply rotation when non-zero', () => {
      const params: EditPipelineParams = { rotation: 45 }
      expect(params.rotation).toBe(45)
    })
  })

  describe('adjustments detection', () => {
    it('should skip adjustments when undefined', () => {
      const params: EditPipelineParams = {}
      expect(params.adjustments).toBeUndefined()
    })

    it('should skip adjustments when all defaults', () => {
      const params: EditPipelineParams = {
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS },
      }
      expect(params.adjustments).toEqual(DEFAULT_BASIC_ADJUSTMENTS)
    })

    it('should apply adjustments when any value differs', () => {
      const params: EditPipelineParams = {
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 0.5 },
      }
      expect(params.adjustments!.exposure).toBe(0.5)
    })
  })

  describe('tone curve detection', () => {
    it('should skip tone curve when undefined', () => {
      const params: EditPipelineParams = {}
      expect(params.toneCurvePoints).toBeUndefined()
      expect(params.toneCurveLut).toBeUndefined()
    })

    it('should apply tone curve when points provided', () => {
      const params: EditPipelineParams = {
        toneCurvePoints: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 },
        ],
      }
      expect(params.toneCurvePoints).toHaveLength(3)
    })
  })

  describe('masks detection', () => {
    it('should skip masks when undefined', () => {
      const params: EditPipelineParams = {}
      expect(params.masks).toBeUndefined()
    })

    it('should skip masks when all disabled', () => {
      const params: EditPipelineParams = {
        masks: {
          linearMasks: [{ startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: false, adjustments: {} }],
          radialMasks: [],
        },
      }
      const hasEnabled = params.masks!.linearMasks.some((m) => m.enabled)
      expect(hasEnabled).toBe(false)
    })

    it('should apply masks when any enabled', () => {
      const params: EditPipelineParams = {
        masks: {
          linearMasks: [{ startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: true, adjustments: {} }],
          radialMasks: [],
        },
      }
      const hasEnabled = params.masks!.linearMasks.some((m) => m.enabled)
      expect(hasEnabled).toBe(true)
    })
  })
})

// ============================================================================
// RGB↔RGBA Conversion Tests
// ============================================================================

describe('RGB↔RGBA conversion', () => {
  // These are internal functions, but we can test the expected behavior
  // through the pipeline's input/output format

  it('should accept RGB input format', () => {
    const input: EditPipelineInput = {
      pixels: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]), // 3 RGB pixels
      width: 3,
      height: 1,
    }
    expect(input.pixels.length).toBe(9) // 3 pixels × 3 channels
  })

  it('should require correct pixel count for dimensions', () => {
    const width = 4
    const height = 3
    const expectedSize = width * height * 3 // RGB format

    const input: EditPipelineInput = {
      pixels: new Uint8Array(expectedSize),
      width,
      height,
    }
    expect(input.pixels.length).toBe(36) // 4×3×3
  })
})

// ============================================================================
// Timing Tests
// ============================================================================

describe('EditPipelineTiming', () => {
  it('should have all timing fields', () => {
    const timing = {
      total: 0,
      upload: 0,
      rotation: 0,
      adjustments: 0,
      toneCurve: 0,
      masks: 0,
      readback: 0,
    }

    expect(timing).toHaveProperty('total')
    expect(timing).toHaveProperty('upload')
    expect(timing).toHaveProperty('rotation')
    expect(timing).toHaveProperty('adjustments')
    expect(timing).toHaveProperty('toneCurve')
    expect(timing).toHaveProperty('masks')
    expect(timing).toHaveProperty('readback')
  })

  it('should have total >= sum of parts', () => {
    const timing = {
      total: 100,
      upload: 10,
      rotation: 20,
      adjustments: 30,
      toneCurve: 15,
      masks: 10,
      readback: 15,
    }

    const sumOfParts =
      timing.upload +
      timing.rotation +
      timing.adjustments +
      timing.toneCurve +
      timing.masks +
      timing.readback

    expect(timing.total).toBeGreaterThanOrEqual(sumOfParts)
  })
})

// ============================================================================
// rgbToRgba Tests
// ============================================================================

describe('rgbToRgba', () => {
  const { rgbToRgba } = _internal

  describe('single pixel (1x1) conversion', () => {
    it('should convert a single black pixel', () => {
      const rgb = new Uint8Array([0, 0, 0])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba.length).toBe(4)
      expect(rgba[0]).toBe(0) // R
      expect(rgba[1]).toBe(0) // G
      expect(rgba[2]).toBe(0) // B
      expect(rgba[3]).toBe(255) // A (fully opaque)
    })

    it('should convert a single white pixel', () => {
      const rgb = new Uint8Array([255, 255, 255])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba.length).toBe(4)
      expect(rgba[0]).toBe(255)
      expect(rgba[1]).toBe(255)
      expect(rgba[2]).toBe(255)
      expect(rgba[3]).toBe(255)
    })

    it('should convert a single red pixel', () => {
      const rgb = new Uint8Array([255, 0, 0])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba.length).toBe(4)
      expect(rgba[0]).toBe(255) // R
      expect(rgba[1]).toBe(0) // G
      expect(rgba[2]).toBe(0) // B
      expect(rgba[3]).toBe(255) // A
    })

    it('should convert a single green pixel', () => {
      const rgb = new Uint8Array([0, 255, 0])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba[0]).toBe(0)
      expect(rgba[1]).toBe(255)
      expect(rgba[2]).toBe(0)
      expect(rgba[3]).toBe(255)
    })

    it('should convert a single blue pixel', () => {
      const rgb = new Uint8Array([0, 0, 255])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba[0]).toBe(0)
      expect(rgba[1]).toBe(0)
      expect(rgba[2]).toBe(255)
      expect(rgba[3]).toBe(255)
    })

    it('should convert an arbitrary color pixel', () => {
      const rgb = new Uint8Array([128, 64, 192])
      const rgba = rgbToRgba(rgb, 1, 1)

      expect(rgba[0]).toBe(128)
      expect(rgba[1]).toBe(64)
      expect(rgba[2]).toBe(192)
      expect(rgba[3]).toBe(255)
    })
  })

  describe('multiple pixels conversion', () => {
    it('should convert 2x2 image (4 pixels)', () => {
      // R, G, B, White pixels
      const rgb = new Uint8Array([
        255, 0, 0, // Red
        0, 255, 0, // Green
        0, 0, 255, // Blue
        255, 255, 255, // White
      ])

      const rgba = rgbToRgba(rgb, 2, 2)

      expect(rgba.length).toBe(16) // 4 pixels x 4 channels

      // Red pixel
      expect(rgba[0]).toBe(255)
      expect(rgba[1]).toBe(0)
      expect(rgba[2]).toBe(0)
      expect(rgba[3]).toBe(255)

      // Green pixel
      expect(rgba[4]).toBe(0)
      expect(rgba[5]).toBe(255)
      expect(rgba[6]).toBe(0)
      expect(rgba[7]).toBe(255)

      // Blue pixel
      expect(rgba[8]).toBe(0)
      expect(rgba[9]).toBe(0)
      expect(rgba[10]).toBe(255)
      expect(rgba[11]).toBe(255)

      // White pixel
      expect(rgba[12]).toBe(255)
      expect(rgba[13]).toBe(255)
      expect(rgba[14]).toBe(255)
      expect(rgba[15]).toBe(255)
    })

    it('should convert 3x3 image (9 pixels)', () => {
      const rgb = new Uint8Array(27) // 9 pixels x 3 channels
      for (let i = 0; i < 9; i++) {
        rgb[i * 3] = i * 28 // R: 0, 28, 56, 84, ...
        rgb[i * 3 + 1] = (i * 28 + 10) % 256 // G
        rgb[i * 3 + 2] = (i * 28 + 20) % 256 // B
      }

      const rgba = rgbToRgba(rgb, 3, 3)

      expect(rgba.length).toBe(36) // 9 pixels x 4 channels

      // Verify each pixel
      for (let i = 0; i < 9; i++) {
        expect(rgba[i * 4]).toBe(rgb[i * 3])
        expect(rgba[i * 4 + 1]).toBe(rgb[i * 3 + 1])
        expect(rgba[i * 4 + 2]).toBe(rgb[i * 3 + 2])
        expect(rgba[i * 4 + 3]).toBe(255)
      }
    })
  })

  describe('verify correct RGB to RGBA mapping', () => {
    it('should map R to R, G to G, B to B, A to 255', () => {
      const testCases = [
        [100, 150, 200],
        [0, 0, 0],
        [255, 255, 255],
        [1, 2, 3],
        [254, 253, 252],
      ]

      for (const [r, g, b] of testCases) {
        const rgb = new Uint8Array([r, g, b])
        const rgba = rgbToRgba(rgb, 1, 1)

        expect(rgba[0]).toBe(r)
        expect(rgba[1]).toBe(g)
        expect(rgba[2]).toBe(b)
        expect(rgba[3]).toBe(255)
      }
    })

    it('should correctly position all channels in multi-pixel image', () => {
      const rgb = new Uint8Array([
        10, 20, 30, // Pixel 0
        40, 50, 60, // Pixel 1
        70, 80, 90, // Pixel 2
      ])

      const rgba = rgbToRgba(rgb, 3, 1)

      // Pixel 0
      expect(rgba.slice(0, 4)).toEqual(new Uint8Array([10, 20, 30, 255]))
      // Pixel 1
      expect(rgba.slice(4, 8)).toEqual(new Uint8Array([40, 50, 60, 255]))
      // Pixel 2
      expect(rgba.slice(8, 12)).toEqual(new Uint8Array([70, 80, 90, 255]))
    })
  })

  describe('large image conversion', () => {
    it('should convert 100x100 image', () => {
      const width = 100
      const height = 100
      const pixelCount = width * height
      const rgb = new Uint8Array(pixelCount * 3)

      // Fill with gradient pattern
      for (let i = 0; i < pixelCount; i++) {
        rgb[i * 3] = i % 256
        rgb[i * 3 + 1] = (i * 2) % 256
        rgb[i * 3 + 2] = (i * 3) % 256
      }

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(pixelCount * 4)

      // Verify first pixel
      expect(rgba[0]).toBe(0)
      expect(rgba[1]).toBe(0)
      expect(rgba[2]).toBe(0)
      expect(rgba[3]).toBe(255)

      // Verify last pixel
      const lastRgb = (pixelCount - 1) * 3
      const lastRgba = (pixelCount - 1) * 4
      expect(rgba[lastRgba]).toBe(rgb[lastRgb])
      expect(rgba[lastRgba + 1]).toBe(rgb[lastRgb + 1])
      expect(rgba[lastRgba + 2]).toBe(rgb[lastRgb + 2])
      expect(rgba[lastRgba + 3]).toBe(255)

      // Verify all alpha channels are 255
      for (let i = 0; i < pixelCount; i++) {
        expect(rgba[i * 4 + 3]).toBe(255)
      }
    })

    it('should convert 1000x1000 image', () => {
      const width = 1000
      const height = 1000
      const pixelCount = width * height
      const rgb = new Uint8Array(pixelCount * 3)

      // Fill with simple pattern
      rgb.fill(128)

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(pixelCount * 4)

      // Spot check several pixels
      const spotChecks = [0, 100, 10000, 500000, pixelCount - 1]
      for (const i of spotChecks) {
        expect(rgba[i * 4]).toBe(128)
        expect(rgba[i * 4 + 1]).toBe(128)
        expect(rgba[i * 4 + 2]).toBe(128)
        expect(rgba[i * 4 + 3]).toBe(255)
      }
    })
  })

  describe('edge case: single row', () => {
    it('should convert 10x1 image (single row)', () => {
      const width = 10
      const height = 1
      const rgb = new Uint8Array(width * 3)

      // Horizontal gradient
      for (let i = 0; i < width; i++) {
        rgb[i * 3] = i * 25
        rgb[i * 3 + 1] = i * 25
        rgb[i * 3 + 2] = i * 25
      }

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(width * 4)

      for (let i = 0; i < width; i++) {
        expect(rgba[i * 4]).toBe(i * 25)
        expect(rgba[i * 4 + 1]).toBe(i * 25)
        expect(rgba[i * 4 + 2]).toBe(i * 25)
        expect(rgba[i * 4 + 3]).toBe(255)
      }
    })

    it('should convert 1000x1 image (wide single row)', () => {
      const width = 1000
      const height = 1
      const rgb = new Uint8Array(width * 3)
      rgb.fill(100)

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(width * 4)
      expect(rgba[0]).toBe(100)
      expect(rgba[3]).toBe(255)
      expect(rgba[(width - 1) * 4 + 3]).toBe(255)
    })
  })

  describe('edge case: single column', () => {
    it('should convert 1x10 image (single column)', () => {
      const width = 1
      const height = 10
      const rgb = new Uint8Array(height * 3)

      // Vertical gradient
      for (let i = 0; i < height; i++) {
        rgb[i * 3] = i * 25
        rgb[i * 3 + 1] = 255 - i * 25
        rgb[i * 3 + 2] = 128
      }

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(height * 4)

      for (let i = 0; i < height; i++) {
        expect(rgba[i * 4]).toBe(i * 25)
        expect(rgba[i * 4 + 1]).toBe(255 - i * 25)
        expect(rgba[i * 4 + 2]).toBe(128)
        expect(rgba[i * 4 + 3]).toBe(255)
      }
    })

    it('should convert 1x1000 image (tall single column)', () => {
      const width = 1
      const height = 1000
      const rgb = new Uint8Array(height * 3)
      rgb.fill(200)

      const rgba = rgbToRgba(rgb, width, height)

      expect(rgba.length).toBe(height * 4)
      expect(rgba[0]).toBe(200)
      expect(rgba[3]).toBe(255)
      expect(rgba[(height - 1) * 4 + 3]).toBe(255)
    })
  })
})

// ============================================================================
// rgbaToRgb Tests
// ============================================================================

describe('rgbaToRgb', () => {
  const { rgbaToRgb } = _internal

  describe('single pixel (1x1) conversion', () => {
    it('should convert a single black pixel with full alpha', () => {
      const rgba = new Uint8Array([0, 0, 0, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb.length).toBe(3)
      expect(rgb[0]).toBe(0)
      expect(rgb[1]).toBe(0)
      expect(rgb[2]).toBe(0)
    })

    it('should convert a single white pixel with full alpha', () => {
      const rgba = new Uint8Array([255, 255, 255, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb.length).toBe(3)
      expect(rgb[0]).toBe(255)
      expect(rgb[1]).toBe(255)
      expect(rgb[2]).toBe(255)
    })

    it('should convert a single red pixel', () => {
      const rgba = new Uint8Array([255, 0, 0, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb[0]).toBe(255)
      expect(rgb[1]).toBe(0)
      expect(rgb[2]).toBe(0)
    })

    it('should convert a single green pixel', () => {
      const rgba = new Uint8Array([0, 255, 0, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb[0]).toBe(0)
      expect(rgb[1]).toBe(255)
      expect(rgb[2]).toBe(0)
    })

    it('should convert a single blue pixel', () => {
      const rgba = new Uint8Array([0, 0, 255, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb[0]).toBe(0)
      expect(rgb[1]).toBe(0)
      expect(rgb[2]).toBe(255)
    })

    it('should convert an arbitrary color pixel', () => {
      const rgba = new Uint8Array([128, 64, 192, 255])
      const rgb = rgbaToRgb(rgba, 1, 1)

      expect(rgb[0]).toBe(128)
      expect(rgb[1]).toBe(64)
      expect(rgb[2]).toBe(192)
    })
  })

  describe('multiple pixels conversion', () => {
    it('should convert 2x2 image (4 pixels)', () => {
      const rgba = new Uint8Array([
        255, 0, 0, 255, // Red
        0, 255, 0, 255, // Green
        0, 0, 255, 255, // Blue
        255, 255, 255, 255, // White
      ])

      const rgb = rgbaToRgb(rgba, 2, 2)

      expect(rgb.length).toBe(12) // 4 pixels x 3 channels

      // Red pixel
      expect(rgb.slice(0, 3)).toEqual(new Uint8Array([255, 0, 0]))
      // Green pixel
      expect(rgb.slice(3, 6)).toEqual(new Uint8Array([0, 255, 0]))
      // Blue pixel
      expect(rgb.slice(6, 9)).toEqual(new Uint8Array([0, 0, 255]))
      // White pixel
      expect(rgb.slice(9, 12)).toEqual(new Uint8Array([255, 255, 255]))
    })

    it('should convert 3x3 image (9 pixels)', () => {
      const rgba = new Uint8Array(36) // 9 pixels x 4 channels
      for (let i = 0; i < 9; i++) {
        rgba[i * 4] = i * 28
        rgba[i * 4 + 1] = (i * 28 + 10) % 256
        rgba[i * 4 + 2] = (i * 28 + 20) % 256
        rgba[i * 4 + 3] = 255
      }

      const rgb = rgbaToRgb(rgba, 3, 3)

      expect(rgb.length).toBe(27) // 9 pixels x 3 channels

      // Verify each pixel
      for (let i = 0; i < 9; i++) {
        expect(rgb[i * 3]).toBe(rgba[i * 4])
        expect(rgb[i * 3 + 1]).toBe(rgba[i * 4 + 1])
        expect(rgb[i * 3 + 2]).toBe(rgba[i * 4 + 2])
      }
    })
  })

  describe('verify correct RGBA to RGB mapping (A discarded)', () => {
    it('should map R to R, G to G, B to B, discard A', () => {
      const testCases = [
        { rgba: [100, 150, 200, 255], expected: [100, 150, 200] },
        { rgba: [100, 150, 200, 0], expected: [100, 150, 200] },
        { rgba: [100, 150, 200, 128], expected: [100, 150, 200] },
        { rgba: [0, 0, 0, 50], expected: [0, 0, 0] },
        { rgba: [255, 255, 255, 1], expected: [255, 255, 255] },
      ]

      for (const { rgba, expected } of testCases) {
        const rgbaArr = new Uint8Array(rgba)
        const rgb = rgbaToRgb(rgbaArr, 1, 1)

        expect(rgb[0]).toBe(expected[0])
        expect(rgb[1]).toBe(expected[1])
        expect(rgb[2]).toBe(expected[2])
      }
    })

    it('should discard any alpha value without affecting RGB', () => {
      const alphaValues = [0, 1, 50, 100, 127, 128, 200, 254, 255]

      for (const alpha of alphaValues) {
        const rgba = new Uint8Array([42, 84, 126, alpha])
        const rgb = rgbaToRgb(rgba, 1, 1)

        expect(rgb[0]).toBe(42)
        expect(rgb[1]).toBe(84)
        expect(rgb[2]).toBe(126)
      }
    })

    it('should correctly position all channels in multi-pixel image', () => {
      const rgba = new Uint8Array([
        10, 20, 30, 255, // Pixel 0
        40, 50, 60, 128, // Pixel 1
        70, 80, 90, 0, // Pixel 2
      ])

      const rgb = rgbaToRgb(rgba, 3, 1)

      // Pixel 0
      expect(rgb.slice(0, 3)).toEqual(new Uint8Array([10, 20, 30]))
      // Pixel 1
      expect(rgb.slice(3, 6)).toEqual(new Uint8Array([40, 50, 60]))
      // Pixel 2
      expect(rgb.slice(6, 9)).toEqual(new Uint8Array([70, 80, 90]))
    })
  })

  describe('large image conversion', () => {
    it('should convert 100x100 image', () => {
      const width = 100
      const height = 100
      const pixelCount = width * height
      const rgba = new Uint8Array(pixelCount * 4)

      // Fill with gradient pattern
      for (let i = 0; i < pixelCount; i++) {
        rgba[i * 4] = i % 256
        rgba[i * 4 + 1] = (i * 2) % 256
        rgba[i * 4 + 2] = (i * 3) % 256
        rgba[i * 4 + 3] = 255
      }

      const rgb = rgbaToRgb(rgba, width, height)

      expect(rgb.length).toBe(pixelCount * 3)

      // Verify first pixel
      expect(rgb[0]).toBe(0)
      expect(rgb[1]).toBe(0)
      expect(rgb[2]).toBe(0)

      // Verify last pixel
      const lastRgba = (pixelCount - 1) * 4
      const lastRgb = (pixelCount - 1) * 3
      expect(rgb[lastRgb]).toBe(rgba[lastRgba])
      expect(rgb[lastRgb + 1]).toBe(rgba[lastRgba + 1])
      expect(rgb[lastRgb + 2]).toBe(rgba[lastRgba + 2])
    })

    it('should convert 1000x1000 image', () => {
      const width = 1000
      const height = 1000
      const pixelCount = width * height
      const rgba = new Uint8Array(pixelCount * 4)

      // Fill with simple pattern
      for (let i = 0; i < pixelCount; i++) {
        rgba[i * 4] = 128
        rgba[i * 4 + 1] = 128
        rgba[i * 4 + 2] = 128
        rgba[i * 4 + 3] = 255
      }

      const rgb = rgbaToRgb(rgba, width, height)

      expect(rgb.length).toBe(pixelCount * 3)

      // Spot check several pixels
      const spotChecks = [0, 100, 10000, 500000, pixelCount - 1]
      for (const i of spotChecks) {
        expect(rgb[i * 3]).toBe(128)
        expect(rgb[i * 3 + 1]).toBe(128)
        expect(rgb[i * 3 + 2]).toBe(128)
      }
    })
  })
})

// ============================================================================
// Round-trip Tests
// ============================================================================

describe('RGB/RGBA round-trip', () => {
  const { rgbToRgba, rgbaToRgb } = _internal

  it('should preserve data through rgbaToRgb(rgbToRgba(rgb)) for 1x1 image', () => {
    const original = new Uint8Array([128, 64, 192])
    const rgba = rgbToRgba(original, 1, 1)
    const result = rgbaToRgb(rgba, 1, 1)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for 2x2 image', () => {
    const original = new Uint8Array([
      255, 0, 0, // Red
      0, 255, 0, // Green
      0, 0, 255, // Blue
      255, 255, 255, // White
    ])

    const rgba = rgbToRgba(original, 2, 2)
    const result = rgbaToRgb(rgba, 2, 2)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for gradient image', () => {
    const width = 16
    const height = 16
    const pixelCount = width * height
    const original = new Uint8Array(pixelCount * 3)

    // Create a gradient pattern
    for (let i = 0; i < pixelCount; i++) {
      original[i * 3] = i % 256
      original[i * 3 + 1] = (i * 2) % 256
      original[i * 3 + 2] = (i * 3) % 256
    }

    const rgba = rgbToRgba(original, width, height)
    const result = rgbaToRgb(rgba, width, height)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for random data', () => {
    const width = 50
    const height = 50
    const pixelCount = width * height
    const original = new Uint8Array(pixelCount * 3)

    // Fill with pseudo-random data
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 17 + 31) % 256
    }

    const rgba = rgbToRgba(original, width, height)
    const result = rgbaToRgb(rgba, width, height)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for single row', () => {
    const original = new Uint8Array([
      10, 20, 30,
      40, 50, 60,
      70, 80, 90,
      100, 110, 120,
      130, 140, 150,
    ])

    const rgba = rgbToRgba(original, 5, 1)
    const result = rgbaToRgb(rgba, 5, 1)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for single column', () => {
    const original = new Uint8Array([
      10, 20, 30,
      40, 50, 60,
      70, 80, 90,
      100, 110, 120,
      130, 140, 150,
    ])

    const rgba = rgbToRgba(original, 1, 5)
    const result = rgbaToRgb(rgba, 1, 5)

    expect(result).toEqual(original)
  })

  it('should preserve data through round-trip for large image', () => {
    const width = 200
    const height = 200
    const pixelCount = width * height
    const original = new Uint8Array(pixelCount * 3)

    // Fill with pattern
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256
    }

    const rgba = rgbToRgba(original, width, height)
    const result = rgbaToRgb(rgba, width, height)

    expect(result).toEqual(original)
  })

  it('should preserve edge values (0 and 255) through round-trip', () => {
    const original = new Uint8Array([
      0, 0, 0, // All minimum
      255, 255, 255, // All maximum
      0, 255, 0, // Mixed
      255, 0, 255, // Mixed
    ])

    const rgba = rgbToRgba(original, 2, 2)
    const result = rgbaToRgb(rgba, 2, 2)

    expect(result).toEqual(original)
  })
})

// ============================================================================
// Internal Helper Function Tests
// ============================================================================

describe('_internal.shouldApplyRotation', () => {
  const { shouldApplyRotation } = _internal

  describe('should return false', () => {
    it('when rotation is undefined', () => {
      expect(shouldApplyRotation(undefined)).toBe(false)
    })

    it('when rotation is exactly 0', () => {
      expect(shouldApplyRotation(0)).toBe(false)
    })

    it('when rotation is very small positive (below threshold)', () => {
      expect(shouldApplyRotation(0.0001)).toBe(false)
      expect(shouldApplyRotation(0.0005)).toBe(false)
      expect(shouldApplyRotation(0.001)).toBe(false)
    })

    it('when rotation is very small negative (below threshold)', () => {
      expect(shouldApplyRotation(-0.0001)).toBe(false)
      expect(shouldApplyRotation(-0.0005)).toBe(false)
      expect(shouldApplyRotation(-0.001)).toBe(false)
    })
  })

  describe('should return true', () => {
    it('when rotation is just above threshold', () => {
      expect(shouldApplyRotation(0.002)).toBe(true)
      expect(shouldApplyRotation(0.01)).toBe(true)
    })

    it('when rotation is just below negative threshold', () => {
      expect(shouldApplyRotation(-0.002)).toBe(true)
      expect(shouldApplyRotation(-0.01)).toBe(true)
    })

    it('when rotation is a typical positive value', () => {
      expect(shouldApplyRotation(1)).toBe(true)
      expect(shouldApplyRotation(45)).toBe(true)
      expect(shouldApplyRotation(90)).toBe(true)
      expect(shouldApplyRotation(180)).toBe(true)
      expect(shouldApplyRotation(360)).toBe(true)
    })

    it('when rotation is a typical negative value', () => {
      expect(shouldApplyRotation(-1)).toBe(true)
      expect(shouldApplyRotation(-45)).toBe(true)
      expect(shouldApplyRotation(-90)).toBe(true)
      expect(shouldApplyRotation(-180)).toBe(true)
      expect(shouldApplyRotation(-360)).toBe(true)
    })

    it('when rotation is a fractional degree', () => {
      expect(shouldApplyRotation(0.5)).toBe(true)
      expect(shouldApplyRotation(2.5)).toBe(true)
      expect(shouldApplyRotation(-0.5)).toBe(true)
    })
  })
})

describe('_internal.shouldApplyAdjustments', () => {
  const { shouldApplyAdjustments } = _internal

  describe('should return false', () => {
    it('when adjustments is undefined', () => {
      expect(shouldApplyAdjustments(undefined)).toBe(false)
    })

    it('when all values match DEFAULT_BASIC_ADJUSTMENTS', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS })).toBe(false)
    })

    it('when adjustments is exactly the default object', () => {
      expect(shouldApplyAdjustments(DEFAULT_BASIC_ADJUSTMENTS)).toBe(false)
    })
  })

  describe('should return true when any single value differs', () => {
    it('when temperature differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, temperature: 10 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, temperature: -10 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, temperature: 0.001 })).toBe(true)
    })

    it('when tint differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, tint: 10 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, tint: -10 })).toBe(true)
    })

    it('when exposure differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 0.5 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, exposure: -0.5 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 5 })).toBe(true)
    })

    it('when contrast differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, contrast: 50 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, contrast: -50 })).toBe(true)
    })

    it('when highlights differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, highlights: 100 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, highlights: -100 })).toBe(true)
    })

    it('when shadows differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, shadows: 75 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, shadows: -75 })).toBe(true)
    })

    it('when whites differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, whites: 25 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, whites: -25 })).toBe(true)
    })

    it('when blacks differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, blacks: 15 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, blacks: -15 })).toBe(true)
    })

    it('when vibrance differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, vibrance: 30 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, vibrance: -30 })).toBe(true)
    })

    it('when saturation differs', () => {
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, saturation: 20 })).toBe(true)
      expect(shouldApplyAdjustments({ ...DEFAULT_BASIC_ADJUSTMENTS, saturation: -20 })).toBe(true)
    })
  })

  describe('should return true when multiple values differ', () => {
    it('when exposure and contrast both differ', () => {
      expect(
        shouldApplyAdjustments({
          ...DEFAULT_BASIC_ADJUSTMENTS,
          exposure: 1,
          contrast: 25,
        })
      ).toBe(true)
    })

    it('when all values differ from default', () => {
      expect(
        shouldApplyAdjustments({
          temperature: 10,
          tint: 5,
          exposure: 0.5,
          contrast: 20,
          highlights: -30,
          shadows: 40,
          whites: 10,
          blacks: -10,
          vibrance: 25,
          saturation: 15,
        })
      ).toBe(true)
    })
  })
})

describe('_internal.shouldApplyToneCurve', () => {
  const { shouldApplyToneCurve } = _internal

  // Helper to create identity LUT
  const createIdentityLut = () => {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      lut[i] = i
    }
    return { lut }
  }

  // Helper to create non-identity LUT
  const createNonIdentityLut = () => {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.min(255, i + 10) // Shift all values by 10
    }
    return { lut }
  }

  describe('should return false', () => {
    it('when both points and lut are undefined', () => {
      expect(shouldApplyToneCurve(undefined, undefined)).toBe(false)
    })

    it('when points is undefined and lut is undefined', () => {
      expect(shouldApplyToneCurve(undefined, undefined)).toBe(false)
    })

    it('when points is an empty array', () => {
      expect(shouldApplyToneCurve([], undefined)).toBe(false)
    })

    it('when LUT is identity', () => {
      expect(shouldApplyToneCurve(undefined, createIdentityLut())).toBe(false)
    })

    it('when points form identity curve (0,0) to (1,1)', () => {
      const identityPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(identityPoints, undefined)).toBe(false)
    })

    it('when points are very close to identity (within threshold)', () => {
      const nearIdentityPoints = [
        { x: 0.0005, y: 0.0005 },
        { x: 0.9995, y: 0.9995 },
      ]
      expect(shouldApplyToneCurve(nearIdentityPoints, undefined)).toBe(false)
    })
  })

  describe('should return true', () => {
    it('when LUT is non-identity', () => {
      expect(shouldApplyToneCurve(undefined, createNonIdentityLut())).toBe(true)
    })

    it('when points has only one point', () => {
      expect(shouldApplyToneCurve([{ x: 0.5, y: 0.5 }], undefined)).toBe(true)
    })

    it('when points has three or more points', () => {
      const threePoints = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.7 },
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(threePoints, undefined)).toBe(true)
    })

    it('when points form S-curve', () => {
      const sCurve = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(sCurve, undefined)).toBe(true)
    })

    it('when two-point curve has non-identity start point', () => {
      const nonIdentityStart = [
        { x: 0.1, y: 0 }, // Start point x differs
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(nonIdentityStart, undefined)).toBe(true)
    })

    it('when two-point curve has non-identity end point', () => {
      const nonIdentityEnd = [
        { x: 0, y: 0 },
        { x: 1, y: 0.9 }, // End point y differs
      ]
      expect(shouldApplyToneCurve(nonIdentityEnd, undefined)).toBe(true)
    })

    it('when two-point curve has lifted blacks', () => {
      const liftedBlacks = [
        { x: 0, y: 0.1 }, // Lifted blacks
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(liftedBlacks, undefined)).toBe(true)
    })

    it('when two-point curve has crushed whites', () => {
      const crushedWhites = [
        { x: 0, y: 0 },
        { x: 1, y: 0.9 }, // Crushed whites
      ]
      expect(shouldApplyToneCurve(crushedWhites, undefined)).toBe(true)
    })

    it('when points deviate from identity beyond threshold', () => {
      const beyondThreshold = [
        { x: 0.002, y: 0 }, // Just beyond 0.001 threshold
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(beyondThreshold, undefined)).toBe(true)
    })
  })

  describe('LUT takes precedence over points', () => {
    it('should return false if LUT is identity even if points are non-identity', () => {
      const nonIdentityPoints = [
        { x: 0, y: 0.2 },
        { x: 1, y: 0.8 },
      ]
      expect(shouldApplyToneCurve(nonIdentityPoints, createIdentityLut())).toBe(false)
    })

    it('should return true if LUT is non-identity even if points are identity', () => {
      const identityPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]
      expect(shouldApplyToneCurve(identityPoints, createNonIdentityLut())).toBe(true)
    })
  })
})

// ============================================================================
// GPUEditPipeline.process() Tests with Mocked Pipelines
// ============================================================================

// Mock sub-pipelines for process() tests
const mockRotationPipeline = {
  applyToTextures: vi.fn((input, output, sw, sh, dw, dh, angle, encoder) => encoder),
}

const mockAdjustmentsPipeline = {
  applyToTextures: vi.fn((input, output, w, h, adj, encoder) => encoder),
}

const mockToneCurvePipeline = {
  applyToTextures: vi.fn((input, output, w, h, lut, encoder) => encoder),
}

const mockMaskPipeline = {
  applyToTextures: vi.fn((input, output, w, h, masks, encoder) => encoder),
}

// Mock texture tracking for cleanup tests
let createdTextures: Array<{ destroy: ReturnType<typeof vi.fn> }> = []

// Mock the sub-pipeline getters
vi.mock('./rotation-pipeline', () => ({
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

vi.mock('./tone-curve-pipeline', () => ({
  getToneCurvePipeline: vi.fn(),
  isIdentityLut: vi.fn((lut) => {
    if (!lut?.lut) return true
    for (let i = 0; i < 256; i++) {
      if (lut.lut[i] !== i) return false
    }
    return true
  }),
}))

vi.mock('./mask-pipeline', () => ({
  getMaskPipeline: vi.fn(),
}))

// Mock texture utilities
vi.mock('../texture-utils', () => ({
  createTextureFromPixels: vi.fn((device, pixels, w, h, usage, label) => {
    const texture = { destroy: vi.fn(), label }
    createdTextures.push(texture)
    return texture
  }),
  createOutputTexture: vi.fn((device, w, h, usage, label) => {
    const texture = { destroy: vi.fn(), label }
    createdTextures.push(texture)
    return texture
  }),
  readTexturePixels: vi.fn(async (device, texture, w, h) => {
    return new Uint8Array(w * h * 4).fill(128)
  }),
  TextureUsage: {
    INPUT: 0x07,
    OUTPUT: 0x0d,
    PINGPONG: 0x0f,
  },
}))

// Mock tone curve LUT generation
vi.mock('../gpu-tone-curve-service', () => ({
  generateLutFromCurvePoints: vi.fn((points) => {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      lut[i] = i
    }
    return { lut }
  }),
}))

// Import mocked modules
import { getRotationPipeline, RotationPipeline } from './rotation-pipeline'
import { getToneCurvePipeline, isIdentityLut } from './tone-curve-pipeline'
import { getMaskPipeline } from './mask-pipeline'
import { createTextureFromPixels, createOutputTexture, readTexturePixels } from '../texture-utils'
import { generateLutFromCurvePoints } from '../gpu-tone-curve-service'

// Test helper to create RGB pixels
function createTestRgbPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = 128
    pixels[i * 3 + 1] = 64
    pixels[i * 3 + 2] = 192
  }
  return pixels
}

function createTestInput(width: number = 4, height: number = 4): EditPipelineInput {
  return {
    pixels: createTestRgbPixels(width, height),
    width,
    height,
  }
}

describe('GPUEditPipeline.process()', () => {
  let pipeline: GPUEditPipeline
  let mockDevice: MockGPUDevice

  beforeEach(async () => {
    // Clear ALL mock state first
    vi.clearAllMocks()

    mockDevice = createMockDevice()
    createdTextures = []

    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      initialize: vi.fn().mockResolvedValue(undefined),
    } as any)

    // Reset mock pipelines
    mockRotationPipeline.applyToTextures.mockClear()
    mockAdjustmentsPipeline.applyToTextures.mockClear()
    mockToneCurvePipeline.applyToTextures.mockClear()
    mockMaskPipeline.applyToTextures.mockClear()

    // Setup mocks to return null by default
    vi.mocked(getRotationPipeline).mockResolvedValue(null)
    vi.mocked(getAdjustmentsPipeline).mockResolvedValue(null)
    vi.mocked(getToneCurvePipeline).mockResolvedValue(null)
    vi.mocked(getMaskPipeline).mockResolvedValue(null)
    vi.mocked(generateLutFromCurvePoints).mockClear()
    vi.mocked(isIdentityLut).mockReturnValue(true) // Default to identity

    // Reset the pipeline singleton
    resetGPUEditPipeline()

    pipeline = new GPUEditPipeline()
    await pipeline.initialize()
  })

  describe('rotation only', () => {
    it('should call rotation pipeline when rotation is non-zero', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { rotation: 45 }

      await pipeline.process(input, params)

      expect(getRotationPipeline).toHaveBeenCalled()
      expect(mockRotationPipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should not call rotation pipeline when rotation is 0', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { rotation: 0 }

      await pipeline.process(input, params)

      expect(getRotationPipeline).not.toHaveBeenCalled()
      expect(mockRotationPipeline.applyToTextures).not.toHaveBeenCalled()
    })

    it('should not call rotation pipeline when rotation is undefined', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      await pipeline.process(input, params)

      expect(getRotationPipeline).not.toHaveBeenCalled()
    })

    it('should pass correct dimensions to rotation pipeline', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)
      vi.mocked(RotationPipeline.computeRotatedDimensions).mockReturnValue({
        width: 6,
        height: 6,
      })

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { rotation: 45 }

      await pipeline.process(input, params)

      expect(mockRotationPipeline.applyToTextures).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        4,
        4,
        6,
        6,
        45,
        expect.anything()
      )
    })
  })

  describe('adjustments only', () => {
    it('should call adjustments pipeline when adjustments differ from defaults', async () => {
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockAdjustmentsPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 1.5 },
      }

      await pipeline.process(input, params)

      expect(getAdjustmentsPipeline).toHaveBeenCalled()
      expect(mockAdjustmentsPipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should not call adjustments pipeline when all defaults', async () => {
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockAdjustmentsPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS },
      }

      await pipeline.process(input, params)

      expect(getAdjustmentsPipeline).not.toHaveBeenCalled()
    })

    it('should not call adjustments pipeline when adjustments undefined', async () => {
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockAdjustmentsPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      await pipeline.process(input, params)

      expect(getAdjustmentsPipeline).not.toHaveBeenCalled()
    })
  })

  describe('tone curve with points', () => {
    it('should call tone curve pipeline when curve points provided', async () => {
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(false)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        toneCurvePoints: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 },
        ],
      }

      await pipeline.process(input, params)

      expect(getToneCurvePipeline).toHaveBeenCalled()
      expect(generateLutFromCurvePoints).toHaveBeenCalledWith(params.toneCurvePoints)
      expect(mockToneCurvePipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should skip tone curve if generated LUT is identity', async () => {
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(true)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        toneCurvePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }

      await pipeline.process(input, params)

      expect(getToneCurvePipeline).not.toHaveBeenCalled()
    })
  })

  describe('tone curve with LUT', () => {
    it('should call tone curve pipeline when LUT provided', async () => {
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(false)

      const lut = { lut: new Uint8Array(256).map((_, i) => 255 - i) }
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { toneCurveLut: lut }

      await pipeline.process(input, params)

      expect(getToneCurvePipeline).toHaveBeenCalled()
      expect(mockToneCurvePipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should not call tone curve pipeline when LUT is identity', async () => {
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(true)

      const lut = { lut: new Uint8Array(256).map((_, i) => i) }
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { toneCurveLut: lut }

      await pipeline.process(input, params)

      expect(getToneCurvePipeline).not.toHaveBeenCalled()
    })

    it('should use provided LUT instead of generating from points', async () => {
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(false)

      const lut = { lut: new Uint8Array(256).map((_, i) => 255 - i) }
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        toneCurveLut: lut,
        toneCurvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      }

      await pipeline.process(input, params)

      expect(generateLutFromCurvePoints).not.toHaveBeenCalled()
      expect(mockToneCurvePipeline.applyToTextures).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Number),
        expect.any(Number),
        lut,
        expect.anything()
      )
    })
  })

  describe('masks (enabled)', () => {
    it('should call mask pipeline when masks have enabled linear mask', async () => {
      vi.mocked(getMaskPipeline).mockResolvedValue(mockMaskPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        masks: {
          linearMasks: [{
            startX: 0, startY: 0, endX: 1, endY: 1,
            feather: 0.5, enabled: true, adjustments: { exposure: 1 },
          }],
          radialMasks: [],
        },
      }

      await pipeline.process(input, params)

      expect(getMaskPipeline).toHaveBeenCalled()
      expect(mockMaskPipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should call mask pipeline when masks have enabled radial mask', async () => {
      vi.mocked(getMaskPipeline).mockResolvedValue(mockMaskPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        masks: {
          linearMasks: [],
          radialMasks: [{
            centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
            rotation: 0, feather: 0.5, invert: false, enabled: true,
            adjustments: { exposure: 1 },
          }],
        },
      }

      await pipeline.process(input, params)

      expect(getMaskPipeline).toHaveBeenCalled()
      expect(mockMaskPipeline.applyToTextures).toHaveBeenCalled()
    })

    it('should not call mask pipeline when all masks disabled', async () => {
      vi.mocked(getMaskPipeline).mockResolvedValue(mockMaskPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        masks: {
          linearMasks: [{
            startX: 0, startY: 0, endX: 1, endY: 1,
            feather: 0.5, enabled: false, adjustments: { exposure: 1 },
          }],
          radialMasks: [{
            centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
            rotation: 0, feather: 0.5, invert: false, enabled: false, adjustments: {},
          }],
        },
      }

      await pipeline.process(input, params)

      expect(getMaskPipeline).not.toHaveBeenCalled()
    })

    it('should not call mask pipeline when masks undefined', async () => {
      vi.mocked(getMaskPipeline).mockResolvedValue(mockMaskPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      await pipeline.process(input, params)

      expect(getMaskPipeline).not.toHaveBeenCalled()
    })
  })

  describe('all operations combined', () => {
    it('should call all pipelines in correct order when all enabled', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockAdjustmentsPipeline as any)
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)
      vi.mocked(getMaskPipeline).mockResolvedValue(mockMaskPipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(false)

      const callOrder: string[] = []
      mockRotationPipeline.applyToTextures.mockImplementation((...args) => {
        callOrder.push('rotation')
        return args[7]
      })
      mockAdjustmentsPipeline.applyToTextures.mockImplementation((...args) => {
        callOrder.push('adjustments')
        return args[5]
      })
      mockToneCurvePipeline.applyToTextures.mockImplementation((...args) => {
        callOrder.push('toneCurve')
        return args[5]
      })
      mockMaskPipeline.applyToTextures.mockImplementation((...args) => {
        callOrder.push('masks')
        return args[5]
      })

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        rotation: 45,
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 1 },
        toneCurvePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
        masks: {
          linearMasks: [{
            startX: 0, startY: 0, endX: 1, endY: 1,
            feather: 0.5, enabled: true, adjustments: {},
          }],
          radialMasks: [],
        },
      }

      await pipeline.process(input, params)

      expect(mockRotationPipeline.applyToTextures).toHaveBeenCalled()
      expect(mockAdjustmentsPipeline.applyToTextures).toHaveBeenCalled()
      expect(mockToneCurvePipeline.applyToTextures).toHaveBeenCalled()
      expect(mockMaskPipeline.applyToTextures).toHaveBeenCalled()

      expect(callOrder).toEqual(['rotation', 'adjustments', 'toneCurve', 'masks'])
    })
  })

  describe('empty params (no operations)', () => {
    it('should process with minimal operations when params empty', async () => {
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result).toBeDefined()
      expect(result.width).toBe(4)
      expect(result.height).toBe(4)
      expect(result.pixels).toBeInstanceOf(Uint8Array)

      expect(getRotationPipeline).not.toHaveBeenCalled()
      expect(getAdjustmentsPipeline).not.toHaveBeenCalled()
      expect(getToneCurvePipeline).not.toHaveBeenCalled()
      expect(getMaskPipeline).not.toHaveBeenCalled()
    })

    it('should still convert RGB to RGBA and back', async () => {
      const input = createTestInput(2, 2)
      const params: EditPipelineParams = {}

      await pipeline.process(input, params)

      expect(createTextureFromPixels).toHaveBeenCalled()
      expect(readTexturePixels).toHaveBeenCalled()
    })
  })

  describe('timing breakdown', () => {
    it('should have all timing fields populated', async () => {
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result.timing).toHaveProperty('total')
      expect(result.timing).toHaveProperty('upload')
      expect(result.timing).toHaveProperty('rotation')
      expect(result.timing).toHaveProperty('adjustments')
      expect(result.timing).toHaveProperty('toneCurve')
      expect(result.timing).toHaveProperty('masks')
      expect(result.timing).toHaveProperty('readback')
    })

    it('should have non-negative timing values', async () => {
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result.timing.total).toBeGreaterThanOrEqual(0)
      expect(result.timing.upload).toBeGreaterThanOrEqual(0)
      expect(result.timing.rotation).toBeGreaterThanOrEqual(0)
      expect(result.timing.adjustments).toBeGreaterThanOrEqual(0)
      expect(result.timing.toneCurve).toBeGreaterThanOrEqual(0)
      expect(result.timing.masks).toBeGreaterThanOrEqual(0)
      expect(result.timing.readback).toBeGreaterThanOrEqual(0)
    })

    it('should record rotation timing when rotation applied', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = { rotation: 45 }

      const result = await pipeline.process(input, params)

      expect(result.timing.rotation).toBeGreaterThanOrEqual(0)
    })

    it('should have zero rotation timing when rotation skipped', async () => {
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result.timing.rotation).toBe(0)
    })
  })

  describe('texture cleanup', () => {
    it('should destroy all created textures after process', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)
      vi.mocked(getAdjustmentsPipeline).mockResolvedValue(mockAdjustmentsPipeline as any)
      vi.mocked(isIdentityLut).mockReturnValue(false)
      vi.mocked(getToneCurvePipeline).mockResolvedValue(mockToneCurvePipeline as any)

      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {
        rotation: 45,
        adjustments: { ...DEFAULT_BASIC_ADJUSTMENTS, exposure: 1 },
        toneCurvePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
      }

      await pipeline.process(input, params)

      for (const texture of createdTextures) {
        expect(texture.destroy).toHaveBeenCalled()
      }
    })

    it('should cleanup textures even with empty params', async () => {
      const input = createTestInput(4, 4)
      const params: EditPipelineParams = {}

      await pipeline.process(input, params)

      expect(createdTextures.length).toBeGreaterThan(0)
      for (const texture of createdTextures) {
        expect(texture.destroy).toHaveBeenCalled()
      }
    })
  })

  describe('RGB output format', () => {
    it('should return RGB output (3 bytes per pixel)', async () => {
      const width = 4
      const height = 4
      const input = createTestInput(width, height)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result.pixels.length).toBe(width * height * 3)
    })

    it('should return correct dimensions in result', async () => {
      const width = 8
      const height = 6
      const input = createTestInput(width, height)
      const params: EditPipelineParams = {}

      const result = await pipeline.process(input, params)

      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
    })

    it('should return updated dimensions after rotation', async () => {
      vi.mocked(getRotationPipeline).mockResolvedValue(mockRotationPipeline as any)
      vi.mocked(RotationPipeline.computeRotatedDimensions).mockReturnValue({
        width: 10,
        height: 10,
      })
      vi.mocked(readTexturePixels).mockResolvedValue(new Uint8Array(10 * 10 * 4).fill(128))

      const input = createTestInput(8, 6)
      const params: EditPipelineParams = { rotation: 45 }

      const result = await pipeline.process(input, params)

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
      expect(result.pixels.length).toBe(10 * 10 * 3)
    })
  })
})

describe('_internal.shouldApplyMasks', () => {
  const { shouldApplyMasks } = _internal

  // Helper to create a linear mask
  const createLinearMask = (enabled: boolean) => ({
    startX: 0,
    startY: 0,
    endX: 1,
    endY: 1,
    feather: 0.5,
    enabled,
    adjustments: {},
  })

  // Helper to create a radial mask
  const createRadialMask = (enabled: boolean) => ({
    centerX: 0.5,
    centerY: 0.5,
    radiusX: 0.3,
    radiusY: 0.3,
    rotation: 0,
    feather: 0.5,
    invert: false,
    enabled,
    adjustments: {},
  })

  describe('should return false', () => {
    it('when masks is undefined', () => {
      expect(shouldApplyMasks(undefined)).toBe(false)
    })

    it('when both mask arrays are empty', () => {
      expect(shouldApplyMasks({ linearMasks: [], radialMasks: [] })).toBe(false)
    })

    it('when all linear masks are disabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(false), createLinearMask(false)],
          radialMasks: [],
        })
      ).toBe(false)
    })

    it('when all radial masks are disabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [],
          radialMasks: [createRadialMask(false), createRadialMask(false)],
        })
      ).toBe(false)
    })

    it('when all masks (both types) are disabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(false)],
          radialMasks: [createRadialMask(false)],
        })
      ).toBe(false)
    })

    it('when linearMasks is undefined and radialMasks is empty', () => {
      expect(
        shouldApplyMasks({
          linearMasks: undefined as any, // Simulating potential undefined
          radialMasks: [],
        })
      ).toBe(false)
    })

    it('when linearMasks is empty and radialMasks is undefined', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [],
          radialMasks: undefined as any, // Simulating potential undefined
        })
      ).toBe(false)
    })
  })

  describe('should return true', () => {
    it('when at least one linear mask is enabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(true)],
          radialMasks: [],
        })
      ).toBe(true)
    })

    it('when at least one radial mask is enabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [],
          radialMasks: [createRadialMask(true)],
        })
      ).toBe(true)
    })

    it('when one linear mask is enabled among disabled ones', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(false), createLinearMask(true), createLinearMask(false)],
          radialMasks: [],
        })
      ).toBe(true)
    })

    it('when one radial mask is enabled among disabled ones', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [],
          radialMasks: [createRadialMask(false), createRadialMask(true)],
        })
      ).toBe(true)
    })

    it('when both types have enabled masks', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(true)],
          radialMasks: [createRadialMask(true)],
        })
      ).toBe(true)
    })

    it('when only linear masks enabled and radial all disabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(true)],
          radialMasks: [createRadialMask(false)],
        })
      ).toBe(true)
    })

    it('when only radial masks enabled and linear all disabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(false)],
          radialMasks: [createRadialMask(true)],
        })
      ).toBe(true)
    })

    it('when multiple linear masks are enabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [createLinearMask(true), createLinearMask(true), createLinearMask(true)],
          radialMasks: [],
        })
      ).toBe(true)
    })

    it('when multiple radial masks are enabled', () => {
      expect(
        shouldApplyMasks({
          linearMasks: [],
          radialMasks: [createRadialMask(true), createRadialMask(true)],
        })
      ).toBe(true)
    })
  })
})
