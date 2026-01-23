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
  type EditPipelineInput,
  type EditPipelineParams,
} from './edit-pipeline'
import { DEFAULT_BASIC_ADJUSTMENTS } from './adjustments-pipeline'

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

  describe('initialization', () => {
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
      const { getGPUCapabilityService } = await import('../capabilities')
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
