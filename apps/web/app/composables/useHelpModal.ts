/**
 * Composable for global keyboard shortcut to open the help modal.
 *
 * Adds a global keydown listener that opens the help modal when:
 * - `?` key is pressed (Shift+/)
 * - `Cmd/Ctrl+/` is pressed
 *
 * @example
 * ```vue
 * <script setup>
 * useHelpModal()
 * </script>
 *
 * <template>
 *   <HelpModal />
 * </template>
 * ```
 */

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

export function useHelpModal() {
  const helpStore = useHelpStore()

  /**
   * Handle global keydown events for help modal trigger.
   */
  function handleKeydown(event: KeyboardEvent): void {
    // Skip if typing in an input field
    if (shouldIgnoreShortcuts()) return

    // `?` key (Shift+/ on most keyboards)
    if (event.key === '?') {
      event.preventDefault()
      helpStore.toggleModal()
      return
    }

    // `Cmd/Ctrl+/` (common help shortcut)
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault()
      helpStore.toggleModal()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    openModal: helpStore.openModal,
    closeModal: helpStore.closeModal,
    toggleModal: helpStore.toggleModal,
    isModalOpen: computed(() => helpStore.isModalOpen),
  }
}
