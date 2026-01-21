/**
 * useEditPreview Composable
 *
 * Manages the preview rendering pipeline for the edit view:
 * - Loads source preview for an asset
 * - Watches for edit changes and triggers re-renders
 * - Applies adjustments via WASM decode service
 * - Implements debouncing to prevent excessive renders during slider drag
 * - Provides draft/full render quality indicators
 */
import type { Ref } from 'vue'
import type { Adjustments } from '@literoom/core/catalog'
import { hasModifiedAdjustments } from '@literoom/core/catalog'

// ============================================================================
// Types
// ============================================================================

export interface UseEditPreviewReturn {
  /** URL of the current preview (with edits applied when available) */
  previewUrl: Ref<string | null>
  /** Whether a render is in progress */
  isRendering: Ref<boolean>
  /** Current render quality level */
  renderQuality: Ref<'draft' | 'full'>
  /** Error message if render failed */
  error: Ref<string | null>
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function to avoid adding VueUse dependency.
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
 * Convert RGB pixel data (3 bytes per pixel) to RGBA (4 bytes per pixel).
 */
function rgbToRgba(rgb: Uint8Array): Uint8ClampedArray {
  const pixelCount = rgb.length / 3
  const rgba = new Uint8ClampedArray(pixelCount * 4)

  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]! // R
    rgba[j + 1] = rgb[i + 1]! // G
    rgba[j + 2] = rgb[i + 2]! // B
    rgba[j + 3] = 255 // A (fully opaque)
  }

  return rgba
}

/**
 * Convert pixels to a blob URL for display in an <img> tag.
 */
async function pixelsToUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<string> {
  // Create canvas and draw pixels
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const rgbaPixels = rgbToRgba(pixels)
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(rgbaPixels)
  ctx.putImageData(imageData, 0, 0)

  // Convert to blob URL
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to create blob'))
      },
      'image/jpeg',
      0.9,
    )
  })

  return URL.createObjectURL(blob)
}

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
 * Composable for managing edit preview rendering.
 *
 * @param assetId - Reactive ref to the current asset ID
 * @returns Preview state and controls
 */
export function useEditPreview(assetId: Ref<string>): UseEditPreviewReturn {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()
  const { requestThumbnail } = useCatalog()

  // ============================================================================
  // State
  // ============================================================================

  /** URL of the rendered preview */
  const previewUrl = ref<string | null>(null)

  /** Whether a render is in progress */
  const isRendering = ref(false)

  /** Current render quality */
  const renderQuality = ref<'draft' | 'full'>('full')

  /** Error message if render failed */
  const error = ref<string | null>(null)

  /** Cached source pixels to avoid re-loading on every adjustment */
  const sourceCache = ref<{
    assetId: string
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Get source image URL for the current asset.
   * Prefers larger preview if available, falls back to thumbnail.
   */
  const sourceUrl = computed(() => {
    const asset = catalogStore.assets.get(assetId.value)
    // TODO: Use preview1x when available, fall back to thumbnail
    return asset?.thumbnailUrl ?? null
  })

  // ============================================================================
  // Render Functions
  // ============================================================================

  /**
   * Load source pixels for an asset.
   */
  async function loadSource(id: string): Promise<void> {
    const asset = catalogStore.assets.get(id)
    const url = asset?.thumbnailUrl

    if (!url) {
      sourceCache.value = null
      previewUrl.value = null
      return
    }

    try {
      const { pixels, width, height } = await loadImagePixels(url)
      sourceCache.value = { assetId: id, pixels, width, height }

      // Show initial preview immediately
      previewUrl.value = url
    }
    catch (e) {
      console.error('Failed to load source pixels:', e)
      sourceCache.value = null
      // Still show the thumbnail as fallback
      previewUrl.value = url
    }
  }

  /**
   * Render the preview with current adjustments.
   *
   * @param quality - 'draft' for fast render during drag, 'full' for high quality
   */
  async function renderPreview(quality: 'draft' | 'full'): Promise<void> {
    console.log('[useEditPreview] renderPreview called, quality:', quality)
    if (!sourceCache.value) {
      console.log('[useEditPreview] No source cache, returning early')
      return
    }

    // Don't re-render if still rendering
    if (isRendering.value) {
      console.log('[useEditPreview] Already rendering, returning early')
      return
    }

    error.value = null
    isRendering.value = true
    renderQuality.value = quality

    try {
      const { pixels, width, height, assetId: cachedId } = sourceCache.value

      // Check if asset changed while we were waiting
      if (cachedId !== assetId.value) {
        return
      }

      // Get current adjustments from store
      const adjustments: Adjustments = {
        temperature: editStore.adjustments.temperature,
        tint: editStore.adjustments.tint,
        exposure: editStore.adjustments.exposure,
        contrast: editStore.adjustments.contrast,
        highlights: editStore.adjustments.highlights,
        shadows: editStore.adjustments.shadows,
        whites: editStore.adjustments.whites,
        blacks: editStore.adjustments.blacks,
        vibrance: editStore.adjustments.vibrance,
        saturation: editStore.adjustments.saturation,
        toneCurve: editStore.adjustments.toneCurve,
      }

      // Check if any adjustments are non-default
      const hasAdjustments = hasModifiedAdjustments(adjustments)

      let resultUrl: string

      if (!hasAdjustments) {
        // No adjustments, use source directly
        resultUrl = sourceUrl.value!
      }
      else {
        // Apply adjustments via WASM
        const result = await $decodeService.applyAdjustments(
          pixels,
          width,
          height,
          adjustments,
        )

        // Convert result to blob URL
        resultUrl = await pixelsToUrl(result.pixels, result.width, result.height)

        // Revoke old URL if it was a blob URL
        if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
          URL.revokeObjectURL(previewUrl.value)
        }
      }

      // Check again if asset changed
      if (cachedId !== assetId.value) {
        // Asset changed, discard result
        if (resultUrl.startsWith('blob:')) {
          URL.revokeObjectURL(resultUrl)
        }
        return
      }

      previewUrl.value = resultUrl
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to render preview'
      console.error('Preview render error:', e)
    }
    finally {
      isRendering.value = false
      renderQuality.value = 'full'
    }
  }

  /**
   * Debounced render for use during slider drag.
   * Triggers draft quality render after 300ms of inactivity.
   */
  const debouncedRender = debounce(() => {
    renderPreview('draft')
  }, 300)

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Watch for adjustment changes and trigger debounced render.
   * Deep watch to catch individual slider changes.
   */
  watch(
    () => editStore.adjustments,
    () => {
      if (sourceCache.value) {
        debouncedRender()
      }
    },
    { deep: true },
  )

  /**
   * Watch for asset changes and immediately load new source.
   */
  watch(
    assetId,
    async (id) => {
      debouncedRender.cancel()
      error.value = null
      sourceCache.value = null

      // Request thumbnail generation (priority 0 = highest for edit view)
      // This ensures the thumbnail is generated even if we navigate directly to edit view
      requestThumbnail(id, 0)

      // Show thumbnail immediately while loading pixels
      const asset = catalogStore.assets.get(id)
      previewUrl.value = asset?.thumbnailUrl ?? null

      // Load source pixels in background
      await loadSource(id)

      // Render with current adjustments if any
      if (sourceCache.value && editStore.isDirty) {
        renderPreview('full')
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
      if (url && !sourceCache.value) {
        await loadSource(assetId.value)
        // Render with current adjustments after loading
        if (sourceCache.value) {
          renderPreview('full')
        }
      }
    },
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  onUnmounted(() => {
    debouncedRender.cancel()
    // Revoke blob URL if any
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl.value)
    }
  })

  return {
    previewUrl,
    isRendering,
    renderQuality,
    error,
  }
}
