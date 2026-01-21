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
import type { ICatalogService, FlagStatus } from '@literoom/core/catalog'

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
  const selectionStore = useSelectionStore()

  /**
   * Select a folder and begin scanning.
   * In demo mode, loads the demo catalog automatically.
   * In real mode, uses CatalogService which handles folder picker and persistence.
   */
  async function selectFolder(): Promise<void> {
    const service = requireCatalogService()

    // Clear previous state
    catalogStore.clear()
    selectionStore.clear()

    if (isDemoMode) {
      catalogStore.setFolderPath('Demo Photos')
    }

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
    }
    finally {
      catalogStore.setScanning(false)
    }
  }

  /**
   * Restore session from saved folder handle.
   * Returns true if restoration was successful.
   */
  async function restoreSession(): Promise<boolean> {
    const service = requireCatalogService()

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

  return {
    // Services (may be undefined until plugin initializes)
    catalogService,
    isDemoMode,

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
  }
}
