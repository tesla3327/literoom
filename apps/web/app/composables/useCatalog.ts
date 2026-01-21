/**
 * useCatalog Composable
 *
 * Provides access to the CatalogService and common catalog operations.
 * Works with both real and mock services (demo mode).
 */
import type { ICatalogService, FlagStatus } from '@literoom/core/catalog'
import type { DirectoryHandle } from '@literoom/core/filesystem'

export function useCatalog() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()

  // Access services from plugin
  const catalogService = nuxtApp.$catalogService as ICatalogService
  const isDemoMode = config.public.demoMode

  // Access stores
  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()

  /**
   * Select a folder and begin scanning.
   * In demo mode, loads the demo catalog automatically.
   */
  async function selectFolder(): Promise<void> {
    if (isDemoMode) {
      // Demo mode: trigger auto-scan with mock service
      catalogStore.clear()
      selectionStore.clear()
      catalogStore.setFolderPath('Demo Photos')
      catalogStore.setScanning(true)

      try {
        await catalogService.selectFolder()
        await catalogService.scanFolder()
      }
      finally {
        catalogStore.setScanning(false)
      }
      return
    }

    // Real mode: use BrowserFileSystemProvider
    const { BrowserFileSystemProvider } = await import('@literoom/core/filesystem')
    const fsProvider = new BrowserFileSystemProvider()

    // Show folder picker
    const handle = await fsProvider.selectDirectory()

    // Save handle for session restoration
    await fsProvider.saveHandle('main-folder', handle)

    // Clear previous state
    catalogStore.clear()
    selectionStore.clear()

    // Set folder path
    catalogStore.setFolderPath(handle.name)
    catalogStore.setScanning(true)

    try {
      // Scan the folder (callbacks wire to stores via plugin)
      await catalogService.scanFolder()
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
    if (isDemoMode) {
      // Demo mode: auto-load demo catalog
      await selectFolder()
      return true
    }

    // Real mode: try to load from database
    const { BrowserFileSystemProvider } = await import('@literoom/core/filesystem')
    const fsProvider = new BrowserFileSystemProvider()

    try {
      const savedHandle = await fsProvider.loadHandle('main-folder')
      if (!savedHandle) return false

      // Check permission
      const permissionState = await fsProvider.queryPermission(savedHandle, 'read')
      if (permissionState !== 'granted') {
        // Return false - caller should show permission recovery UI
        return false
      }

      // Set folder path and scan
      catalogStore.setFolderPath(savedHandle.name)
      catalogStore.setScanning(true)

      try {
        await catalogService.scanFolder()
      }
      finally {
        catalogStore.setScanning(false)
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
    const selectedIds = selectionStore.selectedIds
    const currentId = selectionStore.currentId

    if (selectedIds.size > 0) {
      await catalogService.setFlagBatch([...selectedIds], flag)
    }
    else if (currentId) {
      await catalogService.setFlag(currentId, flag)
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
    catalogService.requestThumbnail(assetId, priority)
  }

  /**
   * Update thumbnail priority for viewport-aware loading.
   */
  function updateThumbnailPriority(assetId: string, priority: number): void {
    catalogService.updateThumbnailPriority(assetId, priority)
  }

  return {
    // Services
    catalogService,
    isDemoMode,

    // Operations
    selectFolder,
    restoreSession,
    setFlag,
    pick,
    reject,
    clearFlag,
    requestThumbnail,
    updateThumbnailPriority,
  }
}
