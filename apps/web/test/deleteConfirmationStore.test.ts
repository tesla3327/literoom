/**
 * Unit tests for the delete confirmation store.
 *
 * Tests delete confirmation modal state management including:
 * - Initial state
 * - Request delete opens modal and sets pending IDs
 * - Confirm delete closes modal but preserves pending IDs
 * - Cancel delete closes modal and clears pending IDs
 * - Clear pending clears pending IDs without closing modal
 * - Pending count computed property
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDeleteConfirmationStore } from '~/stores/deleteConfirmation'

describe('deleteConfirmationStore', () => {
  let store: ReturnType<typeof useDeleteConfirmationStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDeleteConfirmationStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('isModalOpen is false', () => {
      expect(store.isModalOpen).toBe(false)
    })

    it('pendingAssetIds is empty array', () => {
      expect(store.pendingAssetIds).toEqual([])
    })

    it('pendingCount is 0', () => {
      expect(store.pendingCount).toBe(0)
    })
  })

  // ============================================================================
  // requestDelete
  // ============================================================================

  describe('requestDelete', () => {
    it('opens modal and sets pending IDs', () => {
      store.requestDelete(['asset-1', 'asset-2', 'asset-3'])

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual(['asset-1', 'asset-2', 'asset-3'])
      expect(store.pendingCount).toBe(3)
    })

    it('opens modal with single asset', () => {
      store.requestDelete(['asset-1'])

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual(['asset-1'])
      expect(store.pendingCount).toBe(1)
    })

    it('replaces previous pending IDs', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.requestDelete(['asset-3'])

      expect(store.pendingAssetIds).toEqual(['asset-3'])
      expect(store.pendingCount).toBe(1)
    })

    it('with empty array still opens modal', () => {
      store.requestDelete([])

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual([])
      expect(store.pendingCount).toBe(0)
    })

    it('creates a copy of the asset IDs array', () => {
      const originalIds = ['asset-1', 'asset-2']
      store.requestDelete(originalIds)

      // Modify original array
      originalIds.push('asset-3')

      // Store should not be affected
      expect(store.pendingAssetIds).toEqual(['asset-1', 'asset-2'])
    })
  })

  // ============================================================================
  // confirmDelete
  // ============================================================================

  describe('confirmDelete', () => {
    it('closes modal but preserves pending IDs', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.confirmDelete()

      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual(['asset-1', 'asset-2'])
      expect(store.pendingCount).toBe(2)
    })

    it('calling confirmDelete when modal already closed keeps it closed', () => {
      store.confirmDelete()

      expect(store.isModalOpen).toBe(false)
    })
  })

  // ============================================================================
  // cancelDelete
  // ============================================================================

  describe('cancelDelete', () => {
    it('closes modal and clears pending IDs', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.cancelDelete()

      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual([])
      expect(store.pendingCount).toBe(0)
    })

    it('calling cancelDelete when modal already closed keeps it closed and cleared', () => {
      store.cancelDelete()

      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual([])
    })
  })

  // ============================================================================
  // clearPending
  // ============================================================================

  describe('clearPending', () => {
    it('clears pending IDs without closing modal', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.clearPending()

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual([])
      expect(store.pendingCount).toBe(0)
    })

    it('calling clearPending when already empty does nothing', () => {
      store.clearPending()

      expect(store.pendingAssetIds).toEqual([])
      expect(store.pendingCount).toBe(0)
    })

    it('clearPending after confirmDelete clears the preserved IDs', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.confirmDelete()
      store.clearPending()

      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual([])
      expect(store.pendingCount).toBe(0)
    })
  })

  // ============================================================================
  // pendingCount computed
  // ============================================================================

  describe('pendingCount', () => {
    it('returns 0 for empty pending IDs', () => {
      expect(store.pendingCount).toBe(0)
    })

    it('returns correct count for single item', () => {
      store.requestDelete(['asset-1'])
      expect(store.pendingCount).toBe(1)
    })

    it('returns correct count for multiple items', () => {
      store.requestDelete(['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5'])
      expect(store.pendingCount).toBe(5)
    })

    it('updates correctly after cancelDelete', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      expect(store.pendingCount).toBe(2)

      store.cancelDelete()
      expect(store.pendingCount).toBe(0)
    })

    it('remains after confirmDelete', () => {
      store.requestDelete(['asset-1', 'asset-2'])
      store.confirmDelete()

      expect(store.pendingCount).toBe(2)
    })
  })

  // ============================================================================
  // Combined Operations / Workflows
  // ============================================================================

  describe('combined operations', () => {
    it('typical confirm workflow: request -> confirm -> clearPending', () => {
      // User initiates delete
      store.requestDelete(['asset-1', 'asset-2'])
      expect(store.isModalOpen).toBe(true)
      expect(store.pendingCount).toBe(2)

      // User confirms deletion
      store.confirmDelete()
      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual(['asset-1', 'asset-2']) // Still available for processing

      // Caller processes deletion and clears
      store.clearPending()
      expect(store.pendingAssetIds).toEqual([])
    })

    it('typical cancel workflow: request -> cancel', () => {
      // User initiates delete
      store.requestDelete(['asset-1', 'asset-2'])
      expect(store.isModalOpen).toBe(true)
      expect(store.pendingCount).toBe(2)

      // User cancels
      store.cancelDelete()
      expect(store.isModalOpen).toBe(false)
      expect(store.pendingAssetIds).toEqual([])
    })

    it('re-requesting delete after cancel works correctly', () => {
      store.requestDelete(['asset-1'])
      store.cancelDelete()

      store.requestDelete(['asset-2', 'asset-3'])

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual(['asset-2', 'asset-3'])
    })

    it('re-requesting delete while modal open replaces pending IDs', () => {
      store.requestDelete(['asset-1'])
      store.requestDelete(['asset-2', 'asset-3'])

      expect(store.isModalOpen).toBe(true)
      expect(store.pendingAssetIds).toEqual(['asset-2', 'asset-3'])
    })
  })
})
