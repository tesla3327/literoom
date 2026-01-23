<script setup lang="ts">
/**
 * ExportModal Component
 *
 * Modal dialog for configuring and running photo exports.
 *
 * Features:
 * - Destination folder selection
 * - Filename template with token support
 * - Export scope (Picks / Selected / All)
 * - JPEG quality slider
 * - Resize options (long edge presets)
 * - Progress display during export
 */
import { validateTemplate } from '@literoom/core/export'
import { RESIZE_PRESETS } from '~/stores/export'
import type { ExportScope } from '@literoom/core/export'

const exportStore = useExportStore()
const { getAssetsToExport, selectDestination, runExport, exportCount } = useExport()

// ============================================================================
// Computed
// ============================================================================

/**
 * Validation errors for the filename template.
 */
const templateErrors = computed(() => {
  return validateTemplate(exportStore.filenameTemplate)
})

/**
 * Whether the form is valid and ready for export.
 */
const canExport = computed(() => {
  return (
    exportStore.isValid
    && templateErrors.value.length === 0
    && exportCount.value > 0
    && !exportStore.isExporting
  )
})

/**
 * Scope options for display.
 */
const scopeOptions: Array<{ value: ExportScope, label: string }> = [
  { value: 'picks', label: 'Picks' },
  { value: 'selected', label: 'Selected' },
  { value: 'all', label: 'All' },
]

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle destination folder selection.
 */
async function handleSelectDestination() {
  await selectDestination()
}

/**
 * Handle scope button click.
 */
function handleScopeChange(scope: ExportScope) {
  exportStore.scope = scope
}

/**
 * Handle resize option change.
 */
function handleResizeChange(value: number) {
  exportStore.resizeLongEdge = value
}

/**
 * Handle export button click.
 */
async function handleExport() {
  await runExport()
}

/**
 * Handle cancel button click.
 */
function handleCancel() {
  exportStore.closeModal()
}
</script>

<template>
  <UModal
    v-model:open="exportStore.isModalOpen"
    :dismissible="!exportStore.isExporting"
    data-testid="export-modal"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-heroicons-arrow-up-tray"
          class="w-5 h-5 text-gray-400"
        />
        <h2 class="text-lg font-semibold text-white">
          Export Images
        </h2>
      </div>
    </template>

    <template #body>
      <div class="space-y-6">
        <!-- Destination Folder -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Destination Folder
          </label>
          <div class="flex gap-2">
            <div
              class="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm truncate"
              :class="[
                exportStore.destinationName ? 'text-white' : 'text-gray-500',
              ]"
            >
              {{ exportStore.destinationName || 'No folder selected' }}
            </div>
            <UButton
              :disabled="exportStore.isExporting"
              @click="handleSelectDestination"
            >
              Choose Folder
            </UButton>
          </div>
        </div>

        <!-- Filename Template -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Filename Template
          </label>
          <input
            v-model="exportStore.filenameTemplate"
            type="text"
            :disabled="exportStore.isExporting"
            class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-500"
            :class="{ 'border-red-500': templateErrors.length > 0 }"
            placeholder="{orig}_{seq:4}"
            data-testid="export-filename-template"
          >
          <p class="mt-1.5 text-xs text-gray-500">
            Tokens: <code class="text-gray-400">{orig}</code> = original name,
            <code class="text-gray-400">{seq:4}</code> = sequence with padding,
            <code class="text-gray-400">{date}</code> = capture date
          </p>
          <p
            v-if="templateErrors.length > 0"
            class="mt-1 text-xs text-red-400"
          >
            {{ templateErrors[0]?.message }}
          </p>
        </div>

        <!-- Export Scope -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Export Scope
          </label>
          <div class="flex gap-1 p-1 bg-gray-900 rounded-lg">
            <button
              v-for="option in scopeOptions"
              :key="option.value"
              :disabled="exportStore.isExporting"
              class="flex-1 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="[
                exportStore.scope === option.value
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white',
              ]"
              :data-testid="`export-scope-${option.value}`"
              @click="handleScopeChange(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <p
            class="mt-2 text-sm text-gray-400"
            data-testid="export-count"
          >
            {{ exportCount }} image{{ exportCount === 1 ? '' : 's' }} will be exported
          </p>
        </div>

        <!-- JPEG Quality -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            JPEG Quality: <span class="text-white">{{ exportStore.quality }}</span>
          </label>
          <USlider
            v-model="exportStore.quality"
            :min="50"
            :max="100"
            :step="5"
            :disabled="exportStore.isExporting"
          />
        </div>

        <!-- Resize Option -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Resize (Long Edge)
          </label>
          <div class="flex flex-wrap gap-1 p-1 bg-gray-900 rounded-lg">
            <button
              v-for="preset in RESIZE_PRESETS"
              :key="preset.value"
              :disabled="exportStore.isExporting"
              class="flex-1 min-w-fit px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="[
                exportStore.resizeLongEdge === preset.value
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white',
              ]"
              @click="handleResizeChange(preset.value)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <!-- Progress Bar (shown during export) -->
        <div
          v-if="exportStore.progress"
          class="space-y-2"
        >
          <div class="flex justify-between text-sm">
            <span class="text-gray-400">
              Exporting {{ exportStore.progress.current }} of {{ exportStore.progress.total }}
            </span>
            <span class="text-gray-300">
              {{ exportStore.progressPercent }}%
            </span>
          </div>
          <div class="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-blue-500 transition-all duration-300"
              :style="{ width: `${exportStore.progressPercent}%` }"
            />
          </div>
          <p class="text-xs text-gray-500 truncate">
            {{ exportStore.progress.currentFilename }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          variant="ghost"
          :disabled="exportStore.isExporting"
          data-testid="export-cancel-button"
          @click="handleCancel"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :disabled="!canExport"
          :loading="exportStore.isExporting"
          data-testid="export-submit-button"
          @click="handleExport"
        >
          Export {{ exportCount }} Image{{ exportCount === 1 ? '' : 's' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
