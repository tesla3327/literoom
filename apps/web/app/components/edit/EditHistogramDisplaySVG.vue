<script setup lang="ts">
/**
 * SVG-based Histogram Display Component
 *
 * Uses bezier curves for smooth rendering instead of canvas.
 * Browser handles anti-aliasing natively.
 *
 * Clipping triangle indicators use per-channel color coding like Lightroom:
 * - White = all channels clipped
 * - Primary colors (R, G, B) = single channel clipped
 * - Secondary colors (Cyan, Magenta, Yellow) = two channels clipped
 */
import { SVG_WIDTH, SVG_HEIGHT } from '~/composables/useHistogramDisplaySVG'
import type { ChannelClipping } from '@literoom/core/decode'

const props = defineProps<{
  assetId: string
  adjustedPixels?: Uint8Array | null
  adjustedDimensions?: { width: number; height: number } | null
  renderQuality?: 'draft' | 'full'
}>()

const adjustedPixelsRef = toRef(props, 'adjustedPixels')
const adjustedDimensionsRef = toRef(props, 'adjustedDimensions')
const renderQualityRef = toRef(props, 'renderQuality')

const {
  histogram,
  isComputing,
  error,
  redPath,
  greenPath,
  bluePath,
} = useHistogramDisplaySVG(
  toRef(props, 'assetId'),
  adjustedPixelsRef,
  adjustedDimensionsRef,
  renderQualityRef as Ref<'draft' | 'full'>,
)

// Use shared UI store for clipping overlay state
const editUIStore = useEditUIStore()
const { showHighlightClipping, showShadowClipping } = storeToRefs(editUIStore)
const { toggleClippingOverlays, toggleShadowClipping, toggleHighlightClipping } = editUIStore

// ============================================================================
// Per-Channel Triangle Colors (Lightroom-style)
// ============================================================================

/**
 * Get triangle indicator color based on which channels are clipping.
 * - White = all 3 channels (true blown/crushed)
 * - Secondary colors = 2 channels
 * - Primary colors = 1 channel
 */
function getTriangleColor(clipping: ChannelClipping | undefined): string {
  if (!clipping) return 'transparent'

  const { r, g, b } = clipping

  // All channels = white (true detail loss)
  if (r && g && b) return '#ffffff'

  // Two channels = secondary color
  if (r && g) return '#ffff00' // Yellow
  if (r && b) return '#ff00ff' // Magenta
  if (g && b) return '#00ffff' // Cyan

  // One channel = primary color
  if (r) return '#ff0000' // Red
  if (g) return '#00ff00' // Green
  if (b) return '#0000ff' // Blue

  // No clipping
  return 'transparent'
}

// Computed triangle colors based on per-channel clipping info
const shadowTriangleColor = computed(() =>
  getTriangleColor(histogram.value?.shadowClipping),
)

const highlightTriangleColor = computed(() =>
  getTriangleColor(histogram.value?.highlightClipping),
)

// Legacy compatibility - check if any clipping exists
const hasShadowClipping = computed(() => histogram.value?.hasShadowClipping ?? false)
const hasHighlightClipping = computed(() => histogram.value?.hasHighlightClipping ?? false)

// ============================================================================
// Keyboard Shortcut (J key)
// ============================================================================

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return
  }

  if (e.key === 'j' || e.key === 'J') {
    toggleClippingOverlays()
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="space-y-3" data-testid="histogram-display-svg">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Histogram <span class="text-xs text-gray-600">(SVG)</span>
      </h3>
      <span
        v-if="isComputing"
        class="text-xs text-gray-500"
        data-testid="histogram-computing"
      >
        Computing...
      </span>
    </div>

    <!-- SVG container -->
    <div
      class="relative aspect-[4/3] bg-gray-900 rounded overflow-hidden"
      data-testid="histogram-svg-container"
    >
      <svg
        :viewBox="`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`"
        class="w-full h-full"
        preserveAspectRatio="none"
        data-testid="histogram-svg"
      >
        <!-- Background -->
        <rect
          x="0"
          y="0"
          :width="SVG_WIDTH"
          :height="SVG_HEIGHT"
          fill="#1a1a1a"
        />

        <!-- Histogram curves - order matters for layering -->
        <!-- Blue (back) -->
        <path
          v-if="bluePath"
          :d="bluePath"
          fill="rgba(0, 100, 255, 0.4)"
          stroke="rgb(0, 0, 255)"
          stroke-width="1"
          stroke-opacity="0.6"
        />

        <!-- Green (middle) -->
        <path
          v-if="greenPath"
          :d="greenPath"
          fill="rgba(0, 200, 0, 0.4)"
          stroke="rgb(0, 255, 0)"
          stroke-width="1"
          stroke-opacity="0.6"
        />

        <!-- Red (front) -->
        <path
          v-if="redPath"
          :d="redPath"
          fill="rgba(255, 50, 50, 0.4)"
          stroke="rgb(255, 0, 0)"
          stroke-width="1"
          stroke-opacity="0.6"
        />

        <!-- Shadow clipping indicator (top-left triangle) -->
        <!-- Color-coded: white=all channels, primary=single, secondary=two channels -->
        <polygon
          v-if="hasShadowClipping"
          points="0,0 10,0 0,10"
          :fill="shadowTriangleColor"
          stroke="#333"
          stroke-width="0.5"
        />

        <!-- Highlight clipping indicator (top-right triangle) -->
        <!-- Color-coded: white=all channels, primary=single, secondary=two channels -->
        <polygon
          v-if="hasHighlightClipping"
          :points="`${SVG_WIDTH},0 ${SVG_WIDTH - 10},0 ${SVG_WIDTH},10`"
          :fill="highlightTriangleColor"
          stroke="#333"
          stroke-width="0.5"
        />
      </svg>

      <!-- Error overlay -->
      <div
        v-if="error"
        class="absolute inset-0 flex items-center justify-center bg-gray-900/80"
        data-testid="histogram-error"
      >
        <span class="text-xs text-red-400">{{ error }}</span>
      </div>

      <!-- Loading state when no histogram yet -->
      <div
        v-else-if="!histogram"
        class="absolute inset-0 flex items-center justify-center"
        data-testid="histogram-loading"
      >
        <span class="text-xs text-gray-600">Loading...</span>
      </div>
    </div>

    <!-- Clipping toggles -->
    <div
      v-if="histogram"
      class="flex gap-4 text-xs"
      data-testid="clipping-toggles"
    >
      <button
        class="flex items-center gap-1.5 transition-opacity"
        :class="showShadowClipping ? 'opacity-100' : 'opacity-50'"
        data-testid="shadow-clipping-toggle"
        @click="toggleShadowClipping"
      >
        <span
          class="w-2 h-2 rounded-sm"
          :style="hasShadowClipping ? { backgroundColor: shadowTriangleColor } : { backgroundColor: '#4b5563' }"
        />
        <span class="text-gray-400">Shadows</span>
      </button>

      <button
        class="flex items-center gap-1.5 transition-opacity"
        :class="showHighlightClipping ? 'opacity-100' : 'opacity-50'"
        data-testid="highlight-clipping-toggle"
        @click="toggleHighlightClipping"
      >
        <span
          class="w-2 h-2 rounded-sm"
          :style="hasHighlightClipping ? { backgroundColor: highlightTriangleColor } : { backgroundColor: '#4b5563' }"
        />
        <span class="text-gray-400">Highlights</span>
      </button>
    </div>

    <!-- Keyboard hint -->
    <p class="text-xs text-gray-600">
      Press J to toggle clipping overlay
    </p>
  </div>
</template>
