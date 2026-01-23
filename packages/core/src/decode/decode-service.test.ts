/**
 * Unit tests for DecodeService.
 *
 * Tests cover:
 * - Service creation and state management
 * - Request/response correlation
 * - Timeout handling
 * - Service lifecycle (destroy)
 * - All decode operations (mocked worker responses)
 *
 * Note: DecodeService uses Web Workers which require browser environment.
 * These tests mock the Worker to test the service logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DecodeService, type IDecodeService } from './decode-service'
import { DecodeError, type Adjustments, type FilterType } from './types'
import type { MaskStackData } from './worker-messages'

// ============================================================================
// Mock Worker
// ============================================================================

// Track message handlers for the mock worker
type MessageHandler = (event: MessageEvent) => void
type ErrorHandler = (event: ErrorEvent) => void

let mockWorkerInstance: {
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
  onmessage: MessageHandler | null
  onerror: ErrorHandler | null
} | null = null

// Mock Worker class
class MockWorker {
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage: MessageHandler | null = null
  onerror: ErrorHandler | null = null

  constructor(_url: URL | string, _options?: WorkerOptions) {
    mockWorkerInstance = this
  }
}

// Mock the global Worker
vi.stubGlobal('Worker', MockWorker)

// Helper to simulate worker responses
function simulateWorkerResponse(response: Record<string, unknown>): void {
  if (mockWorkerInstance?.onmessage) {
    mockWorkerInstance.onmessage({ data: response } as MessageEvent)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('DecodeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkerInstance = null
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create', () => {
    it('creates service in ready state', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      expect(service.state.status).toBe('ready')
      expect(service.isReady).toBe(true)

      service.destroy()
    })

    it('sets up worker message handler', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      expect(mockWorkerInstance).not.toBeNull()
      expect(mockWorkerInstance?.onmessage).not.toBeNull()

      service.destroy()
    })

    it('sets up worker error handler', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      expect(mockWorkerInstance?.onerror).not.toBeNull()

      service.destroy()
    })
  })

  describe('state', () => {
    it('returns current state', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      expect(service.state).toEqual({ status: 'ready' })

      service.destroy()
    })
  })

  describe('isReady', () => {
    it('returns true when ready', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      expect(service.isReady).toBe(true)

      service.destroy()
    })

    it('returns false after destroy', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      service.destroy()

      expect(service.isReady).toBe(false)
    })
  })

  describe('decodeJpeg', () => {
    it('sends decode-jpeg request to worker', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = service.decodeJpeg(bytes)

      // Verify request was sent
      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'decode-jpeg',
          bytes,
        })
      )

      // Simulate response
      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise

      expect(result.width).toBe(100)
      expect(result.height).toBe(100)

      service.destroy()
    })

    it('handles error response', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0x00])
      const promise = service.decodeJpeg(bytes)

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'error',
        message: 'Invalid JPEG',
        code: 'INVALID_FORMAT',
      })

      await expect(promise).rejects.toThrow(DecodeError)
      await expect(promise).rejects.toThrow('Invalid JPEG')

      service.destroy()
    })

    it('times out after 30 seconds', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const promise = service.decodeJpeg(new Uint8Array([0xff, 0xd8]))

      // Fast-forward past timeout
      vi.advanceTimersByTime(31000)

      await expect(promise).rejects.toThrow(DecodeError)
      await expect(promise).rejects.toThrow('timed out')

      service.destroy()
    })
  })

  describe('decodeRawThumbnail', () => {
    it('sends decode-raw-thumbnail request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0x49, 0x49])
      const promise = service.decodeRawThumbnail(bytes)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'decode-raw-thumbnail',
          bytes,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 160,
        height: 120,
        pixels: new Uint8Array(160 * 120 * 3),
      })

      const result = await promise
      expect(result.width).toBe(160)

      service.destroy()
    })
  })

  describe('generateThumbnail', () => {
    it('sends generate-thumbnail request with default size', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = service.generateThumbnail(bytes)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'generate-thumbnail',
          bytes,
          size: 256,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 256,
        height: 256,
        pixels: new Uint8Array(256 * 256 * 3),
      })

      const result = await promise
      expect(result.width).toBe(256)

      service.destroy()
    })

    it('uses custom size option', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = service.generateThumbnail(bytes, { size: 512 })

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 512,
        })
      )

      service.destroy()

      // Catch expected rejection from destroy
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('generatePreview', () => {
    it('sends generate-preview request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = service.generatePreview(bytes, {
        maxEdge: 2560,
        filter: 'lanczos3' as FilterType,
      })

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'generate-preview',
          maxEdge: 2560,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 2560,
        height: 1440,
        pixels: new Uint8Array(2560 * 1440 * 3),
      })

      const result = await promise
      expect(result.width).toBe(2560)

      service.destroy()
    })
  })

  describe('detectFileType', () => {
    it('sends detect-file-type request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const promise = service.detectFileType(bytes)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'detect-file-type',
          bytes,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'file-type',
        fileType: 'jpeg',
      })

      const result = await promise
      expect(result).toBe('jpeg')

      service.destroy()
    })
  })

  describe('applyAdjustments', () => {
    it('sends apply-adjustments request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const adjustments: Adjustments = {
        exposure: 1,
        contrast: 10,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vibrance: 0,
        saturation: 0,
      }

      const promise = service.applyAdjustments(pixels, 100, 100, adjustments)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'apply-adjustments',
          width: 100,
          height: 100,
          adjustments,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise
      expect(result.width).toBe(100)

      service.destroy()
    })
  })

  describe('computeHistogram', () => {
    it('sends compute-histogram request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const promise = service.computeHistogram(pixels, 100, 100)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'compute-histogram',
          width: 100,
          height: 100,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'histogram',
        red: new Uint32Array(256),
        green: new Uint32Array(256),
        blue: new Uint32Array(256),
        luminance: new Uint32Array(256),
        maxValue: 1000,
        hasHighlightClipping: false,
        hasShadowClipping: false,
      })

      const result = await promise
      expect(result.maxValue).toBe(1000)
      expect(result.hasHighlightClipping).toBe(false)

      service.destroy()
    })
  })

  describe('applyToneCurve', () => {
    it('sends apply-tone-curve request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const points = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ]

      const promise = service.applyToneCurve(pixels, 100, 100, points)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'apply-tone-curve',
          points,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'tone-curve-result',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise
      expect(result.width).toBe(100)

      service.destroy()
    })
  })

  describe('applyRotation', () => {
    it('sends apply-rotation request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const promise = service.applyRotation(pixels, 100, 100, 45)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'apply-rotation',
          angleDegrees: 45,
          useLanczos: false,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 142,
        height: 142,
        pixels: new Uint8Array(142 * 142 * 3),
      })

      const result = await promise
      expect(result.width).toBe(142)

      service.destroy()
    })

    it('supports Lanczos filter option', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const promise = service.applyRotation(pixels, 100, 100, 45, true)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          useLanczos: true,
        })
      )

      service.destroy()

      // Catch expected rejection from destroy
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('applyCrop', () => {
    it('sends apply-crop request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const crop = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 }
      const promise = service.applyCrop(pixels, 100, 100, crop)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'apply-crop',
          left: 0.1,
          top: 0.1,
          cropWidth: 0.8,
          cropHeight: 0.8,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 80,
        height: 80,
        pixels: new Uint8Array(80 * 80 * 3),
      })

      const result = await promise
      expect(result.width).toBe(80)

      service.destroy()
    })
  })

  describe('encodeJpeg', () => {
    it('sends encode-jpeg request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const promise = service.encodeJpeg(pixels, 100, 100, 85)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'encode-jpeg',
          width: 100,
          height: 100,
          quality: 85,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'encode-jpeg-result',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      })

      const result = await promise
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)

      service.destroy()
    })

    it('uses default quality of 90', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const promise = service.encodeJpeg(pixels, 100, 100)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          quality: 90,
        })
      )

      service.destroy()

      // Catch expected rejection from destroy
      await expect(promise).rejects.toThrow('destroyed')
    })
  })

  describe('applyMaskedAdjustments', () => {
    it('sends apply-masked-adjustments request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const pixels = new Uint8Array(100 * 100 * 3)
      const maskStack: MaskStackData = {
        linearMasks: [
          {
            startX: 0,
            startY: 0,
            endX: 1,
            endY: 1,
            feather: 0.5,
            enabled: true,
            adjustments: { exposure: 1 },
          },
        ],
        radialMasks: [],
      }

      const promise = service.applyMaskedAdjustments(pixels, 100, 100, maskStack)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'apply-masked-adjustments',
          maskStack,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      const result = await promise
      expect(result.width).toBe(100)

      service.destroy()
    })
  })

  describe('generateEditedThumbnail', () => {
    it('sends generate-edited-thumbnail request', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const editState = {
        adjustments: {
          exposure: 1,
          contrast: 10,
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

      const promise = service.generateEditedThumbnail(bytes, 512, editState)

      expect(mockWorkerInstance?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'generate-edited-thumbnail',
          size: 512,
          editState,
        })
      )

      const requestId = mockWorkerInstance?.postMessage.mock.calls[0][0].id
      simulateWorkerResponse({
        id: requestId,
        type: 'generate-edited-thumbnail-result',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      })

      const result = await promise
      expect(result[0]).toBe(0xff)

      service.destroy()
    })
  })

  describe('destroy', () => {
    it('terminates the worker', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      service.destroy()

      expect(mockWorkerInstance?.terminate).toHaveBeenCalled()
    })

    it('rejects pending requests', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      const bytes = new Uint8Array([0xff, 0xd8])
      const promise = service.decodeJpeg(bytes)

      service.destroy()

      await expect(promise).rejects.toThrow(DecodeError)
      await expect(promise).rejects.toThrow('destroyed')
    })

    it('sets state to error', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      service.destroy()

      expect(service.state.status).toBe('error')
      expect(service.state.error).toBe('Service destroyed')
    })

    it('can be called multiple times safely', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      service.destroy()
      service.destroy()
      service.destroy()

      expect(mockWorkerInstance?.terminate).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('rejects request when service not ready', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      service.destroy()

      await expect(service.decodeJpeg(new Uint8Array([]))).rejects.toThrow(
        'not ready'
      )
    })

    it('handles unknown response IDs gracefully', async () => {
      const servicePromise = DecodeService.create()
      await vi.runAllTimersAsync()
      const service = await servicePromise

      // Simulate response with unknown ID
      simulateWorkerResponse({
        id: 'unknown-id',
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      })

      // Should not throw, just ignore
      expect(service.isReady).toBe(true)

      service.destroy()
    })
  })
})

describe('IDecodeService interface', () => {
  it('is implemented by DecodeService', async () => {
    vi.useRealTimers()
    const servicePromise = DecodeService.create()
    vi.useFakeTimers()
    await vi.runAllTimersAsync()
    const service = await servicePromise

    // Type check - should satisfy the interface
    const iface: IDecodeService = service

    expect(iface.state).toBeDefined()
    expect(iface.isReady).toBeDefined()
    expect(typeof iface.decodeJpeg).toBe('function')
    expect(typeof iface.decodeRawThumbnail).toBe('function')
    expect(typeof iface.generateThumbnail).toBe('function')
    expect(typeof iface.generatePreview).toBe('function')
    expect(typeof iface.detectFileType).toBe('function')
    expect(typeof iface.applyAdjustments).toBe('function')
    expect(typeof iface.computeHistogram).toBe('function')
    expect(typeof iface.applyToneCurve).toBe('function')
    expect(typeof iface.applyRotation).toBe('function')
    expect(typeof iface.applyCrop).toBe('function')
    expect(typeof iface.encodeJpeg).toBe('function')
    expect(typeof iface.applyMaskedAdjustments).toBe('function')
    expect(typeof iface.generateEditedThumbnail).toBe('function')
    expect(typeof iface.destroy).toBe('function')

    service.destroy()
  })
})
