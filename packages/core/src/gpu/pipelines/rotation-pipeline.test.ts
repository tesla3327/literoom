/**
 * Unit tests for RotationPipeline.
 *
 * Tests the static computeRotatedDimensions method which calculates
 * the bounding box dimensions for a rotated image.
 * Also tests RGB/RGBA conversion helpers through the pipeline.
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
  RotationPipeline,
  getRotationPipeline,
  resetRotationPipeline,
} from './rotation-pipeline'

// ============================================================================
// Mock WebGPU API
// ============================================================================

interface MockGPUTextureView {
  label?: string
}

interface MockGPUTexture {
  label?: string
  createView: () => MockGPUTextureView
  destroy: () => void
}

interface MockGPUBuffer {
  label?: string
  destroy: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}

interface MockGPUBindGroup {
  label?: string
}

interface MockGPUBindGroupLayout {
  label?: string
}

interface MockGPUPipelineLayout {
  label?: string
}

interface MockGPUShaderModule {
  label?: string
}

interface MockGPUComputePipeline {
  label?: string
}

interface MockGPUComputePassEncoder {
  setPipeline: (pipeline: MockGPUComputePipeline) => void
  setBindGroup: (index: number, bindGroup: MockGPUBindGroup) => void
  dispatchWorkgroups: (x: number, y: number, z: number) => void
  end: () => void
}

interface MockGPUCommandBuffer {
  label?: string
}

interface MockGPUCommandEncoder {
  beginComputePass: (descriptor: { label?: string }) => MockGPUComputePassEncoder
  copyTextureToBuffer: (
    source: { texture: MockGPUTexture },
    dest: { buffer: MockGPUBuffer; bytesPerRow: number; rowsPerImage: number },
    size: { width: number; height: number; depthOrArrayLayers: number }
  ) => void
  finish: () => MockGPUCommandBuffer
}

interface MockGPUQueue {
  writeTexture: (
    dest: { texture: MockGPUTexture },
    data: ArrayBuffer,
    dataLayout: { bytesPerRow: number; rowsPerImage: number; offset?: number },
    size: { width: number; height: number; depthOrArrayLayers: number }
  ) => void
  writeBuffer: (buffer: MockGPUBuffer, offset: number, data: ArrayBuffer) => void
  submit: (commands: MockGPUCommandBuffer[]) => void
}

interface MockGPUDevice {
  createShaderModule: (descriptor: { label?: string; code: string }) => MockGPUShaderModule
  createBindGroupLayout: (descriptor: {
    label?: string
    entries: unknown[]
  }) => MockGPUBindGroupLayout
  createPipelineLayout: (descriptor: {
    label?: string
    bindGroupLayouts: unknown[]
  }) => MockGPUPipelineLayout
  createComputePipeline: (descriptor: {
    label?: string
    layout: MockGPUPipelineLayout
    compute: { module: MockGPUShaderModule; entryPoint: string }
  }) => MockGPUComputePipeline
  createTexture: (descriptor: {
    label?: string
    size: { width: number; height: number; depthOrArrayLayers: number }
    format: string
    usage: number
  }) => MockGPUTexture
  createBuffer: (descriptor: { label?: string; size: number; usage: number }) => MockGPUBuffer
  createBindGroup: (descriptor: {
    label?: string
    layout: MockGPUBindGroupLayout
    entries: unknown[]
  }) => MockGPUBindGroup
  createCommandEncoder: (descriptor: { label?: string }) => MockGPUCommandEncoder
  queue: MockGPUQueue
}

let mockDevice: MockGPUDevice
let mockStagingBufferData: Uint8Array
let capturedTextureData: ArrayBuffer | null = null
let createdBuffers: MockGPUBuffer[]

function createMockDevice(): MockGPUDevice {
  capturedTextureData = null
  createdBuffers = []
  mockStagingBufferData = new Uint8Array([128, 64, 192, 255]) // Default single pixel result

  const mockTextureView: MockGPUTextureView = {}

  const createMockTexture = (): MockGPUTexture => {
    const texture: MockGPUTexture = {
      createView: vi.fn(() => mockTextureView),
      destroy: vi.fn(),
    }
    return texture
  }

  const createMockBuffer = (): MockGPUBuffer => {
    const buffer: MockGPUBuffer = {
      destroy: vi.fn(),
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => mockStagingBufferData.buffer as ArrayBuffer),
      unmap: vi.fn(),
    }
    createdBuffers.push(buffer)
    return buffer
  }

  const mockComputePass: MockGPUComputePassEncoder = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  }

  const mockCommandEncoder: MockGPUCommandEncoder = {
    beginComputePass: vi.fn(() => mockComputePass),
    copyTextureToBuffer: vi.fn(),
    finish: vi.fn(() => ({})),
  }

  const mockQueue: MockGPUQueue = {
    writeTexture: vi.fn((_dest, data) => {
      capturedTextureData = data
    }),
    writeBuffer: vi.fn(),
    submit: vi.fn(),
  }

  return {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createTexture: vi.fn(createMockTexture),
    createBuffer: vi.fn(createMockBuffer),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => mockCommandEncoder),
    queue: mockQueue,
  }
}

// Mock the capabilities module
vi.mock('../capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: true,
    device: null, // Will be set in tests
  })),
}))

import { getGPUCapabilityService } from '../capabilities'

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
  resetRotationPipeline()

  // Setup mock to return our device
  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  vi.clearAllMocks()
  resetRotationPipeline()
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate expected rotated dimensions using the formula:
 * width = round(w * |cos(theta)| + h * |sin(theta)|)
 * height = round(w * |sin(theta)| + h * |cos(theta)|)
 */
function expectedRotatedDimensions(
  width: number,
  height: number,
  angleDegrees: number
): { width: number; height: number } {
  const radians = (angleDegrees * Math.PI) / 180
  const cosTheta = Math.abs(Math.cos(radians))
  const sinTheta = Math.abs(Math.sin(radians))

  return {
    width: Math.round(width * cosTheta + height * sinTheta),
    height: Math.round(width * sinTheta + height * cosTheta),
  }
}

// ============================================================================
// computeRotatedDimensions Tests
// ============================================================================

describe('RotationPipeline', () => {
  describe('computeRotatedDimensions', () => {
    // ========================================================================
    // Cardinal Angles (0, 90, 180, 270, 360)
    // ========================================================================

    describe('cardinal angles', () => {
      it('returns same dimensions for 0 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 0)

        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      })

      it('swaps width and height for 90 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 90)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })

      it('returns same dimensions for 180 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 180)

        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      })

      it('swaps width and height for 270 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 270)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })

      it('returns same dimensions for 360 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 360)

        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      })
    })

    // ========================================================================
    // 45 Degree Angles
    // ========================================================================

    describe('45 degree angles', () => {
      it('computes correct bounding box for 45 degrees', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 45)
        const expected = expectedRotatedDimensions(width, height, 45)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('computes correct bounding box for 135 degrees', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 135)
        const expected = expectedRotatedDimensions(width, height, 135)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('computes correct bounding box for 225 degrees', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 225)
        const expected = expectedRotatedDimensions(width, height, 225)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('computes correct bounding box for 315 degrees', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 315)
        const expected = expectedRotatedDimensions(width, height, 315)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })
    })

    // ========================================================================
    // Negative Angles
    // ========================================================================

    describe('negative angles', () => {
      it('handles -90 degrees same as 270 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, -90)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })

      it('handles -180 degrees same as 180 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, -180)

        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      })

      it('handles -45 degrees same as 315 degrees', () => {
        const width = 100
        const height = 50
        const resultNegative = RotationPipeline.computeRotatedDimensions(width, height, -45)
        const resultPositive = RotationPipeline.computeRotatedDimensions(width, height, 315)

        expect(resultNegative.width).toBe(resultPositive.width)
        expect(resultNegative.height).toBe(resultPositive.height)
      })

      it('handles -270 degrees same as 90 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, -270)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })
    })

    // ========================================================================
    // Angles > 360 (Normalization)
    // ========================================================================

    describe('angles greater than 360', () => {
      it('normalizes 450 degrees to 90 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 450)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })

      it('normalizes 720 degrees to 0 degrees', () => {
        const result = RotationPipeline.computeRotatedDimensions(100, 50, 720)

        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      })

      it('normalizes 405 degrees to 45 degrees', () => {
        const width = 100
        const height = 50
        const result405 = RotationPipeline.computeRotatedDimensions(width, height, 405)
        const result45 = RotationPipeline.computeRotatedDimensions(width, height, 45)

        expect(result405.width).toBe(result45.width)
        expect(result405.height).toBe(result45.height)
      })

      it('handles very large angles', () => {
        const width = 100
        const height = 50
        // 3690 degrees = 10 * 360 + 90 = 90 degrees
        const result = RotationPipeline.computeRotatedDimensions(width, height, 3690)

        expect(result.width).toBe(50)
        expect(result.height).toBe(100)
      })
    })

    // ========================================================================
    // Various Aspect Ratios
    // ========================================================================

    describe('various aspect ratios', () => {
      describe('square images', () => {
        it('returns same dimensions for 0 degrees on square', () => {
          const result = RotationPipeline.computeRotatedDimensions(100, 100, 0)

          expect(result.width).toBe(100)
          expect(result.height).toBe(100)
        })

        it('returns same dimensions for 90 degrees on square', () => {
          const result = RotationPipeline.computeRotatedDimensions(100, 100, 90)

          expect(result.width).toBe(100)
          expect(result.height).toBe(100)
        })

        it('computes symmetric bounding box for 45 degrees on square', () => {
          const result = RotationPipeline.computeRotatedDimensions(100, 100, 45)

          // For a square at 45 degrees, width and height should be equal
          expect(result.width).toBe(result.height)
        })
      })

      describe('landscape images', () => {
        it('handles wide landscape ratio', () => {
          const width = 200
          const height = 50
          const result = RotationPipeline.computeRotatedDimensions(width, height, 30)
          const expected = expectedRotatedDimensions(width, height, 30)

          expect(result.width).toBe(expected.width)
          expect(result.height).toBe(expected.height)
        })

        it('handles standard landscape ratio (16:9)', () => {
          const width = 1920
          const height = 1080
          const result = RotationPipeline.computeRotatedDimensions(width, height, 15)
          const expected = expectedRotatedDimensions(width, height, 15)

          expect(result.width).toBe(expected.width)
          expect(result.height).toBe(expected.height)
        })
      })

      describe('portrait images', () => {
        it('handles tall portrait ratio', () => {
          const width = 50
          const height = 200
          const result = RotationPipeline.computeRotatedDimensions(width, height, 30)
          const expected = expectedRotatedDimensions(width, height, 30)

          expect(result.width).toBe(expected.width)
          expect(result.height).toBe(expected.height)
        })

        it('handles standard portrait ratio (9:16)', () => {
          const width = 1080
          const height = 1920
          const result = RotationPipeline.computeRotatedDimensions(width, height, 15)
          const expected = expectedRotatedDimensions(width, height, 15)

          expect(result.width).toBe(expected.width)
          expect(result.height).toBe(expected.height)
        })
      })
    })

    // ========================================================================
    // Edge Cases
    // ========================================================================

    describe('edge cases', () => {
      it('handles 1x1 image', () => {
        const result = RotationPipeline.computeRotatedDimensions(1, 1, 45)

        // 1x1 rotated should still be approximately 1x1 (or 2x2 due to rounding)
        expect(result.width).toBeGreaterThanOrEqual(1)
        expect(result.height).toBeGreaterThanOrEqual(1)
      })

      it('handles small angles (1 degree)', () => {
        const width = 1000
        const height = 500
        const result = RotationPipeline.computeRotatedDimensions(width, height, 1)
        const expected = expectedRotatedDimensions(width, height, 1)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('handles angles close to 90 (89 degrees)', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 89)
        const expected = expectedRotatedDimensions(width, height, 89)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('handles fractional angles', () => {
        const width = 100
        const height = 50
        const result = RotationPipeline.computeRotatedDimensions(width, height, 22.5)
        const expected = expectedRotatedDimensions(width, height, 22.5)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })

      it('handles very large dimensions', () => {
        const width = 10000
        const height = 8000
        const result = RotationPipeline.computeRotatedDimensions(width, height, 30)
        const expected = expectedRotatedDimensions(width, height, 30)

        expect(result.width).toBe(expected.width)
        expect(result.height).toBe(expected.height)
      })
    })

    // ========================================================================
    // Symmetry Properties
    // ========================================================================

    describe('symmetry properties', () => {
      it('produces same result for angle and (360 - angle)', () => {
        const width = 100
        const height = 50

        const result30 = RotationPipeline.computeRotatedDimensions(width, height, 30)
        const result330 = RotationPipeline.computeRotatedDimensions(width, height, 330)

        expect(result30.width).toBe(result330.width)
        expect(result30.height).toBe(result330.height)
      })

      it('produces same result for angle and (180 + angle)', () => {
        const width = 100
        const height = 50

        const result45 = RotationPipeline.computeRotatedDimensions(width, height, 45)
        const result225 = RotationPipeline.computeRotatedDimensions(width, height, 225)

        expect(result45.width).toBe(result225.width)
        expect(result45.height).toBe(result225.height)
      })

      it('swapping width and height with 90-degree offset gives same result', () => {
        const width = 100
        const height = 50

        // Rotating (w, h) by theta should give same bounding box as
        // rotating (h, w) by (90 - theta)
        const result1 = RotationPipeline.computeRotatedDimensions(width, height, 30)
        const result2 = RotationPipeline.computeRotatedDimensions(height, width, 60)

        expect(result1.width).toBe(result2.width)
        expect(result1.height).toBe(result2.height)
      })
    })
  })

  // ========================================================================
  // RotationPipeline Class Tests
  // ========================================================================

  describe('constructor', () => {
    it('accepts GPUDevice', () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('creates pipeline (mock the device)', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Rotation Shader',
        code: expect.any(String),
      })

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: 'Rotation Bind Group Layout',
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Output storage texture
          expect.objectContaining({ binding: 2 }), // Rotation params buffer
          expect.objectContaining({ binding: 3 }), // Dimensions buffer
        ]),
      })

      expect(mockDevice.createComputePipeline).toHaveBeenCalledWith({
        label: 'Rotation Compute Pipeline',
        layout: expect.anything(),
        compute: {
          module: expect.anything(),
          entryPoint: 'main',
        },
      })

      // Params buffer (32 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Rotation Params Uniform Buffer',
        size: 32,
        usage: expect.any(Number),
      })

      // Dimensions buffer (16 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Rotation Dimensions Uniform Buffer',
        size: 16,
        usage: expect.any(Number),
      })
    })

    it('is idempotent (calling twice does not recreate)', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(1)
      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledTimes(1)
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(2) // params + dims buffers
    })
  })

  describe('destroy', () => {
    it('cleans up resources', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      pipeline.destroy()

      // The first two buffers created are the uniform buffers (params and dims)
      expect(createdBuffers[0].destroy).toHaveBeenCalled()
      expect(createdBuffers[1].destroy).toHaveBeenCalled()
    })

    it('allows re-initialization after destroy', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      pipeline.destroy()

      // Should not throw
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(2)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // apply() Method Tests
  // ==========================================================================

  describe('apply', () => {
    /**
     * Create test RGB pixels (3 bytes per pixel).
     */
    function createTestRgbPixels(width: number, height: number): Uint8Array {
      const pixels = new Uint8Array(width * height * 3)
      for (let i = 0; i < width * height; i++) {
        pixels[i * 3] = 128 // R
        pixels[i * 3 + 1] = 64 // G
        pixels[i * 3 + 2] = 192 // B
      }
      return pixels
    }

    /**
     * Create mock RGBA staging buffer data for GPU readback.
     */
    function createMockRgbaOutput(width: number, height: number): Uint8Array {
      const pixels = new Uint8Array(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        pixels[i * 4] = 200 // R
        pixels[i * 4 + 1] = 100 // G
        pixels[i * 4 + 2] = 50 // B
        pixels[i * 4 + 3] = 255 // A
      }
      return pixels
    }

    it('throws error if pipeline not initialized', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      const pixels = createTestRgbPixels(2, 2)

      await expect(pipeline.apply(pixels, 2, 2, 45)).rejects.toThrow(
        'Pipeline not initialized. Call initialize() first.'
      )
    })

    it('converts RGB input to RGBA internally', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Set up mock output for a 2x2 image
      mockStagingBufferData = createMockRgbaOutput(2, 2)

      const pixels = createTestRgbPixels(2, 2)
      expect(pixels.length).toBe(2 * 2 * 3) // RGB input

      await pipeline.apply(pixels, 2, 2, 0)

      // Check that writeTexture was called with RGBA data (width * 4 bytes per row)
      expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
        expect.objectContaining({ texture: expect.anything() }),
        expect.any(ArrayBuffer),
        expect.objectContaining({ bytesPerRow: 2 * 4, rowsPerImage: 2 }),
        { width: 2, height: 2, depthOrArrayLayers: 1 }
      )

      // Verify the captured texture data is RGBA (4 bytes per pixel)
      expect(capturedTextureData).not.toBeNull()
      expect(new Uint8Array(capturedTextureData!).length).toBe(2 * 2 * 4)
    })

    it('calls GPU operations with correct parameters', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = createMockRgbaOutput(2, 2)

      const pixels = createTestRgbPixels(2, 2)
      await pipeline.apply(pixels, 2, 2, 45)

      // Verify texture creation
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Rotation Input Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
        })
      )

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Rotation Output Texture',
          format: 'rgba8unorm',
        })
      )

      // Verify uniform buffer writes (params and dimensions)
      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(2)

      // Verify command encoder creation
      expect(mockDevice.createCommandEncoder).toHaveBeenCalledWith({
        label: 'Rotation Command Encoder',
      })

      // Verify staging buffer creation for readback
      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Rotation Staging Buffer',
        })
      )

      // Verify submission
      expect(mockDevice.queue.submit).toHaveBeenCalled()
    })

    it('returns RotationResult with correct structure (pixels, width, height)', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // For 45 degree rotation, output dimensions change
      const outDims = RotationPipeline.computeRotatedDimensions(4, 4, 45)
      mockStagingBufferData = createMockRgbaOutput(outDims.width, outDims.height)

      const pixels = createTestRgbPixels(4, 4)
      const result = await pipeline.apply(pixels, 4, 4, 45)

      // Check result structure
      expect(result).toHaveProperty('pixels')
      expect(result).toHaveProperty('width')
      expect(result).toHaveProperty('height')
      expect(result.pixels).toBeInstanceOf(Uint8Array)
      expect(typeof result.width).toBe('number')
      expect(typeof result.height).toBe('number')
      expect(result.width).toBe(outDims.width)
      expect(result.height).toBe(outDims.height)
    })

    it('returns RGB output (not RGBA)', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const width = 3
      const height = 2
      mockStagingBufferData = createMockRgbaOutput(width, height)

      const pixels = createTestRgbPixels(width, height)
      const result = await pipeline.apply(pixels, width, height, 0)

      // RGB output should be width * height * 3 bytes
      expect(result.pixels.length).toBe(width * height * 3)

      // Check that RGB values are correct (from mock RGBA: R=200, G=100, B=50)
      expect(result.pixels[0]).toBe(200) // R
      expect(result.pixels[1]).toBe(100) // G
      expect(result.pixels[2]).toBe(50) // B
    })
  })

  // ==========================================================================
  // applyToTextures() Method Tests
  // ==========================================================================

  describe('applyToTextures', () => {
    it('throws error if pipeline not initialized', () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      expect(() =>
        pipeline.applyToTextures(mockInput, mockOutput, 10, 10, 10, 10, 45)
      ).toThrow('Pipeline not initialized. Call initialize() first.')
    })

    it('works with provided encoder', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      const providedEncoder = mockDevice.createCommandEncoder({ label: 'Provided' })
      const returnedEncoder = pipeline.applyToTextures(
        mockInput,
        mockOutput,
        10,
        10,
        10,
        10,
        45,
        providedEncoder as unknown as GPUCommandEncoder
      )

      expect(returnedEncoder).toBe(providedEncoder)
    })

    it('creates encoder if not provided', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      const callCountBefore = vi.mocked(mockDevice.createCommandEncoder).mock.calls.length

      pipeline.applyToTextures(mockInput, mockOutput, 10, 10, 10, 10, 45)

      expect(mockDevice.createCommandEncoder).toHaveBeenCalledTimes(callCountBefore + 1)
    })

    it('returns command encoder', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      const result = pipeline.applyToTextures(mockInput, mockOutput, 10, 10, 10, 10, 45)

      expect(result).toBeDefined()
      // The result should be a command encoder (our mock)
      expect(typeof result.beginComputePass).toBe('function')
      expect(typeof result.finish).toBe('function')
    })
  })
})

// ============================================================================
// Singleton Management Tests
// ============================================================================

describe('getRotationPipeline', () => {
  it('returns pipeline when GPU available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getRotationPipeline()

    expect(pipeline).toBeInstanceOf(RotationPipeline)
  })

  it('returns null when GPU not available (isReady false)', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getRotationPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns null when GPU not available (device null)', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getRotationPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns same instance on subsequent calls', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getRotationPipeline()
    const pipeline2 = await getRotationPipeline()

    expect(pipeline1).toBe(pipeline2)
  })

  it('initializes the pipeline automatically', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getRotationPipeline()

    expect(mockDevice.createShaderModule).toHaveBeenCalled()
    expect(mockDevice.createComputePipeline).toHaveBeenCalled()
  })
})

describe('resetRotationPipeline', () => {
  it('cleans up and resets singleton', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getRotationPipeline()
    resetRotationPipeline()
    const pipeline2 = await getRotationPipeline()

    expect(pipeline1).not.toBe(pipeline2)
  })

  it('destroys previous instance', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getRotationPipeline()

    const buffersBefore = createdBuffers.length
    resetRotationPipeline()

    // Check that destroy was called on the uniform buffers
    for (let i = 0; i < buffersBefore; i++) {
      expect(createdBuffers[i].destroy).toHaveBeenCalled()
    }
  })
})

// ============================================================================
// Helper Function Tests (tested through the pipeline)
// ============================================================================

describe('helper functions', () => {
  describe('rgbToRgba conversion', () => {
    it('preserves R, G, B values', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Set up mock to return known RGBA data
      mockStagingBufferData = new Uint8Array([100, 150, 200, 255])

      // Single pixel: R=100, G=150, B=200
      const rgbPixels = new Uint8Array([100, 150, 200])

      await pipeline.apply(rgbPixels, 1, 1, 0)

      // Check that writeTexture was called with RGBA data
      expect(capturedTextureData).not.toBeNull()
      const rgbaView = new Uint8Array(capturedTextureData!)
      expect(rgbaView[0]).toBe(100) // R preserved
      expect(rgbaView[1]).toBe(150) // G preserved
      expect(rgbaView[2]).toBe(200) // B preserved
    })

    it('adds alpha=255 for each pixel', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array([50, 100, 150, 255])

      // Single pixel
      const rgbPixels = new Uint8Array([50, 100, 150])

      await pipeline.apply(rgbPixels, 1, 1, 0)

      expect(capturedTextureData).not.toBeNull()
      const rgbaView = new Uint8Array(capturedTextureData!)
      expect(rgbaView[3]).toBe(255) // Alpha is fully opaque
    })

    it('handles single pixel correctly', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array([128, 64, 192, 255])

      // Single pixel
      const rgbPixels = new Uint8Array([128, 64, 192])

      await pipeline.apply(rgbPixels, 1, 1, 0)

      expect(capturedTextureData).not.toBeNull()
      const rgbaView = new Uint8Array(capturedTextureData!)
      expect(rgbaView.length).toBe(4) // Single RGBA pixel
      expect(rgbaView[0]).toBe(128) // R
      expect(rgbaView[1]).toBe(64) // G
      expect(rgbaView[2]).toBe(192) // B
      expect(rgbaView[3]).toBe(255) // A
    })

    it('handles multiple pixels correctly', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // 2x2 = 4 pixels RGBA output
      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      // 2x2 RGB pixels
      const rgbPixels = new Uint8Array([
        255, 0, 0, // Red pixel
        0, 255, 0, // Green pixel
        0, 0, 255, // Blue pixel
        128, 128, 128, // Gray pixel
      ])

      await pipeline.apply(rgbPixels, 2, 2, 0)

      expect(capturedTextureData).not.toBeNull()
      const rgbaView = new Uint8Array(capturedTextureData!)
      expect(rgbaView.length).toBe(16) // 4 pixels * 4 bytes

      // First pixel (red)
      expect(rgbaView[0]).toBe(255) // R
      expect(rgbaView[1]).toBe(0) // G
      expect(rgbaView[2]).toBe(0) // B
      expect(rgbaView[3]).toBe(255) // A

      // Second pixel (green)
      expect(rgbaView[4]).toBe(0) // R
      expect(rgbaView[5]).toBe(255) // G
      expect(rgbaView[6]).toBe(0) // B
      expect(rgbaView[7]).toBe(255) // A

      // Third pixel (blue)
      expect(rgbaView[8]).toBe(0) // R
      expect(rgbaView[9]).toBe(0) // G
      expect(rgbaView[10]).toBe(255) // B
      expect(rgbaView[11]).toBe(255) // A

      // Fourth pixel (gray)
      expect(rgbaView[12]).toBe(128) // R
      expect(rgbaView[13]).toBe(128) // G
      expect(rgbaView[14]).toBe(128) // B
      expect(rgbaView[15]).toBe(255) // A
    })
  })

  describe('rgbaToRgb conversion', () => {
    it('strips alpha channel', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Mock GPU returning RGBA with alpha=200 (not 255)
      mockStagingBufferData = new Uint8Array([110, 160, 210, 200])

      const rgbPixels = new Uint8Array([100, 150, 200])

      const result = await pipeline.apply(rgbPixels, 1, 1, 0)

      // Result should be RGB (3 bytes), alpha stripped
      expect(result.pixels.length).toBe(3)
    })

    it('preserves R, G, B values', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Mock GPU returning specific RGBA values
      mockStagingBufferData = new Uint8Array([110, 160, 210, 255])

      const rgbPixels = new Uint8Array([100, 150, 200])

      const result = await pipeline.apply(rgbPixels, 1, 1, 0)

      expect(result.pixels[0]).toBe(110) // R
      expect(result.pixels[1]).toBe(160) // G
      expect(result.pixels[2]).toBe(210) // B
    })

    it('handles multiple pixels correctly', async () => {
      const pipeline = new RotationPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // 2 pixels RGBA output from GPU
      mockStagingBufferData = new Uint8Array([
        255, 128, 64, 255, // Pixel 1
        32, 64, 128, 200, // Pixel 2 (alpha ignored)
      ])

      // 2 pixels RGB input (2x1 image)
      const rgbPixels = new Uint8Array([100, 150, 200, 50, 100, 150])

      const result = await pipeline.apply(rgbPixels, 2, 1, 0)

      expect(result.pixels.length).toBe(6) // 2 pixels * 3 bytes

      // First pixel
      expect(result.pixels[0]).toBe(255) // R
      expect(result.pixels[1]).toBe(128) // G
      expect(result.pixels[2]).toBe(64) // B

      // Second pixel
      expect(result.pixels[3]).toBe(32) // R
      expect(result.pixels[4]).toBe(64) // G
      expect(result.pixels[5]).toBe(128) // B
    })
  })
})
