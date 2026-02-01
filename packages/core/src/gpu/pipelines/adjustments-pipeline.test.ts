/**
 * Unit tests for AdjustmentsPipeline.
 *
 * Tests the GPU compute pipeline for basic image adjustments including:
 * - Pipeline initialization and lifecycle
 * - Shader compilation and bind group creation
 * - Texture processing
 * - Resource cleanup
 * - Error handling
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
  AdjustmentsPipeline,
  getAdjustmentsPipeline,
  resetAdjustmentsPipeline,
  DEFAULT_BASIC_ADJUSTMENTS,
  type BasicAdjustments,
} from './adjustments-pipeline'

// ============================================================================
// Mock WebGPU API
// ============================================================================

interface MockGPUTexture {
  label?: string
  createView: () => MockGPUTextureView
  destroy: () => void
}

interface MockGPUTextureView {
  label?: string
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

interface MockGPUCommandEncoder {
  beginComputePass: (descriptor: { label?: string }) => MockGPUComputePassEncoder
  copyTextureToBuffer: (
    source: { texture: MockGPUTexture },
    dest: { buffer: MockGPUBuffer; bytesPerRow: number; rowsPerImage: number },
    size: { width: number; height: number; depthOrArrayLayers: number }
  ) => void
  finish: () => MockGPUCommandBuffer
}

interface MockGPUCommandBuffer {
  label?: string
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
  createBindGroupLayout: (descriptor: { label?: string; entries: unknown[] }) => MockGPUBindGroupLayout
  createPipelineLayout: (descriptor: { label?: string; bindGroupLayouts: unknown[] }) => MockGPUPipelineLayout
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
  createBindGroup: (descriptor: { label?: string; layout: MockGPUBindGroupLayout; entries: unknown[] }) => MockGPUBindGroup
  createCommandEncoder: (descriptor: { label?: string }) => MockGPUCommandEncoder
  queue: MockGPUQueue
}

let mockDevice: MockGPUDevice
let mockStagingBufferData: Uint8Array
let createdTextures: MockGPUTexture[]
let createdBuffers: MockGPUBuffer[]

function createMockDevice(): MockGPUDevice {
  createdTextures = []
  createdBuffers = []
  mockStagingBufferData = new Uint8Array([128, 64, 192, 255]) // Default single pixel result

  const mockTextureView: MockGPUTextureView = {}

  const createMockTexture = (): MockGPUTexture => {
    const texture: MockGPUTexture = {
      createView: vi.fn(() => mockTextureView),
      destroy: vi.fn(),
    }
    createdTextures.push(texture)
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
    writeTexture: vi.fn(),
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
// Test Fixtures
// ============================================================================

function createTestPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 128 // R
    pixels[i * 4 + 1] = 64 // G
    pixels[i * 4 + 2] = 192 // B
    pixels[i * 4 + 3] = 255 // A
  }
  return pixels
}

function createTestAdjustments(overrides?: Partial<BasicAdjustments>): BasicAdjustments {
  return {
    ...DEFAULT_BASIC_ADJUSTMENTS,
    ...overrides,
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
  resetAdjustmentsPipeline()

  // Setup mock to return our device
  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  vi.clearAllMocks()
  resetAdjustmentsPipeline()
})

// ============================================================================
// DEFAULT_BASIC_ADJUSTMENTS Tests
// ============================================================================

describe('DEFAULT_BASIC_ADJUSTMENTS', () => {
  it('has all adjustment values set to zero', () => {
    expect(DEFAULT_BASIC_ADJUSTMENTS.temperature).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.tint).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.exposure).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.contrast).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.highlights).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.shadows).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.whites).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.blacks).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.vibrance).toBe(0)
    expect(DEFAULT_BASIC_ADJUSTMENTS.saturation).toBe(0)
  })
})

// ============================================================================
// AdjustmentsPipeline Tests
// ============================================================================

describe('AdjustmentsPipeline', () => {
  describe('constructor', () => {
    it('creates pipeline with device reference', () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('creates shader module', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Adjustments Shader',
        code: expect.any(String),
      })
    })

    it('creates bind group layout with correct entries', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: 'Adjustments Bind Group Layout',
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Output texture
          expect.objectContaining({ binding: 2 }), // Adjustments buffer
          expect.objectContaining({ binding: 3 }), // Dimensions buffer
        ]),
      })
    })

    it('creates compute pipeline', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createComputePipeline).toHaveBeenCalledWith({
        label: 'Adjustments Compute Pipeline',
        layout: expect.anything(),
        compute: {
          module: expect.anything(),
          entryPoint: 'main',
        },
      })
    })

    it('creates uniform buffers', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Adjustments buffer (48 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Adjustments Uniform Buffer',
        size: 48,
        usage: expect.any(Number),
      })

      // Dimensions buffer (16 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Dimensions Uniform Buffer',
        size: 16,
        usage: expect.any(Number),
      })
    })

    it('only initializes once on multiple calls', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('apply', () => {
    it('throws error when not initialized', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      const pixels = createTestPixels(2, 2)
      const adjustments = createTestAdjustments()

      await expect(pipeline.apply(pixels, 2, 2, adjustments)).rejects.toThrow(
        'Pipeline not initialized'
      )
    })

    it('creates input and output textures', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Set up staging buffer data for 2x2 image
      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const adjustments = createTestAdjustments()

      await pipeline.apply(pixels, 2, 2, adjustments)

      // Check input texture creation
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Adjustments Input Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
        })
      )

      // Check output texture creation
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Adjustments Output Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
        })
      )
    })

    it('uploads input pixels to texture', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const adjustments = createTestAdjustments()

      await pipeline.apply(pixels, 2, 2, adjustments)

      expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
        expect.objectContaining({ texture: expect.anything() }),
        expect.any(ArrayBuffer),
        expect.objectContaining({ bytesPerRow: 2 * 4, rowsPerImage: 2 }),
        { width: 2, height: 2, depthOrArrayLayers: 1 }
      )
    })

    it('writes adjustments to uniform buffer', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const adjustments = createTestAdjustments({
        exposure: 1.5,
        contrast: 25,
      })

      await pipeline.apply(pixels, 2, 2, adjustments)

      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
        expect.anything(), // adjustments buffer
        0,
        expect.any(ArrayBuffer)
      )
    })

    it('dispatches compute workgroups', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(32 * 32 * 4)

      const pixels = createTestPixels(32, 32)
      const adjustments = createTestAdjustments()

      await pipeline.apply(pixels, 32, 32, adjustments)

      const encoder = mockDevice.createCommandEncoder({})
      const pass = encoder.beginComputePass({ label: '' })

      // 32 / 16 = 2 workgroups per dimension
      expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(2, 2, 1)
    })

    it('reads back result from staging buffer', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Set expected output
      mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

      const pixels = createTestPixels(1, 1)
      const adjustments = createTestAdjustments()

      const result = await pipeline.apply(pixels, 1, 1, adjustments)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(4)
    })

    it('cleans up temporary resources', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Track buffers created before apply
      const buffersBeforeApply = createdBuffers.length
      const texturesBeforeApply = createdTextures.length

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const adjustments = createTestAdjustments()

      await pipeline.apply(pixels, 2, 2, adjustments)

      // Input and output textures should be destroyed (created during apply)
      const texturesCreatedDuringApply = createdTextures.slice(texturesBeforeApply)
      expect(texturesCreatedDuringApply.length).toBeGreaterThanOrEqual(2)
      texturesCreatedDuringApply.forEach((texture) => {
        expect(texture.destroy).toHaveBeenCalled()
      })

      // Staging buffer (created during apply) should be destroyed
      const buffersCreatedDuringApply = createdBuffers.slice(buffersBeforeApply)
      expect(buffersCreatedDuringApply.length).toBeGreaterThanOrEqual(1)
      buffersCreatedDuringApply.forEach((buffer) => {
        expect(buffer.destroy).toHaveBeenCalled()
      })
    })
  })

  describe('applyToTextures', () => {
    it('throws error when not initialized', () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)

      const mockInput = { createView: vi.fn() } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn() } as unknown as GPUTexture
      const adjustments = createTestAdjustments()

      expect(() =>
        pipeline.applyToTextures(mockInput, mockOutput, 2, 2, adjustments)
      ).toThrow('Pipeline not initialized')
    })

    it('uses provided encoder', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const adjustments = createTestAdjustments()

      const providedEncoder = mockDevice.createCommandEncoder({ label: 'Provided' })
      const returnedEncoder = pipeline.applyToTextures(
        mockInput,
        mockOutput,
        2,
        2,
        adjustments,
        providedEncoder as unknown as GPUCommandEncoder
      )

      expect(returnedEncoder).toBe(providedEncoder)
    })

    it('creates encoder if not provided', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const adjustments = createTestAdjustments()

      const callCountBefore = vi.mocked(mockDevice.createCommandEncoder).mock.calls.length

      pipeline.applyToTextures(mockInput, mockOutput, 2, 2, adjustments)

      expect(mockDevice.createCommandEncoder).toHaveBeenCalledTimes(callCountBefore + 1)
    })
  })

  describe('destroy', () => {
    it('destroys uniform buffers', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      pipeline.destroy()

      // The first two buffers created are the uniform buffers
      expect(createdBuffers[0].destroy).toHaveBeenCalled()
      expect(createdBuffers[1].destroy).toHaveBeenCalled()
    })

    it('allows re-initialization after destroy', async () => {
      const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      pipeline.destroy()

      // Should not throw
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('getAdjustmentsPipeline', () => {
  it('returns null when GPU service is not ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getAdjustmentsPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns null when device is not available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getAdjustmentsPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns pipeline when GPU is available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getAdjustmentsPipeline()

    expect(pipeline).toBeInstanceOf(AdjustmentsPipeline)
  })

  it('returns same instance on subsequent calls', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getAdjustmentsPipeline()
    const pipeline2 = await getAdjustmentsPipeline()

    expect(pipeline1).toBe(pipeline2)
  })

  it('initializes the pipeline automatically', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getAdjustmentsPipeline()

    expect(mockDevice.createShaderModule).toHaveBeenCalled()
    expect(mockDevice.createComputePipeline).toHaveBeenCalled()
  })
})

describe('resetAdjustmentsPipeline', () => {
  it('creates new instance after reset', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getAdjustmentsPipeline()
    resetAdjustmentsPipeline()
    const pipeline2 = await getAdjustmentsPipeline()

    expect(pipeline1).not.toBe(pipeline2)
  })

  it('destroys previous instance', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getAdjustmentsPipeline()

    const buffersBefore = createdBuffers.length
    resetAdjustmentsPipeline()

    // Check that destroy was called on the buffers
    for (let i = 0; i < buffersBefore; i++) {
      expect(createdBuffers[i].destroy).toHaveBeenCalled()
    }
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles 1x1 image', async () => {
    const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments()

    const result = await pipeline.apply(pixels, 1, 1, adjustments)

    expect(result.length).toBe(4)
  })

  it('handles non-power-of-2 dimensions', async () => {
    const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 100
    const height = 75
    mockStagingBufferData = new Uint8Array(width * height * 4)

    const pixels = createTestPixels(width, height)
    const adjustments = createTestAdjustments()

    await pipeline.apply(pixels, width, height, adjustments)

    // Check dispatch is correct (ceil(100/16) = 7, ceil(75/16) = 5)
    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(7, 5, 1)
  })

  it('handles extreme adjustment values', async () => {
    const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({
      exposure: 5, // Max exposure
      contrast: 100, // Max contrast
      saturation: -100, // Min saturation
    })

    // Should not throw
    await pipeline.apply(pixels, 1, 1, adjustments)

    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
  })

  it('passes all 10 adjustment parameters correctly', async () => {
    const pipeline = new AdjustmentsPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const adjustments: BasicAdjustments = {
      temperature: 10,
      tint: 20,
      exposure: 1.5,
      contrast: 30,
      highlights: 40,
      shadows: 50,
      whites: 60,
      blacks: 70,
      vibrance: 80,
      saturation: 90,
    }

    await pipeline.apply(pixels, 1, 1, adjustments)

    // Verify buffer was written with correct data
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.any(ArrayBuffer)
    )

    // Get the actual buffer data that was written
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    // Find the adjustments buffer write (first one after initialization)
    const adjustmentsBufferWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      if (buffer.byteLength === 48) {
        const view = new Float32Array(buffer)
        return view[0] === 10 // Check temperature
      }
      return false
    })

    expect(adjustmentsBufferWrite).toBeDefined()
  })
})
