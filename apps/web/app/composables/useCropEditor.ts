/**
 * useCropEditor Composable
 *
 * Manages crop overlay interaction and rendering:
 * - Crop region visualization on canvas
 * - Drag handles for resizing crop
 * - Aspect ratio constraints
 * - Coordinate conversions
 * - Debounced store updates
 */

import type { Ref } from 'vue'
import type { CropRectangle } from '@literoom/core/catalog'

// ============================================================================
// Constants
// ============================================================================

const HANDLE_SIZE = 12
const HANDLE_HIT_RADIUS = 20

const COLORS = {
  overlay: 'rgba(0, 0, 0, 0.6)',
  border: '#ffffff',
  borderActive: '#3b82f6',
  grid: 'rgba(255, 255, 255, 0.3)',
  handle: '#ffffff',
  handleActive: '#3b82f6',
}

// ============================================================================
// Types
// ============================================================================

/**
 * Aspect ratio presets for crop.
 */
export const ASPECT_PRESETS = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' as const },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
] as const

export type AspectPreset = (typeof ASPECT_PRESETS)[number]['value']

/**
 * Handle positions around the crop rectangle.
 */
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type HandlePosition = (typeof HANDLES)[number]

export interface UseCropEditorOptions {
  /** Canvas element ref */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Image width in pixels */
  imageWidth: Ref<number>
  /** Image height in pixels */
  imageHeight: Ref<number>
}

export interface UseCropEditorReturn {
  /** Local crop state (synced with store) */
  localCrop: Ref<CropRectangle>
  /** Current aspect ratio preset */
  aspectRatio: Ref<AspectPreset>
  /** Whether currently dragging */
  isDragging: ComputedRef<boolean>
  /** Effective aspect ratio value (null for free) */
  effectiveAspectRatio: ComputedRef<number | null>
  /** Whether crop differs from full image */
  hasModifications: ComputedRef<boolean>
  /** Set aspect ratio preset */
  setAspectRatio: (preset: AspectPreset) => void
  /** Reset crop to full image */
  resetCrop: () => void
  /** Commit crop to store */
  commitCrop: () => void
  /** Force re-render canvas */
  render: () => void
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function with cancel capability.
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced as T & { cancel: () => void }
}

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing crop editor interactions.
 *
 * @param options - Configuration options
 * @returns Crop editor state and controls
 */
export function useCropEditor(options: UseCropEditorOptions): UseCropEditorReturn {
  const editStore = useEditStore()
  const { canvasRef, imageWidth, imageHeight } = options

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

  /** Current aspect ratio preset */
  const aspectRatio = ref<AspectPreset>(null)

  /** Currently active handle (for dragging) */
  const activeHandle = ref<HandlePosition | null>(null)

  /** Whether in move mode (dragging entire crop) */
  const isMoving = ref(false)

  /** Last mouse position for move calculations */
  const lastMousePos = ref<{ x: number, y: number } | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /** Whether a handle is being dragged */
  const isDragging = computed(() => activeHandle.value !== null || isMoving.value)

  /** Original aspect ratio from image dimensions */
  const originalAspectRatio = computed(() => {
    if (imageWidth.value && imageHeight.value) {
      return imageWidth.value / imageHeight.value
    }
    return 1
  })

  /** Effective aspect ratio value (null for free) */
  const effectiveAspectRatio = computed(() => {
    if (aspectRatio.value === null) return null
    if (aspectRatio.value === 'original') return originalAspectRatio.value
    return aspectRatio.value
  })

  /** Whether crop differs from full image */
  const hasModifications = computed(() => {
    const crop = localCrop.value
    return (
      Math.abs(crop.left) > 0.001
      || Math.abs(crop.top) > 0.001
      || Math.abs(crop.width - 1) > 0.001
      || Math.abs(crop.height - 1) > 0.001
    )
  })

  // ============================================================================
  // Coordinate Conversion
  // ============================================================================

  /**
   * Convert canvas coordinates to normalized (0-1) coordinates.
   */
  function toNormalized(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): { x: number, y: number } {
    return {
      x: Math.max(0, Math.min(1, canvasX / canvas.width)),
      y: Math.max(0, Math.min(1, canvasY / canvas.height)),
    }
  }

  /**
   * Get handle positions in canvas coordinates.
   */
  function getHandlePositions(canvas: HTMLCanvasElement): Record<HandlePosition, { x: number, y: number }> {
    const crop = localCrop.value
    const left = crop.left * canvas.width
    const top = crop.top * canvas.height
    const right = (crop.left + crop.width) * canvas.width
    const bottom = (crop.top + crop.height) * canvas.height
    const midX = left + (crop.width * canvas.width) / 2
    const midY = top + (crop.height * canvas.height) / 2

    return {
      nw: { x: left, y: top },
      n: { x: midX, y: top },
      ne: { x: right, y: top },
      e: { x: right, y: midY },
      se: { x: right, y: bottom },
      s: { x: midX, y: bottom },
      sw: { x: left, y: bottom },
      w: { x: left, y: midY },
    }
  }

  /**
   * Find handle at canvas coordinates.
   */
  function findHandleAt(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): HandlePosition | null {
    const positions = getHandlePositions(canvas)
    for (const handle of HANDLES) {
      const pos = positions[handle]
      const dist = Math.sqrt((canvasX - pos.x) ** 2 + (canvasY - pos.y) ** 2)
      if (dist <= HANDLE_HIT_RADIUS) return handle
    }
    return null
  }

  /**
   * Check if point is inside the crop region (for move).
   */
  function isInsideCrop(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): boolean {
    const crop = localCrop.value
    const normX = canvasX / canvas.width
    const normY = canvasY / canvas.height
    return (
      normX >= crop.left
      && normX <= crop.left + crop.width
      && normY >= crop.top
      && normY <= crop.top + crop.height
    )
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
    const crop = localCrop.value

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Draw dark overlay outside crop region
    drawOverlay(ctx, crop, w, h)

    // Draw crop border
    drawBorder(ctx, crop, w, h)

    // Draw rule of thirds grid
    drawGrid(ctx, crop, w, h)

    // Draw handles
    drawHandles(ctx, crop, w, h)
  }

  /**
   * Draw dark overlay outside crop region.
   */
  function drawOverlay(ctx: CanvasRenderingContext2D, crop: CropRectangle, w: number, h: number): void {
    ctx.fillStyle = COLORS.overlay

    // Top
    ctx.fillRect(0, 0, w, crop.top * h)
    // Bottom
    ctx.fillRect(0, (crop.top + crop.height) * h, w, (1 - crop.top - crop.height) * h)
    // Left
    ctx.fillRect(0, crop.top * h, crop.left * w, crop.height * h)
    // Right
    ctx.fillRect(
      (crop.left + crop.width) * w,
      crop.top * h,
      (1 - crop.left - crop.width) * w,
      crop.height * h,
    )
  }

  /**
   * Draw crop border.
   */
  function drawBorder(ctx: CanvasRenderingContext2D, crop: CropRectangle, w: number, h: number): void {
    ctx.strokeStyle = isDragging.value ? COLORS.borderActive : COLORS.border
    ctx.lineWidth = 2
    ctx.strokeRect(crop.left * w, crop.top * h, crop.width * w, crop.height * h)
  }

  /**
   * Draw rule of thirds grid.
   */
  function drawGrid(ctx: CanvasRenderingContext2D, crop: CropRectangle, w: number, h: number): void {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1

    const cropX = crop.left * w
    const cropY = crop.top * h
    const cropW = crop.width * w
    const cropH = crop.height * h

    // Vertical lines
    for (let i = 1; i < 3; i++) {
      const x = cropX + (cropW * i) / 3
      ctx.beginPath()
      ctx.moveTo(x, cropY)
      ctx.lineTo(x, cropY + cropH)
      ctx.stroke()
    }

    // Horizontal lines
    for (let i = 1; i < 3; i++) {
      const y = cropY + (cropH * i) / 3
      ctx.beginPath()
      ctx.moveTo(cropX, y)
      ctx.lineTo(cropX + cropW, y)
      ctx.stroke()
    }
  }

  /**
   * Draw resize handles.
   */
  function drawHandles(ctx: CanvasRenderingContext2D, crop: CropRectangle, w: number, h: number): void {
    const positions = getHandlePositions({ width: w, height: h } as HTMLCanvasElement)
    const half = HANDLE_SIZE / 2

    ctx.lineWidth = 1

    for (const handle of HANDLES) {
      const pos = positions[handle]
      const isActive = activeHandle.value === handle

      // Handle fill
      ctx.fillStyle = isActive ? COLORS.handleActive : COLORS.handle
      ctx.fillRect(pos.x - half, pos.y - half, HANDLE_SIZE, HANDLE_SIZE)

      // Handle border
      ctx.strokeStyle = '#000'
      ctx.strokeRect(pos.x - half, pos.y - half, HANDLE_SIZE, HANDLE_SIZE)
    }
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
  // Aspect Ratio
  // ============================================================================

  /**
   * Set aspect ratio preset.
   */
  function setAspectRatio(preset: AspectPreset): void {
    aspectRatio.value = preset
    if (preset !== null) {
      constrainCropToAspect()
    }
  }

  /**
   * Constrain crop to current aspect ratio.
   */
  function constrainCropToAspect(): void {
    const ratio = effectiveAspectRatio.value
    if (!ratio) return

    const crop = localCrop.value
    const currentRatio = (crop.width * imageWidth.value) / (crop.height * imageHeight.value)

    // If already matches, no change needed
    if (Math.abs(currentRatio - ratio) < 0.01) return

    // Calculate new dimensions
    const centerX = crop.left + crop.width / 2
    const centerY = crop.top + crop.height / 2

    // Adjust based on which dimension to constrain
    // Try to fit by width first
    let newWidth = crop.width
    let newHeight = (crop.width * imageWidth.value) / (ratio * imageHeight.value)

    // If height overflows, constrain by height instead
    if (newHeight > 1 - crop.top || centerY + newHeight / 2 > 1 || centerY - newHeight / 2 < 0) {
      newHeight = crop.height
      newWidth = (crop.height * imageHeight.value * ratio) / imageWidth.value
    }

    // Clamp to bounds
    newWidth = Math.min(newWidth, 1)
    newHeight = Math.min(newHeight, 1)

    // Recenter
    let newLeft = centerX - newWidth / 2
    let newTop = centerY - newHeight / 2

    // Clamp position
    newLeft = Math.max(0, Math.min(1 - newWidth, newLeft))
    newTop = Math.max(0, Math.min(1 - newHeight, newTop))

    localCrop.value = {
      left: newLeft,
      top: newTop,
      width: newWidth,
      height: newHeight,
    }

    commitCrop()
    render()
  }

  // ============================================================================
  // Reset
  // ============================================================================

  /**
   * Reset crop to full image.
   */
  function resetCrop(): void {
    localCrop.value = { left: 0, top: 0, width: 1, height: 1 }
    aspectRatio.value = null
    editStore.setCrop(null)
    render()
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Get canvas coordinates from mouse event.
   */
  function getCanvasCoords(e: MouseEvent): { x: number, y: number } | null {
    const canvas = canvasRef.value
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  /**
   * Handle mouse down - start resize or move.
   */
  function handleMouseDown(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e)
    if (!coords) return

    // Check for handle first
    const handle = findHandleAt(coords.x, coords.y, canvas)
    if (handle) {
      activeHandle.value = handle
      return
    }

    // Check if inside crop for move
    if (isInsideCrop(coords.x, coords.y, canvas)) {
      isMoving.value = true
      lastMousePos.value = coords
    }
  }

  /**
   * Handle mouse move - resize or move crop.
   */
  function handleMouseMove(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const coords = getCanvasCoords(e)
    if (!coords) return

    if (activeHandle.value) {
      // Resizing
      resizeCrop(activeHandle.value, coords, canvas)
      debouncedStoreUpdate()
      render()
    }
    else if (isMoving.value && lastMousePos.value) {
      // Moving
      moveCrop(coords, canvas)
      lastMousePos.value = coords
      debouncedStoreUpdate()
      render()
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
   * Resize crop based on handle drag.
   */
  function resizeCrop(handle: HandlePosition, coords: { x: number, y: number }, canvas: HTMLCanvasElement): void {
    const norm = toNormalized(coords.x, coords.y, canvas)
    const crop = { ...localCrop.value }
    const ratio = effectiveAspectRatio.value

    // Get original edges
    let left = crop.left
    let top = crop.top
    let right = crop.left + crop.width
    let bottom = crop.top + crop.height

    // Update edges based on handle
    switch (handle) {
      case 'nw':
        left = Math.min(norm.x, right - 0.05)
        top = Math.min(norm.y, bottom - 0.05)
        break
      case 'n':
        top = Math.min(norm.y, bottom - 0.05)
        break
      case 'ne':
        right = Math.max(norm.x, left + 0.05)
        top = Math.min(norm.y, bottom - 0.05)
        break
      case 'e':
        right = Math.max(norm.x, left + 0.05)
        break
      case 'se':
        right = Math.max(norm.x, left + 0.05)
        bottom = Math.max(norm.y, top + 0.05)
        break
      case 's':
        bottom = Math.max(norm.y, top + 0.05)
        break
      case 'sw':
        left = Math.min(norm.x, right - 0.05)
        bottom = Math.max(norm.y, top + 0.05)
        break
      case 'w':
        left = Math.min(norm.x, right - 0.05)
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
  function moveCrop(coords: { x: number, y: number }, canvas: HTMLCanvasElement): void {
    if (!lastMousePos.value) return

    const deltaX = (coords.x - lastMousePos.value.x) / canvas.width
    const deltaY = (coords.y - lastMousePos.value.y) / canvas.height
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
  // Event Setup/Teardown
  // ============================================================================

  /**
   * Setup event listeners on canvas.
   */
  function setupEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseUp)
  }

  /**
   * Remove event listeners from canvas.
   */
  function teardownEvents(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousedown', handleMouseDown)
    canvas.removeEventListener('mousemove', handleMouseMove)
    canvas.removeEventListener('mouseup', handleMouseUp)
    canvas.removeEventListener('mouseleave', handleMouseUp)
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
   * Re-render when image dimensions change.
   */
  watch([imageWidth, imageHeight], () => render())

  /**
   * Setup/teardown events when canvas ref changes.
   */
  watch(canvasRef, (newCanvas, oldCanvas) => {
    if (oldCanvas) teardownEvents(oldCanvas)
    if (newCanvas) {
      setupEvents(newCanvas)
      render()
    }
  })

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    if (canvasRef.value) {
      setupEvents(canvasRef.value)
      render()
    }
  })

  onUnmounted(() => {
    debouncedStoreUpdate.cancel()
    if (canvasRef.value) {
      teardownEvents(canvasRef.value)
    }
  })

  return {
    localCrop,
    aspectRatio,
    isDragging,
    effectiveAspectRatio,
    hasModifications,
    setAspectRatio,
    resetCrop,
    commitCrop,
    render,
  }
}
