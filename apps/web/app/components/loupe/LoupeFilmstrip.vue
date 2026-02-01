<script setup lang="ts">
/**
 * LoupeFilmstrip Component
 *
 * Horizontal scrolling strip of thumbnails for navigation in loupe view.
 * Highlights current photo and allows clicking to navigate.
 * Uses selection store for current photo tracking instead of route params.
 */

// ============================================================================
// Stores & Composables
// ============================================================================

const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const selectionStore = useSelectionStore()
const { requestThumbnail } = useCatalog()

// ============================================================================
// Computed
// ============================================================================

const filteredIds = computed(() => catalogUIStore.filteredAssetIds)
const currentAssetId = computed(() => selectionStore.currentId)

// Limit visible thumbnails for performance (show ~30 items around current)
const visibleRange = 30
const visibleIds = computed(() => {
  if (!currentAssetId.value) return filteredIds.value.slice(0, visibleRange)

  const currentIdx = filteredIds.value.indexOf(currentAssetId.value)
  if (currentIdx === -1) return filteredIds.value.slice(0, visibleRange)

  const halfRange = Math.floor(visibleRange / 2)
  const start = Math.max(0, currentIdx - halfRange)
  const end = Math.min(filteredIds.value.length, start + visibleRange)
  return filteredIds.value.slice(start, end)
})

// ============================================================================
// Navigation
// ============================================================================

/**
 * Navigate to a different asset using the selection store.
 */
function navigateToAsset(assetId: string) {
  if (assetId !== currentAssetId.value) {
    selectionStore.selectSingle(assetId)
  }
}

// ============================================================================
// Scroll to current thumbnail
// ============================================================================

const scrollContainerRef = ref<HTMLElement | null>(null)

// Scroll current thumbnail into view when it changes
watch(currentAssetId, () => {
  nextTick(() => {
    const container = scrollContainerRef.value
    if (!container || !currentAssetId.value) return

    const currentThumb = container.querySelector(`[data-asset-id="${currentAssetId.value}"]`)
    if (currentThumb) {
      currentThumb.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
  })
}, { immediate: true })

// ============================================================================
// Thumbnail Requests
// ============================================================================

/**
 * Request thumbnails for visible filmstrip items.
 *
 * When navigating to loupe view, thumbnails may not have been generated yet.
 * This watcher ensures visible filmstrip thumbnails are requested.
 */
watch(visibleIds, (ids) => {
  for (const id of ids) {
    const asset = catalogStore.assets.get(id)
    if (asset && asset.thumbnailStatus === 'pending') {
      // Priority 1 (near visible) since these are filmstrip thumbnails
      // Current asset gets priority 0 via loupe preview handling
      requestThumbnail(id, 1)
    }
  }
}, { immediate: true })
</script>

<template>
  <div
    ref="scrollContainerRef"
    class="h-20 flex items-center gap-2 px-4 overflow-x-auto scrollbar-thin bg-gray-950"
    data-testid="loupe-filmstrip"
  >
    <!-- Position indicator if there are hidden items before -->
    <div
      v-if="visibleIds.length > 0 && filteredIds.indexOf(visibleIds[0]!) > 0"
      class="flex-shrink-0 text-xs text-gray-600"
    >
      ...
    </div>

    <!-- Thumbnails -->
    <button
      v-for="id in visibleIds"
      :key="id"
      :data-asset-id="id"
      class="w-16 h-16 flex-shrink-0 rounded overflow-hidden transition-all duration-150 focus:outline-none"
      :class="[
        id === currentAssetId
          ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950'
          : 'opacity-60 hover:opacity-100',
      ]"
      @click="navigateToAsset(id)"
    >
      <img
        v-if="catalogStore.assets.get(id)?.thumbnailUrl"
        :src="catalogStore.assets.get(id)?.thumbnailUrl ?? undefined"
        :alt="catalogStore.assets.get(id)?.filename"
        class="w-full h-full object-cover"
      >
      <div
        v-else
        class="w-full h-full bg-gray-800 flex items-center justify-center"
      >
        <UIcon
          name="i-heroicons-photo"
          class="w-6 h-6 text-gray-600"
        />
      </div>
    </button>

    <!-- Position indicator if there are hidden items after -->
    <div
      v-if="visibleIds.length > 0 && filteredIds.indexOf(visibleIds[visibleIds.length - 1]!) < filteredIds.length - 1"
      class="flex-shrink-0 text-xs text-gray-600"
    >
      ...
    </div>
  </div>
</template>

<style scoped>
/* Custom scrollbar styling */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #374151 transparent;
}

.scrollbar-thin::-webkit-scrollbar {
  height: 6px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #374151;
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #4b5563;
}
</style>
