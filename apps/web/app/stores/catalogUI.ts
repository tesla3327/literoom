/**
 * Catalog UI Store
 *
 * Manages UI-specific state:
 * - Filter mode (all, picks, rejects, unflagged)
 * - Sort field and direction
 * - View mode (grid, loupe)
 *
 * Provides computed filtered/sorted asset IDs for display.
 *
 * Filter and sort settings are persisted to sessionStorage to survive
 * page navigation within the session.
 */
import type { FilterMode, SortField, SortDirection, ViewMode, Asset } from '@literoom/core/catalog'
import { useCatalogStore } from './catalog'

// ============================================================================
// Session Storage Keys
// ============================================================================

const STORAGE_KEY_FILTER = 'literoom_filter_mode'
const STORAGE_KEY_SORT_FIELD = 'literoom_sort_field'
const STORAGE_KEY_SORT_DIRECTION = 'literoom_sort_direction'

// ============================================================================
// Type Guards
// ============================================================================

const VALID_FILTER_MODES: FilterMode[] = ['all', 'picks', 'rejects', 'unflagged']
const VALID_SORT_FIELDS: SortField[] = ['captureDate', 'filename', 'fileSize']
const VALID_SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc']

function isValidFilterMode(value: string): value is FilterMode {
  return VALID_FILTER_MODES.includes(value as FilterMode)
}

function isValidSortField(value: string): value is SortField {
  return VALID_SORT_FIELDS.includes(value as SortField)
}

function isValidSortDirection(value: string): value is SortDirection {
  return VALID_SORT_DIRECTIONS.includes(value as SortDirection)
}

// ============================================================================
// Session Storage Helpers
// ============================================================================

function getStorageValue<T>(key: string, validator: (v: string) => v is T, defaultValue: T): T {
  if (import.meta.server) return defaultValue
  try {
    const stored = sessionStorage.getItem(key)
    if (stored && validator(stored)) {
      return stored
    }
  }
  catch {
    // sessionStorage not available or error reading
  }
  return defaultValue
}

function setStorageValue(key: string, value: string): void {
  if (import.meta.server) return
  try {
    sessionStorage.setItem(key, value)
  }
  catch {
    // sessionStorage not available or quota exceeded
  }
}

function clearStorageValue(key: string): void {
  if (import.meta.server) return
  try {
    sessionStorage.removeItem(key)
  }
  catch {
    // sessionStorage not available
  }
}

export const useCatalogUIStore = defineStore('catalogUI', () => {
  // ============================================================================
  // State (with session storage restoration)
  // ============================================================================

  /**
   * Current filter mode.
   * Persisted to sessionStorage.
   */
  const filterMode = ref<FilterMode>(
    getStorageValue(STORAGE_KEY_FILTER, isValidFilterMode, 'all'),
  )

  /**
   * Current sort field.
   * Persisted to sessionStorage.
   */
  const sortField = ref<SortField>(
    getStorageValue(STORAGE_KEY_SORT_FIELD, isValidSortField, 'captureDate'),
  )

  /**
   * Current sort direction.
   * Persisted to sessionStorage.
   */
  const sortDirection = ref<SortDirection>(
    getStorageValue(STORAGE_KEY_SORT_DIRECTION, isValidSortDirection, 'desc'),
  )

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
   * Persists to sessionStorage.
   */
  function setFilterMode(mode: FilterMode): void {
    filterMode.value = mode
    setStorageValue(STORAGE_KEY_FILTER, mode)
  }

  /**
   * Set the sort field.
   * Persists to sessionStorage.
   */
  function setSortField(field: SortField): void {
    sortField.value = field
    setStorageValue(STORAGE_KEY_SORT_FIELD, field)
  }

  /**
   * Set the sort direction.
   * Persists to sessionStorage.
   */
  function setSortDirection(direction: SortDirection): void {
    sortDirection.value = direction
    setStorageValue(STORAGE_KEY_SORT_DIRECTION, direction)
  }

  /**
   * Toggle sort direction.
   * Persists to sessionStorage.
   */
  function toggleSortDirection(): void {
    const newDirection = sortDirection.value === 'asc' ? 'desc' : 'asc'
    sortDirection.value = newDirection
    setStorageValue(STORAGE_KEY_SORT_DIRECTION, newDirection)
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
   * Clears sessionStorage values.
   */
  function resetToDefaults(): void {
    filterMode.value = 'all'
    sortField.value = 'captureDate'
    sortDirection.value = 'desc'
    viewMode.value = 'grid'
    gridColumns.value = 4
    thumbnailSize.value = 200

    // Clear persisted values
    clearStorageValue(STORAGE_KEY_FILTER)
    clearStorageValue(STORAGE_KEY_SORT_FIELD)
    clearStorageValue(STORAGE_KEY_SORT_DIRECTION)
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
