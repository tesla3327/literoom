<script setup lang="ts">
/**
 * SVG-based Histogram Display Component
 *
 * Uses bezier curves for smooth rendering instead of canvas.
 * Browser handles anti-aliasing natively.
 */
import { SVG_WIDTH, SVG_HEIGHT } from '~/composables/useHistogramDisplaySVG'

const props = defineProps<{
  assetId: string
  adjustedPixels?: Uint8Array | null
  adjustedDimensions?: { width: number; height: number } | null
}>()

const adjustedPixelsRef = toRef(props, 'adjustedPixels')
const adjustedDimensionsRef = toRef(props, 'adjustedDimensions')

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
)

// Use shared UI store for clipping overlay state
const editUIStore = useEditUIStore()
const { showHighlightClipping, showShadowClipping } = storeToRefs(editUIStore)
const { toggleClippingOverlays, toggleShadowClipping, toggleHighlightClipping } = editUIStore

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
        <polygon
          v-if="histogram?.hasShadowClipping"
          points="0,0 8,0 0,8"
          fill="#3b82f6"
        />

        <!-- Highlight clipping indicator (top-right triangle) -->
        <polygon
          v-if="histogram?.hasHighlightClipping"
          :points="`${SVG_WIDTH},0 ${SVG_WIDTH - 8},0 ${SVG_WIDTH},8`"
          fill="#ef4444"
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
          :class="histogram.hasShadowClipping ? 'bg-blue-500' : 'bg-gray-600'"
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
          :class="histogram.hasHighlightClipping ? 'bg-red-500' : 'bg-gray-600'"
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
