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
    public readonly cause?: Error
  ) {
    super(message)
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
