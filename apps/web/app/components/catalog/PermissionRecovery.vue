<script setup lang="ts">
/**
 * PermissionRecovery Component
 *
 * Modal for re-authorizing folders when permissions are lost.
 * This happens when the app is reopened and stored folder handles
 * need to be re-authorized (browser security requirement).
 *
 * Features:
 * - Non-dismissible modal (user must take action)
 * - Lists all folders with permission issues
 * - Re-authorize button per folder (requires user gesture)
 * - Actions: Choose Different Folder, Retry All, Continue
 */

const permissionStore = usePermissionRecoveryStore()

// Emits for parent component actions
const emit = defineEmits<{
  /** Emitted when user wants to select a new folder */
  selectNewFolder: []
  /** Emitted when user chooses to continue with accessible folders */
  continue: []
  /** Emitted when a folder is successfully re-authorized */
  reauthorized: [folderId: string]
}>()

/**
 * Handle re-authorize button click for a specific folder.
 * This must be called from a user gesture (button click).
 */
async function handleReauthorize(folderId: string) {
  const handle = await permissionStore.reauthorizeFolder(folderId)
  if (handle) {
    emit('reauthorized', folderId)
  }
}

/**
 * Handle "Choose Different Folder" action.
 */
function handleSelectNewFolder() {
  permissionStore.clearIssues()
  emit('selectNewFolder')
}

/**
 * Handle "Continue" action.
 */
function handleContinue() {
  permissionStore.closeModal()
  emit('continue')
}

/**
 * Get the badge color based on permission state.
 * Uses Nuxt UI 4 color scheme: warning (yellow) for prompt, error (red) for denied.
 */
function getBadgeColor(state: 'prompt' | 'denied'): 'warning' | 'error' {
  return state === 'prompt' ? 'warning' : 'error'
}

/**
 * Get the badge label based on permission state.
 */
function getBadgeLabel(state: 'prompt' | 'denied'): string {
  return state === 'prompt' ? 'Needs permission' : 'Denied'
}
</script>

<template>
  <UModal
    v-model:open="permissionStore.showModal"
    :dismissible="false"
  >
    <template #header>
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-semibold text-white">
          Folder Access Required
        </h2>
        <p class="text-sm text-gray-400">
          The following folders need to be re-authorized to continue editing.
        </p>
      </div>
    </template>

    <template #body>
      <!-- Error message -->
      <div
        v-if="permissionStore.error"
        class="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
      >
        <p class="text-sm text-red-400">
          {{ permissionStore.error }}
        </p>
      </div>

      <!-- Folder list -->
      <div class="space-y-2">
        <div
          v-for="issue in permissionStore.folderIssues"
          :key="issue.folderId"
          class="flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-800"
        >
          <!-- Folder info -->
          <div class="flex-1 min-w-0 mr-3">
            <p class="font-medium text-white truncate">
              {{ issue.folderName }}
            </p>
            <p class="text-sm text-gray-500 truncate">
              {{ issue.folderPath }}
            </p>
            <p
              v-if="issue.error"
              class="text-xs text-red-400 mt-1"
            >
              {{ issue.error }}
            </p>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <UBadge
              :color="getBadgeColor(issue.permissionState)"
              size="sm"
            >
              {{ getBadgeLabel(issue.permissionState) }}
            </UBadge>
            <UButton
              size="sm"
              :loading="permissionStore.isRechecking"
              @click="handleReauthorize(issue.folderId)"
            >
              Re-authorize
            </UButton>
          </div>
        </div>
      </div>

      <!-- Empty state (shouldn't happen, but just in case) -->
      <div
        v-if="permissionStore.folderIssues.length === 0"
        class="text-center py-8"
      >
        <p class="text-gray-500">
          No permission issues found.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <!-- Left action -->
        <UButton
          variant="ghost"
          @click="handleSelectNewFolder"
        >
          Choose Different Folder
        </UButton>

        <!-- Right actions -->
        <div class="flex items-center gap-2">
          <UButton
            variant="ghost"
            :loading="permissionStore.isRechecking"
            :disabled="permissionStore.folderIssues.length === 0"
            @click="permissionStore.retryAll"
          >
            Retry All
          </UButton>
          <UButton
            color="primary"
            :disabled="permissionStore.accessibleCount === 0"
            @click="handleContinue"
          >
            Continue
            <template v-if="permissionStore.accessibleCount > 0">
              ({{ permissionStore.accessibleCount }} accessible)
            </template>
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
