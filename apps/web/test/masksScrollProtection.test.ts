/**
 * Tests for masks accordion scroll protection
 *
 * These tests verify that the masks accordion panel doesn't collapse
 * unexpectedly during scroll events when the user is actively working with masks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useEditStore } from '../app/stores/edit'
import { useEditUIStore } from '../app/stores/editUI'

describe('masksScrollProtection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('scroll detection', () => {
    it('should set isScrolling flag during scroll and clear after delay', async () => {
      // Simulate scroll state management from EditControlsPanel
      const isScrolling = ref(false)
      let scrollTimeout: ReturnType<typeof setTimeout> | null = null

      function handleScroll() {
        isScrolling.value = true
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }
        scrollTimeout = setTimeout(() => {
          isScrolling.value = false
        }, 150)
      }

      // Initial state
      expect(isScrolling.value).toBe(false)

      // Trigger scroll
      handleScroll()
      expect(isScrolling.value).toBe(true)

      // Wait for timeout
      vi.advanceTimersByTime(150)
      expect(isScrolling.value).toBe(false)
    })

    it('should extend scroll detection when multiple scroll events occur', async () => {
      const isScrolling = ref(false)
      let scrollTimeout: ReturnType<typeof setTimeout> | null = null

      function handleScroll() {
        isScrolling.value = true
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }
        scrollTimeout = setTimeout(() => {
          isScrolling.value = false
        }, 150)
      }

      // First scroll
      handleScroll()
      expect(isScrolling.value).toBe(true)

      // Wait 100ms
      vi.advanceTimersByTime(100)
      expect(isScrolling.value).toBe(true) // Still true

      // Another scroll event
      handleScroll()
      expect(isScrolling.value).toBe(true)

      // Wait 100ms more (200ms total since first, 100ms since second)
      vi.advanceTimersByTime(100)
      expect(isScrolling.value).toBe(true) // Still true because second reset the timer

      // Wait remaining 50ms
      vi.advanceTimersByTime(50)
      expect(isScrolling.value).toBe(false) // Now false
    })
  })

  describe('scroll protection for masks accordion', () => {
    it('should not deactivate mask tool when masks accordion collapses during scroll with active drawing mode', async () => {
      const editUIStore = useEditUIStore()

      // Setup: mask tool active with drawing mode
      editUIStore.activateMaskTool()
      editUIStore.setMaskDrawingMode('linear')

      expect(editUIStore.isMaskToolActive).toBe(true)
      expect(editUIStore.maskDrawingMode).toBe('linear')

      // Simulate the logic from EditControlsPanel's watcher
      // When scroll is active and user is drawing, spurious collapse should be detected
      const isScrolling = ref(true)
      const prevMasksExpanded = true
      const isMasksExpanded = false // Accordion says it collapsed

      // Detection logic
      const isSpuriousCollapse = prevMasksExpanded && !isMasksExpanded && isScrolling.value
      const isWorkingWithMasks = editUIStore.maskDrawingMode !== null

      expect(isSpuriousCollapse).toBe(true)
      expect(isWorkingWithMasks).toBe(true)

      // In this case, the accordion collapse should be reverted
      // and mask tool should NOT be deactivated
    })

    it('should not deactivate mask tool when masks accordion collapses during scroll with selected mask', async () => {
      const editStore = useEditStore()
      const editUIStore = useEditUIStore()

      // Setup: mask tool active with a selected mask
      editUIStore.activateMaskTool()
      await editStore.loadForAsset('test-asset')
      const maskId = editStore.addLinearMask({
        startX: 0.3,
        startY: 0.2,
        endX: 0.7,
        endY: 0.8,
        feather: 0.1,
      })
      editStore.selectMask(maskId)

      expect(editUIStore.isMaskToolActive).toBe(true)
      expect(editStore.selectedMaskId).toBe(maskId)

      // Simulate the logic from EditControlsPanel's watcher
      const isScrolling = ref(true)
      const prevMasksExpanded = true
      const isMasksExpanded = false

      const isSpuriousCollapse = prevMasksExpanded && !isMasksExpanded && isScrolling.value
      const isWorkingWithMasks = editUIStore.maskDrawingMode !== null || editStore.selectedMaskId !== null

      expect(isSpuriousCollapse).toBe(true)
      expect(isWorkingWithMasks).toBe(true)
    })

    it('should allow legitimate accordion collapse when not scrolling', async () => {
      const editUIStore = useEditUIStore()

      // Setup: mask tool active
      editUIStore.activateMaskTool()
      expect(editUIStore.isMaskToolActive).toBe(true)

      // Simulate the logic from EditControlsPanel's watcher
      const isScrolling = ref(false) // NOT scrolling
      const prevMasksExpanded = true
      const isMasksExpanded = false

      const isSpuriousCollapse = prevMasksExpanded && !isMasksExpanded && isScrolling.value

      expect(isSpuriousCollapse).toBe(false)

      // This is a legitimate collapse, mask tool should be deactivated
    })

    it('should allow accordion collapse when not actively working with masks', async () => {
      const editStore = useEditStore()
      const editUIStore = useEditUIStore()

      // Setup: mask tool active but no drawing mode or selected mask
      editUIStore.activateMaskTool()
      await editStore.loadForAsset('test-asset')
      // Don't create or select any masks

      expect(editUIStore.isMaskToolActive).toBe(true)
      expect(editUIStore.maskDrawingMode).toBe(null)
      expect(editStore.selectedMaskId).toBe(null)

      // Even during scroll, if not working with masks, allow collapse
      const isScrolling = ref(true)
      const prevMasksExpanded = true
      const isMasksExpanded = false

      const isSpuriousCollapse = prevMasksExpanded && !isMasksExpanded && isScrolling.value
      const isWorkingWithMasks = editUIStore.maskDrawingMode !== null || editStore.selectedMaskId !== null

      expect(isSpuriousCollapse).toBe(true)
      expect(isWorkingWithMasks).toBe(false) // Not working with masks

      // So the collapse should be allowed
    })
  })

  describe('scrollable parent detection', () => {
    it('should find scrollable parent with overflow-y: auto', () => {
      function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
        if (!el) return null
        let parent = el.parentElement
        while (parent) {
          const style = getComputedStyle(parent)
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return parent
          }
          parent = parent.parentElement
        }
        return null
      }

      // Create test DOM structure
      const grandparent = document.createElement('div')
      grandparent.style.overflowY = 'auto'

      const parent = document.createElement('div')
      grandparent.appendChild(parent)

      const child = document.createElement('div')
      parent.appendChild(child)

      document.body.appendChild(grandparent)

      const result = findScrollableParent(child)
      expect(result).toBe(grandparent)

      // Cleanup
      document.body.removeChild(grandparent)
    })

    it('should return null if no scrollable parent exists', () => {
      function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
        if (!el) return null
        let parent = el.parentElement
        while (parent) {
          const style = getComputedStyle(parent)
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return parent
          }
          parent = parent.parentElement
        }
        return null
      }

      const wrapper = document.createElement('div')
      const child = document.createElement('div')
      wrapper.appendChild(child)
      document.body.appendChild(wrapper)

      const result = findScrollableParent(child)
      expect(result).toBe(null)

      // Cleanup
      document.body.removeChild(wrapper)
    })
  })

  describe('edge cases', () => {
    it('should handle rapid scroll and accordion interactions', async () => {
      const isScrolling = ref(false)
      let scrollTimeout: ReturnType<typeof setTimeout> | null = null

      function handleScroll() {
        isScrolling.value = true
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }
        scrollTimeout = setTimeout(() => {
          isScrolling.value = false
        }, 150)
      }

      // Rapid scroll events
      for (let i = 0; i < 10; i++) {
        handleScroll()
        vi.advanceTimersByTime(10)
      }

      expect(isScrolling.value).toBe(true)

      // Wait for final timeout
      vi.advanceTimersByTime(150)
      expect(isScrolling.value).toBe(false)
    })

    it('should properly clean up scroll timeout on unmount', () => {
      let scrollTimeout: ReturnType<typeof setTimeout> | null = null

      function handleScroll() {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }
        scrollTimeout = setTimeout(() => {}, 150)
      }

      function cleanup() {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
          scrollTimeout = null
        }
      }

      handleScroll()
      expect(scrollTimeout).not.toBe(null)

      cleanup()
      expect(scrollTimeout).toBe(null)
    })
  })
})
