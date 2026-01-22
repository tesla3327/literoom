/**
 * Types for the Export Service.
 *
 * The export workflow produces JPEG files from edited assets,
 * applying all transformations and encoding to the final output.
 */

import type { Asset, Adjustments, CropRectangle, RotationParameters } from '../catalog/types'
import type { ToneCurve } from '../decode/types'

// ============================================================================
// Export Scope
// ============================================================================

/**
 * Defines which assets to include in the export.
 * - 'picks': Only assets flagged as picks (default)
 * - 'selected': Only currently selected assets
 * - 'all': All assets in the catalog
 */
export type ExportScope = 'picks' | 'selected' | 'all'

// ============================================================================
// Export Options
// ============================================================================

/**
 * Configuration options for an export operation.
 */
export interface ExportOptions {
  /** Destination folder handle for writing files */
  destinationHandle: FileSystemDirectoryHandle
  /** Filename template (e.g., '{orig}_{seq:4}') */
  filenameTemplate: string
  /** JPEG quality (1-100, default: 90) */
  quality: number
  /** Resize to long edge pixels (0 = no resize) */
  resizeLongEdge: number
  /** Export scope - which assets to include */
  scope: ExportScope
  /** Include rejected images (default: false) */
  includeRejected?: boolean
  /** Start sequence number (default: 1) */
  startSequence?: number
}

// ============================================================================
// Export Progress
// ============================================================================

/**
 * Progress information during an export operation.
 */
export interface ExportProgress {
  /** Total number of images to export */
  total: number
  /** Current image index (1-based) */
  current: number
  /** Current filename being processed */
  currentFilename: string
  /** Whether export is complete */
  complete: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Callback for progress updates during export.
 */
export type ExportProgressCallback = (progress: ExportProgress) => void

// ============================================================================
// Export Result
// ============================================================================

/**
 * Result of an export operation.
 */
export interface ExportResult {
  /** Number of images successfully exported */
  successCount: number
  /** Number of images that failed */
  failureCount: number
  /** List of failed exports with error messages */
  failures: ExportFailure[]
  /** Destination folder name (for display) */
  destinationPath: string
}

/**
 * Information about a failed export.
 */
export interface ExportFailure {
  /** Asset ID that failed */
  assetId: string
  /** Original filename */
  filename: string
  /** Error message */
  error: string
}

// ============================================================================
// Edit State for Export
// ============================================================================

/**
 * Simplified edit state for export operations.
 * Contains only the fields needed for applying edits during export.
 */
export interface ExportEditState {
  /** Basic adjustments (exposure, contrast, etc.) */
  adjustments?: Adjustments
  /** Tone curve control points */
  toneCurve?: ToneCurve
  /** Crop region in normalized coordinates */
  crop?: CropRectangle | null
  /** Rotation parameters */
  rotation?: RotationParameters
}

// ============================================================================
// Export Service Dependencies
// ============================================================================

/**
 * Dependencies required by the ExportService.
 * These are injected to allow for mocking in tests.
 */
export interface ExportServiceDependencies {
  /**
   * Decode an image from bytes.
   */
  decodeImage: (bytes: Uint8Array, filename: string) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Apply rotation to image pixels.
   */
  applyRotation: (
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number,
    useLanczos?: boolean
  ) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Apply crop to image pixels.
   */
  applyCrop: (
    pixels: Uint8Array,
    width: number,
    height: number,
    crop: CropRectangle
  ) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Apply adjustments to image pixels.
   */
  applyAdjustments: (
    pixels: Uint8Array,
    width: number,
    height: number,
    adjustments: Adjustments
  ) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Apply tone curve to image pixels.
   */
  applyToneCurve: (
    pixels: Uint8Array,
    width: number,
    height: number,
    points: Array<{ x: number; y: number }>
  ) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Resize image pixels.
   */
  resize: (
    pixels: Uint8Array,
    width: number,
    height: number,
    newWidth: number,
    newHeight: number
  ) => Promise<{
    data: Uint8Array
    width: number
    height: number
  }>

  /**
   * Encode pixels to JPEG bytes.
   */
  encodeJpeg: (
    pixels: Uint8Array,
    width: number,
    height: number,
    quality: number
  ) => Promise<Uint8Array>

  /**
   * Get edit state for an asset.
   */
  getEditState: (assetId: string) => Promise<ExportEditState | null>

  /**
   * Load raw image bytes for an asset.
   */
  loadImageBytes: (asset: Asset) => Promise<Uint8Array>
}
