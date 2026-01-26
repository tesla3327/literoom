/// <reference types="@webgpu/types" />
/**
 * Staging buffer pool for triple-buffered GPU readback operations.
 *
 * Provides efficient async readback of GPU buffers without blocking the main thread.
 * Uses a fire-and-forget pattern where readback operations are queued and processed
 * asynchronously, with results delivered via callbacks.
 *
 * The pool pre-allocates a fixed number of staging buffers (default 3 for triple buffering)
 * to enable continuous GPU operations without waiting for previous readbacks to complete.
 */

/**
 * Statistics about the staging buffer pool state.
 */
export interface StagingBufferPoolStats {
  /** Number of buffers available for acquisition */
  available: number
  /** Number of buffers currently being read back */
  inFlight: number
  /** Total pool size (available + inFlight) */
  poolSize: number
}

/**
 * Pool of staging buffers for async GPU readback operations.
 *
 * Implements triple-buffering (by default) to allow continuous GPU operations
 * while previous readback operations complete asynchronously.
 *
 * @example
 * ```typescript
 * const pool = new StagingBufferPool(device, 4096, 3);
 *
 * // In render loop:
 * await pool.readbackAsync(encoder, sourceBuffer, (data) => {
 *   // Process histogram data
 *   updateHistogramDisplay(data);
 * });
 *
 * // When done:
 * pool.clear();
 * ```
 */
export class StagingBufferPool {
  /** The GPU device used to create buffers */
  private device: GPUDevice

  /** Size of each staging buffer in bytes */
  private bufferSize: number

  /** Buffers available for acquisition */
  private available: GPUBuffer[] = []

  /** Buffers currently in flight (being mapped or read) */
  private inFlight: Set<GPUBuffer> = new Set()

  /** Maximum number of buffers in the pool */
  private poolSize: number

  /** Default pool size for triple buffering */
  private static readonly DEFAULT_POOL_SIZE = 3

  /**
   * Create a new staging buffer pool.
   *
   * Pre-allocates all buffers immediately to avoid allocation overhead
   * during rendering.
   *
   * @param device - The GPU device to create buffers on
   * @param bufferSize - Size of each staging buffer in bytes
   * @param poolSize - Number of buffers to allocate (default: 3 for triple buffering)
   */
  constructor(device: GPUDevice, bufferSize: number, poolSize?: number) {
    this.device = device
    this.bufferSize = bufferSize
    this.poolSize = poolSize ?? StagingBufferPool.DEFAULT_POOL_SIZE

    // Pre-allocate all buffers
    for (let i = 0; i < this.poolSize; i++) {
      const buffer = this.createStagingBuffer(i)
      this.available.push(buffer)
    }
  }

  /**
   * Create a new staging buffer with MAP_READ capability.
   *
   * @param index - Buffer index for labeling
   * @returns A new staging buffer
   */
  private createStagingBuffer(index: number): GPUBuffer {
    return this.device.createBuffer({
      label: `Staging Buffer Pool [${index}]`,
      size: this.bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  }

  /**
   * Acquire a buffer from the pool for readback.
   *
   * Returns null if all buffers are currently in flight, indicating
   * that the caller should skip this readback and use previous data.
   *
   * Only returns buffers that are in the 'unmapped' state.
   *
   * @returns A staging buffer ready for use, or null if pool is exhausted
   */
  acquire(): GPUBuffer | null {
    // Find an available buffer that is unmapped
    for (let i = this.available.length - 1; i >= 0; i--) {
      const buffer = this.available[i]!
      // Check if buffer is ready to use (unmapped state)
      if (buffer.mapState === 'unmapped') {
        this.available.splice(i, 1)
        this.inFlight.add(buffer)
        return buffer
      }
    }

    // All buffers are either in flight or in pending/mapped state
    return null
  }

  /**
   * Return a buffer to the available pool after readback completes.
   *
   * @param buffer - The buffer to release
   */
  private release(buffer: GPUBuffer): void {
    this.inFlight.delete(buffer)
    this.available.push(buffer)
  }

  /**
   * Perform async readback with fire-and-forget pattern.
   *
   * Copies data from the source buffer to a staging buffer, then
   * asynchronously maps and reads the data. The callback is invoked
   * with the result when the readback completes.
   *
   * If the pool is exhausted (all buffers in flight), this method
   * returns immediately without performing the readback. The caller
   * should continue using previous data in this case.
   *
   * This method does not block - it queues the readback operation
   * and returns immediately after submitting the copy command.
   *
   * @param encoder - The command encoder to use for the copy operation
   * @param sourceBuffer - The GPU buffer to read from
   * @param onComplete - Callback invoked with the readback data
   * @returns Promise that resolves when the readback operation is queued
   *          (not when it completes). Returns immediately if pool exhausted.
   */
  async readbackAsync(
    encoder: GPUCommandEncoder,
    sourceBuffer: GPUBuffer,
    onComplete: (data: Uint32Array) => void
  ): Promise<void> {
    // Try to acquire a staging buffer
    const stagingBuffer = this.acquire()

    if (!stagingBuffer) {
      // Pool exhausted - skip this readback, caller uses previous data
      return
    }

    // Copy source buffer to staging buffer
    encoder.copyBufferToBuffer(
      sourceBuffer,
      0,
      stagingBuffer,
      0,
      this.bufferSize
    )

    // Fire-and-forget: start the async readback without blocking
    this.performReadback(stagingBuffer, onComplete)
  }

  /**
   * Perform the actual async readback operation.
   *
   * This method handles mapping the buffer, reading the data,
   * unmapping, and returning the buffer to the pool.
   *
   * @param stagingBuffer - The staging buffer containing copied data
   * @param onComplete - Callback to invoke with the read data
   */
  private async performReadback(
    stagingBuffer: GPUBuffer,
    onComplete: (data: Uint32Array) => void
  ): Promise<void> {
    try {
      // Wait for the GPU to finish and map the buffer
      await stagingBuffer.mapAsync(GPUMapMode.READ)

      // Read the data (make a copy since getMappedRange is only valid while mapped)
      const mappedRange = stagingBuffer.getMappedRange()
      const data = new Uint32Array(mappedRange).slice()

      // Unmap the buffer so it can be reused
      stagingBuffer.unmap()

      // Return buffer to pool
      this.release(stagingBuffer)

      // Invoke callback with the data
      onComplete(data)
    } catch (error) {
      // Handle errors (device lost, validation errors, etc.)
      // Return buffer to pool even on error to prevent pool exhaustion
      if (stagingBuffer.mapState === 'mapped') {
        try {
          stagingBuffer.unmap()
        } catch {
          // Ignore unmap errors
        }
      }

      // Only release if the buffer is still valid and not destroyed
      // If device is lost, the buffer may be in an invalid state
      if (this.inFlight.has(stagingBuffer)) {
        this.inFlight.delete(stagingBuffer)
        // Don't return to available pool if there was an error -
        // the buffer may be in an inconsistent state
        // Create a replacement buffer instead
        try {
          const replacement = this.createStagingBuffer(this.available.length)
          this.available.push(replacement)
        } catch {
          // Device may be lost - ignore creation errors
          // Pool size will be reduced, which is acceptable
        }
      }

      // Re-throw if this is a serious error (device lost)
      if (
        error instanceof Error &&
        error.message.includes('Device is lost')
      ) {
        throw error
      }

      // For other errors, just log and continue
      // The readback was skipped but the pool remains functional
      console.warn('Staging buffer readback failed:', error)
    }
  }

  /**
   * Get statistics about the current pool state.
   *
   * Useful for debugging and monitoring pool utilization.
   *
   * @returns Object containing available, in-flight, and total pool size
   */
  getStats(): StagingBufferPoolStats {
    return {
      available: this.available.length,
      inFlight: this.inFlight.size,
      poolSize: this.poolSize,
    }
  }

  /**
   * Clear and destroy all buffers in the pool.
   *
   * Should be called when the pool is no longer needed to free GPU resources.
   * After calling clear(), the pool should not be used again.
   */
  clear(): void {
    // Destroy all available buffers
    for (const buffer of this.available) {
      buffer.destroy()
    }
    this.available = []

    // Destroy all in-flight buffers
    // Note: destroying a buffer that's being mapped will cause the mapAsync to reject
    for (const buffer of this.inFlight) {
      buffer.destroy()
    }
    this.inFlight.clear()
  }
}
