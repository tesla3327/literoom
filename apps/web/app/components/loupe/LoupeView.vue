<script setup lang="ts">
/**
 * LoupeView Component
 *
 * Container component that orchestrates the loupe view layout.
 * Provides a single-image viewing experience with:
 * - Header with navigation controls
 * - Central preview canvas
 * - Filter bar for filtering/sorting
 * - Bottom filmstrip for quick navigation
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Header (48px): ← Back | Filename | ◀ ▶ Navigation | ? Help  │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                              │
 * │              Center: LoupePreviewCanvas (flex-1)             │
 * │                                                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Filter Bar (40px): Reuse FilterBar component                 │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Filmstrip (80px): LoupeFilmstrip                            │
 * └─────────────────────────────────────────────────────────────┘
 */

// ============================================================================
// Emits
// ============================================================================

const emit = defineEmits<{
  /** Emitted when back button is clicked (parent sets viewMode to 'grid') */
  back: []
}>()

// ============================================================================
// Stores and Composables
// ============================================================================

const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const selectionStore = useSelectionStore()
const helpStore = useHelpStore()

// Help modal keyboard shortcuts
useHelpModal()

// ============================================================================
// Computed
// ============================================================================

/** Current asset from the catalog store based on selection */
const asset = computed(() => {
  const currentId = selectionStore.currentId
  if (!currentId) return null
  return catalogStore.assets.get(currentId) ?? null
})

/** Filtered asset IDs from the catalog UI store */
const filteredIds = computed(() => catalogUIStore.filteredAssetIds)

/** Current position in filtered list */
const currentIndex = computed(() => {
  const currentId = selectionStore.currentId
  if (!currentId) return -1
  return filteredIds.value.indexOf(currentId)
})

/** Whether there is a previous photo to navigate to */
const hasPrev = computed(() => currentIndex.value > 0)

/** Whether there is a next photo to navigate to */
const hasNext = computed(() => currentIndex.value < filteredIds.value.length - 1)

// ============================================================================
// Navigation
// ============================================================================

/**
 * Navigate back to grid view.
 * Emits 'back' event for parent to handle view mode change.
 */
function goBack() {
  emit('back')
}

/**
 * Navigate to previous photo using selection store.
 */
function navigatePrev() {
  if (hasPrev.value) {
    const prevId = filteredIds.value[currentIndex.value - 1]
    if (prevId) {
      selectionStore.selectSingle(prevId)
    }
  }
}

/**
 * Navigate to next photo using selection store.
 */
function navigateNext() {
  if (hasNext.value) {
    const nextId = filteredIds.value[currentIndex.value + 1]
    if (nextId) {
      selectionStore.selectSingle(nextId)
    }
  }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

/**
 * Handle keyboard navigation.
 */
function handleKeydown(e: KeyboardEvent) {
  // Ignore when typing in inputs
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return
  }

  switch (e.key) {
    case 'Escape':
    case 'g':
    case 'G':
      // G = return to Grid, Escape = close loupe view
      goBack()
      break
    case 'ArrowLeft':
      navigatePrev()
      break
    case 'ArrowRight':
      navigateNext()
      break
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    class="h-full flex flex-col bg-gray-950"
    data-testid="loupe-view"
  >
    <!-- Header (48px) -->
    <header class="h-12 border-b border-gray-800 flex items-center px-4 gap-4 flex-shrink-0">
      <!-- Back button -->
      <UButton
        variant="ghost"
        icon="i-heroicons-arrow-left"
        size="sm"
        data-testid="loupe-back-button"
        @click="goBack"
      />

      <!-- Filename display -->
      <span class="text-sm text-gray-400">
        {{ asset?.filename }}.{{ asset?.extension }}
      </span>

      <!-- Navigation arrows and count -->
      <div class="flex items-center gap-2 ml-auto">
        <UButton
          variant="ghost"
          icon="i-heroicons-chevron-left"
          size="sm"
          :disabled="!hasPrev"
          data-testid="loupe-prev-button"
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
          data-testid="loupe-next-button"
          @click="navigateNext"
        />

        <!-- Help button -->
        <UButton
          variant="ghost"
          icon="i-heroicons-question-mark-circle"
          size="sm"
          title="Keyboard shortcuts (?)"
          data-testid="loupe-help-button"
          @click="helpStore.openModal"
        />
      </div>
    </header>

    <!-- Main content: Preview Canvas (flex-1) -->
    <main class="flex-1 relative min-h-0 bg-gray-900">
      <LoupePreviewCanvas
        v-if="selectionStore.currentId"
        :asset-id="selectionStore.currentId"
      />
    </main>

    <!-- Filter Bar (40px) -->
    <FilterBar class="flex-shrink-0" />

    <!-- Filmstrip (80px) -->
    <LoupeFilmstrip class="h-20 border-t border-gray-800 flex-shrink-0" />

    <!-- Help modal -->
    <HelpModal />
  </div>
</template>
