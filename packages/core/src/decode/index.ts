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
  type HistogramData,
  type ChannelClipping,
  type CurvePoint,
  type ToneCurve,
  type Adjustments,
  DEFAULT_TONE_CURVE,
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
  type ApplyAdjustmentsRequest,
  type ComputeHistogramRequest,
  type ApplyToneCurveRequest,
  type EncodeJpegRequest,
  type ApplyMaskedAdjustmentsRequest,
  type GenerateEditedThumbnailRequest,
  type MaskStackData,
  type EditedThumbnailEditState,
  type DecodeResponse,
  type DecodeSuccessResponse,
  type FileTypeResponse,
  type HistogramResponse,
  type ToneCurveResponse,
  type EncodeJpegResponse,
  type GenerateEditedThumbnailResponse,
  type DecodeErrorResponse
} from './worker-messages'

// Service
export { DecodeService, type IDecodeService } from './decode-service'

// Worker Pool
export { DecodeWorkerPool, type PoolOptions } from './decode-worker-pool'

// Mock service for testing
export {
  MockDecodeService,
  createTestImage,
  type MockDecodeServiceOptions
} from './mock-decode-service'

// Curve utilities
export { isLinearCurve, CURVE_POINT_TOLERANCE } from './curve-utils'
