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
import type { FlagStatus } from '@literoom/core/catalog'

// ============================================================================
// Stores
// ============================================================================

const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const selectionStore = useSelectionStore()

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
// Grid Layout Calculations
// ============================================================================

/**
 * Sorted asset IDs from the UI store (filtered and sorted).
 */
const sortedAssetIds = computed(() => catalogUIStore.sortedAssetIds)

/**
 * Number of rows needed to display all items.
 */
const rowCount = computed(() =>
  Math.ceil(sortedAssetIds.value.length / columnsCount.value)
)

/**
 * Calculate row height based on thumbnail size.
 * Includes padding (8px gap = 2 * 4px).
 */
const rowHeight = computed(() => {
  // Each thumbnail is aspect-square
  // Height = (containerWidth - padding) / columns + gap
  const availableWidth = containerWidth.value - 16 // 8px padding on each side
  const gapTotal = (columnsCount.value - 1) * 8 // 8px gap between columns
  const thumbnailSize = (availableWidth - gapTotal) / columnsCount.value
  return thumbnailSize + 8 // Add 8px for row gap
})

/**
 * Convert row index to the starting global index.
 */
function getGlobalIndex(rowIndex: number, colIndex: number): number {
  return rowIndex * columnsCount.value + colIndex
}

/**
 * Get asset ID for a specific row/column position.
 */
function getAssetId(rowIndex: number, colIndex: number): string | undefined {
  const globalIndex = getGlobalIndex(rowIndex, colIndex)
  return sortedAssetIds.value[globalIndex]
}

/**
 * Get the asset for a specific row/column position.
 */
function getAsset(rowIndex: number, colIndex: number) {
  const assetId = getAssetId(rowIndex, colIndex)
  return assetId ? catalogStore.getAsset(assetId) : undefined
}

/**
 * Get number of columns in a specific row (last row may have fewer).
 */
function columnsInRow(rowIndex: number): number {
  const startIndex = rowIndex * columnsCount.value
  const remaining = sortedAssetIds.value.length - startIndex
  return Math.min(columnsCount.value, remaining)
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
    sortedAssetIds.value
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
  // Calculate which row this index is in
  const rowIndex = Math.floor(index / columnsCount.value)

  // Scroll to the row
  virtualizer.value.scrollToIndex(rowIndex, { align: 'auto' })

  // After scroll, find and focus the element
  nextTick(() => {
    const element = scrollContainerRef.value?.querySelector(
      `[data-asset-id="${id}"]`
    ) as HTMLElement | null
    scrollIntoViewIfNeeded(element)
    element?.focus()
  })
}

const { handleKeydown } = useGridKeyboard({
  columnsCount,
  totalItems: computed(() => sortedAssetIds.value.length),
  orderedIds: sortedAssetIds,
  currentIndex: ref(currentIndex.value), // Pass as ref for two-way binding
  onNavigate: (id, index) => {
    selectionStore.selectSingle(id)
    scrollToCurrentItem(id, index)
  },
  onFlag: (flag: FlagStatus) => {
    const currentId = selectionStore.currentId
    if (currentId) {
      catalogStore.setFlag(currentId, flag)
    }
  },
  onViewChange: (mode) => {
    if (mode === 'edit') {
      catalogUIStore.setViewMode('loupe')
      // Future: navigate to edit page
    } else {
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
    class="grid-scroll-container"
    tabindex="0"
    role="grid"
    aria-label="Photo grid"
    data-testid="catalog-grid"
    @keydown="handleKeydown"
    @focus="handleContainerFocus"
  >
    <!-- Virtual scroller spacer -->
    <div
      class="grid-spacer"
      :style="{ height: `${virtualizer.getTotalSize()}px` }"
    >
      <!-- Virtual rows -->
      <div
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="virtualRow.index"
        class="grid-row"
        role="row"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }"
      >
        <!-- Items in this row -->
        <CatalogThumbnail
          v-for="colIndex in columnsInRow(virtualRow.index)"
          :key="getAssetId(virtualRow.index, colIndex - 1) ?? `empty-${virtualRow.index}-${colIndex}`"
          :asset="getAsset(virtualRow.index, colIndex - 1)!"
          :is-selected="isSelected(virtualRow.index, colIndex - 1)"
          :is-current="isCurrent(virtualRow.index, colIndex - 1)"
          :index="getGlobalIndex(virtualRow.index, colIndex - 1)"
          @click="handleThumbnailClick($event, virtualRow.index, colIndex - 1)"
        />
      </div>
    </div>

    <!-- Empty state (shown when no items) -->
    <div v-if="sortedAssetIds.length === 0" class="empty-state">
      <UIcon name="i-heroicons-photo" class="empty-icon" />
      <p class="empty-text">No photos to display</p>
      <p v-if="catalogUIStore.filterMode !== 'all'" class="empty-hint">
        Try changing the filter or selecting a different folder
      </p>
    </div>
  </div>
</template>

<style scoped>
.grid-scroll-container {
  @apply h-full overflow-y-auto overflow-x-hidden;
  @apply focus:outline-none;
  @apply bg-gray-950;
}

.grid-spacer {
  @apply relative w-full;
}

.grid-row {
  @apply grid gap-2 px-2;
  grid-template-columns: repeat(v-bind(columnsCount), 1fr);
}

/* Empty state */
.empty-state {
  @apply absolute inset-0 flex flex-col items-center justify-center;
  @apply text-gray-500;
}

.empty-icon {
  @apply w-16 h-16 mb-4 text-gray-600;
}

.empty-text {
  @apply text-lg font-medium;
}

.empty-hint {
  @apply text-sm mt-2 text-gray-600;
}
</style>
