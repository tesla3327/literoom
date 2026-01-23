/**
 * Unit tests for GPU texture utilities.
 *
 * Tests texture creation, reading, and pooling utilities including:
 * - createTextureFromPixels
 * - createOutputTexture
 * - readTexturePixels
 * - TexturePool
 * - BufferPool
 * - DoubleBufferedTextures
 * - calculateDispatchSize
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to define mocks that run before any imports
const mockGPUConstants = vi.hoisted(() => {
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

  // Set globals
  ;(globalThis as Record<string, unknown>).GPUBufferUsage = mockGPUBufferUsage
  ;(globalThis as Record<string, unknown>).GPUTextureUsage = mockGPUTextureUsage
  ;(globalThis as Record<string, unknown>).GPUMapMode = mockGPUMapMode

  return { mockGPUBufferUsage, mockGPUTextureUsage, mockGPUMapMode }
})

import {
  TextureUsage,
  createTextureFromPixels,
  createOutputTexture,
  readTexturePixels,
  TexturePool,
  BufferPool,
  DoubleBufferedTextures,
  calculateDispatchSize,
} from './texture-utils'

// Re-export for use in tests
const { mockGPUBufferUsage, mockGPUTextureUsage, mockGPUMapMode } = mockGPUConstants

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
  usage?: number
  destroy: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}

interface MockGPUCommandEncoder {
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
  submit: (commands: MockGPUCommandBuffer[]) => void
}

interface MockGPUDevice {
  createTexture: (descriptor: {
    label?: string
    size: { width: number; height: number; depthOrArrayLayers: number }
    format: string
    usage: number
  }) => MockGPUTexture
  createBuffer: (descriptor: { label?: string; size: number; usage: number }) => MockGPUBuffer
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

  const createMockTexture = (descriptor: {
    label?: string
    size: { width: number; height: number; depthOrArrayLayers: number }
    format: string
    usage: number
  }): MockGPUTexture => {
    const texture: MockGPUTexture = {
      label: descriptor.label,
      createView: vi.fn(() => mockTextureView),
      destroy: vi.fn(),
    }
    createdTextures.push(texture)
    return texture
  }

  const createMockBuffer = (descriptor: {
    label?: string
    size: number
    usage: number
  }): MockGPUBuffer => {
    const buffer: MockGPUBuffer = {
      label: descriptor.label,
      size: descriptor.size,
      usage: descriptor.usage,
      destroy: vi.fn(),
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => mockStagingBufferData.buffer),
      unmap: vi.fn(),
    }
    createdBuffers.push(buffer)
    return buffer
  }

  const mockCommandEncoder: MockGPUCommandEncoder = {
    copyTextureToBuffer: vi.fn(),
    finish: vi.fn(() => ({})),
  }

  const mockQueue: MockGPUQueue = {
    writeTexture: vi.fn((dest, data, dataLayout, size) => {
      writeTextureCalls.push({ dest, data, dataLayout, size })
    }),
    submit: vi.fn(),
  }

  return {
    createTexture: vi.fn(createMockTexture),
    createBuffer: vi.fn(createMockBuffer),
    createCommandEncoder: vi.fn(() => mockCommandEncoder),
    queue: mockQueue,
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeEach(() => {
  mockDevice = createMockDevice()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// TextureUsage Tests
// ============================================================================

describe('TextureUsage', () => {
  it('defines INPUT usage flags', () => {
    expect(TextureUsage.INPUT).toBeDefined()
    expect(typeof TextureUsage.INPUT).toBe('number')
  })

  it('defines OUTPUT usage flags', () => {
    expect(TextureUsage.OUTPUT).toBeDefined()
    expect(typeof TextureUsage.OUTPUT).toBe('number')
  })

  it('defines PINGPONG usage flags', () => {
    expect(TextureUsage.PINGPONG).toBeDefined()
    expect(typeof TextureUsage.PINGPONG).toBe('number')
  })

  it('INPUT includes TEXTURE_BINDING and COPY_DST', () => {
    // These are the standard WebGPU flags
    expect(TextureUsage.INPUT & GPUTextureUsage.TEXTURE_BINDING).toBeTruthy()
    expect(TextureUsage.INPUT & GPUTextureUsage.COPY_DST).toBeTruthy()
  })

  it('OUTPUT includes STORAGE_BINDING and COPY_SRC', () => {
    expect(TextureUsage.OUTPUT & GPUTextureUsage.STORAGE_BINDING).toBeTruthy()
    expect(TextureUsage.OUTPUT & GPUTextureUsage.COPY_SRC).toBeTruthy()
  })

  it('PINGPONG includes all necessary flags', () => {
    expect(TextureUsage.PINGPONG & GPUTextureUsage.TEXTURE_BINDING).toBeTruthy()
    expect(TextureUsage.PINGPONG & GPUTextureUsage.STORAGE_BINDING).toBeTruthy()
    expect(TextureUsage.PINGPONG & GPUTextureUsage.COPY_DST).toBeTruthy()
    expect(TextureUsage.PINGPONG & GPUTextureUsage.COPY_SRC).toBeTruthy()
  })
})

// ============================================================================
// createTextureFromPixels Tests
// ============================================================================

describe('createTextureFromPixels', () => {
  it('creates texture with correct dimensions', () => {
    const pixels = new Uint8Array(100 * 75 * 4)
    createTextureFromPixels(
      mockDevice as unknown as GPUDevice,
      pixels,
      100,
      75
    )

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: { width: 100, height: 75, depthOrArrayLayers: 1 },
      })
    )
  })

  it('uses rgba8unorm format', () => {
    const pixels = new Uint8Array(4)
    createTextureFromPixels(mockDevice as unknown as GPUDevice, pixels, 1, 1)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'rgba8unorm',
      })
    )
  })

  it('uses INPUT usage by default', () => {
    const pixels = new Uint8Array(4)
    createTextureFromPixels(mockDevice as unknown as GPUDevice, pixels, 1, 1)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: TextureUsage.INPUT,
      })
    )
  })

  it('accepts custom usage flags', () => {
    const pixels = new Uint8Array(4)
    createTextureFromPixels(
      mockDevice as unknown as GPUDevice,
      pixels,
      1,
      1,
      TextureUsage.OUTPUT
    )

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: TextureUsage.OUTPUT,
      })
    )
  })

  it('uses default label if not provided', () => {
    const pixels = new Uint8Array(100 * 50 * 4)
    createTextureFromPixels(mockDevice as unknown as GPUDevice, pixels, 100, 50)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Texture 100x50',
      })
    )
  })

  it('uses custom label if provided', () => {
    const pixels = new Uint8Array(4)
    createTextureFromPixels(
      mockDevice as unknown as GPUDevice,
      pixels,
      1,
      1,
      TextureUsage.INPUT,
      'Custom Label'
    )

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Custom Label',
      })
    )
  })

  it('writes pixel data to texture', () => {
    const pixels = new Uint8Array([255, 128, 64, 255, 0, 0, 0, 255])
    createTextureFromPixels(mockDevice as unknown as GPUDevice, pixels, 2, 1)

    expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
      expect.objectContaining({ texture: expect.anything() }),
      expect.any(ArrayBuffer),
      expect.objectContaining({ bytesPerRow: 8, rowsPerImage: 1 }),
      { width: 2, height: 1, depthOrArrayLayers: 1 }
    )
  })

  it('returns created texture', () => {
    const pixels = new Uint8Array(4)
    const result = createTextureFromPixels(
      mockDevice as unknown as GPUDevice,
      pixels,
      1,
      1
    )

    expect(result).toBeDefined()
    expect(createdTextures).toContain(result)
  })
})

// ============================================================================
// createOutputTexture Tests
// ============================================================================

describe('createOutputTexture', () => {
  it('creates texture with correct dimensions', () => {
    createOutputTexture(mockDevice as unknown as GPUDevice, 200, 150)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: { width: 200, height: 150, depthOrArrayLayers: 1 },
      })
    )
  })

  it('uses OUTPUT usage by default', () => {
    createOutputTexture(mockDevice as unknown as GPUDevice, 1, 1)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: TextureUsage.OUTPUT,
      })
    )
  })

  it('accepts custom usage flags', () => {
    createOutputTexture(
      mockDevice as unknown as GPUDevice,
      1,
      1,
      TextureUsage.PINGPONG
    )

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: TextureUsage.PINGPONG,
      })
    )
  })

  it('uses default label if not provided', () => {
    createOutputTexture(mockDevice as unknown as GPUDevice, 100, 50)

    expect(mockDevice.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Output Texture 100x50',
      })
    )
  })

  it('does not write any data', () => {
    createOutputTexture(mockDevice as unknown as GPUDevice, 100, 100)

    expect(mockDevice.queue.writeTexture).not.toHaveBeenCalled()
  })
})

// ============================================================================
// readTexturePixels Tests
// ============================================================================

describe('readTexturePixels', () => {
  it('creates staging buffer with correct size', async () => {
    const texture = createdTextures[0] || {
      createView: vi.fn(),
    } as unknown as MockGPUTexture

    mockStagingBufferData = new Uint8Array(100 * 75 * 4)

    await readTexturePixels(
      mockDevice as unknown as GPUDevice,
      texture as unknown as GPUTexture,
      100,
      75
    )

    expect(mockDevice.createBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 100 * 75 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
    )
  })

  it('copies texture to buffer', async () => {
    const texture = {
      label: 'Test Texture',
    } as unknown as GPUTexture

    mockStagingBufferData = new Uint8Array(4)

    await readTexturePixels(mockDevice as unknown as GPUDevice, texture, 1, 1)

    const encoder = mockDevice.createCommandEncoder({})
    expect(encoder.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture },
      expect.objectContaining({ bytesPerRow: 4, rowsPerImage: 1 }),
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    )
  })

  it('submits command buffer', async () => {
    mockStagingBufferData = new Uint8Array(4)

    await readTexturePixels(
      mockDevice as unknown as GPUDevice,
      {} as GPUTexture,
      1,
      1
    )

    expect(mockDevice.queue.submit).toHaveBeenCalled()
  })

  it('maps buffer for reading', async () => {
    mockStagingBufferData = new Uint8Array(4)

    await readTexturePixels(
      mockDevice as unknown as GPUDevice,
      {} as GPUTexture,
      1,
      1
    )

    const buffer = createdBuffers[0]
    expect(buffer.mapAsync).toHaveBeenCalledWith(GPUMapMode.READ)
  })

  it('returns copied pixel data', async () => {
    mockStagingBufferData = new Uint8Array([255, 128, 64, 255])

    const result = await readTexturePixels(
      mockDevice as unknown as GPUDevice,
      {} as GPUTexture,
      1,
      1
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result[0]).toBe(255)
    expect(result[1]).toBe(128)
    expect(result[2]).toBe(64)
    expect(result[3]).toBe(255)
  })

  it('destroys staging buffer after reading', async () => {
    mockStagingBufferData = new Uint8Array(4)

    await readTexturePixels(
      mockDevice as unknown as GPUDevice,
      {} as GPUTexture,
      1,
      1
    )

    const buffer = createdBuffers[0]
    expect(buffer.unmap).toHaveBeenCalled()
    expect(buffer.destroy).toHaveBeenCalled()
  })
})

// ============================================================================
// TexturePool Tests
// ============================================================================

describe('TexturePool', () => {
  describe('constructor', () => {
    it('creates pool with default max size', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)
      expect(pool).toBeDefined()
    })

    it('creates pool with custom max size', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice, 8)
      expect(pool).toBeDefined()
    })
  })

  describe('acquire', () => {
    it('creates new texture when pool is empty', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      pool.acquire(100, 100, TextureUsage.INPUT)

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          size: { width: 100, height: 100, depthOrArrayLayers: 1 },
        })
      )
    })

    it('reuses texture from pool', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const texture1 = pool.acquire(100, 100, TextureUsage.INPUT)
      pool.release(texture1, 100, 100, TextureUsage.INPUT)

      const texture2 = pool.acquire(100, 100, TextureUsage.INPUT)

      expect(texture1).toBe(texture2)
      expect(mockDevice.createTexture).toHaveBeenCalledTimes(1)
    })

    it('creates new texture for different dimensions', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      pool.acquire(100, 100, TextureUsage.INPUT)
      pool.acquire(200, 200, TextureUsage.INPUT)

      expect(mockDevice.createTexture).toHaveBeenCalledTimes(2)
    })

    it('creates new texture for different usage', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      pool.acquire(100, 100, TextureUsage.INPUT)
      pool.acquire(100, 100, TextureUsage.OUTPUT)

      expect(mockDevice.createTexture).toHaveBeenCalledTimes(2)
    })

    it('uses custom label', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      pool.acquire(100, 100, TextureUsage.INPUT, 'Custom Label')

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Custom Label',
        })
      )
    })
  })

  describe('release', () => {
    it('adds texture back to pool', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const texture = pool.acquire(100, 100, TextureUsage.INPUT)
      pool.release(texture, 100, 100, TextureUsage.INPUT)

      const stats = pool.getStats()
      expect(stats.totalTextures).toBe(1)
    })

    it('destroys texture when pool is full', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice, 2)

      const textures = [
        pool.acquire(100, 100, TextureUsage.INPUT),
        pool.acquire(100, 100, TextureUsage.INPUT),
        pool.acquire(100, 100, TextureUsage.INPUT),
      ]

      pool.release(textures[0], 100, 100, TextureUsage.INPUT)
      pool.release(textures[1], 100, 100, TextureUsage.INPUT)
      pool.release(textures[2], 100, 100, TextureUsage.INPUT)

      // Third texture should be destroyed
      expect(textures[2].destroy).toHaveBeenCalled()

      const stats = pool.getStats()
      expect(stats.totalTextures).toBe(2)
    })
  })

  describe('clear', () => {
    it('destroys all pooled textures', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const texture1 = pool.acquire(100, 100, TextureUsage.INPUT)
      const texture2 = pool.acquire(200, 200, TextureUsage.INPUT)
      pool.release(texture1, 100, 100, TextureUsage.INPUT)
      pool.release(texture2, 200, 200, TextureUsage.INPUT)

      pool.clear()

      expect(texture1.destroy).toHaveBeenCalled()
      expect(texture2.destroy).toHaveBeenCalled()
    })

    it('empties the pool', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const texture = pool.acquire(100, 100, TextureUsage.INPUT)
      pool.release(texture, 100, 100, TextureUsage.INPUT)
      pool.clear()

      const stats = pool.getStats()
      expect(stats.totalTextures).toBe(0)
      expect(stats.poolCount).toBe(0)
    })
  })

  describe('getStats', () => {
    it('returns pool count', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      pool.acquire(100, 100, TextureUsage.INPUT)
      pool.acquire(200, 200, TextureUsage.OUTPUT)

      const stats = pool.getStats()
      expect(stats.poolCount).toBe(0) // Nothing released yet
    })

    it('returns total texture count', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const t1 = pool.acquire(100, 100, TextureUsage.INPUT)
      const t2 = pool.acquire(100, 100, TextureUsage.INPUT)
      pool.release(t1, 100, 100, TextureUsage.INPUT)
      pool.release(t2, 100, 100, TextureUsage.INPUT)

      const stats = pool.getStats()
      expect(stats.totalTextures).toBe(2)
    })
  })
})

// ============================================================================
// BufferPool Tests
// ============================================================================

describe('BufferPool', () => {
  describe('acquire', () => {
    it('creates new buffer when pool is empty', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice)

      pool.acquire(1024, GPUBufferUsage.UNIFORM)

      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 1024,
        })
      )
    })

    it('reuses buffer from pool', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice)

      const buffer1 = pool.acquire(1024, GPUBufferUsage.UNIFORM)
      pool.release(buffer1, 1024)

      const buffer2 = pool.acquire(1024, GPUBufferUsage.UNIFORM)

      expect(buffer1).toBe(buffer2)
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1)
    })

    it('creates new buffer for different size', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice)

      pool.acquire(1024, GPUBufferUsage.UNIFORM)
      pool.acquire(2048, GPUBufferUsage.UNIFORM)

      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(2)
    })
  })

  describe('release', () => {
    it('adds buffer back to pool', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice)

      const buffer = pool.acquire(1024, GPUBufferUsage.UNIFORM)
      pool.release(buffer, 1024)

      // Acquire again should reuse
      const buffer2 = pool.acquire(1024, GPUBufferUsage.UNIFORM)
      expect(buffer).toBe(buffer2)
    })

    it('destroys buffer when pool is full', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice, 2)

      const buffers = [
        pool.acquire(1024, GPUBufferUsage.UNIFORM),
        pool.acquire(1024, GPUBufferUsage.UNIFORM),
        pool.acquire(1024, GPUBufferUsage.UNIFORM),
      ]

      pool.release(buffers[0], 1024)
      pool.release(buffers[1], 1024)
      pool.release(buffers[2], 1024)

      expect(buffers[2].destroy).toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('destroys all pooled buffers', () => {
      const pool = new BufferPool(mockDevice as unknown as GPUDevice)

      const buffer1 = pool.acquire(1024, GPUBufferUsage.UNIFORM)
      const buffer2 = pool.acquire(2048, GPUBufferUsage.UNIFORM)
      pool.release(buffer1, 1024)
      pool.release(buffer2, 2048)

      pool.clear()

      expect(buffer1.destroy).toHaveBeenCalled()
      expect(buffer2.destroy).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// DoubleBufferedTextures Tests
// ============================================================================

describe('DoubleBufferedTextures', () => {
  describe('constructor', () => {
    it('creates two textures', () => {
      new DoubleBufferedTextures(mockDevice as unknown as GPUDevice, 100, 100)

      expect(mockDevice.createTexture).toHaveBeenCalledTimes(2)
    })

    it('creates textures with PINGPONG usage', () => {
      new DoubleBufferedTextures(mockDevice as unknown as GPUDevice, 100, 100)

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: TextureUsage.PINGPONG,
        })
      )
    })

    it('uses labels A and B', () => {
      new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100,
        'Test'
      )

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Test A' })
      )
      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Test B' })
      )
    })
  })

  describe('getCurrent', () => {
    it('returns first texture initially', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      const current = db.getCurrent()

      expect(current).toBe(createdTextures[0])
    })
  })

  describe('getNext', () => {
    it('returns second texture initially', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      const next = db.getNext()

      expect(next).toBe(createdTextures[1])
    })
  })

  describe('swap', () => {
    it('swaps current and next', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      const firstCurrent = db.getCurrent()
      const firstNext = db.getNext()

      db.swap()

      expect(db.getCurrent()).toBe(firstNext)
      expect(db.getNext()).toBe(firstCurrent)
    })

    it('swaps back after two swaps', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      const original = db.getCurrent()

      db.swap()
      db.swap()

      expect(db.getCurrent()).toBe(original)
    })
  })

  describe('reset', () => {
    it('restores initial state', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      const original = db.getCurrent()
      db.swap()
      db.reset()

      expect(db.getCurrent()).toBe(original)
    })
  })

  describe('destroy', () => {
    it('destroys both textures', () => {
      const db = new DoubleBufferedTextures(
        mockDevice as unknown as GPUDevice,
        100,
        100
      )

      db.destroy()

      expect(createdTextures[0].destroy).toHaveBeenCalled()
      expect(createdTextures[1].destroy).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// calculateDispatchSize Tests
// ============================================================================

describe('calculateDispatchSize', () => {
  it('returns correct dimensions for exact multiple', () => {
    const [x, y, z] = calculateDispatchSize(32, 32, 16)

    expect(x).toBe(2)
    expect(y).toBe(2)
    expect(z).toBe(1)
  })

  it('rounds up for non-multiple width', () => {
    const [x] = calculateDispatchSize(33, 16, 16)

    expect(x).toBe(3) // ceil(33/16) = 3
  })

  it('rounds up for non-multiple height', () => {
    const [, y] = calculateDispatchSize(16, 17, 16)

    expect(y).toBe(2) // ceil(17/16) = 2
  })

  it('uses default workgroup size of 16', () => {
    const [x, y, z] = calculateDispatchSize(160, 160)

    expect(x).toBe(10)
    expect(y).toBe(10)
    expect(z).toBe(1)
  })

  it('handles 1x1 image', () => {
    const [x, y, z] = calculateDispatchSize(1, 1)

    expect(x).toBe(1)
    expect(y).toBe(1)
    expect(z).toBe(1)
  })

  it('handles large images', () => {
    const [x, y, z] = calculateDispatchSize(8192, 6144, 16)

    expect(x).toBe(512) // 8192/16
    expect(y).toBe(384) // 6144/16
    expect(z).toBe(1)
  })

  it('always returns z = 1', () => {
    const [, , z1] = calculateDispatchSize(100, 100)
    const [, , z2] = calculateDispatchSize(1, 1)
    const [, , z3] = calculateDispatchSize(8192, 8192)

    expect(z1).toBe(1)
    expect(z2).toBe(1)
    expect(z3).toBe(1)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  describe('createTextureFromPixels', () => {
    it('handles minimum 1x1 texture', () => {
      const pixels = new Uint8Array([255, 128, 64, 255])
      const result = createTextureFromPixels(
        mockDevice as unknown as GPUDevice,
        pixels,
        1,
        1
      )

      expect(result).toBeDefined()
    })

    it('handles non-power-of-2 dimensions', () => {
      const pixels = new Uint8Array(100 * 75 * 4)
      createTextureFromPixels(
        mockDevice as unknown as GPUDevice,
        pixels,
        100,
        75
      )

      expect(mockDevice.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          size: { width: 100, height: 75, depthOrArrayLayers: 1 },
        })
      )
    })
  })

  describe('TexturePool', () => {
    it('handles mixed dimension pools', () => {
      const pool = new TexturePool(mockDevice as unknown as GPUDevice)

      const t1 = pool.acquire(100, 100, TextureUsage.INPUT)
      const t2 = pool.acquire(200, 100, TextureUsage.INPUT)
      const t3 = pool.acquire(100, 200, TextureUsage.INPUT)

      pool.release(t1, 100, 100, TextureUsage.INPUT)
      pool.release(t2, 200, 100, TextureUsage.INPUT)
      pool.release(t3, 100, 200, TextureUsage.INPUT)

      const stats = pool.getStats()
      expect(stats.poolCount).toBe(3) // 3 different dimension pools
      expect(stats.totalTextures).toBe(3)
    })
  })
})
