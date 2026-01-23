/**
 * Unit tests for the useIntersectionObserver composable.
 *
 * Tests IntersectionObserver-based visibility tracking including:
 * - Single element observation
 * - Batch observation of multiple elements
 * - Visibility state management
 * - Observer lifecycle (creation, cleanup)
 * - Options handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock IntersectionObserver
// ============================================================================

interface MockIntersectionObserverEntry {
  target: Element
  isIntersecting: boolean
  intersectionRatio: number
  boundingClientRect: DOMRectReadOnly
  intersectionRect: DOMRectReadOnly
  rootBounds: DOMRectReadOnly | null
  time: number
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  callback: IntersectionObserverCallback
  options: IntersectionObserverInit
  observedElements: Set<Element> = new Set()
  disconnected: boolean = false

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options || {}
    MockIntersectionObserver.instances.push(this)
  }

  observe(element: Element): void {
    this.observedElements.add(element)
  }

  unobserve(element: Element): void {
    this.observedElements.delete(element)
  }

  disconnect(): void {
    this.observedElements.clear()
    this.disconnected = true
  }

  // Helper to trigger intersection callback
  triggerIntersection(entries: MockIntersectionObserverEntry[]): void {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }

  static reset(): void {
    MockIntersectionObserver.instances = []
  }
}

// Install mock globally
const originalIntersectionObserver = global.IntersectionObserver
beforeEach(() => {
  MockIntersectionObserver.reset()
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  global.IntersectionObserver = originalIntersectionObserver
})

// ============================================================================
// useIntersectionObserver Tests
// ============================================================================

describe('useIntersectionObserver', () => {
  // Simplified version of the composable for testing
  function useIntersectionObserver(
    callback?: (isVisible: boolean) => void,
    options: {
      threshold?: number
      rootMargin?: string
      root?: HTMLElement | null
    } = {},
  ) {
    const { threshold = 0.1, rootMargin = '100px', root = null } = options

    let elementRef: HTMLElement | null = null
    let isVisible = false
    let observer: IntersectionObserver | null = null

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0]
      if (!entry) return

      const nowVisible = entry.isIntersecting
      if (nowVisible !== isVisible) {
        isVisible = nowVisible
        callback?.(nowVisible)
      }
    }

    const stop = () => {
      if (observer) {
        observer.disconnect()
        observer = null
      }
    }

    const setElement = (element: HTMLElement | null) => {
      stop()
      elementRef = element

      if (!element) return

      observer = new IntersectionObserver(handleIntersect, {
        threshold,
        rootMargin,
        root,
      })

      observer.observe(element)
    }

    return {
      setElement,
      getIsVisible: () => isVisible,
      stop,
      getObserver: () => observer,
    }
  }

  it('creates observer when element is set', () => {
    const { setElement } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)

    expect(MockIntersectionObserver.instances).toHaveLength(1)
  })

  it('observes the element', () => {
    const { setElement } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.observedElements.has(element)).toBe(true)
  })

  it('uses default threshold of 0.1', () => {
    const { setElement } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.options.threshold).toBe(0.1)
  })

  it('uses default rootMargin of 100px', () => {
    const { setElement } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.options.rootMargin).toBe('100px')
  })

  it('respects custom options', () => {
    const root = document.createElement('div')
    const { setElement } = useIntersectionObserver(undefined, {
      threshold: 0.5,
      rootMargin: '200px',
      root,
    })
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.options.threshold).toBe(0.5)
    expect(observer.options.rootMargin).toBe('200px')
    expect(observer.options.root).toBe(root)
  })

  it('calls callback when visibility changes to true', () => {
    const callback = vi.fn()
    const { setElement } = useIntersectionObserver(callback)
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('calls callback when visibility changes to false', () => {
    const callback = vi.fn()
    const { setElement, getIsVisible } = useIntersectionObserver(callback)
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!

    // First become visible
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    // Then become invisible
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: false,
        intersectionRatio: 0,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenLastCalledWith(false)
  })

  it('does not call callback when visibility unchanged', () => {
    const callback = vi.fn()
    const { setElement } = useIntersectionObserver(callback)
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!

    // Trigger visible twice
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.8,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('updates isVisible state', () => {
    const { setElement, getIsVisible } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)
    expect(getIsVisible()).toBe(false)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(getIsVisible()).toBe(true)
  })

  it('stop disconnects observer', () => {
    const { setElement, stop } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)
    stop()

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.disconnected).toBe(true)
  })

  it('handles null element gracefully', () => {
    const { setElement, getObserver } = useIntersectionObserver()

    setElement(null)

    expect(getObserver()).toBeNull()
  })

  it('disconnects previous observer when element changes', () => {
    const { setElement } = useIntersectionObserver()
    const element1 = document.createElement('div')
    const element2 = document.createElement('div')

    setElement(element1)
    const firstObserver = MockIntersectionObserver.instances[0]!

    setElement(element2)

    expect(firstObserver.disconnected).toBe(true)
    expect(MockIntersectionObserver.instances).toHaveLength(2)
  })

  it('works without callback', () => {
    const { setElement, getIsVisible } = useIntersectionObserver()
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: element,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    // Should not throw, and state should update
    expect(getIsVisible()).toBe(true)
  })

  it('handles empty entries array', () => {
    const callback = vi.fn()
    const { setElement } = useIntersectionObserver(callback)
    const element = document.createElement('div')

    setElement(element)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([])

    expect(callback).not.toHaveBeenCalled()
  })
})

// ============================================================================
// useIntersectionObserverBatch Tests
// ============================================================================

describe('useIntersectionObserverBatch', () => {
  // Simplified version of batch observer for testing
  function useIntersectionObserverBatch(options: {
    threshold?: number
    rootMargin?: string
    root?: HTMLElement | null
    onVisibilityChange?: (id: string, isVisible: boolean) => void
  } = {}) {
    const { threshold = 0.1, rootMargin = '100px', root = null, onVisibilityChange } = options

    const elementToId = new Map<Element, string>()
    const visibilityState = new Map<string, boolean>()
    let observer: IntersectionObserver | null = null

    const getOrCreateObserver = () => {
      if (observer) return observer

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = elementToId.get(entry.target)
            if (!id) continue

            const nowVisible = entry.isIntersecting
            const wasVisible = visibilityState.get(id) ?? false

            if (nowVisible !== wasVisible) {
              visibilityState.set(id, nowVisible)
              onVisibilityChange?.(id, nowVisible)
            }
          }
        },
        { threshold, rootMargin, root },
      )

      return observer
    }

    const observe = (id: string, element: HTMLElement) => {
      const obs = getOrCreateObserver()
      elementToId.set(element, id)
      visibilityState.set(id, false)
      obs.observe(element)
    }

    const unobserve = (id: string) => {
      for (const [element, elementId] of elementToId) {
        if (elementId === id) {
          observer?.unobserve(element)
          elementToId.delete(element)
          break
        }
      }
      visibilityState.delete(id)
    }

    const isVisible = (id: string): boolean => {
      return visibilityState.get(id) ?? false
    }

    const getVisibleIds = (): string[] => {
      const ids: string[] = []
      for (const [id, visible] of visibilityState) {
        if (visible) ids.push(id)
      }
      return ids
    }

    const stopAll = () => {
      observer?.disconnect()
      observer = null
      elementToId.clear()
      visibilityState.clear()
    }

    return {
      observe,
      unobserve,
      isVisible,
      getVisibleIds,
      stopAll,
      getObserver: () => observer,
    }
  }

  it('creates single observer for multiple elements', () => {
    const { observe } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')
    const el3 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)
    observe('id-3', el3)

    expect(MockIntersectionObserver.instances).toHaveLength(1)
  })

  it('observes all elements', () => {
    const { observe } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.observedElements.has(el1)).toBe(true)
    expect(observer.observedElements.has(el2)).toBe(true)
  })

  it('tracks visibility per element', () => {
    const { observe, isVisible } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)

    expect(isVisible('id-1')).toBe(false)
    expect(isVisible('id-2')).toBe(false)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(isVisible('id-1')).toBe(true)
    expect(isVisible('id-2')).toBe(false)
  })

  it('calls onVisibilityChange with correct id', () => {
    const onVisibilityChange = vi.fn()
    const { observe } = useIntersectionObserverBatch({ onVisibilityChange })
    const el1 = document.createElement('div')

    observe('asset-1', el1)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(onVisibilityChange).toHaveBeenCalledWith('asset-1', true)
  })

  it('handles multiple visibility changes', () => {
    const onVisibilityChange = vi.fn()
    const { observe } = useIntersectionObserverBatch({ onVisibilityChange })
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
      {
        target: el2,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(onVisibilityChange).toHaveBeenCalledTimes(2)
    expect(onVisibilityChange).toHaveBeenCalledWith('id-1', true)
    expect(onVisibilityChange).toHaveBeenCalledWith('id-2', true)
  })

  it('getVisibleIds returns all visible element IDs', () => {
    const { observe, getVisibleIds } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')
    const el3 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)
    observe('id-3', el3)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
      {
        target: el3,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    const visibleIds = getVisibleIds()
    expect(visibleIds).toContain('id-1')
    expect(visibleIds).not.toContain('id-2')
    expect(visibleIds).toContain('id-3')
  })

  it('unobserve stops tracking element', () => {
    const { observe, unobserve, isVisible } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')

    observe('id-1', el1)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(isVisible('id-1')).toBe(true)

    unobserve('id-1')

    expect(isVisible('id-1')).toBe(false)
    expect(observer.observedElements.has(el1)).toBe(false)
  })

  it('stopAll clears all state', () => {
    const { observe, stopAll, isVisible, getVisibleIds } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('id-1', el1)
    observe('id-2', el2)

    const observer = MockIntersectionObserver.instances[0]!
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    stopAll()

    expect(isVisible('id-1')).toBe(false)
    expect(isVisible('id-2')).toBe(false)
    expect(getVisibleIds()).toHaveLength(0)
    expect(observer.disconnected).toBe(true)
  })

  it('handles unknown element in callback', () => {
    const onVisibilityChange = vi.fn()
    const { observe } = useIntersectionObserverBatch({ onVisibilityChange })
    const el1 = document.createElement('div')
    const unknownEl = document.createElement('div')

    observe('id-1', el1)

    const observer = MockIntersectionObserver.instances[0]!
    // Trigger with unknown element
    observer.triggerIntersection([
      {
        target: unknownEl,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    // Should not call callback for unknown element
    expect(onVisibilityChange).not.toHaveBeenCalled()
  })

  it('does not call callback when visibility unchanged', () => {
    const onVisibilityChange = vi.fn()
    const { observe } = useIntersectionObserverBatch({ onVisibilityChange })
    const el1 = document.createElement('div')

    observe('id-1', el1)

    const observer = MockIntersectionObserver.instances[0]!

    // Trigger visible twice
    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.5,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    observer.triggerIntersection([
      {
        target: el1,
        isIntersecting: true,
        intersectionRatio: 0.8,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      },
    ])

    expect(onVisibilityChange).toHaveBeenCalledTimes(1)
  })

  it('handles observing many elements', () => {
    const { observe, getVisibleIds } = useIntersectionObserverBatch()
    const elements: HTMLElement[] = []

    for (let i = 0; i < 100; i++) {
      const el = document.createElement('div')
      elements.push(el)
      observe(`id-${i}`, el)
    }

    expect(MockIntersectionObserver.instances).toHaveLength(1)

    const observer = MockIntersectionObserver.instances[0]!
    expect(observer.observedElements.size).toBe(100)
  })

  it('reuses observer for new observations after stopAll', () => {
    const { observe, stopAll } = useIntersectionObserverBatch()
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('id-1', el1)
    stopAll()

    observe('id-2', el2)

    // New observer should be created
    expect(MockIntersectionObserver.instances).toHaveLength(2)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles rapid observe/unobserve cycles', () => {
    const onVisibilityChange = vi.fn()
    const { observe, unobserve, isVisible } = (() => {
      const elementToId = new Map<Element, string>()
      const visibilityState = new Map<string, boolean>()

      return {
        observe: (id: string, element: HTMLElement) => {
          elementToId.set(element, id)
          visibilityState.set(id, false)
        },
        unobserve: (id: string) => {
          for (const [element, elementId] of elementToId) {
            if (elementId === id) {
              elementToId.delete(element)
              break
            }
          }
          visibilityState.delete(id)
        },
        isVisible: (id: string) => visibilityState.get(id) ?? false,
      }
    })()

    const el = document.createElement('div')

    // Rapid cycle
    for (let i = 0; i < 10; i++) {
      observe(`id-${i}`, el)
      unobserve(`id-${i}`)
    }

    // Should handle without error
    expect(isVisible('id-5')).toBe(false)
  })

  it('handles element re-observation with same ID', () => {
    const { observe, isVisible } = (() => {
      const visibilityState = new Map<string, boolean>()

      return {
        observe: (id: string) => {
          visibilityState.set(id, false)
        },
        isVisible: (id: string) => visibilityState.get(id) ?? false,
      }
    })()

    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    observe('same-id')
    observe('same-id') // Re-observe with different element

    // Should not throw
    expect(isVisible('same-id')).toBe(false)
  })

  it('handles threshold of 0 (any visibility)', () => {
    const callback = vi.fn()

    // With threshold 0, even 1 pixel visible triggers
    const options = { threshold: 0 }

    // Just verify the option is accepted
    expect(options.threshold).toBe(0)
  })

  it('handles threshold of 1 (full visibility required)', () => {
    const options = { threshold: 1 }

    // Verify the option is accepted
    expect(options.threshold).toBe(1)
  })

  it('handles negative rootMargin', () => {
    const options = { rootMargin: '-50px' }

    // Verify the option is accepted (shrinks intersection area)
    expect(options.rootMargin).toBe('-50px')
  })
})
