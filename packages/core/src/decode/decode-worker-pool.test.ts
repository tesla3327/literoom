/**
 * Unit tests for DecodeWorkerPool.
 *
 * Tests cover:
 * - Pool creation with different worker counts
 * - Load balancing across workers
 * - Request/response correlation across workers
 * - Parallel processing capability
 * - Service lifecycle (destroy)
 *
 * Note: DecodeWorkerPool uses Web Workers which require browser environment.
 * These tests mock the Worker to test the pool logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DecodeWorkerPool } from './decode-worker-pool'
import { DecodeError, type Adjustments, type FilterType } from './types'

// ============================================================================
// Mock Worker
// ============================================================================

type MessageHandler = (event: MessageEvent) => void
type ErrorHandler = (event: ErrorEvent) => void

interface MockWorkerInstance {
  index: number
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
  onmessage: MessageHandler | null
  onerror: ErrorHandler | null
}

let mockWorkerInstances: MockWorkerInstance[] = []
let workerIndex = 0

// Mock Worker class
class MockWorker {
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage: MessageHandler | null = null
  onerror: ErrorHandler | null = null
  index: number

  constructor(_url: URL | string, _options?: WorkerOptions) {
    this.index = workerIndex++
    mockWorkerInstances.push(this as MockWorkerInstance)
  }
}

// Mock the global Worker
vi.stubGlobal('Worker', MockWorker)

// Helper to simulate worker responses
function simulateWorkerResponse(workerIdx: number, response: Record<string, unknown>): void {
  const worker = mockWorkerInstances[workerIdx]
  if (worker?.onmessage) {
    worker.onmessage({ data: response } as MessageEvent)
  }
}

// Helper to get last request sent to a worker
function getLastRequest(workerIdx: number): Record<string, unknown> | undefined {
  const worker = mockWorkerInstances[workerIdx]
  if (!worker) return undefined
  const calls = worker.postMessage.mock.calls
  if (calls.length === 0) return undefined
  return calls[calls.length - 1][0]
}

// ============================================================================
// Tests
// ============================================================================

describe('DecodeWorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkerInstances = []
    workerIndex = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create', () => {
    it('creates pool with default worker count', async () => {
      // Mock navigator.hardwareConcurrency
      vi.stubGlobal('navigator', { hardwareConcurrency: 4 })

      const poolPromise = DecodeWorkerPool.create()
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      expect(pool.state.status).toBe('ready')
      expect(pool.isReady).toBe(true)
      expect(pool.poolSize).toBe(4)
      expect(mockWorkerInstances.length).toBe(4)

      pool.destroy()
    })

    it('creates pool with specified worker count', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      expect(pool.poolSize).toBe(2)
      expect(mockWorkerInstances.length).toBe(2)

      pool.destroy()
    })

    it('caps worker count at MAX_WORKERS (8)', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 16 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      expect(pool.poolSize).toBe(8)

      pool.destroy()
    })

    it('sets up message handlers for all workers', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 3 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      for (const worker of mockWorkerInstances) {
        expect(worker.onmessage).not.toBeNull()
        expect(worker.onerror).not.toBeNull()
      }

      pool.destroy()
    })
  })

  describe('state', () => {
    it('returns current state', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      expect(pool.state).toEqual({ status: 'ready' })

      pool.destroy()
    })

    it('returns error state after destroy', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      pool.destroy()

      expect(pool.state.status).toBe('error')
      expect(pool.state.error).toBe('Service destroyed')
    })
  })

  describe('load balancing', () => {
    it('distributes requests across workers', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      // Send first request - should go to worker 0 (both have load 0)
      const bytes1 = new Uint8Array([0xff, 0xd8])
      const promise1 = pool.decodeJpeg(bytes1)

      // Worker 0 now has load 1, worker 1 has load 0
      // Second request should go to worker 1
      const bytes2 = new Uint8Array([0xff, 0xd8, 0xff])
      const promise2 = pool.decodeJpeg(bytes2)

      // Verify both workers received requests
      expect(mockWorkerInstances[0].postMessage).toHaveBeenCalled()
      expect(mockWorkerInstances[1].postMessage).toHaveBeenCalled()

      pool.destroy()

      // Catch expected rejections from destroy
      await expect(promise1).rejects.toThrow('destroyed')
      await expect(promise2).rejects.toThrow('destroyed')
    })

    it('routes to least busy worker', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 3 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      // Send 3 requests to fill all workers equally
      const p0 = pool.decodeJpeg(new Uint8Array([0xff]))
      const p1 = pool.decodeJpeg(new Uint8Array([0xff]))
      const p2 = pool.decodeJpeg(new Uint8Array([0xff]))

      // Complete request on worker 1
      const request1 = getLastRequest(1)
      if (request1?.id) {
        simulateWorkerResponse(1, {
          id: request1.id,
          type: 'success',
          width: 100,
          height: 100,
          pixels: new Uint8Array(100 * 100 * 3),
        })
      }

      // Next request should go to worker 1 (now has lower load)
      const p3 = pool.decodeJpeg(new Uint8Array([0xff]))

      // Worker 1 should have received 2 requests total
      expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledTimes(2)

      pool.destroy()

      // Catch expected rejections from destroy (p1 already resolved)
      await expect(p0).rejects.toThrow('destroyed')
      await expect(p2).rejects.toThrow('destroyed')
      await expect(p3).rejects.toThrow('destroyed')
    })
  })

  describe('decodeJpeg', () => {
    it('sends request and receives response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = pool.decodeJpeg(bytes)

      // Find which worker received the request
      const workerIdx = mockWorkerInstances[0].postMessage.mock.calls.length > 0 ? 0 : 1
      const request = getLastRequest(workerIdx)

      simulateWorkerResponse(workerIdx, {
        id: request?.id,
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise
      expect(result.width).toBe(100)
      expect(result.height).toBe(100)

      pool.destroy()
    })

    it('handles error response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.decodeJpeg(new Uint8Array([0x00]))
      const request = getLastRequest(0)

      simulateWorkerResponse(0, {
        id: request?.id,
        type: 'error',
        message: 'Invalid JPEG',
        code: 'INVALID_FORMAT',
      })

      await expect(promise).rejects.toThrow(DecodeError)

      pool.destroy()
    })

    it('times out after 30 seconds', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.decodeJpeg(new Uint8Array([0xff]))

      vi.advanceTimersByTime(31000)

      await expect(promise).rejects.toThrow('timed out')

      pool.destroy()
    })
  })

  describe('parallel processing', () => {
    it('processes multiple requests in parallel', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 4 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      // Send 4 requests simultaneously
      const promises = [
        pool.decodeJpeg(new Uint8Array([0xff])),
        pool.decodeJpeg(new Uint8Array([0xff])),
        pool.decodeJpeg(new Uint8Array([0xff])),
        pool.decodeJpeg(new Uint8Array([0xff])),
      ]

      // Each worker should have received 1 request
      expect(mockWorkerInstances[0].postMessage).toHaveBeenCalledTimes(1)
      expect(mockWorkerInstances[1].postMessage).toHaveBeenCalledTimes(1)
      expect(mockWorkerInstances[2].postMessage).toHaveBeenCalledTimes(1)
      expect(mockWorkerInstances[3].postMessage).toHaveBeenCalledTimes(1)

      // Respond to all
      for (let i = 0; i < 4; i++) {
        const request = getLastRequest(i)
        simulateWorkerResponse(i, {
          id: request?.id,
          type: 'success',
          width: 100 + i,
          height: 100,
          pixels: new Uint8Array(100 * 100 * 3),
        })
      }

      const results = await Promise.all(promises)

      // Verify all completed
      expect(results).toHaveLength(4)
      // Results may be in different order due to load balancing
      const widths = results.map((r) => r.width).sort()
      expect(widths).toEqual([100, 101, 102, 103])

      pool.destroy()
    })
  })

  describe('generateThumbnail', () => {
    it('sends generate-thumbnail request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = pool.generateThumbnail(bytes, { size: 512 })

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'generate-thumbnail',
        size: 512,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })

    it('uses default size of 256', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.generateThumbnail(new Uint8Array([0xff, 0xd8]))

      const request = getLastRequest(0)
      expect(request?.size).toBe(256)

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('generatePreview', () => {
    it('sends generate-preview request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.generatePreview(new Uint8Array([0xff]), {
        maxEdge: 2560,
        filter: 'lanczos3' as FilterType,
      })

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'generate-preview',
        maxEdge: 2560,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('detectFileType', () => {
    it('handles file-type response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.detectFileType(new Uint8Array([0xff, 0xd8]))

      const request = getLastRequest(0)
      simulateWorkerResponse(0, {
        id: request?.id,
        type: 'file-type',
        fileType: 'jpeg',
      })

      const result = await promise
      expect(result).toBe('jpeg')

      pool.destroy()
    })
  })

  describe('applyAdjustments', () => {
    it('sends apply-adjustments request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const adjustments: Adjustments = {
        exposure: 1,
        contrast: 0,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vibrance: 0,
        saturation: 0,
      }

      const promise = pool.applyAdjustments(pixels, 100, 100, adjustments)

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'apply-adjustments',
        width: 100,
        height: 100,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('computeHistogram', () => {
    it('handles histogram response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.computeHistogram(new Uint8Array(100 * 100 * 3), 100, 100)

      const request = getLastRequest(0)
      simulateWorkerResponse(0, {
        id: request?.id,
        type: 'histogram',
        red: new Uint32Array(256),
        green: new Uint32Array(256),
        blue: new Uint32Array(256),
        luminance: new Uint32Array(256),
        maxValue: 5000,
        hasHighlightClipping: true,
        hasShadowClipping: false,
      })

      const result = await promise
      expect(result.maxValue).toBe(5000)
      expect(result.hasHighlightClipping).toBe(true)

      pool.destroy()
    })
  })

  describe('applyToneCurve', () => {
    it('handles tone-curve-result response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]
      const promise = pool.applyToneCurve(new Uint8Array(100 * 100 * 3), 100, 100, points)

      const request = getLastRequest(0)
      simulateWorkerResponse(0, {
        id: request?.id,
        type: 'tone-curve-result',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise
      expect(result.width).toBe(100)

      pool.destroy()
    })
  })

  describe('applyRotation', () => {
    it('sends apply-rotation request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.applyRotation(new Uint8Array(100 * 100 * 3), 100, 100, 45, true)

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'apply-rotation',
        angleDegrees: 45,
        useLanczos: true,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('applyCrop', () => {
    it('sends apply-crop request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const crop = { left: 0.1, top: 0.2, width: 0.7, height: 0.6 }
      const promise = pool.applyCrop(new Uint8Array(100 * 100 * 3), 100, 100, crop)

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'apply-crop',
        left: 0.1,
        top: 0.2,
        cropWidth: 0.7,
        cropHeight: 0.6,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('encodeJpeg', () => {
    it('handles encode-jpeg-result response', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.encodeJpeg(new Uint8Array(100 * 100 * 3), 100, 100, 85)

      const request = getLastRequest(0)
      simulateWorkerResponse(0, {
        id: request?.id,
        type: 'encode-jpeg-result',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      })

      const result = await promise
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)

      pool.destroy()
    })

    it('uses default quality of 90', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise = pool.encodeJpeg(new Uint8Array(100 * 100 * 3), 100, 100)

      const request = getLastRequest(0)
      expect(request?.quality).toBe(90)

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('applyMaskedAdjustments', () => {
    it('sends apply-masked-adjustments request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const maskStack = {
        linearMasks: [],
        radialMasks: [],
      }

      const promise = pool.applyMaskedAdjustments(new Uint8Array(100 * 100 * 3), 100, 100, maskStack)

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'apply-masked-adjustments',
        maskStack,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('generateEditedThumbnail', () => {
    it('sends generate-edited-thumbnail request', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const editState = {
        adjustments: {
          exposure: 1,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }

      const promise = pool.generateEditedThumbnail(new Uint8Array([0xff, 0xd8]), 512, editState)

      const request = getLastRequest(0)
      expect(request).toMatchObject({
        type: 'generate-edited-thumbnail',
        size: 512,
      })

      pool.destroy()
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('destroy', () => {
    it('terminates all workers', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 3 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      pool.destroy()

      for (const worker of mockWorkerInstances) {
        expect(worker.terminate).toHaveBeenCalled()
      }
    })

    it('rejects all pending requests', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      const promise1 = pool.decodeJpeg(new Uint8Array([0xff]))
      const promise2 = pool.decodeJpeg(new Uint8Array([0xff]))

      pool.destroy()

      await expect(promise1).rejects.toThrow('destroyed')
      await expect(promise2).rejects.toThrow('destroyed')
    })

    it('clears workers array and load tracking', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      pool.destroy()

      expect(pool.poolSize).toBe(0)
    })

    it('sets state to error', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 2 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      pool.destroy()

      expect(pool.state.status).toBe('error')
      expect(pool.state.error).toBe('Service destroyed')
      expect(pool.isReady).toBe(false)
    })

    it('rejects new requests after destroy', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      pool.destroy()

      await expect(pool.decodeJpeg(new Uint8Array([]))).rejects.toThrow(
        'not ready'
      )
    })
  })

  describe('error handling', () => {
    it('handles unknown response IDs gracefully', async () => {
      const poolPromise = DecodeWorkerPool.create({ workerCount: 1 })
      await vi.runAllTimersAsync()
      const pool = await poolPromise

      // Simulate response with unknown ID
      simulateWorkerResponse(0, {
        id: 'unknown-id',
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      // Should not throw
      expect(pool.isReady).toBe(true)

      pool.destroy()
    })
  })
})
