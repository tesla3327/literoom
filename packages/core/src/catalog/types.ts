/**
 * Core types for the Catalog Service.
 *
 * The Catalog Service manages the primary workflow:
 * - Folder selection and persistence
 * - Asset discovery and scanning
 * - Flag management (pick/reject)
 * - Thumbnail generation coordination
 */

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

  // Cleanup
  /**
   * Clean up resources and close the service.
   */
  destroy(): void
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
