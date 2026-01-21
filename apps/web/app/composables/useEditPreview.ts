/**
 * useEditPreview Composable
 *
 * Manages the preview rendering pipeline for the edit view:
 * - Loads source preview for an asset
 * - Watches for edit changes and triggers re-renders
 * - Implements debouncing to prevent excessive renders during slider drag
 * - Provides draft/full render quality indicators
 *
 * Currently serves as a placeholder that displays the source image.
 * Full WASM-based edit application will be added in Phase 9.
 */
import type { Ref } from 'vue'

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
   * Render the preview with current adjustments.
   * Currently a placeholder - will be replaced with WASM-based processing.
   *
   * @param quality - 'draft' for fast render during drag, 'full' for high quality
   */
  async function renderPreview(quality: 'draft' | 'full'): Promise<void> {
    if (!sourceUrl.value) return

    error.value = null
    isRendering.value = true
    renderQuality.value = quality

    try {
      // TODO: Phase 9 - Apply adjustments via WASM
      // For now, just use the source URL directly
      // The adjustments are stored in editStore.adjustments but not yet applied

      // Simulate a small delay for draft renders to show the indicator
      if (quality === 'draft') {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      previewUrl.value = sourceUrl.value
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
      debouncedRender()
    },
    { deep: true },
  )

  /**
   * Watch for asset changes and immediately load new preview.
   */
  watch(
    assetId,
    () => {
      debouncedRender.cancel()
      previewUrl.value = sourceUrl.value
      error.value = null
    },
    { immediate: true },
  )

  /**
   * Watch for source URL changes (e.g., when thumbnail loads).
   */
  watch(
    sourceUrl,
    (url) => {
      if (url && !previewUrl.value) {
        previewUrl.value = url
      }
    },
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  onUnmounted(() => {
    debouncedRender.cancel()
  })

  return {
    previewUrl,
    isRendering,
    renderQuality,
    error,
  }
}
