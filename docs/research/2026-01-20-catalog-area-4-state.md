# Research: Catalog Service Area 4 - State Management

**Date**: 2026-01-20
**Area**: Reactive State Management (Vue/Pinia)
**Status**: Complete
**Priority**: High (enables UI responsiveness and filtering)

---

## Executive Summary

This document covers Vue/Pinia state management patterns for a photo catalog application with 100s to 1000s of assets. Key recommendations:

1. **Normalized State with Map Lookups**: Use `{ ids: string[], entities: Record<string, Asset> }` pattern for O(1) lookups
2. **Computed Getters for Filtering**: Cached computed properties for Picks/Rejects/Unflagged views
3. **ShallowRef for Performance**: Use `shallowRef` for large asset lists to avoid deep reactivity overhead
4. **Separate Concerns**: Split catalog state, UI state, and selection state into focused stores
5. **TanStack Virtual Integration**: Integrate virtual scrolling with Pinia for efficient rendering

---

## 1. Store Structure for Large Asset Collections

### 1.1 Normalized State Pattern

For collections of 1000+ items, **normalized state** dramatically improves performance over nested arrays:

```typescript
// Bad: Nested array structure - O(n) lookups
interface BadCatalogState {
  assets: Asset[]  // Finding by ID requires array.find()
}

// Good: Normalized with Map pattern - O(1) lookups
interface CatalogState {
  /** Ordered list of asset IDs for maintaining sort order */
  assetIds: string[]
  /** Map of asset ID to asset data for O(1) lookups */
  assets: Map<string, Asset>
  /** Catalog metadata */
  folderPath: string
  lastScanTime: number | null
}
```

**Why This Works**:
- **O(1) Lookups**: `assets.get(id)` instead of `assets.find(a => a.id === id)`
- **Maintained Order**: `assetIds` array preserves sort order
- **Efficient Updates**: Updating one asset doesn't require array replacement
- **Memory Efficiency**: No duplicate references

### 1.2 TypeScript Interfaces

```typescript
// ============================================
// Core Asset Types
// ============================================

/**
 * Flag status for culling workflow
 */
export type FlagStatus = 'unflagged' | 'pick' | 'reject'

/**
 * Thumbnail generation status
 */
export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error'

/**
 * Preview generation status
 */
export type PreviewStatus = 'pending' | 'loading' | 'ready' | 'error'

/**
 * Represents a photo asset in the catalog
 */
export interface Asset {
  /** Unique identifier (file path hash or UUID) */
  id: string
  /** Original file name */
  fileName: string
  /** Full path to the file */
  filePath: string
  /** File type detected from magic bytes */
  fileType: 'jpeg' | 'raw' | 'unknown'
  /** File size in bytes */
  fileSize: number
  /** Last modified timestamp */
  lastModified: number
  /** Flag status for culling */
  flag: FlagStatus
  /** Thumbnail generation status */
  thumbnailStatus: ThumbnailStatus
  /** Object URL for thumbnail (when ready) */
  thumbnailUrl: string | null
  /** Preview 1x generation status */
  preview1xStatus: PreviewStatus
  /** Preview 1x Object URL (when ready) */
  preview1xUrl: string | null
  /** Preview 2x generation status */
  preview2xStatus: PreviewStatus
  /** Preview 2x Object URL (when ready) */
  preview2xUrl: string | null
  /** Edit state (null if no edits) */
  editState: EditState | null
  /** EXIF metadata (loaded lazily) */
  metadata: AssetMetadata | null
}

/**
 * EXIF and file metadata
 */
export interface AssetMetadata {
  width: number
  height: number
  dateTaken: string | null
  camera: string | null
  lens: string | null
  iso: number | null
  aperture: number | null
  shutterSpeed: string | null
  focalLength: number | null
}

/**
 * Non-destructive edit settings
 */
export interface EditState {
  /** Schema version for migrations */
  version: number
  /** Basic adjustments */
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
  temperature: number
  tint: number
  /** Tone curve control points */
  toneCurve: ToneCurvePoint[]
  /** Crop and transform */
  crop: CropSettings | null
  /** Local adjustment masks */
  masks: Mask[]
}

// ============================================
// Filter & View State Types
// ============================================

/**
 * Filter options for the asset grid
 */
export type FilterMode = 'all' | 'picks' | 'rejects' | 'unflagged'

/**
 * View mode for the catalog
 */
export type ViewMode = 'grid' | 'loupe'

/**
 * Sort field options
 */
export type SortField = 'fileName' | 'dateTaken' | 'lastModified' | 'fileSize'

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

// ============================================
// Selection State Types
// ============================================

/**
 * Selection state for single and multi-select
 */
export interface SelectionState {
  /** Currently focused asset (for keyboard navigation) */
  currentId: string | null
  /** Set of selected asset IDs for multi-select */
  selectedIds: Set<string>
  /** Last clicked asset ID for shift-click range selection */
  lastClickedId: string | null
}
```

### 1.3 Modular Store Architecture

Split state into focused stores for better maintainability:

```typescript
// stores/catalog.ts - Asset data and persistence
// stores/catalogUI.ts - View, filter, and sort state
// stores/selection.ts - Selection state
```

**Benefits**:
- Better TypeScript inference
- Clearer separation of concerns
- Easier testing
- Reduced re-render scope

---

## 2. Reactive Updates for Thumbnail Completion

### 2.1 The Challenge

When thumbnails complete asynchronously, we need to update the UI efficiently without triggering full list re-renders.

### 2.2 Recommended Pattern: Shallow + Targeted Updates

```typescript
// stores/catalog.ts
import { defineStore } from 'pinia'
import { shallowRef, triggerRef, computed } from 'vue'

export const useCatalogStore = defineStore('catalog', () => {
  // Use shallowRef for the asset map to avoid deep reactivity
  // Vue only tracks .value replacement, not internal mutations
  const assets = shallowRef<Map<string, Asset>>(new Map())
  const assetIds = shallowRef<string[]>([])

  /**
   * Update a single asset's thumbnail status
   * Uses triggerRef to notify watchers after mutation
   */
  function updateThumbnail(
    assetId: string,
    status: ThumbnailStatus,
    url: string | null
  ): void {
    const asset = assets.value.get(assetId)
    if (!asset) return

    // Mutate the asset in place
    asset.thumbnailStatus = status
    asset.thumbnailUrl = url

    // Trigger reactivity for this specific update
    triggerRef(assets)
  }

  /**
   * Batch update multiple thumbnails efficiently
   */
  function updateThumbnailBatch(
    updates: Array<{
      assetId: string
      status: ThumbnailStatus
      url: string | null
    }>
  ): void {
    let hasChanges = false

    for (const { assetId, status, url } of updates) {
      const asset = assets.value.get(assetId)
      if (asset) {
        asset.thumbnailStatus = status
        asset.thumbnailUrl = url
        hasChanges = true
      }
    }

    // Single trigger for batch update
    if (hasChanges) {
      triggerRef(assets)
    }
  }

  return {
    assets,
    assetIds,
    updateThumbnail,
    updateThumbnailBatch,
  }
})
```

### 2.3 Component Integration Pattern

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'

const catalogStore = useCatalogStore()
const { assets } = storeToRefs(catalogStore)

// Individual asset lookup - only re-renders when this asset changes
const props = defineProps<{ assetId: string }>()

const asset = computed(() => assets.value.get(props.assetId))

// Thumbnail URL with fallback
const thumbnailSrc = computed(() => {
  if (!asset.value) return null
  if (asset.value.thumbnailStatus === 'ready') {
    return asset.value.thumbnailUrl
  }
  return null // Show placeholder
})
</script>

<template>
  <div class="thumbnail">
    <img
      v-if="thumbnailSrc"
      :src="thumbnailSrc"
      :alt="asset?.fileName"
    />
    <div v-else class="placeholder">
      <UIcon
        v-if="asset?.thumbnailStatus === 'loading'"
        name="i-heroicons-arrow-path"
        class="animate-spin"
      />
    </div>
  </div>
</template>
```

---

## 3. Virtual Scrolling Integration

### 3.1 TanStack Virtual with Pinia

TanStack Virtual is the recommended solution for virtualizing large lists in Vue. It's headless, giving full control over rendering.

```typescript
// composables/useVirtualCatalog.ts
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useCatalogStore } from '~/stores/catalog'
import { useCatalogUIStore } from '~/stores/catalogUI'

export function useVirtualCatalog(containerRef: Ref<HTMLElement | null>) {
  const catalogStore = useCatalogStore()
  const uiStore = useCatalogUIStore()

  // Filtered asset IDs from computed getter
  const filteredIds = computed(() => uiStore.filteredAssetIds)

  // Grid configuration
  const columnCount = ref(4)
  const itemSize = ref(200) // thumbnail + padding

  // Row count based on filtered items and columns
  const rowCount = computed(() =>
    Math.ceil(filteredIds.value.length / columnCount.value)
  )

  // Create virtualizer for rows
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.value,
    estimateSize: () => itemSize.value,
    overscan: 5, // Render 5 extra rows above/below viewport
  })

  // Get asset IDs for a virtual row
  function getRowAssetIds(rowIndex: number): string[] {
    const startIndex = rowIndex * columnCount.value
    const endIndex = Math.min(
      startIndex + columnCount.value,
      filteredIds.value.length
    )
    return filteredIds.value.slice(startIndex, endIndex)
  }

  return {
    virtualizer,
    virtualRows: computed(() => virtualizer.value.getVirtualItems()),
    totalSize: computed(() => virtualizer.value.getTotalSize()),
    getRowAssetIds,
    columnCount,
    itemSize,
  }
}
```

### 3.2 Grid Component Implementation

```vue
<!-- components/CatalogGrid.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useVirtualCatalog } from '~/composables/useVirtualCatalog'

const containerRef = ref<HTMLElement | null>(null)
const { virtualizer, virtualRows, totalSize, getRowAssetIds, columnCount } =
  useVirtualCatalog(containerRef)
</script>

<template>
  <div
    ref="containerRef"
    class="h-full overflow-auto"
  >
    <div
      class="relative w-full"
      :style="{ height: `${totalSize}px` }"
    >
      <div
        v-for="virtualRow in virtualRows"
        :key="virtualRow.key"
        class="absolute left-0 right-0 flex gap-2"
        :style="{
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }"
      >
        <CatalogThumbnail
          v-for="assetId in getRowAssetIds(virtualRow.index)"
          :key="assetId"
          :asset-id="assetId"
          class="flex-1"
        />
      </div>
    </div>
  </div>
</template>
```

### 3.3 Scroll Position Persistence

```typescript
// stores/catalogUI.ts
export const useCatalogUIStore = defineStore('catalogUI', () => {
  const scrollPosition = ref(0)
  const viewMode = ref<ViewMode>('grid')

  // Persist scroll position when switching views
  function saveScrollPosition(position: number): void {
    scrollPosition.value = position
  }

  // Restore scroll position
  function getScrollPosition(): number {
    return scrollPosition.value
  }

  return {
    scrollPosition,
    viewMode,
    saveScrollPosition,
    getScrollPosition,
  }
})
```

---

## 4. Filtering & Sorting with Computed Properties

### 4.1 Cached Computed Getters

Pinia getters are cached like Vue computed properties, making them ideal for filtering:

```typescript
// stores/catalogUI.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCatalogStore } from './catalog'

export const useCatalogUIStore = defineStore('catalogUI', () => {
  const catalogStore = useCatalogStore()

  // Filter state
  const filterMode = ref<FilterMode>('all')
  const sortField = ref<SortField>('fileName')
  const sortDirection = ref<SortDirection>('asc')

  /**
   * Computed: Filtered asset IDs based on current filter mode
   * Cached - only recalculates when assets or filterMode changes
   */
  const filteredAssetIds = computed<string[]>(() => {
    const { assets, assetIds } = catalogStore

    if (filterMode.value === 'all') {
      return assetIds.value
    }

    const flagMatch: FlagStatus =
      filterMode.value === 'picks'
        ? 'pick'
        : filterMode.value === 'rejects'
          ? 'reject'
          : 'unflagged'

    return assetIds.value.filter((id) => {
      const asset = assets.value.get(id)
      return asset?.flag === flagMatch
    })
  })

  /**
   * Computed: Sorted and filtered asset IDs
   * Sorted based on current sort field and direction
   */
  const sortedAssetIds = computed<string[]>(() => {
    const ids = [...filteredAssetIds.value]
    const { assets } = catalogStore

    ids.sort((a, b) => {
      const assetA = assets.value.get(a)
      const assetB = assets.value.get(b)

      if (!assetA || !assetB) return 0

      let comparison = 0

      switch (sortField.value) {
        case 'fileName':
          comparison = assetA.fileName.localeCompare(assetB.fileName)
          break
        case 'dateTaken':
          comparison =
            (assetA.metadata?.dateTaken ?? '') >
            (assetB.metadata?.dateTaken ?? '')
              ? 1
              : -1
          break
        case 'lastModified':
          comparison = assetA.lastModified - assetB.lastModified
          break
        case 'fileSize':
          comparison = assetA.fileSize - assetB.fileSize
          break
      }

      return sortDirection.value === 'asc' ? comparison : -comparison
    })

    return ids
  })

  /**
   * Computed: Count of assets by flag status
   * Useful for showing counts in filter tabs
   */
  const flagCounts = computed(() => {
    const counts = { all: 0, picks: 0, rejects: 0, unflagged: 0 }
    const { assets, assetIds } = catalogStore

    for (const id of assetIds.value) {
      const asset = assets.value.get(id)
      if (!asset) continue

      counts.all++
      switch (asset.flag) {
        case 'pick':
          counts.picks++
          break
        case 'reject':
          counts.rejects++
          break
        case 'unflagged':
          counts.unflagged++
          break
      }
    }

    return counts
  })

  // Actions
  function setFilterMode(mode: FilterMode): void {
    filterMode.value = mode
  }

  function setSortField(field: SortField): void {
    sortField.value = field
  }

  function toggleSortDirection(): void {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  }

  return {
    filterMode,
    sortField,
    sortDirection,
    filteredAssetIds,
    sortedAssetIds,
    flagCounts,
    setFilterMode,
    setSortField,
    toggleSortDirection,
  }
})
```

### 4.2 Performance Considerations for Filtering

**Caching Behavior**:
- Standard getters (without parameters) are cached like Vue computed properties
- Only recalculate when their reactive dependencies change
- Multiple components reading the same getter share the cached result

**Optimization Tips**:
1. Avoid creating new arrays/objects in getters if not necessary
2. Use early returns for common cases (e.g., `filterMode === 'all'`)
3. For very large datasets (10k+), consider web workers for sorting

---

## 5. Selection State Management

### 5.1 Selection Store with Multi-Select Support

```typescript
// stores/selection.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCatalogUIStore } from './catalogUI'

export const useSelectionStore = defineStore('selection', () => {
  const uiStore = useCatalogUIStore()

  // Current focused asset (keyboard navigation target)
  const currentId = ref<string | null>(null)

  // Multi-select set
  const selectedIds = ref<Set<string>>(new Set())

  // For shift-click range selection
  const lastClickedId = ref<string | null>(null)

  /**
   * Computed: Whether an asset is selected
   */
  function isSelected(assetId: string): boolean {
    return selectedIds.value.has(assetId)
  }

  /**
   * Computed: Whether current asset exists and is selected
   */
  const isCurrentSelected = computed(
    () => currentId.value !== null && selectedIds.value.has(currentId.value)
  )

  /**
   * Computed: Array of selected IDs for iteration
   */
  const selectedArray = computed(() => Array.from(selectedIds.value))

  /**
   * Computed: Count of selected items
   */
  const selectionCount = computed(() => selectedIds.value.size)

  /**
   * Select a single asset (clears previous selection)
   */
  function selectSingle(assetId: string): void {
    selectedIds.value.clear()
    selectedIds.value.add(assetId)
    currentId.value = assetId
    lastClickedId.value = assetId
  }

  /**
   * Toggle selection for an asset (Ctrl/Cmd + Click)
   */
  function toggleSelection(assetId: string): void {
    if (selectedIds.value.has(assetId)) {
      selectedIds.value.delete(assetId)
      // If we deselected the current item, update current
      if (currentId.value === assetId) {
        currentId.value =
          selectedIds.value.size > 0
            ? Array.from(selectedIds.value)[0]
            : null
      }
    } else {
      selectedIds.value.add(assetId)
      currentId.value = assetId
    }
    lastClickedId.value = assetId
  }

  /**
   * Range select (Shift + Click)
   */
  function selectRange(assetId: string): void {
    if (!lastClickedId.value) {
      selectSingle(assetId)
      return
    }

    const sortedIds = uiStore.sortedAssetIds
    const startIndex = sortedIds.indexOf(lastClickedId.value)
    const endIndex = sortedIds.indexOf(assetId)

    if (startIndex === -1 || endIndex === -1) {
      selectSingle(assetId)
      return
    }

    const [from, to] =
      startIndex < endIndex
        ? [startIndex, endIndex]
        : [endIndex, startIndex]

    for (let i = from; i <= to; i++) {
      selectedIds.value.add(sortedIds[i])
    }

    currentId.value = assetId
  }

  /**
   * Select all visible assets
   */
  function selectAll(): void {
    const sortedIds = uiStore.sortedAssetIds
    selectedIds.value = new Set(sortedIds)
    if (sortedIds.length > 0 && !currentId.value) {
      currentId.value = sortedIds[0]
    }
  }

  /**
   * Clear all selection
   */
  function clearSelection(): void {
    selectedIds.value.clear()
    currentId.value = null
    lastClickedId.value = null
  }

  /**
   * Navigate to next asset in filtered list
   */
  function selectNext(): void {
    const sortedIds = uiStore.sortedAssetIds
    if (sortedIds.length === 0) return

    if (!currentId.value) {
      selectSingle(sortedIds[0])
      return
    }

    const currentIndex = sortedIds.indexOf(currentId.value)
    const nextIndex = Math.min(currentIndex + 1, sortedIds.length - 1)
    selectSingle(sortedIds[nextIndex])
  }

  /**
   * Navigate to previous asset in filtered list
   */
  function selectPrevious(): void {
    const sortedIds = uiStore.sortedAssetIds
    if (sortedIds.length === 0) return

    if (!currentId.value) {
      selectSingle(sortedIds[sortedIds.length - 1])
      return
    }

    const currentIndex = sortedIds.indexOf(currentId.value)
    const prevIndex = Math.max(currentIndex - 1, 0)
    selectSingle(sortedIds[prevIndex])
  }

  /**
   * Handle click with modifiers
   */
  function handleClick(assetId: string, event: MouseEvent): void {
    if (event.shiftKey) {
      selectRange(assetId)
    } else if (event.metaKey || event.ctrlKey) {
      toggleSelection(assetId)
    } else {
      selectSingle(assetId)
    }
  }

  return {
    currentId,
    selectedIds,
    lastClickedId,
    isSelected,
    isCurrentSelected,
    selectedArray,
    selectionCount,
    selectSingle,
    toggleSelection,
    selectRange,
    selectAll,
    clearSelection,
    selectNext,
    selectPrevious,
    handleClick,
  }
})
```

### 5.2 Selection UI Component

```vue
<!-- components/CatalogThumbnail.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'
import { useSelectionStore } from '~/stores/selection'

const props = defineProps<{
  assetId: string
}>()

const catalogStore = useCatalogStore()
const selectionStore = useSelectionStore()

const { assets } = storeToRefs(catalogStore)
const { currentId } = storeToRefs(selectionStore)

const asset = computed(() => assets.value.get(props.assetId))
const isSelected = computed(() => selectionStore.isSelected(props.assetId))
const isCurrent = computed(() => currentId.value === props.assetId)

function handleClick(event: MouseEvent) {
  selectionStore.handleClick(props.assetId, event)
}
</script>

<template>
  <div
    class="thumbnail-container"
    :class="{
      'ring-2 ring-primary-500': isSelected,
      'ring-4 ring-primary-600': isCurrent,
    }"
    @click="handleClick"
  >
    <img
      v-if="asset?.thumbnailUrl"
      :src="asset.thumbnailUrl"
      :alt="asset.fileName"
      class="w-full h-full object-cover"
    />
    <div v-else class="placeholder" />

    <!-- Flag indicator -->
    <div
      v-if="asset?.flag !== 'unflagged'"
      class="absolute top-2 left-2"
    >
      <UIcon
        :name="asset.flag === 'pick' ? 'i-heroicons-flag' : 'i-heroicons-x-mark'"
        :class="asset.flag === 'pick' ? 'text-green-500' : 'text-red-500'"
      />
    </div>

    <!-- Selection checkbox for multi-select -->
    <div
      v-if="isSelected"
      class="absolute top-2 right-2"
    >
      <UIcon
        name="i-heroicons-check-circle-solid"
        class="text-primary-500"
      />
    </div>
  </div>
</template>
```

---

## 6. Complete Store Structure

### 6.1 Catalog Store (Asset Data)

```typescript
// stores/catalog.ts
import { defineStore } from 'pinia'
import { shallowRef, triggerRef, computed } from 'vue'
import type { Asset, FlagStatus, ThumbnailStatus, PreviewStatus } from '~/types/catalog'

export const useCatalogStore = defineStore('catalog', () => {
  // ============================================
  // State (using shallowRef for performance)
  // ============================================

  const assets = shallowRef<Map<string, Asset>>(new Map())
  const assetIds = shallowRef<string[]>([])
  const folderPath = ref<string | null>(null)
  const lastScanTime = ref<number | null>(null)
  const isScanning = ref(false)

  // ============================================
  // Getters
  // ============================================

  const assetCount = computed(() => assetIds.value.length)

  const hasAssets = computed(() => assetIds.value.length > 0)

  // ============================================
  // Actions: Asset Management
  // ============================================

  function addAsset(asset: Asset): void {
    assets.value.set(asset.id, asset)
    assetIds.value = [...assetIds.value, asset.id]
    triggerRef(assets)
  }

  function addAssetBatch(newAssets: Asset[]): void {
    for (const asset of newAssets) {
      assets.value.set(asset.id, asset)
    }
    assetIds.value = [...assetIds.value, ...newAssets.map((a) => a.id)]
    triggerRef(assets)
  }

  function removeAsset(assetId: string): void {
    const asset = assets.value.get(assetId)
    if (asset) {
      // Revoke object URLs to prevent memory leaks
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl)
      if (asset.preview1xUrl) URL.revokeObjectURL(asset.preview1xUrl)
      if (asset.preview2xUrl) URL.revokeObjectURL(asset.preview2xUrl)

      assets.value.delete(assetId)
      assetIds.value = assetIds.value.filter((id) => id !== assetId)
      triggerRef(assets)
    }
  }

  function clearCatalog(): void {
    // Revoke all object URLs
    for (const asset of assets.value.values()) {
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl)
      if (asset.preview1xUrl) URL.revokeObjectURL(asset.preview1xUrl)
      if (asset.preview2xUrl) URL.revokeObjectURL(asset.preview2xUrl)
    }

    assets.value.clear()
    assetIds.value = []
    folderPath.value = null
    lastScanTime.value = null
    triggerRef(assets)
  }

  // ============================================
  // Actions: Flag Management
  // ============================================

  function setFlag(assetId: string, flag: FlagStatus): void {
    const asset = assets.value.get(assetId)
    if (asset) {
      asset.flag = flag
      triggerRef(assets)
    }
  }

  function setFlagBatch(assetIds: string[], flag: FlagStatus): void {
    for (const id of assetIds) {
      const asset = assets.value.get(id)
      if (asset) {
        asset.flag = flag
      }
    }
    triggerRef(assets)
  }

  // ============================================
  // Actions: Thumbnail/Preview Updates
  // ============================================

  function updateThumbnail(
    assetId: string,
    status: ThumbnailStatus,
    url: string | null
  ): void {
    const asset = assets.value.get(assetId)
    if (asset) {
      // Revoke old URL if replacing
      if (asset.thumbnailUrl && url !== asset.thumbnailUrl) {
        URL.revokeObjectURL(asset.thumbnailUrl)
      }
      asset.thumbnailStatus = status
      asset.thumbnailUrl = url
      triggerRef(assets)
    }
  }

  function updatePreview1x(
    assetId: string,
    status: PreviewStatus,
    url: string | null
  ): void {
    const asset = assets.value.get(assetId)
    if (asset) {
      if (asset.preview1xUrl && url !== asset.preview1xUrl) {
        URL.revokeObjectURL(asset.preview1xUrl)
      }
      asset.preview1xStatus = status
      asset.preview1xUrl = url
      triggerRef(assets)
    }
  }

  function updatePreview2x(
    assetId: string,
    status: PreviewStatus,
    url: string | null
  ): void {
    const asset = assets.value.get(assetId)
    if (asset) {
      if (asset.preview2xUrl && url !== asset.preview2xUrl) {
        URL.revokeObjectURL(asset.preview2xUrl)
      }
      asset.preview2xStatus = status
      asset.preview2xUrl = url
      triggerRef(assets)
    }
  }

  // ============================================
  // Lookup Helper
  // ============================================

  function getAsset(assetId: string): Asset | undefined {
    return assets.value.get(assetId)
  }

  return {
    // State
    assets,
    assetIds,
    folderPath,
    lastScanTime,
    isScanning,
    // Getters
    assetCount,
    hasAssets,
    // Actions
    addAsset,
    addAssetBatch,
    removeAsset,
    clearCatalog,
    setFlag,
    setFlagBatch,
    updateThumbnail,
    updatePreview1x,
    updatePreview2x,
    getAsset,
  }
})
```

### 6.2 Type Exports

```typescript
// types/catalog.ts
export type {
  Asset,
  AssetMetadata,
  EditState,
  FlagStatus,
  ThumbnailStatus,
  PreviewStatus,
  FilterMode,
  ViewMode,
  SortField,
  SortDirection,
  SelectionState,
} from '~/stores/types'
```

---

## 7. Performance Optimization Summary

### 7.1 Key Patterns Applied

| Pattern | Benefit | Where Applied |
|---------|---------|---------------|
| Normalized State | O(1) lookups | Asset store with Map |
| `shallowRef` | Avoid deep reactivity | Large asset collections |
| `triggerRef` | Manual reactivity trigger | After in-place mutations |
| Computed Getters | Cached filtering | Filter modes, counts |
| Modular Stores | Reduced re-render scope | Separate UI/selection state |
| Virtual Scrolling | Render only visible | TanStack Virtual integration |
| Object URL Management | Memory cleanup | Revoke on update/remove |

### 7.2 Memory Considerations

1. **Object URLs**: Always revoke when replacing or removing assets
2. **Selection Set**: Use `Set<string>` not `string[]` for O(1) membership tests
3. **Batch Operations**: Group updates to minimize reactivity triggers
4. **Lazy Loading**: Load metadata on demand, not during scan

### 7.3 When to Consider Additional Optimizations

For catalogs exceeding 10,000 assets:
- Consider pagination or windowing at the data level
- Move sorting to a web worker
- Use IndexedDB cursor iteration instead of loading all at once
- Implement progressive loading with virtual scroll integration

---

## 8. References

### Documentation
- [Pinia - The intuitive store for Vue.js](https://pinia.vuejs.org/)
- [Pinia Getters Documentation](https://pinia.vuejs.org/core-concepts/getters.html)
- [Vue.js Reactivity Advanced - shallowRef](https://vuejs.org/api/reactivity-advanced)
- [TanStack Virtual Introduction](https://tanstack.com/virtual/latest/docs/introduction)
- [Vue.js Performance Best Practices](https://vuejs.org/guide/best-practices/performance)

### Articles
- [Managing Large Datasets in Nuxt/Vue 3: Composables, Pinia Stores, and Efficient Data Loading](https://felixastner.com/articles/managing-large-datasets-nuxt-vue3)
- [Optimizing Vue.js Performance with shallowRef](https://dev.to/mochafreddo/optimizing-vuejs-performance-with-shallowref-an-in-depth-guide-25lb)
- [Vue 3.5 Release: Major Enhancements for Large-Scale Applications](https://www.monterail.com/blog/vue-3-5-release-enhancements-for-large-scale-applications)
- [Building Modular Store Architecture with Pinia in Large Vue Apps](https://medium.com/@vasanthancomrads/building-modular-store-architecture-with-pinia-in-large-vue-apps-0131e3d05430)
- [Best Practices when using Pinia with Vue 3 and TypeScript](https://seanwilson.ca/blog/pinia-vue-best-practices.html)
- [Optimizing Pinia: Best Practices for Faster Vue.js State Management](https://medium.com/@mallikarjunpasupuleti/optimizing-pinia-best-practices-for-faster-vue-js-state-management-9323f74bfffa)
- [State Management in Vue.js: Strategies for Large-Scale Applications](https://www.hybridappbuilders.com/blog/vuejs-state-management-for-large-scale-apps/)
- [Handling Long Arrays Performantly in Vue.js](https://reside-ic.github.io/blog/handling-long-arrays-performantly-in-vue.js/)
