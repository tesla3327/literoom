<script setup lang="ts">
/**
 * EditPreviewCanvas Component
 *
 * Displays the photo preview in the edit view.
 * Shows thumbnail initially, will later show full preview with edits applied.
 */

interface Props {
  /** The asset ID to display */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Stores
// ============================================================================

const catalogStore = useCatalogStore()

// ============================================================================
// Computed
// ============================================================================

const asset = computed(() => catalogStore.assets.get(props.assetId))

// Preview state
const isLoading = ref(true)
const previewUrl = ref<string | null>(null)

// ============================================================================
// Preview Loading
// ============================================================================

/**
 * Load preview when asset changes.
 * For now, uses thumbnail. Will be replaced with full preview + edits.
 */
watch(() => props.assetId, async (id) => {
  if (!id) return

  isLoading.value = true

  // TODO: Load full preview from decode service and apply edits
  // For now, use thumbnail as placeholder
  const a = catalogStore.assets.get(id)
  if (a?.thumbnailUrl) {
    previewUrl.value = a.thumbnailUrl
    isLoading.value = false
  }
  else {
    // No thumbnail yet - wait for it
    isLoading.value = true
    previewUrl.value = null
  }
}, { immediate: true })

// Also watch for thumbnail updates
watch(() => asset.value?.thumbnailUrl, (url) => {
  if (url && isLoading.value) {
    previewUrl.value = url
    isLoading.value = false
  }
})
</script>

<template>
  <div
    class="absolute inset-0 flex items-center justify-center bg-gray-900"
    data-testid="edit-preview-canvas"
  >
    <!-- Loading state -->
    <div
      v-if="isLoading"
      class="flex flex-col items-center gap-2 text-gray-500"
    >
      <UIcon name="i-heroicons-photo" class="w-12 h-12" />
      <span class="text-sm">Loading preview...</span>
    </div>

    <!-- Preview image -->
    <img
      v-else-if="previewUrl"
      :src="previewUrl"
      :alt="asset?.filename"
      class="max-w-full max-h-full object-contain"
      data-testid="preview-image"
    />

    <!-- No preview available -->
    <div
      v-else
      class="flex flex-col items-center gap-2 text-gray-500"
    >
      <UIcon name="i-heroicons-exclamation-triangle" class="w-12 h-12" />
      <span class="text-sm">Preview not available</span>
    </div>

    <!-- TODO: Add zoom/pan controls -->
    <!-- TODO: Add rendering indicator during edits -->
  </div>
</template>
