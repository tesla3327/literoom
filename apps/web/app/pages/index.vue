<script setup lang="ts">
/**
 * Main Catalog Page
 *
 * Integrates all catalog components:
 * - PermissionRecovery modal for re-authorization
 * - FilterBar for filtering and sorting
 * - CatalogGrid with virtual scrolling thumbnails
 *
 * Handles folder selection and scanning workflow.
 */
import { BrowserFileSystemProvider } from '@literoom/core/filesystem'
import type { DirectoryHandle, FileEntry, FileHandle } from '@literoom/core/filesystem'
import type { Asset } from '@literoom/core/catalog'
import { isSupportedExtension, getExtension, getFilenameWithoutExtension } from '@literoom/core/catalog'

// ============================================================================
// Stores
// ============================================================================

const catalogStore = useCatalogStore()
const selectionStore = useSelectionStore()
const permissionStore = usePermissionRecoveryStore()

// ============================================================================
// State
// ============================================================================

const isLoading = ref(false)
const scanError = ref<string | null>(null)

// File system provider (lazily initialized)
let fsProvider: BrowserFileSystemProvider | null = null

function getProvider(): BrowserFileSystemProvider {
  if (!fsProvider) {
    fsProvider = new BrowserFileSystemProvider()
  }
  return fsProvider
}

// Current folder handle
const currentFolderHandle = ref<DirectoryHandle | null>(null)

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
 * Open folder picker and select a folder to scan.
 */
async function selectFolder() {
  isLoading.value = true
  scanError.value = null

  try {
    const provider = getProvider()

    // Show folder picker
    const handle = await provider.selectDirectory()
    currentFolderHandle.value = handle

    // Save handle for persistence
    await provider.saveHandle('current-folder', handle)

    // Clear previous state
    catalogStore.clear()
    selectionStore.clear()

    // Set folder path
    catalogStore.setFolderPath(handle.name)

    // Start scanning
    await scanFolder(handle)
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

/**
 * Scan the folder for supported image files.
 * Uses the FileSystemProvider abstraction for cross-platform compatibility.
 */
async function scanFolder(handle: DirectoryHandle) {
  const provider = getProvider()

  catalogStore.setScanning(true)
  catalogStore.setScanProgress({ totalFound: 0, processed: 0 })

  try {
    // List all files recursively
    const entries = await provider.listDirectory(handle, true)

    // Filter for supported image files
    const imageEntries = entries.filter((entry): entry is FileEntry & { handle: FileHandle } => {
      if (entry.kind !== 'file') return false
      const ext = getExtension(entry.name)
      return isSupportedExtension(ext)
    })

    // Process in batches
    const batchSize = 50
    let batch: Asset[] = []
    let totalFound = 0

    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i]
      if (!entry) continue

      const ext = getExtension(entry.name)
      const filename = getFilenameWithoutExtension(entry.name)

      // Get file metadata
      let fileSize = 0
      let modifiedDate = new Date()
      try {
        const metadata = await provider.getFileMetadata(entry.handle)
        fileSize = metadata.size
        modifiedDate = new Date(metadata.lastModified)
      }
      catch {
        // Skip files we can't access
        continue
      }

      const asset: Asset = {
        id: `asset-${i}`,
        folderId: handle.name,
        path: entry.name,
        filename,
        extension: ext,
        flag: 'none',
        captureDate: null, // Would be extracted from EXIF in full implementation
        modifiedDate,
        fileSize,
        thumbnailStatus: 'pending',
        thumbnailUrl: null,
      }

      batch.push(asset)
      totalFound++

      // Update progress
      catalogStore.setScanProgress({
        totalFound,
        processed: totalFound,
        currentFile: filename,
      })

      // Flush batch
      if (batch.length >= batchSize) {
        catalogStore.addAssetBatch(batch)
        batch = []
      }
    }

    // Flush remaining batch
    if (batch.length > 0) {
      catalogStore.addAssetBatch(batch)
    }
  }
  catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Scan failed'
  }
  finally {
    catalogStore.setScanning(false)
  }
}

// ============================================================================
// Permission Recovery
// ============================================================================

/**
 * Handle successful folder re-authorization.
 */
function handleReauthorized(folderId: string) {
  // If this was the current folder, rescan it
  if (folderId === 'current-folder' && currentFolderHandle.value) {
    scanFolder(currentFolderHandle.value)
  }
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
 * Check for saved folder on app load and verify permissions.
 */
async function initializeApp() {
  const provider = getProvider()

  try {
    // Check for saved folder handle
    const savedHandle = await provider.loadHandle('current-folder')
    if (!savedHandle) return

    // Query permission
    const permissionState = await provider.queryPermission(savedHandle, 'read')

    if (permissionState === 'granted') {
      // Permission still valid - load the folder
      currentFolderHandle.value = savedHandle
      catalogStore.setFolderPath(savedHandle.name)
      await scanFolder(savedHandle)
    }
    else {
      // Permission lost - show recovery modal
      permissionStore.addFolderIssue(
        'current-folder',
        savedHandle.name,
        savedHandle.name,
        permissionState as 'prompt' | 'denied'
      )
    }
  }
  catch {
    // No saved state or error loading - start fresh
  }
}

// Initialize on client-side mount
onMounted(() => {
  initializeApp()
})
</script>

<template>
  <div class="catalog-page">
    <!-- Permission recovery modal -->
    <CatalogPermissionRecovery
      @select-new-folder="selectFolder"
      @continue="handleContinue"
      @reauthorized="handleReauthorized"
    />

    <!-- Welcome screen (no folder selected) -->
    <div v-if="!hasFolder && !isLoading" class="welcome-screen">
      <div class="welcome-content">
        <h1 class="text-4xl font-bold">
          Literoom
        </h1>

        <p class="text-gray-400 text-lg mt-4">
          A desktop, offline-first photo culling and editing app.
          Your photos stay local, your edits persist.
        </p>

        <div class="mt-8 space-y-4">
          <UButton
            size="xl"
            :loading="isLoading"
            @click="selectFolder"
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
    <div v-else-if="isLoading && !hasAssets" class="loading-screen">
      <div class="loading-content">
        <UIcon name="i-heroicons-folder-open" class="w-12 h-12 text-gray-600 mb-4" />
        <p class="text-gray-400 mb-2">Scanning folder...</p>
        <p v-if="catalogStore.scanProgress" class="text-sm text-gray-500">
          Found {{ catalogStore.scanProgress.totalFound }} files
        </p>
      </div>
    </div>

    <!-- Main catalog view -->
    <div v-else-if="hasFolder" class="catalog-main">
      <!-- Header -->
      <header class="catalog-header">
        <div class="flex items-center gap-3">
          <UButton
            variant="ghost"
            icon="i-heroicons-folder"
            size="sm"
            @click="selectFolder"
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
        <div v-if="selectionStore.selectionCount > 0" class="selection-info">
          {{ selectionStore.selectionCount }} selected
        </div>
      </header>

      <!-- Filter bar -->
      <CatalogFilterBar />

      <!-- Grid or empty state -->
      <div class="catalog-content">
        <CatalogCatalogGrid v-if="hasAssets" />
        <div v-else class="empty-state">
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

<style scoped>
.catalog-page {
  @apply h-screen flex flex-col bg-gray-950;
}

/* Welcome screen */
.welcome-screen {
  @apply flex-1 flex items-center justify-center p-8;
}

.welcome-content {
  @apply max-w-md text-center;
}

/* Loading screen */
.loading-screen {
  @apply flex-1 flex items-center justify-center;
}

.loading-content {
  @apply text-center;
}

/* Main catalog layout */
.catalog-main {
  @apply flex-1 flex flex-col min-h-0;
}

.catalog-header {
  @apply flex items-center justify-between px-4 py-2 border-b border-gray-800;
}

.selection-info {
  @apply text-sm text-gray-400;
}

.catalog-content {
  @apply flex-1 min-h-0;
}

/* Empty state */
.empty-state {
  @apply h-full flex flex-col items-center justify-center text-center;
}
</style>
