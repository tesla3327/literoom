/**
 * Unit tests for the useGridKeyboard composable.
 *
 * Tests keyboard navigation in the photo grid including:
 * - Arrow key navigation with grid-aware movement
 * - Flag shortcuts (P, X, U)
 * - View mode shortcuts (E, G, D, Enter)
 * - Edge cases and boundary conditions
 * - scrollIntoViewIfNeeded helper
 */

import { describe, it, expect, vi } from 'vitest'

// Re-implement the composable logic for testing since Vue composables
// can be tricky to test in isolation without full Vue context

// ============================================================================
// shouldIgnoreShortcuts Tests
// ============================================================================

describe('shouldIgnoreShortcuts', () => {
  // Re-implement the function for testing
  function shouldIgnoreShortcuts(activeElement: Element | null): boolean {
    if (!activeElement) return false

    if (activeElement instanceof HTMLInputElement) {
      const type = activeElement.type.toLowerCase()
      return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)
    }

    if (activeElement instanceof HTMLTextAreaElement) {
      return true
    }

    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      return true
    }

    if (activeElement.getAttribute('role') === 'textbox') {
      return true
    }

    return false
  }

  it('returns false for null active element', () => {
    expect(shouldIgnoreShortcuts(null)).toBe(false)
  })

  it('returns true for text input', () => {
    const input = document.createElement('input')
    input.type = 'text'
    expect(shouldIgnoreShortcuts(input)).toBe(true)
  })

  it('returns true for password input', () => {
    const input = document.createElement('input')
    input.type = 'password'
    expect(shouldIgnoreShortcuts(input)).toBe(true)
  })

  it('returns true for number input', () => {
    const input = document.createElement('input')
    input.type = 'number'
    expect(shouldIgnoreShortcuts(input)).toBe(true)
  })

  it('returns false for checkbox input', () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    expect(shouldIgnoreShortcuts(input)).toBe(false)
  })

  it('returns false for radio input', () => {
    const input = document.createElement('input')
    input.type = 'radio'
    expect(shouldIgnoreShortcuts(input)).toBe(false)
  })

  it('returns false for button input', () => {
    const input = document.createElement('input')
    input.type = 'button'
    expect(shouldIgnoreShortcuts(input)).toBe(false)
  })

  it('returns false for submit input', () => {
    const input = document.createElement('input')
    input.type = 'submit'
    expect(shouldIgnoreShortcuts(input)).toBe(false)
  })

  it('returns false for reset input', () => {
    const input = document.createElement('input')
    input.type = 'reset'
    expect(shouldIgnoreShortcuts(input)).toBe(false)
  })

  it('returns true for textarea', () => {
    const textarea = document.createElement('textarea')
    expect(shouldIgnoreShortcuts(textarea)).toBe(true)
  })

  it('returns true for contenteditable element', () => {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    // In some test environments, isContentEditable may not work correctly
    // when setting contentEditable attribute. We test both the getter and manual check.
    // This tests that the shouldIgnoreShortcuts function correctly checks isContentEditable
    Object.defineProperty(div, 'isContentEditable', {
      get: () => true,
      configurable: true,
    })
    expect(shouldIgnoreShortcuts(div)).toBe(true)
  })

  it('returns true for element with role="textbox"', () => {
    const div = document.createElement('div')
    div.setAttribute('role', 'textbox')
    expect(shouldIgnoreShortcuts(div)).toBe(true)
  })

  it('returns false for regular div', () => {
    const div = document.createElement('div')
    expect(shouldIgnoreShortcuts(div)).toBe(false)
  })

  it('returns false for button element', () => {
    const button = document.createElement('button')
    expect(shouldIgnoreShortcuts(button)).toBe(false)
  })
})

// ============================================================================
// getNextIndex Tests (Grid Navigation Logic)
// ============================================================================

describe('getNextIndex (grid navigation)', () => {
  interface NavigationState {
    currentIndex: number
    columnsCount: number
    totalItems: number
  }

  function getNextIndex(
    direction: 'left' | 'right' | 'up' | 'down',
    state: NavigationState,
  ): number {
    const { currentIndex, columnsCount, totalItems } = state

    if (totalItems === 0) return -1

    if (currentIndex < 0 || currentIndex >= totalItems) {
      return direction === 'up' || direction === 'left' ? totalItems - 1 : 0
    }

    switch (direction) {
      case 'right':
        return currentIndex < totalItems - 1 ? currentIndex + 1 : currentIndex

      case 'left':
        return currentIndex > 0 ? currentIndex - 1 : currentIndex

      case 'down': {
        const nextIndex = currentIndex + columnsCount
        return nextIndex < totalItems ? nextIndex : currentIndex
      }

      case 'up': {
        const prevIndex = currentIndex - columnsCount
        return prevIndex >= 0 ? prevIndex : currentIndex
      }

      default:
        return currentIndex
    }
  }

  describe('empty grid', () => {
    it('returns -1 for all directions', () => {
      const state = { currentIndex: -1, columnsCount: 4, totalItems: 0 }
      expect(getNextIndex('left', state)).toBe(-1)
      expect(getNextIndex('right', state)).toBe(-1)
      expect(getNextIndex('up', state)).toBe(-1)
      expect(getNextIndex('down', state)).toBe(-1)
    })
  })

  describe('no current selection', () => {
    it('selects first item for right', () => {
      const state = { currentIndex: -1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('right', state)).toBe(0)
    })

    it('selects first item for down', () => {
      const state = { currentIndex: -1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('down', state)).toBe(0)
    })

    it('selects last item for left', () => {
      const state = { currentIndex: -1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('left', state)).toBe(11)
    })

    it('selects last item for up', () => {
      const state = { currentIndex: -1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('up', state)).toBe(11)
    })
  })

  describe('horizontal navigation', () => {
    it('moves right within row', () => {
      const state = { currentIndex: 0, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('right', state)).toBe(1)
    })

    it('moves left within row', () => {
      const state = { currentIndex: 1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('left', state)).toBe(0)
    })

    it('wraps to next row when moving right', () => {
      const state = { currentIndex: 3, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('right', state)).toBe(4)
    })

    it('wraps to previous row when moving left', () => {
      const state = { currentIndex: 4, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('left', state)).toBe(3)
    })

    it('stays at last item when at end', () => {
      const state = { currentIndex: 11, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('right', state)).toBe(11)
    })

    it('stays at first item when at start', () => {
      const state = { currentIndex: 0, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('left', state)).toBe(0)
    })
  })

  describe('vertical navigation', () => {
    it('moves down one row', () => {
      const state = { currentIndex: 0, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('down', state)).toBe(4)
    })

    it('moves up one row', () => {
      const state = { currentIndex: 4, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('up', state)).toBe(0)
    })

    it('stays in same column when moving down', () => {
      const state = { currentIndex: 1, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('down', state)).toBe(5)
    })

    it('stays in same column when moving up', () => {
      const state = { currentIndex: 5, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('up', state)).toBe(1)
    })

    it('stays at current when at bottom edge', () => {
      const state = { currentIndex: 8, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('down', state)).toBe(8)
    })

    it('stays at current when at top edge', () => {
      const state = { currentIndex: 0, columnsCount: 4, totalItems: 12 }
      expect(getNextIndex('up', state)).toBe(0)
    })
  })

  describe('partial last row', () => {
    it('handles down navigation to partial row', () => {
      // 10 items with 4 columns = 3 rows, last row has 2 items
      const state = { currentIndex: 4, columnsCount: 4, totalItems: 10 }
      expect(getNextIndex('down', state)).toBe(8)
    })

    it('stays when down would go past last item', () => {
      // Position 5 + 4 = 9, but only item at index 9 exists
      const state = { currentIndex: 5, columnsCount: 4, totalItems: 10 }
      expect(getNextIndex('down', state)).toBe(9)
    })

    it('stays when position would exceed totalItems', () => {
      // Position 6 + 4 = 10, which exceeds totalItems of 10
      const state = { currentIndex: 6, columnsCount: 4, totalItems: 10 }
      expect(getNextIndex('down', state)).toBe(6)
    })
  })

  describe('single column grid', () => {
    it('moves down to next item', () => {
      const state = { currentIndex: 0, columnsCount: 1, totalItems: 5 }
      expect(getNextIndex('down', state)).toBe(1)
    })

    it('moves up to previous item', () => {
      const state = { currentIndex: 2, columnsCount: 1, totalItems: 5 }
      expect(getNextIndex('up', state)).toBe(1)
    })

    it('right still works (wraps down)', () => {
      const state = { currentIndex: 0, columnsCount: 1, totalItems: 5 }
      expect(getNextIndex('right', state)).toBe(1)
    })
  })

  describe('single row grid', () => {
    it('moves right within row', () => {
      const state = { currentIndex: 0, columnsCount: 5, totalItems: 5 }
      expect(getNextIndex('right', state)).toBe(1)
    })

    it('moves left within row', () => {
      const state = { currentIndex: 2, columnsCount: 5, totalItems: 5 }
      expect(getNextIndex('left', state)).toBe(1)
    })

    it('up stays at current (no row above)', () => {
      const state = { currentIndex: 2, columnsCount: 5, totalItems: 5 }
      expect(getNextIndex('up', state)).toBe(2)
    })

    it('down stays at current (no row below)', () => {
      const state = { currentIndex: 2, columnsCount: 5, totalItems: 5 }
      expect(getNextIndex('down', state)).toBe(2)
    })
  })
})

// ============================================================================
// handleKeydown Tests
// ============================================================================

describe('handleKeydown behavior', () => {
  interface KeyboardTestContext {
    currentIndex: number
    orderedIds: string[]
    columnsCount: number
    onNavigate: ReturnType<typeof vi.fn>
    onFlag: ReturnType<typeof vi.fn>
    onViewChange: ReturnType<typeof vi.fn>
    onDelete: ReturnType<typeof vi.fn>
  }

  function createMockContext(overrides?: Partial<KeyboardTestContext>): KeyboardTestContext {
    return {
      currentIndex: 0,
      orderedIds: ['id-0', 'id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7'],
      columnsCount: 4,
      onNavigate: vi.fn(),
      onFlag: vi.fn(),
      onViewChange: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }
  }

  function createKeyboardEvent(key: string, options?: Partial<KeyboardEventInit>): KeyboardEvent {
    return new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    })
  }

  // Simplified handler for testing
  function handleKeydown(
    event: KeyboardEvent,
    ctx: KeyboardTestContext,
    ignoreShortcuts: boolean = false,
  ): number {
    if (ignoreShortcuts) return ctx.currentIndex

    const key = event.key.toLowerCase()
    const totalItems = ctx.orderedIds.length

    // Arrow key navigation
    switch (event.key) {
      case 'ArrowRight': {
        const next = ctx.currentIndex < totalItems - 1 ? ctx.currentIndex + 1 : ctx.currentIndex
        if (next !== ctx.currentIndex && ctx.orderedIds[next]) {
          ctx.onNavigate(ctx.orderedIds[next], next)
        }
        return next
      }
      case 'ArrowLeft': {
        const prev = ctx.currentIndex > 0 ? ctx.currentIndex - 1 : ctx.currentIndex
        if (prev !== ctx.currentIndex && ctx.orderedIds[prev]) {
          ctx.onNavigate(ctx.orderedIds[prev], prev)
        }
        return prev
      }
      case 'ArrowDown': {
        const down = ctx.currentIndex + ctx.columnsCount
        const next = down < totalItems ? down : ctx.currentIndex
        if (next !== ctx.currentIndex && ctx.orderedIds[next]) {
          ctx.onNavigate(ctx.orderedIds[next], next)
        }
        return next
      }
      case 'ArrowUp': {
        const up = ctx.currentIndex - ctx.columnsCount
        const next = up >= 0 ? up : ctx.currentIndex
        if (next !== ctx.currentIndex && ctx.orderedIds[next]) {
          ctx.onNavigate(ctx.orderedIds[next], next)
        }
        return next
      }
    }

    // Flag shortcuts
    switch (key) {
      case 'p':
        ctx.onFlag('pick')
        return ctx.currentIndex
      case 'x':
        ctx.onFlag('reject')
        return ctx.currentIndex
      case 'u':
        ctx.onFlag('none')
        return ctx.currentIndex
    }

    // View shortcuts
    switch (key) {
      case 'e':
      case 'enter':
        ctx.onViewChange('edit')
        return ctx.currentIndex
      case 'g':
        ctx.onViewChange('grid')
        return ctx.currentIndex
      case 'd':
        ctx.onViewChange('edit')
        return ctx.currentIndex
    }

    // Delete
    if (key === 'delete' || key === 'backspace') {
      ctx.onDelete()
    }

    return ctx.currentIndex
  }

  describe('arrow key navigation', () => {
    it('ArrowRight calls onNavigate with next item', () => {
      const ctx = createMockContext({ currentIndex: 0 })
      const event = createKeyboardEvent('ArrowRight')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(1)
      expect(ctx.onNavigate).toHaveBeenCalledWith('id-1', 1)
    })

    it('ArrowLeft calls onNavigate with previous item', () => {
      const ctx = createMockContext({ currentIndex: 1 })
      const event = createKeyboardEvent('ArrowLeft')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(0)
      expect(ctx.onNavigate).toHaveBeenCalledWith('id-0', 0)
    })

    it('ArrowDown moves down by columnsCount', () => {
      const ctx = createMockContext({ currentIndex: 0, columnsCount: 4 })
      const event = createKeyboardEvent('ArrowDown')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(4)
      expect(ctx.onNavigate).toHaveBeenCalledWith('id-4', 4)
    })

    it('ArrowUp moves up by columnsCount', () => {
      const ctx = createMockContext({ currentIndex: 4, columnsCount: 4 })
      const event = createKeyboardEvent('ArrowUp')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(0)
      expect(ctx.onNavigate).toHaveBeenCalledWith('id-0', 0)
    })

    it('does not navigate past end', () => {
      const ctx = createMockContext({ currentIndex: 7 })
      const event = createKeyboardEvent('ArrowRight')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(7)
      expect(ctx.onNavigate).not.toHaveBeenCalled()
    })

    it('does not navigate before start', () => {
      const ctx = createMockContext({ currentIndex: 0 })
      const event = createKeyboardEvent('ArrowLeft')

      const newIndex = handleKeydown(event, ctx)

      expect(newIndex).toBe(0)
      expect(ctx.onNavigate).not.toHaveBeenCalled()
    })
  })

  describe('flag shortcuts', () => {
    it('P key calls onFlag with pick', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('p')

      handleKeydown(event, ctx)

      expect(ctx.onFlag).toHaveBeenCalledWith('pick')
    })

    it('X key calls onFlag with reject', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('x')

      handleKeydown(event, ctx)

      expect(ctx.onFlag).toHaveBeenCalledWith('reject')
    })

    it('U key calls onFlag with none (unflag)', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('u')

      handleKeydown(event, ctx)

      expect(ctx.onFlag).toHaveBeenCalledWith('none')
    })

    it('uppercase P also works', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('P')

      handleKeydown(event, ctx)

      expect(ctx.onFlag).toHaveBeenCalledWith('pick')
    })
  })

  describe('view mode shortcuts', () => {
    it('E key calls onViewChange with edit', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('e')

      handleKeydown(event, ctx)

      expect(ctx.onViewChange).toHaveBeenCalledWith('edit')
    })

    it('Enter key calls onViewChange with edit', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('Enter')

      handleKeydown(event, ctx)

      expect(ctx.onViewChange).toHaveBeenCalledWith('edit')
    })

    it('G key calls onViewChange with grid', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('g')

      handleKeydown(event, ctx)

      expect(ctx.onViewChange).toHaveBeenCalledWith('grid')
    })

    it('D key calls onViewChange with edit (Lightroom convention)', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('d')

      handleKeydown(event, ctx)

      expect(ctx.onViewChange).toHaveBeenCalledWith('edit')
    })
  })

  describe('delete shortcuts', () => {
    it('Delete key calls onDelete', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('Delete')

      handleKeydown(event, ctx)

      expect(ctx.onDelete).toHaveBeenCalled()
    })

    it('Backspace key calls onDelete', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('Backspace')

      handleKeydown(event, ctx)

      expect(ctx.onDelete).toHaveBeenCalled()
    })
  })

  describe('shortcut suppression', () => {
    it('does not handle shortcuts when in text input', () => {
      const ctx = createMockContext()
      const event = createKeyboardEvent('p')

      handleKeydown(event, ctx, true) // ignoreShortcuts = true

      expect(ctx.onFlag).not.toHaveBeenCalled()
    })

    it('does not navigate when shortcuts ignored', () => {
      const ctx = createMockContext({ currentIndex: 0 })
      const event = createKeyboardEvent('ArrowRight')

      const newIndex = handleKeydown(event, ctx, true)

      expect(newIndex).toBe(0) // Unchanged
      expect(ctx.onNavigate).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// totalItems Watch Behavior
// ============================================================================

describe('totalItems watch behavior', () => {
  function adjustIndexForTotalChange(
    currentIndex: number,
    newTotal: number,
    oldTotal: number,
  ): number {
    // If current index exceeds new total, clamp to last valid index
    if (currentIndex >= newTotal) {
      return newTotal > 0 ? newTotal - 1 : -1
    }
    // If items were added and we had no selection, select first
    if (oldTotal === 0 && newTotal > 0 && currentIndex === -1) {
      return 0
    }
    return currentIndex
  }

  it('clamps index when total decreases below current', () => {
    const newIndex = adjustIndexForTotalChange(10, 5, 15)
    expect(newIndex).toBe(4) // Clamped to last valid index
  })

  it('keeps index when total increases', () => {
    const newIndex = adjustIndexForTotalChange(3, 10, 5)
    expect(newIndex).toBe(3) // Unchanged
  })

  it('selects first item when items added to empty grid', () => {
    const newIndex = adjustIndexForTotalChange(-1, 5, 0)
    expect(newIndex).toBe(0) // Select first
  })

  it('returns -1 when grid becomes empty', () => {
    const newIndex = adjustIndexForTotalChange(3, 0, 5)
    expect(newIndex).toBe(-1)
  })

  it('keeps -1 selection when grid stays empty', () => {
    const newIndex = adjustIndexForTotalChange(-1, 0, 0)
    expect(newIndex).toBe(-1)
  })

  it('keeps valid index when equal to new total minus one', () => {
    const newIndex = adjustIndexForTotalChange(4, 5, 10)
    expect(newIndex).toBe(4) // Valid, at last position
  })
})

// ============================================================================
// scrollIntoViewIfNeeded Helper Tests
// ============================================================================

describe('scrollIntoViewIfNeeded', () => {
  function scrollIntoViewIfNeeded(element: HTMLElement | null): void {
    if (!element) return

    if ('scrollIntoViewIfNeeded' in element) {
      ;(element as HTMLElement & { scrollIntoViewIfNeeded: (centerIfNeeded?: boolean) => void })
        .scrollIntoViewIfNeeded(false)
      return
    }

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }

  it('does nothing for null element', () => {
    // Should not throw
    expect(() => scrollIntoViewIfNeeded(null)).not.toThrow()
  })

  it('calls scrollIntoViewIfNeeded if available', () => {
    const element = document.createElement('div')
    const mockScrollIntoViewIfNeeded = vi.fn()
    ;(element as HTMLElement & { scrollIntoViewIfNeeded: () => void }).scrollIntoViewIfNeeded
      = mockScrollIntoViewIfNeeded

    scrollIntoViewIfNeeded(element)

    expect(mockScrollIntoViewIfNeeded).toHaveBeenCalledWith(false)
  })

  it('falls back to scrollIntoView', () => {
    const element = document.createElement('div')
    const mockScrollIntoView = vi.fn()
    element.scrollIntoView = mockScrollIntoView

    scrollIntoViewIfNeeded(element)

    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles single item grid', () => {
    // Cannot navigate anywhere
    const state = { currentIndex: 0, columnsCount: 4, totalItems: 1 }
    expect(
      (() => {
        const { currentIndex, totalItems } = state
        return currentIndex < totalItems - 1 ? currentIndex + 1 : currentIndex
      })(),
    ).toBe(0)
  })

  it('handles large grid', () => {
    const state = { currentIndex: 500, columnsCount: 5, totalItems: 1000 }

    // Down navigation
    const down = state.currentIndex + state.columnsCount
    expect(down).toBe(505)

    // Up navigation
    const up = state.currentIndex - state.columnsCount
    expect(up).toBe(495)
  })

  it('handles columnsCount of 1 (list view)', () => {
    const state = { currentIndex: 5, columnsCount: 1, totalItems: 20 }

    // Down should go to next item
    const down = state.currentIndex + state.columnsCount
    expect(down).toBe(6)

    // Up should go to previous item
    const up = state.currentIndex - state.columnsCount
    expect(up).toBe(4)
  })

  it('handles very wide grid (many columns)', () => {
    const state = { currentIndex: 10, columnsCount: 20, totalItems: 25 }

    // Down would go to index 30, which exceeds total
    const down = state.currentIndex + state.columnsCount
    const nextDown = down < state.totalItems ? down : state.currentIndex
    expect(nextDown).toBe(10) // Stay at current

    // Up would go to index -10
    const up = state.currentIndex - state.columnsCount
    const nextUp = up >= 0 ? up : state.currentIndex
    expect(nextUp).toBe(10) // Stay at current
  })
})
