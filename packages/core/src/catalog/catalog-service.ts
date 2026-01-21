/**
 * Catalog Service - Main service for managing the photo catalog.
 *
 * The Catalog Service is the primary interface for:
 * - Folder selection and persistence
 * - Asset discovery through scanning
 * - Flag management (pick/reject)
 * - Thumbnail generation coordination
 * - Asset state management
 *
 * This service composes:
 * - ScanService: Folder scanning
 * - ThumbnailService: Thumbnail generation with priority queue
 * - Dexie database: Persistent storage
 */

import type { IDecodeService } from '../decode/decode-service'
import {
  type Asset,
  type FlagStatus,
  type ICatalogService,
  type IScanService,
  type IThumbnailService,
  type CatalogServiceState,
  type ScanOptions,
  type ScanProgress,
  type AssetsAddedCallback,
  type AssetUpdatedCallback,
  type ThumbnailReadyCallback,
  ThumbnailPriority,
  CatalogError,
} from './types'
import { ScanService } from './scan-service'
import { ThumbnailService } from './thumbnail-service'
import { db, type AssetRecord, type FolderRecord } from './db'

// ============================================================================
// Constants
// ============================================================================

/** Key prefix for storing folder handles */
const FOLDER_HANDLE_KEY_PREFIX = 'literoom-folder-'

// ============================================================================
// Catalog Service Implementation
// ============================================================================

/**
 * Main service for managing the photo catalog.
 *
 * Usage:
 * ```typescript
 * const catalogService = await CatalogService.create(decodeService)
 *
 * catalogService.onAssetsAdded = (assets) => {
 *   // Update UI with new assets
 * }
 *
 * catalogService.onThumbnailReady = (assetId, url) => {
 *   // Update UI with thumbnail
 * }
 *
 * await catalogService.selectFolder()
 * await catalogService.scanFolder()
 * ```
 */
export class CatalogService implements ICatalogService {
  // Services
  private readonly scanService: IScanService
  private readonly thumbnailService: IThumbnailService

  // State
  private _state: CatalogServiceState = { status: 'initializing' }
  private _currentFolder: FileSystemDirectoryHandle | null = null
  private _currentFolderId: number | null = null
  private _assets: Map<string, Asset> = new Map()

  // Scan control
  private _abortController: AbortController | null = null

  // Callbacks
  private _onAssetsAdded: AssetsAddedCallback | null = null
  private _onAssetUpdated: AssetUpdatedCallback | null = null
  private _onThumbnailReady: ThumbnailReadyCallback | null = null

  /**
   * Private constructor - use CatalogService.create() instead.
   */
  private constructor(
    scanService: IScanService,
    thumbnailService: IThumbnailService
  ) {
    this.scanService = scanService
    this.thumbnailService = thumbnailService

    // Wire up thumbnail callbacks
    this.thumbnailService.onThumbnailReady = this.handleThumbnailReady.bind(this)
    this.thumbnailService.onThumbnailError = this.handleThumbnailError.bind(this)
  }

  /**
   * Create a new CatalogService instance.
   */
  static async create(decodeService: IDecodeService): Promise<CatalogService> {
    const scanService = new ScanService()
    const thumbnailService = await ThumbnailService.create(decodeService)

    const service = new CatalogService(scanService, thumbnailService)
    service._state = { status: 'ready' }

    return service
  }

  // ==========================================================================
  // ICatalogService Implementation - State
  // ==========================================================================

  get state(): CatalogServiceState {
    return { ...this._state }
  }

  get isReady(): boolean {
    return this._state.status === 'ready'
  }

  // ==========================================================================
  // ICatalogService Implementation - Folder Management
  // ==========================================================================

  /**
   * Open folder picker and select a folder to scan.
   *
   * Uses the File System Access API to show a directory picker.
   * The selected folder handle is persisted for future sessions.
   */
  async selectFolder(): Promise<void> {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      throw new CatalogError(
        'File System Access API is not supported in this browser',
        'PERMISSION_DENIED'
      )
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      await this.setCurrentFolder(handle)
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'AbortError') {
          // User cancelled - not an error
          return
        }
        if (error.name === 'SecurityError' || error.name === 'NotAllowedError') {
          throw new CatalogError('Permission denied', 'PERMISSION_DENIED', error)
        }
      }
      throw new CatalogError(
        `Failed to select folder: ${error instanceof Error ? error.message : String(error)}`,
        'UNKNOWN',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get the currently selected folder handle.
   */
  getCurrentFolder(): FileSystemDirectoryHandle | null {
    return this._currentFolder
  }

  /**
   * Set the current folder and persist it.
   */
  private async setCurrentFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    this._currentFolder = handle

    // Check if folder already exists in database
    let folder = await db.folders.where('path').equals(handle.name).first()

    if (!folder) {
      // Create new folder record
      const handleKey = `${FOLDER_HANDLE_KEY_PREFIX}${handle.name}-${Date.now()}`

      const folderId = await db.folders.add({
        path: handle.name,
        name: handle.name,
        handleKey,
        lastScanDate: new Date(),
      })

      folder = await db.folders.get(folderId)
      this._currentFolderId = folderId

      // Persist handle for future sessions
      await this.persistHandle(handleKey, handle)
    } else {
      this._currentFolderId = folder.id!
    }
  }

  /**
   * Persist a folder handle using IndexedDB.
   */
  private async persistHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
    const DB_NAME = 'literoom-fs'
    const STORE_NAME = 'handles'

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        const database = request.result
        const tx = database.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const putRequest = store.put(handle, key)

        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      }

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME)
        }
      }
    })
  }

  // ==========================================================================
  // ICatalogService Implementation - Scanning
  // ==========================================================================

  /**
   * Scan the current folder for images.
   */
  async scanFolder(options: ScanOptions = {}): Promise<void> {
    if (!this._currentFolder) {
      throw new CatalogError('No folder selected', 'FOLDER_NOT_FOUND')
    }

    if (this._state.status === 'scanning') {
      throw new CatalogError('Scan already in progress', 'UNKNOWN')
    }

    // Create abort controller for cancellation
    this._abortController = new AbortController()
    const signal = options.signal ?? this._abortController.signal

    // Update state
    this._state = {
      status: 'scanning',
      scanProgress: { totalFound: 0, processed: 0 },
    }

    try {
      const newAssets: Asset[] = []

      // Scan folder using async generator
      for await (const batch of this.scanService.scan(this._currentFolder, {
        ...options,
        signal,
      })) {
        // Process each batch
        for (const scannedFile of batch) {
          // Check if asset already exists
          const existingAsset = await db.assets
            .where({ folderId: this._currentFolderId!, path: scannedFile.path })
            .first()

          if (existingAsset) {
            // Asset already exists - check if modified
            if (existingAsset.modifiedDate.getTime() !== scannedFile.modifiedDate.getTime()) {
              // File was modified - update record
              await db.assets.update(existingAsset.id!, {
                fileSize: scannedFile.fileSize,
                modifiedDate: scannedFile.modifiedDate,
              })
            }

            // Load existing asset into memory
            const asset = this.assetRecordToAsset(existingAsset)
            this._assets.set(asset.id, asset)
            newAssets.push(asset)
          } else {
            // New asset - create record
            const uuid = crypto.randomUUID()
            const assetRecord: AssetRecord = {
              uuid,
              folderId: this._currentFolderId!,
              path: scannedFile.path,
              filename: scannedFile.filename,
              extension: scannedFile.extension,
              flag: 'none',
              captureDate: null, // Would extract from EXIF in a full implementation
              modifiedDate: scannedFile.modifiedDate,
              fileSize: scannedFile.fileSize,
            }

            const assetId = await db.assets.add(assetRecord)
            assetRecord.id = assetId

            const asset = this.assetRecordToAsset(assetRecord, scannedFile.getFile)
            this._assets.set(asset.id, asset)
            newAssets.push(asset)
          }
        }

        // Update progress
        const progress: ScanProgress = {
          totalFound: this._assets.size,
          processed: this._assets.size,
        }
        this._state = { status: 'scanning', scanProgress: progress }

        // Notify listeners of new assets
        if (newAssets.length > 0) {
          this._onAssetsAdded?.(newAssets)
          newAssets.length = 0
        }
      }

      // Update folder scan date
      await db.folders.update(this._currentFolderId!, {
        lastScanDate: new Date(),
      })

      this._state = { status: 'ready' }
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'SCAN_CANCELLED') {
        this._state = { status: 'ready' }
        return
      }

      this._state = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }

      throw error
    } finally {
      this._abortController = null
    }
  }

  /**
   * Rescan the current folder for new/changed files.
   */
  async rescanFolder(): Promise<void> {
    // Same as scanFolder - it handles duplicates
    await this.scanFolder()
  }

  /**
   * Cancel an in-progress scan.
   */
  cancelScan(): void {
    this._abortController?.abort()
  }

  // ==========================================================================
  // ICatalogService Implementation - Asset Access
  // ==========================================================================

  /**
   * Get a single asset by ID.
   */
  getAsset(id: string): Asset | undefined {
    return this._assets.get(id)
  }

  /**
   * Get all assets.
   */
  getAssets(): Asset[] {
    return Array.from(this._assets.values())
  }

  // ==========================================================================
  // ICatalogService Implementation - Flag Management
  // ==========================================================================

  /**
   * Set the flag status for a single asset.
   */
  async setFlag(assetId: string, flag: FlagStatus): Promise<void> {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Get database ID
    const record = await db.assets.where('uuid').equals(assetId).first()
    if (!record) {
      return
    }

    // Update database
    await db.assets.update(record.id!, { flag })

    // Update in-memory asset
    const updatedAsset = { ...asset, flag }
    this._assets.set(assetId, updatedAsset)

    // Notify listeners
    this._onAssetUpdated?.(updatedAsset)
  }

  /**
   * Set the flag status for multiple assets.
   */
  async setFlagBatch(assetIds: string[], flag: FlagStatus): Promise<void> {
    // Get database IDs
    const records = await db.assets.where('uuid').anyOf(assetIds).toArray()
    const dbIds = records.map((r) => r.id!).filter((id) => id !== undefined)

    // Update database
    await db.assets.where('id').anyOf(dbIds).modify({ flag })

    // Update in-memory assets
    for (const assetId of assetIds) {
      const asset = this._assets.get(assetId)
      if (asset) {
        const updatedAsset = { ...asset, flag }
        this._assets.set(assetId, updatedAsset)
        this._onAssetUpdated?.(updatedAsset)
      }
    }
  }

  // ==========================================================================
  // ICatalogService Implementation - Thumbnail Requests
  // ==========================================================================

  /**
   * Request thumbnail generation for an asset.
   */
  requestThumbnail(assetId: string, priority: ThumbnailPriority): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Get file bytes function
    const getBytes = this.createGetBytesFunction(asset)

    // Request from thumbnail service
    this.thumbnailService.requestThumbnail(assetId, getBytes, priority)

    // Update asset status
    if (asset.thumbnailStatus === 'pending') {
      const updatedAsset = { ...asset, thumbnailStatus: 'loading' as const }
      this._assets.set(assetId, updatedAsset)
    }
  }

  /**
   * Update the priority of a thumbnail request.
   */
  updateThumbnailPriority(assetId: string, priority: ThumbnailPriority): void {
    this.thumbnailService.updatePriority(assetId, priority)
  }

  /**
   * Create a function that returns the file bytes for an asset.
   */
  private createGetBytesFunction(asset: Asset): () => Promise<Uint8Array> {
    // Capture the folder and path
    const folder = this._currentFolder
    const path = asset.path

    return async (): Promise<Uint8Array> => {
      if (!folder) {
        throw new CatalogError('No folder selected', 'FOLDER_NOT_FOUND')
      }

      // Navigate to the file
      const pathParts = path.split('/')
      let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = folder

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i]
        if (i === pathParts.length - 1) {
          // Last part is the filename (with extension)
          const filenameWithExt = `${asset.filename}.${asset.extension}`
          currentHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(
            filenameWithExt
          )
        } else {
          // Navigate to subdirectory
          currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(
            part
          )
        }
      }

      // Read file
      const file = await (currentHandle as FileSystemFileHandle).getFile()
      const arrayBuffer = await file.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    }
  }

  // ==========================================================================
  // ICatalogService Implementation - Events
  // ==========================================================================

  set onAssetsAdded(callback: AssetsAddedCallback | null) {
    this._onAssetsAdded = callback
  }

  get onAssetsAdded(): AssetsAddedCallback | null {
    return this._onAssetsAdded
  }

  set onAssetUpdated(callback: AssetUpdatedCallback | null) {
    this._onAssetUpdated = callback
  }

  get onAssetUpdated(): AssetUpdatedCallback | null {
    return this._onAssetUpdated
  }

  set onThumbnailReady(callback: ThumbnailReadyCallback | null) {
    this._onThumbnailReady = callback
  }

  get onThumbnailReady(): ThumbnailReadyCallback | null {
    return this._onThumbnailReady
  }

  // ==========================================================================
  // ICatalogService Implementation - Cleanup
  // ==========================================================================

  /**
   * Clean up resources and close the service.
   */
  destroy(): void {
    this.cancelScan()
    this.thumbnailService.cancelAll()
    this._assets.clear()
    this._currentFolder = null
    this._currentFolderId = null
    this._state = { status: 'initializing' }
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Handle thumbnail ready callback from ThumbnailService.
   */
  private handleThumbnailReady(assetId: string, url: string): void {
    const asset = this._assets.get(assetId)
    if (asset) {
      const updatedAsset: Asset = {
        ...asset,
        thumbnailStatus: 'ready',
        thumbnailUrl: url,
      }
      this._assets.set(assetId, updatedAsset)
      this._onAssetUpdated?.(updatedAsset)
    }

    // Forward to external callback
    this._onThumbnailReady?.(assetId, url)
  }

  /**
   * Handle thumbnail error callback from ThumbnailService.
   */
  private handleThumbnailError(assetId: string, error: Error): void {
    const asset = this._assets.get(assetId)
    if (asset) {
      const updatedAsset: Asset = {
        ...asset,
        thumbnailStatus: 'error',
      }
      this._assets.set(assetId, updatedAsset)
      this._onAssetUpdated?.(updatedAsset)
    }

    // Log error (could add error callback later)
    console.error(`Thumbnail error for ${assetId}:`, error)
  }

  /**
   * Convert a database AssetRecord to an Asset.
   */
  private assetRecordToAsset(
    record: AssetRecord,
    getFile?: () => Promise<File>
  ): Asset {
    return {
      id: record.uuid,
      folderId: String(record.folderId),
      path: record.path,
      filename: record.filename,
      extension: record.extension,
      flag: record.flag,
      captureDate: record.captureDate,
      modifiedDate: record.modifiedDate,
      fileSize: record.fileSize,
      width: record.width,
      height: record.height,
      thumbnailStatus: 'pending',
      thumbnailUrl: null,
    }
  }

  // ==========================================================================
  // Load Existing Catalog
  // ==========================================================================

  /**
   * Load an existing catalog from the database.
   *
   * Call this after create() to restore a previous session's catalog.
   */
  async loadFromDatabase(): Promise<boolean> {
    // Get all folders
    const folders = await db.folders.toArray()
    if (folders.length === 0) {
      return false
    }

    // For now, just load the first folder
    const folder = folders[0]

    // Try to restore the handle
    const handle = await this.loadHandle(folder.handleKey)
    if (!handle) {
      return false
    }

    // Check permission
    const permission = await handle.queryPermission({ mode: 'read' })
    if (permission !== 'granted') {
      // Would need to request permission via UI
      return false
    }

    // Set as current folder
    this._currentFolder = handle
    this._currentFolderId = folder.id!

    // Load assets from database
    const records = await db.assets.where('folderId').equals(folder.id!).toArray()
    for (const record of records) {
      const asset = this.assetRecordToAsset(record)
      this._assets.set(asset.id, asset)
    }

    // Notify listeners
    if (this._assets.size > 0) {
      this._onAssetsAdded?.(Array.from(this._assets.values()))
    }

    return true
  }

  /**
   * Load a persisted folder handle from IndexedDB.
   */
  private async loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
    const DB_NAME = 'literoom-fs'
    const STORE_NAME = 'handles'

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        const database = request.result
        const tx = database.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const getRequest = store.get(key)

        getRequest.onsuccess = () => {
          resolve(getRequest.result ?? null)
        }
        getRequest.onerror = () => reject(getRequest.error)
      }

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME)
        }
      }
    })
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new CatalogService instance.
 */
export async function createCatalogService(
  decodeService: IDecodeService
): Promise<CatalogService> {
  return CatalogService.create(decodeService)
}
