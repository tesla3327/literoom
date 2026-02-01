/**
 * useCatalog Composable
 *
 * Provides access to the CatalogService and common catalog operations.
 * Works with both real and mock services (demo mode).
 *
 * IMPORTANT: The catalog plugin is async and may not be ready immediately.
 * Pages that use this composable should apply the 'ensure-catalog' middleware
 * to guarantee $catalogService is available.
 */
import type { ICatalogService, FlagStatus, EditState, MaskStack } from '@literoom/core/catalog'
import { ThumbnailPriority } from '@literoom/core/catalog'
import type { EditedThumbnailEditState, MaskStackData } from '@literoom/core/decode'

// Loading state for import process
const isLoading = ref(false)
const loadingMessage = ref('')

/**
 * Convert MaskStack (catalog format) to MaskStackData (worker format).
 */
function convertMaskStackToWorkerFormat(masks: MaskStack): MaskStackData {
  return {
    linearMasks: masks.linearMasks.map(m => ({
      startX: m.start.x,
      startY: m.start.y,
      endX: m.end.x,
      endY: m.end.y,
      feather: m.feather,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
    radialMasks: masks.radialMasks.map(m => ({
      centerX: m.center.x,
      centerY: m.center.y,
      radiusX: m.radiusX,
      radiusY: m.radiusY,
      rotation: m.rotation,
      feather: m.feather,
      invert: m.invert,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
  }
}

/**
 * Convert EditState to EditedThumbnailEditState for regeneration.
 */
function convertEditStateToWorkerFormat(state: EditState): EditedThumbnailEditState {
  return {
    adjustments: state.adjustments,
    toneCurve: state.adjustments.toneCurve,
    crop: state.cropTransform.crop,
    rotation: state.cropTransform.rotation,
    masks: state.masks ? convertMaskStackToWorkerFormat(state.masks) : undefined,
  }
}

export function useCatalog() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()

  // Access services from plugin
  // Note: May be undefined if plugin hasn't finished initializing
  // Use 'ensure-catalog' middleware on pages to guarantee availability
  const catalogService = nuxtApp.$catalogService as ICatalogService | undefined
  const isDemoMode = config.public.demoMode

  // Helper to safely access the service with a clear error message
  function requireCatalogService(): ICatalogService {
    if (!catalogService) {
      throw new Error(
        'Catalog service not initialized. Ensure this page uses the "ensure-catalog" middleware.',
      )
    }
    return catalogService
  }

  // Access stores
  const catalogStore = useCatalogStore()
  const catalogUIStore = useCatalogUIStore()
  const selectionStore = useSelectionStore()

  /**
   * Get the number of thumbnails that fit on the first visible page.
   * Assumes typical grid layout: 5 columns × 4 visible rows = 20 thumbnails.
   */
  function getFirstPageCount(): number {
    // Could be made dynamic based on viewport in future
    return 20
  }

  /**
   * Wait for first page of photos to be fully ready (thumbnail + preview).
   * Returns a promise that resolves when enough photos are ready.
   */
  async function waitForReadyPhotos(): Promise<void> {
    const targetCount = Math.min(getFirstPageCount(), catalogStore.assetIds.length)

    // Nothing to wait for
    if (targetCount === 0) return

    return new Promise((resolve) => {
      const unwatch = watch(
        () => catalogStore.readyCount,
        (ready) => {
          if (ready >= targetCount) {
            unwatch()
            resolve()
          }
        },
        { immediate: true },
      )

      // Timeout fallback after 15 seconds (increased from 10 since we're doing more work)
      setTimeout(() => {
        unwatch()
        resolve()
      }, 15000)
    })
  }

  /**
   * Select a folder and begin scanning.
   * In demo mode, loads the demo catalog automatically.
   * In real mode, uses CatalogService which handles folder picker and persistence.
   * Waits for first page of thumbnails before returning.
   */
  async function selectFolder(): Promise<void> {
    const service = requireCatalogService()

    // Clear previous state
    catalogStore.clear()
    selectionStore.clear()

    if (isDemoMode) {
      catalogStore.setFolderPath('Demo Photos')
    }

    isLoading.value = true
    loadingMessage.value = 'Scanning folder...'
    catalogStore.setScanning(true)

    try {
      // selectFolder() shows the folder picker (real mode) or initializes mock data (demo mode)
      // It also sets _currentFolder internally and persists the handle
      await service.selectFolder()

      // Get the folder name for UI display (real mode)
      if (!isDemoMode) {
        const folder = service.getCurrentFolder()
        if (folder) {
          catalogStore.setFolderPath(folder.name)
        }
      }

      // Scan the folder (callbacks wire to stores via plugin)
      await service.scanFolder()

      // Wait for first page of photos to be fully ready
      loadingMessage.value = 'Preparing photos...'
      await waitForReadyPhotos()
    }
    finally {
      catalogStore.setScanning(false)
      isLoading.value = false
      loadingMessage.value = ''
    }
  }

  /**
   * Restore session from saved folder handle.
   * Returns true if restoration was successful.
   */
  async function restoreSession(): Promise<boolean> {
    const service = requireCatalogService()

    // If assets are already loaded, skip restoration
    // This prevents re-scanning when returning to the gallery from edit view
    if (catalogStore.assetIds.length > 0) {
      return true
    }

    if (isDemoMode) {
      // Demo mode: auto-load demo catalog
      await selectFolder()
      return true
    }

    // Real mode: try to load from CatalogService's database
    try {
      const restored = await service.loadFromDatabase()
      if (!restored) {
        return false
      }

      // Get folder name for UI display
      const folder = service.getCurrentFolder()
      if (folder) {
        catalogStore.setFolderPath(folder.name)
      }

      return true
    }
    catch {
      return false
    }
  }

  /**
   * Set flag for selected assets.
   * Applies to current asset if no multi-selection.
   */
  async function setFlag(flag: FlagStatus): Promise<void> {
    const service = requireCatalogService()
    const selectedIds = selectionStore.selectedIds
    const currentId = selectionStore.currentId

    if (selectedIds.size > 0) {
      await service.setFlagBatch([...selectedIds], flag)
    }
    else if (currentId) {
      await service.setFlag(currentId, flag)
    }
  }

  /**
   * Pick the selected assets.
   */
  async function pick(): Promise<void> {
    await setFlag('pick')
  }

  /**
   * Reject the selected assets.
   */
  async function reject(): Promise<void> {
    await setFlag('reject')
  }

  /**
   * Clear flag from selected assets.
   */
  async function clearFlag(): Promise<void> {
    await setFlag('none')
  }

  /**
   * Request thumbnail generation for an asset.
   */
  function requestThumbnail(assetId: string, priority: number): void {
    const service = requireCatalogService()
    service.requestThumbnail(assetId, priority)
  }

  /**
   * Update thumbnail priority for viewport-aware loading.
   */
  function updateThumbnailPriority(assetId: string, priority: number): void {
    const service = requireCatalogService()
    service.updateThumbnailPriority(assetId, priority)
  }

  /**
   * Request preview generation for an asset.
   * Previews are larger (2560px) than thumbnails (512px).
   */
  function requestPreview(assetId: string, priority: number): void {
    const service = requireCatalogService()
    service.requestPreview(assetId, priority)
  }

  /**
   * Update preview priority for viewport-aware loading.
   */
  function updatePreviewPriority(assetId: string, priority: number): void {
    const service = requireCatalogService()
    service.updatePreviewPriority(assetId, priority)
  }

  /**
   * Rescan the current folder to detect new and modified files.
   * Shows a toast notification when complete.
   */
  async function rescanFolder(): Promise<void> {
    const service = requireCatalogService()
    const toast = useToast()

    // Can't rescan if no folder is loaded
    if (!catalogStore.folderPath) {
      toast.add({
        title: 'No folder selected',
        description: 'Select a folder first to rescan',
        color: 'warning',
      })
      return
    }

    catalogStore.setScanning(true)

    try {
      const previousCount = catalogStore.totalCount
      await service.rescanFolder()

      const newCount = catalogStore.totalCount
      const diff = newCount - previousCount

      if (diff > 0) {
        toast.add({
          title: 'Catalog updated',
          description: `Found ${diff} new image${diff === 1 ? '' : 's'}`,
          color: 'success',
        })
      }
      else {
        toast.add({
          title: 'Catalog up to date',
          description: `${newCount} image${newCount === 1 ? '' : 's'} in catalog`,
          color: 'success',
        })
      }
    }
    catch (error) {
      toast.add({
        title: 'Rescan failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        color: 'error',
      })
    }
    finally {
      catalogStore.setScanning(false)
    }
  }

  /**
   * Regenerate thumbnail for an asset with its current edits applied.
   * Used to update gallery thumbnails after editing.
   */
  async function regenerateThumbnail(assetId: string): Promise<void> {
    const service = requireCatalogService()
    const editStore = useEditStore()

    // Get edit state for this asset
    const editState = editStore.getEditStateForAsset(assetId)
    if (!editState) {
      console.warn('[useCatalog] No edit state found for asset:', assetId)
      return
    }

    // Convert to worker format
    const workerEditState = convertEditStateToWorkerFormat(editState)

    // Trigger regeneration via catalog service
    await service.regenerateThumbnail(assetId, workerEditState)
  }

  /**
   * Preload previews for adjacent assets in the sorted/filtered list.
   * This helps with smoother navigation in the edit view.
   */
  function preloadAdjacentPreviews(currentAssetId: string, range: number = 2): void {
    console.log('[useCatalog] Preloading adjacent previews...')

    const service = requireCatalogService()
    const sortedIds = catalogUIStore.sortedAssetIds
    const currentIndex = sortedIds.indexOf(currentAssetId)

    if (currentIndex === -1) {
      console.log('[useCatalog] Current asset not found in sorted list')
      return
    }

    // Collect asset IDs to preload (N±1 to N±range, excluding N±0 which is the current asset)
    const idsToPreload: string[] = []

    for (let offset = 1; offset <= range; offset++) {
      // Previous assets
      const prevIndex = currentIndex - offset
      if (prevIndex >= 0) {
        idsToPreload.push(sortedIds[prevIndex])
      }

      // Next assets
      const nextIndex = currentIndex + offset
      if (nextIndex < sortedIds.length) {
        idsToPreload.push(sortedIds[nextIndex])
      }
    }

    // Request previews for assets that are not already ready
    for (const assetId of idsToPreload) {
      const asset = catalogStore.getAsset(assetId)
      if (asset && asset.preview1xStatus !== 'ready') {
        console.log(`[useCatalog] Requesting preview for adjacent asset: ${assetId}`)
        service.requestPreview(assetId, ThumbnailPriority.BACKGROUND)
      }
    }
  }

  /**
   * Cancel background preview preloads.
   * Stops all BACKGROUND priority requests to prioritize active work.
   */
  function cancelBackgroundPreloads(): void {
    const service = requireCatalogService()
    const cancelled = service.cancelBackgroundRequests()
    if (cancelled > 0) {
      console.log(`[useCatalog] Cancelled ${cancelled} background preload(s)`)
    }
  }

  /**
   * Delete assets from the catalog.
   * Removes from database, updates UI state, and clears selection.
   */
  async function deleteAssets(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return

    const service = requireCatalogService()

    // Remove from database
    await service.removeAssets(assetIds)

    // Update UI state (revokes blob URLs and removes from store)
    catalogStore.removeAssetBatch(assetIds)

    // Clear selection for deleted assets
    for (const assetId of assetIds) {
      selectionStore.removeFromSelection(assetId)
    }
  }

  return {
    // Services (may be undefined until plugin initializes)
    catalogService,
    isDemoMode,

    // Loading state for import process
    isLoading,
    loadingMessage,

    // Operations (will throw if service not ready)
    selectFolder,
    restoreSession,
    setFlag,
    pick,
    reject,
    clearFlag,
    requestThumbnail,
    updateThumbnailPriority,
    requestPreview,
    updatePreviewPriority,
    rescanFolder,
    regenerateThumbnail,
    preloadAdjacentPreviews,
    cancelBackgroundPreloads,
    deleteAssets,
  }
}
