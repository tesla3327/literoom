<script setup lang="ts">
/**
 * EditAdjustmentSlider Component
 *
 * Reusable slider component for photo adjustments.
 * Displays label, slider control, and formatted value.
 */

interface Props {
  /** Display label for the adjustment */
  label: string
  /** Current value */
  modelValue: number
  /** Minimum value */
  min: number
  /** Maximum value */
  max: number
  /** Step increment (default: 1) */
  step?: number
}

const props = withDefaults(defineProps<Props>(), {
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

// ============================================================================
// Value Formatting
// ============================================================================

/**
 * Format the display value with sign prefix.
 * Uses appropriate decimal places based on step size.
 */
const displayValue = computed(() => {
  const val = props.modelValue
  const decimals = props.step < 1 ? 2 : 0

  if (val > 0) {
    return `+${val.toFixed(decimals)}`
  }
  return val.toFixed(decimals)
})

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle slider value change.
 */
function handleUpdate(value: number | undefined) {
  if (value !== undefined) {
    emit('update:modelValue', value)
  }
}

/**
 * Reset value to zero (double-click on label).
 */
function handleDoubleClick() {
  emit('update:modelValue', 0)
}
</script>

<template>
  <div class="flex items-center gap-3 py-1.5 group">
    <!-- Label (double-click to reset) -->
    <span
      class="w-24 text-sm text-gray-400 cursor-pointer select-none hover:text-gray-300"
      :title="`Double-click to reset ${label}`"
      @dblclick="handleDoubleClick"
    >
      {{ label }}
    </span>

    <!-- Slider -->
    <USlider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      class="flex-1"
      size="sm"
      @update:model-value="handleUpdate"
    />

    <!-- Value display -->
    <span
      class="w-14 text-right text-sm font-mono tabular-nums"
      :class="[
        modelValue === 0 ? 'text-gray-500' : 'text-gray-300'
      ]"
    >
      {{ displayValue }}
    </span>
  </div>
</template>
