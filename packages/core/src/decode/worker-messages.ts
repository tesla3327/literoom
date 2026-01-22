/**
 * Message types for communication between the main thread and decode worker.
 *
 * Uses discriminated union types for type-safe message handling.
 * Each message has a unique `id` for request/response correlation.
 */

import type { Adjustments, ErrorCode } from './types'

/**
 * Mask stack data for masked adjustments request.
 * Contains arrays of enabled/disabled linear and radial gradient masks.
 */
export interface MaskStackData {
  linearMasks: Array<{
    startX: number
    startY: number
    endX: number
    endY: number
    feather: number
    enabled: boolean
    adjustments: Partial<Adjustments>
  }>
  radialMasks: Array<{
    centerX: number
    centerY: number
    radiusX: number
    radiusY: number
    /** Rotation angle in degrees */
    rotation: number
    feather: number
    invert: boolean
    enabled: boolean
    adjustments: Partial<Adjustments>
  }>
}

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
  | ComputeHistogramRequest
  | ApplyToneCurveRequest
  | ApplyRotationRequest
  | ApplyCropRequest
  | EncodeJpegRequest
  | ApplyMaskedAdjustmentsRequest

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
 * Compute histogram from image pixels.
 */
export interface ComputeHistogramRequest {
  id: string
  type: 'compute-histogram'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
}

/**
 * Apply tone curve to image pixels.
 */
export interface ApplyToneCurveRequest {
  id: string
  type: 'apply-tone-curve'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Tone curve control points */
  points: Array<{ x: number; y: number }>
}

/**
 * Apply rotation to image pixels.
 */
export interface ApplyRotationRequest {
  id: string
  type: 'apply-rotation'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Rotation angle in degrees (positive = counter-clockwise) */
  angleDegrees: number
  /** Use high-quality Lanczos3 filter (slower) instead of bilinear */
  useLanczos: boolean
}

/**
 * Apply crop to image pixels.
 */
export interface ApplyCropRequest {
  id: string
  type: 'apply-crop'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Left edge position (0-1 normalized) */
  left: number
  /** Top edge position (0-1 normalized) */
  top: number
  /** Crop width (0-1 normalized) */
  cropWidth: number
  /** Crop height (0-1 normalized) */
  cropHeight: number
}

/**
 * Encode image pixels to JPEG bytes.
 */
export interface EncodeJpegRequest {
  id: string
  type: 'encode-jpeg'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** JPEG quality (1-100, recommended: 90) */
  quality: number
}

/**
 * Apply masked adjustments to image pixels.
 * Applies local adjustments (linear gradient, radial gradient masks)
 * with per-mask adjustment parameters.
 */
export interface ApplyMaskedAdjustmentsRequest {
  id: string
  type: 'apply-masked-adjustments'
  /** RGB pixel data (3 bytes per pixel) */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
  /** Mask stack containing linear and radial gradient masks */
  maskStack: MaskStackData
}

/**
 * Response message sent from decode worker to main thread.
 */
export type DecodeResponse =
  | DecodeSuccessResponse
  | FileTypeResponse
  | HistogramResponse
  | ToneCurveResponse
  | EncodeJpegResponse
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

/**
 * Histogram computation response.
 */
export interface HistogramResponse {
  id: string
  type: 'histogram'
  /** Red channel histogram (256 bins) */
  red: Uint32Array
  /** Green channel histogram (256 bins) */
  green: Uint32Array
  /** Blue channel histogram (256 bins) */
  blue: Uint32Array
  /** Luminance histogram (256 bins) */
  luminance: Uint32Array
  /** Maximum bin value across RGB channels */
  maxValue: number
  /** True if any channel has pixels at 255 */
  hasHighlightClipping: boolean
  /** True if any channel has pixels at 0 */
  hasShadowClipping: boolean
}

/**
 * Tone curve application response.
 */
export interface ToneCurveResponse {
  id: string
  type: 'tone-curve-result'
  /** Processed RGB pixel data */
  pixels: Uint8Array
  /** Image width */
  width: number
  /** Image height */
  height: number
}

/**
 * JPEG encoding response.
 */
export interface EncodeJpegResponse {
  id: string
  type: 'encode-jpeg-result'
  /** JPEG-encoded bytes */
  bytes: Uint8Array
}
