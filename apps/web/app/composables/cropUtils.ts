/**
 * Crop Utilities
 *
 * Shared utilities for crop overlay rendering and interaction.
 * Used by both useCropEditor (panel) and useCropOverlay (main preview).
 */

import type { CropRectangle } from '@literoom/core/catalog'

// ============================================================================
// Constants
// ============================================================================

export const HANDLE_SIZE = 12
export const HANDLE_HIT_RADIUS = 20

export const COLORS = {
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

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandlePosition = (typeof HANDLES)[number]

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert canvas coordinates to normalized (0-1) coordinates.
 */
export function toNormalized(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, canvasX / canvasWidth)),
    y: Math.max(0, Math.min(1, canvasY / canvasHeight)),
  }
}

/**
 * Convert normalized coordinates to canvas coordinates.
 */
export function toCanvas(
  normX: number,
  normY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: normX * canvasWidth,
    y: normY * canvasHeight,
  }
}

/**
 * Get handle positions in canvas coordinates.
 */
export function getHandlePositions(
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): Record<HandlePosition, { x: number; y: number }> {
  const left = crop.left * canvasWidth
  const top = crop.top * canvasHeight
  const right = (crop.left + crop.width) * canvasWidth
  const bottom = (crop.top + crop.height) * canvasHeight
  const midX = left + (crop.width * canvasWidth) / 2
  const midY = top + (crop.height * canvasHeight) / 2

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
export function findHandleAt(
  canvasX: number,
  canvasY: number,
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): HandlePosition | null {
  const positions = getHandlePositions(crop, canvasWidth, canvasHeight)
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
export function isInsideCrop(
  canvasX: number,
  canvasY: number,
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const normX = canvasX / canvasWidth
  const normY = canvasY / canvasHeight
  return (
    normX >= crop.left
    && normX <= crop.left + crop.width
    && normY >= crop.top
    && normY <= crop.top + crop.height
  )
}

/**
 * Get canvas coordinates from mouse event.
 *
 * This function correctly handles CSS transforms (zoom/pan) because
 * getBoundingClientRect() returns the transformed position and size.
 * The formula (e.clientX - rect.left) * (canvas.width / rect.width)
 * correctly converts from screen pixels to canvas pixels regardless
 * of any CSS transform applied to the canvas or its ancestors.
 */
export function getCanvasCoords(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  }
}

// ============================================================================
// Rendering Functions
// ============================================================================

/**
 * Draw dark overlay outside crop region.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
): void {
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
export function drawBorder(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
  isActive: boolean,
): void {
  ctx.strokeStyle = isActive ? COLORS.borderActive : COLORS.border
  ctx.lineWidth = 2
  ctx.strokeRect(crop.left * w, crop.top * h, crop.width * w, crop.height * h)
}

/**
 * Draw rule of thirds grid.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
): void {
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
export function drawHandles(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
  activeHandle: HandlePosition | null,
): void {
  const positions = getHandlePositions(crop, w, h)
  const half = HANDLE_SIZE / 2

  ctx.lineWidth = 1

  for (const handle of HANDLES) {
    const pos = positions[handle]
    const isActive = activeHandle === handle

    // Handle fill
    ctx.fillStyle = isActive ? COLORS.handleActive : COLORS.handle
    ctx.fillRect(pos.x - half, pos.y - half, HANDLE_SIZE, HANDLE_SIZE)

    // Handle border
    ctx.strokeStyle = '#000'
    ctx.strokeRect(pos.x - half, pos.y - half, HANDLE_SIZE, HANDLE_SIZE)
  }
}

// ============================================================================
// Cursor Helpers
// ============================================================================

/**
 * Get cursor style for a given handle position.
 */
export function getCursorForHandle(handle: HandlePosition | null): string {
  if (!handle) return 'default'

  const cursors: Record<HandlePosition, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  }

  return cursors[handle]
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function with cancel capability.
 */
export function debounce<T extends (...args: unknown[]) => void>(
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
