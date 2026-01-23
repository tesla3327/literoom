/**
 * useZoomPan Composable
 *
 * Manages zoom and pan functionality for the edit view preview canvas.
 * Handles mouse wheel zoom, click+drag pan, keyboard shortcuts, and
 * coordinates with the editUI store for state management.
 */

import type { ComputedRef, CSSProperties, Ref } from 'vue'

// ============================================================================
// Types
// ============================================================================

export interface UseZoomPanOptions {
  /** Container element ref (receives events) */
  containerRef: Ref<HTMLElement | null>
  /** Image element ref (for dimensions) */
  imageRef: Ref<HTMLImageElement | null>
  /** Whether zoom/pan is enabled */
  enabled?: Ref<boolean>
}

export interface UseZoomPanReturn {
  /** CSS transform style for the transform container */
  transformStyle: ComputedRef<CSSProperties>
  /** Cursor style based on zoom/pan state */
  cursorStyle: ComputedRef<string>
  /** Whether spacebar is held (temporary pan mode) */
  isSpacebarHeld: Ref<boolean>
  /** Zoom in by one step */
  zoomIn: () => void
  /** Zoom out by one step */
  zoomOut: () => void
  /** Toggle between fit and 100% zoom */
  toggleZoom: () => void
  /** Set a specific zoom preset */
  setPreset: (preset: 'fit' | 'fill' | '100%' | '200%') => void
  /** Reset to fit zoom */
  resetZoom: () => void
  /** Cleanup function */
  cleanup: () => void
}

// ============================================================================
// Composable
// ============================================================================

export function useZoomPan(options: UseZoomPanOptions): UseZoomPanReturn {
  const { containerRef, imageRef, enabled = ref(true) } = options
  const editUIStore = useEditUIStore()

  // ============================================================================
  // Local State
  // ============================================================================

  /** Whether currently panning (mouse dragging) */
  const isPanning = ref(false)

  /** Last mouse position during pan */
  const lastPanPos = ref<{ x: number; y: number } | null>(null)

  /** Whether spacebar is held (for temporary pan mode) */
  const isSpacebarHeld = ref(false)

  // ============================================================================
  // Computed
  // ============================================================================

  /** CSS transform style for the transform container */
  const transformStyle = computed<CSSProperties>(() => {
    const cam = editUIStore.camera
    return {
      transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.scale})`,
      transformOrigin: '0 0',
      willChange: editUIStore.isZoomInteracting ? 'transform' : 'auto',
    }
  })

  /** Cursor style based on zoom/pan state */
  const cursorStyle = computed(() => {
    if (isPanning.value) return 'grabbing'
    if (isSpacebarHeld.value && editUIStore.canPanImage) return 'grab'
    if (editUIStore.canPanImage) return 'grab'
    return 'default'
  })

  // ============================================================================
  // Mouse Wheel Zoom
  // ============================================================================

  function handleWheel(e: WheelEvent): void {
    if (!enabled.value) return

    // Prevent browser zoom and page scroll
    e.preventDefault()

    const container = containerRef.value
    if (!container) return

    // Get cursor position relative to container
    const rect = container.getBoundingClientRect()
    const pivotX = e.clientX - rect.left
    const pivotY = e.clientY - rect.top

    // Proportional zoom based on delta magnitude
    // Trackpad pinch (ctrlKey) typically has smaller deltas
    const isPinch = e.ctrlKey

    // Different sensitivity for pinch vs scroll
    // Pinch needs higher sensitivity since deltas are smaller
    const sensitivity = isPinch ? 0.01 : 0.002

    // Use exponential scaling for natural feel
    // Negative delta = zoom in, positive delta = zoom out
    const zoomFactor = Math.pow(2, -e.deltaY * sensitivity)

    // Clamp factor to prevent extreme jumps from fast scrolling
    const clampedFactor = Math.max(0.5, Math.min(2, zoomFactor))

    const newScale = editUIStore.camera.scale * clampedFactor

    // Zoom toward cursor position
    editUIStore.zoomToPointAction(newScale, pivotX, pivotY)
  }

  // ============================================================================
  // Mouse Pan
  // ============================================================================

  function handleMouseDown(e: MouseEvent): void {
    if (!enabled.value) return

    // Only handle primary button (left click)
    if (e.button !== 0) return

    // Check if we can pan (zoomed in or spacebar held)
    const canPan = editUIStore.canPanImage || isSpacebarHeld.value
    if (!canPan) return

    // Don't intercept clicks on crop/mask overlays
    const target = e.target as HTMLElement
    if (target.tagName === 'CANVAS') return

    isPanning.value = true
    lastPanPos.value = { x: e.clientX, y: e.clientY }
    editUIStore.setZoomInteracting(true)

    e.preventDefault()
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!isPanning.value || !lastPanPos.value) return

    const deltaX = e.clientX - lastPanPos.value.x
    const deltaY = e.clientY - lastPanPos.value.y

    editUIStore.pan(deltaX, deltaY)
    lastPanPos.value = { x: e.clientX, y: e.clientY }
  }

  function handleMouseUp(): void {
    if (isPanning.value) {
      isPanning.value = false
      lastPanPos.value = null
      editUIStore.setZoomInteracting(false)
    }
  }

  function handleMouseLeave(): void {
    handleMouseUp()
  }

  // ============================================================================
  // Double-Click Zoom Toggle
  // ============================================================================

  function handleDoubleClick(e: MouseEvent): void {
    if (!enabled.value) return

    // Don't intercept double-clicks on canvas overlays
    const target = e.target as HTMLElement
    if (target.tagName === 'CANVAS') return

    e.preventDefault()
    editUIStore.toggleZoom()
  }

  // ============================================================================
  // Keyboard (Spacebar for pan mode)
  // ============================================================================

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !isSpacebarHeld.value) {
      // Don't intercept if user is typing
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      isSpacebarHeld.value = true
      e.preventDefault()
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      isSpacebarHeld.value = false
    }
  }

  // ============================================================================
  // Image/Viewport Dimension Tracking
  // ============================================================================

  function updateImageDimensions(): void {
    const img = imageRef.value
    if (img && img.naturalWidth && img.naturalHeight) {
      editUIStore.setImageDimensions(img.naturalWidth, img.naturalHeight)
      // Only initialize if viewport is also set
      if (editUIStore.viewportDimensions.width > 0 && editUIStore.viewportDimensions.height > 0) {
        editUIStore.initializeZoom()
      }
    }
  }

  function updateViewportDimensions(): void {
    const container = containerRef.value
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      editUIStore.setViewportDimensions(container.clientWidth, container.clientHeight)
      // Only initialize if image is also set
      if (editUIStore.imageDimensions.width > 0 && editUIStore.imageDimensions.height > 0) {
        editUIStore.initializeZoom()
      }
    }
  }

  // ResizeObserver for viewport changes
  let resizeObserver: ResizeObserver | null = null

  function setupResizeObserver(container: HTMLElement): void {
    resizeObserver = new ResizeObserver(() => {
      updateViewportDimensions()
    })
    resizeObserver.observe(container)
  }

  function teardownResizeObserver(): void {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  }

  // ============================================================================
  // Event Setup/Teardown
  // ============================================================================

  function setupEvents(container: HTMLElement): void {
    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mouseleave', handleMouseLeave)
    container.addEventListener('dblclick', handleDoubleClick)

    // Keyboard events on window (for spacebar)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Global mouseup to catch releases outside container
    window.addEventListener('mouseup', handleMouseUp)
  }

  function teardownEvents(container: HTMLElement): void {
    container.removeEventListener('wheel', handleWheel)
    container.removeEventListener('mousedown', handleMouseDown)
    container.removeEventListener('mousemove', handleMouseMove)
    container.removeEventListener('mouseup', handleMouseUp)
    container.removeEventListener('mouseleave', handleMouseLeave)
    container.removeEventListener('dblclick', handleDoubleClick)

    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('mouseup', handleMouseUp)
  }

  function cleanup(): void {
    if (containerRef.value) {
      teardownEvents(containerRef.value)
    }
    teardownResizeObserver()
    isPanning.value = false
    isSpacebarHeld.value = false
    lastPanPos.value = null
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  function zoomIn(): void {
    editUIStore.zoomIn()
  }

  function zoomOut(): void {
    editUIStore.zoomOut()
  }

  function toggleZoom(): void {
    editUIStore.toggleZoom()
  }

  function setPreset(preset: 'fit' | 'fill' | '100%' | '200%'): void {
    editUIStore.setZoomPreset(preset)
  }

  function resetZoom(): void {
    editUIStore.resetZoom()
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  // Watch container ref for setup/teardown
  watch(containerRef, (newContainer, oldContainer) => {
    if (oldContainer) {
      teardownEvents(oldContainer)
      teardownResizeObserver()
    }
    if (newContainer) {
      setupEvents(newContainer)
      setupResizeObserver(newContainer)
      updateViewportDimensions()
    }
  })

  // Watch image ref for dimension updates
  watch(imageRef, (newImg) => {
    if (newImg) {
      // Image might already be loaded
      if (newImg.complete && newImg.naturalWidth) {
        updateImageDimensions()
      }
      // Also listen for load event
      newImg.addEventListener('load', updateImageDimensions)
    }
  })

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    const container = containerRef.value
    const img = imageRef.value

    if (container) {
      setupEvents(container)
      setupResizeObserver(container)
      updateViewportDimensions()
    }

    if (img) {
      if (img.complete && img.naturalWidth) {
        updateImageDimensions()
      }
      img.addEventListener('load', updateImageDimensions)
    }
  })

  onUnmounted(() => {
    cleanup()
    const img = imageRef.value
    if (img) {
      img.removeEventListener('load', updateImageDimensions)
    }
  })

  return {
    transformStyle,
    cursorStyle,
    isSpacebarHeld,
    zoomIn,
    zoomOut,
    toggleZoom,
    setPreset,
    resetZoom,
    cleanup,
  }
}
