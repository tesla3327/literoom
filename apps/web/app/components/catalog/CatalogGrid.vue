<script setup lang="ts">
/**
 * CatalogGrid Component
 *
 * Virtual scrolling grid for displaying photo thumbnails.
 * Uses @tanstack/vue-virtual for efficient rendering of large collections.
 *
 * Features:
 * - Row-only virtualization (simpler than dual-axis)
 * - Responsive column count based on container width
 * - Keyboard navigation with grid-aware movement
 * - Click handling for selection (single, Ctrl, Shift)
 * - Viewport-aware thumbnail priority updates
 */
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useGridKeyboard, scrollIntoViewIfNeeded } from '~/composables/useGridKeyboard'
import { useGridLayout } from '~/composables/useGridLayout'
import type { FlagStatus, Asset } from '@literoom/core/catalog'
import { ThumbnailPriority } from '@literoom/core/catalog'

// ============================================================================
// Stores
// ============================================================================

const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const selectionStore = useSelectionStore()
const { requestPreview, setFlag } = useCatalog()

// ============================================================================
// Refs
// ============================================================================

const scrollContainerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(800)

// ============================================================================
// Responsive Columns
// ============================================================================

/**
 * Calculate column count based on container width.
 * Breakpoints: 640 (sm), 1024 (lg), 1280 (xl)
 */
const columnsCount = computed(() => {
  const width = containerWidth.value
  if (width < 640) return 2
  if (width < 1024) return 3
  if (width < 1280) return 4
  return 5
})

// Update catalogUIStore with column count for external use
watch(columnsCount, (cols) => {
  catalogUIStore.setGridColumns(cols)
}, { immediate: true })

// ============================================================================
// Grid Layout
// ============================================================================

/**
 * Sorted asset IDs from the UI store (filtered and sorted).
 */
const sortedAssetIds = computed(() => catalogUIStore.sortedAssetIds)

/**
 * Grid layout calculations using shared composable.
 */
const { rowCount, getGlobalIndex, columnsInRow, getRowIndex, getItem: getAsset } = useGridLayout<Asset>({
  totalItems: computed(() => sortedAssetIds.value.length),
  columnsCount,
  getItemAtIndex: (index) => {
    const assetId = sortedAssetIds.value[index]
    if (!assetId) return undefined
    const asset = catalogStore.getAsset(assetId)
    if (!asset) {
      console.warn(`[CatalogGrid] Asset ID "${assetId}" exists but asset data not found in store`)
    }
    return asset
  },
})

/**
 * Calculate row height based on thumbnail size.
 * Includes padding (8px gap = 2 * 4px).
 */
const rowHeight = computed(() => {
  const availableWidth = containerWidth.value - 16 // 8px padding on each side
  const gapTotal = (columnsCount.value - 1) * 8 // 8px gap between columns
  const thumbnailSize = (availableWidth - gapTotal) / columnsCount.value
  return thumbnailSize + 8 // Add 8px for row gap
})

/**
 * Get asset ID for a specific row/column position.
 */
function getAssetId(rowIndex: number, colIndex: number): string | undefined {
  return sortedAssetIds.value[getGlobalIndex(rowIndex, colIndex)]
}

// ============================================================================
// Virtual Scrolling
// ============================================================================

const virtualizerOptions = computed(() => ({
  count: rowCount.value,
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => rowHeight.value,
  overscan: 2, // Render 2 extra rows above/below for smooth scrolling
}))

const virtualizer = useVirtualizer(virtualizerOptions)

// ============================================================================
// ResizeObserver for Container Width
// ============================================================================

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!scrollContainerRef.value) return

  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (entry) {
      containerWidth.value = entry.contentRect.width
    }
  })

  resizeObserver.observe(scrollContainerRef.value)
  containerWidth.value = scrollContainerRef.value.clientWidth
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// ============================================================================
// Selection Helpers
// ============================================================================

function isSelected(rowIndex: number, colIndex: number): boolean {
  const assetId = getAssetId(rowIndex, colIndex)
  return assetId ? selectionStore.isSelected(assetId) : false
}

function isCurrent(rowIndex: number, colIndex: number): boolean {
  const assetId = getAssetId(rowIndex, colIndex)
  return assetId ? selectionStore.isCurrent(assetId) : false
}

// ============================================================================
// Click Handling
// ============================================================================

function handleThumbnailClick(event: MouseEvent, rowIndex: number, colIndex: number) {
  const assetId = getAssetId(rowIndex, colIndex)
  if (!assetId) return

  selectionStore.handleClick(
    assetId,
    { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey },
    sortedAssetIds.value,
  )
}

// ============================================================================
// Keyboard Navigation
// ============================================================================

/**
 * Current index for keyboard navigation.
 * Synced with selection store.
 */
const currentIndex = computed({
  get: () => {
    const currentId = selectionStore.currentId
    if (!currentId) return -1
    return sortedAssetIds.value.indexOf(currentId)
  },
  set: (value: number) => {
    const id = sortedAssetIds.value[value]
    if (id) {
      selectionStore.selectSingle(id)
    }
  },
})

/**
 * Scroll to the current item and update focus.
 */
function scrollToCurrentItem(id: string, index: number) {
  // Scroll to the row containing this index
  virtualizer.value.scrollToIndex(getRowIndex(index), { align: 'auto' })

  // After scroll, find and focus the element
  nextTick(() => {
    const element = scrollContainerRef.value?.querySelector(
      `[data-asset-id="${id}"]`,
    ) as HTMLElement | null
    scrollIntoViewIfNeeded(element)
    element?.focus()
  })
}

// Create a ref that syncs with the selection store for keyboard navigation
const keyboardIndex = ref(currentIndex.value)

// Keep keyboard index in sync with selection store changes
watch(currentIndex, (newIndex) => {
  keyboardIndex.value = newIndex
}, { immediate: true })

const { handleKeydown } = useGridKeyboard({
  columnsCount,
  totalItems: computed(() => sortedAssetIds.value.length),
  orderedIds: sortedAssetIds,
  currentIndex: keyboardIndex,
  onNavigate: (id, index) => {
    selectionStore.selectSingle(id)
    scrollToCurrentItem(id, index)
  },
  onFlag: (flag: FlagStatus) => {
    // Use composable setFlag which handles multi-selection
    // If selectedIds has items, it flags all of them; otherwise flags currentId
    setFlag(flag)
  },
  onViewChange: (mode) => {
    if (mode === 'edit') {
      catalogUIStore.setViewMode('loupe')
      const currentId = selectionStore.currentId
      if (currentId) {
        // Start preview generation early (before navigation) so it's ready when edit view loads
        requestPreview(currentId, ThumbnailPriority.VISIBLE)
        navigateTo(`/edit/${currentId}`)
      }
    }
    else {
      catalogUIStore.setViewMode('grid')
    }
  },
})

// ============================================================================
// Focus Management
// ============================================================================

/**
 * Handle container focus to ensure keyboard navigation works.
 */
function handleContainerFocus() {
  // If no item is selected, select the first one
  if (selectionStore.currentId === null && sortedAssetIds.value.length > 0) {
    const firstId = sortedAssetIds.value[0]
    if (firstId) {
      selectionStore.selectSingle(firstId)
    }
  }
}
</script>

<template>
  <div
    ref="scrollContainerRef"
    class="h-full overflow-y-auto overflow-x-hidden focus:outline-none bg-gray-950"
    tabindex="0"
    role="grid"
    aria-label="Photo grid"
    data-testid="catalog-grid"
    @keydown="handleKeydown"
    @focus="handleContainerFocus"
  >
    <!-- Virtual scroller spacer -->
    <div
      class="relative w-full"
      :style="{ height: `${virtualizer.getTotalSize()}px` }"
    >
      <!-- Virtual rows -->
      <div
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="virtualRow.index"
        class="grid gap-2 px-2"
        role="row"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
          gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
        }"
      >
        <!-- Items in this row -->
        <template
          v-for="colIndex in columnsInRow(virtualRow.index)"
          :key="getAssetId(virtualRow.index, colIndex - 1) ?? `empty-${virtualRow.index}-${colIndex}`"
        >
          <!-- Render thumbnail if asset exists -->
          <CatalogThumbnail
            v-if="getAsset(virtualRow.index, colIndex - 1)"
            :asset="getAsset(virtualRow.index, colIndex - 1)!"
            :is-selected="isSelected(virtualRow.index, colIndex - 1)"
            :is-current="isCurrent(virtualRow.index, colIndex - 1)"
            :index="getGlobalIndex(virtualRow.index, colIndex - 1)"
            @click="handleThumbnailClick($event, virtualRow.index, colIndex - 1)"
          />
          <!-- Fallback placeholder for missing assets (shouldn't happen normally) -->
          <div
            v-else
            class="aspect-square rounded-lg bg-gray-900 animate-pulse"
            role="gridcell"
            aria-label="Loading..."
          />
        </template>
      </div>
    </div>

    <!-- Empty state (shown when no items) -->
    <div
      v-if="sortedAssetIds.length === 0"
      class="absolute inset-0 flex flex-col items-center justify-center text-gray-500"
    >
      <UIcon
        name="i-heroicons-photo"
        class="w-16 h-16 mb-4 text-gray-600"
      />
      <p class="text-lg font-medium">
        No photos to display
      </p>
      <p
        v-if="catalogUIStore.filterMode !== 'all'"
        class="text-sm mt-2 text-gray-600"
      >
        Try changing the filter or selecting a different folder
      </p>
    </div>
  </div>
</template>
