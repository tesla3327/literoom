/**
 * Composable for keyboard navigation in a photo grid.
 *
 * Provides:
 * - Arrow key navigation with grid-aware movement
 * - Flag shortcuts (P = pick, X = reject, U = unflag)
 * - View mode shortcuts (E/Enter = edit, G = grid)
 * - Scroll-into-view for focused elements
 */

import type { FlagStatus } from '@literoom/core/catalog'

export interface UseGridKeyboardOptions {
  /**
   * Number of columns in the grid.
   * Used for up/down navigation.
   */
  columnsCount: ComputedRef<number>
  /**
   * Total number of items in the grid.
   */
  totalItems: ComputedRef<number>
  /**
   * Ordered list of asset IDs matching grid display order.
   */
  orderedIds: ComputedRef<string[]>
  /**
   * Called when navigation moves to a new index.
   */
  onNavigate: (id: string, index: number) => void
  /**
   * Called when a flag shortcut is pressed.
   */
  onFlag?: (flag: FlagStatus) => void
  /**
   * Called when view mode should change.
   */
  onViewChange?: (mode: 'edit' | 'grid') => void
  /**
   * Called when delete is pressed.
   */
  onDelete?: () => void
  /**
   * Current index (if controlled externally).
   * If not provided, the composable manages its own index.
   */
  currentIndex?: Ref<number>
}

export interface UseGridKeyboardReturn {
  /**
   * Currently focused index.
   */
  currentIndex: Ref<number>
  /**
   * Handle keydown events. Attach to container element.
   */
  handleKeydown: (event: KeyboardEvent) => void
  /**
   * Set the current index programmatically.
   */
  setCurrentIndex: (index: number) => void
  /**
   * Navigate to the next item.
   */
  navigateNext: () => void
  /**
   * Navigate to the previous item.
   */
  navigatePrevious: () => void
  /**
   * Navigate down one row.
   */
  navigateDown: () => void
  /**
   * Navigate up one row.
   */
  navigateUp: () => void
}

/**
 * Check if keyboard shortcuts should be disabled.
 * Returns true if focus is in an input field or other text entry element.
 */
function shouldIgnoreShortcuts(): boolean {
  const activeElement = document.activeElement

  if (!activeElement) return false

  // Check for input, textarea, or contenteditable
  if (activeElement instanceof HTMLInputElement) {
    // Allow shortcuts for checkbox, radio, button inputs
    const type = activeElement.type.toLowerCase()
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)
  }

  if (activeElement instanceof HTMLTextAreaElement) {
    return true
  }

  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return true
  }

  // Check for elements with role="textbox"
  if (activeElement.getAttribute('role') === 'textbox') {
    return true
  }

  return false
}

/**
 * Keyboard navigation for a photo grid.
 *
 * @example
 * ```vue
 * <script setup>
 * const catalogUIStore = useCatalogUIStore()
 * const selectionStore = useSelectionStore()
 *
 * const { handleKeydown, currentIndex } = useGridKeyboard({
 *   columnsCount: computed(() => catalogUIStore.gridColumns),
 *   totalItems: computed(() => catalogUIStore.sortedAssetIds.length),
 *   orderedIds: computed(() => catalogUIStore.sortedAssetIds),
 *   onNavigate: (id, index) => {
 *     selectionStore.selectSingle(id)
 *     scrollToIndex(index)
 *   },
 *   onFlag: (flag) => {
 *     const currentId = selectionStore.currentId
 *     if (currentId) catalogStore.setFlag(currentId, flag)
 *   },
 *   onViewChange: (mode) => {
 *     if (mode === 'edit') navigateTo('/edit')
 *   },
 * })
 * </script>
 *
 * <template>
 *   <div @keydown="handleKeydown" tabindex="0">
 *     <!-- grid content -->
 *   </div>
 * </template>
 * ```
 */
export function useGridKeyboard(options: UseGridKeyboardOptions): UseGridKeyboardReturn {
  const {
    columnsCount,
    totalItems,
    orderedIds,
    onNavigate,
    onFlag,
    onViewChange,
    onDelete,
    currentIndex: externalIndex,
  } = options

  // Use external index if provided, otherwise manage internally
  const internalIndex = ref(-1)
  const currentIndex = externalIndex ?? internalIndex

  /**
   * Calculate the next index for grid navigation.
   */
  function getNextIndex(
    direction: 'left' | 'right' | 'up' | 'down'
  ): number {
    const current = currentIndex.value
    const cols = columnsCount.value
    const total = totalItems.value

    if (total === 0) return -1

    // If no current selection, start at first item
    if (current < 0 || current >= total) {
      return direction === 'up' || direction === 'left' ? total - 1 : 0
    }

    switch (direction) {
      case 'right':
        return current < total - 1 ? current + 1 : current

      case 'left':
        return current > 0 ? current - 1 : current

      case 'down': {
        const nextIndex = current + cols
        return nextIndex < total ? nextIndex : current
      }

      case 'up': {
        const prevIndex = current - cols
        return prevIndex >= 0 ? prevIndex : current
      }

      default:
        return current
    }
  }

  /**
   * Navigate to a new index and trigger callback.
   */
  function navigateToIndex(index: number): void {
    if (index < 0 || index >= totalItems.value) return
    if (index === currentIndex.value) return

    currentIndex.value = index
    const id = orderedIds.value[index]
    if (id) {
      onNavigate(id, index)
    }
  }

  /**
   * Set the current index programmatically.
   */
  function setCurrentIndex(index: number): void {
    if (index >= -1 && index < totalItems.value) {
      currentIndex.value = index
    }
  }

  /**
   * Navigation methods.
   */
  function navigateNext(): void {
    navigateToIndex(getNextIndex('right'))
  }

  function navigatePrevious(): void {
    navigateToIndex(getNextIndex('left'))
  }

  function navigateDown(): void {
    navigateToIndex(getNextIndex('down'))
  }

  function navigateUp(): void {
    navigateToIndex(getNextIndex('up'))
  }

  /**
   * Handle keydown events.
   */
  function handleKeydown(event: KeyboardEvent): void {
    // Skip if typing in an input
    if (shouldIgnoreShortcuts()) return

    const key = event.key.toLowerCase()

    // Arrow key navigation
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        navigateNext()
        return

      case 'ArrowLeft':
        event.preventDefault()
        navigatePrevious()
        return

      case 'ArrowDown':
        event.preventDefault()
        navigateDown()
        return

      case 'ArrowUp':
        event.preventDefault()
        navigateUp()
        return
    }

    // Flag shortcuts
    if (onFlag) {
      switch (key) {
        case 'p':
          event.preventDefault()
          onFlag('pick')
          return

        case 'x':
          event.preventDefault()
          onFlag('reject')
          return

        case 'u':
          event.preventDefault()
          onFlag('none')
          return
      }
    }

    // View mode shortcuts
    if (onViewChange) {
      switch (key) {
        case 'e':
        case 'enter':
          event.preventDefault()
          onViewChange('edit')
          return

        case 'g':
          event.preventDefault()
          onViewChange('grid')
          return

        case 'd':
          // D for "Develop" (Lightroom convention)
          event.preventDefault()
          onViewChange('edit')
          return
      }
    }

    // Delete shortcut
    if (onDelete && (key === 'delete' || key === 'backspace')) {
      event.preventDefault()
      onDelete()
      return
    }
  }

  // Reset index when total items changes significantly (e.g., filter change)
  watch(totalItems, (newTotal, oldTotal) => {
    if (currentIndex.value >= newTotal) {
      currentIndex.value = newTotal > 0 ? newTotal - 1 : -1
    }
    // If items were added and we had no selection, select first
    if (oldTotal === 0 && newTotal > 0 && currentIndex.value === -1) {
      currentIndex.value = 0
    }
  })

  return {
    currentIndex,
    handleKeydown,
    setCurrentIndex,
    navigateNext,
    navigatePrevious,
    navigateDown,
    navigateUp,
  }
}

/**
 * Helper to scroll an element into view smoothly.
 */
export function scrollIntoViewIfNeeded(element: HTMLElement | null): void {
  if (!element) return

  // Use scrollIntoViewIfNeeded if available (Chrome)
  if ('scrollIntoViewIfNeeded' in element) {
    ;(element as HTMLElement & { scrollIntoViewIfNeeded: (centerIfNeeded?: boolean) => void })
      .scrollIntoViewIfNeeded(false)
    return
  }

  // Fallback to standard scrollIntoView
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'nearest',
  })
}
