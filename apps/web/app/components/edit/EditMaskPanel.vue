<script setup lang="ts">
/**
 * EditMaskPanel Component
 *
 * Displays list of local adjustment masks with controls to:
 * - Add new linear/radial gradient masks
 * - Select/delete existing masks
 * - Toggle mask visibility (enabled/disabled)
 * - Show drawing mode indicator when creating new masks
 */

const editStore = useEditStore()
const editUIStore = useEditUIStore()

// ============================================================================
// Computed
// ============================================================================

/**
 * Combined list of all masks with type annotation.
 */
const allMasks = computed(() => {
  if (!editStore.masks) return []
  return [
    ...editStore.masks.linearMasks.map(m => ({ type: 'linear' as const, mask: m })),
    ...editStore.masks.radialMasks.map(m => ({ type: 'radial' as const, mask: m })),
  ]
})

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Start drawing a linear gradient mask.
 */
function handleAddLinear(): void {
  editUIStore.setMaskDrawingMode('linear')
}

/**
 * Start drawing a radial gradient mask.
 */
function handleAddRadial(): void {
  editUIStore.setMaskDrawingMode('radial')
}

/**
 * Select a mask for editing.
 */
function handleSelectMask(id: string): void {
  editStore.selectMask(id)
}

/**
 * Toggle a mask's enabled state.
 */
function handleToggleMask(id: string): void {
  editStore.toggleMaskEnabled(id)
}

/**
 * Delete a mask.
 */
function handleDeleteMask(id: string): void {
  editStore.deleteMask(id)
}

/**
 * Cancel drawing mode.
 */
function handleCancelDrawing(): void {
  editUIStore.cancelMaskDrawing()
}
</script>

<template>
  <div class="space-y-3">
    <!-- Add mask buttons -->
    <div class="flex gap-2">
      <UButton
        size="xs"
        variant="outline"
        :disabled="!!editUIStore.maskDrawingMode"
        data-testid="add-linear-mask"
        @click="handleAddLinear"
      >
        <UIcon
          name="i-heroicons-minus"
          class="w-3 h-3 mr-1"
        />
        Linear
      </UButton>
      <UButton
        size="xs"
        variant="outline"
        :disabled="!!editUIStore.maskDrawingMode"
        data-testid="add-radial-mask"
        @click="handleAddRadial"
      >
        <UIcon
          name="i-heroicons-stop"
          class="w-3 h-3 mr-1"
        />
        Radial
      </UButton>
    </div>

    <!-- Mask list -->
    <div
      v-if="allMasks.length > 0"
      class="space-y-1"
      data-testid="mask-list"
    >
      <div
        v-for="{ type, mask } in allMasks"
        :key="mask.id"
        class="flex items-center gap-2 p-2 rounded cursor-pointer transition-colors"
        :class="{
          'bg-gray-800 ring-1 ring-blue-500': editStore.selectedMaskId === mask.id,
          'hover:bg-gray-800/50': editStore.selectedMaskId !== mask.id,
        }"
        :data-testid="`mask-item-${mask.id}`"
        @click="handleSelectMask(mask.id)"
      >
        <!-- Visibility toggle -->
        <button
          class="p-1 rounded hover:bg-gray-700 transition-colors"
          :title="mask.enabled ? 'Hide mask' : 'Show mask'"
          :data-testid="`mask-toggle-${mask.id}`"
          @click.stop="handleToggleMask(mask.id)"
        >
          <UIcon
            :name="mask.enabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            class="w-4 h-4"
            :class="mask.enabled ? 'text-gray-300' : 'text-gray-600'"
          />
        </button>

        <!-- Mask type icon and name -->
        <UIcon
          :name="type === 'linear' ? 'i-heroicons-minus' : 'i-heroicons-stop'"
          class="w-4 h-4 text-gray-400"
        />
        <span class="flex-1 text-sm text-gray-300">
          {{ type === 'linear' ? 'Linear' : 'Radial' }} Mask
        </span>

        <!-- Delete button -->
        <button
          class="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors"
          title="Delete mask"
          :data-testid="`mask-delete-${mask.id}`"
          @click.stop="handleDeleteMask(mask.id)"
        >
          <UIcon
            name="i-heroicons-trash"
            class="w-4 h-4"
          />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!editUIStore.maskDrawingMode"
      class="text-sm text-gray-500 text-center py-4"
      data-testid="mask-empty-state"
    >
      No masks yet. Click a button above to add one.
    </div>

    <!-- Drawing mode indicator -->
    <div
      v-if="editUIStore.maskDrawingMode"
      class="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30"
      data-testid="mask-drawing-indicator"
    >
      <div class="text-sm text-blue-400 flex items-center gap-2">
        <UIcon
          name="i-heroicons-cursor-arrow-rays"
          class="w-4 h-4 animate-pulse"
        />
        <span>Click and drag on the image to create a {{ editUIStore.maskDrawingMode }} gradient</span>
      </div>
      <div class="mt-2 flex justify-end">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          data-testid="cancel-mask-drawing"
          @click="handleCancelDrawing"
        >
          Cancel
        </UButton>
      </div>
    </div>
  </div>
</template>
