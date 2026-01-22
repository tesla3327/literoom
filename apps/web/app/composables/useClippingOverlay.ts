/**
 * useClippingOverlay Composable
 *
 * Renders clipping overlay on a canvas positioned over the preview image.
 * Uses per-channel color coding like Lightroom:
 *
 * Highlight clipping (channel at 255):
 * - White = all 3 channels (R=255, G=255, B=255)
 * - Red = only R
 * - Green = only G
 * - Blue = only B
 * - Yellow = R + G
 * - Magenta = R + B
 * - Cyan = G + B
 *
 * Shadow clipping (channel at 0):
 * Shows complementary colors (remaining channels):
 * - Black = all 3 channels clipped
 * - Cyan tint = R clipped (G+B remain)
 * - Magenta tint = G clipped (R+B remain)
 * - Yellow tint = B clipped (R+G remain)
 *
 * Uses the editUI store for toggle state and watches for changes.
 */
import type { Ref, ComputedRef } from 'vue'
import type { ClippingMap } from './useEditPreview'
import {
  CLIP_SHADOW_R,
  CLIP_SHADOW_G,
  CLIP_SHADOW_B,
  CLIP_HIGHLIGHT_R,
  CLIP_HIGHLIGHT_G,
  CLIP_HIGHLIGHT_B,
} from './useEditPreview'

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

/** Overlay opacity (50% = 128) */
const OVERLAY_ALPHA = 128

/** Shadow overlay uses darker colors to better show complementary hue */
const SHADOW_INTENSITY = 200

// ============================================================================
// Color Mapping Functions
// ============================================================================

/**
 * Get overlay color for highlight clipping.
 * Shows the clipped channels directly:
 * - White = all channels (R+G+B)
 * - Primary colors (R, G, B) for single channel
 * - Secondary colors (Yellow, Magenta, Cyan) for two channels
 */
function getHighlightColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & CLIP_HIGHLIGHT_R) !== 0
  const gClip = (clipBits & CLIP_HIGHLIGHT_G) !== 0
  const bClip = (clipBits & CLIP_HIGHLIGHT_B) !== 0

  // Build color from clipped channels
  return [
    rClip ? 255 : 0,
    gClip ? 255 : 0,
    bClip ? 255 : 0,
    OVERLAY_ALPHA,
  ]
}

/**
 * Get overlay color for shadow clipping.
 * Shows the remaining (non-clipped) channels:
 * - If R is clipped, we see Cyan (G+B remaining)
 * - If all are clipped, show dark gray (nearly black)
 */
function getShadowColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & CLIP_SHADOW_R) !== 0
  const gClip = (clipBits & CLIP_SHADOW_G) !== 0
  const bClip = (clipBits & CLIP_SHADOW_B) !== 0

  // If all clipped, show dark overlay
  if (rClip && gClip && bClip) {
    return [40, 40, 40, 160]
  }

  // Show remaining channels (complementary to clipped)
  return [
    rClip ? 0 : SHADOW_INTENSITY,
    gClip ? 0 : SHADOW_INTENSITY,
    bClip ? 0 : SHADOW_INTENSITY,
    OVERLAY_ALPHA,
  ]
}

// ============================================================================
// Composable
// ============================================================================

export function useClippingOverlay(options: UseClippingOverlayOptions): UseClippingOverlayReturn {
  const { canvasRef, clippingMap, displayWidth, displayHeight } = options
  const editUIStore = useEditUIStore()

  /**
   * Render the clipping overlay to the canvas.
   * Uses per-channel color coding for professional clipping visualization.
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

    // Combined mask for any shadow clipping bits
    const SHADOW_MASK = CLIP_SHADOW_R | CLIP_SHADOW_G | CLIP_SHADOW_B
    // Combined mask for any highlight clipping bits
    const HIGHLIGHT_MASK = CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Map canvas position to clipping map position
        const mapX = Math.floor(x / scaleX)
        const mapY = Math.floor(y / scaleY)
        const mapIdx = mapY * map.width + mapX
        const clipType = map.data[mapIdx]

        if (clipType === undefined || clipType === 0) continue

        const pixelIdx = (y * width + x) * 4

        const hasShadow = (clipType & SHADOW_MASK) !== 0
        const hasHighlight = (clipType & HIGHLIGHT_MASK) !== 0

        const showShadow = editUIStore.showShadowClipping && hasShadow
        const showHighlight = editUIStore.showHighlightClipping && hasHighlight

        if (showShadow && showHighlight) {
          // Both - blend shadow and highlight colors
          const shadowColor = getShadowColor(clipType)
          const highlightColor = getHighlightColor(clipType)
          // Simple average blend
          pixels[pixelIdx] = Math.round((shadowColor[0] + highlightColor[0]) / 2)
          pixels[pixelIdx + 1] = Math.round((shadowColor[1] + highlightColor[1]) / 2)
          pixels[pixelIdx + 2] = Math.round((shadowColor[2] + highlightColor[2]) / 2)
          pixels[pixelIdx + 3] = 160
        }
        else if (showShadow) {
          const color = getShadowColor(clipType)
          pixels[pixelIdx] = color[0]
          pixels[pixelIdx + 1] = color[1]
          pixels[pixelIdx + 2] = color[2]
          pixels[pixelIdx + 3] = color[3]
        }
        else if (showHighlight) {
          const color = getHighlightColor(clipType)
          pixels[pixelIdx] = color[0]
          pixels[pixelIdx + 1] = color[1]
          pixels[pixelIdx + 2] = color[2]
          pixels[pixelIdx + 3] = color[3]
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
