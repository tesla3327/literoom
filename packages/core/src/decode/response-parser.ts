/**
 * Response Parser - Shared logic for parsing DecodeResponse messages.
 *
 * This module extracts the common response parsing logic used by both
 * DecodeService and DecodeWorkerPool to DRY up the handleResponse methods.
 */

import type { DecodeResponse } from './worker-messages'
import type { DecodedImage, FileType, HistogramData, ErrorCode } from './types'
import { DecodeError } from './types'

/**
 * Union type of all possible response values.
 */
export type ResponseValue = DecodedImage | FileType | HistogramData | Uint8Array

/**
 * Result of parsing a decode response.
 */
export type ParsedResponse =
  | { type: 'success'; value: ResponseValue }
  | { type: 'error'; error: DecodeError }

/**
 * Parse a DecodeResponse into a success value or error.
 * Consolidates the response handling logic from both DecodeService and DecodeWorkerPool.
 */
export function parseDecodeResponse(response: DecodeResponse): ParsedResponse {
  switch (response.type) {
    case 'error':
      return {
        type: 'error',
        error: new DecodeError(response.message, response.code as ErrorCode)
      }

    case 'file-type':
      return { type: 'success', value: response.fileType }

    case 'success':
    case 'tone-curve-result':
      // Both return DecodedImage
      return {
        type: 'success',
        value: {
          width: response.width,
          height: response.height,
          pixels: response.pixels
        }
      }

    case 'histogram':
      return {
        type: 'success',
        value: {
          red: response.red,
          green: response.green,
          blue: response.blue,
          luminance: response.luminance,
          maxValue: response.maxValue,
          hasHighlightClipping: response.hasHighlightClipping,
          hasShadowClipping: response.hasShadowClipping
        }
      }

    case 'encode-jpeg-result':
    case 'generate-edited-thumbnail-result':
      // Both return Uint8Array
      return { type: 'success', value: response.bytes }

    default:
      // Exhaustive check - should never reach here
      return {
        type: 'error',
        error: new DecodeError(`Unknown response type`, 'UNKNOWN')
      }
  }
}
