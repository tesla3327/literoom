/**
 * useMaskOverlay Composable
 *
 * Manages the mask overlay on the main preview canvas:
 * - Renders all masks (linear and radial gradients)
 * - Handles drag interactions for editing mask handles
 * - Supports drawing mode for creating new masks
 * - Syncs with edit store
 */

import type { Ref, ComputedRef } from 'vue'
import type { LinearGradientMask, RadialGradientMask } from '@literoom/core/catalog'
import { createLinearMask, createRadialMask } from '@literoom/core/catalog'
import {
  type LinearHandle,
  type RadialHandle,
  findLinearHandleAt,
  findRadialHandleAt,
  isNearLinearGradient,
  isInsideRadialGradient,
  drawLinearMask,
  drawRadialMask,
  drawTempLinearMask,
  drawTempRadialMask,
  getCursorForLinearHandle,
  getCursorForRadialHandle,
  updateLinearHandlePosition,
  updateRadialHandlePosition,
} from './maskUtils'
import { toNormalized, getCanvasCoords, debounce } from '~/utils/canvasCoords'

// ============================================================================
// Types
// ============================================================================

export interface UseMaskOverlayOptions {
  /** Canvas element ref */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Display width of the canvas (CSS pixels) */
  displayWidth: Ref<number>
  /** Display height of the canvas (CSS pixels) */
  displayHeight: Ref<number>
}

export interface UseMaskOverlayReturn {
  /** Whether currently dragging a handle */
  isDragging: ComputedRef<boolean>
  /** Whether currently drawing a new mask */
  isDrawing: ComputedRef<boolean>
  /** Current cursor style based on interaction state */
  cursorStyle: ComputedRef<string>
  /** Force re-render canvas */
  render: () => void
  /** Cleanup function */
  cleanup: () => void
}

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing mask overlay on the main preview canvas.
 *
 * @param options - Configuration options
 * @returns Mask overlay state and controls
 */
export function useMaskOverlay(options: UseMaskOverlayOptions): UseMaskOverlayReturn {
  const editStore = useEditStore()
  const editUIStore = useEditUIStore()
  const { canvasRef, displayWidth, displayHeight } = options

  // ============================================================================
  // State
  // ============================================================================

  /** Type of active mask being edited: 'linear' or 'radial' or null */
  const activeMaskType = ref<'linear' | 'radial' | null>(null)

  /** ID of active mask being dragged */
  const activeMaskId = ref<string | null>(null)

  /** Active handle for linear mask editing */
  const activeLinearHandle = ref<LinearHandle | null>(null)

  /** Active handle for radial mask editing */
  const activeRadialHandle = ref<RadialHandle | null>(null)

  /** Hovered mask ID (for cursor feedback) */
  const hoveredMaskId = ref<string | null>(null)

  /** Hovered mask type */
  const hoveredMaskType = ref<'linear' | 'radial' | null>(null)

  /** Hovered linear handle */
  const hoveredLinearHandle = ref<LinearHandle | null>(null)

  /** Hovered radial handle */
  const hoveredRadialHandle = ref<RadialHandle | null>(null)

  /** Whether currently drawing a new mask */
  const isDrawingMask = ref(false)

  /** Start position for drawing a new mask (canvas coords) */
  const drawStart = ref<{ x: number, y: number } | null>(null)

  /** Current position for drawing a new mask (canvas coords) */
  const drawCurrent = ref<{ x: number, y: number } | null>(null)

  /** Whether dragging a radial center for move operation */
  const isMovingRadial = ref(false)

  /** Last mouse position for move calculations */
  const lastMousePos = ref<{ x: number, y: number } | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /** Whether a handle is being dragged */
  const isDragging = computed(() =>
    activeLinearHandle.value !== null
    || activeRadialHandle.value !== null
    || isMovingRadial.value,
  )

  /** Whether drawing a new mask */
  const isDrawing = computed(() => isDrawingMask.value)

  /** Current cursor style based on interaction state */
  const cursorStyle = computed(() => {
    // Drawing mode
    if (editUIStore.maskDrawingMode) {
      return 'crosshair'
    }

    // Currently dragging
    if (activeLinearHandle.value) {
      return getCursorForLinearHandle(activeLinearHandle.value, true)
    }
    if (activeRadialHandle.value) {
      return getCursorForRadialHandle(activeRadialHandle.value, true)
    }
    if (isMovingRadial.value) {
      return 'grabbing'
    }

    // Hovering over handle
    if (hoveredLinearHandle.value) {
      return getCursorForLinearHandle(hoveredLinearHandle.value, false)
    }
    if (hoveredRadialHandle.value) {
      return getCursorForRadialHandle(hoveredRadialHandle.value, false)
    }

    // Hovering over mask (for selection)
    if (hoveredMaskId.value) {
      return 'pointer'
    }

    return 'default'
  })

  // ============================================================================
  // Mask Access Helpers
  // ============================================================================

  function findLinearMask(id: string): LinearGradientMask | undefined {
    const mask = editStore.masks?.linearMasks.find(m => m.id === id)
    return mask ? { ...mask, start: { ...mask.start }, end: { ...mask.end }, adjustments: { ...mask.adjustments } } : undefined
  }

  function findRadialMask(id: string): RadialGradientMask | undefined {
    const mask = editStore.masks?.radialMasks.find(m => m.id === id)
    return mask ? { ...mask, center: { ...mask.center }, adjustments: { ...mask.adjustments } } : undefined
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Main render function.
   */
  function render(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Skip rendering if no dimensions
    if (w === 0 || h === 0) return

    // Draw all existing masks
    const masks = editStore.masks
    if (masks) {
      // Draw unselected linear masks first (back to front)
      for (const mask of masks.linearMasks) {
        if (mask.id !== editStore.selectedMaskId && mask.enabled) {
          const isHovered = hoveredMaskId.value === mask.id
          const activeHandle = isHovered ? hoveredLinearHandle.value : null
          drawLinearMask(ctx, mask as LinearGradientMask, w, h, false, activeHandle)
        }
      }

      // Draw unselected radial masks
      for (const mask of masks.radialMasks) {
        if (mask.id !== editStore.selectedMaskId && mask.enabled) {
          const isHovered = hoveredMaskId.value === mask.id
          const activeHandle = isHovered ? hoveredRadialHandle.value : null
          drawRadialMask(ctx, mask as RadialGradientMask, w, h, false, activeHandle)
        }
      }

      // Draw selected mask last (on top)
      if (editStore.selectedMaskId) {
        const selectedLinear = findLinearMask(editStore.selectedMaskId)
        if (selectedLinear) {
          const handle = activeLinearHandle.value || hoveredLinearHandle.value
          drawLinearMask(ctx, selectedLinear, w, h, true, handle)
        }

        const selectedRadial = findRadialMask(editStore.selectedMaskId)
        if (selectedRadial) {
          const handle = activeRadialHandle.value || hoveredRadialHandle.value
          drawRadialMask(ctx, selectedRadial, w, h, true, handle)
        }
      }
    }

    // Draw temporary mask while drawing
    if (isDrawingMask.value && drawStart.value && drawCurrent.value) {
      if (editUIStore.maskDrawingMode === 'linear') {
        drawTempLinearMask(ctx, drawStart.value, drawCurrent.value)
      }
      else if (editUIStore.maskDrawingMode === 'radial') {
        // For radial, calculate radius from center to current point
        const radiusX = Math.abs(drawCurrent.value.x - drawStart.value.x)
        const radiusY = Math.abs(drawCurrent.value.y - drawStart.value.y)
        drawTempRadialMask(ctx, drawStart.value, radiusX, radiusY)
      }
    }
  }

  // ============================================================================
  // Store Update
  // ============================================================================

  /**
   * Debounced update to the store for smooth dragging.
   */
  const debouncedStoreUpdate = debounce(() => {
    // Updates happen in real-time for responsiveness
    // Debounce mainly for performance during rapid movements
  }, 16)

  // ============================================================================
  // Hit Detection
  // ============================================================================

  /**
   * Find what's under the cursor.
   */
  function findMaskAt(
    canvasX: number,
    canvasY: number,
    canvasWidth: number,
    canvasHeight: number,
  ): {
    maskId: string | null
    maskType: 'linear' | 'radial' | null
    linearHandle: LinearHandle | null
    radialHandle: RadialHandle | null
  } {
    const result = {
      maskId: null as string | null,
      maskType: null as 'linear' | 'radial' | null,
      linearHandle: null as LinearHandle | null,
      radialHandle: null as RadialHandle | null,
    }

    if (!editStore.masks) return result

    // Check selected mask first (highest priority)
    if (editStore.selectedMaskId) {
      const selectedLinear = findLinearMask(editStore.selectedMaskId)
      if (selectedLinear) {
        const handle = findLinearHandleAt(canvasX, canvasY, selectedLinear, canvasWidth, canvasHeight)
        if (handle) {
          return {
            maskId: selectedLinear.id,
            maskType: 'linear',
            linearHandle: handle,
            radialHandle: null,
          }
        }
        // Check if near the line
        if (isNearLinearGradient(canvasX, canvasY, selectedLinear, canvasWidth, canvasHeight)) {
          return {
            maskId: selectedLinear.id,
            maskType: 'linear',
            linearHandle: null,
            radialHandle: null,
          }
        }
      }

      const selectedRadial = findRadialMask(editStore.selectedMaskId)
      if (selectedRadial) {
        const handle = findRadialHandleAt(canvasX, canvasY, selectedRadial, canvasWidth, canvasHeight)
        if (handle) {
          return {
            maskId: selectedRadial.id,
            maskType: 'radial',
            linearHandle: null,
            radialHandle: handle,
          }
        }
        // Check if inside the ellipse
        if (isInsideRadialGradient(canvasX, canvasY, selectedRadial, canvasWidth, canvasHeight)) {
          return {
            maskId: selectedRadial.id,
            maskType: 'radial',
            linearHandle: null,
            radialHandle: null,
          }
        }
      }
    }

    // Check other masks (for selection)
    for (const mask of editStore.masks.linearMasks) {
      if (mask.id === editStore.selectedMaskId) continue
      if (!mask.enabled) continue

      const handle = findLinearHandleAt(canvasX, canvasY, mask as LinearGradientMask, canvasWidth, canvasHeight)
      if (handle) {
        return {
          maskId: mask.id,
          maskType: 'linear',
          linearHandle: handle,
          radialHandle: null,
        }
      }
      if (isNearLinearGradient(canvasX, canvasY, mask as LinearGradientMask, canvasWidth, canvasHeight)) {
        return {
          maskId: mask.id,
          maskType: 'linear',
          linearHandle: null,
          radialHandle: null,
        }
      }
    }

    for (const mask of editStore.masks.radialMasks) {
      if (mask.id === editStore.selectedMaskId) continue
      if (!mask.enabled) continue

      const handle = findRadialHandleAt(canvasX, canvasY, mask as RadialGradientMask, canvasWidth, canvasHeight)
      if (handle) {
        return {
          maskId: mask.id,
          maskType: 'radial',
          linearHandle: null,
          radialHandle: handle,
        }
      }
      if (isInsideRadialGradient(canvasX, canvasY, mask as RadialGradientMask, canvasWidth, canvasHeight)) {
        return {
          maskId: mask.id,
          maskType: 'radial',
          linearHandle: null,
          radialHandle: null,
        }
      }
    }

    return result
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle mouse down - start drawing, dragging, or selection.
   */
  function handleMouseDown(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e, canvas)

    // If in drawing mode, start drawing a new mask
    if (editUIStore.maskDrawingMode) {
      isDrawingMask.value = true
      drawStart.value = { ...coords }
      drawCurrent.value = { ...coords }
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Check for existing mask interaction
    const hit = findMaskAt(coords.x, coords.y, canvas.width, canvas.height)

    if (hit.maskId) {
      // Select the mask if not already selected
      if (hit.maskId !== editStore.selectedMaskId) {
        editStore.selectMask(hit.maskId)
      }

      // Start handle drag if handle was clicked
      if (hit.linearHandle) {
        activeMaskType.value = 'linear'
        activeMaskId.value = hit.maskId
        activeLinearHandle.value = hit.linearHandle
        e.preventDefault()
        e.stopPropagation()
        render()
        return
      }

      if (hit.radialHandle) {
        activeMaskType.value = 'radial'
        activeMaskId.value = hit.maskId

        if (hit.radialHandle === 'center') {
          // Start move operation for radial center
          isMovingRadial.value = true
          lastMousePos.value = { ...coords }
        }
        else {
          activeRadialHandle.value = hit.radialHandle
        }

        e.preventDefault()
        e.stopPropagation()
        render()
        return
      }

      // Just selected, render to show selection
      render()
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Clicked on empty space - deselect
    if (editStore.selectedMaskId) {
      editStore.selectMask(null)
      render()
    }
  }

  /**
   * Handle mouse move - drawing, dragging, or hover.
   */
  function handleMouseMove(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e, canvas)

    // Drawing a new mask
    if (isDrawingMask.value) {
      drawCurrent.value = { ...coords }
      render()
      return
    }

    // Dragging a linear handle
    if (activeLinearHandle.value && activeMaskId.value) {
      const mask = findLinearMask(activeMaskId.value)
      if (mask) {
        const normalized = toNormalized(coords.x, coords.y, canvas.width, canvas.height)
        const updates = updateLinearHandlePosition(mask, activeLinearHandle.value, normalized.x, normalized.y)
        editStore.updateLinearMask(activeMaskId.value, updates)
        render()
      }
      return
    }

    // Dragging a radial handle
    if (activeRadialHandle.value && activeMaskId.value) {
      const mask = findRadialMask(activeMaskId.value)
      if (mask) {
        const normalized = toNormalized(coords.x, coords.y, canvas.width, canvas.height)
        const updates = updateRadialHandlePosition(
          mask,
          activeRadialHandle.value,
          normalized.x,
          normalized.y,
          canvas.width,
          canvas.height,
        )
        editStore.updateRadialMask(activeMaskId.value, updates)
        render()
      }
      return
    }

    // Moving radial mask center
    if (isMovingRadial.value && activeMaskId.value && lastMousePos.value) {
      const mask = findRadialMask(activeMaskId.value)
      if (mask) {
        const deltaX = (coords.x - lastMousePos.value.x) / canvas.width
        const deltaY = (coords.y - lastMousePos.value.y) / canvas.height

        const newCenterX = Math.max(0, Math.min(1, mask.center.x + deltaX))
        const newCenterY = Math.max(0, Math.min(1, mask.center.y + deltaY))

        editStore.updateRadialMask(activeMaskId.value, {
          center: { x: newCenterX, y: newCenterY },
        })
        lastMousePos.value = { ...coords }
        render()
      }
      return
    }

    // Hover state update
    const hit = findMaskAt(coords.x, coords.y, canvas.width, canvas.height)
    const prevHoveredId = hoveredMaskId.value
    const prevHoveredLinear = hoveredLinearHandle.value
    const prevHoveredRadial = hoveredRadialHandle.value

    hoveredMaskId.value = hit.maskId
    hoveredMaskType.value = hit.maskType
    hoveredLinearHandle.value = hit.linearHandle
    hoveredRadialHandle.value = hit.radialHandle

    // Re-render only if hover state changed
    if (
      prevHoveredId !== hoveredMaskId.value
      || prevHoveredLinear !== hoveredLinearHandle.value
      || prevHoveredRadial !== hoveredRadialHandle.value
    ) {
      render()
    }
  }

  /**
   * Handle mouse up - finish drawing or dragging.
   */
  function handleMouseUp(_e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return

    // Finish drawing a new mask
    if (isDrawingMask.value && drawStart.value && drawCurrent.value) {
      const startNorm = toNormalized(drawStart.value.x, drawStart.value.y, canvas.width, canvas.height)
      const endNorm = toNormalized(drawCurrent.value.x, drawCurrent.value.y, canvas.width, canvas.height)

      // Only create mask if there's meaningful distance
      const dx = Math.abs(endNorm.x - startNorm.x)
      const dy = Math.abs(endNorm.y - startNorm.y)
      const minDistance = 0.02 // Minimum 2% of image dimension

      if (dx > minDistance || dy > minDistance) {
        if (editUIStore.maskDrawingMode === 'linear') {
          const newMask = createLinearMask(startNorm, endNorm)
          editStore.addLinearMask(newMask)
        }
        else if (editUIStore.maskDrawingMode === 'radial') {
          const radiusX = Math.max(minDistance, dx)
          const radiusY = Math.max(minDistance, dy)
          const newMask = createRadialMask(startNorm, radiusX, radiusY)
          editStore.addRadialMask(newMask)
        }
      }

      // Exit drawing mode
      isDrawingMask.value = false
      drawStart.value = null
      drawCurrent.value = null
      editUIStore.cancelMaskDrawing()
      render()
      return
    }

    // End handle drag
    if (activeLinearHandle.value || activeRadialHandle.value || isMovingRadial.value) {
      debouncedStoreUpdate.cancel()
      activeLinearHandle.value = null
      activeRadialHandle.value = null
      activeMaskId.value = null
      activeMaskType.value = null
      isMovingRadial.value = false
      lastMousePos.value = null
      render()
    }
  }

  /**
   * Handle mouse leave - cancel operations.
   */
  function handleMouseLeave(): void {
    // Cancel drawing
    if (isDrawingMask.value) {
      isDrawingMask.value = false
      drawStart.value = null
      drawCurrent.value = null
    }

    // Cancel drag
    handleMouseUp(new MouseEvent('mouseup'))

    // Clear hover state
    hoveredMaskId.value = null
    hoveredMaskType.value = null
    hoveredLinearHandle.value = null
    hoveredRadialHandle.value = null
    render()
  }

  /**
   * Handle Escape key to cancel drawing mode.
   */
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (isDrawingMask.value) {
        isDrawingMask.value = false
        drawStart.value = null
        drawCurrent.value = null
        render()
      }
      if (editUIStore.maskDrawingMode) {
        editUIStore.cancelMaskDrawing()
      }
    }

    // Delete selected mask
    if ((e.key === 'Delete' || e.key === 'Backspace') && editStore.selectedMaskId) {
      // Only handle if not in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      editStore.deleteMask(editStore.selectedMaskId)
      render()
      e.preventDefault()
    }
  }

  // ============================================================================
  // Event Setup/Teardown
  // ============================================================================

  /**
   * Setup event listeners on canvas.
   */
  function setupEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)
  }

  /**
   * Remove event listeners from canvas.
   */
  function teardownEvents(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousedown', handleMouseDown)
    canvas.removeEventListener('mousemove', handleMouseMove)
    canvas.removeEventListener('mouseup', handleMouseUp)
    canvas.removeEventListener('mouseleave', handleMouseLeave)
  }

  /**
   * Cleanup function for external use.
   */
  function cleanup(): void {
    debouncedStoreUpdate.cancel()
    if (canvasRef.value) {
      teardownEvents(canvasRef.value)
    }
    document.removeEventListener('keydown', handleKeyDown)
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Re-render when masks change in the store.
   */
  watch(
    () => editStore.masks,
    () => {
      if (!isDragging.value && !isDrawing.value) {
        render()
      }
    },
    { deep: true },
  )

  /**
   * Re-render when selected mask changes.
   */
  watch(
    () => editStore.selectedMaskId,
    () => {
      render()
    },
  )

  /**
   * Re-render when drawing mode changes.
   */
  watch(
    () => editUIStore.maskDrawingMode,
    () => {
      render()
    },
  )

  /**
   * Re-render when display dimensions change.
   */
  watch([displayWidth, displayHeight], () => {
    nextTick(() => render())
  })

  /**
   * Setup/teardown events when canvas ref changes.
   */
  watch(canvasRef, (newCanvas, oldCanvas) => {
    if (oldCanvas) teardownEvents(oldCanvas)
    if (newCanvas) {
      setupEvents(newCanvas)
      nextTick(() => render())
    }
  })

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    if (canvasRef.value) {
      setupEvents(canvasRef.value)
      nextTick(() => render())
    }
    // Add global keyboard listener for Escape
    document.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    isDragging,
    isDrawing,
    cursorStyle,
    render,
    cleanup,
  }
}
