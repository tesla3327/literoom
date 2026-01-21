/**
 * Core types for the image decode pipeline.
 *
 * These types define the interface between the main thread and the
 * decode worker, enabling type-safe communication for image operations.
 */

/**
 * Represents a decoded image with raw RGB pixel data.
 */
export interface DecodedImage {
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
  /** Raw RGB pixel data (3 bytes per pixel: R, G, B) */
  pixels: Uint8Array
}

/**
 * Options for thumbnail generation.
 */
export interface ThumbnailOptions {
  /** Target size for the longest edge (default: 256) */
  size?: number
}

/**
 * Options for preview generation.
 */
export interface PreviewOptions {
  /** Maximum edge length in pixels (e.g., 2560 for 1x, 5120 for 2x) */
  maxEdge: number
  /** Resize filter algorithm (default: lanczos3) */
  filter?: FilterType
}

/**
 * Resize filter algorithms.
 * - nearest: Fastest, lowest quality (blocky)
 * - bilinear: Fast, good for thumbnails
 * - lanczos3: Slowest, highest quality (best for previews)
 */
export type FilterType = 'nearest' | 'bilinear' | 'lanczos3'

/**
 * Detected file type based on magic bytes.
 */
export type FileType = 'jpeg' | 'raw' | 'unknown'

/**
 * Error codes for decode operations.
 */
export type ErrorCode =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'CORRUPTED_FILE'
  | 'OUT_OF_MEMORY'
  | 'WORKER_ERROR'
  | 'WASM_INIT_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN'

/**
 * Error thrown by decode operations.
 */
export class DecodeError extends Error {
  override readonly name = 'DecodeError'

  constructor(
    message: string,
    public readonly code: ErrorCode,
    override readonly cause?: Error
  ) {
    super(message, { cause })
  }
}

/**
 * State of the decode service.
 */
export interface DecodeServiceState {
  /** Current status of the service */
  status: 'initializing' | 'ready' | 'error'
  /** Error message if status is 'error' */
  error?: string
}

/**
 * Basic adjustment values for image processing.
 *
 * These correspond to the 10 sliders in the edit panel.
 */
export interface Adjustments {
  /** White balance warm/cool shift (-100 to +100) */
  temperature: number
  /** Green/magenta tint shift (-100 to +100) */
  tint: number
  /** Exposure in stops (-5 to +5) */
  exposure: number
  /** Contrast adjustment (-100 to +100) */
  contrast: number
  /** Highlight recovery (-100 to +100) */
  highlights: number
  /** Shadow recovery (-100 to +100) */
  shadows: number
  /** White point adjustment (-100 to +100) */
  whites: number
  /** Black point adjustment (-100 to +100) */
  blacks: number
  /** Vibrance - smart saturation (-100 to +100) */
  vibrance: number
  /** Global saturation (-100 to +100) */
  saturation: number
}

/**
 * Histogram data for an image.
 *
 * Contains 256-bin histograms for RGB and luminance channels,
 * plus clipping indicators.
 */
export interface HistogramData {
  /** Red channel histogram (256 bins) */
  red: Uint32Array
  /** Green channel histogram (256 bins) */
  green: Uint32Array
  /** Blue channel histogram (256 bins) */
  blue: Uint32Array
  /** Luminance histogram (256 bins) */
  luminance: Uint32Array
  /** Maximum bin value across RGB channels (for normalization) */
  maxValue: number
  /** True if any channel has pixels at value 255 */
  hasHighlightClipping: boolean
  /** True if any channel has pixels at value 0 */
  hasShadowClipping: boolean
}

/**
 * Convert filter type string to numeric value for WASM.
 */
export function filterToNumber(filter: FilterType | undefined): number {
  switch (filter) {
    case 'nearest':
      return 0
    case 'bilinear':
      return 1
    case 'lanczos3':
    default:
      return 2
  }
}
