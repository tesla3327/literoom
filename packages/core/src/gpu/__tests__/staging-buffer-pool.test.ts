/**
 * Unit tests for StagingBufferPool.
 *
 * Tests the staging buffer pool for async GPU readback operations including:
 * - Pool initialization and pre-allocation
 * - Buffer acquisition and release
 * - Async readback with fire-and-forget pattern
 * - Resource cleanup and destruction
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StagingBufferPool } from '../utils/staging-buffer-pool'

// ============================================================================
// Mock WebGPU API
// ============================================================================

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

// ============================================================================
// Mock Types and Factories
// ============================================================================

interface MockGPUBuffer {
  label?: string
  size?: number
  usage?: number
  mapState: 'unmapped' | 'pending' | 'mapped'
  mapAsync: ReturnType<typeof vi.fn>
  getMappedRange: ReturnType<typeof vi.fn>
  unmap: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

interface MockGPUCommandEncoder {
  copyBufferToBuffer: ReturnType<typeof vi.fn>
  finish: ReturnType<typeof vi.fn>
}

interface MockGPUDevice {
  createBuffer: ReturnType<typeof vi.fn>
  createCommandEncoder: ReturnType<typeof vi.fn>
  queue: {
    submit: ReturnType<typeof vi.fn>
  }
}

let mockDevice: MockGPUDevice
let createdBuffers: MockGPUBuffer[]
let defaultMockData: ArrayBuffer

function createMockBuffer(descriptor: {
  label?: string
  size: number
  usage: number
}): MockGPUBuffer {
  const buffer: MockGPUBuffer = {
    label: descriptor.label,
    size: descriptor.size,
    usage: descriptor.usage,
    mapState: 'unmapped',
    mapAsync: vi.fn().mockImplementation(async () => {
      buffer.mapState = 'mapped'
    }),
    getMappedRange: vi.fn(() => defaultMockData),
    unmap: vi.fn().mockImplementation(() => {
      buffer.mapState = 'unmapped'
    }),
    destroy: vi.fn(),
  }
  createdBuffers.push(buffer)
  return buffer
}

function createMockCommandEncoder(): MockGPUCommandEncoder {
  return {
    copyBufferToBuffer: vi.fn(),
    finish: vi.fn(() => ({})),
  }
}

function createMockDevice(): MockGPUDevice {
  createdBuffers = []
  defaultMockData = new Uint32Array([1, 2, 3, 4]).buffer

  return {
    createBuffer: vi.fn(createMockBuffer),
    createCommandEncoder: vi.fn(createMockCommandEncoder),
    queue: {
      submit: vi.fn(),
    },
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
// StagingBufferPool Tests
// ============================================================================

describe('StagingBufferPool', () => {
  describe('initialization', () => {
    it('should pre-allocate buffers on construction', () => {
      new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(3)
    })

    it('should use default pool size of 3', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      const stats = pool.getStats()
      expect(stats.poolSize).toBe(3)
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(3)
    })

    it('should accept custom pool size', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        5
      )

      const stats = pool.getStats()
      expect(stats.poolSize).toBe(5)
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(5)
    })

    it('should create buffers with correct size', () => {
      const bufferSize = 8192
      new StagingBufferPool(mockDevice as unknown as GPUDevice, bufferSize)

      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          size: bufferSize,
        })
      )
    })

    it('should create buffers with COPY_DST and MAP_READ usage', () => {
      new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        })
      )
    })

    it('should label buffers with pool entry index', () => {
      new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Staging Buffer Pool [0]',
        })
      )
      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Staging Buffer Pool [1]',
        })
      )
      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Staging Buffer Pool [2]',
        })
      )
    })

    it('should start with all buffers available', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      const stats = pool.getStats()
      expect(stats.available).toBe(3)
      expect(stats.inFlight).toBe(0)
    })
  })

  describe('acquire', () => {
    it('should return buffer when available', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      const buffer = pool.acquire()

      expect(buffer).not.toBeNull()
      expect(buffer).toBe(createdBuffers[2]) // Last created is first in available array
    })

    it('should return null when pool exhausted', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      // Acquire all 3 buffers
      pool.acquire()
      pool.acquire()
      pool.acquire()

      // Fourth acquire should return null
      const buffer = pool.acquire()
      expect(buffer).toBeNull()
    })

    it('should check mapState before returning buffer', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      // Set all buffers to non-unmapped state
      createdBuffers.forEach((buffer) => {
        buffer.mapState = 'pending'
      })

      const buffer = pool.acquire()
      expect(buffer).toBeNull()
    })

    it('should remove buffer from available pool', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      const statsBefore = pool.getStats()
      expect(statsBefore.available).toBe(3)

      pool.acquire()

      const statsAfter = pool.getStats()
      expect(statsAfter.available).toBe(2)
      expect(statsAfter.inFlight).toBe(1)
    })

    it('should track acquired buffers as inFlight', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      pool.acquire()
      pool.acquire()

      const stats = pool.getStats()
      expect(stats.inFlight).toBe(2)
      expect(stats.available).toBe(1)
    })
  })

  describe('readbackAsync', () => {
    it('should copy source buffer to staging buffer', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {}
      )

      expect(mockEncoder.copyBufferToBuffer).toHaveBeenCalledWith(
        sourceBuffer,
        0,
        expect.anything(), // staging buffer
        0,
        4096
      )
    })

    it('should call onComplete with data after map', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer
      const onComplete = vi.fn()

      // Set up specific mock data
      const testData = new Uint32Array([10, 20, 30, 40])
      defaultMockData = testData.buffer

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        onComplete
      )

      // Wait for async operations to complete
      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalled()
      })

      const receivedData = onComplete.mock.calls[0]![0] as Uint32Array
      expect(receivedData).toBeInstanceOf(Uint32Array)
    })

    it('should return buffer to pool after readback', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer

      const statsBefore = pool.getStats()
      expect(statsBefore.available).toBe(3)

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {}
      )

      // Wait for async completion
      await vi.waitFor(() => {
        const stats = pool.getStats()
        expect(stats.available).toBe(3)
        expect(stats.inFlight).toBe(0)
      })
    })

    it('should skip readback if pool exhausted', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const sourceBuffer = { size: 4096 } as GPUBuffer

      // Exhaust the pool by acquiring all buffers
      pool.acquire()
      pool.acquire()
      pool.acquire()

      // This readback should be skipped
      const mockEncoder = createMockCommandEncoder()
      const onComplete = vi.fn()

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        onComplete
      )

      // Copy should not have been called
      expect(mockEncoder.copyBufferToBuffer).not.toHaveBeenCalled()
      // Callback should not have been called
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('should unmap buffer after reading data', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {}
      )

      await vi.waitFor(() => {
        // At least one buffer should have been unmapped
        const unmappedBuffer = createdBuffers.find((b) => b.unmap.mock.calls.length > 0)
        expect(unmappedBuffer).toBeDefined()
      })
    })

    it('should handle multiple sequential readbacks', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const sourceBuffer = { size: 4096 } as GPUBuffer
      const results: number[] = []

      for (let i = 0; i < 5; i++) {
        const mockEncoder = createMockCommandEncoder()
        const index = i
        await pool.readbackAsync(
          mockEncoder as unknown as GPUCommandEncoder,
          sourceBuffer,
          () => {
            results.push(index)
          }
        )
      }

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(results.length).toBe(5)
        },
        { timeout: 1000 }
      )
    })
  })

  describe('getStats', () => {
    it('should return correct pool statistics', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        5
      )

      const stats = pool.getStats()

      expect(stats.poolSize).toBe(5)
      expect(stats.available).toBe(5)
      expect(stats.inFlight).toBe(0)
    })

    it('should update stats when buffers are acquired', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      pool.acquire()
      pool.acquire()

      const stats = pool.getStats()
      expect(stats.available).toBe(1)
      expect(stats.inFlight).toBe(2)
      expect(stats.poolSize).toBe(3)
    })
  })

  describe('clear', () => {
    it('should destroy all buffers', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      pool.clear()

      createdBuffers.forEach((buffer) => {
        expect(buffer.destroy).toHaveBeenCalled()
      })
    })

    it('should empty the available pool', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      pool.clear()

      const stats = pool.getStats()
      expect(stats.available).toBe(0)
      expect(stats.inFlight).toBe(0)
    })

    it('should destroy in-flight buffers', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      // Acquire some buffers (makes them in-flight)
      pool.acquire()
      pool.acquire()

      const statsBefore = pool.getStats()
      expect(statsBefore.inFlight).toBe(2)

      pool.clear()

      // All buffers should be destroyed
      createdBuffers.forEach((buffer) => {
        expect(buffer.destroy).toHaveBeenCalled()
      })

      const statsAfter = pool.getStats()
      expect(statsAfter.inFlight).toBe(0)
    })

    it('should be safe to call clear multiple times', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)

      pool.clear()
      pool.clear()

      const stats = pool.getStats()
      expect(stats.available).toBe(0)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  describe('pool exhaustion behavior', () => {
    it('should return null consistently when exhausted', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        2
      )

      pool.acquire()
      pool.acquire()

      expect(pool.acquire()).toBeNull()
      expect(pool.acquire()).toBeNull()
      expect(pool.acquire()).toBeNull()
    })

    it('should allow re-acquisition after buffers are released', async () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        1
      )
      const sourceBuffer = { size: 4096 } as GPUBuffer

      // Do a readback which will acquire and then release the buffer
      const mockEncoder = createMockCommandEncoder()
      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {}
      )

      // Wait for buffer to be released
      await vi.waitFor(() => {
        const stats = pool.getStats()
        expect(stats.available).toBe(1)
      })

      // Should be able to acquire again
      const buffer = pool.acquire()
      expect(buffer).not.toBeNull()
    })
  })

  describe('buffer state management', () => {
    it('should skip buffers in pending state during acquire', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        3
      )

      // Set first two buffers to pending state
      createdBuffers[0]!.mapState = 'pending'
      createdBuffers[1]!.mapState = 'pending'
      // Third buffer remains unmapped

      const buffer = pool.acquire()

      // Should get the unmapped buffer (last created, which is createdBuffers[2])
      expect(buffer).not.toBeNull()
      expect(buffer?.mapState).toBe('unmapped')
    })

    it('should skip buffers in mapped state during acquire', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        2
      )

      // Set first buffer to mapped state
      createdBuffers[0]!.mapState = 'mapped'
      // Second buffer remains unmapped

      const buffer = pool.acquire()

      expect(buffer).not.toBeNull()
    })
  })

  describe('async completion ordering', () => {
    it('should handle callbacks completing in different order', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const sourceBuffer = { size: 4096 } as GPUBuffer
      const completionOrder: number[] = []

      // Buffers are acquired from the end of the available array
      // So first readback gets createdBuffers[2], second gets createdBuffers[1]
      // We'll make the first buffer (createdBuffers[2]) complete slower

      let resolveFirst: (() => void) | null = null

      // Override mapAsync for buffer[2] (first to be acquired) to delay it
      createdBuffers[2]!.mapAsync = vi.fn().mockImplementation(() => {
        return new Promise<void>((resolve) => {
          resolveFirst = () => {
            createdBuffers[2]!.mapState = 'mapped'
            resolve()
          }
        })
      })

      // First readback (will use buffer[2], will be delayed)
      const encoder1 = createMockCommandEncoder()
      pool.readbackAsync(
        encoder1 as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => completionOrder.push(0)
      )

      // Second readback (will use buffer[1], will complete immediately)
      const encoder2 = createMockCommandEncoder()
      pool.readbackAsync(
        encoder2 as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => completionOrder.push(1)
      )

      // Wait for second to complete (it uses buffer[1] which completes immediately)
      await vi.waitFor(() => {
        expect(completionOrder).toContain(1)
      })

      // Now resolve first
      if (resolveFirst) {
        ;(resolveFirst as () => void)()
      }

      // Wait for first to complete
      await vi.waitFor(() => {
        expect(completionOrder.length).toBe(2)
      })

      // Second should have completed before first
      expect(completionOrder[0]).toBe(1)
      expect(completionOrder[1]).toBe(0)
    })

    it('should handle multiple concurrent readbacks', async () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const sourceBuffer = { size: 4096 } as GPUBuffer
      const results: number[] = []

      // Start 3 concurrent readbacks (pool size is 3)
      const promises = []
      for (let i = 0; i < 3; i++) {
        const encoder = createMockCommandEncoder()
        const index = i
        promises.push(
          pool.readbackAsync(
            encoder as unknown as GPUCommandEncoder,
            sourceBuffer,
            () => {
              results.push(index)
            }
          )
        )
      }

      await Promise.all(promises)

      // Wait for all to complete
      await vi.waitFor(() => {
        expect(results.length).toBe(3)
      })

      expect(results).toContain(0)
      expect(results).toContain(1)
      expect(results).toContain(2)
    })
  })

  describe('single buffer pool', () => {
    it('should work with pool size of 1', async () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        1
      )

      expect(pool.getStats().poolSize).toBe(1)

      const buffer = pool.acquire()
      expect(buffer).not.toBeNull()

      // Second acquire should fail
      expect(pool.acquire()).toBeNull()
    })

    it('should handle sequential readbacks with single buffer', async () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        1
      )
      const sourceBuffer = { size: 4096 } as GPUBuffer
      const results: number[] = []

      for (let i = 0; i < 3; i++) {
        const encoder = createMockCommandEncoder()
        const index = i
        await pool.readbackAsync(
          encoder as unknown as GPUCommandEncoder,
          sourceBuffer,
          () => results.push(index)
        )

        // Wait for completion before next iteration
        await vi.waitFor(() => {
          expect(results.length).toBe(i + 1)
        })
      }

      expect(results).toEqual([0, 1, 2])
    })
  })

  describe('large pool', () => {
    it('should work with large pool size', () => {
      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        10
      )

      expect(pool.getStats().poolSize).toBe(10)
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(10)

      // Should be able to acquire all 10
      for (let i = 0; i < 10; i++) {
        expect(pool.acquire()).not.toBeNull()
      }

      // 11th should fail
      expect(pool.acquire()).toBeNull()
    })
  })

  describe('zero-size buffer', () => {
    it('should handle zero buffer size', () => {
      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 0)

      expect(pool.getStats().poolSize).toBe(3)
      expect(mockDevice.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 0,
        })
      )
    })
  })

  describe('error handling', () => {
    it('should handle map failure gracefully', async () => {
      // Suppress console.warn for this test
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer

      // Make mapAsync fail for the buffer that will be acquired
      createdBuffers[2]!.mapAsync = vi.fn().mockRejectedValue(new Error('Map failed'))

      const onComplete = vi.fn()

      // Should not throw
      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        onComplete
      )

      // Wait a bit for error handling
      await new Promise((resolve) => setTimeout(resolve, 50))

      // onComplete should not be called on failure
      expect(onComplete).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    it('should create replacement buffer after error', async () => {
      // Suppress console.warn for this test
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const pool = new StagingBufferPool(
        mockDevice as unknown as GPUDevice,
        4096,
        1
      )
      const mockEncoder = createMockCommandEncoder()
      const sourceBuffer = { size: 4096 } as GPUBuffer

      // Make mapAsync fail
      createdBuffers[0]!.mapAsync = vi.fn().mockRejectedValue(new Error('Map failed'))

      await pool.readbackAsync(
        mockEncoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {}
      )

      // Wait for error handling
      await new Promise((resolve) => setTimeout(resolve, 50))

      // A replacement buffer should have been created
      // Original pool size was 1, but after error a replacement is created
      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(2)

      consoleWarnSpy.mockRestore()
    })
  })
})

// ============================================================================
// Integration-like Tests
// ============================================================================

describe('integration scenarios', () => {
  it('should support typical histogram readback workflow', async () => {
    // Histogram data: 4 channels x 256 bins x 4 bytes = 4096 bytes
    const bufferSize = 4096
    const pool = new StagingBufferPool(
      mockDevice as unknown as GPUDevice,
      bufferSize
    )

    const histogramSourceBuffer = { size: bufferSize } as GPUBuffer
    const mockEncoder = createMockCommandEncoder()

    // Set up mock histogram data
    const histogramData = new Uint32Array(1024) // 4 * 256
    histogramData[128] = 1000 // Red bin 128
    histogramData[256 + 64] = 500 // Green bin 64
    defaultMockData = histogramData.buffer

    let receivedData: Uint32Array | null = null

    await pool.readbackAsync(
      mockEncoder as unknown as GPUCommandEncoder,
      histogramSourceBuffer,
      (data) => {
        receivedData = data
      }
    )

    await vi.waitFor(() => {
      expect(receivedData).not.toBeNull()
    })

    // Verify we got the histogram data
    expect(receivedData!.length).toBe(1024)
  })

  it('should support rapid consecutive readbacks', async () => {
    const pool = new StagingBufferPool(mockDevice as unknown as GPUDevice, 4096)
    const sourceBuffer = { size: 4096 } as GPUBuffer
    const completedCount = { value: 0 }

    // Fire 10 rapid readbacks
    for (let i = 0; i < 10; i++) {
      const encoder = createMockCommandEncoder()
      await pool.readbackAsync(
        encoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {
          completedCount.value++
        }
      )
    }

    // Wait for all to complete
    await vi.waitFor(
      () => {
        expect(completedCount.value).toBe(10)
      },
      { timeout: 1000 }
    )
  })

  it('should handle pool exhaustion during rapid fire', async () => {
    // Small pool to force exhaustion
    const pool = new StagingBufferPool(
      mockDevice as unknown as GPUDevice,
      4096,
      2
    )
    const sourceBuffer = { size: 4096 } as GPUBuffer

    // Make mapAsync very slow so buffers stay in-flight
    let resolvers: (() => void)[] = []
    createdBuffers.forEach((buffer) => {
      buffer.mapAsync = vi.fn().mockImplementation(() => {
        return new Promise<void>((resolve) => {
          resolvers.push(() => {
            buffer.mapState = 'mapped'
            resolve()
          })
        })
      })
    })

    const completedCount = { value: 0 }
    const skippedCount = { value: 0 }

    // Track which readbacks were skipped
    const originalAcquire = pool.acquire.bind(pool) as () => ReturnType<typeof pool.acquire>
    pool.acquire = () => {
      const result = originalAcquire()
      if (result === null) {
        skippedCount.value++
      }
      return result
    }

    // Fire 5 rapid readbacks (only 2 buffers available)
    for (let i = 0; i < 5; i++) {
      const encoder = createMockCommandEncoder()
      await pool.readbackAsync(
        encoder as unknown as GPUCommandEncoder,
        sourceBuffer,
        () => {
          completedCount.value++
        }
      )
    }

    // Some readbacks should have been skipped due to pool exhaustion
    expect(skippedCount.value).toBeGreaterThan(0)

    // Resolve all pending mapAsync calls
    resolvers.forEach((resolve) => resolve())

    // Wait for completed ones to finish
    await vi.waitFor(() => {
      expect(completedCount.value).toBe(2) // Only 2 buffers, so only 2 complete
    })
  })
})
