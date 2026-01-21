<script setup lang="ts">
/**
 * EditControlsPanel Component
 *
 * Placeholder for edit controls panel.
 * Will contain Basic Adjustments, Tone Curve, Crop, etc.
 */

interface Props {
  /** The asset ID being edited */
  assetId: string
}

const props = defineProps<Props>()

// ============================================================================
// Stores
// ============================================================================

const catalogStore = useCatalogStore()

// ============================================================================
// Computed
// ============================================================================

const asset = computed(() => catalogStore.assets.get(props.assetId))
</script>

<template>
  <div class="p-4 space-y-6" data-testid="edit-controls-panel">
    <!-- Header with reset -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Edit</h2>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-heroicons-arrow-path"
        disabled
      >
        Reset
      </UButton>
    </div>

    <!-- Basic Adjustments - Placeholder -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-400">Basic</h3>
        <UIcon name="i-heroicons-chevron-down" class="w-4 h-4 text-gray-500" />
      </div>

      <div class="space-y-2 text-sm text-gray-500">
        <p>Adjustment sliders coming in Phase 8.3</p>
        <ul class="list-disc list-inside text-xs space-y-1">
          <li>Temperature</li>
          <li>Tint</li>
          <li>Exposure</li>
          <li>Contrast</li>
          <li>Highlights</li>
          <li>Shadows</li>
          <li>Whites</li>
          <li>Blacks</li>
          <li>Vibrance</li>
          <li>Saturation</li>
        </ul>
      </div>
    </div>

    <!-- Tone Curve - Placeholder -->
    <div class="space-y-3 pt-4 border-t border-gray-800">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-400">Tone Curve</h3>
        <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-gray-500" />
      </div>
      <p class="text-xs text-gray-600">Coming later</p>
    </div>

    <!-- Crop - Placeholder -->
    <div class="space-y-3 pt-4 border-t border-gray-800">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-400">Crop & Transform</h3>
        <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-gray-500" />
      </div>
      <p class="text-xs text-gray-600">Coming later</p>
    </div>
  </div>
</template>
