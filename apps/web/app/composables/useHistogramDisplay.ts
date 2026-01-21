/**
 * useHistogramDisplay Composable
 *
 * Manages histogram computation and display for the edit view:
 * - Computes histogram from preview pixels via WASM
 * - Renders RGB channels with alpha blending to canvas
 * - Shows clipping indicators for highlight/shadow clipping
 * - Implements debouncing (500ms) to prioritize preview over histogram
 */
import type { Ref } from 'vue'
import type { HistogramData } from '@literoom/core/decode'

// ============================================================================
// Types
// ============================================================================

export interface UseHistogramDisplayReturn {
  /** Ref to bind to the canvas element */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Current histogram data */
  histogram: Ref<HistogramData | null>
  /** Whether histogram is being computed */
  isComputing: Ref<boolean>
  /** Error message if computation failed */
  error: Ref<string | null>
  /** Toggle for highlight clipping overlay */
  showHighlightClipping: Ref<boolean>
  /** Toggle for shadow clipping overlay */
  showShadowClipping: Ref<boolean>
  /** Toggle both clipping overlays (J key behavior) */
  toggleClippingOverlays: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Canvas dimensions for histogram */
const HISTOGRAM_WIDTH = 256
const HISTOGRAM_HEIGHT = 192

/** Debounce delay for histogram computation (longer than preview) */
const HISTOGRAM_DEBOUNCE_MS = 500

/** Colors for histogram rendering */
const COLORS = {
  background: '#1a1a1a',
  red: 'rgb(255, 0, 0)',
  green: 'rgb(0, 255, 0)',
  blue: 'rgb(0, 0, 255)',
  shadowClipping: '#3b82f6', // Blue
  highlightClipping: '#ef4444', // Red
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function.
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced as T & { cancel: () => void }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Load an image from a URL and return its pixels.
 */
async function loadImagePixels(
  url: string,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  // Load image
  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })

  // Draw to canvas and extract pixels
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  const rgba = imageData.data

  // Convert RGBA to RGB
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]! // R
    rgb[j + 1] = rgba[i + 1]! // G
    rgb[j + 2] = rgba[i + 2]! // B
  }

  return { pixels: rgb, width: img.width, height: img.height }
}

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing histogram display in the edit view.
 *
 * @param assetId - Reactive ref to the current asset ID
 * @returns Histogram state and controls
 */
export function useHistogramDisplay(assetId: Ref<string>): UseHistogramDisplayReturn {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()
  const { requestThumbnail } = useCatalog()

  // ============================================================================
  // State
  // ============================================================================

  /** Canvas element ref */
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  /** Current histogram data */
  const histogram = ref<HistogramData | null>(null)

  /** Whether histogram is being computed */
  const isComputing = ref(false)

  /** Error message if computation failed */
  const error = ref<string | null>(null)

  /** Clipping overlay toggles */
  const showHighlightClipping = ref(false)
  const showShadowClipping = ref(false)

  /** Cached source pixels to avoid re-loading */
  const sourceCache = ref<{
    assetId: string
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  // ============================================================================
  // Histogram Rendering
  // ============================================================================

  /**
   * Render histogram data to the canvas.
   */
  function renderHistogram(): void {
    const canvas = canvasRef.value
    const hist = histogram.value

    if (!canvas || !hist) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const max = hist.maxValue || 1

    // Clear with background color
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, width, height)

    if (max === 0) return

    // Draw RGB channels with alpha blending
    ctx.globalAlpha = 0.4

    const barWidth = Math.ceil(width / 256)

    for (let i = 0; i < 256; i++) {
      const x = (i / 256) * width

      // Red channel
      const redHeight = (hist.red[i]! / max) * height
      ctx.fillStyle = COLORS.red
      ctx.fillRect(x, height - redHeight, barWidth, redHeight)

      // Green channel
      const greenHeight = (hist.green[i]! / max) * height
      ctx.fillStyle = COLORS.green
      ctx.fillRect(x, height - greenHeight, barWidth, greenHeight)

      // Blue channel
      const blueHeight = (hist.blue[i]! / max) * height
      ctx.fillStyle = COLORS.blue
      ctx.fillRect(x, height - blueHeight, barWidth, blueHeight)
    }

    ctx.globalAlpha = 1

    // Draw clipping indicators
    drawClippingIndicators(ctx, width, height, hist)
  }

  /**
   * Draw triangular clipping indicators in corners.
   */
  function drawClippingIndicators(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hist: HistogramData,
  ): void {
    const size = 8

    // Shadow clipping indicator (top-left, blue triangle)
    if (hist.hasShadowClipping) {
      ctx.fillStyle = COLORS.shadowClipping
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(size, 0)
      ctx.lineTo(0, size)
      ctx.closePath()
      ctx.fill()
    }

    // Highlight clipping indicator (top-right, red triangle)
    if (hist.hasHighlightClipping) {
      ctx.fillStyle = COLORS.highlightClipping
      ctx.beginPath()
      ctx.moveTo(width, 0)
      ctx.lineTo(width - size, 0)
      ctx.lineTo(width, size)
      ctx.closePath()
      ctx.fill()
    }
  }

  // ============================================================================
  // Histogram Computation
  // ============================================================================

  /**
   * Load source pixels for an asset.
   */
  async function loadSource(id: string): Promise<void> {
    const asset = catalogStore.assets.get(id)
    const url = asset?.thumbnailUrl

    if (!url) {
      sourceCache.value = null
      histogram.value = null
      return
    }

    try {
      const { pixels, width, height } = await loadImagePixels(url)
      sourceCache.value = { assetId: id, pixels, width, height }

      // Compute initial histogram
      await computeHistogram()
    }
    catch (e) {
      error.value = 'Failed to load source for histogram'
      console.error('Histogram source load error:', e)
    }
  }

  /**
   * Compute histogram from current source pixels.
   */
  async function computeHistogram(): Promise<void> {
    if (!sourceCache.value) return

    // Don't re-compute if already computing
    if (isComputing.value) return

    isComputing.value = true
    error.value = null

    try {
      const { pixels, width, height, assetId: cachedId } = sourceCache.value

      // Check if asset changed while we were waiting
      if (cachedId !== assetId.value) {
        return
      }

      // Compute histogram via WASM worker
      const result = await $decodeService.computeHistogram(pixels, width, height)

      // Check again if asset changed
      if (cachedId !== assetId.value) {
        return
      }

      histogram.value = result

      // Render to canvas
      renderHistogram()
    }
    catch (e) {
      error.value = 'Failed to compute histogram'
      console.error('Histogram computation error:', e)
    }
    finally {
      isComputing.value = false
    }
  }

  /**
   * Debounced histogram computation for use during slider drag.
   * Uses longer delay (500ms) to prioritize preview updates.
   */
  const debouncedCompute = debounce(() => {
    computeHistogram()
  }, HISTOGRAM_DEBOUNCE_MS)

  // ============================================================================
  // Clipping Overlay Toggle
  // ============================================================================

  /**
   * Toggle both clipping overlays (J key behavior).
   * If any overlay is on, turn both off. Otherwise, turn both on.
   */
  function toggleClippingOverlays(): void {
    if (showHighlightClipping.value || showShadowClipping.value) {
      showHighlightClipping.value = false
      showShadowClipping.value = false
    }
    else {
      showHighlightClipping.value = true
      showShadowClipping.value = true
    }
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Computed source URL - watches for thumbnail URL changes.
   */
  const sourceUrl = computed(() => {
    const asset = catalogStore.assets.get(assetId.value)
    return asset?.thumbnailUrl ?? null
  })

  /**
   * Watch for asset changes and load new source.
   */
  watch(
    assetId,
    async (id) => {
      debouncedCompute.cancel()
      error.value = null
      sourceCache.value = null
      histogram.value = null

      // Request thumbnail generation (priority 0 = highest for edit view)
      // This ensures the thumbnail is generated even if we navigate directly to edit view
      requestThumbnail(id, 0)

      // Load source pixels and compute histogram
      await loadSource(id)
    },
    { immediate: true },
  )

  /**
   * Watch for source URL changes (e.g., when thumbnail loads after request).
   * This handles the case where we navigate to edit view before thumbnail is ready.
   */
  watch(
    sourceUrl,
    async (url) => {
      if (url && !sourceCache.value) {
        await loadSource(assetId.value)
      }
    },
  )

  /**
   * Watch for adjustment changes and trigger debounced histogram computation.
   * Note: For a more accurate histogram, we should compute from adjusted pixels,
   * but for now we compute from source pixels (faster, good enough for MVP).
   */
  watch(
    () => editStore.adjustments,
    () => {
      if (sourceCache.value) {
        debouncedCompute()
      }
    },
    { deep: true },
  )

  /**
   * Watch for histogram data changes and re-render canvas.
   */
  watch(
    histogram,
    () => {
      renderHistogram()
    },
  )

  /**
   * Watch for canvas ref changes and render if data available.
   */
  watch(
    canvasRef,
    () => {
      if (canvasRef.value && histogram.value) {
        renderHistogram()
      }
    },
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  onUnmounted(() => {
    debouncedCompute.cancel()
  })

  return {
    canvasRef,
    histogram,
    isComputing,
    error,
    showHighlightClipping,
    showShadowClipping,
    toggleClippingOverlays,
  }
}
