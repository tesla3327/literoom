/**
 * Catalog UI Store
 *
 * Manages UI-specific state:
 * - Filter mode (all, picks, rejects, unflagged)
 * - Sort field and direction
 * - View mode (grid, loupe)
 *
 * Provides computed filtered/sorted asset IDs for display.
 */
import type { FilterMode, SortField, SortDirection, ViewMode, Asset } from '@literoom/core/catalog'
import { useCatalogStore } from './catalog'

export const useCatalogUIStore = defineStore('catalogUI', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Current filter mode.
   */
  const filterMode = ref<FilterMode>('all')

  /**
   * Current sort field.
   */
  const sortField = ref<SortField>('captureDate')

  /**
   * Current sort direction.
   */
  const sortDirection = ref<SortDirection>('desc')

  /**
   * Current view mode.
   */
  const viewMode = ref<ViewMode>('grid')

  /**
   * Number of columns in grid view (for responsive layout).
   */
  const gridColumns = ref(4)

  /**
   * Thumbnail size in pixels.
   */
  const thumbnailSize = ref(200)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Filtered asset IDs based on current filter mode.
   */
  const filteredAssetIds = computed<string[]>(() => {
    const catalogStore = useCatalogStore()
    const assetsMap = catalogStore.assets
    const ids = catalogStore.assetIds

    if (filterMode.value === 'all') {
      return ids
    }

    return ids.filter((id: string) => {
      const asset = assetsMap.get(id)
      if (!asset) return false

      switch (filterMode.value) {
        case 'picks':
          return asset.flag === 'pick'
        case 'rejects':
          return asset.flag === 'reject'
        case 'unflagged':
          return asset.flag === 'none'
        default:
          return true
      }
    })
  })

  /**
   * Filtered and sorted asset IDs.
   */
  const sortedAssetIds = computed<string[]>(() => {
    const catalogStore = useCatalogStore()
    const assetsMap = catalogStore.assets
    const filtered = filteredAssetIds.value

    // Create array of [id, asset] for sorting
    const withAssets: Array<[string, Asset]> = []
    for (const id of filtered) {
      const asset = assetsMap.get(id)
      if (asset) {
        withAssets.push([id, asset])
      }
    }

    // Sort based on current field and direction
    withAssets.sort((a, b) => {
      const assetA = a[1]
      const assetB = b[1]
      let comparison = 0

      switch (sortField.value) {
        case 'captureDate': {
          const dateA = assetA.captureDate?.getTime() ?? 0
          const dateB = assetB.captureDate?.getTime() ?? 0
          comparison = dateA - dateB
          break
        }
        case 'filename':
          comparison = assetA.filename.localeCompare(assetB.filename)
          break
        case 'fileSize':
          comparison = assetA.fileSize - assetB.fileSize
          break
      }

      return sortDirection.value === 'asc' ? comparison : -comparison
    })

    return withAssets.map(pair => pair[0])
  })

  /**
   * Total count after filtering.
   */
  const filteredCount = computed(() => filteredAssetIds.value.length)

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Set the filter mode.
   */
  function setFilterMode(mode: FilterMode): void {
    filterMode.value = mode
  }

  /**
   * Set the sort field.
   */
  function setSortField(field: SortField): void {
    sortField.value = field
  }

  /**
   * Set the sort direction.
   */
  function setSortDirection(direction: SortDirection): void {
    sortDirection.value = direction
  }

  /**
   * Toggle sort direction.
   */
  function toggleSortDirection(): void {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  }

  /**
   * Set view mode (grid or loupe).
   */
  function setViewMode(mode: ViewMode): void {
    viewMode.value = mode
  }

  /**
   * Toggle between grid and loupe view.
   */
  function toggleViewMode(): void {
    viewMode.value = viewMode.value === 'grid' ? 'loupe' : 'grid'
  }

  /**
   * Set the number of grid columns.
   */
  function setGridColumns(columns: number): void {
    gridColumns.value = Math.max(1, Math.min(12, columns))
  }

  /**
   * Set the thumbnail size.
   */
  function setThumbnailSize(size: number): void {
    thumbnailSize.value = Math.max(100, Math.min(400, size))
  }

  /**
   * Reset to default settings.
   */
  function resetToDefaults(): void {
    filterMode.value = 'all'
    sortField.value = 'captureDate'
    sortDirection.value = 'desc'
    viewMode.value = 'grid'
    gridColumns.value = 4
    thumbnailSize.value = 200
  }

  return {
    // State
    filterMode,
    sortField,
    sortDirection,
    viewMode,
    gridColumns,
    thumbnailSize,

    // Computed
    filteredAssetIds,
    sortedAssetIds,
    filteredCount,

    // Actions
    setFilterMode,
    setSortField,
    setSortDirection,
    toggleSortDirection,
    setViewMode,
    toggleViewMode,
    setGridColumns,
    setThumbnailSize,
    resetToDefaults,
  }
})
