/**
 * Unit tests for HistogramPipeline.
 *
 * Tests the GPU compute pipeline for histogram computation including:
 * - Pipeline initialization and lifecycle
 * - Shader compilation and bind group creation
 * - Histogram computation from textures and pixels
 * - Buffer management and workgroup dispatch
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
  HistogramPipeline,
  getHistogramPipeline,
  resetHistogramPipeline,
  type HistogramResult,
} from './histogram-pipeline'

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
  size?: number
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
  copyBufferToBuffer: (
    source: MockGPUBuffer,
    sourceOffset: number,
    dest: MockGPUBuffer,
    destOffset: number,
    size: number
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
let mockStagingBufferData: Uint32Array
let createdTextures: MockGPUTexture[]
let createdBuffers: MockGPUBuffer[]

function createMockDevice(): MockGPUDevice {
  createdTextures = []
  createdBuffers = []
  // Default histogram data: all zeros except for one bin
  mockStagingBufferData = new Uint32Array(256 * 4) // 4 channels × 256 bins

  const mockTextureView: MockGPUTextureView = {}

  const createMockTexture = (): MockGPUTexture => {
    const texture: MockGPUTexture = {
      createView: vi.fn(() => mockTextureView),
      destroy: vi.fn(),
    }
    createdTextures.push(texture)
    return texture
  }

  const createMockBuffer = (descriptor: { label?: string; size: number }): MockGPUBuffer => {
    const buffer: MockGPUBuffer = {
      label: descriptor.label,
      size: descriptor.size,
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
    copyBufferToBuffer: vi.fn(),
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

function createSolidColorPixels(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

function createMockHistogramResult(
  rBin: number,
  gBin: number,
  bBin: number,
  lBin: number,
  count: number
): Uint32Array {
  const data = new Uint32Array(256 * 4)
  // Layout: [red[0..255], green[0..255], blue[0..255], luminance[0..255]]
  data[rBin] = count // Red channel
  data[256 + gBin] = count // Green channel
  data[512 + bBin] = count // Blue channel
  data[768 + lBin] = count // Luminance channel
  return data
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
  resetHistogramPipeline()

  // Setup mock to return our device
  vi.mocked(getGPUCapabilityService).mockReturnValue({
    isReady: true,
    device: mockDevice as unknown as GPUDevice,
  } as ReturnType<typeof getGPUCapabilityService>)
})

afterEach(() => {
  vi.clearAllMocks()
  resetHistogramPipeline()
})

// ============================================================================
// HistogramResult Interface Tests
// ============================================================================

describe('HistogramResult interface', () => {
  it('has the correct structure with 256 bins per channel', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // Set up mock histogram data
    mockStagingBufferData = createMockHistogramResult(128, 64, 192, 100, 1)

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    const result = await pipeline.compute(mockInputTexture, 1, 1)

    expect(result.red).toBeInstanceOf(Uint32Array)
    expect(result.green).toBeInstanceOf(Uint32Array)
    expect(result.blue).toBeInstanceOf(Uint32Array)
    expect(result.luminance).toBeInstanceOf(Uint32Array)

    expect(result.red.length).toBe(256)
    expect(result.green.length).toBe(256)
    expect(result.blue.length).toBe(256)
    expect(result.luminance.length).toBe(256)
  })
})

// ============================================================================
// HistogramPipeline Tests
// ============================================================================

describe('HistogramPipeline', () => {
  describe('constructor', () => {
    it('creates pipeline with device reference', () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('creates shader module with Histogram Shader label', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Histogram Shader',
        code: expect.any(String),
      })
    })

    it('creates bind group layout with 3 bindings', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith({
        label: 'Histogram Bind Group Layout',
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }), // Input texture
          expect.objectContaining({ binding: 1 }), // Histogram storage buffer
          expect.objectContaining({ binding: 2 }), // Dimensions uniform buffer
        ]),
      })
    })

    it('creates compute pipeline with main entry point', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createComputePipeline).toHaveBeenCalledWith({
        label: 'Histogram Compute Pipeline',
        layout: expect.anything(),
        compute: {
          module: expect.anything(),
          entryPoint: 'main',
        },
      })
    })

    it('creates histogram storage buffer with correct size (4096 bytes)', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // 4 channels × 256 bins × 4 bytes = 4096 bytes
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Histogram Storage Buffer',
        size: 4096,
        usage: expect.any(Number),
      })
    })

    it('creates dimensions uniform buffer with correct size (8 bytes)', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // 2 × u32 = 8 bytes
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Histogram Dimensions Buffer',
        size: 8,
        usage: expect.any(Number),
      })
    })

    it('only initializes once on multiple calls', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('compute', () => {
    it('throws error when not initialized', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)

      const mockInputTexture = { createView: vi.fn() } as unknown as GPUTexture

      await expect(pipeline.compute(mockInputTexture, 2, 2)).rejects.toThrow(
        'Pipeline not initialized'
      )
    })

    it('clears histogram buffer before computation', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      // Should write zeros to histogram buffer
      expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
        expect.anything(),
        0,
        expect.any(ArrayBuffer)
      )

      // Verify the written data is all zeros (clearing the buffer)
      const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
      const histogramClearCall = writeBufferCalls.find((call) => {
        const buffer = call[2] as ArrayBuffer
        return buffer.byteLength === 256 * 4 * 4 // 4096 bytes
      })
      expect(histogramClearCall).toBeDefined()
    })

    it('updates dimensions uniform buffer', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 100, 50)

      // Should write dimensions to buffer
      const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
      const dimensionsCall = writeBufferCalls.find((call) => {
        const buffer = call[2] as ArrayBuffer
        return buffer.byteLength === 8 // 2 × u32
      })
      expect(dimensionsCall).toBeDefined()

      // Verify dimensions values
      const dimensionsBuffer = dimensionsCall![2] as ArrayBuffer
      const dimensionsView = new Uint32Array(dimensionsBuffer)
      expect(dimensionsView[0]).toBe(100) // width
      expect(dimensionsView[1]).toBe(50) // height
    })

    it('creates bind group with input texture', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockTextureView = {}
      const mockInputTexture = {
        createView: vi.fn(() => mockTextureView),
      } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      expect(mockDevice.createBindGroup).toHaveBeenCalledWith({
        label: 'Histogram Bind Group',
        layout: expect.anything(),
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 0 }),
          expect.objectContaining({ binding: 1 }),
          expect.objectContaining({ binding: 2 }),
        ]),
      })
    })

    it('dispatches correct number of workgroups', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 32, 32)

      const encoder = mockDevice.createCommandEncoder({})
      const pass = encoder.beginComputePass({ label: '' })

      // 32 / 16 = 2 workgroups per dimension
      expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(2, 2, 1)
    })

    it('creates staging buffer for readback', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      // Should create staging buffer with MAP_READ usage
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'Histogram Staging Buffer',
        size: 4096,
        usage: expect.any(Number),
      })
    })

    it('copies histogram buffer to staging buffer', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      const encoder = mockDevice.createCommandEncoder({})
      expect(encoder.copyBufferToBuffer).toHaveBeenCalledWith(
        expect.anything(), // source (histogram buffer)
        0,
        expect.anything(), // dest (staging buffer)
        0,
        4096
      )
    })

    it('reads back histogram data from staging buffer', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      // Verify mapAsync and getMappedRange were called on staging buffer
      const stagingBuffer = createdBuffers.find(
        (b) => b.label === 'Histogram Staging Buffer'
      )
      expect(stagingBuffer).toBeDefined()
      expect(stagingBuffer!.mapAsync).toHaveBeenCalledWith(mockGPUMapMode.READ)
      expect(stagingBuffer!.getMappedRange).toHaveBeenCalled()
      expect(stagingBuffer!.unmap).toHaveBeenCalled()
    })

    it('destroys staging buffer after readback', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      await pipeline.compute(mockInputTexture, 2, 2)

      const stagingBuffer = createdBuffers.find(
        (b) => b.label === 'Histogram Staging Buffer'
      )
      expect(stagingBuffer!.destroy).toHaveBeenCalled()
    })

    it('returns histogram result with correct channel separation', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Set up specific histogram data
      mockStagingBufferData = new Uint32Array(256 * 4)
      mockStagingBufferData[10] = 100 // Red bin 10
      mockStagingBufferData[256 + 20] = 200 // Green bin 20
      mockStagingBufferData[512 + 30] = 300 // Blue bin 30
      mockStagingBufferData[768 + 40] = 400 // Luminance bin 40

      const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

      const result = await pipeline.compute(mockInputTexture, 2, 2)

      expect(result.red[10]).toBe(100)
      expect(result.green[20]).toBe(200)
      expect(result.blue[30]).toBe(300)
      expect(result.luminance[40]).toBe(400)
    })
  })

  describe('computeFromPixels', () => {
    it('throws error when not initialized', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)

      const pixels = createTestPixels(2, 2)

      await expect(pipeline.computeFromPixels(pixels, 2, 2)).rejects.toThrow(
        'Pipeline not initialized'
      )
    })

    it('creates input texture from pixels', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const pixels = createTestPixels(10, 10)

      await pipeline.computeFromPixels(pixels, 10, 10)

      expect(mockDevice.createTexture).toHaveBeenCalledWith({
        label: 'Histogram Input Texture',
        size: { width: 10, height: 10, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: expect.any(Number),
      })
    })

    it('uploads pixels to texture', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const pixels = createTestPixels(2, 2)

      await pipeline.computeFromPixels(pixels, 2, 2)

      expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
        expect.objectContaining({ texture: expect.anything() }),
        expect.any(ArrayBuffer),
        expect.objectContaining({
          bytesPerRow: 2 * 4,
          rowsPerImage: 2,
        }),
        { width: 2, height: 2, depthOrArrayLayers: 1 }
      )
    })

    it('destroys temporary input texture after computation', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const texturesBeforeCompute = createdTextures.length

      const pixels = createTestPixels(2, 2)
      await pipeline.computeFromPixels(pixels, 2, 2)

      // Find the input texture created during computeFromPixels
      const inputTexture = createdTextures.slice(texturesBeforeCompute).find(
        (_, index) =>
          vi.mocked(mockDevice.createTexture).mock.calls[texturesBeforeCompute + index]?.[0]
            ?.label === 'Histogram Input Texture'
      )
      expect(inputTexture).toBeDefined()
      expect(inputTexture!.destroy).toHaveBeenCalled()
    })

    it('returns histogram result', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = createMockHistogramResult(128, 64, 192, 100, 4)

      const pixels = createTestPixels(2, 2)
      const result = await pipeline.computeFromPixels(pixels, 2, 2)

      expect(result).toHaveProperty('red')
      expect(result).toHaveProperty('green')
      expect(result).toHaveProperty('blue')
      expect(result).toHaveProperty('luminance')
    })
  })

  describe('destroy', () => {
    it('destroys histogram storage buffer', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const histogramBuffer = createdBuffers.find(
        (b) => b.label === 'Histogram Storage Buffer'
      )

      pipeline.destroy()

      expect(histogramBuffer!.destroy).toHaveBeenCalled()
    })

    it('destroys dimensions uniform buffer', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      const dimensionsBuffer = createdBuffers.find(
        (b) => b.label === 'Histogram Dimensions Buffer'
      )

      pipeline.destroy()

      expect(dimensionsBuffer!.destroy).toHaveBeenCalled()
    })

    it('allows re-initialization after destroy', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      pipeline.destroy()

      // Should not throw
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(2)
    })

    it('is safe to call destroy multiple times', async () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Should not throw
      pipeline.destroy()
      pipeline.destroy()
    })

    it('is safe to call destroy without initialize', () => {
      const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)

      // Should not throw
      pipeline.destroy()
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe('getHistogramPipeline', () => {
  it('returns null when GPU service is not ready', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: false,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getHistogramPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns null when device is not available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: null,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getHistogramPipeline()

    expect(pipeline).toBeNull()
  })

  it('returns pipeline when GPU is available', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline = await getHistogramPipeline()

    expect(pipeline).toBeInstanceOf(HistogramPipeline)
  })

  it('returns same instance on subsequent calls', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getHistogramPipeline()
    const pipeline2 = await getHistogramPipeline()

    expect(pipeline1).toBe(pipeline2)
  })

  it('initializes the pipeline automatically', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getHistogramPipeline()

    expect(mockDevice.createShaderModule).toHaveBeenCalled()
    expect(mockDevice.createComputePipeline).toHaveBeenCalled()
  })
})

describe('resetHistogramPipeline', () => {
  it('creates new instance after reset', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    const pipeline1 = await getHistogramPipeline()
    resetHistogramPipeline()
    const pipeline2 = await getHistogramPipeline()

    expect(pipeline1).not.toBe(pipeline2)
  })

  it('destroys previous instance', async () => {
    vi.mocked(getGPUCapabilityService).mockReturnValue({
      isReady: true,
      device: mockDevice as unknown as GPUDevice,
    } as ReturnType<typeof getGPUCapabilityService>)

    await getHistogramPipeline()

    const histogramBuffer = createdBuffers.find(
      (b) => b.label === 'Histogram Storage Buffer'
    )

    resetHistogramPipeline()

    expect(histogramBuffer!.destroy).toHaveBeenCalled()
  })

  it('is safe to call without existing instance', () => {
    // Should not throw
    resetHistogramPipeline()
  })
})

// ============================================================================
// Workgroup Dispatch Tests
// ============================================================================

describe('workgroup dispatch', () => {
  it('calculates correct workgroups for exact multiple of workgroup size', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // 64 / 16 = 4 workgroups exactly
    await pipeline.compute(mockInputTexture, 64, 64)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(4, 4, 1)
  })

  it('calculates correct workgroups for non-multiple of workgroup size', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // ceil(100 / 16) = 7, ceil(75 / 16) = 5
    await pipeline.compute(mockInputTexture, 100, 75)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(7, 5, 1)
  })

  it('handles very small images', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // ceil(1 / 16) = 1
    await pipeline.compute(mockInputTexture, 1, 1)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(1, 1, 1)
  })

  it('handles very large images', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // ceil(4096 / 16) = 256
    await pipeline.compute(mockInputTexture, 4096, 4096)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(256, 256, 1)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles 1x1 image', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = createMockHistogramResult(255, 0, 128, 100, 1)

    const pixels = createSolidColorPixels(1, 1, 255, 0, 128)
    const result = await pipeline.computeFromPixels(pixels, 1, 1)

    expect(result.red.length).toBe(256)
    expect(result.green.length).toBe(256)
    expect(result.blue.length).toBe(256)
    expect(result.luminance.length).toBe(256)
  })

  it('handles non-square images', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint32Array(256 * 4)

    const pixels = createTestPixels(200, 50)

    // Should not throw
    await pipeline.computeFromPixels(pixels, 200, 50)

    // Verify dimensions were set correctly
    const writeBufferCalls = vi.mocked(mockDevice.queue.writeBuffer).mock.calls
    const dimensionsCall = writeBufferCalls.find((call) => {
      const buffer = call[2] as ArrayBuffer
      return buffer.byteLength === 8
    })
    const dimensionsView = new Uint32Array(dimensionsCall![2] as ArrayBuffer)
    expect(dimensionsView[0]).toBe(200)
    expect(dimensionsView[1]).toBe(50)
  })

  it('handles all black image', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = createMockHistogramResult(0, 0, 0, 0, 4)

    const pixels = createSolidColorPixels(2, 2, 0, 0, 0)
    const result = await pipeline.computeFromPixels(pixels, 2, 2)

    // Should have all counts in bin 0
    expect(result.red[0]).toBe(4)
    expect(result.green[0]).toBe(4)
    expect(result.blue[0]).toBe(4)
    expect(result.luminance[0]).toBe(4)
  })

  it('handles all white image', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = createMockHistogramResult(255, 255, 255, 255, 4)

    const pixels = createSolidColorPixels(2, 2, 255, 255, 255)
    const result = await pipeline.computeFromPixels(pixels, 2, 2)

    // Should have all counts in bin 255
    expect(result.red[255]).toBe(4)
    expect(result.green[255]).toBe(4)
    expect(result.blue[255]).toBe(4)
    expect(result.luminance[255]).toBe(4)
  })

  it('handles pure red image', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    // For pure red (255, 0, 0), luminance = 0.2126 * 255 ≈ 54
    mockStagingBufferData = new Uint32Array(256 * 4)
    mockStagingBufferData[255] = 4 // Red bin 255
    mockStagingBufferData[256 + 0] = 4 // Green bin 0
    mockStagingBufferData[512 + 0] = 4 // Blue bin 0
    mockStagingBufferData[768 + 54] = 4 // Luminance bin ~54

    const pixels = createSolidColorPixels(2, 2, 255, 0, 0)
    const result = await pipeline.computeFromPixels(pixels, 2, 2)

    expect(result.red[255]).toBe(4)
    expect(result.green[0]).toBe(4)
    expect(result.blue[0]).toBe(4)
  })

  it('handles large pixel data', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint32Array(256 * 4)

    // 1000x1000 = 1 million pixels
    const pixels = createTestPixels(1000, 1000)

    // Should not throw
    await pipeline.computeFromPixels(pixels, 1000, 1000)
  })

  it('handles prime number dimensions', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint32Array(256 * 4)

    const pixels = createTestPixels(97, 101) // Both prime numbers

    await pipeline.computeFromPixels(pixels, 97, 101)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    // ceil(97/16) = 7, ceil(101/16) = 7
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(7, 7, 1)
  })

  it('handles exactly workgroup-sized dimensions', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    mockStagingBufferData = new Uint32Array(256 * 4)

    const pixels = createTestPixels(16, 16) // Exactly one workgroup

    await pipeline.computeFromPixels(pixels, 16, 16)

    const encoder = mockDevice.createCommandEncoder({})
    const pass = encoder.beginComputePass({ label: '' })

    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(1, 1, 1)
  })
})

// ============================================================================
// Buffer Sizes and Layouts
// ============================================================================

describe('buffer sizes and layouts', () => {
  it('histogram buffer has correct size for 4 channels × 256 bins', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const histogramBuffer = createdBuffers.find(
      (b) => b.label === 'Histogram Storage Buffer'
    )
    expect(histogramBuffer).toBeDefined()
    expect(histogramBuffer!.size).toBe(4096) // 4 × 256 × 4 bytes
  })

  it('dimensions buffer has correct size for width and height', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const dimensionsBuffer = createdBuffers.find(
      (b) => b.label === 'Histogram Dimensions Buffer'
    )
    expect(dimensionsBuffer).toBeDefined()
    expect(dimensionsBuffer!.size).toBe(8) // 2 × u32
  })

  it('staging buffer matches histogram buffer size', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    await pipeline.compute(mockInputTexture, 2, 2)

    const stagingBuffer = createdBuffers.find(
      (b) => b.label === 'Histogram Staging Buffer'
    )
    expect(stagingBuffer).toBeDefined()
    expect(stagingBuffer!.size).toBe(4096)
  })
})

// ============================================================================
// Resource Management
// ============================================================================

describe('resource management', () => {
  it('reuses histogram buffer across multiple computations', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const buffersAfterInit = createdBuffers.length

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    await pipeline.compute(mockInputTexture, 2, 2)
    await pipeline.compute(mockInputTexture, 4, 4)

    // Only staging buffers should be created during compute (1 per call)
    // Histogram and dimensions buffers are reused
    const stagingBuffers = createdBuffers
      .slice(buffersAfterInit)
      .filter((b) => b.label === 'Histogram Staging Buffer')
    expect(stagingBuffers.length).toBe(2)
  })

  it('reuses dimensions buffer across multiple computations', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture
    await pipeline.compute(mockInputTexture, 2, 2)
    await pipeline.compute(mockInputTexture, 4, 4)

    // Should only have one dimensions buffer
    const dimensionsBuffers = createdBuffers.filter(
      (b) => b.label === 'Histogram Dimensions Buffer'
    )
    expect(dimensionsBuffers.length).toBe(1)
  })

  it('does not leak staging buffers', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // Run multiple computations
    for (let i = 0; i < 5; i++) {
      await pipeline.compute(mockInputTexture, 10, 10)
    }

    // All staging buffers should be destroyed
    const stagingBuffers = createdBuffers.filter(
      (b) => b.label === 'Histogram Staging Buffer'
    )
    stagingBuffers.forEach((buffer) => {
      expect(buffer.destroy).toHaveBeenCalled()
    })
  })

  it('does not leak textures from computeFromPixels', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const texturesBeforeCompute = createdTextures.length

    // Run multiple computations
    for (let i = 0; i < 5; i++) {
      const pixels = createTestPixels(10, 10)
      await pipeline.computeFromPixels(pixels, 10, 10)
    }

    // All input textures should be destroyed
    const inputTextures = createdTextures
      .slice(texturesBeforeCompute)
      .filter((_, index) => {
        const call = vi.mocked(mockDevice.createTexture).mock.calls[
          texturesBeforeCompute + index
        ]
        return call?.[0]?.label === 'Histogram Input Texture'
      })

    inputTextures.forEach((texture) => {
      expect(texture.destroy).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Concurrent Operations
// ============================================================================

describe('concurrent operations', () => {
  it('can run multiple computations sequentially', async () => {
    const pipeline = new HistogramPipeline(mockDevice as unknown as GPUDevice)
    await pipeline.initialize()

    const mockInputTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture

    // Run several computations
    const results = await Promise.all([
      pipeline.compute(mockInputTexture, 10, 10),
      pipeline.compute(mockInputTexture, 20, 20),
      pipeline.compute(mockInputTexture, 30, 30),
    ])

    expect(results.length).toBe(3)
    results.forEach((result) => {
      expect(result.red.length).toBe(256)
      expect(result.green.length).toBe(256)
      expect(result.blue.length).toBe(256)
      expect(result.luminance.length).toBe(256)
    })
  })
})
