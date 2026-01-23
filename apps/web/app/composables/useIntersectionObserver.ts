/**
 * Composable for tracking element visibility using IntersectionObserver.
 *
 * Useful for:
 * - Lazy loading thumbnails
 * - Triggering animations when elements enter viewport
 * - Viewport-aware priority updates
 */

export interface UseIntersectionObserverOptions {
  /**
   * Percentage of element that must be visible to trigger callback.
   * 0 = any pixel visible, 1 = fully visible.
   * @default 0.1
   */
  threshold?: number
  /**
   * Margin around the root element for early detection.
   * Use positive values to trigger before element is visible.
   * @default '100px'
   */
  rootMargin?: string
  /**
   * Root element to use as viewport. Null means browser viewport.
   * @default null
   */
  root?: HTMLElement | null
}

export interface UseIntersectionObserverReturn {
  /**
   * Ref to attach to the target element.
   */
  elementRef: Ref<HTMLElement | null>
  /**
   * Whether the element is currently visible.
   */
  isVisible: Ref<boolean>
  /**
   * Stop observing and cleanup.
   */
  stop: () => void
}

/**
 * Track visibility of an element using IntersectionObserver.
 *
 * @param callback - Called when visibility changes
 * @param options - Observer configuration
 * @returns Element ref and visibility state
 *
 * @example
 * ```vue
 * <script setup>
 * const { elementRef, isVisible } = useIntersectionObserver(
 *   (visible) => {
 *     if (visible) loadThumbnail()
 *   },
 *   { rootMargin: '200px' }
 * )
 * </script>
 *
 * <template>
 *   <div ref="elementRef">
 *     <img v-if="isVisible" :src="thumbnailUrl" />
 *     <div v-else class="placeholder" />
 *   </div>
 * </template>
 * ```
 */
export function useIntersectionObserver(
  callback?: (isVisible: boolean) => void,
  options: UseIntersectionObserverOptions = {},
): UseIntersectionObserverReturn {
  const {
    threshold = 0.1,
    rootMargin = '100px',
    root = null,
  } = options

  const elementRef = ref<HTMLElement | null>(null)
  const isVisible = ref(false)

  let observer: IntersectionObserver | null = null

  const handleIntersect = (entries: IntersectionObserverEntry[]) => {
    const entry = entries[0]
    if (!entry) return

    const nowVisible = entry.isIntersecting
    if (nowVisible !== isVisible.value) {
      isVisible.value = nowVisible
      callback?.(nowVisible)
    }
  }

  const stop = () => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  // Watch for element ref changes
  watch(
    elementRef,
    (element, _oldElement, onCleanup) => {
      // Cleanup previous observer
      stop()

      if (!element) return

      // Create new observer
      observer = new IntersectionObserver(handleIntersect, {
        threshold,
        rootMargin,
        root,
      })

      observer.observe(element)

      onCleanup(() => {
        stop()
      })
    },
    { immediate: true },
  )

  // Cleanup on unmount
  onUnmounted(() => {
    stop()
  })

  return {
    elementRef,
    isVisible,
    stop,
  }
}

/**
 * Observe multiple elements and track their visibility.
 *
 * More efficient than creating multiple observers when tracking many elements.
 *
 * @param options - Observer configuration
 * @returns Functions to observe/unobserve elements and check visibility
 *
 * @example
 * ```typescript
 * const { observe, unobserve, isVisible } = useIntersectionObserverBatch({
 *   rootMargin: '200px',
 *   onVisibilityChange: (id, visible) => {
 *     if (visible) requestThumbnail(id)
 *   }
 * })
 *
 * // Observe elements
 * observe('asset-1', element1)
 * observe('asset-2', element2)
 *
 * // Check visibility
 * if (isVisible('asset-1')) { ... }
 * ```
 */
export interface UseIntersectionObserverBatchOptions {
  threshold?: number
  rootMargin?: string
  root?: HTMLElement | null
  /**
   * Called when an element's visibility changes.
   */
  onVisibilityChange?: (id: string, isVisible: boolean) => void
}

export interface UseIntersectionObserverBatchReturn {
  /**
   * Start observing an element.
   */
  observe: (id: string, element: HTMLElement) => void
  /**
   * Stop observing an element.
   */
  unobserve: (id: string) => void
  /**
   * Check if an element is visible.
   */
  isVisible: (id: string) => boolean
  /**
   * Get all visible element IDs.
   */
  getVisibleIds: () => string[]
  /**
   * Stop observing all elements.
   */
  stopAll: () => void
}

export function useIntersectionObserverBatch(
  options: UseIntersectionObserverBatchOptions = {},
): UseIntersectionObserverBatchReturn {
  const {
    threshold = 0.1,
    rootMargin = '100px',
    root = null,
    onVisibilityChange,
  } = options

  // Map element to ID for reverse lookup in observer callback
  const elementToId = new Map<Element, string>()
  // Track visibility state per ID
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
    // Find element by ID
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

  // Cleanup on unmount
  onUnmounted(() => {
    stopAll()
  })

  return {
    observe,
    unobserve,
    isVisible,
    getVisibleIds,
    stopAll,
  }
}
