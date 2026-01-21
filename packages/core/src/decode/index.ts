/**
 * Decode module - Image decoding and processing pipeline.
 *
 * This module provides types and utilities for decoding JPEG and RAW images
 * using a Web Worker with WASM for non-blocking operations.
 */

// Core types
export {
  type DecodedImage,
  type ThumbnailOptions,
  type PreviewOptions,
  type FilterType,
  type FileType,
  type ErrorCode,
  type DecodeServiceState,
  DecodeError,
  filterToNumber
} from './types'

// Worker message types
export {
  type DecodeRequest,
  type DecodeJpegRequest,
  type DecodeRawThumbnailRequest,
  type GenerateThumbnailRequest,
  type GeneratePreviewRequest,
  type DetectFileTypeRequest,
  type DecodeResponse,
  type DecodeSuccessResponse,
  type FileTypeResponse,
  type DecodeErrorResponse
} from './worker-messages'
