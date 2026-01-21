/**
 * useHistogramDisplaySVG Composable
 *
 * SVG-based histogram display using bezier curves for smooth rendering.
 * Browser handles anti-aliasing and curve smoothing natively.
 */
import type { Ref } from 'vue'
import type { HistogramData } from '@literoom/core/decode'

// ============================================================================
// Types
// ============================================================================

export interface UseHistogramDisplaySVGReturn {
  /** Current histogram data */
  histogram: Ref<HistogramData | null>
  /** Whether histogram is being computed */
  isComputing: Ref<boolean>
  /** Error message if computation failed */
  error: Ref<string | null>
  /** SVG path data for red channel */
  redPath: ComputedRef<string>
  /** SVG path data for green channel */
  greenPath: ComputedRef<string>
  /** SVG path data for blue channel */
  bluePath: ComputedRef<string>
}

// ============================================================================
// Constants
// ============================================================================

/** SVG viewBox dimensions */
export const SVG_WIDTH = 256
export const SVG_HEIGHT = 192

/** Debounce delay for histogram computation (longer than preview) */
const HISTOGRAM_DEBOUNCE_MS = 500

/** How many bins to sample (lower = smoother, higher = more detail) */
const SAMPLE_RATE = 4 // Sample every 4th bin (64 points total)

/** Catmull-Rom tension (0 = sharp, 1 = very smooth) */
const SPLINE_TENSION = 0.5

// ============================================================================
// Spline Utilities
// ============================================================================

interface Point {
  x: number
  y: number
}

/**
 * Convert Catmull-Rom spline points to cubic bezier path data.
 * This creates smooth curves through all the control points.
 */
function catmullRomToBezierPath(points: Point[], closed: boolean = false): string {
  if (points.length < 2) return ''

  const path: string[] = []

  // Start at first point
  path.push(`M ${points[0]!.x} ${points[0]!.y}`)

  // For Catmull-Rom, we need points before and after each segment
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] || p2

    // Calculate control points for cubic bezier
    // Using Catmull-Rom to Bezier conversion
    const cp1x = p1.x + (p2.x - p0.x) / 6 * SPLINE_TENSION
    const cp1y = p1.y + (p2.y - p0.y) / 6 * SPLINE_TENSION
    const cp2x = p2.x - (p3.x - p1.x) / 6 * SPLINE_TENSION
    const cp2y = p2.y - (p3.y - p1.y) / 6 * SPLINE_TENSION

    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`)
  }

  if (closed) {
    path.push('Z')
  }

  return path.join(' ')
}

/**
 * Convert histogram data to SVG path with smooth curves.
 * Returns a closed path suitable for filling.
 */
function histogramToPath(
  data: Uint32Array,
  maxValue: number,
  width: number,
  height: number,
): string {
  if (maxValue === 0) return ''

  const points: Point[] = []

  // Sample the histogram data at regular intervals for smoother curves
  for (let i = 0; i < 256; i += SAMPLE_RATE) {
    // Average nearby bins for smoother results
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - SAMPLE_RATE / 2); j < Math.min(256, i + SAMPLE_RATE / 2); j++) {
      sum += data[j] ?? 0
      count++
    }
    const value = sum / count

    const x = (i / 255) * width
    const y = height - (value / maxValue) * height

    points.push({ x, y })
  }

  // Add the last point
  const lastValue = data[255] ?? 0
  points.push({
    x: width,
    y: height - (lastValue / maxValue) * height,
  })

  // Create the curve path
  const curvePath = catmullRomToBezierPath(points)

  // Close the path along the bottom for filling
  return `${curvePath} L ${width} ${height} L 0 ${height} Z`
}

/**
 * Convert histogram data to SVG stroke path (no fill, just the curve).
 */
function histogramToStrokePath(
  data: Uint32Array,
  maxValue: number,
  width: number,
  height: number,
): string {
  if (maxValue === 0) return ''

  const points: Point[] = []

  // Sample the histogram data
  for (let i = 0; i < 256; i += SAMPLE_RATE) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - SAMPLE_RATE / 2); j < Math.min(256, i + SAMPLE_RATE / 2); j++) {
      sum += data[j] ?? 0
      count++
    }
    const value = sum / count

    const x = (i / 255) * width
    const y = height - (value / maxValue) * height

    points.push({ x, y })
  }

  // Add the last point
  const lastValue = data[255] ?? 0
  points.push({
    x: width,
    y: height - (lastValue / maxValue) * height,
  })

  return catmullRomToBezierPath(points)
}

// ============================================================================
// Debounce Utility
// ============================================================================

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

async function loadImagePixels(
  url: string,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  const rgba = imageData.data

  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!
    rgb[j + 1] = rgba[i + 1]!
    rgb[j + 2] = rgba[i + 2]!
  }

  return { pixels: rgb, width: img.width, height: img.height }
}

// ============================================================================
// Composable
// ============================================================================

export function useHistogramDisplaySVG(assetId: Ref<string>): UseHistogramDisplaySVGReturn {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()

  const catalog = import.meta.client ? useCatalog() : null

  // ============================================================================
  // State
  // ============================================================================

  const histogram = ref<HistogramData | null>(null)
  const isComputing = ref(false)
  const error = ref<string | null>(null)

  const sourceCache = ref<{
    assetId: string
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  /** Generation counter to detect stale computations during rapid navigation */
  const computeGeneration = ref(0)

  // ============================================================================
  // Computed SVG Paths
  // ============================================================================

  const redPath = computed(() => {
    if (!histogram.value) return ''
    return histogramToPath(
      histogram.value.red,
      histogram.value.maxValue,
      SVG_WIDTH,
      SVG_HEIGHT,
    )
  })

  const greenPath = computed(() => {
    if (!histogram.value) return ''
    return histogramToPath(
      histogram.value.green,
      histogram.value.maxValue,
      SVG_WIDTH,
      SVG_HEIGHT,
    )
  })

  const bluePath = computed(() => {
    if (!histogram.value) return ''
    return histogramToPath(
      histogram.value.blue,
      histogram.value.maxValue,
      SVG_WIDTH,
      SVG_HEIGHT,
    )
  })

  // ============================================================================
  // Histogram Computation
  // ============================================================================

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
      await computeHistogram()
    }
    catch (e) {
      console.error('Histogram source load error:', e)

      // If the blob URL failed (likely revoked due to LRU eviction),
      // re-request the thumbnail from the service which will re-create it from OPFS
      if (url.startsWith('blob:') && import.meta.client && catalog) {
        console.log('[useHistogramDisplaySVG] Blob URL revoked, re-requesting thumbnail for:', id)
        // Clear the stale URL from store to prevent retry loops
        catalogStore.updateThumbnail(id, 'pending', null)
        // Request fresh thumbnail (will be loaded from OPFS cache)
        catalog.requestThumbnail(id, 0)
        // The sourceUrl watcher will pick up the new URL when it's ready
        return
      }

      error.value = 'Failed to load source for histogram'
    }
  }

  async function computeHistogram(): Promise<void> {
    if (!sourceCache.value) return
    if (isComputing.value) return

    // Capture current generation to detect stale computations
    const currentGen = computeGeneration.value

    isComputing.value = true
    error.value = null

    try {
      const { pixels, width, height, assetId: cachedId } = sourceCache.value

      if (cachedId !== assetId.value || computeGeneration.value !== currentGen) {
        console.log('[useHistogramDisplaySVG] Stale computation detected, discarding')
        return
      }

      const result = await $decodeService.computeHistogram(pixels, width, height)

      if (cachedId !== assetId.value || computeGeneration.value !== currentGen) {
        console.log('[useHistogramDisplaySVG] Discarding stale histogram result')
        return
      }

      histogram.value = result
    }
    catch (e) {
      // Only update error state if still on same generation
      if (computeGeneration.value === currentGen) {
        error.value = 'Failed to compute histogram'
        console.error('[useHistogramDisplaySVG] Computation error:', e)
      }
    }
    finally {
      isComputing.value = false
    }
  }

  const debouncedCompute = debounce(() => {
    computeHistogram()
  }, HISTOGRAM_DEBOUNCE_MS)

  // ============================================================================
  // Watchers
  // ============================================================================

  const sourceUrl = computed(() => {
    const asset = catalogStore.assets.get(assetId.value)
    return asset?.thumbnailUrl ?? null
  })

  watch(
    assetId,
    async (id) => {
      // Increment generation to invalidate pending operations
      computeGeneration.value++
      const currentGen = computeGeneration.value

      debouncedCompute.cancel()
      error.value = null
      sourceCache.value = null
      histogram.value = null

      if (!id) return

      if (import.meta.client && catalog) {
        catalog.requestThumbnail(id, 0)
      }

      const asset = catalogStore.assets.get(id)
      if (!asset?.thumbnailUrl) return

      try {
        await loadSource(id)

        if (computeGeneration.value !== currentGen) {
          console.log('[useHistogramDisplaySVG] Asset watcher: generation changed, discarding')
          return
        }
      }
      catch (err) {
        if (computeGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load histogram'
          isComputing.value = false
          console.error('[useHistogramDisplaySVG] Asset load error:', err)
        }
      }
    },
    { immediate: true },
  )

  watch(
    sourceUrl,
    async (url) => {
      if (!url || sourceCache.value) return

      const currentGen = computeGeneration.value

      try {
        await loadSource(assetId.value)

        if (computeGeneration.value !== currentGen) return
      }
      catch (err) {
        if (computeGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load histogram source'
          isComputing.value = false
        }
      }
    },
  )

  watch(
    () => editStore.adjustments,
    () => {
      if (sourceCache.value) {
        debouncedCompute()
      }
    },
    { deep: true },
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  onUnmounted(() => {
    debouncedCompute.cancel()
  })

  return {
    histogram,
    isComputing,
    error,
    redPath,
    greenPath,
    bluePath,
  }
}
