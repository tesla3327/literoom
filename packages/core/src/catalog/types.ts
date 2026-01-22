/**
 * Core types for the Catalog Service.
 *
 * The Catalog Service manages the primary workflow:
 * - Folder selection and persistence
 * - Asset discovery and scanning
 * - Flag management (pick/reject)
 * - Thumbnail generation coordination
 */

import type { ToneCurve } from '../decode/types'
import { DEFAULT_TONE_CURVE } from '../decode/types'

// ============================================================================
// Asset Types
// ============================================================================

/**
 * Represents a photo asset in the catalog.
 */
export interface Asset {
  /** Unique identifier (UUID) */
  id: string
  /** Reference to the containing folder */
  folderId: string
  /** Relative path from folder root */
  path: string
  /** Filename without extension */
  filename: string
  /** File extension (lowercase, without dot): 'arw', 'jpg', 'jpeg' */
  extension: string
  /** Flag status for culling workflow */
  flag: FlagStatus
  /** EXIF capture date, null if not available */
  captureDate: Date | null
  /** File system modification date */
  modifiedDate: Date
  /** File size in bytes */
  fileSize: number
  /** Image width in pixels (from EXIF or decode) */
  width?: number
  /** Image height in pixels (from EXIF or decode) */
  height?: number
  /** Current thumbnail generation status */
  thumbnailStatus: ThumbnailStatus
  /** Object URL for the thumbnail, null if not ready */
  thumbnailUrl: string | null
  /** Current preview 1x (2560px) generation status */
  preview1xStatus?: ThumbnailStatus
  /** Object URL for the preview 1x, null if not ready */
  preview1xUrl?: string | null
}

/**
 * Flag status for photo culling.
 * - 'none': Not yet flagged
 * - 'pick': Marked as a keeper
 * - 'reject': Marked for exclusion
 */
export type FlagStatus = 'none' | 'pick' | 'reject'

/**
 * Thumbnail generation status.
 * - 'pending': Not yet queued for generation
 * - 'loading': Currently being generated
 * - 'ready': Thumbnail available
 * - 'error': Generation failed
 */
export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error'

// ============================================================================
// Filter and Sort Types
// ============================================================================

/**
 * Filter modes for displaying assets.
 */
export type FilterMode = 'all' | 'picks' | 'rejects' | 'unflagged'

/**
 * Fields available for sorting assets.
 */
export type SortField = 'captureDate' | 'filename' | 'fileSize'

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc'

/**
 * View mode for the catalog display.
 */
export type ViewMode = 'grid' | 'loupe'

// ============================================================================
// Service State Types
// ============================================================================

/**
 * Catalog service status.
 * - 'initializing': Service is starting up
 * - 'ready': Service is ready for operations
 * - 'scanning': Currently scanning a folder
 * - 'error': Service encountered an error
 */
export type CatalogServiceStatus = 'initializing' | 'ready' | 'scanning' | 'error'

/**
 * Current state of the catalog service.
 */
export interface CatalogServiceState {
  /** Current service status */
  status: CatalogServiceStatus
  /** Error message if status is 'error' */
  error?: string
  /** Scan progress if status is 'scanning' */
  scanProgress?: ScanProgress
}

/**
 * Progress information during folder scanning.
 */
export interface ScanProgress {
  /** Total number of files found so far */
  totalFound: number
  /** Number of files processed */
  processed: number
  /** Currently processing file name */
  currentFile?: string
}

// ============================================================================
// Scan Types
// ============================================================================

/**
 * Options for folder scanning.
 */
export interface ScanOptions {
  /** Whether to scan subdirectories (default: true) */
  recursive?: boolean
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Represents a file discovered during scanning.
 */
export interface ScannedFile {
  /** Relative path from folder root */
  path: string
  /** Filename without extension */
  filename: string
  /** File extension (lowercase, without dot) */
  extension: string
  /** File size in bytes */
  fileSize: number
  /** File modification date */
  modifiedDate: Date
  /** Function to get the File object for reading */
  getFile: () => Promise<File>
}

// ============================================================================
// Thumbnail Types
// ============================================================================

/**
 * Priority levels for thumbnail generation.
 * Lower values = higher priority.
 */
export enum ThumbnailPriority {
  /** Currently visible in viewport */
  VISIBLE = 0,
  /** Within one screen of viewport */
  NEAR_VISIBLE = 1,
  /** Within two screens of viewport */
  PRELOAD = 2,
  /** Low priority background generation */
  BACKGROUND = 3,
}

/**
 * Item in the thumbnail generation queue.
 */
export interface ThumbnailQueueItem {
  /** Asset ID to generate thumbnail for */
  assetId: string
  /** Generation priority */
  priority: ThumbnailPriority
  /** Function to get the image bytes */
  getBytes: () => Promise<Uint8Array>
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for catalog operations.
 */
export type CatalogErrorCode =
  | 'PERMISSION_DENIED'
  | 'FOLDER_NOT_FOUND'
  | 'SCAN_CANCELLED'
  | 'DATABASE_ERROR'
  | 'STORAGE_FULL'
  | 'THUMBNAIL_ERROR'
  | 'UNKNOWN'

/**
 * Error thrown by catalog operations.
 */
export class CatalogError extends Error {
  override readonly name = 'CatalogError'

  constructor(
    message: string,
    public readonly code: CatalogErrorCode,
    override readonly cause?: Error
  ) {
    super(message, { cause })
  }
}

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Interface for the scan service.
 */
export interface IScanService {
  /**
   * Scan a directory for supported image files.
   * Yields batches of files for progressive UI updates.
   */
  scan(
    directory: FileSystemDirectoryHandle,
    options?: ScanOptions
  ): AsyncGenerator<ScannedFile[], void, unknown>
}

/**
 * Callback for thumbnail ready events.
 */
export type ThumbnailReadyCallback = (assetId: string, url: string) => void

/**
 * Callback for thumbnail error events.
 */
export type ThumbnailErrorCallback = (assetId: string, error: Error) => void

/**
 * Callback for preview ready events.
 */
export type PreviewReadyCallback = (assetId: string, url: string) => void

/**
 * Callback for preview error events.
 */
export type PreviewErrorCallback = (assetId: string, error: Error) => void

/**
 * Interface for the thumbnail service.
 */
export interface IThumbnailService {
  /**
   * Request thumbnail generation with priority.
   */
  requestThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): void

  /**
   * Update priority of a queued thumbnail request.
   */
  updatePriority(assetId: string, priority: ThumbnailPriority): void

  /**
   * Cancel a pending thumbnail request.
   */
  cancel(assetId: string): void

  /**
   * Cancel all pending thumbnail requests.
   */
  cancelAll(): void

  /**
   * Clear the in-memory thumbnail cache.
   */
  clearMemoryCache(): void

  /**
   * Set callback for when a thumbnail is ready.
   */
  onThumbnailReady: ThumbnailReadyCallback | null

  /**
   * Set callback for when a thumbnail fails.
   */
  onThumbnailError: ThumbnailErrorCallback | null

  /** Current queue size */
  readonly queueSize: number

  /** Whether the service is currently processing */
  readonly isProcessing: boolean

  // Preview generation methods

  /**
   * Request preview generation with priority.
   * Previews are larger (2560px) than thumbnails (512px).
   */
  requestPreview(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): void

  /**
   * Update priority of a queued preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void

  /**
   * Cancel a pending preview request.
   */
  cancelPreview(assetId: string): void

  /**
   * Cancel all pending preview requests.
   */
  cancelAllPreviews(): void

  /**
   * Clear the in-memory preview cache.
   */
  clearPreviewCache(): void

  /**
   * Set callback for when a preview is ready.
   */
  onPreviewReady: PreviewReadyCallback | null

  /**
   * Set callback for when a preview fails.
   */
  onPreviewError: PreviewErrorCallback | null

  /** Current preview queue size */
  readonly previewQueueSize: number

  /** Whether the service is currently processing previews */
  readonly isProcessingPreviews: boolean
}

/**
 * Callback for assets added event.
 */
export type AssetsAddedCallback = (assets: Asset[]) => void

/**
 * Callback for asset updated event.
 */
export type AssetUpdatedCallback = (asset: Asset) => void

/**
 * Interface for the main catalog service.
 */
export interface ICatalogService {
  /** Current service state */
  readonly state: CatalogServiceState

  /** Whether the service is ready for operations */
  readonly isReady: boolean

  // Folder management
  /**
   * Open folder picker and select a folder to scan.
   */
  selectFolder(): Promise<void>

  /**
   * Get the currently selected folder handle.
   */
  getCurrentFolder(): FileSystemDirectoryHandle | null

  // Scanning
  /**
   * Scan the current folder for images.
   */
  scanFolder(options?: ScanOptions): Promise<void>

  /**
   * Rescan the current folder for new/changed files.
   */
  rescanFolder(): Promise<void>

  /**
   * Cancel an in-progress scan.
   */
  cancelScan(): void

  // Asset access
  /**
   * Get a single asset by ID.
   */
  getAsset(id: string): Asset | undefined

  /**
   * Get all assets.
   */
  getAssets(): Asset[]

  // Flag management
  /**
   * Set the flag status for a single asset.
   */
  setFlag(assetId: string, flag: FlagStatus): Promise<void>

  /**
   * Set the flag status for multiple assets.
   */
  setFlagBatch(assetIds: string[], flag: FlagStatus): Promise<void>

  // Thumbnail requests
  /**
   * Request thumbnail generation for an asset.
   */
  requestThumbnail(assetId: string, priority: ThumbnailPriority): void

  /**
   * Update the priority of a thumbnail request.
   */
  updateThumbnailPriority(assetId: string, priority: ThumbnailPriority): void

  // Preview requests
  /**
   * Request preview generation for an asset.
   * Previews are larger (2560px) than thumbnails (512px).
   */
  requestPreview(assetId: string, priority: ThumbnailPriority): void

  /**
   * Update the priority of a preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void

  // Events
  /**
   * Set callback for when assets are added.
   */
  onAssetsAdded: AssetsAddedCallback | null

  /**
   * Set callback for when an asset is updated.
   */
  onAssetUpdated: AssetUpdatedCallback | null

  /**
   * Set callback for when a thumbnail is ready.
   */
  onThumbnailReady: ThumbnailReadyCallback | null

  /**
   * Set callback for when a preview is ready.
   */
  onPreviewReady: PreviewReadyCallback | null

  // Session restoration
  /**
   * Load an existing catalog from the database.
   * Returns true if a previous session was restored.
   */
  loadFromDatabase(): Promise<boolean>

  /**
   * Get a list of recent folders from the database.
   * Returns folders ordered by lastScanDate descending.
   */
  listFolders(limit?: number): Promise<FolderInfo[]>

  /**
   * Load a specific folder by its database ID.
   * Returns true if the folder was loaded successfully.
   */
  loadFolderById(folderId: number): Promise<boolean>

  // Cleanup
  /**
   * Clean up resources and close the service.
   */
  destroy(): void
}

/**
 * Information about a folder for the recent folders list.
 */
export interface FolderInfo {
  /** Database ID */
  id: number
  /** Display name */
  name: string
  /** Folder path */
  path: string
  /** Last scan date */
  lastScanDate: Date
  /** Whether the folder is currently accessible (permission granted) */
  isAccessible?: boolean
}

// ============================================================================
// Supported File Extensions
// ============================================================================

/**
 * File extensions supported by the catalog.
 */
export const SUPPORTED_EXTENSIONS = ['arw', 'jpg', 'jpeg'] as const

/**
 * Type for supported file extensions.
 */
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/**
 * Check if a file extension is supported.
 */
export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase() as SupportedExtension)
}

/**
 * Extract the extension from a filename (lowercase, without dot).
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return ''
  }
  return filename.slice(lastDot + 1).toLowerCase()
}

/**
 * Extract the filename without extension.
 */
export function getFilenameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1) {
    return filename
  }
  return filename.slice(0, lastDot)
}

// ============================================================================
// Edit Types
// ============================================================================

/**
 * Current schema version for edit state.
 * Increment when making breaking changes to the schema.
 * Version history:
 * - v1: Initial version with basic adjustments
 * - v2: Added tone curve to adjustments
 * - v3: Added crop transform
 * - v4: Added local masks (linear gradient, radial gradient)
 */
export const EDIT_SCHEMA_VERSION = 4

/**
 * Basic image adjustments.
 * All values use normalized ranges that the WASM pipeline interprets.
 */
export interface Adjustments {
  /** White balance temperature: -100 to 100 (cool to warm) */
  temperature: number
  /** White balance tint: -100 to 100 (green to magenta) */
  tint: number
  /** Exposure compensation: -5 to 5 stops */
  exposure: number
  /** Contrast adjustment: -100 to 100 */
  contrast: number
  /** Highlights recovery: -100 to 100 */
  highlights: number
  /** Shadow lift: -100 to 100 */
  shadows: number
  /** White point: -100 to 100 */
  whites: number
  /** Black point: -100 to 100 */
  blacks: number
  /** Vibrance (saturation of less-saturated colors): -100 to 100 */
  vibrance: number
  /** Global saturation: -100 to 100 */
  saturation: number
  /** Tone curve control points */
  toneCurve: ToneCurve
}

/**
 * Default adjustment values (no modifications).
 */
export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  toneCurve: DEFAULT_TONE_CURVE,
})

/**
 * Full edit state for an asset.
 * Versioned for future schema migrations.
 */
export interface EditState {
  /** Schema version for migrations */
  version: typeof EDIT_SCHEMA_VERSION
  /** Basic adjustment values */
  adjustments: Adjustments
  /** Crop and rotation settings */
  cropTransform: CropTransform
  /** Local adjustment masks (linear gradient, radial gradient) */
  masks?: MaskStack
}

/**
 * Create a new default edit state.
 */
export function createDefaultEditState(): EditState {
  return {
    version: EDIT_SCHEMA_VERSION,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    cropTransform: cloneCropTransform(DEFAULT_CROP_TRANSFORM),
  }
}

/**
 * Check if a tone curve differs from the default linear curve.
 */
export function isModifiedToneCurve(curve: ToneCurve): boolean {
  const defaultPoints = DEFAULT_TONE_CURVE.points
  if (curve.points.length !== defaultPoints.length) return true

  for (let i = 0; i < curve.points.length; i++) {
    if (
      Math.abs(curve.points[i].x - defaultPoints[i].x) > 0.001
      || Math.abs(curve.points[i].y - defaultPoints[i].y) > 0.001
    ) {
      return true
    }
  }

  return false
}

/**
 * Check if adjustments differ from defaults.
 */
export function hasModifiedAdjustments(adjustments: Adjustments): boolean {
  // Check numeric adjustments
  const numericKeys: (keyof Omit<Adjustments, 'toneCurve'>)[] = [
    'temperature',
    'tint',
    'exposure',
    'contrast',
    'highlights',
    'shadows',
    'whites',
    'blacks',
    'vibrance',
    'saturation',
  ]

  if (numericKeys.some(key => adjustments[key] !== DEFAULT_ADJUSTMENTS[key])) {
    return true
  }

  // Check tone curve
  return isModifiedToneCurve(adjustments.toneCurve)
}

// ============================================================================
// Crop/Transform Types
// ============================================================================

/**
 * Crop rectangle in normalized coordinates (0-1).
 * Origin is top-left of the image.
 */
export interface CropRectangle {
  /** Left edge position (0-1) */
  left: number
  /** Top edge position (0-1) */
  top: number
  /** Width of crop region (0-1) */
  width: number
  /** Height of crop region (0-1) */
  height: number
}

/**
 * Rotation parameters.
 */
export interface RotationParameters {
  /** Main rotation angle in degrees (-180 to 180) */
  angle: number
  /** Additional straighten angle in degrees (typically small, -45 to 45) */
  straighten: number
}

/**
 * Combined crop and transform state.
 * Transform order: Rotate -> Crop -> Adjustments -> Tone Curve
 */
export interface CropTransform {
  /** Crop region, or null for no crop (full image) */
  crop: CropRectangle | null
  /** Rotation parameters */
  rotation: RotationParameters
}

/**
 * Default rotation parameters (no rotation).
 */
export const DEFAULT_ROTATION: Readonly<RotationParameters> = Object.freeze({
  angle: 0,
  straighten: 0,
})

/**
 * Default crop transform (no crop, no rotation).
 */
export const DEFAULT_CROP_TRANSFORM: Readonly<CropTransform> = Object.freeze({
  crop: null,
  rotation: DEFAULT_ROTATION,
})

/**
 * Check if crop transform differs from default.
 */
export function isModifiedCropTransform(transform: CropTransform): boolean {
  // Check rotation
  if (transform.rotation.angle !== 0 || transform.rotation.straighten !== 0) {
    return true
  }
  // Check crop
  if (transform.crop !== null) {
    return true
  }
  return false
}

/**
 * Get total rotation angle (main + straighten).
 */
export function getTotalRotation(rotation: RotationParameters): number {
  return rotation.angle + rotation.straighten
}

/**
 * Validate crop rectangle bounds.
 * Returns true if valid, false otherwise.
 */
export function validateCropRectangle(crop: CropRectangle): boolean {
  if (crop.left < 0 || crop.left > 1) return false
  if (crop.top < 0 || crop.top > 1) return false
  if (crop.width <= 0 || crop.width > 1) return false
  if (crop.height <= 0 || crop.height > 1) return false
  if (crop.left + crop.width > 1.001) return false // Small tolerance
  if (crop.top + crop.height > 1.001) return false
  return true
}

/**
 * Create a deep copy of a crop transform.
 */
export function cloneCropTransform(transform: CropTransform): CropTransform {
  return {
    crop: transform.crop ? { ...transform.crop } : null,
    rotation: { ...transform.rotation },
  }
}

// ============================================================================
// Mask Types
// ============================================================================

/**
 * 2D point in normalized coordinates (0-1).
 */
export interface Point2D {
  x: number
  y: number
}

/**
 * Adjustments that can be applied to a mask region.
 * Uses Partial<Adjustments> without toneCurve since masks don't support curves.
 */
export type MaskAdjustments = Partial<Omit<Adjustments, 'toneCurve'>>

/**
 * Linear gradient mask definition.
 * Creates a gradient effect between two points with feathering.
 * Effect is full (1.0) at the start point and zero at the end point.
 */
export interface LinearGradientMask {
  /** Unique identifier (UUID) */
  id: string
  /** Start point in normalized coordinates (0-1), where effect is strongest */
  start: Point2D
  /** End point in normalized coordinates (0-1), where effect fades to zero */
  end: Point2D
  /** Feather amount (0-1, where 0 = hard edge, 1 = full gradient) */
  feather: number
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments to apply in the masked region */
  adjustments: MaskAdjustments
}

/**
 * Radial gradient mask definition.
 * Creates an elliptical gradient effect from center outward.
 */
export interface RadialGradientMask {
  /** Unique identifier (UUID) */
  id: string
  /** Center point in normalized coordinates (0-1) */
  center: Point2D
  /** Horizontal radius (0-1 normalized to image width) */
  radiusX: number
  /** Vertical radius (0-1 normalized to image height) */
  radiusY: number
  /** Rotation angle in degrees */
  rotation: number
  /** Feather amount (0-1, where 0 = hard edge at ellipse boundary) */
  feather: number
  /** Whether effect is inside (false) or outside (true) the ellipse */
  invert: boolean
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments to apply in the masked region */
  adjustments: MaskAdjustments
}

/**
 * Container for all masks on an asset.
 * Masks are applied sequentially in their array order.
 */
export interface MaskStack {
  /** Linear gradient masks (applied in order) */
  linearMasks: LinearGradientMask[]
  /** Radial gradient masks (applied in order) */
  radialMasks: RadialGradientMask[]
}

/**
 * Default empty mask stack.
 */
export const DEFAULT_MASK_STACK: Readonly<MaskStack> = Object.freeze({
  linearMasks: [],
  radialMasks: [],
})

/**
 * Create a new empty mask stack.
 */
export function createDefaultMaskStack(): MaskStack {
  return {
    linearMasks: [],
    radialMasks: [],
  }
}

/**
 * Create a new linear gradient mask with default settings.
 */
export function createLinearMask(
  start: Point2D = { x: 0.3, y: 0.5 },
  end: Point2D = { x: 0.7, y: 0.5 }
): LinearGradientMask {
  return {
    id: crypto.randomUUID(),
    start: { ...start },
    end: { ...end },
    feather: 0.5,
    enabled: true,
    adjustments: {},
  }
}

/**
 * Create a new radial gradient mask with default settings.
 */
export function createRadialMask(
  center: Point2D = { x: 0.5, y: 0.5 },
  radiusX: number = 0.3,
  radiusY: number = 0.3
): RadialGradientMask {
  return {
    id: crypto.randomUUID(),
    center: { ...center },
    radiusX,
    radiusY,
    rotation: 0,
    feather: 0.3,
    invert: false,
    enabled: true,
    adjustments: {},
  }
}

/**
 * Check if mask stack differs from default (i.e., has any masks).
 */
export function isModifiedMaskStack(masks: MaskStack | undefined): boolean {
  if (!masks) return false
  return masks.linearMasks.length > 0 || masks.radialMasks.length > 0
}

/**
 * Create a deep copy of a mask stack.
 */
export function cloneMaskStack(masks: MaskStack): MaskStack {
  return {
    linearMasks: masks.linearMasks.map(m => ({
      ...m,
      start: { ...m.start },
      end: { ...m.end },
      adjustments: { ...m.adjustments },
    })),
    radialMasks: masks.radialMasks.map(m => ({
      ...m,
      center: { ...m.center },
      adjustments: { ...m.adjustments },
    })),
  }
}

/**
 * Create a deep copy of a linear gradient mask.
 */
export function cloneLinearMask(mask: LinearGradientMask): LinearGradientMask {
  return {
    ...mask,
    start: { ...mask.start },
    end: { ...mask.end },
    adjustments: { ...mask.adjustments },
  }
}

/**
 * Create a deep copy of a radial gradient mask.
 */
export function cloneRadialMask(mask: RadialGradientMask): RadialGradientMask {
  return {
    ...mask,
    center: { ...mask.center },
    adjustments: { ...mask.adjustments },
  }
}

// ============================================================================
// Edit State Migration
// ============================================================================

/**
 * Migrate edit state from previous schema versions to current version.
 * Returns a new EditState object without modifying the input.
 */
export function migrateEditState(state: unknown): EditState {
  // Handle null/undefined
  if (!state || typeof state !== 'object') {
    return createDefaultEditState()
  }

  const s = state as Record<string, unknown>

  // Get current version (default to 1 for legacy states without version)
  const version = typeof s.version === 'number' ? s.version : 1

  // Already at current version
  if (version === EDIT_SCHEMA_VERSION) {
    return state as EditState
  }

  // Build migrated state progressively
  let migrated: EditState = createDefaultEditState()

  // v1 -> v2: Added tone curve (already in Adjustments)
  if (version >= 1 && s.adjustments && typeof s.adjustments === 'object') {
    const adj = s.adjustments as Record<string, unknown>
    migrated.adjustments = {
      ...migrated.adjustments,
      temperature: typeof adj.temperature === 'number' ? adj.temperature : 0,
      tint: typeof adj.tint === 'number' ? adj.tint : 0,
      exposure: typeof adj.exposure === 'number' ? adj.exposure : 0,
      contrast: typeof adj.contrast === 'number' ? adj.contrast : 0,
      highlights: typeof adj.highlights === 'number' ? adj.highlights : 0,
      shadows: typeof adj.shadows === 'number' ? adj.shadows : 0,
      whites: typeof adj.whites === 'number' ? adj.whites : 0,
      blacks: typeof adj.blacks === 'number' ? adj.blacks : 0,
      vibrance: typeof adj.vibrance === 'number' ? adj.vibrance : 0,
      saturation: typeof adj.saturation === 'number' ? adj.saturation : 0,
    }

    // Migrate tone curve if present
    if (adj.toneCurve && typeof adj.toneCurve === 'object') {
      const tc = adj.toneCurve as Record<string, unknown>
      if (Array.isArray(tc.points)) {
        migrated.adjustments.toneCurve = { points: tc.points }
      }
    }
  }

  // v3: Added crop transform
  if (version >= 3 && s.cropTransform && typeof s.cropTransform === 'object') {
    const ct = s.cropTransform as Record<string, unknown>

    // Migrate crop
    if (ct.crop && typeof ct.crop === 'object') {
      const crop = ct.crop as Record<string, unknown>
      migrated.cropTransform.crop = {
        left: typeof crop.left === 'number' ? crop.left : 0,
        top: typeof crop.top === 'number' ? crop.top : 0,
        width: typeof crop.width === 'number' ? crop.width : 1,
        height: typeof crop.height === 'number' ? crop.height : 1,
      }
    }

    // Migrate rotation
    if (ct.rotation && typeof ct.rotation === 'object') {
      const rot = ct.rotation as Record<string, unknown>
      migrated.cropTransform.rotation = {
        angle: typeof rot.angle === 'number' ? rot.angle : 0,
        straighten: typeof rot.straighten === 'number' ? rot.straighten : 0,
      }
    }
  }

  // v4: Added masks (new in current version, just ensure undefined for older states)
  // Masks are optional and default to undefined
  migrated.masks = undefined

  return migrated
}
