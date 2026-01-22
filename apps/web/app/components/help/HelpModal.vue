<script setup lang="ts">
/**
 * HelpModal Component
 *
 * Displays a modal with all keyboard shortcuts documented.
 * Triggered by pressing `?` or `Cmd/Ctrl+/`.
 *
 * Features:
 * - Two-column layout (Grid View | Edit View)
 * - Grouped sections for navigation, flagging, etc.
 * - Platform-aware modifier keys (Cmd on Mac, Ctrl on Windows/Linux)
 */

const helpStore = useHelpStore()

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect if running on macOS.
 */
const isMac = computed(() =>
  typeof navigator !== 'undefined'
  && /Mac|iPod|iPhone|iPad/.test(navigator.platform),
)

/**
 * Get the correct modifier key for the platform.
 */
const modKey = computed(() => isMac.value ? 'Cmd' : 'Ctrl')

// ============================================================================
// Event Handlers
// ============================================================================

function handleClose() {
  helpStore.closeModal()
}
</script>

<template>
  <UModal
    v-model:open="helpStore.isModalOpen"
    :dismissible="true"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-heroicons-question-mark-circle"
          class="w-5 h-5 text-gray-400"
        />
        <h2 class="text-lg font-semibold text-white">
          Keyboard Shortcuts
        </h2>
      </div>
    </template>

    <template #body>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
        <!-- Grid View Column -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Grid View
          </h3>

          <!-- Navigation -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Navigation
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Navigate grid</span>
                <span class="text-gray-400">
                  <kbd class="kbd">Arrow Keys</kbd>
                </span>
              </div>
            </div>
          </div>

          <!-- Flagging -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Flagging
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Pick (flag)</span>
                <span class="text-gray-400"><kbd class="kbd">P</kbd></span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Reject</span>
                <span class="text-gray-400"><kbd class="kbd">X</kbd></span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Unflag</span>
                <span class="text-gray-400"><kbd class="kbd">U</kbd></span>
              </div>
            </div>
          </div>

          <!-- View Switching -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Views
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Enter Edit view</span>
                <span class="text-gray-400">
                  <kbd class="kbd">E</kbd> / <kbd class="kbd">Enter</kbd> / <kbd class="kbd">D</kbd>
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Grid view</span>
                <span class="text-gray-400"><kbd class="kbd">G</kbd></span>
              </div>
            </div>
          </div>

          <!-- Selection -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Selection
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Range select</span>
                <span class="text-gray-400">
                  <kbd class="kbd">Shift</kbd>+Click
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Toggle select</span>
                <span class="text-gray-400">
                  <kbd class="kbd">{{ modKey }}</kbd>+Click
                </span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Actions
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Delete photo</span>
                <span class="text-gray-400"><kbd class="kbd">Delete</kbd></span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Export</span>
                <span class="text-gray-400">
                  <kbd class="kbd">{{ modKey }}</kbd>+<kbd class="kbd">E</kbd>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Edit View Column -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Edit View
          </h3>

          <!-- Navigation -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Navigation
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Previous/Next photo</span>
                <span class="text-gray-400">
                  <kbd class="kbd">Left/Right</kbd>
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Return to grid</span>
                <span class="text-gray-400">
                  <kbd class="kbd">Esc</kbd> / <kbd class="kbd">G</kbd>
                </span>
              </div>
            </div>
          </div>

          <!-- Editing -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Editing
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Copy settings</span>
                <span class="text-gray-400">
                  <kbd class="kbd">{{ modKey }}</kbd>+<kbd class="kbd">Shift</kbd>+<kbd class="kbd">C</kbd>
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Paste settings</span>
                <span class="text-gray-400">
                  <kbd class="kbd">{{ modKey }}</kbd>+<kbd class="kbd">Shift</kbd>+<kbd class="kbd">V</kbd>
                </span>
              </div>
            </div>
          </div>

          <!-- Display -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Display
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Toggle clipping overlay</span>
                <span class="text-gray-400"><kbd class="kbd">J</kbd></span>
              </div>
            </div>
          </div>

          <!-- Mask Editing -->
          <div>
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Mask Editing
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Cancel drawing</span>
                <span class="text-gray-400"><kbd class="kbd">Esc</kbd></span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Delete selected mask</span>
                <span class="text-gray-400"><kbd class="kbd">Delete</kbd></span>
              </div>
            </div>
          </div>

          <!-- Help -->
          <div class="pt-4 border-t border-gray-700/50">
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              Help
            </h4>
            <div class="space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">Show this help</span>
                <span class="text-gray-400">
                  <kbd class="kbd">?</kbd>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end w-full">
        <UButton
          variant="ghost"
          @click="handleClose"
        >
          Close
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.kbd {
  padding: 0.125rem 0.375rem;
  background-color: rgb(31 41 55);
  border: 1px solid rgb(75 85 99);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  line-height: 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  color: rgb(229 231 235);
}
</style>
