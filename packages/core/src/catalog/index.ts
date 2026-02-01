/**
 * Catalog module exports.
 *
 * The Catalog Service manages the primary workflow:
 * - Folder selection and persistence
 * - Asset discovery and scanning
 * - Flag management (pick/reject)
 * - Thumbnail generation coordination
 */

// Types
export type {
  Asset,
  FlagStatus,
  ThumbnailStatus,
  FilterMode,
  SortField,
  SortDirection,
  ViewMode,
  CatalogServiceStatus,
  CatalogServiceState,
  ScanProgress,
  ScanOptions,
  ScannedFile,
  ThumbnailQueueItem,
  CatalogErrorCode,
  IScanService,
  IThumbnailService,
  ICatalogService,
  ThumbnailReadyCallback,
  ThumbnailErrorCallback,
  AssetsAddedCallback,
  AssetUpdatedCallback,
  SupportedExtension,
  Adjustments,
  EditState,
  // Crop/Transform types
  CropRectangle,
  RotationParameters,
  CropTransform,
  // Mask types
  Point2D,
  MaskAdjustments,
  LinearGradientMask,
  RadialGradientMask,
  MaskStack,
  // Folder types
  FolderInfo,
} from './types'

// Classes and enums
export { CatalogError, ThumbnailPriority } from './types'

// Utility functions and constants
export {
  SUPPORTED_EXTENSIONS,
  isSupportedExtension,
  getExtension,
  getFilenameWithoutExtension,
  EDIT_SCHEMA_VERSION,
  DEFAULT_ADJUSTMENTS,
  createDefaultEditState,
  hasModifiedAdjustments,
  isModifiedToneCurve,
  migrateEditState,
  // Crop/Transform utilities
  DEFAULT_ROTATION,
  DEFAULT_CROP_TRANSFORM,
  isModifiedCropTransform,
  getTotalRotation,
  validateCropRectangle,
  cloneCropTransform,
  // Mask utilities
  DEFAULT_MASK_STACK,
  createDefaultMaskStack,
  createLinearMask,
  createRadialMask,
  isModifiedMaskStack,
  cloneMaskStack,
  cloneLinearMask,
  cloneRadialMask,
} from './types'

// Services
export { ScanService, createScanService } from './scan-service'
export { ThumbnailQueue, createThumbnailQueue, type ThumbnailQueueItemWithEditState } from './thumbnail-queue'
export {
  MemoryThumbnailCache,
  OPFSThumbnailCache,
  ThumbnailCache,
  createMemoryCache,
  createOPFSCache,
  createThumbnailCache,
  type IThumbnailCache,
} from './thumbnail-cache'
export {
  ThumbnailService,
  createThumbnailService,
  type ThumbnailServiceOptions,
} from './thumbnail-service'
export { CatalogService, createCatalogService } from './catalog-service'
export {
  MockCatalogService,
  createMockCatalogService,
  type MockCatalogServiceOptions,
} from './mock-catalog-service'
export * from './photo-processor'

// Demo assets
export {
  createDemoAsset,
  createDemoAssets,
  getDemoFlagCounts,
  filterDemoAssetsByFlag,
  type DemoAssetOptions,
} from './demo-assets'

// Database
export type { AssetRecord, FolderRecord, EditRecord, CacheMetadataRecord, EditStateRecord } from './db'

export {
  LiteroomDB,
  db,
  clearDatabase,
  getAssetCountsByFlag,
  getAssetsByFlag,
  updateAssetFlags,
  assetExistsByPath,
  getFolderByPath,
  // Edit state persistence
  saveEditStateToDb,
  loadEditStateFromDb,
  loadAllEditStatesFromDb,
  deleteEditStateFromDb,
  deleteEditStatesFromDb,
  // Asset removal
  removeAssets,
} from './db'
