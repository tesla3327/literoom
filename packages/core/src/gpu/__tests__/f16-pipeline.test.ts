/**
 * Unit tests for f16 (half-precision) support in UberPipeline.
 *
 * Tests feature detection, shader selection, pipeline caching,
 * and fallback behavior when f16 is not available.
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
  resetUberPipeline,
} from '../pipelines/uber-pipeline'
import { UBER_SHADER_SOURCE, UBER_SHADER_F16_SOURCE } from '../shaders'

// Mock the capabilities module
vi.mock('../capabilities', () => ({
  getGPUCapabilityService: vi.fn(() => ({
    isReady: true,
    device: null,
    capabilities: {
      available: true,
      features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
    },
  })),
}))

import { getGPUCapabilityService } from '../capabilities'

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
let shaderModuleCalls: Array<{ label?: string; code: string }>

function createMockDevice(): MockGPUDevice {
  createdTextures = []
  createdBuffers = []
  createdPipelines = []
  shaderModuleCalls = []
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
    writeTexture: vi.fn(),
    writeBuffer: vi.fn(),
    submit: vi.fn(),
  }

  return {
    createShaderModule: vi.fn((descriptor: { label?: string; code: string }) => {
      shaderModuleCalls.push(descriptor)
      return { label: descriptor.label }
    }),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn((descriptor) => {
      const pipeline = { label: descriptor?.label || `Pipeline ${createdPipelines.length}` }
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

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetUberPipeline()
  mockDevice = createMockDevice()
})

afterEach(() => {
  resetUberPipeline()
})

// ============================================================================
// F16 Feature Detection Tests
// ============================================================================

describe('UberPipeline F16 Support', () => {
  describe('Feature Detection', () => {
    it('isF16Enabled returns true when shader-f16 is available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(pipeline.isF16Enabled()).toBe(true)
    })

    it('isF16Enabled returns false when shader-f16 is unavailable', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('handles undefined capabilities gracefully', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: undefined,
      } as unknown as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('handles null capabilities gracefully', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: null,
      } as unknown as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('handles missing features object gracefully', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: undefined,
        },
      } as unknown as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('returns false before initialization', () => {
      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      expect(pipeline.isF16Enabled()).toBe(false)
    })
  })

  describe('Shader Selection', () => {
    it('uses f16 shader when feature is available', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Uber Shader (f16)',
        code: UBER_SHADER_F16_SOURCE,
      })
    })

    it('uses f32 shader when feature is unavailable', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(mockDevice.createShaderModule).toHaveBeenCalledWith({
        label: 'Uber Shader',
        code: UBER_SHADER_SOURCE,
      })
    })

    it('shader module has correct label indicating f16 precision', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(shaderModuleCalls[0].label).toBe('Uber Shader (f16)')
    })

    it('shader module has correct label indicating f32 precision', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(shaderModuleCalls[0].label).toBe('Uber Shader')
    })

    it('f16 shader contains enable f16 directive', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(shaderModuleCalls[0].code).toContain('enable f16')
    })

    it('f32 shader does not contain enable f16 directive', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      expect(shaderModuleCalls[0].code).not.toContain('enable f16')
    })
  })

  describe('Pipeline Caching', () => {
    it('cache key includes f16 flag when f16 is supported', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Trigger pipeline creation by applying adjustments
      mockStagingBufferData = new Uint8Array(4)
      const pixels = new Uint8Array([128, 64, 192, 255])
      await pipeline.apply(pixels, 1, 1, { temperature: 10, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 })

      // Pipeline label should include f16 flag
      expect(createdPipelines.some(p => p.label?.includes('f16=true'))).toBe(true)
    })

    it('cache key includes f16 flag when f16 is not supported', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Trigger pipeline creation by applying adjustments
      mockStagingBufferData = new Uint8Array(4)
      const pixels = new Uint8Array([128, 64, 192, 255])
      await pipeline.apply(pixels, 1, 1, { temperature: 10, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 })

      // Pipeline label should include f16=false flag
      expect(createdPipelines.some(p => p.label?.includes('f16=false'))).toBe(true)
    })

    it('reuses pipeline when f16 support does not change', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array(4)
      const pixels = new Uint8Array([128, 64, 192, 255])
      const adjustments = { temperature: 10, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 }

      // First apply
      await pipeline.apply(pixels, 1, 1, adjustments)
      const pipelineCountAfterFirst = createdPipelines.length

      // Second apply with same configuration
      await pipeline.apply(pixels, 1, 1, adjustments)
      const pipelineCountAfterSecond = createdPipelines.length

      // Should reuse the same pipeline
      expect(pipelineCountAfterSecond).toBe(pipelineCountAfterFirst)
    })
  })

  describe('Initialization', () => {
    it('correctly detects f16 support during initialization', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)

      // Before initialization
      expect(pipeline.isF16Enabled()).toBe(false)

      await pipeline.initialize()

      // After initialization
      expect(pipeline.isF16Enabled()).toBe(true)
    })

    it('works correctly when capabilities service returns undefined features.shaderF16', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: undefined, float32Filtering: true, textureCompressionBC: false },
        },
      } as unknown as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Should default to false when undefined
      expect(pipeline.isF16Enabled()).toBe(false)
      // Should use f32 shader
      expect(shaderModuleCalls[0].label).toBe('Uber Shader')
    })

    it('only initializes once on multiple calls', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)

      await pipeline.initialize()
      await pipeline.initialize()
      await pipeline.initialize()

      // Shader module should only be created once
      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1)
    })
  })

  describe('Resource Cleanup', () => {
    it('resets f16Supported on destroy', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      expect(pipeline.isF16Enabled()).toBe(true)

      pipeline.destroy()
      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('can reinitialize after destroy with different f16 support', async () => {
      // First init with f16
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      expect(pipeline.isF16Enabled()).toBe(true)

      pipeline.destroy()

      // Reinit without f16
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      await pipeline.initialize()
      expect(pipeline.isF16Enabled()).toBe(false)
    })

    it('can reinitialize after destroy with f16 enabled', async () => {
      // First init without f16
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()
      expect(pipeline.isF16Enabled()).toBe(false)
      expect(shaderModuleCalls[0].label).toBe('Uber Shader')

      pipeline.destroy()

      // Reset mock device to track new shader calls
      mockDevice = createMockDevice()

      // Reinit with f16 - need to create new pipeline since old device reference is invalid
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline2 = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline2.initialize()
      expect(pipeline2.isF16Enabled()).toBe(true)
      expect(shaderModuleCalls[0].label).toBe('Uber Shader (f16)')
    })

    it('clears pipeline cache on destroy', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      // Create a pipeline by applying
      mockStagingBufferData = new Uint8Array(4)
      const pixels = new Uint8Array([128, 64, 192, 255])
      const adjustments = { temperature: 10, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 }
      await pipeline.apply(pixels, 1, 1, adjustments)

      const pipelinesBeforeDestroy = createdPipelines.length

      pipeline.destroy()
      await pipeline.initialize()

      // Apply again - should create new pipeline since cache was cleared
      await pipeline.apply(pixels, 1, 1, adjustments)

      expect(createdPipelines.length).toBeGreaterThan(pipelinesBeforeDestroy)
    })
  })

  describe('F16 Shader Content Validation', () => {
    it('f16 shader uses vec3<f16> for color operations', () => {
      expect(UBER_SHADER_F16_SOURCE).toContain('vec3<f16>')
    })

    it('f16 shader uses f16 type constants', () => {
      expect(UBER_SHADER_F16_SOURCE).toContain('f16(')
      expect(UBER_SHADER_F16_SOURCE).toContain('.0h')
    })

    it('f32 shader does not use f16 types', () => {
      expect(UBER_SHADER_SOURCE).not.toContain('vec3<f16>')
      expect(UBER_SHADER_SOURCE).not.toContain('f16(')
      expect(UBER_SHADER_SOURCE).not.toContain('.0h')
    })

    it('both shaders have same entry point', () => {
      expect(UBER_SHADER_SOURCE).toContain('fn main(')
      expect(UBER_SHADER_F16_SOURCE).toContain('fn main(')
    })

    it('both shaders have same workgroup size', () => {
      expect(UBER_SHADER_SOURCE).toContain('@workgroup_size(16, 16)')
      expect(UBER_SHADER_F16_SOURCE).toContain('@workgroup_size(16, 16)')
    })

    it('both shaders support same override constants', () => {
      expect(UBER_SHADER_SOURCE).toContain('override ENABLE_ADJUSTMENTS')
      expect(UBER_SHADER_SOURCE).toContain('override ENABLE_TONE_CURVE')
      expect(UBER_SHADER_F16_SOURCE).toContain('override ENABLE_ADJUSTMENTS')
      expect(UBER_SHADER_F16_SOURCE).toContain('override ENABLE_TONE_CURVE')
    })
  })

  describe('Integration with apply()', () => {
    it('applies adjustments correctly with f16 shader', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: true, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array([200, 100, 150, 255])
      const pixels = new Uint8Array([128, 64, 192, 255])
      const adjustments = { temperature: 10, tint: 20, exposure: 0.5, contrast: 25, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 }

      const result = await pipeline.apply(pixels, 1, 1, adjustments)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(4)
      expect(pipeline.isF16Enabled()).toBe(true)
    })

    it('applies adjustments correctly with f32 shader', async () => {
      vi.mocked(getGPUCapabilityService).mockReturnValue({
        isReady: true,
        device: mockDevice as unknown as GPUDevice,
        capabilities: {
          available: true,
          features: { shaderF16: false, float32Filtering: true, textureCompressionBC: false },
        },
      } as ReturnType<typeof getGPUCapabilityService>)

      const pipeline = new UberPipeline(mockDevice as unknown as GPUDevice)
      await pipeline.initialize()

      mockStagingBufferData = new Uint8Array([200, 100, 150, 255])
      const pixels = new Uint8Array([128, 64, 192, 255])
      const adjustments = { temperature: 10, tint: 20, exposure: 0.5, contrast: 25, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 }

      const result = await pipeline.apply(pixels, 1, 1, adjustments)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(4)
      expect(pipeline.isF16Enabled()).toBe(false)
    })
  })
})
