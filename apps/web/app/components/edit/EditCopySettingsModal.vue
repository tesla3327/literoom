<script setup lang="ts">
/**
 * EditCopySettingsModal Component
 *
 * Modal for selecting which settings to copy from the current photo.
 * Groups are organized by type with checkboxes for each.
 *
 * Features:
 * - Checkbox groups for Basic Adjustments, Tone Curve, Crop, Rotation
 * - Preset buttons: All, None
 * - Crop/Rotation excluded by default for safety
 * - Copy button to confirm selection
 */

const { showCopyModal, selectedGroups, hasSelectedGroups, copySettings, closeCopyModal, toggleGroup, selectAllGroups, selectNoGroups } = useCopyPasteSettings()

const clipboardStore = useEditClipboardStore()

/**
 * Handle copy button click.
 */
function handleCopy() {
  copySettings()
}

/**
 * Handle cancel button click.
 */
function handleCancel() {
  closeCopyModal()
}
</script>

<template>
  <UModal
    v-model:open="clipboardStore.showCopyModal"
    :dismissible="true"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <h2 class="text-lg font-semibold text-white">
          Copy Settings
        </h2>
        <div class="flex gap-2">
          <UButton
            size="xs"
            variant="ghost"
            @click="selectAllGroups"
          >
            All
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            @click="selectNoGroups"
          >
            None
          </UButton>
        </div>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Basic Adjustments Group -->
        <label class="flex items-start gap-3 cursor-pointer hover:bg-gray-900/50 p-2 -mx-2 rounded-lg transition-colors">
          <UCheckbox
            :model-value="selectedGroups.basicAdjustments"
            class="mt-0.5"
            @update:model-value="toggleGroup('basicAdjustments')"
          />
          <div>
            <span class="font-medium text-white">Basic Adjustments</span>
            <p class="text-sm text-gray-500 mt-0.5">
              Exposure, Contrast, Temperature, Tint, Highlights, Shadows, Whites, Blacks, Vibrance, Saturation
            </p>
          </div>
        </label>

        <!-- Tone Curve Group -->
        <label class="flex items-start gap-3 cursor-pointer hover:bg-gray-900/50 p-2 -mx-2 rounded-lg transition-colors">
          <UCheckbox
            :model-value="selectedGroups.toneCurve"
            class="mt-0.5"
            @update:model-value="toggleGroup('toneCurve')"
          />
          <div>
            <span class="font-medium text-white">Tone Curve</span>
            <p class="text-sm text-gray-500 mt-0.5">
              Curve control points
            </p>
          </div>
        </label>

        <!-- Divider for geometry settings -->
        <div class="border-t border-gray-800 pt-2 mt-2">
          <p class="text-xs text-gray-500 mb-2 uppercase tracking-wider">
            Geometry (excluded by default)
          </p>
        </div>

        <!-- Crop Group -->
        <label class="flex items-start gap-3 cursor-pointer hover:bg-gray-900/50 p-2 -mx-2 rounded-lg transition-colors">
          <UCheckbox
            :model-value="selectedGroups.crop"
            class="mt-0.5"
            @update:model-value="toggleGroup('crop')"
          />
          <div>
            <span class="font-medium text-white">Crop</span>
            <p class="text-sm text-gray-500 mt-0.5">
              Crop rectangle position and size
            </p>
          </div>
        </label>

        <!-- Rotation Group -->
        <label class="flex items-start gap-3 cursor-pointer hover:bg-gray-900/50 p-2 -mx-2 rounded-lg transition-colors">
          <UCheckbox
            :model-value="selectedGroups.rotation"
            class="mt-0.5"
            @update:model-value="toggleGroup('rotation')"
          />
          <div>
            <span class="font-medium text-white">Rotation</span>
            <p class="text-sm text-gray-500 mt-0.5">
              Rotation angle and straighten
            </p>
          </div>
        </label>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          variant="ghost"
          @click="handleCancel"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :disabled="!hasSelectedGroups"
          @click="handleCopy"
        >
          Copy
        </UButton>
      </div>
    </template>
  </UModal>
</template>
