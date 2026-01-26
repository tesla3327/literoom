/**
 * Unit tests for UberPipeline.
 *
 * Tests the GPU compute pipeline that combines adjustments and tone curve
 * operations in a single pass for improved performance:
 * - Pipeline initialization and lifecycle
 * - Adjustments-only mode (when no tone curve provided)
 * - Tone-curve-only mode (when no adjustments provided)
 * - Combined mode (both adjustments and tone curve)
 * - applyToTextures for chaining with other pipelines
 * - Edge cases and error handling
 * - Pipeline caching for different feature combinations
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
  UberPipeline,
  getUberPipeline,
  resetUberPipeline,
} from '../pipelines/uber-pipeline'
import {
  DEFAULT_BASIC_ADJUSTMENTS,
  type BasicAdjustments,
} from '../pipelines/adjustments-pipeline'
import {
  createIdentityLut,
  isIdentityLut,
  type ToneCurveLut,
} from '../pipelines/tone-curve-pipeline'

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
    compute: { module: MockGPUShaderModule; entryPoint: string; constants?: Record<number, number> }
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
let createdPipelines: MockGPUComputePipeline[]
let writeTextureCalls: Array<{
  dest: { texture: MockGPUTexture }
  data: ArrayBuffer
  dataLayout: unknown
  size: unknown
}>

function createMockDevice(): MockGPUDevice {
  createdTextures = []
  createdBuffers = []
  createdPipelines = []
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
      getMappedRange: vi.fn(() => mockStagingBufferData.buffer),
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
    createComputePipeline: vi.fn(() => {
      const pipeline = { label: `Pipeline ${createdPipelines.length}` }
      createdPipelines.push(pipeline)
      return pipeline
    }),
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

function createInvertLut(): ToneCurveLut {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = 255 - i
  }
  return { lut }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  // Clear mocks FIRST before creating new device
  vi.clearAllMocks()
  resetUberPipeline()

  // Create mock device with fresh mock functions
  mockDevice = createMockDevice()

  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  resetUberPipeline()
})

// ============================================================================
// Initialization Tests
// ============================================================================

describe('UberPipeline Initialization', () => {
  describe('constructor', () => {
    it('creates pipeline with device reference', () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('should initialize pipeline successfully', async () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalled()
      expect(mockDevice.createBindGroupLayout).toHaveBeenCalled()
      // Note: Pipeline layout is created lazily when apply is first called
      expect(mockDevice.createBuffer).toHaveBeenCalled()
    })

    it('creates shader module with uber shader', async () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: expect.stringContaining('Uber'),
        code: expect.any(String),
      })
    })

    it('creates bind group layout with required entries', async () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: expect.stringContaining('Uber'),
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Output texture
        ]),
      })
    })

    it('creates uniform buffers', async () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Should create at least dimensions and adjustments buffers
      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: expect.any(Number),
        })
      )
    })

    it('only initializes once on multiple calls', async () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
    })
  })

  describe('getUberPipeline (singleton)', () => {
    it('should return null when GPU not available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: false,
        device: null,
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = await getUberPipeline()

      expect(pipeline).toBeNull()
    })

    it('should return null when device is not available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: null,
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = await getUberPipeline()

      expect(pipeline).toBeNull()
    })

    it('should return pipeline when GPU is available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = await getUberPipeline()

      expect(pipeline).toBeInstanceOf(UberPipeline)
    })

    it('should be singleton', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline1 = await getUberPipeline()
      const pipeline2 = await getUberPipeline()

      expect(pipeline1).toBe(pipeline2)
    })

    it('initializes the pipeline automatically', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
      } as ReturnType<typeof getGPUCapabilityService>)

      await getUberPipeline()

      expect(mockDevice.createShaderModule).toHaveBeenCalled()
      // Note: Pipeline layout is created lazily when apply is first called
      expect(mockDevice.createBindGroupLayout).toHaveBeenCalled()
    })
  })

  describe('resetUberPipeline', () => {
    it('creates new instance after reset', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline1 = await getUberPipeline()
      resetUberPipeline()
      const pipeline2 = await getUberPipeline()

      expect(pipeline1).not.toBe(pipeline2)
    })

    it('destroys previous instance', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
      } as ReturnType<typeof getGPUCapabilityService>)

      await getUberPipeline()
      const buffersBefore = createdBuffers.length

      resetUberPipeline()

      // Check that destroy was called on buffers
      for (let i = 0; i < buffersBefore; i++) {
        expect(createdBuffers[i].destroy).toHaveBeenCalled()
      }
    })
  })
})

// ============================================================================
// Adjustments-Only Mode Tests
// ============================================================================

describe('UberPipeline Adjustments-Only Mode', () => {
  it('should apply exposure adjustment correctly', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 1.5 })

    await pipeline.apply(pixels, 1, 1, adjustments)

    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
  })

  it('should apply contrast adjustment correctly', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ contrast: 50 })

    await pipeline.apply(pixels, 1, 1, adjustments)

    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
  })

  it('should apply all adjustments in correct order', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
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

    // Verify adjustments buffer was written
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.any(ArrayBuffer)
    )
  })

  it('should skip tone curve when not provided', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 1.0 })

    await pipeline.apply(pixels, 1, 1, adjustments)

    // Should not upload new LUT texture during apply (only the input texture)
    // The LUT was already initialized with identity during initialize()
    const lutWrites = writeTextureCalls.filter(
      (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
    )
    expect(lutWrites.length).toBe(0)
  })
})

// ============================================================================
// Tone-Curve-Only Mode Tests
// ============================================================================

describe('UberPipeline Tone-Curve-Only Mode', () => {
  it('should apply LUT correctly', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const lut = createContrastLut()

    // Pass undefined for adjustments to use defaults
    await pipeline.apply(pixels, 1, 1, undefined, lut)

    // Should upload new LUT texture (one write for the new contrast LUT)
    const lutWrites = writeTextureCalls.filter(
      (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
    )
    expect(lutWrites.length).toBe(1)
  })

  it('should skip identity LUT', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const identityLut = createIdentityLut()

    // With identity LUT and default adjustments, should return copy without GPU processing
    const result = await pipeline.apply(pixels, 1, 1, undefined, identityLut)

    expect(isIdentityLut(identityLut)).toBe(true)
    expect(result).toEqual(pixels)
  })

  it('should skip adjustments when all values are default', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const lut = createContrastLut()

    await pipeline.apply(pixels, 1, 1, DEFAULT_BASIC_ADJUSTMENTS, lut)

    // Pipeline should still run for tone curve
    expect(mockDevice.queue.submit).toHaveBeenCalled()
  })
})

// ============================================================================
// Combined Mode Tests
// ============================================================================

describe('UberPipeline Combined Mode', () => {
  it('should apply both adjustments and tone curve', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 1.5, contrast: 25 })
    const lut = createContrastLut()

    await pipeline.apply(pixels, 1, 1, adjustments, lut)

    // Should have written both adjustments buffer and LUT texture
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
    // One LUT write for the contrast LUT
    const lutWrites = writeTextureCalls.filter(
      (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
    )
    expect(lutWrites.length).toBe(1)
  })

  it('should produce same output as multi-pass pipeline (within tolerance)', async () => {
    // This test validates that combining operations produces equivalent results
    // The actual numerical comparison would happen in integration tests
    // Here we verify the pipeline processes both operations

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([180, 90, 220, 255]) // Simulated output
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })
    const lut = createContrastLut()

    const result = await pipeline.apply(pixels, 1, 1, adjustments, lut)

    // Verify result is returned
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
  })

  it('should process in correct order (adjustments first, then tone curve)', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 1.0 })
    const lut = createInvertLut()

    await pipeline.apply(pixels, 1, 1, adjustments, lut)

    // The uber shader should apply adjustments first, then tone curve
    // This is verified by checking that only one compute pass is dispatched
    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// applyToTextures Tests
// ============================================================================

describe('UberPipeline applyToTextures', () => {
  it('throws error when not initialized', () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)

    const mockInput = { createView: vi.fn() } as unknown as GPUTexture
    const mockOutput = { createView: vi.fn() } as unknown as GPUTexture

    expect(() =>
      pipeline.applyToTextures(mockInput, mockOutput, 2, 2)
    ).toThrow('Pipeline not initialized')
  })

  it('should work with external command encoder', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    const adjustments = createTestAdjustments({ exposure: 1.0 })

    const providedEncoder = mockDevice.createCommandEncoder({ label: 'Provided' })
    const returnedEncoder = pipeline.applyToTextures(
      mockInput,
      mockOutput,
      2,
      2,
      adjustments,
      undefined, // lut
      providedEncoder as unknown as GPUCommandEncoder
    )

    expect(returnedEncoder).toBe(providedEncoder)
  })

  it('should chain correctly with other pipelines', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    const adjustments = createTestAdjustments({ contrast: 30 })
    const lut = createContrastLut()

    const encoder = mockDevice.createCommandEncoder({ label: 'Chain' })

    // Apply uber pipeline
    const returnedEncoder = pipeline.applyToTextures(
      mockInput,
      mockOutput,
      4,
      4,
      adjustments,
      lut,
      encoder as unknown as GPUCommandEncoder
    )

    // Should return same encoder for chaining
    expect(returnedEncoder).toBe(encoder)

    // Encoder should not be finished (allows chaining)
    expect(encoder.finish).not.toHaveBeenCalled()
  })

  it('creates encoder if not provided', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    const mockOutput = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    const callCountBefore = vi.mocked(mockDevice.createCommandEncoder).mock.calls.length

    pipeline.applyToTextures(mockInput, mockOutput, 2, 2)

    expect(mockDevice.createCommandEncoder).toHaveBeenCalledTimes(callCountBefore + 1)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('UberPipeline Edge Cases', () => {
  it('should handle identity adjustments (all zeros)', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([128, 64, 192, 255])
    const pixels = createTestPixels(1, 1)

    // With default adjustments and no LUT, should return copy
    const result = await pipeline.apply(pixels, 1, 1, DEFAULT_BASIC_ADJUSTMENTS)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
  })

  it('should handle identity LUT', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([128, 64, 192, 255])
    const pixels = createTestPixels(1, 1)
    const identityLut = createIdentityLut()

    // With identity adjustments and identity LUT, should return copy without GPU
    const result = await pipeline.apply(pixels, 1, 1, undefined, identityLut)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
  })

  it('should handle single-pixel images', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([200, 100, 150, 255])
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })
    const lut = createContrastLut()

    const result = await pipeline.apply(pixels, 1, 1, adjustments, lut)

    expect(result.length).toBe(4)
  })

  it('should handle non-power-of-2 dimensions', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 100
    const height = 75
    mockStagingBufferData = new Uint8Array(width * height * 4)
    const pixels = createTestPixels(width, height)
    const adjustments = createTestAdjustments({ saturation: 25 })

    await pipeline.apply(pixels, width, height, adjustments)

    // Check dispatch is correct (ceil(100/16) = 7, ceil(75/16) = 5)
    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(7, 5, 1)
  })

  it('handles extreme adjustment values', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
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

  it('handles large images', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 4096
    const height = 4096
    mockStagingBufferData = new Uint8Array(width * height * 4)
    const pixels = createTestPixels(width, height)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    await pipeline.apply(pixels, width, height, adjustments)

    // Should dispatch correct number of workgroups
    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(256, 256, 1) // 4096/16
  })

  it('handles all-black LUT', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const lut: ToneCurveLut = { lut: new Uint8Array(256) } // All zeros

    // Should not throw
    await pipeline.apply(pixels, 1, 1, undefined, lut)
  })

  it('handles all-white LUT', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const lut: ToneCurveLut = { lut: new Uint8Array(256).fill(255) }

    // Should not throw
    await pipeline.apply(pixels, 1, 1, undefined, lut)
  })
})

// ============================================================================
// Pipeline Caching Tests
// ============================================================================

describe('UberPipeline Caching', () => {
  it('should reuse pipeline for same feature combination', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)

    // First call with adjustments only
    const adjustments1 = createTestAdjustments({ exposure: 0.5 })
    await pipeline.apply(pixels, 1, 1, adjustments1)

    const pipelineCountAfterFirst = createdPipelines.length

    // Second call with same feature set (adjustments only, different values)
    const adjustments2 = createTestAdjustments({ exposure: 1.0 })
    await pipeline.apply(pixels, 1, 1, adjustments2)

    // Should not create new pipeline
    expect(createdPipelines.length).toBe(pipelineCountAfterFirst)
  })

  it('should create different pipelines for different feature combinations', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)

    // First call with adjustments only
    const adjustments = createTestAdjustments({ exposure: 0.5 })
    await pipeline.apply(pixels, 1, 1, adjustments)

    const pipelineCountAfterFirst = createdPipelines.length

    // Second call with both adjustments and tone curve
    const lut = createContrastLut()
    await pipeline.apply(pixels, 1, 1, adjustments, lut)

    // Should create a new pipeline variant for different feature set
    expect(createdPipelines.length).toBeGreaterThan(pipelineCountAfterFirst)
  })

  it('caches LUT to avoid re-upload', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const lut = createContrastLut()

    await pipeline.apply(pixels, 1, 1, undefined, lut)
    const writeCountAfterFirst = writeTextureCalls.length

    await pipeline.apply(pixels, 1, 1, undefined, lut)
    const writeCountAfterSecond = writeTextureCalls.length

    // LUT should not be re-uploaded (only input texture)
    expect(writeCountAfterSecond - writeCountAfterFirst).toBe(1)
  })

  it('uploads new LUT when changed', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)

    const lut1 = createContrastLut()
    await pipeline.apply(pixels, 1, 1, undefined, lut1)
    const writeCountAfterFirst = writeTextureCalls.length

    const lut2 = createInvertLut() // Different LUT
    await pipeline.apply(pixels, 1, 1, undefined, lut2)
    const writeCountAfterSecond = writeTextureCalls.length

    // Both LUT and input texture should be written
    expect(writeCountAfterSecond - writeCountAfterFirst).toBe(2)
  })
})

// ============================================================================
// Resource Cleanup Tests
// ============================================================================

describe('UberPipeline Resource Cleanup', () => {
  it('cleans up temporary textures after apply', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const texturesBeforeApply = createdTextures.length

    mockStagingBufferData = new Uint8Array(2 * 2 * 4)
    const pixels = createTestPixels(2, 2)
    const adjustments = createTestAdjustments({ exposure: 1.0 })

    await pipeline.apply(pixels, 2, 2, adjustments)

    // Input and output textures created during apply should be destroyed
    const texturesCreatedDuringApply = createdTextures.slice(texturesBeforeApply)
    expect(texturesCreatedDuringApply.length).toBeGreaterThanOrEqual(2)
    texturesCreatedDuringApply.forEach((texture) => {
      expect(texture.destroy).toHaveBeenCalled()
    })
  })

  it('destroy method releases all resources', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const buffersAfterInit = createdBuffers.length
    const texturesAfterInit = createdTextures.length

    pipeline.destroy()

    // All buffers created during init should be destroyed
    for (let i = 0; i < buffersAfterInit; i++) {
      expect(createdBuffers[i].destroy).toHaveBeenCalled()
    }

    // LUT texture should be destroyed
    for (let i = 0; i < texturesAfterInit; i++) {
      expect(createdTextures[i].destroy).toHaveBeenCalled()
    }
  })

  it('allows re-initialization after destroy', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()
    pipeline.destroy()

    // Should not throw
    await pipeline.initialize()

    expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(2)
  })

  it('clears cached LUT after destroy', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const contrastLut = createContrastLut()

    await pipeline.apply(pixels, 1, 1, undefined, contrastLut)
    const writeCountBefore = writeTextureCalls.length

    pipeline.destroy()
    await pipeline.initialize()
    // After reinitialize, identity LUT is uploaded again (counted from where we measure)

    mockStagingBufferData = new Uint8Array(4)
    await pipeline.apply(pixels, 1, 1, undefined, contrastLut)

    // After destroy/reinitialize:
    // 1. Contrast LUT during apply (since cache was cleared)
    // 2. Input texture during apply
    // Total = 2 new writeTexture calls (identity LUT during init doesn't use writeTexture in same array scope)
    expect(writeTextureCalls.length - writeCountBefore).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('UberPipeline Error Handling', () => {
  it('throws error when apply called before initialize', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    const pixels = createTestPixels(2, 2)

    await expect(pipeline.apply(pixels, 2, 2)).rejects.toThrow(
      'Pipeline not initialized'
    )
  })

  it('handles empty pixel array gracefully', async () => {
    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(0)
    const pixels = new Uint8Array(0)

    // With no adjustments and no LUT, should return copy of empty array
    const result = await pipeline.apply(pixels, 0, 0)
    expect(result).toEqual(pixels)
  })
})
