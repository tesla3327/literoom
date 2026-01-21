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
  ThumbnailPriority,
  CatalogError,
} from './types'
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
  failScan: false,
  failSetFlag: false,
  thumbnailBaseColor: '#3b82f6', // Blue
}

/**
 * Generate a data URL for a solid color thumbnail.
 */
function generateThumbnailDataUrl(color: string, size: number = 256): string {
  // Create a simple SVG as a data URL
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${color}"/></svg>`
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

  // Callbacks
  private _onAssetsAdded: AssetsAddedCallback | null = null
  private _onAssetUpdated: AssetUpdatedCallback | null = null
  private _onThumbnailReady: ThumbnailReadyCallback | null = null

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

    // Generate data URL based on flag color
    const color = getColorForFlag(asset.flag)
    const thumbnailUrl = generateThumbnailDataUrl(color)

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
