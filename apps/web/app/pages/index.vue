<script setup lang="ts">
/**
 * Main Catalog Page
 *
 * Integrates all catalog components:
 * - PermissionRecovery modal for re-authorization
 * - FilterBar for filtering and sorting
 * - CatalogGrid with virtual scrolling thumbnails
 *
 * Uses the useCatalog composable for service access.
 */

// ============================================================================
// Stores and Composables
// ============================================================================

const catalogStore = useCatalogStore()
const selectionStore = useSelectionStore()
const permissionStore = usePermissionRecoveryStore()
const { selectFolder, restoreSession, isDemoMode } = useCatalog()

// ============================================================================
// State
// ============================================================================

const isLoading = ref(false)
const scanError = ref<string | null>(null)

// ============================================================================
// Computed
// ============================================================================

const hasFolder = computed(() => catalogStore.folderPath !== null)
const hasAssets = computed(() => catalogStore.assetIds.length > 0)
const folderName = computed(() => {
  const path = catalogStore.folderPath
  if (!path) return null
  return path.split('/').pop() || path
})

// ============================================================================
// Folder Selection
// ============================================================================

/**
 * Handle folder selection.
 */
async function handleSelectFolder() {
  isLoading.value = true
  scanError.value = null

  try {
    await selectFolder()
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('cancelled')) {
      // User cancelled - don't show error
    }
    else {
      scanError.value = error instanceof Error ? error.message : 'Failed to select folder'
    }
  }
  finally {
    isLoading.value = false
  }
}

// ============================================================================
// Permission Recovery
// ============================================================================

/**
 * Handle successful folder re-authorization.
 */
async function handleReauthorized(_folderId: string) {
  // Re-scan after re-authorization
  await handleSelectFolder()
}

/**
 * Handle continue from permission recovery.
 */
function handleContinue() {
  // Continue with whatever is currently loaded
}

// ============================================================================
// App Initialization
// ============================================================================

/**
 * Initialize app and restore session if possible.
 */
async function initializeApp() {
  try {
    const restored = await restoreSession()
    if (!restored && !isDemoMode) {
      // Session restoration failed - may need permission recovery
      // This is handled by the restoreSession function internally
    }
  }
  catch (error) {
    // Start fresh if restoration fails
    console.warn('Session restoration failed:', error)
  }
}

// Initialize on client-side mount
onMounted(() => {
  initializeApp()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-950" data-testid="catalog-page">
    <!-- Permission recovery modal -->
    <PermissionRecovery
      @select-new-folder="handleSelectFolder"
      @continue="handleContinue"
      @reauthorized="handleReauthorized"
    />

    <!-- Welcome screen (no folder selected) -->
    <div v-if="!hasFolder && !isLoading" class="flex-1 flex items-center justify-center p-8" data-testid="welcome-screen">
      <div class="max-w-md text-center">
        <h1 class="text-4xl font-bold">
          Literoom
        </h1>

        <p class="text-gray-400 text-lg mt-4">
          A desktop, offline-first photo culling and editing app.
          Your photos stay local, your edits persist.
        </p>

        <div v-if="isDemoMode" class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p class="text-sm text-blue-400">
            Demo Mode: Using mock data for testing
          </p>
        </div>

        <div class="mt-8 space-y-4">
          <UButton
            size="xl"
            :loading="isLoading"
            data-testid="choose-folder-button"
            @click="handleSelectFolder"
          >
            Choose Folder
          </UButton>

          <p class="text-sm text-gray-500">
            Best experienced in Chrome, Edge, or Brave with File System Access API support.
          </p>
        </div>

        <!-- Error message -->
        <div v-if="scanError" class="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p class="text-sm text-red-400">
            {{ scanError }}
          </p>
        </div>
      </div>
    </div>

    <!-- Loading state during initial scan -->
    <div v-else-if="isLoading && !hasAssets" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-heroicons-folder-open" class="w-12 h-12 text-gray-600 mb-4" />
        <p class="text-gray-400 mb-2">Scanning folder...</p>
        <p v-if="catalogStore.scanProgress" class="text-sm text-gray-500">
          Found {{ catalogStore.scanProgress.totalFound }} files
        </p>
      </div>
    </div>

    <!-- Main catalog view -->
    <div v-else-if="hasFolder" class="flex-1 flex flex-col min-h-0">
      <!-- Header -->
      <header class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div class="flex items-center gap-3">
          <UButton
            variant="ghost"
            icon="i-heroicons-folder"
            size="sm"
            @click="handleSelectFolder"
          >
            {{ folderName }}
          </UButton>

          <!-- Scanning indicator -->
          <div v-if="catalogStore.isScanning" class="flex items-center gap-2 text-sm text-gray-400">
            <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 animate-spin" />
            <span>Scanning...</span>
          </div>
        </div>

        <!-- Selection info -->
        <div v-if="selectionStore.selectionCount > 0" class="text-sm text-gray-400">
          {{ selectionStore.selectionCount }} selected
        </div>
      </header>

      <!-- Filter bar -->
      <FilterBar />

      <!-- Grid or empty state -->
      <div class="flex-1 min-h-0">
        <CatalogGrid v-if="hasAssets" />
        <div v-else class="h-full flex flex-col items-center justify-center text-center">
          <UIcon name="i-heroicons-photo" class="w-16 h-16 text-gray-600 mb-4" />
          <p class="text-gray-500">No supported images found</p>
          <p class="text-sm text-gray-600 mt-2">
            Supported formats: JPEG, Sony ARW
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

