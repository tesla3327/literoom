<script setup lang="ts">
/**
 * EditCropActionBar Component
 *
 * Action bar displayed when the crop tool is active.
 * Provides Apply, Cancel, and Reset buttons for crop confirmation workflow.
 */

// ============================================================================
// Stores
// ============================================================================

const editUIStore = useEditUIStore()
const editStore = useEditStore()

// ============================================================================
// Computed
// ============================================================================

/**
 * Whether there's an existing crop in the edit store.
 * Used to determine if the Reset button should be shown.
 */
const hasExistingCrop = computed(() =>
  editStore.cropTransform.crop !== null,
)

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Apply the pending crop to the edit store.
 */
function handleApply() {
  editUIStore.applyPendingCrop()
}

/**
 * Cancel and discard the pending crop changes.
 */
function handleCancel() {
  editUIStore.cancelPendingCrop()
}

/**
 * Reset the pending crop to full image (no crop).
 */
function handleReset() {
  editUIStore.resetPendingCrop()
}
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 px-4 py-2 bg-gray-800/95 backdrop-blur rounded-lg shadow-lg border border-gray-700"
    data-testid="crop-action-bar"
  >
    <!-- Instructions -->
    <div class="flex items-center gap-2 text-sm text-gray-300">
      <UIcon
        name="i-heroicons-scissors"
        class="w-4 h-4 text-blue-400"
      />
      <span>Adjust crop region, then confirm</span>
    </div>

    <!-- Action buttons -->
    <div class="flex items-center gap-2">
      <!-- Reset button (only shown when there's an existing crop) -->
      <UButton
        v-if="hasExistingCrop"
        size="sm"
        variant="ghost"
        color="neutral"
        data-testid="crop-reset-button"
        @click="handleReset"
      >
        Reset
      </UButton>

      <!-- Cancel button -->
      <UButton
        size="sm"
        variant="soft"
        color="neutral"
        data-testid="crop-cancel-button"
        @click="handleCancel"
      >
        Cancel
      </UButton>

      <!-- Apply button -->
      <UButton
        size="sm"
        color="primary"
        data-testid="crop-apply-button"
        @click="handleApply"
      >
        Set Crop
      </UButton>
    </div>
  </div>
</template>
