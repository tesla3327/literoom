/**
 * Unit tests for TimingHelper.
 *
 * Tests the GPU timestamp profiling helper including:
 * - Initialization and feature detection
 * - Timestamp recording (begin/end)
 * - Timestamp resolution
 * - Reading timing results
 * - Resource cleanup
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock WebGPU globals before importing modules
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

const mockGPUMapMode = {
  READ: 0x0001,
  WRITE: 0x0002,
}

vi.stubGlobal('GPUBufferUsage', mockGPUBufferUsage)
vi.stubGlobal('GPUMapMode', mockGPUMapMode)

import { TimingHelper, createTimingHelper } from '../utils/timing-helper'

// ============================================================================
// Mock WebGPU Types
// ============================================================================

interface MockGPUQuerySet {
  label?: string
  count?: number
  type?: string
  destroy: () => void
}

interface MockGPUBuffer {
  label?: string
  size?: number
  destroy: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: (offset?: number, size?: number) => ArrayBuffer
  unmap: () => void
}

interface MockGPUCommandEncoder {
  writeTimestamp: (querySet: MockGPUQuerySet, index: number) => void
  resolveQuerySet: (
    querySet: MockGPUQuerySet,
    firstQuery: number,
    queryCount: number,
    destination: MockGPUBuffer,
    destinationOffset: number
  ) => void
  copyBufferToBuffer: (
    source: MockGPUBuffer,
    sourceOffset: number,
    destination: MockGPUBuffer,
    destinationOffset: number,
    size: number
  ) => void
  finish: () => MockGPUCommandBuffer
}

interface MockGPUCommandBuffer {
  label?: string
}

interface MockGPUQueue {
  submit: (commands: MockGPUCommandBuffer[]) => void
  onSubmittedWorkDone: () => Promise<void>
}

interface MockGPUDevice {
  features: Set<string>
  createQuerySet: (descriptor: {
    label?: string
    type: string
    count: number
  }) => MockGPUQuerySet
  createBuffer: (descriptor: {
    label?: string
    size: number
    usage: number
  }) => MockGPUBuffer
  createCommandEncoder: (descriptor?: { label?: string }) => MockGPUCommandEncoder
  queue: MockGPUQueue
}

// ============================================================================
// Test Setup
// ============================================================================

let mockDevice: MockGPUDevice
let mockQuerySet: MockGPUQuerySet
let mockResolveBuffer: MockGPUBuffer
let mockResultBuffer: MockGPUBuffer
let mockEncoder: MockGPUCommandEncoder
let createdQuerySets: MockGPUQuerySet[]
let createdBuffers: MockGPUBuffer[]
let mockTimestampData: BigInt64Array

function createMockDevice(hasTimestampQuery: boolean = true): MockGPUDevice {
  createdQuerySets = []
  createdBuffers = []

  // Default timestamp data: two pairs of timestamps
  // Pair 1: 0ns to 1000000ns (1ms)
  // Pair 2: 2000000ns to 5000000ns (3ms)
  mockTimestampData = new BigInt64Array([
    BigInt(0),
    BigInt(1_000_000),
    BigInt(2_000_000),
    BigInt(5_000_000),
  ])

  const createMockQuerySet = (descriptor: {
    label?: string
    type: string
    count: number
  }): MockGPUQuerySet => {
    const querySet: MockGPUQuerySet = {
      label: descriptor.label,
      count: descriptor.count,
      type: descriptor.type,
      destroy: vi.fn(),
    }
    createdQuerySets.push(querySet)
    mockQuerySet = querySet
    return querySet
  }

  const createMockBuffer = (descriptor: {
    label?: string
    size: number
    usage: number
  }): MockGPUBuffer => {
    const buffer: MockGPUBuffer = {
      label: descriptor.label,
      size: descriptor.size,
      destroy: vi.fn(),
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => mockTimestampData.buffer),
      unmap: vi.fn(),
    }
    createdBuffers.push(buffer)

    if (descriptor.label?.includes('Resolve')) {
      mockResolveBuffer = buffer
    } else if (descriptor.label?.includes('Result')) {
      mockResultBuffer = buffer
    }

    return buffer
  }

  mockEncoder = {
    writeTimestamp: vi.fn(),
    resolveQuerySet: vi.fn(),
    copyBufferToBuffer: vi.fn(),
    finish: vi.fn(() => ({})),
  }

  const mockQueue: MockGPUQueue = {
    submit: vi.fn(),
    onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
  }

  return {
    features: new Set(hasTimestampQuery ? ['timestamp-query'] : []),
    createQuerySet: vi.fn(createMockQuerySet),
    createBuffer: vi.fn(createMockBuffer),
    createCommandEncoder: vi.fn(() => mockEncoder),
    queue: mockQueue,
  }
}

beforeEach(() => {
  mockDevice = createMockDevice(true)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// TimingHelper Constructor Tests
// ============================================================================

describe('TimingHelper', () => {
  describe('constructor', () => {
    it('creates instance with device reference', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      expect(helper).toBeInstanceOf(TimingHelper)
    })

    it('uses default capacity of 16', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      expect(helper.getCapacity()).toBe(16)
    })

    it('accepts custom capacity', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice, 32)
      expect(helper.getCapacity()).toBe(32)
    })

    it('is not initialized immediately', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      expect(helper.isReady()).toBe(false)
    })
  })

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe('initialization', () => {
    it('should check for timestamp-query feature support', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      expect(helper.isSupported()).toBe(true)
    })

    it('should return false if feature not supported', () => {
      const deviceWithoutTimestamp = createMockDevice(false)
      const helper = new TimingHelper(deviceWithoutTimestamp as unknown as GPUDevice)

      const result = helper.initialize()

      expect(result).toBe(false)
      expect(helper.isSupported()).toBe(false)
      expect(helper.isReady()).toBe(false)
    })

    it('should create query set with correct capacity', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice, 8)
      helper.initialize()

      expect(mockDevice.createQuerySet).toHaveBeenCalledWith({
        label: 'TimingHelper Query Set',
        type: 'timestamp',
        count: 16, // 8 pairs * 2
      })
    })

    it('should create resolve and result buffers', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice, 8)
      helper.initialize()

      // Each timestamp is 8 bytes, 8 pairs = 16 timestamps = 128 bytes
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'TimingHelper Resolve Buffer',
        size: 128,
        usage: mockGPUBufferUsage.QUERY_RESOLVE | mockGPUBufferUsage.COPY_SRC,
      })

      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        label: 'TimingHelper Result Buffer',
        size: 128,
        usage: mockGPUBufferUsage.COPY_DST | mockGPUBufferUsage.MAP_READ,
      })
    })

    it('should return true on successful initialization', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      const result = helper.initialize()

      expect(result).toBe(true)
      expect(helper.isReady()).toBe(true)
    })

    it('should not re-initialize if already initialized', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()
      helper.initialize()

      expect(mockDevice.createQuerySet).toHaveBeenCalledTimes(1)
    })

    it('should handle initialization errors gracefully', () => {
      mockDevice.createQuerySet = vi.fn(() => {
        throw new Error('Failed to create query set')
      })

      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      const result = helper.initialize()

      expect(result).toBe(false)
      expect(helper.isReady()).toBe(false)
    })
  })

  // ============================================================================
  // Timestamp Recording Tests
  // ============================================================================

  describe('timestamp recording', () => {
    it('should return pair index from beginTimestamp', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      const index = helper.beginTimestamp()

      expect(index).toBe(0)
    })

    it('should increment pair index on each call', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      const index1 = helper.beginTimestamp()
      const index2 = helper.beginTimestamp()
      const index3 = helper.beginTimestamp()

      expect(index1).toBe(0)
      expect(index2).toBe(1)
      expect(index3).toBe(2)
    })

    it('should handle multiple timestamp pairs', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      // Record 3 pairs using the modern API
      for (let i = 0; i < 3; i++) {
        const pairIndex = helper.beginTimestamp()
        const writes = helper.getTimestampWrites(pairIndex)
        expect(writes).toBeDefined()
        expect(writes?.beginningOfPassWriteIndex).toBe(pairIndex * 2)
        expect(writes?.endOfPassWriteIndex).toBe(pairIndex * 2 + 1)
      }

      expect(helper.getRecordedPairCount()).toBe(3)
    })

    it('should throw error if not initialized', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)

      expect(() => {
        helper.beginTimestamp()
      }).toThrow('TimingHelper not initialized')
    })

    it('should throw error when capacity exceeded', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice, 2)
      helper.initialize()

      // Fill capacity
      helper.beginTimestamp()
      helper.beginTimestamp()

      // Exceed capacity
      expect(() => {
        helper.beginTimestamp()
      }).toThrow('capacity exceeded')
    })

    it('should return correct pair indices sequentially', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      const index1 = helper.beginTimestamp()
      helper.endTimestamp(index1) // No-op in modern API
      const index2 = helper.beginTimestamp()

      expect(index1).toBe(0)
      expect(index2).toBe(1)
    })
  })

  // ============================================================================
  // Timestamp Resolution Tests
  // ============================================================================

  describe('timestamp resolution', () => {
    it('should resolve query set to buffer', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp() // Allocates pair 0
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      expect(mockEncoder.resolveQuerySet).toHaveBeenCalledWith(
        mockQuerySet,
        0,
        2, // 1 pair = 2 timestamps
        mockResolveBuffer,
        0
      )
    })

    it('should copy resolve buffer to result buffer', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp() // Allocates pair 0
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      expect(mockEncoder.copyBufferToBuffer).toHaveBeenCalledWith(
        mockResolveBuffer,
        0,
        mockResultBuffer,
        0,
        16 // 2 timestamps * 8 bytes
      )
    })

    it('should throw error if not initialized', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)

      expect(() => {
        helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)
      }).toThrow('TimingHelper not initialized')
    })

    it('should not resolve if no timestamps recorded', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      expect(mockEncoder.resolveQuerySet).not.toHaveBeenCalled()
      expect(mockEncoder.copyBufferToBuffer).not.toHaveBeenCalled()
    })

    it('should handle multiple pairs correctly', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      // Record 3 pairs
      helper.beginTimestamp()
      helper.beginTimestamp()
      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      expect(mockEncoder.resolveQuerySet).toHaveBeenCalledWith(
        mockQuerySet,
        0,
        6, // 3 pairs = 6 timestamps
        mockResolveBuffer,
        0
      )

      expect(mockEncoder.copyBufferToBuffer).toHaveBeenCalledWith(
        mockResolveBuffer,
        0,
        mockResultBuffer,
        0,
        48 // 6 timestamps * 8 bytes
      )
    })
  })

  // ============================================================================
  // Reading Results Tests
  // ============================================================================

  describe('reading results', () => {
    it('should map result buffer and read timings', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      await helper.readTimings()

      expect(mockResultBuffer.mapAsync).toHaveBeenCalledWith(mockGPUMapMode.READ)
      expect(mockResultBuffer.getMappedRange).toHaveBeenCalled()
      expect(mockResultBuffer.unmap).toHaveBeenCalled()
    })

    it('should convert nanoseconds correctly', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      const durations = await helper.readTimings()

      // First pair: 1000000ns - 0ns = 1000000ns (1ms)
      expect(durations[0]).toBe(1_000_000)
    })

    it('should return array of durations', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      // Record 2 pairs
      helper.beginTimestamp()
      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      const durations = await helper.readTimings()

      expect(durations).toHaveLength(2)
      expect(durations[0]).toBe(1_000_000) // 1ms in nanoseconds
      expect(durations[1]).toBe(3_000_000) // 3ms in nanoseconds
    })

    it('should return empty array if no timestamps recorded', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      const durations = await helper.readTimings()

      expect(durations).toEqual([])
    })

    it('should throw error if not initialized', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)

      await expect(helper.readTimings()).rejects.toThrow('TimingHelper not initialized')
    })

    it('should wait for submitted work before reading', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      await helper.readTimings()

      expect(mockDevice.queue.onSubmittedWorkDone).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Reset and Cleanup Tests
  // ============================================================================

  describe('cleanup', () => {
    it('should reset timestamp index', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()

      expect(helper.getRecordedPairCount()).toBe(1)

      helper.reset()

      expect(helper.getRecordedPairCount()).toBe(0)
    })

    it('should destroy buffers and query set', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.destroy()

      expect(mockQuerySet.destroy).toHaveBeenCalled()
      expect(mockResolveBuffer.destroy).toHaveBeenCalled()
      expect(mockResultBuffer.destroy).toHaveBeenCalled()
    })

    it('should mark as not ready after destroy', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      expect(helper.isReady()).toBe(true)

      helper.destroy()

      expect(helper.isReady()).toBe(false)
    })

    it('should be safe to call destroy without initialize', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)

      // Should not throw
      expect(() => helper.destroy()).not.toThrow()
    })

    it('should be safe to call destroy multiple times', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.destroy()

      // Should not throw
      expect(() => helper.destroy()).not.toThrow()
    })

    it('should reset index on destroy', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()

      helper.destroy()

      expect(helper.getRecordedPairCount()).toBe(0)
    })
  })

  // ============================================================================
  // Feature Support Tests
  // ============================================================================

  describe('feature support', () => {
    it('should report supported when feature is available', () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      expect(helper.isSupported()).toBe(true)
    })

    it('should report not supported when feature is missing', () => {
      const deviceWithoutTimestamp = createMockDevice(false)
      const helper = new TimingHelper(deviceWithoutTimestamp as unknown as GPUDevice)

      expect(helper.isSupported()).toBe(false)
    })
  })

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================

  describe('edge cases', () => {
    it('should handle single timestamp pair', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      const durations = await helper.readTimings()

      expect(durations).toHaveLength(1)
      expect(durations[0]).toBe(1_000_000)
    })

    it('should handle maximum capacity', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice, 2)
      helper.initialize()

      // Fill to capacity
      helper.beginTimestamp()
      helper.beginTimestamp()

      expect(helper.getRecordedPairCount()).toBe(2)
    })

    it('should return durations for all recorded pairs', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      // Record 2 pairs (the modern API uses beginTimestamp to allocate pairs)
      helper.beginTimestamp()
      helper.beginTimestamp()

      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)
      const durations = await helper.readTimings()

      // Returns durations for all pairs
      expect(durations).toHaveLength(2)
    })

    it('should work after reset and new recording', async () => {
      const helper = new TimingHelper(mockDevice as unknown as GPUDevice)
      helper.initialize()

      // First measurement
      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      // Reset for next frame
      helper.reset()

      // Second measurement
      helper.beginTimestamp()
      helper.resolveTimestamps(mockEncoder as unknown as GPUCommandEncoder)

      const durations = await helper.readTimings()

      expect(durations).toHaveLength(1)
    })
  })
})

// ============================================================================
// createTimingHelper Factory Tests
// ============================================================================

describe('createTimingHelper', () => {
  it('creates TimingHelper instance', () => {
    const helper = createTimingHelper(mockDevice as unknown as GPUDevice)
    expect(helper).toBeInstanceOf(TimingHelper)
  })

  it('uses default capacity', () => {
    const helper = createTimingHelper(mockDevice as unknown as GPUDevice)
    expect(helper.getCapacity()).toBe(16)
  })

  it('accepts custom capacity', () => {
    const helper = createTimingHelper(mockDevice as unknown as GPUDevice, 32)
    expect(helper.getCapacity()).toBe(32)
  })
})
