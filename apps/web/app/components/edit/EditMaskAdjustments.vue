<script setup lang="ts">
/**
 * EditMaskAdjustments Component
 *
 * Displays adjustment sliders for the currently selected mask.
 * Uses the same slider component as global adjustments but wires
 * to the per-mask adjustment values.
 */
import type { MaskAdjustments } from '@literoom/core/catalog'

const editStore = useEditStore()

// ============================================================================
// Adjustment Configuration
// ============================================================================

/**
 * Configuration for each adjustment slider.
 * Same as global adjustments but excluding toneCurve.
 */
interface AdjustmentConfig {
  key: keyof MaskAdjustments
  label: string
  min: number
  max: number
  step?: number
}

/**
 * Configuration for a group of adjustments.
 */
interface AdjustmentGroup {
  name: string
  sliders: AdjustmentConfig[]
}

/**
 * Mask adjustments organized into groups.
 */
const adjustmentGroups: AdjustmentGroup[] = [
  {
    name: 'White Balance',
    sliders: [
      { key: 'temperature', label: 'Temp', min: -100, max: 100 },
      { key: 'tint', label: 'Tint', min: -100, max: 100 },
    ],
  },
  {
    name: 'Tone',
    sliders: [
      { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
      { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
      { key: 'whites', label: 'Whites', min: -100, max: 100 },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
    ],
  },
  {
    name: 'Presence',
    sliders: [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    ],
  },
]

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle adjustment change from slider.
 */
function handleAdjustmentChange(key: keyof MaskAdjustments, value: number): void {
  if (editStore.selectedMaskId) {
    editStore.setMaskAdjustment(editStore.selectedMaskId, key, value)
  }
}

/**
 * Get current value for an adjustment.
 * Returns 0 if no mask is selected or key isn't set.
 */
function getAdjustmentValue(key: keyof MaskAdjustments): number {
  if (!editStore.selectedMask) return 0
  return editStore.selectedMask.mask.adjustments[key] ?? 0
}

/**
 * Reset all adjustments for the selected mask.
 */
function handleResetMaskAdjustments(): void {
  if (editStore.selectedMaskId) {
    editStore.setMaskAdjustments(editStore.selectedMaskId, {})
  }
}
</script>

<template>
  <div>
    <!-- Selected mask adjustments -->
    <div
      v-if="editStore.selectedMask"
      class="space-y-4"
      data-testid="mask-adjustments"
    >
      <!-- Header with reset button -->
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Mask Adjustments
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-heroicons-arrow-path"
          data-testid="reset-mask-adjustments"
          @click="handleResetMaskAdjustments"
        >
          Reset
        </UButton>
      </div>

      <!-- Adjustment groups -->
      <div
        v-for="group in adjustmentGroups"
        :key="group.name"
      >
        <!-- Group header -->
        <div class="text-xs font-medium text-gray-600 mb-2">
          {{ group.name }}
        </div>
        <!-- Group sliders -->
        <div class="space-y-0.5">
          <EditAdjustmentSlider
            v-for="adj in group.sliders"
            :key="adj.key"
            :label="adj.label"
            :model-value="getAdjustmentValue(adj.key)"
            :min="adj.min"
            :max="adj.max"
            :step="adj.step"
            :data-testid="`mask-slider-${adj.key}`"
            @update:model-value="handleAdjustmentChange(adj.key, $event)"
          />
        </div>
      </div>
    </div>

    <!-- No mask selected -->
    <div
      v-else
      class="text-sm text-gray-500 text-center py-4"
      data-testid="mask-adjustments-empty"
    >
      Select a mask to edit its adjustments
    </div>
  </div>
</template>
