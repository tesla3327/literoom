/**
 * useCropOverlay Composable
 *
 * Manages the crop overlay on the main preview canvas:
 * - Renders crop region visualization
 * - Handles drag interactions for resize and move
 * - Syncs with edit store
 * - Supports aspect ratio constraints
 */

import type { Ref, ComputedRef } from 'vue'
import type { CropRectangle } from '@literoom/core/catalog'
import {
  HANDLES,
  type HandlePosition,
  toNormalized,
  getHandlePositions,
  findHandleAt,
  isInsideCrop,
  getCanvasCoords,
  drawOverlay,
  drawBorder,
  drawGrid,
  drawHandles,
  getCursorForHandle,
  debounce,
} from './cropUtils'

// ============================================================================
// Types
// ============================================================================

export interface UseCropOverlayOptions {
  /** Canvas element ref */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Display width of the canvas (CSS pixels) */
  displayWidth: Ref<number>
  /** Display height of the canvas (CSS pixels) */
  displayHeight: Ref<number>
  /** Source image width */
  imageWidth: Ref<number>
  /** Source image height */
  imageHeight: Ref<number>
}

export interface UseCropOverlayReturn {
  /** Whether currently dragging (resize or move) */
  isDragging: ComputedRef<boolean>
  /** Current cursor style based on interaction state */
  cursorStyle: ComputedRef<string>
  /** Local crop state (for debugging/display) */
  localCrop: Ref<CropRectangle>
  /** Force re-render canvas */
  render: () => void
  /** Cleanup function */
  cleanup: () => void
}

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing crop overlay on the main preview canvas.
 *
 * @param options - Configuration options
 * @returns Crop overlay state and controls
 */
export function useCropOverlay(options: UseCropOverlayOptions): UseCropOverlayReturn {
  const editStore = useEditStore()
  const { canvasRef, displayWidth, displayHeight, imageWidth, imageHeight } = options

  // ============================================================================
  // State
  // ============================================================================

  /** Local crop state (synced with store but allows immediate updates during drag) */
  const localCrop = ref<CropRectangle>({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  })

  /** Currently active handle (for dragging) */
  const activeHandle = ref<HandlePosition | null>(null)

  /** Whether in move mode (dragging entire crop) */
  const isMoving = ref(false)

  /** Last mouse position for move calculations */
  const lastMousePos = ref<{ x: number; y: number } | null>(null)

  /** Handle currently under cursor (for hover effect) */
  const hoveredHandle = ref<HandlePosition | null>(null)

  /** Whether cursor is inside crop region */
  const isHoveringCrop = ref(false)

  // ============================================================================
  // Computed
  // ============================================================================

  /** Whether a handle is being dragged */
  const isDragging = computed(() => activeHandle.value !== null || isMoving.value)

  /** Current cursor style based on interaction state */
  const cursorStyle = computed(() => {
    if (activeHandle.value) {
      return getCursorForHandle(activeHandle.value)
    }
    if (isMoving.value) {
      return 'grabbing'
    }
    if (hoveredHandle.value) {
      return getCursorForHandle(hoveredHandle.value)
    }
    if (isHoveringCrop.value) {
      return 'grab'
    }
    return 'default'
  })

  /** Get effective aspect ratio from edit store */
  const effectiveAspectRatio = computed(() => {
    // For now, we don't enforce aspect ratio from overlay
    // This could be extended to read from a shared aspect ratio state
    return null
  })

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
    const crop = localCrop.value

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Draw dark overlay outside crop region
    drawOverlay(ctx, crop, w, h)

    // Draw crop border
    drawBorder(ctx, crop, w, h, isDragging.value)

    // Draw rule of thirds grid
    drawGrid(ctx, crop, w, h)

    // Draw handles
    drawHandles(ctx, crop, w, h, activeHandle.value || hoveredHandle.value)
  }

  // ============================================================================
  // Store Update
  // ============================================================================

  /**
   * Debounced update to the store.
   */
  const debouncedStoreUpdate = debounce(() => {
    commitCrop()
  }, 32)

  /**
   * Commit crop to store.
   */
  function commitCrop(): void {
    const crop = localCrop.value
    // If crop is full image, set to null
    if (
      Math.abs(crop.left) < 0.001
      && Math.abs(crop.top) < 0.001
      && Math.abs(crop.width - 1) < 0.001
      && Math.abs(crop.height - 1) < 0.001
    ) {
      editStore.setCrop(null)
    }
    else {
      editStore.setCrop({ ...crop })
    }
  }

  // ============================================================================
  // Resize Logic
  // ============================================================================

  /**
   * Resize crop based on handle drag.
   */
  function resizeCrop(
    handle: HandlePosition,
    coords: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const norm = toNormalized(coords.x, coords.y, canvasWidth, canvasHeight)
    const crop = { ...localCrop.value }
    const ratio = effectiveAspectRatio.value

    // Get original edges
    let left = crop.left
    let top = crop.top
    let right = crop.left + crop.width
    let bottom = crop.top + crop.height

    // Minimum crop size (5% of image)
    const minSize = 0.05

    // Update edges based on handle
    switch (handle) {
      case 'nw':
        left = Math.min(norm.x, right - minSize)
        top = Math.min(norm.y, bottom - minSize)
        break
      case 'n':
        top = Math.min(norm.y, bottom - minSize)
        break
      case 'ne':
        right = Math.max(norm.x, left + minSize)
        top = Math.min(norm.y, bottom - minSize)
        break
      case 'e':
        right = Math.max(norm.x, left + minSize)
        break
      case 'se':
        right = Math.max(norm.x, left + minSize)
        bottom = Math.max(norm.y, top + minSize)
        break
      case 's':
        bottom = Math.max(norm.y, top + minSize)
        break
      case 'sw':
        left = Math.min(norm.x, right - minSize)
        bottom = Math.max(norm.y, top + minSize)
        break
      case 'w':
        left = Math.min(norm.x, right - minSize)
        break
    }

    // Clamp to bounds
    left = Math.max(0, left)
    top = Math.max(0, top)
    right = Math.min(1, right)
    bottom = Math.min(1, bottom)

    // Apply aspect ratio constraint if set
    if (ratio && imageWidth.value && imageHeight.value) {
      const newWidth = right - left
      const newHeight = bottom - top
      const currentRatio = (newWidth * imageWidth.value) / (newHeight * imageHeight.value)

      if (Math.abs(currentRatio - ratio) > 0.01) {
        // Constrain based on which edge was moved
        if (['n', 's'].includes(handle)) {
          // Adjust width to match ratio
          const targetWidth = (newHeight * imageHeight.value * ratio) / imageWidth.value
          const widthDelta = (targetWidth - newWidth) / 2
          left = Math.max(0, left - widthDelta)
          right = Math.min(1, right + widthDelta)
        }
        else if (['e', 'w'].includes(handle)) {
          // Adjust height to match ratio
          const targetHeight = (newWidth * imageWidth.value) / (ratio * imageHeight.value)
          const heightDelta = (targetHeight - newHeight) / 2
          top = Math.max(0, top - heightDelta)
          bottom = Math.min(1, bottom + heightDelta)
        }
        else {
          // Corner handles - constrain the secondary dimension
          const targetHeight = (newWidth * imageWidth.value) / (ratio * imageHeight.value)
          if (['nw', 'ne'].includes(handle)) {
            top = Math.max(0, bottom - targetHeight)
          }
          else {
            bottom = Math.min(1, top + targetHeight)
          }
        }
      }
    }

    localCrop.value = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    }
  }

  /**
   * Move crop region.
   */
  function moveCrop(
    coords: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    if (!lastMousePos.value) return

    const deltaX = (coords.x - lastMousePos.value.x) / canvasWidth
    const deltaY = (coords.y - lastMousePos.value.y) / canvasHeight
    const crop = localCrop.value

    let newLeft = crop.left + deltaX
    let newTop = crop.top + deltaY

    // Clamp to bounds
    newLeft = Math.max(0, Math.min(1 - crop.width, newLeft))
    newTop = Math.max(0, Math.min(1 - crop.height, newTop))

    localCrop.value = {
      ...crop,
      left: newLeft,
      top: newTop,
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle mouse down - start resize or move.
   */
  function handleMouseDown(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e, canvas)

    // Check for handle first
    const handle = findHandleAt(coords.x, coords.y, localCrop.value, canvas.width, canvas.height)
    if (handle) {
      activeHandle.value = handle
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Check if inside crop for move
    if (isInsideCrop(coords.x, coords.y, localCrop.value, canvas.width, canvas.height)) {
      isMoving.value = true
      lastMousePos.value = coords
      e.preventDefault()
      e.stopPropagation()
    }
  }

  /**
   * Handle mouse move - resize, move, or update hover state.
   */
  function handleMouseMove(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e, canvas)

    if (activeHandle.value) {
      // Resizing
      resizeCrop(activeHandle.value, coords, canvas.width, canvas.height)
      debouncedStoreUpdate()
      render()
    }
    else if (isMoving.value && lastMousePos.value) {
      // Moving
      moveCrop(coords, canvas.width, canvas.height)
      lastMousePos.value = coords
      debouncedStoreUpdate()
      render()
    }
    else {
      // Update hover state for cursor
      const handle = findHandleAt(coords.x, coords.y, localCrop.value, canvas.width, canvas.height)
      const wasHoveredHandle = hoveredHandle.value
      const wasHoveringCrop = isHoveringCrop.value

      hoveredHandle.value = handle
      isHoveringCrop.value = handle === null && isInsideCrop(coords.x, coords.y, localCrop.value, canvas.width, canvas.height)

      // Only re-render if hover state changed (to highlight handle)
      if (wasHoveredHandle !== hoveredHandle.value || wasHoveringCrop !== isHoveringCrop.value) {
        render()
      }
    }
  }

  /**
   * Handle mouse up - end interaction.
   */
  function handleMouseUp(): void {
    if (activeHandle.value || isMoving.value) {
      debouncedStoreUpdate.cancel()
      commitCrop()
      activeHandle.value = null
      isMoving.value = false
      lastMousePos.value = null
      render()
    }
  }

  /**
   * Handle mouse leave - end interaction and clear hover.
   */
  function handleMouseLeave(): void {
    handleMouseUp()
    hoveredHandle.value = null
    isHoveringCrop.value = false
    render()
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
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Sync local crop with store (when not dragging).
   */
  watch(
    () => editStore.cropTransform.crop,
    (storeCrop) => {
      if (!isDragging.value) {
        if (storeCrop) {
          localCrop.value = { ...storeCrop }
        }
        else {
          localCrop.value = { left: 0, top: 0, width: 1, height: 1 }
        }
        render()
      }
    },
    { immediate: true },
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
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    isDragging,
    cursorStyle,
    localCrop,
    render,
    cleanup,
  }
}
