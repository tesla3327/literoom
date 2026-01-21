/**
 * useClippingOverlay Composable
 *
 * Renders clipping overlay on a canvas positioned over the preview image.
 * - Blue overlay for shadow clipping (pixels with any channel at 0)
 * - Red overlay for highlight clipping (pixels with any channel at 255)
 * - Purple overlay for both shadow and highlight clipping
 *
 * Uses the editUI store for toggle state and watches for changes.
 */
import type { Ref, ComputedRef } from 'vue'
import type { ClippingMap } from './useEditPreview'

// ============================================================================
// Types
// ============================================================================

export interface UseClippingOverlayOptions {
  /** Reference to the overlay canvas element */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Clipping map data from useEditPreview */
  clippingMap: Ref<ClippingMap | null>
  /** Width of the preview display area */
  displayWidth: Ref<number> | ComputedRef<number>
  /** Height of the preview display area */
  displayHeight: Ref<number> | ComputedRef<number>
}

export interface UseClippingOverlayReturn {
  /** Manually trigger a re-render of the overlay */
  render: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Overlay colors (RGBA values) */
const COLORS = {
  // Blue for shadow clipping - 40% opacity
  shadow: { r: 59, g: 130, b: 246, a: 102 },
  // Red for highlight clipping - 40% opacity
  highlight: { r: 239, g: 68, b: 68, a: 102 },
  // Purple for both - 40% opacity
  both: { r: 168, g: 85, b: 247, a: 102 },
}

// ============================================================================
// Composable
// ============================================================================

export function useClippingOverlay(options: UseClippingOverlayOptions): UseClippingOverlayReturn {
  const { canvasRef, clippingMap, displayWidth, displayHeight } = options
  const editUIStore = useEditUIStore()

  /**
   * Render the clipping overlay to the canvas.
   * Uses the clipping map data to draw colored pixels where clipping occurs.
   */
  function render(): void {
    const canvas = canvasRef.value
    const map = clippingMap.value

    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Update canvas dimensions to match display area
    const width = displayWidth.value
    const height = displayHeight.value

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    // Clear previous overlay
    ctx.clearRect(0, 0, width, height)

    // Skip if neither clipping overlay is enabled or no map data
    if (!map || (!editUIStore.showHighlightClipping && !editUIStore.showShadowClipping)) {
      return
    }

    // Create ImageData for efficient pixel manipulation
    const imageData = ctx.createImageData(width, height)
    const pixels = imageData.data

    // Calculate scale from clipping map to canvas
    const scaleX = width / map.width
    const scaleY = height / map.height

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Map canvas position to clipping map position
        const mapX = Math.floor(x / scaleX)
        const mapY = Math.floor(y / scaleY)
        const mapIdx = mapY * map.width + mapX
        const clipType = map.data[mapIdx]

        if (clipType === undefined || clipType === 0) continue

        const pixelIdx = (y * width + x) * 4

        const isShadowClipped = (clipType & 1) !== 0
        const isHighlightClipped = (clipType & 2) !== 0

        const showShadow = editUIStore.showShadowClipping && isShadowClipped
        const showHighlight = editUIStore.showHighlightClipping && isHighlightClipped

        if (showShadow && showHighlight) {
          // Both - use purple
          pixels[pixelIdx] = COLORS.both.r
          pixels[pixelIdx + 1] = COLORS.both.g
          pixels[pixelIdx + 2] = COLORS.both.b
          pixels[pixelIdx + 3] = COLORS.both.a
        }
        else if (showShadow) {
          // Shadow only - blue
          pixels[pixelIdx] = COLORS.shadow.r
          pixels[pixelIdx + 1] = COLORS.shadow.g
          pixels[pixelIdx + 2] = COLORS.shadow.b
          pixels[pixelIdx + 3] = COLORS.shadow.a
        }
        else if (showHighlight) {
          // Highlight only - red
          pixels[pixelIdx] = COLORS.highlight.r
          pixels[pixelIdx + 1] = COLORS.highlight.g
          pixels[pixelIdx + 2] = COLORS.highlight.b
          pixels[pixelIdx + 3] = COLORS.highlight.a
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  // Re-render when toggle states change
  watch(
    () => [editUIStore.showHighlightClipping, editUIStore.showShadowClipping],
    () => render(),
  )

  // Re-render when clipping map updates
  watch(clippingMap, () => render())

  // Re-render when display dimensions change
  watch([displayWidth, displayHeight], () => render())

  // Re-render when canvas ref becomes available
  watch(canvasRef, () => {
    if (canvasRef.value) {
      render()
    }
  })

  return { render }
}
