/**
 * Composable for keyboard handling in loupe view.
 *
 * Provides:
 * - Arrow key navigation (left/right for prev/next photo)
 * - Flag shortcuts (P = pick, X = reject, U = unflag)
 * - View switching (G/Escape = grid, E/Enter = edit)
 * - Zoom controls (Z = toggle fit/100%, J = toggle clipping)
 * - Auto-cleanup on unmount
 */

import type { FlagStatus } from '@literoom/core/catalog'

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

export interface UseLoupeKeyboardOptions {
  /**
   * Current asset ID being viewed.
   */
  currentId: ComputedRef<string | null>
  /**
   * Ordered list of asset IDs matching display order (filtered/sorted).
   */
  filteredIds: ComputedRef<string[]>
  /**
   * Called when flagging a photo.
   */
  onFlag?: (flag: FlagStatus) => void
  /**
   * Called when navigating to edit view.
   */
  onEdit?: () => void
  /**
   * Called when returning to grid view.
   */
  onGrid?: () => void
}

/**
 * Keyboard handling for loupe view.
 *
 * @example
 * ```vue
 * <script setup>
 * const selectionStore = useSelectionStore()
 * const catalogUIStore = useCatalogUIStore()
 * const { setFlag } = useCatalog()
 *
 * useLoupeKeyboard({
 *   currentId: computed(() => selectionStore.currentId),
 *   filteredIds: computed(() => catalogUIStore.sortedAssetIds),
 *   onFlag: (flag) => setFlag(flag),
 *   onEdit: () => router.push(`/edit/${selectionStore.currentId}`),
 *   onGrid: () => catalogUIStore.setViewMode('grid'),
 * })
 * </script>
 * ```
 */
export function useLoupeKeyboard(options: UseLoupeKeyboardOptions): void {
  const {
    currentId,
    filteredIds,
    onFlag,
    onEdit,
    onGrid,
  } = options

  const selectionStore = useSelectionStore()
  const editUIStore = useEditUIStore()

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
        selectionStore.navigateNext(filteredIds.value)
        return

      case 'ArrowLeft':
        event.preventDefault()
        selectionStore.navigatePrevious(filteredIds.value)
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

    // View switching shortcuts
    switch (key) {
      case 'g':
        event.preventDefault()
        onGrid?.()
        return

      case 'escape':
        event.preventDefault()
        onGrid?.()
        return

      case 'e':
      case 'enter':
        event.preventDefault()
        if (currentId.value) {
          onEdit?.()
        }
        return
    }

    // Zoom shortcuts
    switch (key) {
      case 'z':
        event.preventDefault()
        editUIStore.toggleZoom()
        return

      case 'j':
        event.preventDefault()
        editUIStore.toggleClippingOverlays()
        return
    }
  }

  // Register keyboard listener on mount
  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  // Clean up listener on unmount
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
