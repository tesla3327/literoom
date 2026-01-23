/**
 * Literoom Core - Shared TypeScript logic
 *
 * This package provides platform-agnostic interfaces and utilities
 * that work in both browser and Tauri environments.
 */

export * from './filesystem'

// Re-export decode module, excluding Adjustments (which is superseded by catalog/types Adjustments)
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
  DEFAULT_TONE_CURVE,
  DecodeError,
  filterToNumber,
  // Worker message types
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
  type DecodeErrorResponse,
  // Service
  DecodeService,
  type IDecodeService,
  // Worker Pool
  DecodeWorkerPool,
  type PoolOptions,
  // Mock service
  MockDecodeService,
  createTestImage,
  type MockDecodeServiceOptions,
} from './decode'

// Note: catalog/types exports Adjustments which includes toneCurve
// This is the authoritative Adjustments type to use for edit state
export * from './catalog'
export * from './export'
export * from './gpu'
