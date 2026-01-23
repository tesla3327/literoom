/**
 * MockCatalogService - Mock implementation for testing and demo mode.
 *
 * This mock implementation of ICatalogService can be used in:
 * - Unit tests to avoid real file system access
 * - E2E tests with demo catalog mode
 * - Development without real folder access
 *
 * By default, it returns a predefined set of demo assets.
 * Configure with custom options for different test scenarios.
 */

import {
  type Asset,
  type FlagStatus,
  type ICatalogService,
  type CatalogServiceState,
  type ScanOptions,
  type ScanProgress,
  type AssetsAddedCallback,
  type AssetUpdatedCallback,
  type ThumbnailReadyCallback,
  type PreviewReadyCallback,
  type FolderInfo,
  ThumbnailPriority,
  CatalogError,
} from './types'
import type { EditedThumbnailEditState } from '../decode/worker-messages'
import { createDemoAssets, type DemoAssetOptions } from './demo-assets'

/**
 * Options for MockCatalogService configuration.
 */
export interface MockCatalogServiceOptions {
  /** Pre-defined demo assets (overrides demoAssetOptions) */
  demoAssets?: Asset[]
  /** Options for generating demo assets if demoAssets not provided */
  demoAssetOptions?: DemoAssetOptions
  /** Delay between scan batches in ms (default: 0) */
  scanDelayMs?: number
  /** Batch size for scan yielding (default: 10) */
  scanBatchSize?: number
  /** Delay for thumbnail generation in ms (default: 0) */
  thumbnailDelayMs?: number
  /** Delay for preview generation in ms (default: 100) */
  previewDelayMs?: number
  /** Whether to fail scan for error testing (default: false) */
  failScan?: boolean
  /** Whether to fail setFlag for error testing (default: false) */
  failSetFlag?: boolean
  /** Base color for generated thumbnail data URLs */
  thumbnailBaseColor?: string
}

/**
 * Default options for MockCatalogService.
 */
const DEFAULT_OPTIONS: Required<MockCatalogServiceOptions> = {
  demoAssets: [],
  demoAssetOptions: { count: 50 },
  scanDelayMs: 0,
  scanBatchSize: 10,
  thumbnailDelayMs: 0,
  previewDelayMs: 100, // Slightly longer than thumbnails to simulate larger image
  failScan: false,
  failSetFlag: false,
  thumbnailBaseColor: '#3b82f6', // Blue
}

/**
 * Generate a data URL for a visually interesting thumbnail.
 * Creates gradient backgrounds with abstract shapes to simulate photos.
 */
function generateThumbnailDataUrl(color: string, index: number, size: number = 256): string {
  // Generate deterministic variations based on index
  const hueShift = (index * 37) % 360
  const pattern = index % 5

  // Create different visual patterns for variety
  let content: string
  switch (pattern) {
    case 0:
      // Diagonal gradient with circle
      content = `
        <defs>
          <linearGradient id="g${index}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${color};stop-opacity:1"/>
            <stop offset="100%" style="stop-color:#1a1a2e;stop-opacity:1"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g${index})"/>
        <circle cx="${70 + (index % 3) * 40}" cy="${70 + (index % 4) * 30}" r="${40 + (index % 3) * 15}" fill="${color}" opacity="0.3"/>
      `
      break
    case 1:
      // Horizontal bands
      content = `
        <rect width="100%" height="100%" fill="#1a1a2e"/>
        <rect y="0" width="100%" height="33%" fill="${color}" opacity="0.7"/>
        <rect y="66%" width="100%" height="34%" fill="${color}" opacity="0.4"/>
      `
      break
    case 2:
      // Radial glow
      content = `
        <defs>
          <radialGradient id="r${index}" cx="50%" cy="50%" r="70%">
            <stop offset="0%" style="stop-color:${color};stop-opacity:0.8"/>
            <stop offset="100%" style="stop-color:#0f0f1a;stop-opacity:1"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#r${index})"/>
      `
      break
    case 3:
      // Corner accent
      content = `
        <rect width="100%" height="100%" fill="#16162a"/>
        <polygon points="0,0 ${size},0 0,${size}" fill="${color}" opacity="0.5"/>
        <circle cx="${size * 0.7}" cy="${size * 0.7}" r="${size * 0.2}" fill="${color}" opacity="0.3"/>
      `
      break
    default:
      // Layered rectangles
      content = `
        <rect width="100%" height="100%" fill="#1a1a2e"/>
        <rect x="10%" y="10%" width="80%" height="80%" fill="${color}" opacity="0.2"/>
        <rect x="20%" y="20%" width="60%" height="60%" fill="${color}" opacity="0.3"/>
        <rect x="30%" y="30%" width="40%" height="40%" fill="${color}" opacity="0.4"/>
      `
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${content}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Get a color based on asset flag for visual testing.
 */
function getColorForFlag(flag: FlagStatus): string {
  switch (flag) {
    case 'pick':
      return '#22c55e' // Green
    case 'reject':
      return '#ef4444' // Red
    default:
      return '#3b82f6' // Blue
  }
}

/**
 * Mock implementation of ICatalogService for testing.
 */
export class MockCatalogService implements ICatalogService {
  // State
  private _state: CatalogServiceState = { status: 'initializing' }
  private _assets: Map<string, Asset> = new Map()
  private _currentFolderName: string | null = null

  // Configuration
  private options: Required<MockCatalogServiceOptions>
  private demoAssets: Asset[]

  // Scan control
  private _abortController: AbortController | null = null
  private _isScanning = false

  // Thumbnail queue simulation
  private _thumbnailQueue: Map<string, { priority: ThumbnailPriority; timeoutId?: ReturnType<typeof setTimeout> }> = new Map()

  // Preview queue simulation
  private _previewQueue: Map<string, { priority: ThumbnailPriority; timeoutId?: ReturnType<typeof setTimeout> }> = new Map()

  // Callbacks
  private _onAssetsAdded: AssetsAddedCallback | null = null
  private _onAssetUpdated: AssetUpdatedCallback | null = null
  private _onThumbnailReady: ThumbnailReadyCallback | null = null
  private _onPreviewReady: PreviewReadyCallback | null = null

  /**
   * Private constructor - use MockCatalogService.create() instead.
   */
  private constructor(options: MockCatalogServiceOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Use provided demo assets or generate them
    if (options.demoAssets && options.demoAssets.length > 0) {
      this.demoAssets = [...options.demoAssets]
    } else {
      this.demoAssets = createDemoAssets(this.options.demoAssetOptions)
    }
  }

  /**
   * Create a new MockCatalogService instance.
   */
  static async create(
    options: MockCatalogServiceOptions = {}
  ): Promise<MockCatalogService> {
    const service = new MockCatalogService(options)
    service._state = { status: 'ready' }
    return service
  }

  /**
   * Helper to simulate async delay.
   */
  private async delay(ms: number): Promise<void> {
    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
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
   * Simulate folder selection.
   * In mock mode, this just sets a folder name and prepares for scanning.
   */
  async selectFolder(): Promise<void> {
    this._currentFolderName = 'Demo Photos'
  }

  /**
   * Get the currently selected folder handle.
   * In mock mode, returns null (no real handle).
   */
  getCurrentFolder(): FileSystemDirectoryHandle | null {
    return null
  }

  // ==========================================================================
  // ICatalogService Implementation - Scanning
  // ==========================================================================

  /**
   * Scan for demo assets.
   * Yields batches of assets with configurable delays.
   */
  async scanFolder(options: ScanOptions = {}): Promise<void> {
    if (this._isScanning) {
      throw new CatalogError('Scan already in progress', 'UNKNOWN')
    }

    if (this.options.failScan) {
      throw new CatalogError('Mock scan failed', 'UNKNOWN')
    }

    // Set up scanning state
    this._isScanning = true
    this._abortController = new AbortController()
    const signal = options.signal ?? this._abortController.signal

    // Update state
    this._state = {
      status: 'scanning',
      scanProgress: { totalFound: 0, processed: 0 },
    }

    try {
      const batchSize = this.options.scanBatchSize
      const totalAssets = this.demoAssets.length

      for (let i = 0; i < totalAssets; i += batchSize) {
        // Check for cancellation
        if (signal.aborted) {
          throw new CatalogError('Scan cancelled', 'SCAN_CANCELLED')
        }

        // Get batch of assets
        const batch = this.demoAssets.slice(i, Math.min(i + batchSize, totalAssets))

        // Add to internal storage
        for (const asset of batch) {
          this._assets.set(asset.id, { ...asset })
        }

        // Update progress
        const progress: ScanProgress = {
          totalFound: Math.min(i + batchSize, totalAssets),
          processed: Math.min(i + batchSize, totalAssets),
        }
        this._state = { status: 'scanning', scanProgress: progress }

        // Notify listeners
        this._onAssetsAdded?.(batch)

        // Simulate delay between batches
        await this.delay(this.options.scanDelayMs)
      }

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
      this._isScanning = false
      this._abortController = null
    }
  }

  /**
   * Rescan (same as scan in mock mode).
   */
  async rescanFolder(): Promise<void> {
    // Clear existing assets first
    this._assets.clear()
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
    if (this.options.failSetFlag) {
      throw new CatalogError('Mock setFlag failed', 'DATABASE_ERROR')
    }

    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Update asset
    const updatedAsset = { ...asset, flag }
    this._assets.set(assetId, updatedAsset)

    // Notify listeners
    this._onAssetUpdated?.(updatedAsset)
  }

  /**
   * Set the flag status for multiple assets.
   */
  async setFlagBatch(assetIds: string[], flag: FlagStatus): Promise<void> {
    if (this.options.failSetFlag) {
      throw new CatalogError('Mock setFlagBatch failed', 'DATABASE_ERROR')
    }

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
   * Simulates async thumbnail generation with configurable delay.
   */
  requestThumbnail(assetId: string, priority: ThumbnailPriority): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Check if already in queue or ready
    if (this._thumbnailQueue.has(assetId) || asset.thumbnailStatus === 'ready') {
      return
    }

    // Update asset status to loading
    const loadingAsset = { ...asset, thumbnailStatus: 'loading' as const }
    this._assets.set(assetId, loadingAsset)

    // Schedule thumbnail generation
    const timeoutId = setTimeout(() => {
      this.generateMockThumbnail(assetId)
    }, this.options.thumbnailDelayMs)

    this._thumbnailQueue.set(assetId, { priority, timeoutId })
  }

  /**
   * Update the priority of a thumbnail request.
   */
  updateThumbnailPriority(assetId: string, priority: ThumbnailPriority): void {
    const queued = this._thumbnailQueue.get(assetId)
    if (queued) {
      queued.priority = priority
    }
  }

  /**
   * Generate a mock thumbnail for an asset.
   */
  private generateMockThumbnail(assetId: string): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      this._thumbnailQueue.delete(assetId)
      return
    }

    // Generate data URL based on flag color and asset index for variety
    const color = getColorForFlag(asset.flag)
    // Extract index from asset id (e.g., "demo-asset-5" -> 5)
    const indexMatch = assetId.match(/\d+$/)
    const index = indexMatch ? parseInt(indexMatch[0], 10) : 0
    const thumbnailUrl = generateThumbnailDataUrl(color, index)

    // Update asset
    const updatedAsset: Asset = {
      ...asset,
      thumbnailStatus: 'ready',
      thumbnailUrl,
    }
    this._assets.set(assetId, updatedAsset)

    // Remove from queue
    this._thumbnailQueue.delete(assetId)

    // Notify listeners
    this._onAssetUpdated?.(updatedAsset)
    this._onThumbnailReady?.(assetId, thumbnailUrl)
  }

  // ==========================================================================
  // ICatalogService Implementation - Preview Requests
  // ==========================================================================

  /**
   * Request preview generation for an asset.
   * Simulates async preview generation with configurable delay.
   * Previews are larger (2560px) than thumbnails (512px).
   */
  requestPreview(assetId: string, priority: ThumbnailPriority): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Check if already in queue or ready
    if (this._previewQueue.has(assetId) || asset.preview1xStatus === 'ready') {
      return
    }

    // Update asset status to loading
    const loadingAsset: Asset = { ...asset, preview1xStatus: 'loading' }
    this._assets.set(assetId, loadingAsset)

    // Schedule preview generation (slightly longer delay than thumbnails)
    const timeoutId = setTimeout(() => {
      this.generateMockPreview(assetId)
    }, this.options.previewDelayMs)

    this._previewQueue.set(assetId, { priority, timeoutId })
  }

  /**
   * Update the priority of a preview request.
   */
  updatePreviewPriority(assetId: string, priority: ThumbnailPriority): void {
    const queued = this._previewQueue.get(assetId)
    if (queued) {
      queued.priority = priority
    }
  }

  // ==========================================================================
  // ICatalogService Implementation - Thumbnail Regeneration
  // ==========================================================================

  /**
   * Regenerate a thumbnail with edits applied.
   * In mock mode, this simulates regeneration by setting status to loading
   * and scheduling a new thumbnail generation.
   *
   * @param assetId - The asset to regenerate
   * @param _editState - Edit state (not used in mock, just generates same thumbnail)
   */
  async regenerateThumbnail(
    assetId: string,
    _editState: EditedThumbnailEditState
  ): Promise<void> {
    const asset = this._assets.get(assetId)
    if (!asset) {
      return
    }

    // Cancel any existing thumbnail request for this asset
    const existing = this._thumbnailQueue.get(assetId)
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId)
    }

    // Update asset status to loading, clear old thumbnail URL
    const loadingAsset: Asset = {
      ...asset,
      thumbnailStatus: 'loading',
      thumbnailUrl: null,
    }
    this._assets.set(assetId, loadingAsset)
    this._onAssetUpdated?.(loadingAsset)

    // Schedule thumbnail regeneration (same as regular generation in mock mode)
    const timeoutId = setTimeout(() => {
      this.generateMockThumbnail(assetId)
    }, this.options.thumbnailDelayMs)

    this._thumbnailQueue.set(assetId, { priority: ThumbnailPriority.BACKGROUND, timeoutId })
  }

  /**
   * Generate a mock preview for an asset.
   * Uses a larger size to simulate actual preview generation.
   */
  private generateMockPreview(assetId: string): void {
    const asset = this._assets.get(assetId)
    if (!asset) {
      this._previewQueue.delete(assetId)
      return
    }

    // Generate data URL based on flag color and asset index
    // Use larger size (512 instead of 256) to simulate higher resolution
    const color = getColorForFlag(asset.flag)
    const indexMatch = assetId.match(/\d+$/)
    const index = indexMatch ? parseInt(indexMatch[0], 10) : 0
    const previewUrl = generateThumbnailDataUrl(color, index, 512)

    // Update asset
    const updatedAsset: Asset = {
      ...asset,
      preview1xStatus: 'ready',
      preview1xUrl: previewUrl,
    }
    this._assets.set(assetId, updatedAsset)

    // Remove from queue
    this._previewQueue.delete(assetId)

    // Notify listeners
    this._onAssetUpdated?.(updatedAsset)
    this._onPreviewReady?.(assetId, previewUrl)
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

  // ==========================================================================
  // ICatalogService Implementation - Cleanup
  // ==========================================================================

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.cancelScan()

    // Clear thumbnail queue
    for (const [, queued] of this._thumbnailQueue) {
      if (queued.timeoutId) {
        clearTimeout(queued.timeoutId)
      }
    }
    this._thumbnailQueue.clear()

    // Clear preview queue
    for (const [, queued] of this._previewQueue) {
      if (queued.timeoutId) {
        clearTimeout(queued.timeoutId)
      }
    }
    this._previewQueue.clear()

    this._assets.clear()
    this._currentFolderName = null
    this._state = { status: 'initializing' }
  }

  // ==========================================================================
  // Additional Mock-Specific Methods
  // ==========================================================================

  /**
   * Load from database (no-op in mock mode, returns true with assets loaded).
   */
  async loadFromDatabase(): Promise<boolean> {
    // In mock mode, just run a scan to populate assets
    if (this._assets.size === 0) {
      await this.scanFolder()
    }
    return this._assets.size > 0
  }

  /**
   * Get a list of recent folders (mock mode returns empty array).
   */
  async listFolders(_limit: number = 5): Promise<FolderInfo[]> {
    // Demo mode has no persisted folders
    return []
  }

  /**
   * Load a specific folder by ID (no-op in mock mode).
   */
  async loadFolderById(_folderId: number): Promise<boolean> {
    // Demo mode doesn't support loading specific folders
    return false
  }

  /**
   * Get the current folder name (mock-specific).
   */
  getFolderName(): string | null {
    return this._currentFolderName
  }

  /**
   * Manually set assets for testing (mock-specific).
   */
  setAssets(assets: Asset[]): void {
    this._assets.clear()
    for (const asset of assets) {
      this._assets.set(asset.id, { ...asset })
    }
  }

  /**
   * Clear all assets (mock-specific).
   */
  clearAssets(): void {
    this._assets.clear()
  }

  /**
   * Reset to demo assets (mock-specific).
   */
  resetToDemo(): void {
    this._assets.clear()
    for (const asset of this.demoAssets) {
      this._assets.set(asset.id, { ...asset })
    }
  }

  /**
   * Get thumbnail queue size (mock-specific).
   */
  getThumbnailQueueSize(): number {
    return this._thumbnailQueue.size
  }

  /**
   * Force complete all pending thumbnails immediately (mock-specific).
   */
  completeAllThumbnails(): void {
    const pendingAssetIds = Array.from(this._thumbnailQueue.keys())
    for (const assetId of pendingAssetIds) {
      const queued = this._thumbnailQueue.get(assetId)
      if (queued?.timeoutId) {
        clearTimeout(queued.timeoutId)
      }
      this.generateMockThumbnail(assetId)
    }
  }
}

/**
 * Create a new MockCatalogService instance.
 */
export async function createMockCatalogService(
  options?: MockCatalogServiceOptions
): Promise<MockCatalogService> {
  return MockCatalogService.create(options)
}
