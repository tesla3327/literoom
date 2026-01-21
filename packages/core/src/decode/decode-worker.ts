/**
 * Decode Worker - Handles image decoding operations in a background thread.
 *
 * This worker loads the WASM module and handles decode requests from the main
 * thread. All heavy image processing runs here to keep the UI responsive.
 *
 * The worker is initialized lazily on first request to avoid blocking initial
 * page load.
 */

// Tell TypeScript this is a Web Worker context
declare const self: DedicatedWorkerGlobalScope

// Note: Import path will be resolved by Vite at build time
import init, {
  decode_jpeg,
  decode_raw_thumbnail,
  generate_thumbnail,
  resize_to_fit,
  is_raw_file,
  type JsDecodedImage
} from 'literoom-wasm'

import type {
  DecodeRequest,
  DecodeResponse,
  DecodeSuccessResponse,
  DecodeErrorResponse
} from './worker-messages'
import type { ErrorCode } from './types'

/** Whether WASM module has been initialized */
let initialized = false

/** Error message if initialization failed */
let initError: string | null = null

/**
 * Initialize WASM module on first use.
 * Throws if initialization fails.
 */
async function ensureInitialized(): Promise<void> {
  if (initialized) return

  if (initError) {
    throw new Error(initError)
  }

  try {
    await init()
    initialized = true
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

/**
 * Send a success response with image data.
 * Uses Transferable to avoid copying the pixel buffer.
 */
function sendSuccess(id: string, image: JsDecodedImage): void {
  const pixels = image.pixels()
  const response: DecodeSuccessResponse = {
    id,
    type: 'success',
    width: image.width,
    height: image.height,
    pixels
  }

  // Transfer the pixel buffer to avoid copying
  self.postMessage(response, [pixels.buffer])

  // Free WASM memory for the image
  image.free()
}

/**
 * Send an error response.
 */
function sendError(id: string, error: unknown, code: ErrorCode): void {
  const message = error instanceof Error ? error.message : String(error)
  const response: DecodeErrorResponse = {
    id,
    type: 'error',
    message,
    code
  }
  self.postMessage(response)
}

/**
 * Determine error code from error message.
 */
function classifyError(error: unknown): ErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('invalid') || lowerMessage.includes('not a valid')) {
    return 'INVALID_FORMAT'
  }
  if (lowerMessage.includes('unsupported')) {
    return 'UNSUPPORTED_FILE_TYPE'
  }
  if (lowerMessage.includes('corrupt') || lowerMessage.includes('truncated')) {
    return 'CORRUPTED_FILE'
  }
  if (lowerMessage.includes('memory') || lowerMessage.includes('alloc')) {
    return 'OUT_OF_MEMORY'
  }
  if (initError || !initialized) {
    return 'WASM_INIT_FAILED'
  }
  return 'UNKNOWN'
}

/**
 * Handle incoming decode requests.
 */
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data
  const { id, type } = request

  try {
    await ensureInitialized()

    switch (type) {
      case 'decode-jpeg': {
        const image = decode_jpeg(request.bytes)
        sendSuccess(id, image)
        break
      }

      case 'decode-raw-thumbnail': {
        const image = decode_raw_thumbnail(request.bytes)
        sendSuccess(id, image)
        break
      }

      case 'generate-thumbnail': {
        // First decode the image, then generate thumbnail
        // Try RAW first, fall back to JPEG
        let sourceImage: JsDecodedImage

        if (is_raw_file(request.bytes)) {
          sourceImage = decode_raw_thumbnail(request.bytes)
        } else {
          sourceImage = decode_jpeg(request.bytes)
        }

        const thumb = generate_thumbnail(sourceImage, request.size)
        sourceImage.free()
        sendSuccess(id, thumb)
        break
      }

      case 'generate-preview': {
        // First decode the image, then resize for preview
        let sourceImage: JsDecodedImage

        if (is_raw_file(request.bytes)) {
          sourceImage = decode_raw_thumbnail(request.bytes)
        } else {
          sourceImage = decode_jpeg(request.bytes)
        }

        const preview = resize_to_fit(sourceImage, request.maxEdge, request.filter)
        sourceImage.free()
        sendSuccess(id, preview)
        break
      }

      case 'detect-file-type': {
        // Quick check without full decode
        let fileType: 'jpeg' | 'raw' | 'unknown'

        if (is_raw_file(request.bytes)) {
          fileType = 'raw'
        } else if (
          request.bytes.length >= 2 &&
          request.bytes[0] === 0xff &&
          request.bytes[1] === 0xd8
        ) {
          fileType = 'jpeg'
        } else {
          fileType = 'unknown'
        }

        const response: DecodeResponse = {
          id,
          type: 'file-type',
          fileType
        }
        self.postMessage(response)
        break
      }

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = type
        sendError(id, `Unknown request type: ${_exhaustive}`, 'UNKNOWN')
      }
    }
  } catch (error) {
    const code = classifyError(error)
    sendError(id, error, code)
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
