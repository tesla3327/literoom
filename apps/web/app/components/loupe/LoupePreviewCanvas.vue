<script setup lang="ts">
/**
 * LoupePreviewCanvas Component
 *
 * Simplified preview canvas for displaying photos in loupe view.
 * Features:
 * - Displays preview image (2560px) or thumbnail fallback
 * - Zoom/pan support via CSS transforms
 * - Optional clipping overlay toggle (J key)
 * - Loading state display
 * - Centered image in container
 *
 * This is a lightweight alternative to EditPreviewCanvas that doesn't include
 * edit-specific features like WebGPU rendering, crop overlay, or mask overlay.
 */
import { ThumbnailPriority } from '@literoom/core/catalog'
import type { ClippingMap } from '~/composables/useEditPreview'
import {
  CLIP_SHADOW_R,
  CLIP_SHADOW_G,
  CLIP_SHADOW_B,
  CLIP_HIGHLIGHT_R,
  CLIP_HIGHLIGHT_G,
  CLIP_HIGHLIGHT_B,
} from '~/composables/useEditPreview'

interface Props {
  /** The asset ID to display */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Composables & Stores
// ============================================================================

const { requestPreview } = useCatalog()
const catalogStore = useCatalogStore()
const editUIStore = useEditUIStore()

// ============================================================================
// Template Refs
// ============================================================================

/** Reference to the zoom container (receives wheel/mouse events) */
const zoomContainerRef = ref<HTMLElement | null>(null)

/** Reference to the preview image element (kept for useZoomPan compatibility) */
const previewImageRef = ref<HTMLImageElement | null>(null)

/** Reference to the preview canvas element (for ImageBitmap rendering) */
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)

/** Reference to the clipping overlay canvas */
const clippingCanvasRef = ref<HTMLCanvasElement | null>(null)

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

// Expose zoom methods for parent component
defineExpose({
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
// Preview Loading
// ============================================================================

/** Current preview ImageBitmap */
const previewBitmap = ref<ImageBitmap | null>(null)

/** Loading state */
const isLoading = ref(false)

/** Error state */
const error = ref<string | null>(null)

/** Preview dimensions (for canvas sizing) */
const previewDimensions = ref<{ width: number, height: number } | null>(null)

/**
 * Get the current asset from the catalog store.
 */
const currentAsset = computed(() => {
  return catalogStore.assets.get(props.assetId)
})

/**
 * URL to load - prefer preview, fallback to thumbnail.
 */
const imageUrl = computed(() => {
  const asset = currentAsset.value
  if (!asset) return null
  return asset.preview1xUrl ?? asset.thumbnailUrl ?? null
})

/**
 * Whether preview is still loading (not ready yet).
 */
const isWaitingForPreview = computed(() => {
  const asset = currentAsset.value
  if (!asset) return true
  return asset.preview1xStatus !== 'ready' && asset.preview1xStatus !== 'error'
})

/**
 * Load an image URL into an ImageBitmap.
 */
async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url)
  const blob = await response.blob()
  return await createImageBitmap(blob)
}

/**
 * Load the preview image when URL changes.
 */
watch(
  imageUrl,
  async (url) => {
    if (!url) {
      previewBitmap.value = null
      previewDimensions.value = null
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // Close previous bitmap to free memory
      if (previewBitmap.value) {
        previewBitmap.value.close()
      }

      const bitmap = await loadImageBitmap(url)
      previewBitmap.value = bitmap
      previewDimensions.value = { width: bitmap.width, height: bitmap.height }

      // Update image dimensions for zoom/pan
      editUIStore.setImageDimensions(bitmap.width, bitmap.height)
    }
    catch (e) {
      console.error('[LoupePreviewCanvas] Failed to load image:', e)
      error.value = 'Failed to load preview'
      previewBitmap.value = null
      previewDimensions.value = null
    }
    finally {
      isLoading.value = false
    }
  },
  { immediate: true },
)

/**
 * Request preview generation when asset changes.
 */
watch(
  () => props.assetId,
  (assetId) => {
    if (!assetId) return

    const asset = catalogStore.assets.get(assetId)
    if (asset && asset.preview1xStatus !== 'ready') {
      // Request visible priority preview generation
      requestPreview(assetId, ThumbnailPriority.VISIBLE)
    }
  },
  { immediate: true },
)

// ============================================================================
// Canvas Rendering
// ============================================================================

/** Actual rendered dimensions of the preview image (for overlay sizing) */
const renderedDimensions = ref<{ width: number, height: number }>({ width: 0, height: 0 })

/**
 * Draw ImageBitmap to preview canvas whenever it changes.
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
  },
  { immediate: true },
)

/**
 * Watch for canvas dimension changes via ResizeObserver.
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
  // Close bitmap to free memory
  if (previewBitmap.value) {
    previewBitmap.value.close()
  }
})

// ============================================================================
// Clipping Overlay
// ============================================================================

/**
 * Create a simple clipping map from the preview image.
 * For loupe view, we compute clipping on-the-fly from the displayed image.
 */
const clippingMap = ref<ClippingMap | null>(null)

/**
 * Compute clipping map from the current preview bitmap.
 * This is a simplified version that checks for pure black/white pixels.
 */
watch(
  previewBitmap,
  async (bitmap) => {
    if (!bitmap) {
      clippingMap.value = null
      return
    }

    // Create an offscreen canvas to read pixel data
    const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      clippingMap.value = null
      return
    }

    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const pixels = imageData.data

    // Create clipping map (same format as useEditPreview)
    const clipData = new Uint8Array(bitmap.width * bitmap.height)

    // Track per-channel clipping presence
    const shadowClipping = { r: false, g: false, b: false }
    const highlightClipping = { r: false, g: false, b: false }

    for (let i = 0; i < clipData.length; i++) {
      const r = pixels[i * 4]!
      const g = pixels[i * 4 + 1]!
      const b = pixels[i * 4 + 2]!

      let clipBits = 0

      // Shadow clipping (channel at 0)
      if (r === 0) {
        clipBits |= CLIP_SHADOW_R
        shadowClipping.r = true
      }
      if (g === 0) {
        clipBits |= CLIP_SHADOW_G
        shadowClipping.g = true
      }
      if (b === 0) {
        clipBits |= CLIP_SHADOW_B
        shadowClipping.b = true
      }

      // Highlight clipping (channel at 255)
      if (r === 255) {
        clipBits |= CLIP_HIGHLIGHT_R
        highlightClipping.r = true
      }
      if (g === 255) {
        clipBits |= CLIP_HIGHLIGHT_G
        highlightClipping.g = true
      }
      if (b === 255) {
        clipBits |= CLIP_HIGHLIGHT_B
        highlightClipping.b = true
      }

      clipData[i] = clipBits
    }

    clippingMap.value = {
      data: clipData,
      width: bitmap.width,
      height: bitmap.height,
      hasShadowClipping: shadowClipping.r || shadowClipping.g || shadowClipping.b,
      hasHighlightClipping: highlightClipping.r || highlightClipping.g || highlightClipping.b,
      shadowClipping,
      highlightClipping,
    }
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

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

/**
 * Handle J key for clipping overlay toggle.
 */
function handleKeydown(e: KeyboardEvent) {
  // Don't intercept if user is typing in an input
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  if (e.key === 'j' || e.key === 'J') {
    editUIStore.toggleClippingOverlays()
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// ============================================================================
// Computed
// ============================================================================

/**
 * Whether we have content ready to display.
 */
const hasPreviewContent = computed(() => !!previewBitmap.value)

/**
 * Whether we're in an initial loading state.
 */
const isInitialLoading = computed(() => {
  if (isWaitingForPreview.value && !previewBitmap.value) return true
  if (isLoading.value && !previewBitmap.value) return true
  if (error.value) return false
  return !hasPreviewContent.value
})
</script>

<template>
  <div
    class="absolute inset-0 flex items-center justify-center bg-gray-900"
    data-testid="loupe-preview-canvas"
  >
    <!-- Zoom percentage indicator (top-left) -->
    <div
      v-if="editUIStore.zoomPreset !== 'fit' && !isInitialLoading && hasPreviewContent"
      class="absolute top-4 left-4 z-10 px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-400"
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
      v-else-if="hasPreviewContent"
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
      v-if="hasPreviewContent && !isInitialLoading"
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
