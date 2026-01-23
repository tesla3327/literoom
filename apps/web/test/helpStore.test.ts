/**
 * Unit tests for the help store.
 *
 * Tests help modal state management including:
 * - Initial state
 * - Open/close operations
 * - Toggle functionality
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHelpStore } from '~/stores/help'

describe('helpStore', () => {
  let store: ReturnType<typeof useHelpStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useHelpStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('isModalOpen is false', () => {
      expect(store.isModalOpen).toBe(false)
    })
  })

  // ============================================================================
  // openModal
  // ============================================================================

  describe('openModal', () => {
    it('sets isModalOpen to true', () => {
      store.openModal()
      expect(store.isModalOpen).toBe(true)
    })

    it('calling openModal when already open keeps it open', () => {
      store.openModal()
      store.openModal()
      expect(store.isModalOpen).toBe(true)
    })
  })

  // ============================================================================
  // closeModal
  // ============================================================================

  describe('closeModal', () => {
    it('sets isModalOpen to false', () => {
      store.openModal()
      store.closeModal()
      expect(store.isModalOpen).toBe(false)
    })

    it('calling closeModal when already closed keeps it closed', () => {
      store.closeModal()
      expect(store.isModalOpen).toBe(false)
    })
  })

  // ============================================================================
  // toggleModal
  // ============================================================================

  describe('toggleModal', () => {
    it('toggles from closed to open', () => {
      expect(store.isModalOpen).toBe(false)
      store.toggleModal()
      expect(store.isModalOpen).toBe(true)
    })

    it('toggles from open to closed', () => {
      store.openModal()
      expect(store.isModalOpen).toBe(true)
      store.toggleModal()
      expect(store.isModalOpen).toBe(false)
    })

    it('multiple toggles work correctly', () => {
      store.toggleModal() // false -> true
      expect(store.isModalOpen).toBe(true)
      store.toggleModal() // true -> false
      expect(store.isModalOpen).toBe(false)
      store.toggleModal() // false -> true
      expect(store.isModalOpen).toBe(true)
    })
  })

  // ============================================================================
  // Combined Operations
  // ============================================================================

  describe('combined operations', () => {
    it('openModal after toggle works', () => {
      store.toggleModal() // open
      store.closeModal() // close
      store.openModal() // open
      expect(store.isModalOpen).toBe(true)
    })

    it('toggle after explicit open/close works', () => {
      store.openModal()
      store.toggleModal() // should close
      expect(store.isModalOpen).toBe(false)

      store.closeModal()
      store.toggleModal() // should open
      expect(store.isModalOpen).toBe(true)
    })
  })
})
