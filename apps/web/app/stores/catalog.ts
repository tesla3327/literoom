/**
 * Catalog Store
 *
 * Manages the core catalog state:
 * - Asset collection (Map for O(1) lookups)
 * - Asset order (array for display)
 * - Scan progress
 * - Folder information
 *
 * Uses shallowRef for assets Map to avoid deep reactivity overhead.
 */
import type {
  Asset,
  FlagStatus,
  ThumbnailStatus,
  ScanProgress,
} from '@literoom/core/catalog'

export const useCatalogStore = defineStore('catalog', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Map of all assets keyed by ID.
   * Uses shallowRef to avoid deep reactivity on large collections.
   */
  const assets = shallowRef<Map<string, Asset>>(new Map())

  /**
   * Ordered list of asset IDs.
   * Determines display order in grid/filmstrip.
   */
  const assetIds = shallowRef<string[]>([])

  /**
   * Current folder path (display name).
   */
  const folderPath = ref<string | null>(null)

  /**
   * Whether a scan is currently in progress.
   */
  const isScanning = ref(false)

  /**
   * Current scan progress.
   */
  const scanProgress = ref<ScanProgress | null>(null)

  /**
   * Error message if last operation failed.
   */
  const error = ref<string | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Total number of assets.
   */
  const totalCount = computed(() => assetIds.value.length)

  /**
   * Number of picked assets.
   */
  const pickCount = computed(() => {
    let count = 0
    for (const asset of assets.value.values()) {
      if (asset.flag === 'pick') count++
    }
    return count
  })

  /**
   * Number of rejected assets.
   */
  const rejectCount = computed(() => {
    let count = 0
    for (const asset of assets.value.values()) {
      if (asset.flag === 'reject') count++
    }
    return count
  })

  /**
   * Number of unflagged assets.
   */
  const unflaggedCount = computed(() => {
    let count = 0
    for (const asset of assets.value.values()) {
      if (asset.flag === 'none') count++
    }
    return count
  })

  /**
   * Flag counts summary object.
   */
  const flagCounts = computed(() => ({
    all: totalCount.value,
    picks: pickCount.value,
    rejects: rejectCount.value,
    unflagged: unflaggedCount.value,
  }))

  /**
   * Thumbnail generation progress.
   * Tracks how many thumbnails are ready vs pending.
   */
  const thumbnailProgress = computed(() => {
    let ready = 0
    let pending = 0
    let loading = 0
    let error = 0

    for (const asset of assets.value.values()) {
      switch (asset.thumbnailStatus) {
        case 'ready':
          ready++
          break
        case 'pending':
          pending++
          break
        case 'loading':
          loading++
          break
        case 'error':
          error++
          break
      }
    }

    const total = ready + pending + loading + error
    return { ready, pending, loading, error, total }
  })

  /**
   * Percentage of thumbnails that are ready (0-100).
   */
  const thumbnailPercent = computed(() => {
    const { ready, total } = thumbnailProgress.value
    return total > 0 ? Math.round((ready / total) * 100) : 0
  })

  /**
   * Whether thumbnails are still being processed.
   */
  const isProcessingThumbnails = computed(() => {
    const { ready, total } = thumbnailProgress.value
    return total > 0 && ready < total
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Add a batch of assets to the catalog.
   * Used during scanning for progressive updates.
   */
  function addAssetBatch(newAssets: Asset[]): void {
    if (newAssets.length === 0) return

    // Create new Map with existing + new assets
    const newMap = new Map(assets.value)
    const newIds = [...assetIds.value]
    const existingIds = new Set(newIds)

    for (const asset of newAssets) {
      newMap.set(asset.id, asset)
      // Only add ID if not already in the list (prevents duplicates)
      if (!existingIds.has(asset.id)) {
        newIds.push(asset.id)
        existingIds.add(asset.id)
      }
    }

    // Trigger reactivity by replacing refs
    assets.value = newMap
    assetIds.value = newIds
  }

  /**
   * Update a single asset's properties.
   */
  function updateAsset(assetId: string, updates: Partial<Asset>): void {
    const existing = assets.value.get(assetId)
    if (!existing) return

    const updated = { ...existing, ...updates }
    const newMap = new Map(assets.value)
    newMap.set(assetId, updated)
    assets.value = newMap
  }

  /**
   * Update thumbnail status and URL for an asset.
   */
  function updateThumbnail(
    assetId: string,
    status: ThumbnailStatus,
    url: string | null,
  ): void {
    updateAsset(assetId, {
      thumbnailStatus: status,
      thumbnailUrl: url,
    })
  }

  /**
   * Update preview 1x status for an asset.
   */
  function updatePreviewStatus(assetId: string, status: ThumbnailStatus): void {
    updateAsset(assetId, {
      preview1xStatus: status,
    })
  }

  /**
   * Update preview 1x URL for an asset.
   */
  function updatePreviewUrl(assetId: string, url: string | null): void {
    updateAsset(assetId, {
      preview1xUrl: url,
      preview1xStatus: url ? 'ready' : 'error',
    })
  }

  /**
   * Update preview 1x status and URL for an asset.
   */
  function updatePreview(
    assetId: string,
    status: ThumbnailStatus,
    url: string | null,
  ): void {
    updateAsset(assetId, {
      preview1xStatus: status,
      preview1xUrl: url,
    })
  }

  /**
   * Set the flag status for a single asset.
   */
  function setFlag(assetId: string, flag: FlagStatus): void {
    updateAsset(assetId, { flag })
  }

  /**
   * Set the flag status for multiple assets.
   */
  function setFlagBatch(assetIds: string[], flag: FlagStatus): void {
    if (assetIds.length === 0) return

    const newMap = new Map(assets.value)
    for (const id of assetIds) {
      const existing = newMap.get(id)
      if (existing) {
        newMap.set(id, { ...existing, flag })
      }
    }
    assets.value = newMap
  }

  /**
   * Get a single asset by ID.
   */
  function getAsset(assetId: string): Asset | undefined {
    return assets.value.get(assetId)
  }

  /**
   * Get assets in order.
   */
  function getOrderedAssets(): Asset[] {
    return assetIds.value
      .map(id => assets.value.get(id))
      .filter((asset): asset is Asset => asset !== undefined)
  }

  /**
   * Set the current folder path.
   */
  function setFolderPath(path: string | null): void {
    folderPath.value = path
  }

  /**
   * Update scan progress.
   */
  function setScanProgress(progress: ScanProgress | null): void {
    scanProgress.value = progress
  }

  /**
   * Set scanning state.
   */
  function setScanning(scanning: boolean): void {
    isScanning.value = scanning
    if (!scanning) {
      scanProgress.value = null
    }
  }

  /**
   * Set error message.
   */
  function setError(message: string | null): void {
    error.value = message
  }

  /**
   * Clear all state (e.g., when switching folders).
   */
  function clear(): void {
    // Revoke any existing thumbnail and preview URLs to prevent memory leaks
    for (const asset of assets.value.values()) {
      if (asset.thumbnailUrl) {
        URL.revokeObjectURL(asset.thumbnailUrl)
      }
      if (asset.preview1xUrl) {
        URL.revokeObjectURL(asset.preview1xUrl)
      }
    }

    assets.value = new Map()
    assetIds.value = []
    folderPath.value = null
    isScanning.value = false
    scanProgress.value = null
    error.value = null
  }

  /**
   * Revoke thumbnail URLs for specific assets.
   * Called when assets are removed or thumbnails are replaced.
   */
  function revokeThumbnailUrls(ids: string[]): void {
    for (const id of ids) {
      const asset = assets.value.get(id)
      if (asset?.thumbnailUrl) {
        URL.revokeObjectURL(asset.thumbnailUrl)
      }
    }
  }

  return {
    // State
    assets,
    assetIds,
    folderPath,
    isScanning,
    scanProgress,
    error,

    // Computed
    totalCount,
    pickCount,
    rejectCount,
    unflaggedCount,
    flagCounts,
    thumbnailProgress,
    thumbnailPercent,
    isProcessingThumbnails,

    // Actions
    addAssetBatch,
    updateAsset,
    updateThumbnail,
    updatePreviewStatus,
    updatePreviewUrl,
    updatePreview,
    setFlag,
    setFlagBatch,
    getAsset,
    getOrderedAssets,
    setFolderPath,
    setScanProgress,
    setScanning,
    setError,
    clear,
    revokeThumbnailUrls,
  }
})
