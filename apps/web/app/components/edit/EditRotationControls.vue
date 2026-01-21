<script setup lang="ts">
/**
 * EditRotationControls Component
 *
 * Rotation controls including:
 * - 90-degree rotation buttons
 * - Fine rotation slider (-180 to 180)
 * - Straighten slider (-45 to 45)
 * - Total rotation display
 */

// ============================================================================
// Store
// ============================================================================

const editStore = useEditStore()

// ============================================================================
// Computed
// ============================================================================

/**
 * Main rotation angle (two-way binding).
 */
const rotation = computed({
  get: () => editStore.cropTransform.rotation.angle,
  set: (value: number) => editStore.setRotationAngle(value),
})

/**
 * Straighten angle (two-way binding).
 */
const straighten = computed({
  get: () => editStore.cropTransform.rotation.straighten,
  set: (value: number) => editStore.setStraightenAngle(value),
})

/**
 * Total rotation (main + straighten).
 */
const totalRotation = computed(() => rotation.value + straighten.value)

/**
 * Whether rotation has been modified.
 */
const hasModifications = computed(() => {
  return rotation.value !== 0 || straighten.value !== 0
})

// ============================================================================
// Actions
// ============================================================================

/**
 * Rotate 90 degrees clockwise.
 */
function rotate90CW(): void {
  let newAngle = rotation.value + 90
  // Normalize to -180 to 180 range
  if (newAngle > 180) newAngle -= 360
  editStore.setRotationAngle(newAngle)
}

/**
 * Rotate 90 degrees counter-clockwise.
 */
function rotate90CCW(): void {
  let newAngle = rotation.value - 90
  // Normalize to -180 to 180 range
  if (newAngle < -180) newAngle += 360
  editStore.setRotationAngle(newAngle)
}

/**
 * Reset all rotation to zero.
 */
function resetRotation(): void {
  editStore.setRotation({ angle: 0, straighten: 0 })
}

/**
 * Format angle for display.
 */
function formatAngle(value: number): string {
  return `${value.toFixed(1)}°`
}
</script>

<template>
  <div class="space-y-4" data-testid="rotation-controls">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h4 class="text-xs font-medium text-gray-400">
        Rotation
      </h4>
      <button
        v-if="hasModifications"
        class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        data-testid="rotation-reset"
        @click="resetRotation"
      >
        Reset
      </button>
    </div>

    <!-- 90-degree buttons -->
    <div class="flex gap-2">
      <button
        class="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1"
        title="Rotate 90° counter-clockwise"
        data-testid="rotate-ccw"
        @click="rotate90CCW"
      >
        <span class="text-lg">↺</span>
        <span>90°</span>
      </button>
      <button
        class="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1"
        title="Rotate 90° clockwise"
        data-testid="rotate-cw"
        @click="rotate90CW"
      >
        <span class="text-lg">↻</span>
        <span>90°</span>
      </button>
    </div>

    <!-- Fine rotation slider -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="text-gray-500">Angle</span>
        <span class="text-gray-300" data-testid="rotation-value">{{ formatAngle(rotation) }}</span>
      </div>
      <input
        v-model.number="rotation"
        type="range"
        min="-180"
        max="180"
        step="0.1"
        class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        data-testid="rotation-slider"
      />
    </div>

    <!-- Straighten slider -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="text-gray-500">Straighten</span>
        <span class="text-gray-300" data-testid="straighten-value">{{ formatAngle(straighten) }}</span>
      </div>
      <input
        v-model.number="straighten"
        type="range"
        min="-45"
        max="45"
        step="0.1"
        class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        data-testid="straighten-slider"
      />
    </div>

    <!-- Total rotation display -->
    <div class="text-xs text-gray-600 flex justify-between">
      <span>Total rotation:</span>
      <span data-testid="total-rotation">{{ formatAngle(totalRotation) }}</span>
    </div>
  </div>
</template>
