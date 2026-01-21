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
} from './types'

// Classes and enums
export { CatalogError, ThumbnailPriority } from './types'

// Utility functions
export {
  SUPPORTED_EXTENSIONS,
  isSupportedExtension,
  getExtension,
  getFilenameWithoutExtension,
} from './types'

// Services
export { ScanService, createScanService } from './scan-service'
export { ThumbnailQueue, createThumbnailQueue } from './thumbnail-queue'
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

// Demo assets
export {
  createDemoAsset,
  createDemoAssets,
  getDemoFlagCounts,
  filterDemoAssetsByFlag,
  type DemoAssetOptions,
} from './demo-assets'

// Database
export type { AssetRecord, FolderRecord, EditRecord, CacheMetadataRecord } from './db'

export {
  LiteroomDB,
  db,
  clearDatabase,
  getAssetCountsByFlag,
  getAssetsByFlag,
  updateAssetFlags,
  assetExistsByPath,
  getFolderByPath,
} from './db'
