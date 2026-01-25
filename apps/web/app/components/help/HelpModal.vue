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

interface Shortcut {
  label: string
  keys: string[]
}

interface Section {
  title: string
  shortcuts: Shortcut[]
  border?: boolean
}

interface Column {
  title: string
  sections: Section[]
}

const helpStore = useHelpStore()

// ============================================================================
// Platform Detection
// ============================================================================

const isMac = computed(() =>
  typeof navigator !== 'undefined'
  && /Mac|iPod|iPhone|iPad/.test(navigator.platform),
)

const modKey = computed(() => isMac.value ? 'Cmd' : 'Ctrl')

// ============================================================================
// Shortcut Data
// ============================================================================

const columns = computed<Column[]>(() => [
  {
    title: 'Grid View',
    sections: [
      {
        title: 'Navigation',
        shortcuts: [
          { label: 'Navigate grid', keys: ['Arrow Keys'] },
        ],
      },
      {
        title: 'Flagging',
        shortcuts: [
          { label: 'Pick (flag)', keys: ['P'] },
          { label: 'Reject', keys: ['X'] },
          { label: 'Unflag', keys: ['U'] },
        ],
      },
      {
        title: 'Views',
        shortcuts: [
          { label: 'Enter Edit view', keys: ['E', 'Enter', 'D'] },
          { label: 'Grid view', keys: ['G'] },
        ],
      },
      {
        title: 'Selection',
        shortcuts: [
          { label: 'Range select', keys: ['Shift+Click'] },
          { label: 'Toggle select', keys: [`${modKey.value}+Click`] },
        ],
      },
      {
        title: 'Actions',
        shortcuts: [
          { label: 'Delete photo', keys: ['Delete'] },
          { label: 'Export', keys: [modKey.value, 'E'] },
        ],
      },
    ],
  },
  {
    title: 'Edit View',
    sections: [
      {
        title: 'Navigation',
        shortcuts: [
          { label: 'Previous/Next photo', keys: ['Left/Right'] },
          { label: 'Return to grid', keys: ['Esc', 'G'] },
        ],
      },
      {
        title: 'Editing',
        shortcuts: [
          { label: 'Copy settings', keys: [modKey.value, 'Shift', 'C'] },
          { label: 'Paste settings', keys: [modKey.value, 'Shift', 'V'] },
        ],
      },
      {
        title: 'Display',
        shortcuts: [
          { label: 'Toggle clipping overlay', keys: ['J'] },
        ],
      },
      {
        title: 'Zoom',
        shortcuts: [
          { label: 'Toggle fit/100%', keys: ['Z'] },
          { label: 'Fit to view', keys: [modKey.value, '0'] },
          { label: '100% zoom', keys: [modKey.value, '1'] },
          { label: 'Zoom in', keys: [modKey.value, '+'] },
          { label: 'Zoom out', keys: [modKey.value, '-'] },
          { label: 'Pan (when zoomed)', keys: ['Space+Drag'] },
        ],
      },
      {
        title: 'Mask Editing',
        shortcuts: [
          { label: 'Cancel drawing', keys: ['Esc'] },
          { label: 'Delete selected mask', keys: ['Delete'] },
        ],
      },
      {
        title: 'Help',
        border: true,
        shortcuts: [
          { label: 'Show this help', keys: ['?'] },
        ],
      },
    ],
  },
])

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
        <div
          v-for="column in columns"
          :key="column.title"
          class="space-y-4"
        >
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {{ column.title }}
          </h3>

          <div
            v-for="section in column.sections"
            :key="section.title"
            :class="{ 'pt-4 border-t border-gray-700/50': section.border }"
          >
            <h4 class="text-xs font-medium text-gray-500 mb-2">
              {{ section.title }}
            </h4>
            <div class="space-y-2">
              <div
                v-for="shortcut in section.shortcuts"
                :key="shortcut.label"
                class="flex justify-between"
              >
                <span class="text-gray-300">{{ shortcut.label }}</span>
                <span class="text-gray-400">
                  <template
                    v-for="(key, i) in shortcut.keys"
                    :key="key"
                  >
                    <template v-if="i > 0">
                      {{ shortcut.keys.length > 2 ? '+' : ' / ' }}
                    </template>
                    <kbd class="kbd">{{ key }}</kbd>
                  </template>
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
