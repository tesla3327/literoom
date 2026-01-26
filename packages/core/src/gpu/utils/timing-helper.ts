/// <reference types="@webgpu/types" />
/**
 * GPU timestamp profiling using WebGPU timestamp queries.
 *
 * Provides precise GPU-side timing measurements for performance analysis
 * of shader execution and GPU operations.
 *
 * Note: Timestamp queries require the 'timestamp-query' feature to be
 * enabled when requesting the GPU device. Not all browsers/devices support this.
 *
 * @example
 * ```typescript
 * const timer = new TimingHelper(device, 16)
 * if (timer.initialize()) {
 *   // For render/compute passes, use timestampWrites:
 *   const timestampWrites = timer.getTimestampWrites(0)
 *   const pass = encoder.beginComputePass({ timestampWrites })
 *   // ... GPU operations ...
 *   pass.end()
 *
 *   timer.resolveTimestamps(encoder)
 *   device.queue.submit([encoder.finish()])
 *
 *   const timings = await timer.readTimings()
 *   console.log(`GPU time: ${timings[0] / 1_000_000}ms`)
 *
 *   timer.reset()
 * }
 * ```
 */

/**
 * Default capacity for timestamp pairs per frame.
 * Each measurement requires 2 timestamps (begin + end).
 */
const DEFAULT_CAPACITY = 16

/**
 * Size of a single timestamp value in bytes (BigInt64 = 8 bytes).
 */
const TIMESTAMP_SIZE_BYTES = 8

/**
 * Timestamp writes descriptor for render/compute passes.
 * This is the modern WebGPU API for capturing GPU timestamps.
 */
export interface TimestampWritesDescriptor {
  querySet: GPUQuerySet
  beginningOfPassWriteIndex: number
  endOfPassWriteIndex: number
}

/**
 * Helper class for GPU timestamp profiling using WebGPU timestamp queries.
 *
 * This class manages the lifecycle of timestamp queries, including:
 * - Feature detection for timestamp-query support
 * - Query set and buffer management
 * - Timestamp resolution and readback
 * - Duration calculation in nanoseconds
 *
 * Modern WebGPU uses `timestampWrites` on render/compute pass descriptors
 * rather than explicit timestamp commands. Use `getTimestampWrites()` to
 * get the descriptor to pass to your passes.
 */
export class TimingHelper {
  /** The GPU device for creating resources */
  private device: GPUDevice

  /** Query set for storing timestamps */
  private querySet: GPUQuerySet | null = null

  /**
   * Buffer for resolving timestamps from the query set.
   * Cannot have MAP_READ usage, so we need a separate result buffer.
   */
  private resolveBuffer: GPUBuffer | null = null

  /**
   * Buffer for reading timestamp results back to CPU.
   * Has MAP_READ usage for async readback.
   */
  private resultBuffer: GPUBuffer | null = null

  /** Maximum number of timestamp pairs (begin + end) per frame */
  private capacity: number

  /** Current timestamp pair index for tracking usage */
  private currentPairIndex = 0

  /** Whether the helper has been initialized */
  private _initialized = false

  /** Whether the result buffer is currently mapped */
  private _isResultBufferMapped = false

  /**
   * Create a new TimingHelper instance.
   *
   * @param device - The GPU device to use for timing queries
   * @param capacity - Maximum number of timestamp pairs per frame (default: 16)
   */
  constructor(device: GPUDevice, capacity: number = DEFAULT_CAPACITY) {
    this.device = device
    this.capacity = capacity
  }

  /**
   * Check if timestamp queries are supported by the device.
   *
   * Timestamp queries require the 'timestamp-query' feature to be enabled
   * when the device was created.
   *
   * @returns true if timestamp queries are supported
   */
  isSupported(): boolean {
    return this.device.features.has('timestamp-query')
  }

  /**
   * Initialize the query set and buffers for timestamp collection.
   *
   * Must be called before using getTimestampWrites().
   * Will return false if timestamp queries are not supported.
   *
   * @returns true if initialization succeeded, false if not supported
   */
  initialize(): boolean {
    if (this._initialized) {
      return this.querySet !== null
    }

    this._initialized = true

    if (!this.isSupported()) {
      console.warn('[TimingHelper] timestamp-query feature not supported')
      return false
    }

    try {
      // Total timestamps = capacity pairs * 2 (begin + end)
      const totalTimestamps = this.capacity * 2

      // Create query set for timestamps
      this.querySet = this.device.createQuerySet({
        label: 'TimingHelper Query Set',
        type: 'timestamp',
        count: totalTimestamps,
      })

      // Calculate buffer size (each timestamp is 8 bytes)
      const bufferSize = totalTimestamps * TIMESTAMP_SIZE_BYTES

      // Create resolve buffer (GPU-only, receives resolved timestamps)
      // Cannot have MAP_READ usage per WebGPU spec
      this.resolveBuffer = this.device.createBuffer({
        label: 'TimingHelper Resolve Buffer',
        size: bufferSize,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })

      // Create result buffer (can be mapped for CPU read)
      this.resultBuffer = this.device.createBuffer({
        label: 'TimingHelper Result Buffer',
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })

      return true
    } catch (error) {
      console.error('[TimingHelper] Failed to initialize:', error)
      this.cleanup()
      return false
    }
  }

  /**
   * Get timestamp writes descriptor for a render or compute pass.
   *
   * This is the modern WebGPU approach for capturing GPU timestamps.
   * Pass the returned descriptor to `encoder.beginRenderPass()` or
   * `encoder.beginComputePass()`.
   *
   * @param pairIndex - The timestamp pair index (0 to capacity-1)
   * @returns TimestampWritesDescriptor to pass to pass descriptor, or undefined if not supported
   * @throws Error if not initialized or pairIndex is out of range
   *
   * @example
   * ```typescript
   * const timestampWrites = timer.getTimestampWrites(0)
   * const pass = encoder.beginComputePass({ timestampWrites })
   * // ... dispatch compute work ...
   * pass.end()
   * ```
   */
  getTimestampWrites(pairIndex: number): TimestampWritesDescriptor | undefined {
    if (!this.querySet) {
      return undefined
    }

    if (pairIndex < 0 || pairIndex >= this.capacity) {
      throw new Error(
        `TimingHelper pair index ${pairIndex} out of range. Valid range: 0-${this.capacity - 1}`
      )
    }

    // Track the highest pair index used for resolving
    if (pairIndex >= this.currentPairIndex) {
      this.currentPairIndex = pairIndex + 1
    }

    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: pairIndex * 2,
      endOfPassWriteIndex: pairIndex * 2 + 1,
    }
  }

  /**
   * Begin a timing measurement and return the pair index.
   *
   * This is a convenience method that automatically assigns the next
   * available pair index. Use getTimestampWrites() with the returned
   * index to get the descriptor for your pass.
   *
   * @returns The pair index to use with getTimestampWrites()
   * @throws Error if not initialized or capacity exceeded
   */
  beginTimestamp(): number {
    if (!this.querySet) {
      throw new Error('TimingHelper not initialized. Call initialize() first.')
    }

    if (this.currentPairIndex >= this.capacity) {
      throw new Error(
        `TimingHelper capacity exceeded. Maximum ${this.capacity} timestamp pairs per frame.`
      )
    }

    const pairIndex = this.currentPairIndex
    this.currentPairIndex++

    return pairIndex
  }

  /**
   * End a timing measurement (no-op in modern API).
   *
   * In the modern WebGPU API, timestamps are automatically captured
   * at the beginning and end of passes via timestampWrites. This method
   * exists for API compatibility but doesn't need to do anything.
   *
   * @param _pairIndex - The pair index (unused in modern API)
   * @returns The pair index
   */
  endTimestamp(_pairIndex: number): number {
    // No-op in modern API - timestamps are captured via timestampWrites
    return _pairIndex
  }

  /**
   * Resolve timestamps to a buffer.
   *
   * Call this after all passes with timestampWrites have completed,
   * but before submitting the command buffer.
   *
   * @param encoder - The command encoder to add resolve commands to
   * @throws Error if not initialized
   */
  resolveTimestamps(encoder: GPUCommandEncoder): void {
    if (!this.querySet || !this.resolveBuffer || !this.resultBuffer) {
      throw new Error('TimingHelper not initialized. Call initialize() first.')
    }

    // Only resolve the timestamps we actually used
    const timestampCount = this.currentPairIndex * 2
    if (timestampCount === 0) {
      return
    }

    // Resolve timestamps from query set to resolve buffer
    encoder.resolveQuerySet(
      this.querySet,
      0,
      timestampCount,
      this.resolveBuffer,
      0
    )

    // Copy from resolve buffer to result buffer (which can be mapped)
    const byteCount = timestampCount * TIMESTAMP_SIZE_BYTES
    encoder.copyBufferToBuffer(
      this.resolveBuffer,
      0,
      this.resultBuffer,
      0,
      byteCount
    )
  }

  /**
   * Read timing results from the GPU.
   *
   * Returns durations in nanoseconds for each timestamp pair.
   * Must be called after the command buffer has been submitted and
   * the GPU has finished executing.
   *
   * @returns Array of durations in nanoseconds (one per timestamp pair)
   * @throws Error if not initialized or buffer mapping fails
   */
  async readTimings(): Promise<number[]> {
    if (!this.resultBuffer) {
      throw new Error('TimingHelper not initialized. Call initialize() first.')
    }

    const pairCount = this.currentPairIndex
    if (pairCount === 0) {
      return []
    }

    // Wait for any pending GPU work
    await this.device.queue.onSubmittedWorkDone()

    // Map the result buffer for reading
    if (this._isResultBufferMapped) {
      this.resultBuffer.unmap()
      this._isResultBufferMapped = false
    }

    try {
      await this.resultBuffer.mapAsync(GPUMapMode.READ)
      this._isResultBufferMapped = true

      // Read timestamps as BigInt64 (signed 64-bit integers)
      const timestampCount = pairCount * 2
      const byteCount = timestampCount * TIMESTAMP_SIZE_BYTES
      const mappedRange = this.resultBuffer.getMappedRange(0, byteCount)
      const timestamps = new BigInt64Array(mappedRange)

      // Calculate durations for each pair (end - begin)
      const durations: number[] = []

      for (let i = 0; i < pairCount; i++) {
        const beginTimestamp = timestamps[i * 2]!
        const endTimestamp = timestamps[i * 2 + 1]!

        // Convert BigInt to number (safe for nanosecond durations < ~9 petaseconds)
        const duration = Number(endTimestamp - beginTimestamp)
        durations.push(duration)
      }

      return durations
    } finally {
      // Unmap the buffer
      if (this._isResultBufferMapped) {
        this.resultBuffer.unmap()
        this._isResultBufferMapped = false
      }
    }
  }

  /**
   * Reset the timing helper for the next frame.
   *
   * Clears the timestamp pair counter. Call this at the beginning
   * of each frame before recording new timestamps.
   */
  reset(): void {
    this.currentPairIndex = 0
  }

  /**
   * Get the current number of recorded timestamp pairs.
   *
   * @returns Number of timestamp pairs recorded
   */
  getRecordedPairCount(): number {
    return this.currentPairIndex
  }

  /**
   * Get the maximum capacity of timestamp pairs.
   *
   * @returns Maximum number of timestamp pairs that can be recorded per frame
   */
  getCapacity(): number {
    return this.capacity
  }

  /**
   * Check if the helper is initialized and ready for use.
   *
   * @returns true if initialized and timestamp queries are available
   */
  isReady(): boolean {
    return this._initialized && this.querySet !== null
  }

  /**
   * Clean up internal resources.
   * Called internally on initialization failure.
   */
  private cleanup(): void {
    this.querySet?.destroy()
    this.resolveBuffer?.destroy()
    this.resultBuffer?.destroy()
    this.querySet = null
    this.resolveBuffer = null
    this.resultBuffer = null
  }

  /**
   * Destroy the timing helper and release all GPU resources.
   *
   * Call this when the timing helper is no longer needed.
   */
  destroy(): void {
    if (this._isResultBufferMapped && this.resultBuffer) {
      try {
        this.resultBuffer.unmap()
      } catch {
        // Ignore unmap errors on destroy
      }
      this._isResultBufferMapped = false
    }

    this.cleanup()
    this._initialized = false
    this.currentPairIndex = 0
  }
}

/**
 * Create a timing helper that gracefully handles unsupported devices.
 *
 * Returns a TimingHelper instance that will report as not supported
 * if timestamp queries are unavailable, allowing code to check support
 * before attempting to use timing features.
 *
 * @param device - The GPU device
 * @param capacity - Maximum timestamp pairs per frame
 * @returns TimingHelper instance (may not be functional if unsupported)
 */
export function createTimingHelper(
  device: GPUDevice,
  capacity: number = DEFAULT_CAPACITY
): TimingHelper {
  return new TimingHelper(device, capacity)
}
