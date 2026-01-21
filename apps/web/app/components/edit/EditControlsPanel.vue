<script setup lang="ts">
/**
 * EditControlsPanel Component
 *
 * Right panel in edit view containing:
 * - Basic Adjustments (10 sliders)
 * - Tone Curve (placeholder)
 * - Crop & Transform (placeholder)
 */
import type { Adjustments } from '@literoom/core/catalog'

interface Props {
  /** The asset ID being edited */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Stores
// ============================================================================

const editStore = useEditStore()
const _catalogStore = useCatalogStore()

// ============================================================================
// Computed
// ============================================================================

// Prefixed with _ because it's not currently used but will be needed for future features
const _asset = computed(() => _catalogStore.assets.get(props.assetId))

// ============================================================================
// Adjustment Configuration
// ============================================================================

/**
 * Numeric adjustment keys (excludes toneCurve).
 */
type NumericAdjustmentKey = Exclude<keyof Adjustments, 'toneCurve'>

/**
 * Configuration for each adjustment slider.
 * Key maps to numeric Adjustments interface properties only.
 */
interface AdjustmentConfig {
  key: NumericAdjustmentKey
  label: string
  min: number
  max: number
  step?: number
}

const adjustmentConfig: AdjustmentConfig[] = [
  { key: 'temperature', label: 'Temp', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
]

// ============================================================================
// Accordion Configuration
// ============================================================================

const accordionItems = [
  { value: 'basic', label: 'Basic', slot: 'basic' },
  { value: 'tonecurve', label: 'Tone Curve', slot: 'tonecurve' },
  { value: 'crop', label: 'Crop & Transform', slot: 'crop' },
]

/**
 * Track expanded accordion sections.
 * Basic is expanded by default.
 */
const expandedSections = ref<string[]>(['basic'])

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle adjustment change from slider.
 */
function handleAdjustmentChange(key: NumericAdjustmentKey, value: number) {
  editStore.setAdjustment(key, value)
}

/**
 * Reset all adjustments to defaults.
 */
function handleReset() {
  editStore.reset()
}
</script>

<template>
  <div
    class="p-4 space-y-4"
    data-testid="edit-controls-panel"
  >
    <!-- Header with reset -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">
        Edit
      </h2>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-heroicons-arrow-path"
        :disabled="!editStore.hasModifications"
        data-testid="reset-adjustments"
        @click="handleReset"
      >
        Reset
      </UButton>
    </div>

    <!-- Accordion for grouped controls -->
    <UAccordion
      v-model="expandedSections"
      type="multiple"
      :items="accordionItems"
    >
      <!-- Basic Adjustments Section -->
      <template #basic-body>
        <div class="space-y-0.5 pt-2">
          <EditAdjustmentSlider
            v-for="adj in adjustmentConfig"
            :key="adj.key"
            :label="adj.label"
            :model-value="editStore.adjustments[adj.key]"
            :min="adj.min"
            :max="adj.max"
            :step="adj.step"
            :data-testid="`slider-${adj.key}`"
            @update:model-value="handleAdjustmentChange(adj.key, $event)"
          />
        </div>
      </template>

      <!-- Tone Curve Section (Placeholder) -->
      <template #tonecurve-body>
        <div class="py-4 text-center">
          <UIcon
            name="i-heroicons-chart-bar"
            class="w-8 h-8 text-gray-600 mx-auto mb-2"
          />
          <p class="text-sm text-gray-500">
            Tone curve coming in Phase 11
          </p>
        </div>
      </template>

      <!-- Crop & Transform Section (Placeholder) -->
      <template #crop-body>
        <div class="py-4 text-center">
          <UIcon
            name="i-heroicons-scissors"
            class="w-8 h-8 text-gray-600 mx-auto mb-2"
          />
          <p class="text-sm text-gray-500">
            Crop & transform coming in Phase 12
          </p>
        </div>
      </template>
    </UAccordion>

    <!-- Dirty indicator -->
    <div
      v-if="editStore.isDirty"
      class="text-xs text-yellow-500 flex items-center gap-1"
    >
      <UIcon
        name="i-heroicons-pencil"
        class="w-3 h-3"
      />
      <span>Unsaved changes</span>
    </div>

    <!-- Error indicator -->
    <div
      v-if="editStore.error"
      class="text-xs text-red-500 flex items-center gap-1"
    >
      <UIcon
        name="i-heroicons-exclamation-triangle"
        class="w-3 h-3"
      />
      <span>{{ editStore.error }}</span>
    </div>
  </div>
</template>
