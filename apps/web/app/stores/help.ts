/**
 * Help Store
 *
 * Manages state for the keyboard shortcuts help modal.
 * Provides methods to open, close, and toggle the modal.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useHelpStore = defineStore('help', () => {
  // ============================================================================
  // State
  // ============================================================================

  /** Whether the help modal is currently open */
  const isModalOpen = ref(false)

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Open the help modal.
   */
  function openModal(): void {
    isModalOpen.value = true
  }

  /**
   * Close the help modal.
   */
  function closeModal(): void {
    isModalOpen.value = false
  }

  /**
   * Toggle the help modal open/closed state.
   */
  function toggleModal(): void {
    isModalOpen.value = !isModalOpen.value
  }

  return {
    isModalOpen,
    openModal,
    closeModal,
    toggleModal,
  }
})
