/**
 * useRecentFolders Composable
 *
 * Provides access to recently opened folders and folder management operations.
 * Works with both real and mock services (demo mode returns empty list).
 *
 * IMPORTANT: The catalog plugin is async and may not be ready immediately.
 * Use after the catalog service has been initialized.
 */
import type { ICatalogService, FolderInfo } from '@literoom/core/catalog'

export function useRecentFolders() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()

  // Access services from plugin
  const catalogService = nuxtApp.$catalogService as ICatalogService | undefined
  const isDemoMode = config.public.demoMode

  // Access the catalog composable for shared operations
  const { selectFolder } = useCatalog()

  // Access stores
  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()

  // State
  const recentFolders = ref<FolderInfo[]>([])
  const isLoadingFolders = ref(false)
  const isLoadingFolderId = ref<number | null>(null)
  const error = ref<string | null>(null)

  /**
   * Helper to safely access the service with a clear error message.
   */
  function requireCatalogService(): ICatalogService {
    if (!catalogService) {
      throw new Error(
        'Catalog service not initialized. Ensure this page uses the "ensure-catalog" middleware.',
      )
    }
    return catalogService
  }

  /**
   * Load the list of recent folders from the database.
   * Orders by last scan date (most recent first).
   *
   * @param limit Maximum number of folders to return (default: 5)
   */
  async function loadRecentFolders(limit: number = 5): Promise<void> {
    // Demo mode has no persisted folders
    if (isDemoMode) {
      recentFolders.value = []
      return
    }

    const service = requireCatalogService()
    isLoadingFolders.value = true
    error.value = null

    try {
      recentFolders.value = await service.listFolders(limit)
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load folders'
      console.error('[useRecentFolders] Failed to load folders:', err)
      recentFolders.value = []
    }
    finally {
      isLoadingFolders.value = false
    }
  }

  /**
   * Open a specific recent folder.
   * Loads the folder by ID and populates the catalog store.
   *
   * @param folder The folder info to open
   * @returns true if the folder was opened successfully
   */
  async function openRecentFolder(folder: FolderInfo): Promise<boolean> {
    // Demo mode doesn't support loading specific folders
    if (isDemoMode) {
      return false
    }

    const service = requireCatalogService()
    isLoadingFolderId.value = folder.id
    error.value = null

    try {
      // Clear previous state
      catalogStore.clear()
      selectionStore.clear()

      // Load the folder
      const success = await service.loadFolderById(folder.id)
      if (success) {
        catalogStore.setFolderPath(folder.name)
      }

      return success
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to open folder'
      console.error('[useRecentFolders] Failed to open folder:', err)
      return false
    }
    finally {
      isLoadingFolderId.value = null
    }
  }

  /**
   * Open a new folder using the file picker.
   * Wrapper around useCatalog's selectFolder for convenience.
   *
   * @returns true if a folder was selected successfully
   */
  async function openNewFolder(): Promise<boolean> {
    error.value = null

    try {
      await selectFolder()
      return true
    }
    catch (err) {
      // AbortError means user cancelled - not an error
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false
      }

      error.value = err instanceof Error ? err.message : 'Failed to select folder'
      console.error('[useRecentFolders] Failed to select folder:', err)
      return false
    }
  }

  /**
   * Check if a folder is currently accessible (permission granted).
   * This is already populated in the FolderInfo.isAccessible field,
   * but this method can be used to recheck.
   *
   * @param folder The folder to check
   * @returns true if the folder is accessible
   */
  async function checkFolderAccess(folder: FolderInfo): Promise<boolean> {
    // Demo mode doesn't have real folders
    if (isDemoMode) {
      return false
    }

    // Use the isAccessible property from listFolders
    // This was computed when the list was loaded
    return folder.isAccessible ?? false
  }

  /**
   * Computed property: whether there are any recent folders.
   */
  const hasRecentFolders = computed(() => recentFolders.value.length > 0)

  /**
   * Computed property: accessible recent folders only.
   */
  const accessibleFolders = computed(() =>
    recentFolders.value.filter(f => f.isAccessible),
  )

  /**
   * Computed property: inaccessible recent folders only.
   */
  const inaccessibleFolders = computed(() =>
    recentFolders.value.filter(f => !f.isAccessible),
  )

  return {
    // State
    recentFolders,
    isLoadingFolders,
    isLoadingFolderId,
    error,

    // Computed
    hasRecentFolders,
    accessibleFolders,
    inaccessibleFolders,

    // Demo mode
    isDemoMode,

    // Actions
    loadRecentFolders,
    openRecentFolder,
    openNewFolder,
    checkFolderAccess,
  }
}
