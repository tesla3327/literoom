<script setup lang="ts">
/**
 * Edit Page
 *
 * Single photo editing view with:
 * - Left panel: histogram
 * - Center: preview canvas
 * - Right panel: edit controls
 * - Bottom: filmstrip navigation
 */

// Apply middleware to ensure catalog service is ready before page loads
// Also disable SSR since this page requires client-only services (catalog, decode)
definePageMeta({
  middleware: ['ensure-catalog'],
  ssr: false,
})

// ============================================================================
// Stores and Composables
// ============================================================================

const route = useRoute()
const router = useRouter()
const catalogStore = useCatalogStore()
const uiStore = useCatalogUIStore()
const selectionStore = useSelectionStore()
const editStore = useEditStore()
const editUIStore = useEditUIStore()
const { openCopyModal, pasteSettings, canPaste } = useCopyPasteSettings()
const { regenerateThumbnail } = useCatalog()

// Help modal keyboard shortcuts
useHelpModal()

// ============================================================================
// Preview Component Ref
// ============================================================================

/**
 * Reference to the preview canvas component.
 * Used to access adjusted pixels for histogram computation.
 * The exposed refs from the component.
 */
const previewCanvasRef = ref<InstanceType<typeof EditPreviewCanvas> | null>(null)

// Reactive computed refs that extract adjusted pixels from the preview component
const adjustedPixels = computed(() => previewCanvasRef.value?.adjustedPixels ?? null)
const adjustedDimensions = computed(() => previewCanvasRef.value?.adjustedDimensions ?? null)

// ============================================================================
// Histogram Mode Toggle
// ============================================================================

const useCanvasHistogram = ref(false)

// ============================================================================
// Computed
// ============================================================================

const assetId = computed(() => route.params.id as string)
const asset = computed(() => catalogStore.assets.get(assetId.value))
const filteredIds = computed(() => uiStore.filteredAssetIds)

// Current position in filtered list
const currentIndex = computed(() => {
  return filteredIds.value.indexOf(assetId.value)
})

const hasPrev = computed(() => currentIndex.value > 0)
const hasNext = computed(() => currentIndex.value < filteredIds.value.length - 1)

// ============================================================================
// Navigation
// ============================================================================

/**
 * Navigate back to grid view.
 */
function goBack() {
  router.push('/')
}

/**
 * Navigate to previous photo.
 */
function navigatePrev() {
  if (hasPrev.value) {
    router.push(`/edit/${filteredIds.value[currentIndex.value - 1]}`)
  }
}

/**
 * Navigate to next photo.
 */
function navigateNext() {
  if (hasNext.value) {
    router.push(`/edit/${filteredIds.value[currentIndex.value + 1]}`)
  }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

/**
 * Handle keyboard navigation.
 */
function handleKeydown(e: KeyboardEvent) {
  // Ignore when typing in inputs or interacting with sliders
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return
  }

  // Ignore arrow keys when focused on slider elements (role="slider")
  const target = e.target as HTMLElement
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.getAttribute?.('role') === 'slider') {
    return
  }

  const isMod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()

  // Crop tool shortcuts (Enter = apply, Escape = cancel)
  if (editUIStore.isCropToolActive) {
    if (e.key === 'Enter') {
      e.preventDefault()
      editUIStore.applyPendingCrop()
      return
    }
    // Note: Escape is handled below in the switch, but when crop tool is active
    // it should cancel the crop instead of going back to grid
  }

  // Zoom shortcuts (Cmd/Ctrl + 0, 1, +, -)
  if (isMod && !e.shiftKey) {
    if (key === '0') {
      e.preventDefault()
      previewCanvasRef.value?.setPreset('fit')
      return
    }
    if (key === '1') {
      e.preventDefault()
      previewCanvasRef.value?.setPreset('100%')
      return
    }
    if (key === '=' || key === '+') {
      e.preventDefault()
      previewCanvasRef.value?.zoomIn()
      return
    }
    if (key === '-') {
      e.preventDefault()
      previewCanvasRef.value?.zoomOut()
      return
    }
  }

  // Copy/Paste shortcuts (Cmd/Ctrl+Shift+C/V)
  if (isMod && e.shiftKey) {
    if (key === 'c') {
      e.preventDefault()
      openCopyModal()
      return
    }
    if (key === 'v') {
      e.preventDefault()
      if (canPaste.value) {
        pasteSettings()
      }
      return
    }
  }

  switch (e.key) {
    case 'Escape':
      // If crop tool is active, cancel the crop instead of going back
      if (editUIStore.isCropToolActive) {
        editUIStore.cancelPendingCrop()
      }
      else {
        goBack()
      }
      break
    case 'ArrowLeft':
      navigatePrev()
      break
    case 'ArrowRight':
      navigateNext()
      break
    case 'g':
    case 'G':
      // G = return to Grid
      goBack()
      break
    case 'z':
    case 'Z':
      // Z = toggle zoom (fit/100%)
      if (!isMod) {
        previewCanvasRef.value?.toggleZoom()
      }
      break
  }
}

// ============================================================================
// Edit State Loading
// ============================================================================

/**
 * Load edit state when asset changes.
 * The store handles saving any dirty state before loading new.
 */
watch(assetId, async (id) => {
  if (id) {
    try {
      await editStore.loadForAsset(id)
    }
    catch (err) {
      console.error('[EditPage] Failed to load edit state for asset:', err)
    }
  }
}, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)

  // Trigger thumbnail regeneration if the asset was modified
  // This runs async in the background so it won't block navigation
  const id = assetId.value
  if (id && editStore.hasModifications) {
    regenerateThumbnail(id).catch((err) => {
      console.warn('[EditPage] Failed to queue thumbnail regeneration:', err)
    })
  }

  // Clear edit state when leaving edit view
  editStore.clear()
  // Deactivate crop tool when leaving edit view
  editUIStore.deactivateCropTool()
})
</script>

<template>
  <div
    class="h-screen flex flex-col bg-gray-950"
    data-testid="edit-page"
  >
    <!-- Header -->
    <header class="h-12 border-b border-gray-800 flex items-center px-4 gap-4 flex-shrink-0">
      <UButton
        variant="ghost"
        icon="i-heroicons-arrow-left"
        size="sm"
        data-testid="back-button"
        @click="goBack"
      />

      <span class="text-sm text-gray-400">
        {{ asset?.filename }}.{{ asset?.extension }}
      </span>

      <!-- GPU Performance Badge + Navigation arrows -->
      <div class="flex items-center gap-2 ml-auto">
        <GPUPerformanceBadge />
        <UButton
          variant="ghost"
          icon="i-heroicons-chevron-left"
          size="sm"
          :disabled="!hasPrev"
          data-testid="prev-button"
          @click="navigatePrev"
        />
        <span class="text-sm text-gray-500">
          {{ currentIndex + 1 }} / {{ filteredIds.length }}
        </span>
        <UButton
          variant="ghost"
          icon="i-heroicons-chevron-right"
          size="sm"
          :disabled="!hasNext"
          data-testid="next-button"
          @click="navigateNext"
        />
      </div>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Left panel: histogram -->
      <aside class="w-64 border-r border-gray-800 p-4 flex-shrink-0 overflow-y-auto">
        <div class="space-y-4">
          <!-- Histogram Mode Toggle -->
          <div class="flex gap-2 text-xs">
            <button
              class="px-2 py-1 rounded transition-colors"
              :class="useCanvasHistogram ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
              @click="useCanvasHistogram = true"
            >
              Canvas
            </button>
            <button
              class="px-2 py-1 rounded transition-colors"
              :class="!useCanvasHistogram ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
              @click="useCanvasHistogram = false"
            >
              SVG
            </button>
          </div>

          <!-- Histogram Display -->
          <EditHistogramDisplay
            v-if="useCanvasHistogram"
            :asset-id="assetId"
            :adjusted-pixels="adjustedPixels"
            :adjusted-dimensions="adjustedDimensions"
          />
          <EditHistogramDisplaySVG
            v-else
            :asset-id="assetId"
            :adjusted-pixels="adjustedPixels"
            :adjusted-dimensions="adjustedDimensions"
          />

          <!-- Quick info -->
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-500">Format</span>
              <span class="text-gray-300">{{ asset?.extension?.toUpperCase() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Size</span>
              <span class="text-gray-300">{{ asset?.fileSize ? formatFileSize(asset.fileSize) : '-' }}</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center: preview canvas -->
      <main class="flex-1 relative min-w-0">
        <EditPreviewCanvas ref="previewCanvasRef" :asset-id="assetId" />
      </main>

      <!-- Right panel: edit controls -->
      <aside class="w-80 border-l border-gray-800 overflow-y-auto flex-shrink-0">
        <EditControlsPanel :asset-id="assetId" />
      </aside>
    </div>

    <!-- Bottom: filmstrip -->
    <EditFilmstrip
      class="h-24 border-t border-gray-800 flex-shrink-0"
      :current-asset-id="assetId"
    />

    <!-- Copy Settings Modal -->
    <EditCopySettingsModal />

    <!-- Help modal -->
    <HelpModal />
  </div>
</template>

<script lang="ts">
/**
 * Format file size in human readable format.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>
