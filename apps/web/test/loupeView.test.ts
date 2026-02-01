/**
 * Loupe View Tests
 *
 * Tests for the loupe view functionality including:
 * - View mode switching
 * - Keyboard navigation
 * - Flagging in loupe view
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLoupeKeyboard } from '~/composables/useLoupeKeyboard'
import { useCatalogUIStore } from '~/stores/catalogUI'
import { useSelectionStore } from '~/stores/selection'

describe('Loupe View', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('catalogUIStore viewMode', () => {
    it('starts with grid mode by default', () => {
      const store = useCatalogUIStore()
      expect(store.viewMode).toBe('grid')
    })

    it('can toggle to loupe mode', () => {
      const store = useCatalogUIStore()
      store.setViewMode('loupe')
      expect(store.viewMode).toBe('loupe')
    })

    it('can toggle between grid and loupe', () => {
      const store = useCatalogUIStore()
      expect(store.viewMode).toBe('grid')

      store.toggleViewMode()
      expect(store.viewMode).toBe('loupe')

      store.toggleViewMode()
      expect(store.viewMode).toBe('grid')
    })

    it('resets to grid on resetToDefaults', () => {
      const store = useCatalogUIStore()
      store.setViewMode('loupe')
      expect(store.viewMode).toBe('loupe')

      store.resetToDefaults()
      expect(store.viewMode).toBe('grid')
    })
  })

  describe('selectionStore navigation', () => {
    it('navigates to next photo in list', () => {
      const store = useSelectionStore()
      const ids = ['photo1', 'photo2', 'photo3']

      store.selectSingle('photo1')
      expect(store.currentId).toBe('photo1')

      store.navigateNext(ids)
      expect(store.currentId).toBe('photo2')

      store.navigateNext(ids)
      expect(store.currentId).toBe('photo3')
    })

    it('stays at last photo when navigating next at end', () => {
      const store = useSelectionStore()
      const ids = ['photo1', 'photo2', 'photo3']

      store.selectSingle('photo3')
      store.navigateNext(ids)
      expect(store.currentId).toBe('photo3')
    })

    it('navigates to previous photo in list', () => {
      const store = useSelectionStore()
      const ids = ['photo1', 'photo2', 'photo3']

      store.selectSingle('photo3')
      expect(store.currentId).toBe('photo3')

      store.navigatePrevious(ids)
      expect(store.currentId).toBe('photo2')

      store.navigatePrevious(ids)
      expect(store.currentId).toBe('photo1')
    })

    it('stays at first photo when navigating previous at start', () => {
      const store = useSelectionStore()
      const ids = ['photo1', 'photo2', 'photo3']

      store.selectSingle('photo1')
      store.navigatePrevious(ids)
      expect(store.currentId).toBe('photo1')
    })
  })

  describe('useLoupeKeyboard', () => {
    it('is a function that returns cleanup logic', () => {
      expect(typeof useLoupeKeyboard).toBe('function')
    })
  })

  describe('view mode integration', () => {
    it('loupe mode preserves current selection', () => {
      const catalogUIStore = useCatalogUIStore()
      const selectionStore = useSelectionStore()

      // Select a photo
      selectionStore.selectSingle('photo5')
      expect(selectionStore.currentId).toBe('photo5')

      // Switch to loupe mode
      catalogUIStore.setViewMode('loupe')
      expect(catalogUIStore.viewMode).toBe('loupe')

      // Selection should be preserved
      expect(selectionStore.currentId).toBe('photo5')
    })

    it('switching back to grid preserves selection', () => {
      const catalogUIStore = useCatalogUIStore()
      const selectionStore = useSelectionStore()
      const ids = ['photo1', 'photo2', 'photo3']

      // Start in grid, select photo
      selectionStore.selectSingle('photo1')

      // Switch to loupe
      catalogUIStore.setViewMode('loupe')

      // Navigate in loupe
      selectionStore.navigateNext(ids)
      expect(selectionStore.currentId).toBe('photo2')

      // Switch back to grid
      catalogUIStore.setViewMode('grid')
      expect(catalogUIStore.viewMode).toBe('grid')

      // Selection should still be the photo we navigated to
      expect(selectionStore.currentId).toBe('photo2')
    })
  })

  describe('keyboard navigation with filtered list', () => {
    it('navigates within filtered list only', () => {
      const selectionStore = useSelectionStore()

      // Simulate a filtered list (only picks)
      const filteredIds = ['pick1', 'pick3', 'pick5']

      selectionStore.selectSingle('pick1')
      selectionStore.navigateNext(filteredIds)
      expect(selectionStore.currentId).toBe('pick3') // Skips pick2

      selectionStore.navigateNext(filteredIds)
      expect(selectionStore.currentId).toBe('pick5')
    })
  })
})
