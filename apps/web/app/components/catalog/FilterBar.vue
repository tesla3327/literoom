<script setup lang="ts">
/**
 * FilterBar Component
 *
 * Provides filter mode buttons (All, Picks, Rejects, Unflagged),
 * export button, and sort dropdown for the catalog grid.
 */
import type { FilterMode, SortField, SortDirection } from '@literoom/core/catalog'

const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const exportStore = useExportStore()
const { rescanFolder } = useCatalog()

// Filter mode configuration
const filterModes = computed(() => [
  {
    value: 'all' as FilterMode,
    label: 'All',
    count: catalogStore.totalCount,
  },
  {
    value: 'picks' as FilterMode,
    label: 'Picks',
    count: catalogStore.pickCount,
  },
  {
    value: 'rejects' as FilterMode,
    label: 'Rejects',
    count: catalogStore.rejectCount,
  },
  {
    value: 'unflagged' as FilterMode,
    label: 'Unflagged',
    count: catalogStore.unflaggedCount,
  },
])

// Sort options for dropdown menu
// Note: Nuxt UI's UDropdownMenu expects 'onSelect' handler, not 'click'
const sortOptions = [
  [
    {
      label: 'Date (newest)',
      icon: 'i-heroicons-calendar',
      onSelect: () => setSort('captureDate', 'desc'),
    },
    {
      label: 'Date (oldest)',
      icon: 'i-heroicons-calendar',
      onSelect: () => setSort('captureDate', 'asc'),
    },
  ],
  [
    {
      label: 'Name (A-Z)',
      icon: 'i-heroicons-bars-3-bottom-left',
      onSelect: () => setSort('filename', 'asc'),
    },
    {
      label: 'Name (Z-A)',
      icon: 'i-heroicons-bars-3-bottom-right',
      onSelect: () => setSort('filename', 'desc'),
    },
  ],
  [
    {
      label: 'Size (largest)',
      icon: 'i-heroicons-arrow-trending-up',
      onSelect: () => setSort('fileSize', 'desc'),
    },
    {
      label: 'Size (smallest)',
      icon: 'i-heroicons-arrow-trending-down',
      onSelect: () => setSort('fileSize', 'asc'),
    },
  ],
]

// Current sort label for display
const sortLabel = computed(() => {
  const field = catalogUIStore.sortField
  const direction = catalogUIStore.sortDirection

  const labels: Record<SortField, Record<SortDirection, string>> = {
    captureDate: { asc: 'Date (oldest)', desc: 'Date (newest)' },
    filename: { asc: 'Name (A-Z)', desc: 'Name (Z-A)' },
    fileSize: { asc: 'Size (smallest)', desc: 'Size (largest)' },
  }

  return labels[field]?.[direction] ?? 'Sort'
})

function setFilterMode(mode: FilterMode): void {
  catalogUIStore.setFilterMode(mode)
}

function setSort(field: SortField, direction: SortDirection): void {
  catalogUIStore.setSortField(field)
  catalogUIStore.setSortDirection(direction)
}
</script>

<template>
  <div
    class="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 relative z-20"
    data-testid="filter-bar"
  >
    <!-- Filter buttons -->
    <div class="flex gap-1">
      <UButton
        v-for="mode in filterModes"
        :key="mode.value"
        :variant="catalogUIStore.filterMode === mode.value ? 'solid' : 'ghost'"
        size="sm"
        :data-testid="`filter-${mode.value}`"
        :data-active="catalogUIStore.filterMode === mode.value"
        @click="setFilterMode(mode.value)"
      >
        {{ mode.label }}
        <template
          v-if="mode.count > 0"
          #trailing
        >
          <UBadge
            size="xs"
            :color="catalogUIStore.filterMode === mode.value ? 'neutral' : 'neutral'"
            variant="subtle"
            :label="String(mode.count)"
            :data-testid="`filter-${mode.value}-count`"
          />
        </template>
      </UButton>
    </div>

    <!-- Right side: GPU status + Export progress/button + Sort dropdown -->
    <div class="flex items-center gap-2">
      <!-- GPU Status Indicator -->
      <GPUStatusIndicator />
      <!-- Thumbnail progress indicator (shown during thumbnail generation) -->
      <div
        v-if="catalogStore.isProcessingThumbnails && !exportStore.isExporting && !catalogStore.isScanning"
        class="flex items-center gap-2 px-3 py-1 rounded-md bg-gray-800"
        data-testid="thumbnail-progress"
      >
        <UIcon
          name="i-heroicons-photo"
          class="w-4 h-4 text-primary-400 animate-pulse"
        />
        <span class="text-sm text-gray-300 whitespace-nowrap">
          {{ catalogStore.thumbnailProgress.ready }}/{{ catalogStore.thumbnailProgress.total }}
        </span>
        <div class="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-primary-500 transition-all duration-200"
            :style="{ width: `${catalogStore.thumbnailPercent}%` }"
          />
        </div>
      </div>

      <!-- Rescan progress indicator (shown during rescan) -->
      <div
        v-if="catalogStore.isScanning && catalogStore.folderPath && !exportStore.isExporting"
        class="flex items-center gap-2 px-3 py-1 rounded-md bg-gray-800"
        data-testid="rescan-progress"
      >
        <UIcon
          name="i-heroicons-arrow-path"
          class="w-4 h-4 text-primary-400 animate-spin"
        />
        <span class="text-sm text-gray-300">Rescanning...</span>
      </div>

      <!-- Rescan button (shown when not scanning or exporting) -->
      <UButton
        v-if="!catalogStore.isScanning && !exportStore.isExporting && catalogStore.folderPath"
        variant="ghost"
        size="sm"
        icon="i-heroicons-arrow-path"
        title="Rescan folder for new/modified files"
        data-testid="rescan-button"
        @click="rescanFolder"
      >
        Rescan
      </UButton>

      <!-- Export progress indicator (shown during export) -->
      <div
        v-if="exportStore.isExporting"
        class="flex items-center gap-2 px-3 py-1 rounded-md bg-gray-800"
        data-testid="export-progress"
      >
        <UIcon
          name="i-heroicons-arrow-path"
          class="w-4 h-4 animate-spin text-primary-400"
        />
        <span class="text-sm text-gray-300">
          Exporting {{ exportStore.progress?.current ?? 0 }}/{{ exportStore.progress?.total ?? 0 }}
        </span>
        <div class="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-primary-500 transition-all duration-200"
            :style="{ width: `${exportStore.progressPercent}%` }"
          />
        </div>
      </div>

      <!-- Export button (hidden during export) -->
      <UButton
        v-else
        variant="ghost"
        size="sm"
        icon="i-heroicons-arrow-up-tray"
        :disabled="catalogStore.totalCount === 0"
        data-testid="export-button"
        @click="exportStore.openModal"
      >
        Export
        <template
          v-if="catalogStore.pickCount > 0"
          #trailing
        >
          <UBadge
            size="xs"
            color="neutral"
            variant="subtle"
            :label="String(catalogStore.pickCount)"
          />
        </template>
      </UButton>

      <!-- Sort dropdown -->
      <UDropdownMenu :items="sortOptions">
        <UButton
          variant="ghost"
          size="sm"
          trailing-icon="i-heroicons-chevron-down"
        >
          {{ sortLabel }}
        </UButton>
      </UDropdownMenu>
    </div>
  </div>
</template>
