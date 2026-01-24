/**
 * Unit tests for DecodeWorker.
 *
 * Tests the decode worker message handling logic by mocking the WASM module
 * and the DedicatedWorkerGlobalScope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock Types
// ============================================================================

interface MockJsDecodedImage {
  width: number
  height: number
  pixels: () => Uint8Array
  free: ReturnType<typeof vi.fn>
}

// ============================================================================
// Mock WASM Module
// ============================================================================

const mockInit = vi.fn()
const mockDecodeJpeg = vi.fn()
const mockDecodeRawThumbnail = vi.fn()
const mockGenerateThumbnail = vi.fn()
const mockResizeToFit = vi.fn()
const mockIsRawFile = vi.fn()
const mockApplyAdjustments = vi.fn()
const mockApplyToneCurve = vi.fn()
const mockApplyRotation = vi.fn()
const mockApplyCrop = vi.fn()
const mockComputeHistogram = vi.fn()
const mockEncodeJpeg = vi.fn()
const mockApplyMaskedAdjustments = vi.fn()

// Mock BasicAdjustments class
class MockBasicAdjustments {
  temperature = 0
  tint = 0
  exposure = 0
  contrast = 0
  highlights = 0
  shadows = 0
  whites = 0
  blacks = 0
  vibrance = 0
  saturation = 0
  free = vi.fn()
}

// Mock JsDecodedImage class
class MockJsDecodedImageClass {
  width: number
  height: number
  private _pixels: Uint8Array
  free = vi.fn()

  constructor(width: number, height: number, pixels: Uint8Array) {
    this.width = width
    this.height = height
    this._pixels = pixels
  }

  pixels(): Uint8Array {
    return this._pixels
  }
}

// Mock JsToneCurveLut class
class MockJsToneCurveLut {
  free = vi.fn()

  constructor(_points: Array<{ x: number; y: number }>) {
    // Store points for testing if needed
  }
}

// Mock the literoom-wasm module
vi.mock('literoom-wasm', () => ({
  default: () => mockInit(),
  decode_jpeg: (...args: unknown[]) => mockDecodeJpeg(...args),
  decode_raw_thumbnail: (...args: unknown[]) => mockDecodeRawThumbnail(...args),
  generate_thumbnail: (...args: unknown[]) => mockGenerateThumbnail(...args),
  resize_to_fit: (...args: unknown[]) => mockResizeToFit(...args),
  is_raw_file: (...args: unknown[]) => mockIsRawFile(...args),
  apply_adjustments: (...args: unknown[]) => mockApplyAdjustments(...args),
  apply_tone_curve: (...args: unknown[]) => mockApplyToneCurve(...args),
  apply_rotation: (...args: unknown[]) => mockApplyRotation(...args),
  apply_crop: (...args: unknown[]) => mockApplyCrop(...args),
  compute_histogram: (...args: unknown[]) => mockComputeHistogram(...args),
  encode_jpeg: (...args: unknown[]) => mockEncodeJpeg(...args),
  apply_masked_adjustments: (...args: unknown[]) =>
    mockApplyMaskedAdjustments(...args),
  BasicAdjustments: MockBasicAdjustments,
  JsDecodedImage: MockJsDecodedImageClass,
  JsToneCurveLut: MockJsToneCurveLut,
}))

// ============================================================================
// Mock DedicatedWorkerGlobalScope
// ============================================================================

const mockPostMessage = vi.fn()
let mockOnMessage: ((event: MessageEvent) => Promise<void>) | null = null

// Mock self as DedicatedWorkerGlobalScope
const mockSelf = {
  postMessage: mockPostMessage,
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
}

// Capture the onmessage handler when assigned
Object.defineProperty(mockSelf, 'onmessage', {
  set(handler: ((event: MessageEvent) => Promise<void>) | null) {
    mockOnMessage = handler
  },
  get() {
    return mockOnMessage
  },
})

vi.stubGlobal('self', mockSelf)

// Helper to create a mock decoded image
function createMockDecodedImage(
  width: number,
  height: number
): MockJsDecodedImage {
  const pixels = new Uint8Array(width * height * 3)
  return {
    width,
    height,
    pixels: () => pixels,
    free: vi.fn(),
  }
}

// Helper to simulate incoming message
async function simulateMessage(data: Record<string, unknown>): Promise<void> {
  if (mockOnMessage) {
    await mockOnMessage({ data } as MessageEvent)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('DecodeWorker', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockOnMessage = null

    // Reset WASM init state by clearing module cache
    vi.resetModules()

    // Default mock implementations
    mockInit.mockResolvedValue(undefined)
    mockDecodeJpeg.mockReturnValue(createMockDecodedImage(100, 100))
    mockDecodeRawThumbnail.mockReturnValue(createMockDecodedImage(160, 120))
    mockGenerateThumbnail.mockReturnValue(createMockDecodedImage(256, 256))
    mockResizeToFit.mockReturnValue(createMockDecodedImage(1920, 1080))
    mockIsRawFile.mockReturnValue(false)

    // Re-import to trigger onmessage assignment
    await import('./decode-worker')
  })

  afterEach(() => {
    vi.resetModules()
  })

  // ==========================================================================
  // ensureInitialized tests
  // ==========================================================================

  describe('ensureInitialized', () => {
    it('initializes WASM module on first request', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'test-init-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockInit).toHaveBeenCalledTimes(1)
    })

    it('only initializes WASM once for multiple requests', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      mockDecodeJpeg.mockReturnValue(mockImage)

      // First request
      await simulateMessage({
        id: 'test-init-once-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockInit).toHaveBeenCalledTimes(1)

      // Second request
      await simulateMessage({
        id: 'test-init-once-2',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      // WASM init should still only have been called once
      expect(mockInit).toHaveBeenCalledTimes(1)
    })

    it('skips initialization if already initialized', async () => {
      const mockImage = createMockDecodedImage(200, 200)
      mockDecodeJpeg.mockReturnValue(mockImage)

      // Three consecutive requests
      await simulateMessage({
        id: 'test-skip-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      await simulateMessage({
        id: 'test-skip-2',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      await simulateMessage({
        id: 'test-skip-3',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      // Init should only be called once
      expect(mockInit).toHaveBeenCalledTimes(1)

      // But decode should be called three times
      expect(mockDecodeJpeg).toHaveBeenCalledTimes(3)
    })

    it('throws cached error on subsequent calls after init failure', async () => {
      mockInit.mockRejectedValue(new Error('WASM init failed'))

      // First request - init will fail
      await simulateMessage({
        id: 'test-cached-error-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-cached-error-1',
          type: 'error',
          message: 'WASM init failed',
        })
      )

      // Second request - should use cached error without retrying init
      await simulateMessage({
        id: 'test-cached-error-2',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-cached-error-2',
          type: 'error',
          message: 'WASM init failed',
        })
      )

      // Init should only be called once, not retried
      expect(mockInit).toHaveBeenCalledTimes(1)
    })

    it('converts non-Error init failures to string message', async () => {
      mockInit.mockRejectedValue('String error message')

      await simulateMessage({
        id: 'test-string-init-error',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-string-init-error',
          type: 'error',
          message: 'String error message',
        })
      )
    })

    it('handles null/undefined init failures', async () => {
      mockInit.mockRejectedValue(null)

      await simulateMessage({
        id: 'test-null-init-error',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-null-init-error',
          type: 'error',
          message: 'null',
        })
      )
    })

    it('throws original error on first init failure', async () => {
      const originalError = new Error('Network error loading WASM')
      mockInit.mockRejectedValue(originalError)

      await simulateMessage({
        id: 'test-original-error',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-original-error',
          type: 'error',
          message: 'Network error loading WASM',
        })
      )
    })
  })

  // ==========================================================================
  // sendSuccess tests
  // ==========================================================================

  describe('sendSuccess', () => {
    it('sends success response with image data', async () => {
      const mockImage = createMockDecodedImage(640, 480)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-test-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      // Find the success response (skip ready message)
      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'success-test-1',
        type: 'success',
        width: 640,
        height: 480,
      })
    })

    it('includes correct width and height from image', async () => {
      const mockImage = createMockDecodedImage(1920, 1080)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-dimensions',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0].width).toBe(1920)
      expect(successCall![0].height).toBe(1080)
    })

    it('includes pixels in response', async () => {
      const mockImage = createMockDecodedImage(50, 50)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-pixels',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0].pixels).toBeInstanceOf(Uint8Array)
      expect(successCall![0].pixels.length).toBe(50 * 50 * 3)
    })

    it('transfers pixel buffer to avoid copying', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      const pixels = mockImage.pixels()
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-transfer',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      // Second argument should be the transferable list containing the buffer
      expect(successCall![1]).toEqual([pixels.buffer])
    })

    it('frees WASM memory for the image after sending', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-free',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockImage.free).toHaveBeenCalled()
    })

    it('calls pixels() to extract pixel data', async () => {
      const pixelsFn = vi.fn(() => new Uint8Array(100 * 100 * 3))
      const mockImage = {
        width: 100,
        height: 100,
        pixels: pixelsFn,
        free: vi.fn(),
      }
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'success-pixels-call',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(pixelsFn).toHaveBeenCalled()
    })

    it('sends response before freeing image', async () => {
      const callOrder: string[] = []
      const mockImage = {
        width: 100,
        height: 100,
        pixels: () => new Uint8Array(100 * 100 * 3),
        free: vi.fn(() => callOrder.push('free')),
      }
      mockDecodeJpeg.mockReturnValue(mockImage)

      // Track postMessage calls
      mockPostMessage.mockImplementation((msg) => {
        if (msg.type === 'success') {
          callOrder.push('postMessage')
        }
      })

      await simulateMessage({
        id: 'success-order',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      // postMessage should be called before free
      expect(callOrder).toEqual(['postMessage', 'free'])
    })
  })

  // ==========================================================================
  // sendError tests
  // ==========================================================================

  describe('sendError', () => {
    it('sends error response with message and code', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Invalid JPEG format')
      })

      await simulateMessage({
        id: 'error-test-1',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00, 0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'error-test-1',
          type: 'error',
          message: 'Invalid JPEG format',
          code: expect.any(String),
        })
      )
    })

    it('includes correct request ID in error response', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Test error')
      })

      await simulateMessage({
        id: 'specific-error-id-12345',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].id).toBe('specific-error-id-12345')
    })

    it('converts Error objects to string message', async () => {
      const error = new Error('Custom error message')
      mockDecodeJpeg.mockImplementation(() => {
        throw error
      })

      await simulateMessage({
        id: 'error-message-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].message).toBe('Custom error message')
    })

    it('converts non-Error objects to string message', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw 'String error'
      })

      await simulateMessage({
        id: 'string-error-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].message).toBe('String error')
    })

    it('converts null errors to string', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw null
      })

      await simulateMessage({
        id: 'null-error-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].message).toBe('null')
    })

    it('converts undefined errors to string', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw undefined
      })

      await simulateMessage({
        id: 'undefined-error-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].message).toBe('undefined')
    })

    it('converts number errors to string', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw 42
      })

      await simulateMessage({
        id: 'number-error-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0].message).toBe('42')
    })

    it('does not use transferable for error responses', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Test error')
      })

      await simulateMessage({
        id: 'no-transfer-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall).toBeDefined()
      // Error responses should not have a second argument (transferable list)
      expect(errorCall![1]).toBeUndefined()
    })

    it('includes error code in response', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Some unknown error')
      })

      await simulateMessage({
        id: 'error-code-test',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      const errorCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'error'
      )
      expect(errorCall![0]).toHaveProperty('code')
      expect(typeof errorCall![0].code).toBe('string')
    })
  })

  // ==========================================================================
  // classifyError tests
  // ==========================================================================

  describe('classifyError', () => {
    it('classifies "invalid" errors as INVALID_FORMAT', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Invalid JPEG header')
      })

      await simulateMessage({
        id: 'classify-invalid',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
        })
      )
    })

    it('classifies "not a valid" errors as INVALID_FORMAT', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('not a valid image file')
      })

      await simulateMessage({
        id: 'classify-not-valid',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
        })
      )
    })

    it('classifies "unsupported" errors as UNSUPPORTED_FILE_TYPE', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Unsupported color space')
      })

      await simulateMessage({
        id: 'classify-unsupported',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNSUPPORTED_FILE_TYPE',
        })
      )
    })

    it('classifies "corrupt" errors as CORRUPTED_FILE', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Corrupt data stream')
      })

      await simulateMessage({
        id: 'classify-corrupt',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('classifies "truncated" errors as CORRUPTED_FILE', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Truncated file')
      })

      await simulateMessage({
        id: 'classify-truncated',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('classifies "memory" errors as OUT_OF_MEMORY', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Out of memory')
      })

      await simulateMessage({
        id: 'classify-memory',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OUT_OF_MEMORY',
        })
      )
    })

    it('classifies "alloc" errors as OUT_OF_MEMORY', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Memory allocation failed')
      })

      await simulateMessage({
        id: 'classify-alloc',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OUT_OF_MEMORY',
        })
      )
    })

    it('classifies WASM init failures as WASM_INIT_FAILED', async () => {
      // Reset and set up a failing init
      vi.resetModules()
      vi.clearAllMocks()
      mockOnMessage = null
      mockInit.mockRejectedValue(new Error('WASM module failed to load'))

      await import('./decode-worker')

      await simulateMessage({
        id: 'classify-wasm-init',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'WASM_INIT_FAILED',
        })
      )
    })

    it('classifies unknown errors as UNKNOWN', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Something unexpected happened')
      })

      await simulateMessage({
        id: 'classify-unknown',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNKNOWN',
        })
      )
    })

    it('handles case-insensitive error matching for INVALID', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('INVALID JPEG FORMAT')
      })

      await simulateMessage({
        id: 'classify-case-invalid',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
        })
      )
    })

    it('handles case-insensitive error matching for UNSUPPORTED', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('UNSUPPORTED FILE TYPE')
      })

      await simulateMessage({
        id: 'classify-case-unsupported',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNSUPPORTED_FILE_TYPE',
        })
      )
    })

    it('handles case-insensitive error matching for CORRUPT', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('CORRUPT DATA')
      })

      await simulateMessage({
        id: 'classify-case-corrupt',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('handles case-insensitive error matching for MEMORY', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('MEMORY ALLOCATION FAILURE')
      })

      await simulateMessage({
        id: 'classify-case-memory',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OUT_OF_MEMORY',
        })
      )
    })

    it('classifies string errors correctly', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw 'corrupt data found'
      })

      await simulateMessage({
        id: 'classify-string',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('classifies mixed case string errors correctly', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw 'UnSupPoRtEd FoRmAt'
      })

      await simulateMessage({
        id: 'classify-mixed-case',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNSUPPORTED_FILE_TYPE',
        })
      )
    })

    it('prioritizes specific error codes over generic ones', async () => {
      // Test that "invalid" takes precedence when multiple keywords present
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Invalid format - data is corrupted')
      })

      await simulateMessage({
        id: 'classify-priority',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      // "invalid" should be checked before "corrupt" based on code order
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
        })
      )
    })

    it('handles empty error message', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('')
      })

      await simulateMessage({
        id: 'classify-empty',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNKNOWN',
        })
      )
    })

    it('handles error with special characters', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Invalid format: file@#$%^&*() is corrupt!')
      })

      await simulateMessage({
        id: 'classify-special-chars',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
        })
      )
    })
  })

  // ==========================================================================
  // Worker ready signal tests
  // ==========================================================================

  describe('worker ready signal', () => {
    it('sends ready message on initialization', async () => {
      // The worker should have posted a ready message immediately on load
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'ready' })
    })

    it('sends ready message before any decode requests', async () => {
      // Check that ready message was the first call
      const firstCall = mockPostMessage.mock.calls[0]
      expect(firstCall[0]).toEqual({ type: 'ready' })
    })
  })

  // ==========================================================================
  // decode-jpeg handler tests
  // ==========================================================================

  describe('decode-jpeg handler', () => {
    it('decodes JPEG bytes and returns image data', async () => {
      const mockImage = createMockDecodedImage(800, 600)
      mockDecodeJpeg.mockReturnValue(mockImage)

      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      await simulateMessage({
        id: 'decode-jpeg-1',
        type: 'decode-jpeg',
        bytes: jpegBytes,
      })

      expect(mockDecodeJpeg).toHaveBeenCalledWith(jpegBytes)
    })

    it('sends success response with correct dimensions', async () => {
      const mockImage = createMockDecodedImage(1024, 768)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-jpeg-2',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'decode-jpeg-2',
        type: 'success',
        width: 1024,
        height: 768,
      })
    })

    it('sends pixels with transferable buffer', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      const pixels = mockImage.pixels()
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-jpeg-3',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0].pixels).toBeInstanceOf(Uint8Array)
      expect(successCall![1]).toEqual([pixels.buffer])
    })

    it('frees WASM image memory after sending', async () => {
      const mockImage = createMockDecodedImage(100, 100)
      mockDecodeJpeg.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-jpeg-4',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      })

      expect(mockImage.free).toHaveBeenCalled()
    })

    it('sends error response on decode failure', async () => {
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Invalid JPEG data')
      })

      await simulateMessage({
        id: 'decode-jpeg-5',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0x00, 0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'decode-jpeg-5',
          type: 'error',
          message: 'Invalid JPEG data',
          code: 'INVALID_FORMAT',
        })
      )
    })
  })

  // ==========================================================================
  // decode-raw-thumbnail handler tests
  // ==========================================================================

  describe('decode-raw-thumbnail handler', () => {
    it('decodes RAW thumbnail bytes and returns image data', async () => {
      const mockImage = createMockDecodedImage(160, 120)
      mockDecodeRawThumbnail.mockReturnValue(mockImage)

      const rawBytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00]) // TIFF header

      await simulateMessage({
        id: 'decode-raw-thumb-1',
        type: 'decode-raw-thumbnail',
        bytes: rawBytes,
      })

      expect(mockDecodeRawThumbnail).toHaveBeenCalledWith(rawBytes)
    })

    it('sends success response with correct dimensions', async () => {
      const mockImage = createMockDecodedImage(320, 240)
      mockDecodeRawThumbnail.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-raw-thumb-2',
        type: 'decode-raw-thumbnail',
        bytes: new Uint8Array([0x49, 0x49]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'decode-raw-thumb-2',
        type: 'success',
        width: 320,
        height: 240,
      })
    })

    it('sends pixels with transferable buffer', async () => {
      const mockImage = createMockDecodedImage(160, 120)
      const pixels = mockImage.pixels()
      mockDecodeRawThumbnail.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-raw-thumb-3',
        type: 'decode-raw-thumbnail',
        bytes: new Uint8Array([0x49, 0x49]),
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0].pixels).toBeInstanceOf(Uint8Array)
      expect(successCall![1]).toEqual([pixels.buffer])
    })

    it('frees WASM image memory after sending', async () => {
      const mockImage = createMockDecodedImage(160, 120)
      mockDecodeRawThumbnail.mockReturnValue(mockImage)

      await simulateMessage({
        id: 'decode-raw-thumb-4',
        type: 'decode-raw-thumbnail',
        bytes: new Uint8Array([0x49, 0x49]),
      })

      expect(mockImage.free).toHaveBeenCalled()
    })

    it('sends error response on decode failure', async () => {
      mockDecodeRawThumbnail.mockImplementation(() => {
        throw new Error('Unsupported RAW format')
      })

      await simulateMessage({
        id: 'decode-raw-thumb-5',
        type: 'decode-raw-thumbnail',
        bytes: new Uint8Array([0x00, 0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'decode-raw-thumb-5',
          type: 'error',
          message: 'Unsupported RAW format',
          code: 'UNSUPPORTED_FILE_TYPE',
        })
      )
    })
  })

  // ==========================================================================
  // generate-thumbnail handler tests
  // ==========================================================================

  describe('generate-thumbnail handler', () => {
    it('decodes JPEG and generates thumbnail for non-RAW files', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      await simulateMessage({
        id: 'gen-thumb-1',
        type: 'generate-thumbnail',
        bytes: jpegBytes,
        size: 256,
      })

      expect(mockIsRawFile).toHaveBeenCalledWith(jpegBytes)
      expect(mockDecodeJpeg).toHaveBeenCalledWith(jpegBytes)
      expect(mockGenerateThumbnail).toHaveBeenCalledWith(sourceImage, 256)
    })

    it('decodes RAW thumbnail and generates thumbnail for RAW files', async () => {
      mockIsRawFile.mockReturnValue(true)
      const sourceImage = createMockDecodedImage(4000, 3000)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeRawThumbnail.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      const rawBytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00])

      await simulateMessage({
        id: 'gen-thumb-2',
        type: 'generate-thumbnail',
        bytes: rawBytes,
        size: 256,
      })

      expect(mockIsRawFile).toHaveBeenCalledWith(rawBytes)
      expect(mockDecodeRawThumbnail).toHaveBeenCalledWith(rawBytes)
      expect(mockGenerateThumbnail).toHaveBeenCalledWith(sourceImage, 256)
    })

    it('sends success response with thumbnail dimensions', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(1000, 800)
      const thumbImage = createMockDecodedImage(256, 205)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      await simulateMessage({
        id: 'gen-thumb-3',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'gen-thumb-3',
        type: 'success',
        width: 256,
        height: 205,
      })
    })

    it('frees source image after thumbnail generation', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(1000, 800)
      const thumbImage = createMockDecodedImage(256, 205)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      await simulateMessage({
        id: 'gen-thumb-4',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
      })

      expect(sourceImage.free).toHaveBeenCalled()
    })

    it('frees thumbnail image after sending', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(1000, 800)
      const thumbImage = createMockDecodedImage(256, 205)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      await simulateMessage({
        id: 'gen-thumb-5',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
      })

      expect(thumbImage.free).toHaveBeenCalled()
    })

    it('sends error response on decode failure', async () => {
      mockIsRawFile.mockReturnValue(false)
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Corrupt image file')
      })

      await simulateMessage({
        id: 'gen-thumb-6',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0x00]),
        size: 256,
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gen-thumb-6',
          type: 'error',
          message: 'Corrupt image file',
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('supports different thumbnail sizes', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(512, 384)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)

      await simulateMessage({
        id: 'gen-thumb-7',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 512,
      })

      expect(mockGenerateThumbnail).toHaveBeenCalledWith(sourceImage, 512)
    })
  })

  // ==========================================================================
  // generate-preview handler tests
  // ==========================================================================

  describe('generate-preview handler', () => {
    it('decodes JPEG and resizes for preview for non-RAW files', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(4000, 3000)
      const previewImage = createMockDecodedImage(1920, 1440)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      await simulateMessage({
        id: 'gen-preview-1',
        type: 'generate-preview',
        bytes: jpegBytes,
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      expect(mockIsRawFile).toHaveBeenCalledWith(jpegBytes)
      expect(mockDecodeJpeg).toHaveBeenCalledWith(jpegBytes)
      expect(mockResizeToFit).toHaveBeenCalledWith(sourceImage, 1920, 'lanczos3')
    })

    it('decodes RAW thumbnail and resizes for preview for RAW files', async () => {
      mockIsRawFile.mockReturnValue(true)
      const sourceImage = createMockDecodedImage(6000, 4000)
      const previewImage = createMockDecodedImage(1920, 1280)
      mockDecodeRawThumbnail.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      const rawBytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00])

      await simulateMessage({
        id: 'gen-preview-2',
        type: 'generate-preview',
        bytes: rawBytes,
        maxEdge: 1920,
        filter: 'bilinear',
      })

      expect(mockIsRawFile).toHaveBeenCalledWith(rawBytes)
      expect(mockDecodeRawThumbnail).toHaveBeenCalledWith(rawBytes)
      expect(mockResizeToFit).toHaveBeenCalledWith(sourceImage, 1920, 'bilinear')
    })

    it('sends success response with preview dimensions', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(3000, 2000)
      const previewImage = createMockDecodedImage(1920, 1280)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-3',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'gen-preview-3',
        type: 'success',
        width: 1920,
        height: 1280,
      })
    })

    it('frees source image after resize', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(3000, 2000)
      const previewImage = createMockDecodedImage(1920, 1280)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-4',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      expect(sourceImage.free).toHaveBeenCalled()
    })

    it('frees preview image after sending', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(3000, 2000)
      const previewImage = createMockDecodedImage(1920, 1280)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-5',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      expect(previewImage.free).toHaveBeenCalled()
    })

    it('sends pixels with transferable buffer', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(3000, 2000)
      const previewImage = createMockDecodedImage(1920, 1280)
      const pixels = previewImage.pixels()
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-6',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0].pixels).toBeInstanceOf(Uint8Array)
      expect(successCall![1]).toEqual([pixels.buffer])
    })

    it('sends error response on decode failure', async () => {
      mockIsRawFile.mockReturnValue(false)
      mockDecodeJpeg.mockImplementation(() => {
        throw new Error('Truncated file data')
      })

      await simulateMessage({
        id: 'gen-preview-7',
        type: 'generate-preview',
        bytes: new Uint8Array([0x00]),
        maxEdge: 1920,
        filter: 'lanczos3',
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gen-preview-7',
          type: 'error',
          message: 'Truncated file data',
          code: 'CORRUPTED_FILE',
        })
      )
    })

    it('supports different max edge values', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(4000, 3000)
      const previewImage = createMockDecodedImage(2560, 1920)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-8',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 2560,
        filter: 'lanczos3',
      })

      expect(mockResizeToFit).toHaveBeenCalledWith(sourceImage, 2560, 'lanczos3')
    })

    it('supports different filter types', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(4000, 3000)
      const previewImage = createMockDecodedImage(1920, 1440)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockResizeToFit.mockReturnValue(previewImage)

      await simulateMessage({
        id: 'gen-preview-9',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 1920,
        filter: 'nearest',
      })

      expect(mockResizeToFit).toHaveBeenCalledWith(sourceImage, 1920, 'nearest')
    })
  })

  // ==========================================================================
  // detect-file-type handler tests
  // ==========================================================================

  describe('detect-file-type handler', () => {
    it('detects RAW file type when isRawFile returns true', async () => {
      mockIsRawFile.mockReturnValue(true)

      await simulateMessage({
        id: 'detect-1',
        type: 'detect-file-type',
        bytes: new Uint8Array([0x49, 0x49, 0x2a, 0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'detect-1',
          type: 'file-type',
          fileType: 'raw',
        })
      )
    })

    it('detects JPEG file type from magic bytes', async () => {
      mockIsRawFile.mockReturnValue(false)

      await simulateMessage({
        id: 'detect-2',
        type: 'detect-file-type',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'detect-2',
          type: 'file-type',
          fileType: 'jpeg',
        })
      )
    })

    it('returns unknown for unrecognized bytes', async () => {
      mockIsRawFile.mockReturnValue(false)

      await simulateMessage({
        id: 'detect-3',
        type: 'detect-file-type',
        bytes: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'detect-3',
          type: 'file-type',
          fileType: 'unknown',
        })
      )
    })

    it('returns unknown for empty byte array', async () => {
      mockIsRawFile.mockReturnValue(false)

      await simulateMessage({
        id: 'detect-4',
        type: 'detect-file-type',
        bytes: new Uint8Array([]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'detect-4',
          type: 'file-type',
          fileType: 'unknown',
        })
      )
    })

    it('returns unknown for single byte', async () => {
      mockIsRawFile.mockReturnValue(false)

      await simulateMessage({
        id: 'detect-5',
        type: 'detect-file-type',
        bytes: new Uint8Array([0xff]),
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'detect-5',
          type: 'file-type',
          fileType: 'unknown',
        })
      )
    })
  })

  // ==========================================================================
  // apply-adjustments handler tests
  // ==========================================================================

  describe('apply-adjustments handler', () => {
    it('applies adjustments to image pixels', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyAdjustments.mockReturnValue(outputImage)

      const inputPixels = new Uint8Array(100 * 100 * 3)
      const adjustments = {
        temperature: 10,
        tint: -5,
        exposure: 0.5,
        contrast: 20,
        highlights: -30,
        shadows: 40,
        whites: 15,
        blacks: -10,
        vibrance: 25,
        saturation: 10,
      }

      await simulateMessage({
        id: 'adjust-1',
        type: 'apply-adjustments',
        pixels: inputPixels,
        width: 100,
        height: 100,
        adjustments,
      })

      expect(mockApplyAdjustments).toHaveBeenCalled()
    })

    it('sends success response with adjusted pixels', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'adjust-2',
        type: 'apply-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        adjustments: {
          temperature: 0,
          tint: 0,
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vibrance: 0,
          saturation: 0,
        },
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall).toBeDefined()
      expect(successCall![0]).toMatchObject({
        id: 'adjust-2',
        type: 'success',
        width: 100,
        height: 100,
      })
    })

    it('transfers pixel buffer to avoid copying', async () => {
      const outputImage = createMockDecodedImage(50, 50)
      const outputPixels = outputImage.pixels()
      mockApplyAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'adjust-3',
        type: 'apply-adjustments',
        pixels: new Uint8Array(50 * 50 * 3),
        width: 50,
        height: 50,
        adjustments: {
          temperature: 0,
          tint: 0,
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vibrance: 0,
          saturation: 0,
        },
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![1]).toEqual([outputPixels.buffer])
    })

    it('handles adjustment errors', async () => {
      mockApplyAdjustments.mockImplementation(() => {
        throw new Error('Out of memory during adjustment')
      })

      await simulateMessage({
        id: 'adjust-4',
        type: 'apply-adjustments',
        pixels: new Uint8Array(1000 * 1000 * 3),
        width: 1000,
        height: 1000,
        adjustments: {
          temperature: 0,
          tint: 0,
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vibrance: 0,
          saturation: 0,
        },
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'adjust-4',
          type: 'error',
          code: 'OUT_OF_MEMORY',
        })
      )
    })
  })

  // ==========================================================================
  // compute-histogram handler tests
  // ==========================================================================

  describe('compute-histogram handler', () => {
    it('computes histogram from image pixels', async () => {
      const mockHistogram = {
        red: vi.fn(() => new Uint32Array(256)),
        green: vi.fn(() => new Uint32Array(256)),
        blue: vi.fn(() => new Uint32Array(256)),
        luminance: vi.fn(() => new Uint32Array(256)),
        max_value: 1000,
        has_highlight_clipping: false,
        has_shadow_clipping: false,
        free: vi.fn(),
      }
      mockComputeHistogram.mockReturnValue(mockHistogram)

      await simulateMessage({
        id: 'histogram-1',
        type: 'compute-histogram',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      })

      expect(mockComputeHistogram).toHaveBeenCalled()
    })

    it('sends histogram response with channel data', async () => {
      const redData = new Uint32Array(256)
      const greenData = new Uint32Array(256)
      const blueData = new Uint32Array(256)
      const lumData = new Uint32Array(256)

      const mockHistogram = {
        red: vi.fn(() => redData),
        green: vi.fn(() => greenData),
        blue: vi.fn(() => blueData),
        luminance: vi.fn(() => lumData),
        max_value: 5000,
        has_highlight_clipping: true,
        has_shadow_clipping: false,
        free: vi.fn(),
      }
      mockComputeHistogram.mockReturnValue(mockHistogram)

      await simulateMessage({
        id: 'histogram-2',
        type: 'compute-histogram',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'histogram-2',
          type: 'histogram',
          maxValue: 5000,
          hasHighlightClipping: true,
          hasShadowClipping: false,
        }),
        expect.any(Array)
      )
    })

    it('transfers histogram buffers to avoid copying', async () => {
      const redData = new Uint32Array(256)
      const greenData = new Uint32Array(256)
      const blueData = new Uint32Array(256)
      const lumData = new Uint32Array(256)

      const mockHistogram = {
        red: vi.fn(() => redData),
        green: vi.fn(() => greenData),
        blue: vi.fn(() => blueData),
        luminance: vi.fn(() => lumData),
        max_value: 1000,
        has_highlight_clipping: false,
        has_shadow_clipping: false,
        free: vi.fn(),
      }
      mockComputeHistogram.mockReturnValue(mockHistogram)

      await simulateMessage({
        id: 'histogram-3',
        type: 'compute-histogram',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      })

      const histCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'histogram'
      )
      expect(histCall![1]).toEqual([
        redData.buffer,
        greenData.buffer,
        blueData.buffer,
        lumData.buffer,
      ])
    })

    it('frees histogram memory after extracting data', async () => {
      const mockHistogram = {
        red: vi.fn(() => new Uint32Array(256)),
        green: vi.fn(() => new Uint32Array(256)),
        blue: vi.fn(() => new Uint32Array(256)),
        luminance: vi.fn(() => new Uint32Array(256)),
        max_value: 1000,
        has_highlight_clipping: false,
        has_shadow_clipping: false,
        free: vi.fn(),
      }
      mockComputeHistogram.mockReturnValue(mockHistogram)

      await simulateMessage({
        id: 'histogram-4',
        type: 'compute-histogram',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      })

      expect(mockHistogram.free).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // apply-tone-curve handler tests
  // ==========================================================================

  describe('apply-tone-curve handler', () => {
    it('applies tone curve to image pixels', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyToneCurve.mockReturnValue(outputImage)

      const points = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ]

      await simulateMessage({
        id: 'curve-1',
        type: 'apply-tone-curve',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        points,
      })

      expect(mockApplyToneCurve).toHaveBeenCalled()
    })

    it('sends tone-curve-result response', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyToneCurve.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'curve-2',
        type: 'apply-tone-curve',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'curve-2',
          type: 'tone-curve-result',
          width: 100,
          height: 100,
        }),
        expect.any(Array)
      )
    })

    it('transfers pixel buffer to avoid copying', async () => {
      const outputImage = createMockDecodedImage(50, 50)
      const outputPixels = outputImage.pixels()
      mockApplyToneCurve.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'curve-3',
        type: 'apply-tone-curve',
        pixels: new Uint8Array(50 * 50 * 3),
        width: 50,
        height: 50,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      })

      const curveCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'tone-curve-result'
      )
      expect(curveCall![1]).toEqual([outputPixels.buffer])
    })
  })

  // ==========================================================================
  // apply-rotation handler tests
  // ==========================================================================

  describe('apply-rotation handler', () => {
    it('applies rotation with bilinear filter', async () => {
      const outputImage = createMockDecodedImage(142, 142)
      mockApplyRotation.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'rotate-1',
        type: 'apply-rotation',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        angleDegrees: 45,
        useLanczos: false,
      })

      expect(mockApplyRotation).toHaveBeenCalled()
    })

    it('applies rotation with lanczos filter when specified', async () => {
      const outputImage = createMockDecodedImage(142, 142)
      mockApplyRotation.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'rotate-2',
        type: 'apply-rotation',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        angleDegrees: 45,
        useLanczos: true,
      })

      expect(mockApplyRotation).toHaveBeenCalled()
    })

    it('sends success response with rotated dimensions', async () => {
      const outputImage = createMockDecodedImage(142, 142)
      mockApplyRotation.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'rotate-3',
        type: 'apply-rotation',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        angleDegrees: 45,
        useLanczos: false,
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0]).toMatchObject({
        id: 'rotate-3',
        type: 'success',
        width: 142,
        height: 142,
      })
    })

    it('transfers pixel buffer to avoid copying', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      const outputPixels = outputImage.pixels()
      mockApplyRotation.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'rotate-4',
        type: 'apply-rotation',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        angleDegrees: 90,
        useLanczos: false,
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![1]).toEqual([outputPixels.buffer])
    })
  })

  // ==========================================================================
  // apply-crop handler tests
  // ==========================================================================

  describe('apply-crop handler', () => {
    it('applies crop with normalized coordinates', async () => {
      const outputImage = createMockDecodedImage(80, 80)
      mockApplyCrop.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'crop-1',
        type: 'apply-crop',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        left: 0.1,
        top: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
      })

      expect(mockApplyCrop).toHaveBeenCalled()
    })

    it('sends success response with cropped dimensions', async () => {
      const outputImage = createMockDecodedImage(50, 50)
      mockApplyCrop.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'crop-2',
        type: 'apply-crop',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        left: 0.25,
        top: 0.25,
        cropWidth: 0.5,
        cropHeight: 0.5,
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0]).toMatchObject({
        id: 'crop-2',
        type: 'success',
        width: 50,
        height: 50,
      })
    })

    it('transfers pixel buffer to avoid copying', async () => {
      const outputImage = createMockDecodedImage(80, 80)
      const outputPixels = outputImage.pixels()
      mockApplyCrop.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'crop-3',
        type: 'apply-crop',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        left: 0.1,
        top: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![1]).toEqual([outputPixels.buffer])
    })
  })

  // ==========================================================================
  // encode-jpeg handler tests
  // ==========================================================================

  describe('encode-jpeg handler', () => {
    it('encodes pixels to JPEG bytes', async () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      mockEncodeJpeg.mockReturnValue(jpegBytes)

      await simulateMessage({
        id: 'encode-1',
        type: 'encode-jpeg',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        quality: 85,
      })

      expect(mockEncodeJpeg).toHaveBeenCalled()
    })

    it('sends encode-jpeg-result response', async () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      mockEncodeJpeg.mockReturnValue(jpegBytes)

      await simulateMessage({
        id: 'encode-2',
        type: 'encode-jpeg',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        quality: 90,
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'encode-2',
          type: 'encode-jpeg-result',
          bytes: jpegBytes,
        }),
        expect.any(Array)
      )
    })

    it('transfers JPEG buffer to avoid copying', async () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      mockEncodeJpeg.mockReturnValue(jpegBytes)

      await simulateMessage({
        id: 'encode-3',
        type: 'encode-jpeg',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        quality: 85,
      })

      const encodeCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'encode-jpeg-result'
      )
      expect(encodeCall![1]).toEqual([jpegBytes.buffer])
    })
  })

  // ==========================================================================
  // apply-masked-adjustments handler tests
  // ==========================================================================

  describe('apply-masked-adjustments handler', () => {
    it('applies masked adjustments with linear masks', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyMaskedAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'masked-1',
        type: 'apply-masked-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        maskStack: {
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
        },
      })

      expect(mockApplyMaskedAdjustments).toHaveBeenCalled()
    })

    it('applies masked adjustments with radial masks', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyMaskedAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'masked-2',
        type: 'apply-masked-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        maskStack: {
          linearMasks: [],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: true,
              adjustments: { exposure: 0.5 },
            },
          ],
        },
      })

      expect(mockApplyMaskedAdjustments).toHaveBeenCalled()
    })

    it('filters out disabled masks', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyMaskedAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'masked-3',
        type: 'apply-masked-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        maskStack: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: false,
              adjustments: { exposure: 1 },
            },
            {
              startX: 0,
              startY: 0,
              endX: 0.5,
              endY: 0.5,
              feather: 0.3,
              enabled: true,
              adjustments: { contrast: 10 },
            },
          ],
          radialMasks: [],
        },
      })

      // Verify the call was made - disabled masks should be filtered
      expect(mockApplyMaskedAdjustments).toHaveBeenCalled()
    })

    it('sends success response with masked adjustments applied', async () => {
      const outputImage = createMockDecodedImage(100, 100)
      mockApplyMaskedAdjustments.mockReturnValue(outputImage)

      await simulateMessage({
        id: 'masked-4',
        type: 'apply-masked-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        maskStack: {
          linearMasks: [],
          radialMasks: [],
        },
      })

      const successCall = mockPostMessage.mock.calls.find(
        (call) => call[0].type === 'success'
      )
      expect(successCall![0]).toMatchObject({
        id: 'masked-4',
        type: 'success',
        width: 100,
        height: 100,
      })
    })
  })

  // ==========================================================================
  // generate-edited-thumbnail handler tests
  // ==========================================================================

  describe('generate-edited-thumbnail handler', () => {
    it('generates thumbnail with no edits', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-1',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {},
      })

      expect(mockDecodeJpeg).toHaveBeenCalled()
      expect(mockGenerateThumbnail).toHaveBeenCalled()
      expect(mockEncodeJpeg).toHaveBeenCalled()
    })

    it('generates thumbnail with rotation', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const rotatedImage = createMockDecodedImage(2121, 2121)
      const thumbImage = createMockDecodedImage(256, 256)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockApplyRotation.mockReturnValue(rotatedImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-2',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          rotation: { angle: 45, straighten: 0 },
        },
      })

      expect(mockApplyRotation).toHaveBeenCalled()
    })

    it('generates thumbnail with crop', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const croppedImage = createMockDecodedImage(1600, 1200)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockApplyCrop.mockReturnValue(croppedImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-3',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
        },
      })

      expect(mockApplyCrop).toHaveBeenCalled()
    })

    it('generates thumbnail with adjustments', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const adjustedImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockApplyAdjustments.mockReturnValue(adjustedImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-4',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          adjustments: {
            temperature: 10,
            tint: 0,
            exposure: 0.5,
            contrast: 10,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            vibrance: 0,
            saturation: 0,
          },
        },
      })

      expect(mockApplyAdjustments).toHaveBeenCalled()
    })

    it('generates thumbnail with tone curve', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const curvedImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockApplyToneCurve.mockReturnValue(curvedImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-5',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          toneCurve: {
            points: [
              { x: 0, y: 0 },
              { x: 0.5, y: 0.6 },
              { x: 1, y: 1 },
            ],
          },
        },
      })

      expect(mockApplyToneCurve).toHaveBeenCalled()
    })

    it('generates thumbnail with masked adjustments', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const maskedImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockApplyMaskedAdjustments.mockReturnValue(maskedImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-6',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          masks: {
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
          },
        },
      })

      expect(mockApplyMaskedAdjustments).toHaveBeenCalled()
    })

    it('sends generate-edited-thumbnail-result response', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      mockEncodeJpeg.mockReturnValue(jpegBytes)

      await simulateMessage({
        id: 'edited-thumb-7',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {},
      })

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'edited-thumb-7',
          type: 'generate-edited-thumbnail-result',
          bytes: jpegBytes,
        }),
        expect.any(Array)
      )
    })

    it('decodes RAW files using decodeRawThumbnail', async () => {
      mockIsRawFile.mockReturnValue(true)
      const sourceImage = createMockDecodedImage(6000, 4000)
      const thumbImage = createMockDecodedImage(256, 171)
      mockDecodeRawThumbnail.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-8',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0x49, 0x49, 0x2a, 0x00]),
        size: 256,
        editState: {},
      })

      expect(mockDecodeRawThumbnail).toHaveBeenCalled()
      expect(mockDecodeJpeg).not.toHaveBeenCalled()
    })

    it('skips rotation when angle is zero', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-9',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          rotation: { angle: 0, straighten: 0 },
        },
      })

      expect(mockApplyRotation).not.toHaveBeenCalled()
    })

    it('skips tone curve when points array is empty', async () => {
      mockIsRawFile.mockReturnValue(false)
      const sourceImage = createMockDecodedImage(2000, 1500)
      const thumbImage = createMockDecodedImage(256, 192)
      mockDecodeJpeg.mockReturnValue(sourceImage)
      mockGenerateThumbnail.mockReturnValue(thumbImage)
      mockEncodeJpeg.mockReturnValue(new Uint8Array([0xff, 0xd8]))

      await simulateMessage({
        id: 'edited-thumb-10',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {
          toneCurve: { points: [] },
        },
      })

      expect(mockApplyToneCurve).not.toHaveBeenCalled()
    })
  })
})
