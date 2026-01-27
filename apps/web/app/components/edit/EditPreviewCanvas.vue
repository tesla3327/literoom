<script setup lang="ts">
/**
 * EditPreviewCanvas Component
 *
 * Displays the photo preview in the edit view with:
 * - Source image display
 * - Zoom/pan support via CSS transforms
 * - Clipping overlay (shadow/highlight clipping indicators)
 * - Crop and mask overlays
 * - Rendering indicator during edit updates
 * - Quality indicator (draft/full)
 * - Error handling
 *
 * Uses the useEditPreview composable for preview management,
 * useClippingOverlay for rendering clipping indicators,
 * and useZoomPan for zoom/pan interactions.
 */

interface Props {
  /** The asset ID to display */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Composables
// ============================================================================

const editUIStore = useEditUIStore()

/**
 * Preview management composable.
 * Handles rendering with debouncing and quality levels.
 */
const {
  previewBitmap,
  isRendering,
  renderQuality,
  error,
  clippingMap,
  previewDimensions,
  adjustedPixels,
  adjustedDimensions,
  isWaitingForPreview,
} = useEditPreview(toRef(props, 'assetId'))


// ============================================================================
// Template Refs
// ============================================================================

/** Reference to the zoom container (receives wheel/mouse events) */
const zoomContainerRef = ref<HTMLElement | null>(null)

/** Reference to the preview image element (kept for useZoomPan compatibility) */
const previewImageRef = ref<HTMLImageElement | null>(null)

/** Reference to the preview canvas element (for direct ImageBitmap rendering) */
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)

/** Reference to the clipping overlay canvas */
const clippingCanvasRef = ref<HTMLCanvasElement | null>(null)

/** Reference to the crop overlay canvas */
const cropCanvasRef = ref<HTMLCanvasElement | null>(null)

// ============================================================================
// Zoom/Pan
// ============================================================================

/**
 * Zoom/pan composable for wheel zoom and drag pan.
 */
const {
  transformStyle,
  cursorStyle: zoomCursorStyle,
  zoomIn,
  zoomOut,
  toggleZoom,
  setPreset,
  resetZoom,
} = useZoomPan({
  containerRef: zoomContainerRef,
  imageRef: previewImageRef,
})

/**
 * Expose zoom methods for parent component (keyboard shortcuts).
 */
defineExpose({
  adjustedPixels,
  adjustedDimensions,
  renderQuality,
  zoomIn,
  zoomOut,
  toggleZoom,
  setPreset,
  resetZoom,
})

/**
 * Cache/restore zoom state when switching assets.
 */
watch(
  () => props.assetId,
  (newId, oldId) => {
    if (oldId && oldId !== newId) {
      // Cache zoom state for previous asset
      editUIStore.cacheZoomForAsset(oldId)
    }
    if (newId) {
      // Restore zoom state for new asset (or reset to fit)
      editUIStore.restoreZoomForAsset(newId)
    }
  },
)

// ============================================================================
// Computed
// ============================================================================

/**
 * Whether we're in an initial loading state.
 * This is true when:
 * - No preview bitmap exists yet, OR
 * - We're waiting for the high-quality preview to generate
 *
 * IMPORTANT: Edit view should never show the small thumbnail (512px).
 * We display a loading state until the full preview (2560px) is ready.
 */
const isInitialLoading = computed(() =>
  (!previewBitmap.value && !error.value) || isWaitingForPreview.value,
)

/**
 * Actual rendered dimensions of the preview image.
 * Used to size the clipping overlay canvas.
 */
const renderedDimensions = ref<{ width: number; height: number }>({ width: 0, height: 0 })

// ============================================================================
// Clipping Overlay
// ============================================================================

/**
 * Watch for canvas dimension changes via ResizeObserver.
 * The canvas element is watched instead of an img element since we render directly to canvas.
 */
let resizeObserver: ResizeObserver | null = null

watch(
  previewCanvasRef,
  (canvas) => {
    // Clean up previous observer if any
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }

    if (!canvas) return

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        renderedDimensions.value = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }
      }
    })

    resizeObserver.observe(canvas)
  },
  { immediate: true },
)

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

/**
 * Draw ImageBitmap to preview canvas whenever it changes.
 * This is much faster than using blob URLs with <img> tags.
 */
watch(
  previewBitmap,
  (bitmap) => {
    if (!bitmap || !previewCanvasRef.value) return

    const canvas = previewCanvasRef.value
    canvas.width = bitmap.width
    canvas.height = bitmap.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(bitmap, 0, 0)

    // Update rendered dimensions for overlays
    renderedDimensions.value = {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    }

    // Update image dimensions for zoom/pan (useZoomPan needs this)
    editUIStore.setImageDimensions(bitmap.width, bitmap.height)
  },
  { immediate: true },
)

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

/**
 * Crop overlay composable.
 * Renders and handles interaction with crop overlay on preview.
 */
const { isDragging: isCropDragging, cursorStyle: cropCursorStyle } = useCropOverlay({
  canvasRef: cropCanvasRef,
  displayWidth: computed(() => renderedDimensions.value.width),
  displayHeight: computed(() => renderedDimensions.value.height),
  imageWidth: computed(() => previewDimensions.value?.width ?? 0),
  imageHeight: computed(() => previewDimensions.value?.height ?? 0),
})

/** Reference to the mask overlay canvas */
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)

/**
 * Mask overlay composable.
 * Renders and handles interaction with mask overlay on preview.
 */
const { cursorStyle: maskCursorStyle } = useMaskOverlay({
  canvasRef: maskCanvasRef,
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

    <!-- Crop Action Bar (top-center) - shown when crop tool is active -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <EditCropActionBar
        v-if="editUIStore.isCropToolActive && !isInitialLoading && previewBitmap"
        class="absolute top-4 left-1/2 -translate-x-1/2 z-30"
      />
    </Transition>

    <!-- Quality indicator (top-left) - only show during draft renders -->
    <div
      v-if="renderQuality === 'draft' && !isInitialLoading"
      class="absolute top-4 left-4 z-10 px-2 py-1 bg-yellow-500/20 rounded text-xs text-yellow-400"
      data-testid="quality-indicator"
    >
      Draft
    </div>

    <!-- Zoom percentage indicator (top-left, below quality) -->
    <div
      v-if="editUIStore.zoomPreset !== 'fit' && !isInitialLoading && previewBitmap"
      class="absolute top-4 left-4 z-10 px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-400"
      :class="{ 'top-12': renderQuality === 'draft' }"
      data-testid="zoom-indicator"
    >
      {{ editUIStore.zoomPercentage }}%
    </div>

    <!-- Initial loading state -->
    <div
      v-if="isInitialLoading"
      class="flex flex-col items-center gap-2 text-gray-500"
      data-testid="loading-state"
    >
      <UIcon
        name="i-heroicons-photo"
        class="w-12 h-12 animate-pulse"
      />
      <span class="text-sm">{{ isWaitingForPreview ? 'Generating preview...' : 'Loading preview...' }}</span>
    </div>

    <!-- Zoom container (receives wheel/mouse events) -->
    <div
      v-else-if="previewBitmap"
      ref="zoomContainerRef"
      class="absolute inset-0 overflow-hidden"
      :style="{ cursor: zoomCursorStyle }"
      data-testid="zoom-container"
    >
      <!-- Transform container (applies zoom/pan via CSS transform) -->
      <div
        class="absolute"
        :style="transformStyle"
        data-testid="transform-container"
      >
        <div class="relative">
          <canvas
            ref="previewCanvasRef"
            class="block max-w-full h-auto"
            :style="{
              width: previewDimensions?.width ? previewDimensions.width + 'px' : 'auto',
              height: previewDimensions?.height ? previewDimensions.height + 'px' : 'auto',
            }"
            data-testid="preview-canvas"
          />

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

          <!-- Crop overlay canvas - positioned over the image, interactive -->
          <canvas
            v-if="editUIStore.isCropToolActive"
            ref="cropCanvasRef"
            class="absolute top-0 left-0"
            :class="{
              'cursor-grab': !isCropDragging,
              'cursor-grabbing': isCropDragging,
            }"
            :width="renderedDimensions.width"
            :height="renderedDimensions.height"
            :style="{
              width: renderedDimensions.width + 'px',
              height: renderedDimensions.height + 'px',
              cursor: cropCursorStyle,
              zIndex: 20,
              touchAction: 'none',
            }"
            data-testid="crop-overlay-canvas"
          />

          <!-- Mask overlay canvas - positioned over the image, interactive -->
          <canvas
            v-if="editUIStore.isMaskToolActive"
            ref="maskCanvasRef"
            class="absolute top-0 left-0"
            :width="renderedDimensions.width"
            :height="renderedDimensions.height"
            :style="{
              width: renderedDimensions.width + 'px',
              height: renderedDimensions.height + 'px',
              cursor: maskCursorStyle,
              zIndex: 25,
              touchAction: 'none',
            }"
            data-testid="mask-overlay-canvas"
          />
        </div>
      </div>
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

    <!-- Zoom controls (bottom-left, fixed position) -->
    <div
      v-if="previewBitmap && !isInitialLoading"
      class="absolute bottom-4 left-4 z-10 flex items-center gap-1 bg-gray-800/90 rounded-lg p-1"
      data-testid="zoom-controls"
    >
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-minus"
        aria-label="Zoom out"
        @click="zoomOut"
      />
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        class="w-14 justify-center font-mono text-xs"
        @click="toggleZoom"
      >
        {{ editUIStore.zoomPercentage }}%
      </UButton>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-plus"
        aria-label="Zoom in"
        @click="zoomIn"
      />
      <div class="w-px h-4 bg-gray-600 mx-1" />
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :class="{ 'bg-gray-700': editUIStore.zoomPreset === 'fit' }"
        @click="setPreset('fit')"
      >
        Fit
      </UButton>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :class="{ 'bg-gray-700': editUIStore.zoomPreset === '100%' }"
        @click="setPreset('100%')"
      >
        1:1
      </UButton>
    </div>
  </div>
</template>
