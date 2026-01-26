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
import { computeHistogramAdaptive } from '@literoom/core/gpu'

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
}

// ============================================================================
// Constants
// ============================================================================

/** Canvas dimensions for histogram */
const HISTOGRAM_WIDTH = 256
const HISTOGRAM_HEIGHT = 192

/** Debounce delay for histogram computation (longer than preview) */
const HISTOGRAM_DEBOUNCE_MS = 500

/** Smoothing kernel size (must be odd) - higher = smoother curves */
const SMOOTHING_KERNEL_SIZE = 11

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
// Smoothing Utilities
// ============================================================================

/**
 * Create a Gaussian kernel for smoothing.
 * @param size - Kernel size (must be odd)
 * @returns Normalized Gaussian kernel
 */
function createGaussianKernel(size: number): number[] {
  const kernel: number[] = []
  const sigma = size / 4 // Standard deviation
  const center = Math.floor(size / 2)
  let sum = 0

  for (let i = 0; i < size; i++) {
    const x = i - center
    const value = Math.exp(-(x * x) / (2 * sigma * sigma))
    kernel.push(value)
    sum += value
  }

  // Normalize so kernel sums to 1
  return kernel.map(v => v / sum)
}

/**
 * Apply Gaussian smoothing to histogram data.
 * @param data - Raw histogram data (256 bins)
 * @param kernel - Gaussian kernel
 * @returns Smoothed histogram data
 */
function smoothHistogram(data: Uint32Array, kernel: number[]): number[] {
  const result: number[] = new Array(256)
  const halfKernel = Math.floor(kernel.length / 2)

  for (let i = 0; i < 256; i++) {
    let sum = 0
    let weightSum = 0

    for (let k = 0; k < kernel.length; k++) {
      const idx = i + k - halfKernel
      if (idx >= 0 && idx < 256) {
        sum += (data[idx] ?? 0) * kernel[k]!
        weightSum += kernel[k]!
      }
    }

    // Normalize by actual weights used (handles edges)
    result[i] = weightSum > 0 ? sum / weightSum : 0
  }

  return result
}

/**
 * Lazy-initialized Gaussian kernel for histogram smoothing.
 * Using lazy initialization to avoid HMR issues where createGaussianKernel
 * may not be defined when module-level constant is evaluated.
 */
let _smoothingKernel: number[] | null = null

function getSmoothingKernel(): number[] {
  if (!_smoothingKernel) {
    _smoothingKernel = createGaussianKernel(SMOOTHING_KERNEL_SIZE)
  }
  return _smoothingKernel
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
 * @param adjustedPixelsRef - Optional ref to adjusted pixel data from preview
 * @param adjustedDimensionsRef - Optional ref to adjusted pixel dimensions
 * @param renderQualityRef - Optional ref to render quality ('draft' | 'full') - skips computation in draft mode
 * @returns Histogram state and controls
 */
export function useHistogramDisplay(
  assetId: Ref<string>,
  adjustedPixelsRef?: Ref<Uint8Array | null | undefined>,
  adjustedDimensionsRef?: Ref<{ width: number; height: number } | null | undefined>,
  renderQualityRef?: Ref<'draft' | 'full'>,
): UseHistogramDisplayReturn {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()

  // Only get catalog methods on client-side (catalog service is client-only)
  const catalog = import.meta.client ? useCatalog() : null

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

  /** Cached source pixels to avoid re-loading */
  const sourceCache = ref<{
    assetId: string
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  /** Generation counter to detect stale computations during rapid navigation */
  const computeGeneration = ref(0)

  // ============================================================================
  // Histogram Rendering
  // ============================================================================

  /**
   * Render histogram data to the canvas.
   * Draws each RGB channel as a semi-transparent filled area with proper layering.
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

    // Smooth the histogram data for each channel (using lazy-loaded kernel)
    const kernel = getSmoothingKernel()
    const smoothedRed = smoothHistogram(hist.red, kernel)
    const smoothedGreen = smoothHistogram(hist.green, kernel)
    const smoothedBlue = smoothHistogram(hist.blue, kernel)

    // Draw each channel as a filled path with proper colors
    // Order: Blue first (back), then Green, then Red (front) - matches Lightroom
    const channels: Array<{ data: number[]; color: string; fillColor: string }> = [
      { data: smoothedBlue, color: COLORS.blue, fillColor: 'rgba(0, 100, 255, 0.4)' },
      { data: smoothedGreen, color: COLORS.green, fillColor: 'rgba(0, 200, 0, 0.4)' },
      { data: smoothedRed, color: COLORS.red, fillColor: 'rgba(255, 50, 50, 0.4)' },
    ]

    for (const channel of channels) {
      ctx.beginPath()
      ctx.moveTo(0, height)

      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width
        const binValue = channel.data[i] ?? 0
        const barHeight = (binValue / max) * height
        ctx.lineTo(x, height - barHeight)
      }

      // Close the path at the bottom
      ctx.lineTo(width, height)
      ctx.closePath()

      // Fill with semi-transparent color
      ctx.fillStyle = channel.fillColor
      ctx.fill()

      // Draw outline for better visibility
      ctx.strokeStyle = channel.color
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.6

      // Re-trace just the curve (not the closing lines)
      ctx.beginPath()
      ctx.moveTo(0, height - ((channel.data[0] ?? 0) / max) * height)
      for (let i = 1; i < 256; i++) {
        const x = (i / 255) * width
        const binValue = channel.data[i] ?? 0
        const barHeight = (binValue / max) * height
        ctx.lineTo(x, height - barHeight)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

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
   * Uses generation counter to prevent stale updates during rapid navigation.
   */
  async function computeHistogram(): Promise<void> {
    if (!sourceCache.value) return

    // Don't re-compute if already computing
    if (isComputing.value) return

    // Capture current generation to detect stale computations
    const currentGen = computeGeneration.value

    isComputing.value = true
    error.value = null

    try {
      const { pixels, width, height, assetId: cachedId } = sourceCache.value

      // Check if asset or generation changed
      if (cachedId !== assetId.value || computeGeneration.value !== currentGen) {
        console.log('[useHistogramDisplay] Stale computation detected, discarding')
        return
      }

      // Compute histogram via GPU (with WASM fallback)
      const { result, backend, timing } = await computeHistogramAdaptive(
        pixels,
        width,
        height,
        () => $decodeService.computeHistogram(pixels, width, height),
      )
      console.log(`[useHistogramDisplay] Histogram computed via ${backend} in ${timing.toFixed(1)}ms`)

      // Check again if asset or generation changed
      if (cachedId !== assetId.value || computeGeneration.value !== currentGen) {
        console.log('[useHistogramDisplay] Discarding stale histogram result')
        return
      }

      histogram.value = result

      // Render to canvas
      renderHistogram()
    }
    catch (e) {
      // Only update error state if still on same generation
      if (computeGeneration.value === currentGen) {
        error.value = 'Failed to compute histogram'
        console.error('[useHistogramDisplay] Computation error:', e)
      }
    }
    finally {
      isComputing.value = false
    }
  }

  /**
   * Compute histogram directly from provided pixel data.
   * Used when adjusted pixels are passed from the preview pipeline.
   *
   * @param pixels - RGB pixel data (3 bytes per pixel)
   * @param width - Image width
   * @param height - Image height
   */
  async function computeHistogramFromPixels(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): Promise<void> {
    // Don't re-compute if already computing
    if (isComputing.value) return

    // Capture current generation to detect stale computations
    const currentGen = computeGeneration.value

    isComputing.value = true
    error.value = null

    try {
      // Compute histogram via GPU (with WASM fallback)
      const { result, backend, timing } = await computeHistogramAdaptive(
        pixels,
        width,
        height,
        () => $decodeService.computeHistogram(pixels, width, height),
      )
      console.log(`[useHistogramDisplay] Histogram (from pixels) computed via ${backend} in ${timing.toFixed(1)}ms`)

      // Check if generation changed (stale computation)
      if (computeGeneration.value !== currentGen) {
        console.log('[useHistogramDisplay] Discarding stale adjusted-pixels histogram result')
        return
      }

      histogram.value = result

      // Render to canvas
      renderHistogram()
    }
    catch (e) {
      // Only update error state if still on same generation
      if (computeGeneration.value === currentGen) {
        error.value = 'Failed to compute histogram from adjusted pixels'
        console.error('[useHistogramDisplay] Adjusted pixels computation error:', e)
      }
    }
    finally {
      isComputing.value = false
    }
  }

  /**
   * Debounced histogram computation for adjusted pixels.
   * Uses longer delay (500ms) to prioritize preview updates.
   * Stores the pending pixels to avoid closure issues with typed parameters.
   */
  let pendingAdjustedPixels: { pixels: Uint8Array; width: number; height: number } | null = null

  const debouncedComputeFromPixels = debounce(() => {
    if (pendingAdjustedPixels) {
      computeHistogramFromPixels(
        pendingAdjustedPixels.pixels,
        pendingAdjustedPixels.width,
        pendingAdjustedPixels.height,
      )
    }
  }, HISTOGRAM_DEBOUNCE_MS)

  /**
   * Schedule debounced histogram computation from adjusted pixels.
   * Skips scheduling entirely during draft mode to avoid queuing up computations.
   */
  function scheduleComputeFromPixels(pixels: Uint8Array, width: number, height: number) {
    // Don't schedule histogram computation during draft mode
    // The histogram will be computed when quality changes to 'full'
    if (renderQualityRef?.value === 'draft') {
      // Cancel any pending debounced computation to avoid stale updates
      debouncedComputeFromPixels.cancel()
      return
    }

    pendingAdjustedPixels = { pixels, width, height }
    debouncedComputeFromPixels()
  }

  /**
   * Debounced histogram computation for use during slider drag.
   * Uses longer delay (500ms) to prioritize preview updates.
   */
  const debouncedCompute = debounce(() => {
    computeHistogram()
  }, HISTOGRAM_DEBOUNCE_MS)

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
   * Uses generation counter to prevent stale updates during rapid navigation.
   */
  watch(
    assetId,
    async (id) => {
      // Increment generation to invalidate pending operations
      computeGeneration.value++
      const currentGen = computeGeneration.value

      // Cancel any pending debounced computations
      debouncedCompute.cancel()

      // Reset state
      error.value = null
      sourceCache.value = null
      histogram.value = null

      if (!id) {
        return
      }

      // Request thumbnail generation (priority 0 = highest for edit view)
      // This ensures the thumbnail is generated even if we navigate directly to edit view
      // Only run on client (catalog service is client-only)
      if (import.meta.client && catalog) {
        catalog.requestThumbnail(id, 0)
      }

      // Check if asset has thumbnail URL
      const asset = catalogStore.assets.get(id)
      if (!asset?.thumbnailUrl) {
        // Early return - the sourceUrl watcher will pick up when thumbnail is ready
        return
      }

      try {
        // Load source pixels and compute histogram
        await loadSource(id)

        // Check generation before proceeding
        if (computeGeneration.value !== currentGen) {
          console.log('[useHistogramDisplay] Asset watcher: generation changed, discarding')
          return
        }
      }
      catch (err) {
        // Only update error if still on same generation
        if (computeGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load histogram'
          isComputing.value = false
          console.error('[useHistogramDisplay] Asset load error:', err)
        }
      }
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
      if (!url || sourceCache.value) return

      const currentGen = computeGeneration.value

      try {
        await loadSource(assetId.value)

        // Check generation before proceeding
        if (computeGeneration.value !== currentGen) {
          return
        }
      }
      catch (err) {
        if (computeGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load histogram source'
          isComputing.value = false
          console.error('[useHistogramDisplay] Source load error:', err)
        }
      }
    },
  )

  /**
   * Watch for adjusted pixels from the preview pipeline.
   * When adjusted pixels are provided, compute histogram from them for accurate results.
   */
  if (adjustedPixelsRef && adjustedDimensionsRef) {
    watch(
      [adjustedPixelsRef, adjustedDimensionsRef],
      ([pixels, dims]) => {
        // Skip histogram computation during draft mode (it has a 500ms debounce anyway,
        // but this saves the computation entirely during rapid slider dragging)
        if (renderQualityRef?.value === 'draft') {
          return // Use cached histogram during interaction
        }
        if (pixels && dims) {
          // Use debounced computation to avoid jank during rapid updates
          scheduleComputeFromPixels(pixels, dims.width, dims.height)
        }
      },
      { immediate: true },
    )

    /**
     * Watch for render quality changes from 'draft' to 'full'.
     * When transitioning to full quality, immediately compute histogram with current pixels.
     * This ensures the histogram updates after slider interactions complete.
     */
    if (renderQualityRef) {
      watch(
        renderQualityRef,
        (newQuality, oldQuality) => {
          // Only trigger when transitioning from draft to full
          if (oldQuality === 'draft' && newQuality === 'full') {
            const pixels = adjustedPixelsRef.value
            const dims = adjustedDimensionsRef.value
            if (pixels && dims) {
              // Compute immediately (not debounced) since interaction is complete
              computeHistogramFromPixels(pixels, dims.width, dims.height)
            }
          }
        },
      )
    }
  }

  /**
   * Watch for adjustment changes and trigger debounced histogram computation.
   * This is a fallback for when adjusted pixels are not provided.
   * When adjusted pixels ARE provided, the above watcher handles updates.
   */
  watch(
    () => editStore.adjustments,
    () => {
      // Only use source-based computation if adjusted pixels are not being provided
      if (!adjustedPixelsRef && sourceCache.value) {
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
    debouncedComputeFromPixels.cancel()
  })

  return {
    canvasRef,
    histogram,
    isComputing,
    error,
  }
}
