/**
 * Message types for communication between the main thread and decode worker.
 *
 * Uses discriminated union types for type-safe message handling.
 * Each message has a unique `id` for request/response correlation.
 */

import type { Adjustments, ErrorCode } from './types'

/**
 * Request message sent from main thread to decode worker.
 */
export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest
  | ApplyAdjustmentsRequest

/**
 * Decode a JPEG file to raw RGB pixels.
 */
export interface DecodeJpegRequest {
  id: string
  type: 'decode-jpeg'
  bytes: Uint8Array
}

/**
 * Extract and decode the embedded thumbnail from a RAW file.
 */
export interface DecodeRawThumbnailRequest {
  id: string
  type: 'decode-raw-thumbnail'
  bytes: Uint8Array
}

/**
 * Generate a thumbnail from image bytes.
 */
export interface GenerateThumbnailRequest {
  id: string
  type: 'generate-thumbnail'
  bytes: Uint8Array
  /** Target size for longest edge */
  size: number
}

/**
 * Generate a preview from image bytes.
 */
export interface GeneratePreviewRequest {
  id: string
  type: 'generate-preview'
  bytes: Uint8Array
  /** Maximum edge length */
  maxEdge: number
  /** Filter type (0=nearest, 1=bilinear, 2=lanczos3) */
  filter: number
}

/**
 * Detect the file type from magic bytes.
 */
export interface DetectFileTypeRequest {
  id: string
  type: 'detect-file-type'
  bytes: Uint8Array
}

/**
 * Apply adjustments to image pixels.
 */
export interface ApplyAdjustmentsRequest {
  id: string
  type: 'apply-adjustments'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Adjustment values to apply */
  adjustments: Adjustments
}

/**
 * Response message sent from decode worker to main thread.
 */
export type DecodeResponse =
  | DecodeSuccessResponse
  | FileTypeResponse
  | DecodeErrorResponse

/**
 * Successful decode response with image data.
 */
export interface DecodeSuccessResponse {
  id: string
  type: 'success'
  width: number
  height: number
  /** RGB pixel data (transferred, not copied) */
  pixels: Uint8Array
}

/**
 * File type detection response.
 */
export interface FileTypeResponse {
  id: string
  type: 'file-type'
  fileType: 'jpeg' | 'raw' | 'unknown'
}

/**
 * Error response from decode operation.
 */
export interface DecodeErrorResponse {
  id: string
  type: 'error'
  message: string
  code: ErrorCode
}
