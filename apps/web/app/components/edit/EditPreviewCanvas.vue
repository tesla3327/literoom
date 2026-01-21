<script setup lang="ts">
/**
 * EditPreviewCanvas Component
 *
 * Displays the photo preview in the edit view with:
 * - Source image display
 * - Clipping overlay (shadow/highlight clipping indicators)
 * - Rendering indicator during edit updates
 * - Quality indicator (draft/full)
 * - Error handling
 *
 * Uses the useEditPreview composable for preview management and
 * useClippingOverlay for rendering clipping indicators.
 */

interface Props {
  /** The asset ID to display */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Composables
// ============================================================================

const catalogStore = useCatalogStore()

/**
 * Preview management composable.
 * Handles rendering with debouncing and quality levels.
 */
const {
  previewUrl,
  isRendering,
  renderQuality,
  error,
  clippingMap,
  previewDimensions,
  adjustedPixels,
  adjustedDimensions,
} = useEditPreview(toRef(props, 'assetId'))

/**
 * Expose adjusted pixels for histogram computation.
 * This allows the parent component to pass these to the histogram.
 */
defineExpose({
  adjustedPixels,
  adjustedDimensions,
})

// ============================================================================
// Template Refs
// ============================================================================

/** Reference to the preview image element */
const previewImageRef = ref<HTMLImageElement | null>(null)

/** Reference to the clipping overlay canvas */
const clippingCanvasRef = ref<HTMLCanvasElement | null>(null)

// ============================================================================
// Computed
// ============================================================================

const asset = computed(() => catalogStore.assets.get(props.assetId))

/**
 * Whether we're in an initial loading state (no preview yet).
 */
const isInitialLoading = computed(() => !previewUrl.value && !error.value)

/**
 * Actual rendered dimensions of the preview image.
 * Used to size the clipping overlay canvas.
 */
const renderedDimensions = ref<{ width: number; height: number }>({ width: 0, height: 0 })

/**
 * Update rendered dimensions when the image loads.
 */
function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement
  if (img) {
    renderedDimensions.value = {
      width: img.clientWidth,
      height: img.clientHeight,
    }
  }
}

// ============================================================================
// Clipping Overlay
// ============================================================================

/**
 * Watch for image dimension changes via ResizeObserver.
 */
onMounted(() => {
  if (!previewImageRef.value) return

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      renderedDimensions.value = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }
    }
  })

  if (previewImageRef.value) {
    observer.observe(previewImageRef.value)
  }

  onUnmounted(() => {
    observer.disconnect()
  })
})

/**
 * Clipping overlay composable.
 * Renders the clipping indicators on a canvas over the preview.
 */
useClippingOverlay({
  canvasRef: clippingCanvasRef,
  clippingMap,
  displayWidth: computed(() => renderedDimensions.value.width),
  displayHeight: computed(() => renderedDimensions.value.height),
})
</script>

<template>
  <div
    class="absolute inset-0 flex items-center justify-center bg-gray-900"
    data-testid="edit-preview-canvas"
  >
    <!-- Rendering indicator (top-right) -->
    <div
      v-if="isRendering"
      class="absolute top-4 right-4 z-10 flex items-center gap-2 px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-400"
      data-testid="rendering-indicator"
    >
      <span class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
      <span>Rendering...</span>
    </div>

    <!-- Quality indicator (top-left) - only show during draft renders -->
    <div
      v-if="renderQuality === 'draft' && !isInitialLoading"
      class="absolute top-4 left-4 z-10 px-2 py-1 bg-yellow-500/20 rounded text-xs text-yellow-400"
      data-testid="quality-indicator"
    >
      Draft
    </div>

    <!-- Initial loading state -->
    <div
      v-if="isInitialLoading"
      class="flex flex-col items-center gap-2 text-gray-500"
      data-testid="loading-state"
    >
      <UIcon
        name="i-heroicons-photo"
        class="w-12 h-12"
      />
      <span class="text-sm">Loading preview...</span>
    </div>

    <!-- Preview image with clipping overlay -->
    <div
      v-else-if="previewUrl"
      class="relative max-w-full max-h-full"
    >
      <img
        ref="previewImageRef"
        :src="previewUrl"
        :alt="asset?.filename"
        class="max-w-full max-h-full object-contain"
        data-testid="preview-image"
        @load="onImageLoad"
      >

      <!-- Clipping overlay canvas - positioned over the image -->
      <canvas
        ref="clippingCanvasRef"
        class="absolute top-0 left-0 pointer-events-none"
        :width="renderedDimensions.width"
        :height="renderedDimensions.height"
        :style="{
          width: renderedDimensions.width + 'px',
          height: renderedDimensions.height + 'px',
        }"
        data-testid="clipping-overlay-canvas"
      />
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="flex flex-col items-center gap-2 text-red-400"
      data-testid="error-state"
    >
      <UIcon
        name="i-heroicons-exclamation-triangle"
        class="w-12 h-12"
      />
      <span class="text-sm">{{ error }}</span>
    </div>

    <!-- Fallback: no preview available -->
    <div
      v-else
      class="flex flex-col items-center gap-2 text-gray-500"
      data-testid="no-preview-state"
    >
      <UIcon
        name="i-heroicons-exclamation-triangle"
        class="w-12 h-12"
      />
      <span class="text-sm">Preview not available</span>
    </div>

    <!-- TODO: Add zoom/pan controls (Phase 8.6+) -->
  </div>
</template>
