<script setup lang="ts">
/**
 * Histogram Display Component
 *
 * Shows RGB histogram with clipping indicators.
 * Updates in real-time as adjustments change.
 */

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
  canvasRef,
  histogram,
  isComputing,
  error,
} = useHistogramDisplay(
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
// Keyboard Shortcut (J key)
// ============================================================================

function handleKeydown(e: KeyboardEvent) {
  // Ignore when typing in inputs
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
  <div class="space-y-3" data-testid="histogram-display">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Histogram
      </h3>
      <span
        v-if="isComputing"
        class="text-xs text-gray-500"
        data-testid="histogram-computing"
      >
        Computing...
      </span>
    </div>

    <!-- Canvas container -->
    <div
      class="relative aspect-[4/3] bg-gray-900 rounded overflow-hidden"
      data-testid="histogram-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="256"
        height="192"
        class="w-full h-full"
        data-testid="histogram-canvas"
      />

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
