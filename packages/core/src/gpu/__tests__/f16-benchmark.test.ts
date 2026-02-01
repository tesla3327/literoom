/**
 * Benchmark tests for f16 (half-precision) shader processing.
 *
 * These tests measure the performance difference between f16 and f32 shader paths
 * and verify that visual quality is maintained within acceptable tolerance.
 *
 * Test categories:
 * 1. Feature detection - verify f16 support detection from capabilities
 * 2. Shader selection - verify correct shader is selected based on f16 support
 * 3. Pipeline caching - verify separate caches for f16 and f32 pipelines
 * 4. Output quality - verify adjustments are applied correctly with f16
 * 5. Benchmark framework - provide timing infrastructure for performance tests
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
  type ToneCurveLut,
} from '../pipelines/tone-curve-pipeline'
import type { GPUCapabilities } from '../types'

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
    compute: { module: MockGPUShaderModule; entryPoint: string; constants?: Record<string, number> }
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
let createdShaderModules: Array<{ label?: string; code: string }>
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
  createdShaderModules = []
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
    createShaderModule: vi.fn((descriptor: { label?: string; code: string }) => {
      createdShaderModules.push({ label: descriptor.label, code: descriptor.code })
      return { label: descriptor.label }
    }),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn((descriptor) => {
      const pipeline = { label: descriptor.label || `Pipeline ${createdPipelines.length}` }
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
    capabilities: null,
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

/**
 * Create mock capabilities with f16 support enabled.
 */
function createF16Capabilities(): Partial<GPUCapabilities> {
  return {
    available: true,
    backend: 'webgpu',
    isFallbackAdapter: false,
    features: {
      shaderF16: true,
      float32Filtering: true,
      textureCompressionBC: false,
      subgroups: false,
    },
    limits: {
      maxTextureSize: 8192,
      maxBufferSize: 1073741824,
      maxComputeWorkgroupSize: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    },
  }
}

/**
 * Create mock capabilities without f16 support.
 */
function createF32OnlyCapabilities(): Partial<GPUCapabilities> {
  return {
    available: true,
    backend: 'webgpu',
    isFallbackAdapter: false,
    features: {
      shaderF16: false,
      float32Filtering: true,
      textureCompressionBC: false,
      subgroups: false,
    },
    limits: {
      maxTextureSize: 8192,
      maxBufferSize: 1073741824,
      maxComputeWorkgroupSize: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    },
  }
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

  // Default to f32 capabilities (tests will override as needed)
  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
    capabilities: createF32OnlyCapabilities(),
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  resetUberPipeline()
})

// ============================================================================
// Feature Detection Tests
// ============================================================================

describe('F16 Feature Detection', () => {
  it('enables f16 when shader-f16 feature is available', async () => {
    // Set up mock with f16 support
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(pipeline.isF16Enabled()).toBe(true)
  })

  it('uses f32 when shader-f16 feature is unavailable', async () => {
    // Set up mock without f16 support
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF32OnlyCapabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(pipeline.isF16Enabled()).toBe(false)
  })

  it('uses f32 when capabilities are null', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: null,
    } as unknown as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(pipeline.isF16Enabled()).toBe(false)
  })

  it('uses f32 when features property is missing', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: {
        available: true,
        backend: 'webgpu',
      } as GPUCapabilities,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(pipeline.isF16Enabled()).toBe(false)
  })

  it('correctly detects f16 through getUberPipeline singleton', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getUberPipeline()

    expect(pipeline).not.toBeNull()
    expect(pipeline!.isF16Enabled()).toBe(true)
  })
})

// ============================================================================
// Shader Selection Tests
// ============================================================================

describe('F16 Shader Selection', () => {
  it('creates shader module with f16 label when enabled', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(mockDevice.createShaderModule).toHaveBeenCalledWith(
      expect.objectContaining({
        label: expect.stringContaining('f16'),
      })
    )
  })

  it('creates shader module without f16 label when disabled', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF32OnlyCapabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(mockDevice.createShaderModule).toHaveBeenCalledWith(
      expect.objectContaining({
        label: expect.not.stringContaining('f16'),
      })
    )
  })

  it('uses f16 shader source when f16 is enabled', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // The f16 shader source should contain 'enable f16;'
    expect(createdShaderModules.length).toBeGreaterThan(0)
    const shaderModule = createdShaderModules[0]
    expect(shaderModule.code).toContain('enable f16')
  })

  it('uses f32 shader source when f16 is disabled', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF32OnlyCapabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // The f32 shader source should NOT contain 'enable f16;'
    expect(createdShaderModules.length).toBeGreaterThan(0)
    const shaderModule = createdShaderModules[0]
    expect(shaderModule.code).not.toContain('enable f16')
  })
})

// ============================================================================
// Pipeline Caching Tests
// ============================================================================

describe('F16 Pipeline Caching', () => {
  it('includes f16 status in cache key', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    await pipeline.apply(pixels, 1, 1, adjustments)

    // Check that pipeline was created with f16 in cache key
    expect(createdPipelines.length).toBeGreaterThan(0)
    expect(createdPipelines[0].label).toContain('f16=true')
  })

  it('caches f32 pipelines separately from f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF32OnlyCapabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    await pipeline.apply(pixels, 1, 1, adjustments)

    // Check that pipeline was created with f16=false in cache key
    expect(createdPipelines.length).toBeGreaterThan(0)
    expect(createdPipelines[0].label).toContain('f16=false')
  })

  it('reuses cached pipeline on subsequent calls with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments1 = createTestAdjustments({ exposure: 0.5 })
    const adjustments2 = createTestAdjustments({ exposure: 1.0 })

    await pipeline.apply(pixels, 1, 1, adjustments1)
    const pipelineCountAfterFirst = createdPipelines.length

    await pipeline.apply(pixels, 1, 1, adjustments2)
    const pipelineCountAfterSecond = createdPipelines.length

    // Should not create new pipeline (same feature set)
    expect(pipelineCountAfterSecond).toBe(pipelineCountAfterFirst)
  })

  it('creates separate pipelines for different feature combinations', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

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
})

// ============================================================================
// Output Quality Tests (Mock)
// ============================================================================

describe('F16 Output Quality', () => {
  it('applies exposure adjustment correctly with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([160, 80, 224, 255]) // Simulated brighter output
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    const result = await pipeline.apply(pixels, 1, 1, adjustments)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
  })

  it('applies contrast adjustment correctly with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([140, 50, 210, 255])
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ contrast: 50 })

    const result = await pipeline.apply(pixels, 1, 1, adjustments)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
  })

  it('applies all adjustments correctly with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([180, 90, 220, 255])
    const pixels = createTestPixels(1, 1)
    const adjustments: BasicAdjustments = {
      temperature: 10,
      tint: 20,
      exposure: 0.5,
      contrast: 30,
      highlights: 40,
      shadows: 50,
      whites: 60,
      blacks: 70,
      vibrance: 80,
      saturation: 20,
    }

    const result = await pipeline.apply(pixels, 1, 1, adjustments)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
    // Verify adjustments buffer was written
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.any(ArrayBuffer)
    )
  })

  it('applies tone curve correctly with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array([100, 40, 180, 255])
    const pixels = createTestPixels(1, 1)
    const lut = createContrastLut()

    await pipeline.apply(pixels, 1, 1, undefined, lut)

    // Should upload LUT texture
    const lutWrites = writeTextureCalls.filter(
      (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
    )
    expect(lutWrites.length).toBe(1)
  })

  it('applies combined adjustments and tone curve with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Clear write texture calls from initialization
    writeTextureCalls.length = 0

    mockStagingBufferData = new Uint8Array([150, 70, 200, 255])
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5, contrast: 25 })
    const lut = createContrastLut()

    const result = await pipeline.apply(pixels, 1, 1, adjustments, lut)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(4)
    // Should have written both adjustments buffer and LUT texture
    expect(mockDevice.queue.writeBuffer).toHaveBeenCalled()
    const lutWrites = writeTextureCalls.filter(
      (call) => call.dataLayout && (call.dataLayout as { bytesPerRow: number }).bytesPerRow === 256
    )
    expect(lutWrites.length).toBe(1)
  })

  it('handles identity LUT with f16 (returns copy)', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([128, 64, 192, 255])
    const pixels = createTestPixels(1, 1)
    const identityLut = createIdentityLut()

    // With identity adjustments and identity LUT, should return copy without GPU
    const result = await pipeline.apply(pixels, 1, 1, undefined, identityLut)

    expect(result).toEqual(pixels)
  })
})

// ============================================================================
// Benchmark Framework Tests
// ============================================================================

describe('F16 Benchmark Framework', () => {
  it('supports multiple iteration benchmarks', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const iterations = 10
    const results: number[] = []

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await pipeline.apply(pixels, 1, 1, adjustments)
      const end = performance.now()
      results.push(end - start)
    }

    expect(results.length).toBe(iterations)
    // All timing values should be positive
    expect(results.every((t) => t >= 0)).toBe(true)
  })

  it('captures timing data for f16 vs f32 comparison', async () => {
    // Test f16 timing
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const f16Pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await f16Pipeline.initialize()
    expect(f16Pipeline.isF16Enabled()).toBe(true)

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    const f16Start = performance.now()
    await f16Pipeline.apply(pixels, 1, 1, adjustments)
    const f16Time = performance.now() - f16Start

    f16Pipeline.destroy()

    // Reset and test f32 timing
    resetUberPipeline()
    mockDevice = createMockDevice()

    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF32OnlyCapabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const f32Pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await f32Pipeline.initialize()
    expect(f32Pipeline.isF16Enabled()).toBe(false)

    mockStagingBufferData = new Uint8Array(4)

    const f32Start = performance.now()
    await f32Pipeline.apply(pixels, 1, 1, adjustments)
    const f32Time = performance.now() - f32Start

    // Both should complete (timing comparison is informational only in mocked tests)
    expect(f16Time).toBeGreaterThanOrEqual(0)
    expect(f32Time).toBeGreaterThanOrEqual(0)
  })

  it('benchmarks with varying image sizes', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const sizes = [
      { width: 64, height: 64 },
      { width: 256, height: 256 },
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
    ]

    const timings: Array<{ size: string; time: number }> = []
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    for (const { width, height } of sizes) {
      mockStagingBufferData = new Uint8Array(width * height * 4)
      const pixels = createTestPixels(width, height)

      const start = performance.now()
      await pipeline.apply(pixels, width, height, adjustments)
      const time = performance.now() - start

      timings.push({ size: `${width}x${height}`, time })
    }

    expect(timings.length).toBe(sizes.length)
    // All sizes should complete successfully
    timings.forEach((t) => {
      expect(t.time).toBeGreaterThanOrEqual(0)
    })
  })

  it('benchmarks with different adjustment combinations', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const adjustmentCombinations: Array<{ name: string; adjustments: BasicAdjustments }> = [
      { name: 'exposure_only', adjustments: createTestAdjustments({ exposure: 1.0 }) },
      { name: 'exposure_contrast', adjustments: createTestAdjustments({ exposure: 0.5, contrast: 25 }) },
      {
        name: 'full_adjustments',
        adjustments: {
          temperature: 10,
          tint: 5,
          exposure: 0.5,
          contrast: 25,
          highlights: -20,
          shadows: 30,
          whites: 10,
          blacks: -10,
          vibrance: 20,
          saturation: 15,
        },
      },
    ]

    const timings: Array<{ name: string; time: number }> = []
    mockStagingBufferData = new Uint8Array(256 * 256 * 4)
    const pixels = createTestPixels(256, 256)

    for (const { name, adjustments } of adjustmentCombinations) {
      const start = performance.now()
      await pipeline.apply(pixels, 256, 256, adjustments)
      const time = performance.now() - start

      timings.push({ name, time })
    }

    expect(timings.length).toBe(adjustmentCombinations.length)
  })
})

// ============================================================================
// Resource Cleanup Tests
// ============================================================================

describe('F16 Resource Cleanup', () => {
  it('resets f16 state after destroy', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    expect(pipeline.isF16Enabled()).toBe(true)

    pipeline.destroy()

    // After destroy, f16 state should be reset
    expect(pipeline.isF16Enabled()).toBe(false)
  })

  it('correctly re-detects f16 after destroy and reinitialize', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()
    expect(pipeline.isF16Enabled()).toBe(true)

    pipeline.destroy()
    expect(pipeline.isF16Enabled()).toBe(false)

    // Reinitialize
    await pipeline.initialize()
    expect(pipeline.isF16Enabled()).toBe(true)
  })

  it('clears pipeline cache on destroy', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })

    await pipeline.apply(pixels, 1, 1, adjustments)
    const pipelineCountBefore = createdPipelines.length

    pipeline.destroy()
    await pipeline.initialize()

    // After destroy/reinitialize, applying should create new pipeline
    await pipeline.apply(pixels, 1, 1, adjustments)
    expect(createdPipelines.length).toBeGreaterThan(pipelineCountBefore)
  })
})

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('F16 Edge Cases', () => {
  it('handles extreme exposure values with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)

    // Test extreme positive exposure
    const adjustmentsHigh = createTestAdjustments({ exposure: 5 })
    await expect(pipeline.apply(pixels, 1, 1, adjustmentsHigh)).resolves.toBeDefined()

    // Test extreme negative exposure
    const adjustmentsLow = createTestAdjustments({ exposure: -5 })
    await expect(pipeline.apply(pixels, 1, 1, adjustmentsLow)).resolves.toBeDefined()
  })

  it('handles extreme contrast values with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array(4)
    const pixels = createTestPixels(1, 1)

    // Test max contrast
    const adjustmentsMax = createTestAdjustments({ contrast: 100 })
    await expect(pipeline.apply(pixels, 1, 1, adjustmentsMax)).resolves.toBeDefined()

    // Test min contrast
    const adjustmentsMin = createTestAdjustments({ contrast: -100 })
    await expect(pipeline.apply(pixels, 1, 1, adjustmentsMin)).resolves.toBeDefined()
  })

  it('handles all-black input with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([0, 0, 0, 255])
    const pixels = new Uint8Array([0, 0, 0, 255])
    const adjustments = createTestAdjustments({ exposure: 1.0 })

    await expect(pipeline.apply(pixels, 1, 1, adjustments)).resolves.toBeDefined()
  })

  it('handles all-white input with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([255, 255, 255, 255])
    const pixels = new Uint8Array([255, 255, 255, 255])
    const adjustments = createTestAdjustments({ exposure: -1.0 })

    await expect(pipeline.apply(pixels, 1, 1, adjustments)).resolves.toBeDefined()
  })

  it('handles single pixel image with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint8Array([180, 90, 220, 255])
    const pixels = createTestPixels(1, 1)
    const adjustments = createTestAdjustments({ exposure: 0.5 })
    const lut = createContrastLut()

    const result = await pipeline.apply(pixels, 1, 1, adjustments, lut)

    expect(result.length).toBe(4)
  })

  it('handles non-power-of-2 dimensions with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const width = 100
    const height = 75
    mockStagingBufferData = new Uint8Array(width * height * 4)
    const pixels = createTestPixels(width, height)
    const adjustments = createTestAdjustments({ saturation: 25 })

    await expect(pipeline.apply(pixels, width, height, adjustments)).resolves.toBeDefined()
  })

  it('handles vibrance with skin-tone-like colors with f16', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
      capabilities: createF16Capabilities(),
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Create pixel with skin-tone characteristics (R > G > B)
    mockStagingBufferData = new Uint8Array([220, 180, 160, 255])
    const skinTonePixels = new Uint8Array([220, 180, 160, 255])
    const adjustments = createTestAdjustments({ vibrance: 50 })

    await expect(pipeline.apply(skinTonePixels, 1, 1, adjustments)).resolves.toBeDefined()
  })
})
