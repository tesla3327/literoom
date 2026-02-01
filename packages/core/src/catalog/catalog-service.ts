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
import type { EditedThumbnailEditState } from '../decode/worker-messages'
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
  type PreviewReadyCallback,
  type FolderInfo,
  type ReadyPhoto,
  type PhotoReadyCallback,
  ThumbnailPriority,
  CatalogError,
} from './types'
import { PhotoProcessor, createPhotoProcessor, type ProcessedPhoto } from './photo-processor'
import { ScanService } from './scan-service'
import { ThumbnailService } from './thumbnail-service'
import { db, removeAssets as dbRemoveAssets, type AssetRecord, type FolderRecord } from './db'

// ============================================================================
// Constants
// ============================================================================

/** Key prefix for storing folder handles */
const FOLDER_HANDLE_KEY_PREFIX = 'literoom-folder-'

/** IndexedDB database name for handle storage */
const HANDLE_DB_NAME = 'literoom-fs'

/** IndexedDB store name for handles */
const HANDLE_STORE_NAME = 'handles'

// ============================================================================
// IndexedDB Helper
// ============================================================================

/**
 * Execute an operation on the handle store in IndexedDB.
 * Handles database setup and cleanup automatically.
 */
async function withHandleDB<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1)

    request.onerror = () => reject(request.error)

    request.onsuccess = () => {
      const database = request.result
      const tx = database.transaction(HANDLE_STORE_NAME, mode)
      const store = tx.objectStore(HANDLE_STORE_NAME)
      const opRequest = operation(store)

      opRequest.onsuccess = () => resolve(opRequest.result)
      opRequest.onerror = () => reject(opRequest.error)
    }

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        database.createObjectStore(HANDLE_STORE_NAME)
      }
    }
  })
}

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
  private readonly photoProcessor: PhotoProcessor

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
  private _onPreviewReady: PreviewReadyCallback | null = null
  private _onPhotoReady: PhotoReadyCallback | null = null

  /**
   * Private constructor - use CatalogService.create() instead.
   */
  private constructor(
    scanService: IScanService,
    thumbnailService: IThumbnailService,
    photoProcessor: PhotoProcessor
  ) {
    this.scanService = scanService
    this.thumbnailService = thumbnailService
    this.photoProcessor = photoProcessor

    // Wire up thumbnail callbacks
    this.thumbnailService.onThumbnailReady = this.handleThumbnailReady.bind(this)
    this.thumbnailService.onThumbnailError = this.handleThumbnailError.bind(this)

    // Wire up preview callbacks
    this.thumbnailService.onPreviewReady = this.handlePreviewReady.bind(this)
    this.thumbnailService.onPreviewError = this.handlePreviewError.bind(this)
  }

  /**
   * Create a new CatalogService instance.
   */
  static async create(decodeService: IDecodeService): Promise<CatalogService> {
    const scanService = new ScanService()
    const thumbnailService = await ThumbnailService.create(decodeService)
    const photoProcessor = createPhotoProcessor(decodeService)

    const service = new CatalogService(scanService, thumbnailService, photoProcessor)

    // Wire up photo processor callbacks
    photoProcessor.onPhotoProcessed = service.handlePhotoProcessed.bind(service)
    photoProcessor.onPhotoError = service.handlePhotoError.bind(service)

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
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
      // Reset state from any previous folder
      this.resetForFolderChange()
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
    await withHandleDB('readwrite', store => store.put(handle, key))
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
      // Scan folder and queue each file for processing
      for await (const scannedFile of this.scanService.scan(this._currentFolder, {
        ...options,
        signal,
      })) {
        // Check if asset already exists
        const existingAsset = await db.assets
          .where({ folderId: this._currentFolderId!, path: scannedFile.path })
          .first()

        let asset: Asset
        let isNew = false
        let isModified = false

        if (existingAsset) {
          // Asset already exists - check if modified
          if (existingAsset.modifiedDate.getTime() !== scannedFile.modifiedDate.getTime()) {
            await db.assets.update(existingAsset.id!, {
              fileSize: scannedFile.fileSize,
              modifiedDate: scannedFile.modifiedDate,
            })
            isModified = true
          }

          // Preserve existing in-memory asset if available (keeps thumbnail state)
          const existingInMemory = this._assets.get(existingAsset.uuid)
          if (existingInMemory && !isModified) {
            // Unmodified existing asset - keep current state
            asset = existingInMemory
          } else {
            // Modified or not in memory - create fresh
            asset = this.assetRecordToAsset(existingAsset)
          }
        } else {
          // New asset - create record
          isNew = true
          const uuid = crypto.randomUUID()
          const assetRecord: AssetRecord = {
            uuid,
            folderId: this._currentFolderId!,
            path: scannedFile.path,
            filename: scannedFile.filename,
            extension: scannedFile.extension,
            flag: 'none',
            captureDate: null,
            modifiedDate: scannedFile.modifiedDate,
            fileSize: scannedFile.fileSize,
          }

          const assetId = await db.assets.add(assetRecord)
          assetRecord.id = assetId
          asset = this.assetRecordToAsset(assetRecord, scannedFile.getFile)
        }

        // Add to in-memory collection
        this._assets.set(asset.id, asset)

        // Only notify listeners for genuinely new assets
        if (isNew) {
          this._onAssetsAdded?.([asset])
        }

        // Only queue new or modified assets for processing
        if (isNew || isModified) {
          const getBytes = this.createGetBytesFunction(asset)
          this.photoProcessor.enqueue({
            assetId: asset.id,
            getBytes,
          })
        }

        // Update progress
        const progress: ScanProgress = {
          totalFound: this._assets.size,
          processed: this._assets.size,
        }
        this._state = { status: 'scanning', scanProgress: progress }
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
  // ICatalogService Implementation - Asset Removal
  // ==========================================================================

  /**
   * Remove assets from the catalog.
   * This removes from database and memory but does NOT delete files from disk.
   */
  async removeAssets(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return
    }

    // Remove from database (also removes associated edit states)
    await dbRemoveAssets(assetIds)

    // Remove from in-memory collection
    for (const assetId of assetIds) {
      this._assets.delete(assetId)
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

  // ==========================================================================
  // ICatalogService Implementation - Preview Requests
  // ==========================================================================

  /**
   * Request preview generation for an asset.
   * Previews are larger (2560px) than thumbnails (512px).
   */
  requestPreview(assetId: string, priority: ThumbnailPriority): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Get file bytes function
    const getBytes = this.createGetBytesFunction(asset)

    // Request from thumbnail service (which also handles previews)
    this.thumbnailService.requestPreview(assetId, getBytes, priority)

    // Update asset status
    if (!asset.preview1xStatus || asset.preview1xStatus === 'pending') {
      const updatedAsset: Asset = { ...asset, preview1xStatus: 'loading' }
      this._assets.set(assetId, updatedAsset)
    }
  }

  /**
   * Update the priority of a preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void {
    this.thumbnailService.updatePreviewPriority(assetId, priority)
  }

  /**
   * Cancel all BACKGROUND priority preview requests.
   * Used to prioritize active work when user starts interacting.
   * Returns the total number of cancelled requests.
   */
  cancelBackgroundRequests(): number {
    return this.thumbnailService.cancelBackgroundRequests()
  }

  // ==========================================================================
  // ICatalogService Implementation - Thumbnail Regeneration
  // ==========================================================================

  /**
   * Regenerate a thumbnail with edits applied.
   *
   * This invalidates the existing thumbnail and generates a new one
   * with all edit operations applied (rotation, crop, adjustments, tone curve, masks).
   *
   * @param assetId - The asset to regenerate
   * @param editState - Edit state to apply to the thumbnail
   */
  async regenerateThumbnail(
    assetId: string,
    editState: EditedThumbnailEditState
  ): Promise<void> {
    const asset = this._assets.get(assetId)
    if (!asset) {
      throw new CatalogError('Asset not found', 'FOLDER_NOT_FOUND')
    }

    // Create getBytes function for this asset
    const getBytes = this.createGetBytesFunction(asset)

    // Update asset status to loading
    const updatedAsset: Asset = {
      ...asset,
      thumbnailStatus: 'loading',
    }
    this._assets.set(assetId, updatedAsset)
    this._onAssetUpdated?.(updatedAsset)

    // Delegate to thumbnail service
    await this.thumbnailService.regenerateThumbnail(
      assetId,
      getBytes,
      editState,
      ThumbnailPriority.BACKGROUND
    )
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
            part!
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

  set onPreviewReady(callback: PreviewReadyCallback | null) {
    this._onPreviewReady = callback
  }

  get onPreviewReady(): PreviewReadyCallback | null {
    return this._onPreviewReady
  }

  set onPhotoReady(callback: PhotoReadyCallback | null) {
    this._onPhotoReady = callback
  }

  get onPhotoReady(): PhotoReadyCallback | null {
    return this._onPhotoReady
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
    this.thumbnailService.cancelAllPreviews()
    this.photoProcessor.cancelAll()
    this._assets.clear()
    this._currentFolder = null
    this._currentFolderId = null
    this._state = { status: 'initializing' }
  }

  /**
   * Reset internal state when switching to a different folder.
   * Cancels in-progress operations and clears caches.
   */
  private resetForFolderChange(): void {
    // Cancel any in-progress scan
    this.cancelScan()

    // Cancel all pending photo processing
    this.photoProcessor.cancelAll()

    // Cancel all pending thumbnail/preview requests
    this.thumbnailService.cancelAll()
    this.thumbnailService.cancelAllPreviews()

    // Clear in-memory assets
    this._assets.clear()
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
   * Handle preview ready callback from ThumbnailService.
   */
  private handlePreviewReady(assetId: string, url: string): void {
    const asset = this._assets.get(assetId)
    if (asset) {
      const updatedAsset: Asset = {
        ...asset,
        preview1xStatus: 'ready',
        preview1xUrl: url,
      }
      this._assets.set(assetId, updatedAsset)
      this._onAssetUpdated?.(updatedAsset)
    }

    // Forward to external callback
    this._onPreviewReady?.(assetId, url)
  }

  /**
   * Handle preview error callback from ThumbnailService.
   */
  private handlePreviewError(assetId: string, error: Error): void {
    const asset = this._assets.get(assetId)
    if (asset) {
      const updatedAsset: Asset = {
        ...asset,
        preview1xStatus: 'error',
      }
      this._assets.set(assetId, updatedAsset)
      this._onAssetUpdated?.(updatedAsset)
    }

    // Log error (could add error callback later)
    console.error(`Preview error for ${assetId}:`, error)
  }

  /**
   * Handle photo processed callback from PhotoProcessor.
   */
  private handlePhotoProcessed(result: ProcessedPhoto): void {
    const asset = this._assets.get(result.assetId)
    if (!asset) return

    // Create object URLs for both blobs
    const thumbnailUrl = URL.createObjectURL(result.thumbnailBlob)
    const previewUrl = URL.createObjectURL(result.previewBlob)

    // Update asset with both URLs
    const updatedAsset: Asset = {
      ...asset,
      thumbnailStatus: 'ready',
      thumbnailUrl,
      preview1xStatus: 'ready',
      preview1xUrl: previewUrl,
    }
    this._assets.set(result.assetId, updatedAsset)

    // Notify listeners
    this._onPhotoReady?.({
      asset: updatedAsset,
      thumbnailUrl,
      previewUrl,
    })

    // Also fire the individual callbacks for backwards compatibility
    this._onThumbnailReady?.(result.assetId, thumbnailUrl)
    this._onPreviewReady?.(result.assetId, previewUrl)
  }

  /**
   * Handle photo processing error.
   */
  private handlePhotoError(assetId: string, error: Error): void {
    const asset = this._assets.get(assetId)
    if (asset) {
      const updatedAsset: Asset = {
        ...asset,
        thumbnailStatus: 'error',
        preview1xStatus: 'error',
      }
      this._assets.set(assetId, updatedAsset)
      this._onAssetUpdated?.(updatedAsset)
    }
    console.error(`Photo processing error for ${assetId}:`, error)
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
    const folder = folders[0]!

    // Try to restore the handle
    const handle = await this.loadHandle(folder.handleKey)
    if (!handle) {
      return false
    }

    // Check permission
    const permission = await (handle as any).queryPermission({ mode: 'read' })
    if (permission !== 'granted') {
      // Would need to request permission via UI
      return false
    }

    // Set as current folder
    this._currentFolder = handle
    this._currentFolderId = folder.id!

    // Clear existing assets before loading new ones
    this._assets.clear()

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
   * Get a list of recent folders from the database.
   * Returns folders ordered by lastScanDate descending.
   */
  async listFolders(limit: number = 5): Promise<FolderInfo[]> {
    const folders = await db.folders
      .orderBy('lastScanDate')
      .reverse()
      .limit(limit)
      .toArray()

    // Check accessibility for each folder
    const result: FolderInfo[] = []
    for (const folder of folders) {
      let isAccessible = false

      try {
        const handle = await this.loadHandle(folder.handleKey)
        if (handle) {
          const permission = await (handle as any).queryPermission({ mode: 'read' })
          isAccessible = permission === 'granted'
        }
      } catch {
        // Handle not accessible
        isAccessible = false
      }

      result.push({
        id: folder.id!,
        name: folder.name,
        path: folder.path,
        lastScanDate: folder.lastScanDate,
        isAccessible,
      })
    }

    return result
  }

  /**
   * Load a specific folder by its database ID.
   * Returns true if the folder was loaded successfully.
   */
  async loadFolderById(folderId: number): Promise<boolean> {
    // Get folder from database
    const folder = await db.folders.get(folderId)
    if (!folder) {
      return false
    }

    // Try to restore the handle
    const handle = await this.loadHandle(folder.handleKey)
    if (!handle) {
      return false
    }

    // Check permission
    const permission = await (handle as any).queryPermission({ mode: 'read' })
    if (permission !== 'granted') {
      // Try to request permission
      const requestResult = await (handle as any).requestPermission({ mode: 'read' })
      if (requestResult !== 'granted') {
        return false
      }
    }

    // Reset state from any previous folder
    this.resetForFolderChange()

    // Set as current folder
    this._currentFolder = handle
    this._currentFolderId = folderId

    // Load assets from database
    const records = await db.assets.where('folderId').equals(folderId).toArray()
    for (const record of records) {
      const asset = this.assetRecordToAsset(record)
      this._assets.set(asset.id, asset)
    }

    // Update lastScanDate
    await db.folders.update(folderId, {
      lastScanDate: new Date(),
    })

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
    const result = await withHandleDB<FileSystemDirectoryHandle | undefined>(
      'readonly',
      store => store.get(key)
    )
    return result ?? null
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
