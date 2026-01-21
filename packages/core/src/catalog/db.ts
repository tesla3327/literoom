/**
 * Dexie database schema for the Literoom catalog.
 *
 * This module defines the IndexedDB schema used to persist:
 * - Folder references and handles
 * - Asset metadata and flags
 * - Edit settings
 * - Cache metadata
 */

import Dexie, { type Table } from 'dexie'

// ============================================================================
// Database Record Types (Internal)
// ============================================================================

/**
 * Database record for an asset.
 * Uses auto-increment id for internal references and uuid for application-level ID.
 */
export interface AssetRecord {
  /** Auto-increment primary key */
  id?: number
  /** Application-level UUID */
  uuid: string
  /** Foreign key to folders table */
  folderId: number
  /** Relative path from folder root */
  path: string
  /** Filename without extension */
  filename: string
  /** File extension (lowercase, without dot) */
  extension: string
  /** Flag status: 'none', 'pick', or 'reject' */
  flag: 'none' | 'pick' | 'reject'
  /** EXIF capture date, null if not available */
  captureDate: Date | null
  /** File modification date */
  modifiedDate: Date
  /** File size in bytes */
  fileSize: number
  /** Image width in pixels */
  width?: number
  /** Image height in pixels */
  height?: number
}

/**
 * Database record for a folder.
 */
export interface FolderRecord {
  /** Auto-increment primary key */
  id?: number
  /** Unique folder path (for lookup) */
  path: string
  /** Display name */
  name: string
  /** Key for FileSystemProvider.loadHandle() */
  handleKey: string
  /** Last scan timestamp */
  lastScanDate: Date
}

/**
 * Database record for edit settings.
 * One-to-one relationship with assets.
 */
export interface EditRecord {
  /** Foreign key to assets.id */
  assetId: number
  /** Schema version for migrations */
  schemaVersion: number
  /** Last update timestamp */
  updatedAt: Date
  /** JSON serialized edit settings */
  settings: string
}

/**
 * Database record for cache metadata.
 * Tracks which caches are available for each asset.
 */
export interface CacheMetadataRecord {
  /** Foreign key to assets.id */
  assetId: number
  /** Whether thumbnail is cached */
  thumbnailReady: boolean
  /** Whether 1x preview is cached */
  preview1xReady: boolean
  /** Whether 2x preview is cached */
  preview2xReady: boolean
}

// ============================================================================
// Database Class
// ============================================================================

/**
 * Literoom catalog database using Dexie.js.
 *
 * Index design:
 * - assets: Compound indexes for efficient filtering by flag + date
 * - folders: Unique path index for lookup
 * - edits: Unique assetId for 1:1 relationship
 * - cacheMetadata: Unique assetId for 1:1 relationship
 */
export class LiteroomDB extends Dexie {
  assets!: Table<AssetRecord, number>
  folders!: Table<FolderRecord, number>
  edits!: Table<EditRecord, number>
  cacheMetadata!: Table<CacheMetadataRecord, number>

  constructor() {
    super('LiteroomCatalog')

    this.version(1).stores({
      // Assets table with indexes for:
      // - uuid: unique application ID lookup
      // - folderId: filter by folder
      // - path: check for duplicates
      // - filename: search by name
      // - flag: filter by flag status
      // - captureDate: sort by date
      // - [flag+captureDate]: compound index for filtered sorting
      // - [folderId+captureDate]: compound index for folder + date queries
      assets:
        '++id, &uuid, folderId, path, filename, flag, captureDate, [flag+captureDate], [folderId+captureDate]',

      // Folders table with unique path
      folders: '++id, &path',

      // Edits table with unique assetId (1:1 with assets)
      edits: '&assetId, schemaVersion',

      // Cache metadata with unique assetId (1:1 with assets)
      cacheMetadata: '&assetId',
    })
  }
}

// ============================================================================
// Database Instance
// ============================================================================

/**
 * Singleton database instance.
 * Use this for all database operations.
 */
export const db = new LiteroomDB()

// ============================================================================
// Database Utilities
// ============================================================================

/**
 * Clear all data from the database.
 * Use with caution - this is destructive.
 */
export async function clearDatabase(): Promise<void> {
  await db.transaction('rw', [db.assets, db.folders, db.edits, db.cacheMetadata], async () => {
    await db.assets.clear()
    await db.folders.clear()
    await db.edits.clear()
    await db.cacheMetadata.clear()
  })
}

/**
 * Get the count of assets by flag status.
 */
export async function getAssetCountsByFlag(): Promise<{
  all: number
  picks: number
  rejects: number
  unflagged: number
}> {
  const [all, picks, rejects] = await Promise.all([
    db.assets.count(),
    db.assets.where('flag').equals('pick').count(),
    db.assets.where('flag').equals('reject').count(),
  ])

  return {
    all,
    picks,
    rejects,
    unflagged: all - picks - rejects,
  }
}

/**
 * Get assets filtered by flag and sorted by capture date.
 */
export async function getAssetsByFlag(
  flag: 'all' | 'pick' | 'reject' | 'none',
  options: { limit?: number; offset?: number; descending?: boolean } = {}
): Promise<AssetRecord[]> {
  const { limit, offset = 0, descending = true } = options

  let collection

  if (flag === 'all') {
    collection = db.assets.orderBy('captureDate')
  } else {
    // Use compound index for filtered + sorted query
    collection = db.assets.where('[flag+captureDate]').between([flag, Dexie.minKey], [flag, Dexie.maxKey])
  }

  if (descending) {
    collection = collection.reverse()
  }

  if (offset > 0) {
    collection = collection.offset(offset)
  }

  if (limit !== undefined) {
    collection = collection.limit(limit)
  }

  return collection.toArray()
}

/**
 * Update the flag status for multiple assets.
 */
export async function updateAssetFlags(
  assetIds: number[],
  flag: 'none' | 'pick' | 'reject'
): Promise<void> {
  await db.assets.where('id').anyOf(assetIds).modify({ flag })
}

/**
 * Check if an asset exists by path within a folder.
 */
export async function assetExistsByPath(folderId: number, path: string): Promise<boolean> {
  const count = await db.assets.where({ folderId, path }).count()
  return count > 0
}

/**
 * Get a folder by its path.
 */
export async function getFolderByPath(path: string): Promise<FolderRecord | undefined> {
  return db.folders.where('path').equals(path).first()
}
