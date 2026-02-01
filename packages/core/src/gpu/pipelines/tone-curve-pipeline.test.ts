/**
 * Unit tests for ToneCurvePipeline.
 *
 * Tests the GPU compute pipeline for tone curve application including:
 * - Pipeline initialization and lifecycle
 * - LUT texture management and caching
 * - Identity LUT optimization
 * - Texture processing
 * - Resource cleanup
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
  ToneCurvePipeline,
  getToneCurvePipeline,
  resetToneCurvePipeline,
  createIdentityLut,
  isIdentityLut,
  type ToneCurveLut,
} from './tone-curve-pipeline'

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

interface MockGPUSampler {
  label?: string
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
    dataLayout: { bytesPerRow: number; rowsPerImage?: number; offset?: number },
    size: { width: number; height?: number; depthOrArrayLayers: number }
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
    size: { width: number; height?: number; depthOrArrayLayers: number }
    format: string
    usage: number
    dimension?: string
  }) => MockGPUTexture
  createBuffer: (descriptor: { label?: string; size: number; usage: number }) => MockGPUBuffer
  createSampler: (descriptor: {
    label?: string
    magFilter: string
    minFilter: string
    addressModeU: string
  }) => MockGPUSampler
  createBindGroup: (descriptor: { label?: string; layout: MockGPUBindGroupLayout; entries: unknown[] }) => MockGPUBindGroup
  createCommandEncoder: (descriptor: { label?: string }) => MockGPUCommandEncoder
  queue: MockGPUQueue
}

let mockDevice: MockGPUDevice
let mockStagingBufferData: Uint8Array
let createdTextures: MockGPUTexture[]
let createdBuffers: MockGPUBuffer[]
let writeTextureCalls: Array<{
  dest: { texture: MockGPUTexture }
  data: ArrayBuffer
  dataLayout: unknown
  size: unknown
}>

function createMockDevice(): MockGPUDevice {
  createdTextures = []
  createdBuffers = []
  writeTextureCalls = []
  mockStagingBufferData = new Uint8Array([128, 64, 192, 255])

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
    writeTexture: vi.fn((dest, data, dataLayout, size) => {
      writeTextureCalls.push({ dest, data, dataLayout, size })
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
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => mockCommandEncoder),
    queue: mockQueue,
  }
}

// Mock the capabilities module
vi.mock('../capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: true,
    device: null,
  })),
}))

import { getGPUCapabilityService } from '../capabilities'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 128
    pixels[i * 4 + 1] = 64
    pixels[i * 4 + 2] = 192
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

function createInvertLut(): ToneCurveLut {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = 255 - i
  }
  return { lut }
}

function createContrastLut(): ToneCurveLut {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    // S-curve for contrast
    const normalized = i / 255
    const contrast = Math.pow(normalized, 1.5)
    lut[i] = Math.round(contrast * 255)
  }
  return { lut }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
  resetToneCurvePipeline()

  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  vi.clearAllMocks()
  resetToneCurvePipeline()
})

// ============================================================================
// createIdentityLut Tests
// ============================================================================

describe('createIdentityLut', () => {
  it('creates a 256-entry LUT', () => {
    const lut = createIdentityLut()

    expect(lut.lut).toBeInstanceOf(Uint8Array)
    expect(lut.lut.length).toBe(256)
  })

  it('maps each value to itself', () => {
    const lut = createIdentityLut()

    for (let i = 0; i < 256; i++) {
      expect(lut.lut[i]).toBe(i)
    }
  })
})

// ============================================================================
// isIdentityLut Tests
// ============================================================================

describe('isIdentityLut', () => {
  it('returns true for identity LUT', () => {
    const lut = createIdentityLut()

    expect(isIdentityLut(lut)).toBe(true)
  })

  it('returns false for inverted LUT', () => {
    const lut = createInvertLut()

    expect(isIdentityLut(lut)).toBe(false)
  })

  it('returns false for contrast LUT', () => {
    const lut = createContrastLut()

    expect(isIdentityLut(lut)).toBe(false)
  })

  it('returns false when single value differs', () => {
    const lut = createIdentityLut()
    lut.lut[128] = 129 // Change middle value

    expect(isIdentityLut(lut)).toBe(false)
  })

  it('returns false when first value differs', () => {
    const lut = createIdentityLut()
    lut.lut[0] = 1

    expect(isIdentityLut(lut)).toBe(false)
  })

  it('returns false when last value differs', () => {
    const lut = createIdentityLut()
    lut.lut[255] = 254

    expect(isIdentityLut(lut)).toBe(false)
  })
})

// ============================================================================
// ToneCurvePipeline Tests
// ============================================================================

describe('ToneCurvePipeline', () => {
  describe('constructor', () => {
    it('creates pipeline with device reference', () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('creates shader module', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Tone Curve Shader',
        code: expect.any(String),
      })
    })

    it('creates bind group layout with 5 entries', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: 'Tone Curve Bind Group Layout',
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Output texture
          expect.objectContaining({ binding: 2 }), // LUT texture
          expect.objectContaining({ binding: 3 }), // LUT sampler
          expect.objectContaining({ binding: 4 }), // Dimensions buffer
        ]),
      })
    })

    it('creates 1D LUT texture', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createTexture).toHaveBeenCalledWith({
        label: 'Tone Curve LUT Texture',
        size: { width: 256, height: 1, depthOrArrayLayers: 1 },
        format: 'r8unorm',
        dimension: '1d',
        usage: expect.any(Number),
      })
    })

    it('creates sampler with linear filtering', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createSampler).toHaveBeenCalledWith({
        label: 'Tone Curve LUT Sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
      })
    })

    it('only initializes once on multiple calls', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('apply', () => {
    it('throws error when not initialized', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      const pixels = createTestPixels(2, 2)
      const lut = createContrastLut()

      await expect(pipeline.apply(pixels, 2, 2, lut)).rejects.toThrow(
        'Pipeline not initialized'
      )
    })

    it('returns copy of input for identity LUT (optimization)', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const pixels = createTestPixels(2, 2)
      const lut = createIdentityLut()

      const result = await pipeline.apply(pixels, 2, 2, lut)

      // Should return copy without GPU processing
      expect(result).toEqual(pixels)
      expect(result).not.toBe(pixels) // Must be a copy

      // GPU resources should not be created for identity LUT
      // (only initialization resources, no apply resources)
      const textureCreationCalls = vi.mocked(mockDevice.createTexture).mock.calls
      const applyTextures = textureCreationCalls.filter(
        (call) =>
          call[0].label?.includes('Input') || call[0].label?.includes('Output')
      )
      expect(applyTextures.length).toBe(0)
    })

    it('uploads LUT to texture', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const lut = createContrastLut()

      await pipeline.apply(pixels, 2, 2, lut)

      // Find LUT texture write
      const lutWrite = writeTextureCalls.find(
        (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
      )
      expect(lutWrite).toBeDefined()
    })

    it('caches LUT to avoid re-upload', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const lut = createContrastLut()

      await pipeline.apply(pixels, 2, 2, lut)
      const writeCountAfterFirst = writeTextureCalls.length

      await pipeline.apply(pixels, 2, 2, lut)
      const writeCountAfterSecond = writeTextureCalls.length

      // LUT should not be re-uploaded (only new input texture)
      // First apply: LUT + input texture = 2 writes
      // Second apply: only input texture = 1 write
      expect(writeCountAfterSecond - writeCountAfterFirst).toBe(1)
    })

    it('uploads new LUT when changed', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const lut1 = createContrastLut()
      const lut2 = createInvertLut()

      await pipeline.apply(pixels, 2, 2, lut1)
      const writeCountAfterFirst = writeTextureCalls.length

      await pipeline.apply(pixels, 2, 2, lut2)
      const writeCountAfterSecond = writeTextureCalls.length

      // Both LUT and input texture should be written
      expect(writeCountAfterSecond - writeCountAfterFirst).toBe(2)
    })

    it('creates input and output textures', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const lut = createContrastLut()

      await pipeline.apply(pixels, 2, 2, lut)

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Tone Curve Input Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
        })
      )

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Tone Curve Output Texture',
          size: { width: 2, height: 2, depthOrArrayLayers: 1 },
        })
      )
    })

    it('cleans up temporary resources', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(2 * 2 * 4)

      const pixels = createTestPixels(2, 2)
      const lut = createContrastLut()

      await pipeline.apply(pixels, 2, 2, lut)

      // Input, output textures should be destroyed (not LUT texture)
      const destroyedTextures = createdTextures.filter(
        (t) => vi.mocked(t.destroy).mock.calls.length > 0
      )
      expect(destroyedTextures.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('applyToTextures', () => {
    it('throws error when not initialized', () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)

      const mockInput = { createView: vi.fn() } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn() } as unknown as GPUTexture
      const lut = createContrastLut()

      expect(() =>
        pipeline.applyToTextures(mockInput, mockOutput, 2, 2, lut)
      ).toThrow('Pipeline not initialized')
    })

    it('updates LUT texture', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const lut = createContrastLut()

      pipeline.applyToTextures(mockInput, mockOutput, 2, 2, lut)

      expect(writeTextureCalls.length).toBeGreaterThan(0)
    })

    it('returns provided encoder', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
      const lut = createContrastLut()

      const providedEncoder = mockDevice.createCommandEncoder({ label: 'Provided' })
      const returnedEncoder = pipeline.applyToTextures(
        mockInput,
        mockOutput,
        2,
        2,
        lut,
        providedEncoder as unknown as GPUCommandEncoder
      )

      expect(returnedEncoder).toBe(providedEncoder)
    })
  })

  describe('destroy', () => {
    it('destroys LUT texture', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Find the LUT texture (created with dimension: '1d')
      const lutTexture = createdTextures.find(
        (_, index) =>
          vi.mocked(mockDevice.createTexture).mock.calls[index]?.[0]?.dimension ===
          '1d'
      )

      pipeline.destroy()

      expect(lutTexture?.destroy).toHaveBeenCalled()
    })

    it('destroys dimensions buffer', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      pipeline.destroy()

      expect(createdBuffers[0].destroy).toHaveBeenCalled()
    })

    it('clears cached LUT', async () => {
      const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(4)
      const pixels = createTestPixels(1, 1)
      const lut = createContrastLut()

      await pipeline.apply(pixels, 1, 1, lut)
      const writeCountBefore = writeTextureCalls.length

      pipeline.destroy()
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(4)
      await pipeline.apply(pixels, 1, 1, lut)

      // LUT should be re-uploaded after destroy/reinitialize
      expect(writeTextureCalls.length - writeCountBefore).toBe(2) // LUT + input
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('getToneCurvePipeline', () => {
  it('returns null when GPU service is not ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getToneCurvePipeline()

    expect(pipeline).toBeNull()
  })

  it('returns null when device is not available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getToneCurvePipeline()

    expect(pipeline).toBeNull()
  })

  it('returns pipeline when GPU is available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getToneCurvePipeline()

    expect(pipeline).toBeInstanceOf(ToneCurvePipeline)
  })

  it('returns same instance on subsequent calls', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getToneCurvePipeline()
    const pipeline2 = await getToneCurvePipeline()

    expect(pipeline1).toBe(pipeline2)
  })
})

describe('resetToneCurvePipeline', () => {
  it('creates new instance after reset', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getToneCurvePipeline()
    resetToneCurvePipeline()
    const pipeline2 = await getToneCurvePipeline()

    expect(pipeline1).not.toBe(pipeline2)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles 1x1 image', async () => {
    const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

    const pixels = createTestPixels(1, 1)
    const lut = createContrastLut()

    const result = await pipeline.apply(pixels, 1, 1, lut)

    expect(result.length).toBe(4)
  })

  it('handles large images', async () => {
    const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 4096
    const height = 4096
    mockStagingBufferData = new Uint8Array(width * height * 4)

    const pixels = createTestPixels(width, height)
    const lut = createContrastLut()

    await pipeline.apply(pixels, width, height, lut)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(256, 256, 1) // 4096/16
  })

  it('handles all-black LUT', async () => {
    const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const lut: ToneCurveLut = { lut: new Uint8Array(256) } // All zeros

    // Should not throw
    await pipeline.apply(pixels, 1, 1, lut)
  })

  it('handles all-white LUT', async () => {
    const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const lut: ToneCurveLut = { lut: new Uint8Array(256).fill(255) }

    // Should not throw
    await pipeline.apply(pixels, 1, 1, lut)
  })

  it('handles step function LUT', async () => {
    const pipeline = new ToneCurvePipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)

    const pixels = createTestPixels(1, 1)
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      lut[i] = i < 128 ? 0 : 255
    }

    // Should not throw
    await pipeline.apply(pixels, 1, 1, { lut })
  })
})
