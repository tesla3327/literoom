<script setup lang="ts">
/**
 * EditCropEditor Component
 *
 * Interactive crop editor with canvas overlay.
 * Uses the useCropEditor composable for all interaction logic.
 */
import { ASPECT_PRESETS } from '~/composables/useCropEditor'

interface Props {
  /** The asset ID being edited */
  assetId: string
  /** Image width in pixels */
  imageWidth: number
  /** Image height in pixels */
  imageHeight: number
}

const props = defineProps<Props>()

// ============================================================================
// Canvas Ref
// ============================================================================

const canvasRef = ref<HTMLCanvasElement | null>(null)

// ============================================================================
// Composable Setup
// ============================================================================

const {
  localCrop,
  aspectRatio,
  isDragging,
  hasModifications,
  setAspectRatio,
  resetCrop,
} = useCropEditor({
  canvasRef,
  imageWidth: toRef(() => props.imageWidth),
  imageHeight: toRef(() => props.imageHeight),
})

// ============================================================================
// Computed
// ============================================================================

/**
 * Format crop percentage for display.
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <div class="space-y-3" data-testid="crop-editor">
    <!-- Aspect Ratio Presets -->
    <div class="space-y-2">
      <label class="text-xs text-gray-500">Aspect Ratio</label>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="preset in ASPECT_PRESETS"
          :key="preset.label"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="{
            'bg-blue-600 text-white': aspectRatio === preset.value,
            'bg-gray-700 text-gray-300 hover:bg-gray-600': aspectRatio !== preset.value,
          }"
          :data-testid="`aspect-${preset.label.toLowerCase().replace(':', '-')}`"
          @click="setAspectRatio(preset.value)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <!-- Crop Canvas Preview -->
    <div
      class="relative aspect-video bg-gray-900 rounded overflow-hidden"
      data-testid="crop-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="320"
        height="180"
        class="w-full h-full"
        :class="{
          'cursor-move': !isDragging,
          'cursor-grabbing': isDragging,
        }"
        style="touch-action: none;"
        data-testid="crop-canvas"
      />
    </div>

    <!-- Crop Values Display -->
    <div class="grid grid-cols-4 gap-2 text-xs">
      <div class="text-center">
        <span class="text-gray-500 block">X</span>
        <span class="text-gray-300" data-testid="crop-x">{{ formatPercent(localCrop.left) }}</span>
      </div>
      <div class="text-center">
        <span class="text-gray-500 block">Y</span>
        <span class="text-gray-300" data-testid="crop-y">{{ formatPercent(localCrop.top) }}</span>
      </div>
      <div class="text-center">
        <span class="text-gray-500 block">W</span>
        <span class="text-gray-300" data-testid="crop-w">{{ formatPercent(localCrop.width) }}</span>
      </div>
      <div class="text-center">
        <span class="text-gray-500 block">H</span>
        <span class="text-gray-300" data-testid="crop-h">{{ formatPercent(localCrop.height) }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between">
      <span
        v-if="isDragging"
        class="text-xs text-blue-400"
        data-testid="crop-dragging"
      >
        Adjusting...
      </span>
      <span v-else />
      <button
        v-if="hasModifications"
        class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        data-testid="crop-reset"
        @click="resetCrop"
      >
        Reset Crop
      </button>
    </div>

    <!-- Instructions -->
    <p class="text-xs text-gray-600">
      Drag corners to resize | Drag inside to move
    </p>
  </div>
</template>
