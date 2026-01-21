<script setup lang="ts">
/**
 * EditToneCurveEditor Component
 *
 * Interactive tone curve editor with canvas visualization.
 * Uses the useToneCurve composable for all interaction logic.
 */
import type { HistogramData } from '@literoom/core/decode'
import { DEFAULT_TONE_CURVE } from '@literoom/core/decode'

interface Props {
  /** The asset ID being edited */
  assetId: string
  /** Optional histogram data for background visualization */
  histogram?: HistogramData | null
}

const props = defineProps<Props>()

// ============================================================================
// Composable Setup
// ============================================================================

const {
  canvasRef,
  localCurve,
  isDragging,
  resetCurve,
} = useToneCurve({
  histogram: toRef(() => props.histogram),
})

// ============================================================================
// Computed
// ============================================================================

/**
 * Check if curve has modifications from default linear.
 */
const hasModifications = computed(() => {
  const points = localCurve.value.points
  const defaultPoints = DEFAULT_TONE_CURVE.points

  if (points.length !== defaultPoints.length) return true

  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const def = defaultPoints[i]
    if (!current || !def) return true
    if (
      Math.abs(current.x - def.x) > 0.001 ||
      Math.abs(current.y - def.y) > 0.001
    ) {
      return true
    }
  }

  return false
})
</script>

<template>
  <div class="space-y-3" data-testid="tone-curve-editor">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Tone Curve
      </h3>
      <div class="flex items-center gap-2">
        <span
          v-if="isDragging"
          class="text-xs text-blue-400"
          data-testid="curve-dragging"
        >
          Adjusting...
        </span>
        <button
          v-if="hasModifications"
          class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          data-testid="curve-reset"
          @click="resetCurve"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Canvas -->
    <div
      class="relative aspect-square bg-gray-900 rounded overflow-hidden"
      data-testid="curve-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="256"
        height="256"
        class="w-full h-full"
        :class="{
          'cursor-grab': !isDragging,
          'cursor-grabbing': isDragging,
        }"
        style="touch-action: none;"
        data-testid="curve-canvas"
      />
    </div>

    <!-- Instructions -->
    <p class="text-xs text-gray-600">
      Click to add point | Drag to adjust | Double-click to delete
    </p>
  </div>
</template>
