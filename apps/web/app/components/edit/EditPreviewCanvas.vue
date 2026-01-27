<script setup lang="ts">
/**
 * EditPreviewCanvas Component
 *
 * Displays the photo preview in the edit view with:
 * - Source image display (WebGPU canvas for direct GPU rendering, fallback to 2D canvas)
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
 *
 * WebGPU Canvas Mode:
 * When WebGPU is available, the preview canvas uses a WebGPU context for direct
 * texture rendering. This eliminates the CPU readback bottleneck (15-30ms savings).
 * Falls back to 2D canvas + ImageBitmap when WebGPU is not available.
 */
import { getGPUEditPipeline } from '@literoom/core/gpu'

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
  bindWebGPUCanvas,
  isWebGPURenderingActive,
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
// WebGPU Canvas Mode
// ============================================================================

/** Whether WebGPU canvas mode is active (vs fallback 2D canvas mode) */
const isWebGPUCanvasMode = ref(false)

/** WebGPU context for direct GPU rendering (null if not in WebGPU mode) */
const webgpuContext = ref<GPUCanvasContext | null>(null)

/** Preferred WebGPU canvas format */
const webgpuFormat = ref<GPUTextureFormat | null>(null)

/**
 * Configure the canvas for WebGPU rendering.
 * Called when the canvas element is available and WebGPU is supported.
 *
 * @returns true if WebGPU canvas was successfully configured, false otherwise
 */
async function configureWebGPUCanvas(): Promise<boolean> {
  const canvas = previewCanvasRef.value
  if (!canvas) {
    console.log('[EditPreviewCanvas] No canvas element available for WebGPU configuration')
    return false
  }

  // Check if WebGPU is available
  if (!navigator.gpu) {
    console.log('[EditPreviewCanvas] WebGPU not available in this browser')
    return false
  }

  // Get the GPU edit pipeline to access the device
  const pipeline = getGPUEditPipeline()
  if (!pipeline.isReady) {
    try {
      const initialized = await pipeline.initialize()
      if (!initialized) {
        console.log('[EditPreviewCanvas] GPU pipeline initialization failed')
        return false
      }
    } catch (e) {
      console.log('[EditPreviewCanvas] GPU pipeline initialization error:', e)
      return false
    }
  }

  const device = pipeline.getDevice()
  if (!device) {
    console.log('[EditPreviewCanvas] No GPU device available')
    return false
  }

  try {
    // Get WebGPU context from canvas
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      console.log('[EditPreviewCanvas] Failed to get WebGPU context from canvas')
      return false
    }

    // Get the preferred format for this GPU
    const format = navigator.gpu.getPreferredCanvasFormat()

    // Configure the canvas context
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    })

    webgpuContext.value = context
    webgpuFormat.value = format
    isWebGPUCanvasMode.value = true

    console.log(`[EditPreviewCanvas] WebGPU canvas configured with format: ${format}`)
    return true
  } catch (e) {
    console.log('[EditPreviewCanvas] WebGPU canvas configuration failed:', e)
    return false
  }
}

/**
 * Get the current WebGPU texture from the canvas for rendering.
 * This is called each frame to get the texture to render to.
 *
 * @returns The current canvas texture, or null if not in WebGPU mode
 */
function getCurrentWebGPUTexture(): GPUTexture | null {
  if (!isWebGPUCanvasMode.value || !webgpuContext.value) {
    return null
  }
  return webgpuContext.value.getCurrentTexture()
}

/**
 * Unconfigure WebGPU context and fall back to 2D canvas mode.
 */
function unconfigureWebGPUCanvas(): void {
  if (webgpuContext.value) {
    webgpuContext.value.unconfigure()
  }
  webgpuContext.value = null
  webgpuFormat.value = null
  isWebGPUCanvasMode.value = false
  console.log('[EditPreviewCanvas] WebGPU canvas unconfigured, falling back to 2D mode')
}

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

// NOTE: defineExpose is called after updateWebGPUCanvasDimensions is defined

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
 * Whether we have content ready to display (bitmap or WebGPU rendered).
 * Used to determine when to show the canvas and UI elements.
 */
const hasPreviewContent = computed(() => {
  // In WebGPU mode, content is ready if WebGPU is active and canvas has dimensions
  if (isWebGPURenderingActive.value && previewDimensions.value) {
    return true
  }
  // In bitmap mode, content is ready if bitmap exists
  return !!previewBitmap.value
})

/**
 * Whether we're in an initial loading state.
 * This is true when:
 * - No preview bitmap exists yet (and not in WebGPU direct render mode), OR
 * - We're waiting for the high-quality preview to generate
 *
 * IMPORTANT: Edit view should never show the small thumbnail (512px).
 * We display a loading state until the full preview (2560px) is ready.
 *
 * When WebGPU direct rendering is active, we don't need a previewBitmap
 * since the GPU renders directly to the canvas.
 */
const isInitialLoading = computed(() => {
  // If waiting for preview, always show loading
  if (isWaitingForPreview.value) return true

  // If there's an error, don't show loading
  if (error.value) return false

  // Check if we have content to display
  return !hasPreviewContent.value
})

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
  // Clean up WebGPU context
  unconfigureWebGPUCanvas()
})

/**
 * Update canvas dimensions and rendered dimensions when WebGPU rendering completes.
 * Called from useEditPreview after processToTexture completes.
 */
function updateWebGPUCanvasDimensions(width: number, height: number): void {
  const canvas = previewCanvasRef.value
  if (!canvas) return

  // Update canvas element dimensions
  canvas.width = width
  canvas.height = height

  // Update rendered dimensions for overlays
  renderedDimensions.value = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  }

  // Update image dimensions for zoom/pan (useZoomPan needs this)
  editUIStore.setImageDimensions(width, height)
}

/**
 * Track whether WebGPU canvas binding has been attempted.
 */
const webgpuBindingAttempted = ref(false)

/**
 * Attempt to bind WebGPU canvas when the canvas ref becomes available.
 * The canvas is conditionally rendered (v-else-if="hasPreviewContent"),
 * so it may not exist when the component first mounts.
 */
function attemptWebGPUBinding() {
  if (webgpuBindingAttempted.value) return
  if (!previewCanvasRef.value) return

  webgpuBindingAttempted.value = true
  console.log('[EditPreviewCanvas] Canvas available, attempting WebGPU binding')

  bindWebGPUCanvas({
    configureWebGPUCanvas,
    getCurrentWebGPUTexture,
    isWebGPUCanvasMode,
    unconfigureWebGPUCanvas,
    updateWebGPUCanvasDimensions,
  })
}

/**
 * Watch for hasPreviewContent to become true, then bind WebGPU canvas.
 * This handles the case where the canvas is rendered after the component mounts.
 */
watch(
  hasPreviewContent,
  (hasContent) => {
    if (hasContent) {
      // Canvas should now be in the DOM, wait for next tick to ensure ref is populated
      nextTick(() => {
        attemptWebGPUBinding()
      })
    }
  },
  { immediate: true },
)

/**
 * On mount, also try to bind in case hasPreviewContent is already true.
 */
onMounted(() => {
  nextTick(() => {
    attemptWebGPUBinding()
  })
})

/**
 * Draw ImageBitmap to preview canvas whenever it changes.
 * This is much faster than using blob URLs with <img> tags.
 *
 * IMPORTANT: This watcher only runs when NOT in WebGPU canvas mode.
 * In WebGPU mode, the GPU renders directly to the canvas texture.
 */
watch(
  previewBitmap,
  (bitmap) => {
    // Skip if in WebGPU mode - GPU renders directly to canvas
    if (isWebGPUCanvasMode.value) {
      console.log('[EditPreviewCanvas] Skipping bitmap draw - WebGPU mode active')
      return
    }

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

// Expose methods for parent component and WebGPU canvas binding
defineExpose({
  adjustedPixels,
  adjustedDimensions,
  renderQuality,
  zoomIn,
  zoomOut,
  toggleZoom,
  setPreset,
  resetZoom,
  // WebGPU canvas methods
  isWebGPUCanvasMode,
  configureWebGPUCanvas,
  getCurrentWebGPUTexture,
  unconfigureWebGPUCanvas,
  updateWebGPUCanvasDimensions,
  previewCanvasRef,
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
        v-if="editUIStore.isCropToolActive && !isInitialLoading && hasPreviewContent"
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
      v-if="editUIStore.zoomPreset !== 'fit' && !isInitialLoading && hasPreviewContent"
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
