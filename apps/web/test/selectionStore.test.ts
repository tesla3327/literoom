/**
 * Unit tests for the selection store.
 *
 * Tests selection state management including:
 * - Single selection
 * - Multi-selection with Ctrl/Cmd
 * - Range selection with Shift
 * - Navigation (next/previous)
 * - Clear and select all operations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSelectionStore } from '~/stores/selection'

describe('selectionStore', () => {
  let store: ReturnType<typeof useSelectionStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSelectionStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('has null currentId', () => {
      expect(store.currentId).toBeNull()
    })

    it('has empty selectedIds', () => {
      expect(store.selectedIds.size).toBe(0)
    })

    it('has null lastClickedId', () => {
      expect(store.lastClickedId).toBeNull()
    })

    it('selectionCount is 0', () => {
      expect(store.selectionCount).toBe(0)
    })

    it('isEmpty is true', () => {
      expect(store.isEmpty).toBe(true)
    })

    it('hasMultipleSelected is false', () => {
      expect(store.hasMultipleSelected).toBe(false)
    })
  })

  // ============================================================================
  // selectSingle
  // ============================================================================

  describe('selectSingle', () => {
    it('selects a single asset', () => {
      store.selectSingle('asset-1')

      expect(store.currentId).toBe('asset-1')
      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })

    it('clears previous selection', () => {
      store.selectSingle('asset-1')
      store.selectSingle('asset-2')

      expect(store.currentId).toBe('asset-2')
      expect(store.selectedIds.has('asset-1')).toBe(false)
      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })

    it('updates lastClickedId', () => {
      store.selectSingle('asset-1')
      expect(store.lastClickedId).toBe('asset-1')
    })

    it('isEmpty becomes false', () => {
      store.selectSingle('asset-1')
      expect(store.isEmpty).toBe(false)
    })
  })

  // ============================================================================
  // toggleSelection
  // ============================================================================

  describe('toggleSelection', () => {
    it('adds unselected item to selection', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-2')

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectionCount).toBe(2)
    })

    it('removes selected item from selection', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-2')
      store.toggleSelection('asset-2')

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(false)
      expect(store.selectionCount).toBe(1)
    })

    it('updates currentId when adding', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-2')

      expect(store.currentId).toBe('asset-2')
    })

    it('moves currentId when removing current item', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-2')
      store.toggleSelection('asset-2') // Remove asset-2

      // currentId should move to remaining selected item
      expect(store.currentId).toBe('asset-1')
    })

    it('sets currentId to null when removing last item', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-1')

      expect(store.currentId).toBeNull()
      expect(store.selectionCount).toBe(0)
    })

    it('updates lastClickedId', () => {
      store.toggleSelection('asset-1')
      expect(store.lastClickedId).toBe('asset-1')
    })

    it('hasMultipleSelected is true with 2+ items', () => {
      store.selectSingle('asset-1')
      store.toggleSelection('asset-2')

      expect(store.hasMultipleSelected).toBe(true)
    })
  })

  // ============================================================================
  // addToSelection
  // ============================================================================

  describe('addToSelection', () => {
    it('adds item to existing selection', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
    })

    it('does not duplicate already selected item', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-1')

      expect(store.selectionCount).toBe(1)
    })

    it('updates currentId to added item', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')

      expect(store.currentId).toBe('asset-2')
    })

    it('updates lastClickedId', () => {
      store.addToSelection('asset-1')
      expect(store.lastClickedId).toBe('asset-1')
    })
  })

  // ============================================================================
  // removeFromSelection
  // ============================================================================

  describe('removeFromSelection', () => {
    it('removes item from selection', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      store.removeFromSelection('asset-1')

      expect(store.selectedIds.has('asset-1')).toBe(false)
      expect(store.selectedIds.has('asset-2')).toBe(true)
    })

    it('does nothing for unselected item', () => {
      store.selectSingle('asset-1')
      store.removeFromSelection('asset-2')

      expect(store.selectionCount).toBe(1)
    })

    it('moves currentId when removing current item', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      store.removeFromSelection('asset-1')

      // currentId should be asset-1, then after remove should move
      // But we set currentId to asset-2 when adding, so currentId is asset-2
      expect(store.currentId).toBe('asset-2')
    })

    it('sets currentId to null when removing last item', () => {
      store.selectSingle('asset-1')
      store.removeFromSelection('asset-1')

      expect(store.currentId).toBeNull()
    })
  })

  // ============================================================================
  // selectRange
  // ============================================================================

  describe('selectRange', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5']

    it('selects range from lastClickedId to target', () => {
      store.selectSingle('asset-2') // Sets lastClickedId
      store.selectRange('asset-4', orderedIds)

      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectedIds.has('asset-4')).toBe(true)
      expect(store.selectionCount).toBe(3)
    })

    it('selects range in reverse order', () => {
      store.selectSingle('asset-4') // Sets lastClickedId
      store.selectRange('asset-2', orderedIds)

      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectedIds.has('asset-4')).toBe(true)
      expect(store.selectionCount).toBe(3)
    })

    it('replaces previous selection', () => {
      store.selectSingle('asset-1')
      store.selectSingle('asset-2') // Sets lastClickedId
      store.selectRange('asset-4', orderedIds)

      // asset-1 should not be in selection (only range items)
      expect(store.selectedIds.has('asset-1')).toBe(false)
    })

    it('updates currentId to target', () => {
      store.selectSingle('asset-2')
      store.selectRange('asset-4', orderedIds)

      expect(store.currentId).toBe('asset-4')
    })

    it('does not update lastClickedId', () => {
      store.selectSingle('asset-2')
      store.selectRange('asset-4', orderedIds)

      expect(store.lastClickedId).toBe('asset-2')
    })

    it('falls back to selectSingle if no lastClickedId', () => {
      store.selectRange('asset-3', orderedIds)

      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })

    it('falls back to selectSingle if anchor not in list', () => {
      store.selectSingle('not-in-list')
      store.selectRange('asset-3', orderedIds)

      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })

    it('falls back to selectSingle if target not in list', () => {
      store.selectSingle('asset-2')
      store.selectRange('not-in-list', orderedIds)

      expect(store.selectedIds.has('not-in-list')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })

    it('handles same anchor and target', () => {
      store.selectSingle('asset-3')
      store.selectRange('asset-3', orderedIds)

      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectionCount).toBe(1)
    })
  })

  // ============================================================================
  // handleClick
  // ============================================================================

  describe('handleClick', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5']

    it('plain click selects single', () => {
      const event = { shiftKey: false, ctrlKey: false, metaKey: false }
      store.handleClick('asset-2', event, orderedIds)

      expect(store.currentId).toBe('asset-2')
      expect(store.selectionCount).toBe(1)
    })

    it('ctrl+click toggles selection', () => {
      store.selectSingle('asset-1')
      const event = { shiftKey: false, ctrlKey: true, metaKey: false }
      store.handleClick('asset-2', event, orderedIds)

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectionCount).toBe(2)
    })

    it('meta+click (Cmd on Mac) toggles selection', () => {
      store.selectSingle('asset-1')
      const event = { shiftKey: false, ctrlKey: false, metaKey: true }
      store.handleClick('asset-2', event, orderedIds)

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
    })

    it('shift+click selects range', () => {
      store.selectSingle('asset-1')
      const event = { shiftKey: true, ctrlKey: false, metaKey: false }
      store.handleClick('asset-3', event, orderedIds)

      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectedIds.has('asset-3')).toBe(true)
      expect(store.selectionCount).toBe(3)
    })

    it('shift takes precedence over ctrl', () => {
      store.selectSingle('asset-1')
      const event = { shiftKey: true, ctrlKey: true, metaKey: false }
      store.handleClick('asset-3', event, orderedIds)

      // Should be range select, not toggle
      expect(store.selectionCount).toBe(3)
    })
  })

  // ============================================================================
  // selectAll
  // ============================================================================

  describe('selectAll', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3']

    it('selects all items in list', () => {
      store.selectAll(orderedIds)

      expect(store.selectionCount).toBe(3)
      expect(store.selectedIds.has('asset-1')).toBe(true)
      expect(store.selectedIds.has('asset-2')).toBe(true)
      expect(store.selectedIds.has('asset-3')).toBe(true)
    })

    it('does nothing for empty list', () => {
      store.selectAll([])
      expect(store.selectionCount).toBe(0)
    })

    it('sets currentId to first item if not set', () => {
      store.selectAll(orderedIds)
      expect(store.currentId).toBe('asset-1')
    })

    it('keeps currentId if already set and in selection', () => {
      store.selectSingle('asset-2')
      store.selectAll(orderedIds)

      // currentId should still be asset-2
      expect(store.currentId).toBe('asset-2')
    })

    it('selectedIdsArray returns all IDs', () => {
      store.selectAll(orderedIds)
      expect(store.selectedIdsArray).toHaveLength(3)
      expect(store.selectedIdsArray).toContain('asset-1')
      expect(store.selectedIdsArray).toContain('asset-2')
      expect(store.selectedIdsArray).toContain('asset-3')
    })
  })

  // ============================================================================
  // navigateNext
  // ============================================================================

  describe('navigateNext', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3', 'asset-4']

    it('selects next item', () => {
      store.selectSingle('asset-2')
      store.navigateNext(orderedIds)

      expect(store.currentId).toBe('asset-3')
    })

    it('selects first item if no current', () => {
      store.navigateNext(orderedIds)
      expect(store.currentId).toBe('asset-1')
    })

    it('stays at last item when at end', () => {
      store.selectSingle('asset-4')
      store.navigateNext(orderedIds)

      expect(store.currentId).toBe('asset-4')
    })

    it('does nothing for empty list', () => {
      store.selectSingle('asset-1')
      store.navigateNext([])

      expect(store.currentId).toBe('asset-1')
    })

    it('clears multi-selection to single', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      store.navigateNext(orderedIds)

      // Navigation should selectSingle
      expect(store.selectionCount).toBe(1)
    })
  })

  // ============================================================================
  // navigatePrevious
  // ============================================================================

  describe('navigatePrevious', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3', 'asset-4']

    it('selects previous item', () => {
      store.selectSingle('asset-3')
      store.navigatePrevious(orderedIds)

      expect(store.currentId).toBe('asset-2')
    })

    it('selects last item if no current', () => {
      store.navigatePrevious(orderedIds)
      expect(store.currentId).toBe('asset-4')
    })

    it('stays at first item when at beginning', () => {
      store.selectSingle('asset-1')
      store.navigatePrevious(orderedIds)

      expect(store.currentId).toBe('asset-1')
    })

    it('does nothing for empty list', () => {
      store.selectSingle('asset-2')
      store.navigatePrevious([])

      expect(store.currentId).toBe('asset-2')
    })
  })

  // ============================================================================
  // navigateToNextUnflagged
  // ============================================================================

  describe('navigateToNextUnflagged', () => {
    const orderedIds = ['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5']
    const flags: Record<string, 'none' | 'pick' | 'reject'> = {
      'asset-1': 'pick',
      'asset-2': 'none',
      'asset-3': 'reject',
      'asset-4': 'none',
      'asset-5': 'pick',
    }

    const getFlag = (id: string) => flags[id] ?? 'none'

    it('navigates to next unflagged item', () => {
      store.selectSingle('asset-1')
      store.navigateToNextUnflagged(orderedIds, getFlag)

      expect(store.currentId).toBe('asset-2')
    })

    it('skips flagged items', () => {
      store.selectSingle('asset-2') // Current is unflagged
      store.navigateToNextUnflagged(orderedIds, getFlag)

      // asset-3 is reject, so skip to asset-4
      expect(store.currentId).toBe('asset-4')
    })

    it('wraps around to beginning', () => {
      store.selectSingle('asset-4') // Last unflagged
      store.navigateToNextUnflagged(orderedIds, getFlag)

      // Should wrap to asset-2
      expect(store.currentId).toBe('asset-2')
    })

    it('starts from beginning if no current', () => {
      store.navigateToNextUnflagged(orderedIds, getFlag)
      expect(store.currentId).toBe('asset-2')
    })

    it('does nothing if all items are flagged', () => {
      const allFlagged: Record<string, 'pick' | 'reject'> = {
        'asset-1': 'pick',
        'asset-2': 'pick',
        'asset-3': 'reject',
      }
      const getFlagAllFlagged = (id: string) => allFlagged[id] ?? 'pick'

      store.selectSingle('asset-1')
      store.navigateToNextUnflagged(['asset-1', 'asset-2', 'asset-3'], getFlagAllFlagged)

      // Should remain on asset-1
      expect(store.currentId).toBe('asset-1')
    })

    it('does nothing for empty list', () => {
      store.navigateToNextUnflagged([], getFlag)
      expect(store.currentId).toBeNull()
    })
  })

  // ============================================================================
  // clear
  // ============================================================================

  describe('clear', () => {
    it('clears all selection state', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      store.clear()

      expect(store.currentId).toBeNull()
      expect(store.lastClickedId).toBeNull()
      expect(store.selectedIds.size).toBe(0)
      expect(store.isEmpty).toBe(true)
    })
  })

  // ============================================================================
  // setCurrent
  // ============================================================================

  describe('setCurrent', () => {
    it('sets currentId without changing selection', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      store.setCurrent('asset-3')

      expect(store.currentId).toBe('asset-3')
      expect(store.selectionCount).toBe(2) // Selection unchanged
    })

    it('sets currentId to null', () => {
      store.selectSingle('asset-1')
      store.setCurrent(null)

      expect(store.currentId).toBeNull()
    })

    it('updates lastClickedId when setting non-null', () => {
      store.setCurrent('asset-2')
      expect(store.lastClickedId).toBe('asset-2')
    })

    it('does not update lastClickedId when setting null', () => {
      store.selectSingle('asset-1')
      store.setCurrent(null)

      expect(store.lastClickedId).toBe('asset-1')
    })
  })

  // ============================================================================
  // isSelected and isCurrent
  // ============================================================================

  describe('isSelected', () => {
    it('returns true for selected item', () => {
      store.selectSingle('asset-1')
      expect(store.isSelected('asset-1')).toBe(true)
    })

    it('returns false for unselected item', () => {
      store.selectSingle('asset-1')
      expect(store.isSelected('asset-2')).toBe(false)
    })
  })

  describe('isCurrent', () => {
    it('returns true for current item', () => {
      store.selectSingle('asset-1')
      expect(store.isCurrent('asset-1')).toBe(true)
    })

    it('returns false for non-current item', () => {
      store.selectSingle('asset-1')
      store.addToSelection('asset-2')
      expect(store.isCurrent('asset-1')).toBe(false)
    })
  })
})
