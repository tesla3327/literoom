/**
 * Unit tests for MaskPipeline.
 *
 * Tests the GPU compute pipeline for gradient mask application including:
 * - Pipeline initialization and lifecycle
 * - Shader compilation and bind group creation
 * - Linear and radial mask processing
 * - Buffer packing
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
  MaskPipeline,
  getMaskPipeline,
  resetMaskPipeline,
  DEFAULT_GPU_MASK_ADJUSTMENTS,
  MAX_MASKS,
  type MaskStackInput,
  type LinearMaskData,
  type RadialMaskData,
} from './mask-pipeline'

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

function createTestMaskStack(): MaskStackInput {
  return {
    linearMasks: [
      {
        startX: 0.0,
        startY: 0.0,
        endX: 1.0,
        endY: 1.0,
        feather: 0.5,
        enabled: true,
        adjustments: {
          exposure: 1.0,
          contrast: 10,
        },
      },
    ],
    radialMasks: [
      {
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.3,
        radiusY: 0.2,
        rotation: 0.0,
        feather: 0.5,
        invert: false,
        enabled: true,
        adjustments: {
          saturation: 20,
          vibrance: 15,
        },
      },
    ],
  }
}

function createEmptyMaskStack(): MaskStackInput {
  return {
    linearMasks: [],
    radialMasks: [],
  }
}

function createDisabledMaskStack(): MaskStackInput {
  return {
    linearMasks: [
      {
        startX: 0.0,
        startY: 0.0,
        endX: 1.0,
        endY: 1.0,
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
        radiusY: 0.2,
        rotation: 0.0,
        feather: 0.5,
        invert: false,
        enabled: false,
        adjustments: { saturation: 20 },
      },
    ],
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
  resetMaskPipeline()

  // Setup mock to return our device
  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  vi.clearAllMocks()
  resetMaskPipeline()
})

// ============================================================================
// DEFAULT_GPU_MASK_ADJUSTMENTS Tests
// ============================================================================

describe('DEFAULT_GPU_MASK_ADJUSTMENTS', () => {
  it('has all adjustment values set to zero', () => {
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.exposure).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.contrast).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.temperature).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.tint).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.highlights).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.shadows).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.saturation).toBe(0)
    expect(DEFAULT_GPU_MASK_ADJUSTMENTS.vibrance).toBe(0)
  })
})

// ============================================================================
// MaskPipeline Tests
// ============================================================================

describe('MaskPipeline', () => {
  describe('constructor', () => {
    it('creates pipeline with device reference', () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('creates shader module with Mask Shader label', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Mask Shader',
        code: expect.any(String),
      })
    })

    it('creates bind group layout with 4 bindings', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: 'Mask Bind Group Layout',
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Output texture
          expect.objectContaining({ binding: 2 }), // Mask params buffer
          expect.objectContaining({ binding: 3 }), // Dimensions buffer
        ]),
      })
    })

    it('creates compute pipeline with main_masks entry point', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createComputePipeline).toHaveBeenCalledWith({
        label: 'Mask Compute Pipeline',
        layout: expect.anything(),
        compute: {
          module: expect.anything(),
          entryPoint: 'main_masks',
        },
      })
    })

    it('creates reusable uniform buffers with correct sizes', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Mask params buffer (1040 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Mask Params Uniform Buffer',
        size: 1040,
        usage: expect.any(Number),
      })

      // Dimensions buffer (16 bytes)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Mask Dimensions Uniform Buffer',
        size: 16,
        usage: expect.any(Number),
      })
    })

    it('only initializes once on multiple calls', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('apply', () => {
    it('throws error when not initialized', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      const pixels = createTestPixels(2, 2)
      const masks = createTestMaskStack()

      await expect(pipeline.apply(pixels, 2, 2, masks)).rejects.toThrow(
        'Pipeline not initialized'
      )
    })

    it('returns copy of input when no enabled masks (early exit)', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const pixels = createTestPixels(2, 2)
      const masks = createDisabledMaskStack()

      const result = await pipeline.apply(pixels, 2, 2, masks)

      // Should return copy without GPU processing
      expect(result).toEqual(pixels)
      expect(result).not.toBe(pixels) // Should be a copy
      expect(mockDevice.createTexture).toHaveBeenCalledTimes(0) // No textures created after init
    })

    it('returns copy of input when mask stack is empty', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const pixels = createTestPixels(2, 2)
      const masks = createEmptyMaskStack()

      const result = await pipeline.apply(pixels, 2, 2, masks)

      expect(result).toEqual(pixels)
      expect(result).not.toBe(pixels)
    })

    it('creates input and output textures', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const masks = createTestMaskStack()

      await pipeline.apply(pixels, 2, 2, masks)

      // Check input texture creation
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Mask Input Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
        })
      )

      // Check output texture creation
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Mask Output Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
        })
      )
    })

    it('uploads input pixels to texture', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const masks = createTestMaskStack()

      await pipeline.apply(pixels, 2, 2, masks)

      expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
        expect.objectContaining({ texture: expect.anything() }),
        expect.any(ArrayBuffer),
        expect.objectContaining({ bytesPerRow: 2 * 4, rowsPerImage: 2 }),
        { width: 2, height: 2, depthOrArrayLayers: 1 }
      )
    })

    it('writes mask params and dimensions to uniform buffers', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const masks = createTestMaskStack()

      await pipeline.apply(pixels, 2, 2, masks)

      // Mask params buffer write
      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
        expect.anything(),
        0,
        expect.any(ArrayBuffer)
      )

      // Dimensions buffer write
      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
        expect.anything(),
        0,
        expect.any(ArrayBuffer)
      )
    })

    it('dispatches compute workgroups correctly', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(32 * 32 * 4)

      const pixels = createTestPixels(32, 32)
      const masks = createTestMaskStack()

      await pipeline.apply(pixels, 32, 32, masks)

      const encoder = mockDevice.createCommandEncoder({})
      const pass = encoder.beginComputePass({ label: '' })

      // 32 / 16 = 2 workgroups per dimension
      expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(2, 2, 1)
    })

    it('reads back from staging buffer', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

      const pixels = createTestPixels(1, 1)
      const masks = createTestMaskStack()

      const result = await pipeline.apply(pixels, 1, 1, masks)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(4)
    })

    it('cleans up temporary resources', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Track resources created before apply (uniform buffers)
      const buffersBeforeApply = createdBuffers.length
      const texturesBeforeApply = createdTextures.length

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const masks = createTestMaskStack()

      await pipeline.apply(pixels, 2, 2, masks)

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
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)

      const mockInput = { createView: vi.fn() } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn() } as unknown as GPUTexture
      const masks = createTestMaskStack()

      expect(() => pipeline.applyToTextures(mockInput, mockOutput, 2, 2, masks)).toThrow(
        'Pipeline not initialized'
      )
    })

    it('uses provided encoder if given', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const masks = createTestMaskStack()

      const providedEncoder = mockDevice.createCommandEncoder({ label: 'Provided' })
      const returnedEncoder = pipeline.applyToTextures(
        mockInput,
        mockOutput,
        2,
        2,
        masks,
        providedEncoder as unknown as GPUCommandEncoder
      )

      expect(returnedEncoder).toBe(providedEncoder)
    })

    it('creates encoder if not provided', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const masks = createTestMaskStack()

      const callCountBefore = vi.mocked(mockDevice.createCommandEncoder).mock.calls.length

      pipeline.applyToTextures(mockInput, mockOutput, 2, 2, masks)

      expect(mockDevice.createCommandEncoder).toHaveBeenCalledTimes(callCountBefore + 1)
    })

    it('updates uniform buffers', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const masks = createTestMaskStack()

      pipeline.applyToTextures(mockInput, mockOutput, 2, 2, masks)

      // Should write to both uniform buffers
      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(2)
    })
  })

  describe('destroy', () => {
    it('destroys uniform buffers', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      pipeline.destroy()

      // The first two buffers created are the uniform buffers
      expect(createdBuffers[0].destroy).toHaveBeenCalled()
      expect(createdBuffers[1].destroy).toHaveBeenCalled()
    })

    it('allows re-initialization after destroy', async () => {
      const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
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

describe('getMaskPipeline', () => {
  it('returns null when GPU service is not ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getMaskPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns null when device is not available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getMaskPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns pipeline when GPU is available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getMaskPipeline()

    expect(pipeline).toBeInstanceOf(MaskPipeline)
  })

  it('returns same instance on subsequent calls', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getMaskPipeline()
    const pipeline2 = await getMaskPipeline()

    expect(pipeline1).toBe(pipeline2)
  })

  it('initializes the pipeline automatically', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getMaskPipeline()

    expect(mockDevice.createShaderModule).toHaveBeenCalled()
    expect(mockDevice.createComputePipeline).toHaveBeenCalled()
  })
})

describe('resetMaskPipeline', () => {
  it('creates new instance after reset', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getMaskPipeline()
    resetMaskPipeline()
    const pipeline2 = await getMaskPipeline()

    expect(pipeline1).not.toBe(pipeline2)
  })

  it('destroys previous instance', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getMaskPipeline()

    const buffersBefore = createdBuffers.length
    resetMaskPipeline()

    // Check that destroy was called on the uniform buffers
    for (let i = 0; i < buffersBefore; i++) {
      expect(createdBuffers[i].destroy).toHaveBeenCalled()
    }
  })
})

// ============================================================================
// Buffer Packing Tests
// ============================================================================

describe('buffer packing (through apply)', () => {
  it('packs linear mask geometry correctly', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [
        {
          startX: 0.1,
          startY: 0.2,
          endX: 0.8,
          endY: 0.9,
          feather: 0.6,
          enabled: true,
          adjustments: {},
        },
      ],
      radialMasks: [],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040 // Mask params buffer size
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const floatView = new Float32Array(paramsBuffer)
    const uintView = new Uint32Array(paramsBuffer)

    // Linear mask: startX, startY, endX, endY, feather, enabled
    expect(floatView[0]).toBeCloseTo(0.1) // startX
    expect(floatView[1]).toBeCloseTo(0.2) // startY
    expect(floatView[2]).toBeCloseTo(0.8) // endX
    expect(floatView[3]).toBeCloseTo(0.9) // endY
    expect(floatView[4]).toBeCloseTo(0.6) // feather
    expect(uintView[5]).toBe(1) // enabled
  })

  it('packs radial mask geometry correctly', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [],
      radialMasks: [
        {
          centerX: 0.5,
          centerY: 0.6,
          radiusX: 0.3,
          radiusY: 0.4,
          rotation: 1.57,
          feather: 0.7,
          invert: true,
          enabled: true,
          adjustments: {},
        },
      ],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const floatView = new Float32Array(paramsBuffer)
    const uintView = new Uint32Array(paramsBuffer)

    // Radial masks start at offset 512 bytes (8 linear masks * 64 bytes each)
    const radialOffset = 512 / 4 // In float indices

    // Radial mask: centerX, centerY, radiusX, radiusY, rotation, feather, invert, enabled
    expect(floatView[radialOffset + 0]).toBeCloseTo(0.5) // centerX
    expect(floatView[radialOffset + 1]).toBeCloseTo(0.6) // centerY
    expect(floatView[radialOffset + 2]).toBeCloseTo(0.3) // radiusX
    expect(floatView[radialOffset + 3]).toBeCloseTo(0.4) // radiusY
    expect(floatView[radialOffset + 4]).toBeCloseTo(1.57) // rotation
    expect(floatView[radialOffset + 5]).toBeCloseTo(0.7) // feather
    expect(uintView[radialOffset + 6]).toBe(1) // invert
    expect(uintView[radialOffset + 7]).toBe(1) // enabled
  })

  it('packs mask adjustments correctly', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [
        {
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 1,
          feather: 0.5,
          enabled: true,
          adjustments: {
            exposure: 1.5,
            contrast: 25,
            temperature: -10,
            tint: 5,
            highlights: 30,
            shadows: -20,
            saturation: 40,
            vibrance: 15,
          },
        },
      ],
      radialMasks: [],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const floatView = new Float32Array(paramsBuffer)

    // Adjustments start at offset 8 floats (after geometry + padding)
    expect(floatView[8]).toBeCloseTo(1.5) // exposure
    expect(floatView[9]).toBeCloseTo(25) // contrast
    expect(floatView[10]).toBeCloseTo(-10) // temperature
    expect(floatView[11]).toBeCloseTo(5) // tint
    expect(floatView[12]).toBeCloseTo(30) // highlights
    expect(floatView[13]).toBeCloseTo(-20) // shadows
    expect(floatView[14]).toBeCloseTo(40) // saturation
    expect(floatView[15]).toBeCloseTo(15) // vibrance
  })

  it('packs mask counts at end of params buffer', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [
        { startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: true, adjustments: {} },
        { startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: true, adjustments: {} },
        { startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: true, adjustments: {} },
      ],
      radialMasks: [
        {
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.3,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.5,
          invert: false,
          enabled: true,
          adjustments: {},
        },
        {
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.3,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.5,
          invert: false,
          enabled: true,
          adjustments: {},
        },
      ],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const uintView = new Uint32Array(paramsBuffer)

    // Counts are at end: offset = (512 + 512) / 4 = 256
    const countsOffset = 256
    expect(uintView[countsOffset]).toBe(3) // linear count
    expect(uintView[countsOffset + 1]).toBe(2) // radial count
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles 1x1 image', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

    const pixels = createTestPixels(1, 1)
    const masks = createTestMaskStack()

    const result = await pipeline.apply(pixels, 1, 1, masks)

    expect(result.length).toBe(4)
  })

  it('handles non-power-of-2 dimensions with correct workgroup dispatch', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 100
    const height = 75
    mockStagingBufferData = new Uint8Array(width * height * 4)

    const pixels = createTestPixels(width, height)
    const masks = createTestMaskStack()

    await pipeline.apply(pixels, width, height, masks)

    // Check dispatch is correct (ceil(100/16) = 7, ceil(75/16) = 5)
    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(7, 5, 1)
  })

  it('MAX_MASKS constant is 8', () => {
    expect(MAX_MASKS).toBe(8)
  })

  it('handles more than MAX_MASKS linear masks (uses only first MAX_MASKS)', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)

    // Create 10 linear masks (more than MAX_MASKS of 8)
    const linearMasks: LinearMaskData[] = []
    for (let i = 0; i < 10; i++) {
      linearMasks.push({
        startX: i * 0.1,
        startY: 0,
        endX: 1,
        endY: 1,
        feather: 0.5,
        enabled: true,
        adjustments: {},
      })
    }

    const masks: MaskStackInput = {
      linearMasks,
      radialMasks: [],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const uintView = new Uint32Array(paramsBuffer)

    // Counts are at end: offset = 256
    const countsOffset = 256
    expect(uintView[countsOffset]).toBe(8) // Should be capped at MAX_MASKS
  })

  it('handles more than MAX_MASKS radial masks (uses only first MAX_MASKS)', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)

    // Create 10 radial masks (more than MAX_MASKS of 8)
    const radialMasks: RadialMaskData[] = []
    for (let i = 0; i < 10; i++) {
      radialMasks.push({
        centerX: i * 0.1,
        centerY: 0.5,
        radiusX: 0.3,
        radiusY: 0.2,
        rotation: 0,
        feather: 0.5,
        invert: false,
        enabled: true,
        adjustments: {},
      })
    }

    const masks: MaskStackInput = {
      linearMasks: [],
      radialMasks,
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const uintView = new Uint32Array(paramsBuffer)

    // Counts are at end: offset = 256
    const countsOffset = 256
    expect(uintView[countsOffset + 1]).toBe(8) // Should be capped at MAX_MASKS
  })

  it('handles mixed enabled and disabled masks', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [
        { startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: true, adjustments: {} },
        { startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.5, enabled: false, adjustments: {} },
      ],
      radialMasks: [
        {
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.3,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.5,
          invert: false,
          enabled: true,
          adjustments: {},
        },
      ],
    }

    // Should process since there are enabled masks
    await pipeline.apply(pixels, 1, 1, masks)

    expect(mockDevice.createTexture).toHaveBeenCalled()
  })

  it('handles partial adjustments (defaults to 0 for missing values)', async () => {
    const pipeline = new MaskPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const masks: MaskStackInput = {
      linearMasks: [
        {
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 1,
          feather: 0.5,
          enabled: true,
          adjustments: {
            exposure: 2.0,
            // Other adjustments missing - should default to 0
          },
        },
      ],
      radialMasks: [],
    }

    await pipeline.apply(pixels, 1, 1, masks)

    // Find the mask params buffer write
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const maskParamsWrite = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 1040
    })

    expect(maskParamsWrite).toBeDefined()

    const paramsBuffer = maskParamsWrite![2] as ArrayBuffer
    const floatView = new Float32Array(paramsBuffer)

    // Check adjustments
    expect(floatView[8]).toBeCloseTo(2.0) // exposure
    expect(floatView[9]).toBeCloseTo(0) // contrast - default
    expect(floatView[10]).toBeCloseTo(0) // temperature - default
    expect(floatView[11]).toBeCloseTo(0) // tint - default
    expect(floatView[12]).toBeCloseTo(0) // highlights - default
    expect(floatView[13]).toBeCloseTo(0) // shadows - default
    expect(floatView[14]).toBeCloseTo(0) // saturation - default
    expect(floatView[15]).toBeCloseTo(0) // vibrance - default
  })
})
